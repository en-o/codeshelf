// 全局状态：peer 列表 + 文件中继缓存
//
// peer 列表只保留内存，不落盘——刷新页面就重新分配 peerId / 显示名。
// 文件中继也只在内存里缓存原始 bytes，附带 5 分钟 TTL，配合 download_once 一次性消费。

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{mpsc, Mutex};

/// 端口默认值。固定端口让 QR / URL 在重启后保持不变，方便手机收藏。
/// 选 8421 是因为它在 1024-49151 的「注册端口」段，避开了 Windows 动态端口段（49152+），
/// 那个段经常被 Hyper-V/WSL 静默保留导致 bind 报 10013/PermissionDenied。
/// 若仍冲突,pairdrop_start 会自动退回到 OS 随机端口。
pub const DEFAULT_PORT: u16 = 8421;

/// 文件中继缓存的 TTL（秒）
pub const FILE_TTL_SECS: u64 = 300; // 5 分钟

/// 单文件最大大小（字节）。默认 2GB，足以覆盖常见场景。
pub const MAX_FILE_SIZE: usize = 2 * 1024 * 1024 * 1024;

/// 单个 peer 的信息
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    pub peer_id: String,
    pub display_name: String,
    pub device_type: String, // "desktop" | "mobile" | "browser"
    pub user_agent: String,
    /// 是否是当前桌面客户端自身
    pub is_self: bool,
}

/// 服务运行状态
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub running: bool,
    pub port: u16,
    pub urls: Vec<NetworkUrl>,
    pub peer_count: usize,
}

/// 网卡 URL 信息（用于多网卡环境下生成多个 QR）
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NetworkUrl {
    pub interface: String,
    pub ip: String,
    pub url: String,
}

/// 局域网中主动发现到的其它桌面端服务
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredDevice {
    pub device_id: String,
    pub display_name: String,
    pub host: String,
    pub port: u16,
    pub url: String,
    pub last_seen_at: i64,
}

/// 客户端 → 服务器消息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ClientMessage {
    /// 自定义显示名
    #[serde(rename_all = "camelCase")]
    SetName { name: String },
    /// 发送文本消息给目标 peer
    #[serde(rename_all = "camelCase")]
    SendText { to: String, text: String },
    /// 通知目标 peer 有文件可下载
    #[serde(rename_all = "camelCase")]
    NotifyFile {
        to: String,
        token: String,
        name: String,
        size: u64,
        mime: Option<String>,
    },
    /// 心跳
    Ping,
}

/// 服务器 → 客户端消息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ServerMessage {
    /// 连接建立后下发的自身信息
    #[serde(rename_all = "camelCase")]
    Welcome {
        peer_id: String,
        display_name: String,
    },
    /// 完整 peer 列表
    Peers { peers: Vec<PeerInfo> },
    /// 收到一条文本消息
    #[serde(rename_all = "camelCase")]
    Text {
        from: String,
        from_name: String,
        text: String,
        ts: i64,
    },
    /// 收到一份文件通知（包含下载 token）
    #[serde(rename_all = "camelCase")]
    File {
        from: String,
        from_name: String,
        token: String,
        name: String,
        size: u64,
        mime: Option<String>,
        ts: i64,
    },
    /// 心跳响应
    Pong,
    /// 错误
    Error { message: String },
}

/// 单个连接的发送通道
pub type PeerSender = mpsc::UnboundedSender<ServerMessage>;

/// 服务器全局状态
pub struct AppState {
    /// 所有在线 peer
    pub peers: Mutex<HashMap<String, PeerEntry>>,
    /// 局域网中发现到的其它桌面端
    pub discovered: Mutex<HashMap<String, DiscoveredDevice>>,
    /// 文件中继缓存
    pub files: Mutex<HashMap<String, CachedFile>>,
    /// 服务停止信号
    pub stop_signal: Arc<tokio::sync::Notify>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            peers: Mutex::new(HashMap::new()),
            discovered: Mutex::new(HashMap::new()),
            files: Mutex::new(HashMap::new()),
            stop_signal: Arc::new(tokio::sync::Notify::new()),
        }
    }
}

/// peer 条目
pub struct PeerEntry {
    pub info: PeerInfo,
    pub sender: PeerSender,
}

/// 文件缓存条目
#[allow(dead_code)]
pub struct CachedFile {
    pub name: String,
    pub mime: Option<String>,
    pub bytes: Vec<u8>,
    /// 接收方 peer id（用于校验，可选）
    pub to: Option<String>,
    /// 发送方 peer id
    pub from: Option<String>,
    /// 创建时间，用于 TTL 过期
    pub created_at: Instant,
}

impl CachedFile {
    pub fn is_expired(&self) -> bool {
        self.created_at.elapsed() > Duration::from_secs(FILE_TTL_SECS)
    }
}

/// 当前运行的服务实例（None 表示未启动）
pub static SERVICE: Lazy<Arc<Mutex<Option<RunningService>>>> =
    Lazy::new(|| Arc::new(Mutex::new(None)));

#[allow(dead_code)]
pub struct RunningService {
    pub port: u16,
    pub state: Arc<AppState>,
    /// 用于通知服务停止
    pub stop_signal: Arc<tokio::sync::Notify>,
    /// 服务监听任务的 handle
    pub task: tokio::task::JoinHandle<()>,
}

/// 当前桌面端服务的稳定 ID（进程内稳定，前端仍用 localStorage 维护客户端 ID）
pub static DESKTOP_DEVICE_ID: Lazy<String> = Lazy::new(|| {
    let seed = format!(
        "{}-{}-{}",
        std::env::var("USER")
            .or_else(|_| std::env::var("USERNAME"))
            .unwrap_or_else(|_| "user".to_string()),
        std::env::var("HOSTNAME")
            .or_else(|_| std::env::var("COMPUTERNAME"))
            .unwrap_or_else(|_| "host".to_string()),
        std::env::current_dir()
            .ok()
            .and_then(|p| p.to_str().map(|s| s.to_string()))
            .unwrap_or_else(|| "codeshelf".to_string())
    );
    let mut h: u64 = 1469598103934665603;
    for b in seed.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    format!("cs-{:016x}", h)
});

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// 生成随机 peer ID
pub fn generate_peer_id() -> String {
    let ns = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before UNIX epoch")
        .as_nanos();
    // 后缀随机化一下，避免同毫秒冲突
    let suffix: u16 = (ns as u16) ^ ((ns >> 16) as u16);
    format!("{:x}{:04x}", ns, suffix)
}

/// 基于 IP 生成 4 位十六进制短码，用作默认设备名后缀（如 `Mac #3f2a`）。
/// 同一台设备（同 LAN IP）每次连接得到相同后缀、身份稳定；不同设备基本不撞。
/// 比 ` (2)` 这种序号更能区分"谁是谁"。
pub fn short_ip_hash(ip: &std::net::IpAddr) -> String {
    // FNV-1a，取低 16 位
    let s = ip.to_string();
    let mut h: u32 = 2166136261;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(16777619);
    }
    format!("{:04x}", (h ^ (h >> 16)) & 0xffff)
}

/// 让显示名在同一频道内唯一：若 `desired` 已被占用则追加 ` (2)`、` (3)` …
///
/// `taken` 是当前频道内其它 peer 已使用的显示名集合（去重时应排除自己）。
pub fn dedup_name(desired: &str, taken: &HashSet<String>) -> String {
    if !taken.contains(desired) {
        return desired.to_string();
    }
    let mut n = 2;
    loop {
        let candidate = format!("{} ({})", desired, n);
        if !taken.contains(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// 生成一个友好的设备名（从 UA / OS 推断）。
///
/// 只返回干净的基名（如 `Mac` / `iPhone`），不带区分后缀——同名去重交给
/// [`dedup_name`] 在注册时按频道现状追加 ` (2)`，避免同型号设备名字一模一样。
pub fn guess_display_name(user_agent: &str) -> (String, String) {
    let ua = user_agent.to_lowercase();
    // 设备类型
    let device_type = if ua.contains("mobile")
        || ua.contains("android")
        || ua.contains("iphone")
        || ua.contains("ipad")
    {
        "mobile"
    } else if ua.contains("codeshelf-tauri-webview") || ua.contains("tauri") {
        "desktop"
    } else {
        "browser"
    };

    // 名称从 UA 中提取关键字
    let name = if ua.contains("iphone") {
        "iPhone"
    } else if ua.contains("ipad") {
        "iPad"
    } else if ua.contains("android") {
        if ua.contains("mobile") {
            "Android Phone"
        } else {
            "Android"
        }
    } else if ua.contains("macintosh") || ua.contains("mac os") {
        "Mac"
    } else if ua.contains("windows") {
        "Windows"
    } else if ua.contains("linux") {
        "Linux"
    } else {
        "Device"
    };

    (name.to_string(), device_type.to_string())
}

/// 列出本机所有非回环 IPv4 地址
pub fn list_local_ipv4() -> Vec<(String, String)> {
    // 网卡列表不会频繁变化，缓存 30 秒避免反复调用 PowerShell（PS 启动 ~200ms）
    use std::sync::Mutex;
    static CACHE: Lazy<Mutex<Option<(Instant, Vec<(String, String)>)>>> =
        Lazy::new(|| Mutex::new(None));

    {
        let guard = CACHE.lock().unwrap();
        if let Some((ts, ref data)) = *guard {
            if ts.elapsed() < Duration::from_secs(30) {
                return data.clone();
            }
        }
    }

    let result = collect_local_ipv4();
    let mut guard = CACHE.lock().unwrap();
    *guard = Some((Instant::now(), result.clone()));
    result
}

fn collect_local_ipv4() -> Vec<(String, String)> {
    let mut result = Vec::new();
    use std::process::Command;

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // 隐藏控制台窗口，避免打包后扫描本机 IP（PowerShell / ipconfig）时闪黑窗
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // Windows ipconfig 输出是 OEM codepage（中文系统是 CP936/GBK），
        // 直接 String::from_utf8_lossy 会把中文网卡名变成 ���。
        // 用 PowerShell 拿结构化 UTF-8 JSON，避免编码问题。
        let ps_script = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
            try { \
                $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | \
                    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | \
                    Select-Object @{N='Interface';E={$_.InterfaceAlias}}, @{N='IP';E={$_.IPAddress}}; \
                if ($ips -is [array]) { ConvertTo-Json -InputObject $ips -Compress } \
                else { ConvertTo-Json -InputObject @($ips) -Compress } \
            } catch { Write-Output '[]' }";

        if let Ok(out) = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", ps_script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            if out.status.success() {
                if let Ok(text) = std::str::from_utf8(&out.stdout) {
                    let trimmed = text.trim();
                    let entries: Vec<serde_json::Value> = if trimmed.starts_with('[') {
                        serde_json::from_str(trimmed).unwrap_or_default()
                    } else if trimmed.starts_with('{') {
                        serde_json::from_str::<serde_json::Value>(trimmed)
                            .map(|v| vec![v])
                            .unwrap_or_default()
                    } else {
                        vec![]
                    };
                    for entry in entries {
                        if let (Some(iface), Some(ip)) = (
                            entry.get("Interface").and_then(|v| v.as_str()),
                            entry.get("IP").and_then(|v| v.as_str()),
                        ) {
                            result.push((iface.to_string(), ip.to_string()));
                        }
                    }
                }
            }
        }

        // PowerShell 失败时退化到 ipconfig（接受可能的乱码）
        if result.is_empty() {
            if let Ok(out) = Command::new("ipconfig")
                .creation_flags(CREATE_NO_WINDOW)
                .output()
            {
                let text = String::from_utf8_lossy(&out.stdout);
                let mut current_adapter = String::from("default");
                for line in text.lines() {
                    let trimmed = line.trim();
                    if trimmed.ends_with(':')
                        && !trimmed.contains("IPv")
                        && !trimmed.starts_with('.')
                    {
                        current_adapter = trimmed.trim_end_matches(':').to_string();
                    }
                    if let Some(rest) = trimmed.strip_prefix("IPv4") {
                        if let Some(eq) = rest.find(':') {
                            let ip = rest[eq + 1..].trim().trim_end_matches('.').to_string();
                            if !ip.is_empty() && !ip.starts_with("127.") {
                                result.push((current_adapter.clone(), ip));
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let try_cmd = |program: &str, args: &[&str]| -> Option<String> {
            Command::new(program)
                .args(args)
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        };

        if let Some(text) = try_cmd("ip", &["-4", "addr"]) {
            let mut current_adapter = String::from("default");
            for line in text.lines() {
                let line = line.trim();
                if let Some(colon) = line.find(':') {
                    if line
                        .chars()
                        .next()
                        .map(|c| c.is_ascii_digit())
                        .unwrap_or(false)
                    {
                        let rest = &line[colon + 1..];
                        if let Some(next) = rest.trim().split(':').next() {
                            current_adapter = next.trim().to_string();
                        }
                    }
                }
                if let Some(rest) = line.strip_prefix("inet ") {
                    if let Some(ip_part) = rest.split_whitespace().next() {
                        let ip = ip_part.split('/').next().unwrap_or("").to_string();
                        if !ip.is_empty() && !ip.starts_with("127.") {
                            result.push((current_adapter.clone(), ip));
                        }
                    }
                }
            }
        } else if let Some(text) = try_cmd("ifconfig", &[]) {
            let mut current_adapter = String::from("default");
            for line in text.lines() {
                if !line.starts_with(char::is_whitespace) {
                    if let Some(name) = line.split(':').next() {
                        current_adapter = name.trim().to_string();
                    }
                }
                let line = line.trim();
                if let Some(rest) = line.strip_prefix("inet ") {
                    if let Some(ip_part) = rest.split_whitespace().next() {
                        let ip = ip_part.trim_start_matches("addr:").to_string();
                        if !ip.is_empty() && !ip.starts_with("127.") {
                            result.push((current_adapter.clone(), ip));
                        }
                    }
                }
            }
        }
    }

    if result.is_empty() {
        result.push(("loopback".to_string(), "127.0.0.1".to_string()));
    }

    result
}
