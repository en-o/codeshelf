// 静态服务模块 - 本地 Web 服务器，支持 CORS、gzip、API 代理
//
// 子模块：
// - crud:    CRUD 命令（create/stop/remove/get/get_servers/update）
// - runtime: start_server 与底层 axum 运行/代理处理
// - nginx:   生成等价 nginx 配置

use super::ServerConfig;
use crate::error::AppResult;
use crate::storage;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;

mod crud;
mod nginx;
mod runtime;

pub use crud::*;
pub use nginx::*;

/// 服务配置存储 - 延迟初始化，首次访问时从文件加载
pub(super) static SERVERS: Lazy<Arc<Mutex<HashMap<String, ServerConfig>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// 是否已从文件加载
pub(super) static SERVERS_LOADED: Lazy<Arc<Mutex<bool>>> =
    Lazy::new(|| Arc::new(Mutex::new(false)));

/// 服务控制器
pub(super) static SERVER_CONTROLLERS: Lazy<Arc<Mutex<HashMap<String, Arc<ServerController>>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// 确保服务配置已从文件加载
pub(super) async fn ensure_servers_loaded() {
    let mut loaded = SERVERS_LOADED.lock().await;
    if !*loaded {
        match load_servers_from_file() {
            Ok(servers) => {
                let mut servers_map = SERVERS.lock().await;
                *servers_map = servers;
                *loaded = true; // 只有成功加载才设置为 true
            }
            Err(e) => {
                log::warn!("加载服务配置失败，将在下次重试: {}", e);
                // 不设置 loaded = true，允许下次重试
            }
        }
    }
}

/// 从文件加载服务配置
fn load_servers_from_file() -> AppResult<HashMap<String, ServerConfig>> {
    let config = storage::get_storage_config()?;
    let path = config.server_configs_file();

    log::info!("加载服务配置: {:?}", path);

    if !path.exists() {
        log::info!("服务配置文件不存在，返回空列表");
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取服务配置失败: {}", e)))?;

    // 直接解析为服务配置数组
    let servers_arr: Vec<ServerConfig> = match serde_json::from_str(&content) {
        Ok(arr) => arr,
        Err(e) => {
            log::error!(
                "解析服务配置 JSON 失败: {}，内容: {}",
                e,
                &content[..content.len().min(200)]
            );
            Vec::new()
        }
    };

    let mut servers = HashMap::new();
    for mut server in servers_arr {
        // 重启后默认停止
        server.status = "stopped".to_string();
        log::info!("加载服务: {} (端口 {})", server.name, server.port);
        servers.insert(server.id.clone(), server);
    }

    log::info!("共加载 {} 个服务配置", servers.len());
    Ok(servers)
}

/// 保存服务配置到文件
pub(super) async fn save_servers_to_file() -> AppResult<()> {
    let config = storage::get_storage_config()?;

    // 确保数据目录存在
    config.ensure_dirs()?;

    let servers = SERVERS.lock().await;

    // 直接序列化（serde 会自动用 camelCase）
    let servers_data: Vec<&ServerConfig> = servers.values().collect();

    let content = serde_json::to_string(&servers_data)
        .map_err(|e| crate::error::AppError::from(format!("序列化服务配置失败: {}", e)))?;

    let path = config.server_configs_file();
    log::info!("保存服务配置到: {:?}", path);

    crate::storage::write_atomic(&path, content)
        .map_err(|e| crate::error::AppError::from(format!("写入服务配置失败: {}", e)))?;

    log::info!("服务配置保存成功，共 {} 个服务", servers.len());
    Ok(())
}

/// 服务控制器
pub(super) struct ServerController {
    stop: AtomicBool,
}

impl ServerController {
    pub(super) fn new() -> Self {
        Self {
            stop: AtomicBool::new(false),
        }
    }

    pub(super) fn is_stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }

    pub(super) fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}
