// 工具箱模块 - 包含端口扫描、文件下载、进程管理、端口转发、静态服务、Claude Code 配置功能

pub mod scanner;
pub mod downloader;
pub mod process;
pub mod forwarder;
pub mod server;
pub mod claude_code;

use serde::{Deserialize, Serialize};

// ============== 端口扫描相关结构 ==============

/// 扫描配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanConfig {
    /// 目标 IP 地址
    pub target: String,
    /// 要扫描的端口列表，为空则使用默认常用端口
    pub ports: Option<Vec<u16>>,
    /// 端口范围起始（与 port_end 配合使用）
    pub port_start: Option<u16>,
    /// 端口范围结束
    pub port_end: Option<u16>,
    /// 连接超时时间（毫秒），默认 3000
    pub timeout_ms: Option<u64>,
    /// 并发数，默认 100
    pub concurrency: Option<usize>,
}

/// 扫描结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub ip: String,
    pub port: u16,
    pub status: String, // "open", "closed", "filtered"
    pub service: Option<String>,
}

/// 扫描进度
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgress {
    pub scanned: u32,
    pub total: u32,
    pub open_ports: Vec<ScanResult>,
}

// ============== 文件下载相关结构 ==============

/// 下载任务
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadTask {
    pub id: String,
    pub url: String,
    pub save_path: String,
    pub file_name: String,
    pub total_size: u64,
    pub downloaded_size: u64,
    pub status: String, // "pending", "downloading", "paused", "completed", "failed"
    pub speed: u64,     // 字节/秒
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 下载配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadConfig {
    pub url: String,
    pub save_dir: Option<String>,
    pub file_name: Option<String>,
    pub max_retries: Option<u32>,
}

/// 下载进度
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub id: String,
    pub downloaded: u64,
    pub total: u64,
    pub speed: u64,
    pub status: String,
}

// ============== 进程管理相关结构 ==============

/// 进程信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub port: Option<u16>,
    pub protocol: Option<String>, // "tcp" or "udp"
    pub local_addr: Option<String>,
    pub remote_addr: Option<String>,
    pub status: String,
    pub memory: u64,  // 字节
    pub cpu: f32,     // 百分比
    pub working_dir: Option<String>,
    pub cmd: Option<String>,
}

/// 进程查询过滤
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessFilter {
    pub port: Option<u16>,
    pub name: Option<String>,
    pub pid: Option<u32>,
}

// ============== 端口转发相关结构 ==============

/// 转发规则
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForwardRule {
    pub id: String,
    pub name: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub status: String, // "running", "stopped"
    pub connections: u32,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub created_at: String,
}

/// 创建转发规则的输入
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForwardRuleInput {
    pub name: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
}

/// 转发统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForwardStats {
    pub rule_id: String,
    pub connections: u32,
    pub bytes_in: u64,
    pub bytes_out: u64,
}

// ============== 静态服务相关结构 ==============

/// 服务配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub id: String,
    pub name: String,
    pub port: u16,
    pub root_dir: String,
    pub cors: bool,
    pub gzip: bool,
    pub cache_control: Option<String>,
    /// 多个代理规则
    pub proxies: Vec<ProxyConfig>,
    pub status: String, // "running", "stopped"
    pub created_at: String,
}

/// 代理配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    pub prefix: String,
    pub target: String,
}

/// 创建服务的输入
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfigInput {
    pub name: String,
    pub port: u16,
    pub root_dir: String,
    pub cors: Option<bool>,
    pub gzip: Option<bool>,
    pub cache_control: Option<String>,
    /// 多个代理规则
    pub proxies: Option<Vec<ProxyConfig>>,
}

/// 服务访问日志
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessLog {
    pub timestamp: String,
    pub method: String,
    pub path: String,
    pub status: u16,
    pub duration_ms: u64,
    pub client_ip: String,
}

// ============== 常用端口定义 ==============

/// 常用端口列表
pub fn common_ports() -> Vec<u16> {
    vec![
        // Web 服务
        80, 443, 8080, 8443, 8000, 8888, 3000, 3001, 5000, 5173, 4200,
        // 数据库
        3306, 5432, 27017, 6379, 9200, 5984,
        // SSH/FTP/Telnet
        21, 22, 23, 2222,
        // 邮件
        25, 110, 143, 465, 587, 993, 995,
        // 远程桌面
        3389, 5900, 5901,
        // 消息队列
        5672, 15672, 9092, 2181,
        // 其他服务
        53, 67, 68, 69, 161, 162, 389, 636, 1433, 1521, 11211,
    ]
}

/// 端口服务名称映射
pub fn port_service_name(port: u16) -> Option<&'static str> {
    match port {
        20 => Some("FTP-Data"),
        21 => Some("FTP"),
        22 => Some("SSH"),
        23 => Some("Telnet"),
        25 => Some("SMTP"),
        53 => Some("DNS"),
        67 | 68 => Some("DHCP"),
        69 => Some("TFTP"),
        80 => Some("HTTP"),
        110 => Some("POP3"),
        119 => Some("NNTP"),
        123 => Some("NTP"),
        143 => Some("IMAP"),
        161 | 162 => Some("SNMP"),
        389 => Some("LDAP"),
        443 => Some("HTTPS"),
        445 => Some("SMB"),
        465 => Some("SMTPS"),
        514 => Some("Syslog"),
        587 => Some("SMTP-Submission"),
        636 => Some("LDAPS"),
        993 => Some("IMAPS"),
        995 => Some("POP3S"),
        1433 => Some("MSSQL"),
        1521 => Some("Oracle"),
        2181 => Some("ZooKeeper"),
        2222 => Some("SSH-Alt"),
        3000 => Some("Dev-Server"),
        3306 => Some("MySQL"),
        3389 => Some("RDP"),
        5000 => Some("Dev-Server"),
        5173 => Some("Vite"),
        5432 => Some("PostgreSQL"),
        5672 => Some("RabbitMQ"),
        5900 | 5901 => Some("VNC"),
        5984 => Some("CouchDB"),
        6379 => Some("Redis"),
        8000 => Some("Dev-Server"),
        8080 => Some("HTTP-Proxy"),
        8443 => Some("HTTPS-Alt"),
        8888 => Some("Dev-Server"),
        9092 => Some("Kafka"),
        9200 => Some("Elasticsearch"),
        11211 => Some("Memcached"),
        15672 => Some("RabbitMQ-Mgmt"),
        27017 => Some("MongoDB"),
        _ => None,
    }
}

// ============== 工具函数 ==============

/// 生成唯一 ID
pub fn generate_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{:x}", timestamp)
}

/// 获取当前时间字符串
pub fn current_time() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// 格式化字节大小
#[allow(dead_code)]
pub fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}
