// Netcat 工具类型定义

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};

/// 协议类型
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Tcp,
    Udp,
}

/// 会话模式
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionMode {
    Client,
    Server,
}

/// 数据格式
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DataFormat {
    Text,
    Hex,
    Base64,
}

/// 会话状态
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Connecting,
    Connected,
    Listening,
    Disconnected,
    Error,
}

/// 自动发送模式
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AutoSendMode {
    Fixed,
    Csv,
    Template,
    Http,
}

impl Default for AutoSendMode {
    fn default() -> Self {
        Self::Fixed
    }
}

/// 自动发送配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoSendConfig {
    /// 是否启用
    #[serde(default)]
    pub enabled: bool,
    /// 发送间隔（毫秒）
    #[serde(default = "default_interval")]
    pub interval_ms: u64,
    /// 发送模式
    #[serde(default)]
    pub mode: AutoSendMode,
    /// 固定内容
    #[serde(default)]
    pub fixed_data: String,
    /// CSV/多行数据
    #[serde(default)]
    pub csv_data: String,
    /// 模板内容
    #[serde(default)]
    pub template: String,
    /// HTTP URL
    #[serde(default)]
    pub http_url: String,
    /// HTTP JSON 路径（用于提取 JSON 响应中的特定字段）
    #[serde(default)]
    pub http_json_path: String,
}

fn default_interval() -> u64 {
    1000
}

impl Default for AutoSendConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_ms: 1000,
            mode: AutoSendMode::Fixed,
            fixed_data: String::new(),
            csv_data: String::new(),
            template: String::new(),
            http_url: String::new(),
            http_json_path: String::new(),
        }
    }
}

/// 创建会话的输入参数
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetcatSessionInput {
    pub protocol: Protocol,
    pub mode: SessionMode,
    pub host: String,
    pub port: u16,
    pub name: Option<String>,
    pub auto_reconnect: Option<bool>,
    pub timeout_ms: Option<u64>,
}

/// 会话配置（持久化存储）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetcatSessionConfig {
    pub id: String,
    pub name: String,
    pub protocol: Protocol,
    pub mode: SessionMode,
    pub host: String,
    pub port: u16,
    pub auto_reconnect: bool,
    pub timeout_ms: u64,
    pub created_at: u64,
    /// 自动发送配置
    #[serde(default)]
    pub auto_send: AutoSendConfig,
}

/// 会话配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetcatSession {
    pub id: String,
    pub name: String,
    pub protocol: Protocol,
    pub mode: SessionMode,
    pub host: String,
    pub port: u16,
    pub status: SessionStatus,
    pub auto_reconnect: bool,
    pub timeout_ms: u64,
    pub created_at: u64,
    pub connected_at: Option<u64>,
    pub last_activity: Option<u64>,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub message_count: u64,
    pub error_message: Option<String>,
    /// 连接的客户端数量（仅服务器模式）
    pub client_count: u32,
    /// 自动发送配置
    #[serde(default)]
    pub auto_send: AutoSendConfig,
}

/// 发送消息的输入
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageInput {
    pub session_id: String,
    pub data: String,
    pub format: DataFormat,
    /// 目标客户端ID（仅服务器模式，可选）
    pub target_client: Option<String>,
    /// 是否广播给所有客户端（仅服务器模式）
    pub broadcast: Option<bool>,
}

/// 消息记录
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetcatMessage {
    pub id: String,
    pub session_id: String,
    pub direction: MessageDirection,
    pub data: String,
    pub format: DataFormat,
    pub size: usize,
    pub timestamp: u64,
    /// 来源/目标客户端（服务器模式）
    pub client_id: Option<String>,
    pub client_addr: Option<String>,
}

/// 消息方向
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MessageDirection {
    Sent,
    Received,
}

/// 连接的客户端信息（服务器模式）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedClient {
    pub id: String,
    pub addr: String,
    pub connected_at: u64,
    pub last_activity: u64,
    pub bytes_sent: u64,
    pub bytes_received: u64,
}

/// 会话事件（用于前端实时更新）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "type")]
pub enum NetcatEvent {
    #[serde(rename = "statusChanged")]
    StatusChanged {
        session_id: String,
        status: SessionStatus,
        error: Option<String>,
    },
    #[serde(rename = "messageReceived")]
    MessageReceived {
        session_id: String,
        message: NetcatMessage,
    },
    #[serde(rename = "clientConnected")]
    ClientConnected {
        session_id: String,
        client: ConnectedClient,
    },
    #[serde(rename = "clientDisconnected")]
    ClientDisconnected {
        session_id: String,
        client_id: String,
    },
}

/// 内部会话状态
pub struct SessionState {
    pub session: NetcatSession,
    pub messages: Vec<NetcatMessage>,
    pub clients: HashMap<String, ConnectedClient>,
    pub shutdown_tx: Option<mpsc::Sender<()>>,
}

impl SessionState {
    pub fn new(session: NetcatSession) -> Self {
        Self {
            session,
            messages: Vec::new(),
            clients: HashMap::new(),
            shutdown_tx: None,
        }
    }
}

/// 全局会话管理器
pub type SessionManager = Arc<RwLock<HashMap<String, Arc<RwLock<SessionState>>>>>;

/// 创建新的会话管理器
pub fn create_session_manager() -> SessionManager {
    Arc::new(RwLock::new(HashMap::new()))
}
