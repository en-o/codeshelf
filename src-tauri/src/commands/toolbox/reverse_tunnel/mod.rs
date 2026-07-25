// 内网穿透（公网映射）模块 —— 等价 `ssh -N -R bindAddr:remotePort:localHost:localPort user@sshHost`
//
// 与 ssh_tunnel（正向 `-L`）方向相反：这里通过 SSH **反向转发** 把本地服务暴露到
// 用户自己的 VPS 公网端口，用于开发调试（如微信回调只能填外网域名/IP，本地收不到）。
//
// 设计要点：
// - 完全独立于 ssh_tunnel，仅复用共享的 `SshAuthMethod` 数据枚举，不触碰其任何文件。
// - 底层同样用 russh 纯 Rust 客户端；连接认证后调用 `tcpip_forward` 请求 VPS 监听，
//   入站连接经 Handler 回调 `server_channel_open_forwarded_tcpip` 回流，拨号本地服务对拷。
// - 安全：remote_bind_addr 默认 127.0.0.1（仅 VPS 本机可达，建议配 nginx 反代）；
//   暴露公网（0.0.0.0）需前端显式确认，且 VPS 需 `GatewayPorts yes`。
//
// 子模块：
// - auth:    connect_and_authenticate（自带一份，复用 SshAuthMethod）
// - runtime: tcpip_forward + 入站回调对拷 + 重连监督器
// - commands: Tauri 命令（CRUD + start/stop + get + stats）

use super::SshAuthMethod;
use crate::error::AppResult;
use crate::storage;
use once_cell::sync::Lazy;
use russh::client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{Mutex, Notify};

mod auth;
mod commands;
mod runtime;

pub use commands::*;

fn default_bind_addr() -> String {
    "127.0.0.1".to_string()
}

fn default_local_host() -> String {
    "127.0.0.1".to_string()
}

fn default_ssh_port() -> u16 {
    22
}

fn default_true() -> bool {
    true
}

fn default_stopped() -> String {
    "stopped".to_string()
}

/// 内网穿透规则（反向 SSH 隧道）
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReverseTunnel {
    pub id: String,
    pub name: String,
    /// 要暴露的本地服务主机，默认 127.0.0.1
    #[serde(default = "default_local_host")]
    pub local_host: String,
    /// 要暴露的本地服务端口
    pub local_port: u16,
    /// SSH 服务器（用户自己的 VPS）地址
    pub ssh_host: String,
    /// SSH 服务器端口，默认 22
    #[serde(default = "default_ssh_port")]
    pub ssh_port: u16,
    /// SSH 登录用户（使用 SshConfig 时可为空）
    #[serde(default)]
    pub ssh_user: String,
    /// 认证方式（复用共享枚举）
    pub auth: SshAuthMethod,
    /// VPS 上的监听地址：127.0.0.1=仅本机可达（安全，配 nginx 反代）；
    /// 0.0.0.0=对公网开放（危险，需 VPS `GatewayPorts yes`）
    #[serde(default = "default_bind_addr")]
    pub remote_bind_addr: String,
    /// VPS 上对外暴露的端口
    pub remote_port: u16,
    /// 可选域名，仅用于展示与拼接公网 URL（不参与转发逻辑）
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default = "default_stopped")]
    pub status: String,
    #[serde(default)]
    pub connections: u32,
    #[serde(default)]
    pub bytes_in: u64,
    #[serde(default)]
    pub bytes_out: u64,
    #[serde(default)]
    pub last_error: Option<String>,
    /// 断线后自动重连；缺省开启
    #[serde(default = "default_true")]
    pub auto_reconnect: bool,
    /// 累计自动重连成功次数（运行期统计，加载时重置）
    #[serde(default)]
    pub reconnects: u32,
    /// 所属分组
    #[serde(default = "super::default_group")]
    pub group: String,
    pub created_at: String,
}

/// 创建/更新内网穿透的输入
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReverseTunnelInput {
    pub name: String,
    #[serde(default)]
    pub local_host: Option<String>,
    pub local_port: u16,
    pub ssh_host: String,
    pub ssh_port: Option<u16>,
    pub ssh_user: Option<String>,
    pub auth: SshAuthMethod,
    #[serde(default)]
    pub remote_bind_addr: Option<String>,
    pub remote_port: u16,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub auto_reconnect: Option<bool>,
    #[serde(default)]
    pub group: Option<String>,
}

/// 内网穿透统计
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReverseTunnelStats {
    pub tunnel_id: String,
    pub connections: u32,
    pub bytes_in: u64,
    pub bytes_out: u64,
}

/// 隧道存储
pub(super) static REVERSE_TUNNELS: Lazy<Arc<Mutex<HashMap<String, ReverseTunnel>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// 是否已从磁盘加载
pub(super) static TUNNELS_LOADED: Lazy<Arc<Mutex<bool>>> =
    Lazy::new(|| Arc::new(Mutex::new(false)));

/// 控制器（用于停止/统计）
pub(super) static REVERSE_CONTROLLERS: Lazy<Arc<Mutex<HashMap<String, Arc<ReverseTunnelController>>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// 隧道控制器（与 ssh_tunnel 同构，但本模块自带，互不影响）
pub(super) struct ReverseTunnelController {
    stop: AtomicBool,
    connections: AtomicU32,
    bytes_in: AtomicU64,
    bytes_out: AtomicU64,
    reconnects: AtomicU32,
    reconnect_notify: Notify,
}

impl ReverseTunnelController {
    pub(super) fn new() -> Self {
        Self {
            stop: AtomicBool::new(false),
            connections: AtomicU32::new(0),
            bytes_in: AtomicU64::new(0),
            bytes_out: AtomicU64::new(0),
            reconnects: AtomicU32::new(0),
            reconnect_notify: Notify::new(),
        }
    }

    pub(super) fn is_stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }

    pub(super) fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }

    pub(super) fn request_reconnect(&self) {
        self.reconnect_notify.notify_one();
    }

    pub(super) async fn wait_reconnect_signal(&self) {
        self.reconnect_notify.notified().await;
    }

    pub(super) fn inc_reconnects(&self) {
        self.reconnects.fetch_add(1, Ordering::SeqCst);
    }

    pub(super) fn get_reconnects(&self) -> u32 {
        self.reconnects.load(Ordering::SeqCst)
    }

    pub(super) fn inc_connections(&self) {
        self.connections.fetch_add(1, Ordering::SeqCst);
    }

    pub(super) fn dec_connections(&self) {
        self.connections.fetch_sub(1, Ordering::SeqCst);
    }

    pub(super) fn add_bytes_in(&self, n: u64) {
        self.bytes_in.fetch_add(n, Ordering::SeqCst);
    }

    pub(super) fn add_bytes_out(&self, n: u64) {
        self.bytes_out.fetch_add(n, Ordering::SeqCst);
    }

    pub(super) fn get_stats(&self) -> (u32, u64, u64) {
        (
            self.connections.load(Ordering::SeqCst),
            self.bytes_in.load(Ordering::SeqCst),
            self.bytes_out.load(Ordering::SeqCst),
        )
    }
}

/// russh 客户端 handler —— 反向隧道版：入站连接经此回调回流。
/// 持有本地目标与控制器，回调里 dial 本地服务并对拷。
/// 首版不校验 host key（与现有 ssh_tunnel 一致，作为已知限制）。
#[derive(Clone)]
pub(super) struct ReverseClient {
    pub(super) local_host: String,
    pub(super) local_port: u16,
    pub(super) controller: Arc<ReverseTunnelController>,
}

/// 监督器共享的「当前 SSH 句柄」槽；重连时整体替换。
pub(super) type ReverseSharedHandle = Arc<Mutex<Option<Arc<client::Handle<ReverseClient>>>>>;

// ============== 持久化 ==============

pub(super) async fn ensure_tunnels_loaded() {
    let mut loaded = TUNNELS_LOADED.lock().await;
    if !*loaded {
        match load_tunnels_from_file() {
            Ok(map) => {
                let mut tunnels = REVERSE_TUNNELS.lock().await;
                *tunnels = map;
                *loaded = true;
            }
            Err(e) => {
                log::warn!("加载内网穿透隧道失败，将在下次重试: {}", e);
            }
        }
    }
}

fn load_tunnels_from_file() -> AppResult<HashMap<String, ReverseTunnel>> {
    let config = storage::get_storage_config()?;
    let path = config.reverse_tunnels_file();

    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取内网穿透隧道失败: {}", e)))?;

    let arr: Vec<ReverseTunnel> = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(e) => {
            log::error!("解析内网穿透隧道 JSON 失败: {}", e);
            Vec::new()
        }
    };

    let mut map = HashMap::new();
    for mut t in arr {
        // 运行期字段加载时重置
        t.status = "stopped".to_string();
        t.connections = 0;
        t.bytes_in = 0;
        t.bytes_out = 0;
        t.last_error = None;
        t.reconnects = 0;
        map.insert(t.id.clone(), t);
    }

    log::info!("共加载 {} 个内网穿透隧道", map.len());
    Ok(map)
}

pub(super) async fn save_tunnels_to_file() -> AppResult<()> {
    let config = storage::get_storage_config()?;
    config.ensure_dirs()?;

    let tunnels = REVERSE_TUNNELS.lock().await;
    let data: Vec<&ReverseTunnel> = tunnels.values().collect();
    let content = serde_json::to_string(&data)
        .map_err(|e| crate::error::AppError::from(format!("序列化内网穿透隧道失败: {}", e)))?;

    let path = config.reverse_tunnels_file();
    crate::storage::write_atomic(&path, content)
        .map_err(|e| crate::error::AppError::from(format!("写入内网穿透隧道失败: {}", e)))?;

    Ok(())
}
