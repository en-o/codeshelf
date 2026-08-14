// 数据结构定义 - 简洁的数据格式，无版本包装

use serde::{Deserialize, Serialize};

// ============== 项目数据 ==============

/// 项目
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_favorite: bool,
    pub tags: Vec<String>,   // 分类（单选，但保留数组兼容）
    pub labels: Vec<String>, // 标签（多选）
    pub created_at: String,
    pub updated_at: String,
    pub last_opened: Option<String>,
    #[serde(default)]
    pub editor_id: Option<String>,
    #[serde(default)]
    pub claude_env_name: Option<String>,
}

// ============== 编辑器配置数据 ==============

/// 编辑器配置
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct EditorConfig {
    pub id: String,
    pub name: String,
    pub path: String,
    pub icon: Option<String>,
    pub is_default: bool,
}

// ============== 终端配置数据 ==============

/// 终端配置
#[derive(Debug, Serialize, Deserialize, Clone, Default, specta::Type)]
pub struct TerminalConfig {
    pub terminal_type: String,
    pub custom_path: Option<String>,
    /// 遗留字段：只存"当前类型"那一条路径。保留是为了能读老配置，新写入用 `terminal_paths`。
    pub terminal_path: Option<String>,
    /// 每种终端各自的路径。
    ///
    /// 界面允许为每种终端分别设置/测试路径，但持久层原本只有上面那个单值 ——
    /// 给非当前类型配好的路径重启即丢，切离 custom 还会把 customPath 一起清掉。
    #[serde(default)]
    pub terminal_paths: std::collections::HashMap<String, String>,
}

// ============== 应用设置数据 ==============

/// 应用设置
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct AppSettings {
    pub theme: String,
    pub view_mode: String,
    pub sidebar_collapsed: bool,
    pub scan_depth: u32,
    #[serde(default = "default_true")]
    pub auto_update: bool,
    #[serde(default)]
    pub chat_history_dir: Option<String>,
    /// 是否启用 OpenClaw 聊天桥接（外部聊天平台通过中继 relay 入站）
    #[serde(default)]
    pub chat_bridge_enabled: bool,
    /// 中继服务 base URL，例如 https://relay.example.com
    #[serde(default)]
    pub openclaw_relay_endpoint: Option<String>,
    /// 桥接时用于回复的 provider id（复用 ai_providers 配置）
    #[serde(default)]
    pub bridge_provider_id: Option<String>,
    /// 桥接时使用的 model id
    #[serde(default)]
    pub bridge_model_id: Option<String>,
    /// 客户端标识，默认 codeshelf-<hostname>
    #[serde(default)]
    pub bridge_client_id: Option<String>,
    /// 是否启用内置 MCP HTTP 网关
    #[serde(default)]
    pub mcp_gateway_enabled: bool,
    /// MCP HTTP 网关监听地址
    #[serde(default = "default_mcp_gateway_host")]
    pub mcp_gateway_host: String,
    /// MCP HTTP 网关监听端口
    #[serde(default = "default_mcp_gateway_port")]
    pub mcp_gateway_port: u16,
    /// MCP Gateway 客户端访问密钥
    #[serde(default)]
    pub mcp_gateway_keys: Vec<McpGatewayKey>,
    /// macOS：是否在 Dock 显示应用图标（false=纯菜单栏应用，true=Dock + 菜单栏）
    #[serde(default)]
    pub show_dock_icon: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct McpGatewayKey {
    pub id: String,
    pub name: String,
    pub key: String,
    #[serde(default)]
    pub enabled: bool,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

fn default_true() -> bool {
    true
}

fn default_mcp_gateway_host() -> String {
    "127.0.0.1".to_string()
}

fn default_mcp_gateway_port() -> u16 {
    8787
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "light".to_string(),
            view_mode: "grid".to_string(),
            sidebar_collapsed: false,
            scan_depth: 3,
            auto_update: true,
            chat_history_dir: None,
            chat_bridge_enabled: false,
            openclaw_relay_endpoint: None,
            bridge_provider_id: None,
            bridge_model_id: None,
            bridge_client_id: None,
            mcp_gateway_enabled: false,
            mcp_gateway_host: default_mcp_gateway_host(),
            mcp_gateway_port: default_mcp_gateway_port(),
            mcp_gateway_keys: Vec::new(),
            show_dock_icon: false,
        }
    }
}

// ============== UI 状态数据 ==============

/// UI 状态
#[derive(Debug, Serialize, Deserialize, Clone, Default, specta::Type)]
pub struct UiState {
    pub recent_detail_project_ids: Vec<String>,
}

// ============== 通知数据 ==============

/// 单条通知
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct Notification {
    pub id: String,
    pub notification_type: String,
    pub title: String,
    #[serde(default)]
    pub message: String,
    pub created_at: String,
}

// ============== Claude 快捷配置数据 ==============

/// Claude 快捷配置选项
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeQuickConfig {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub config_key: String,
    pub value_type: String,
    pub default_value: serde_json::Value,
    pub options: Option<Vec<ClaudeConfigSelectOption>>,
    pub placeholder: Option<String>,
    pub allow_empty: Option<bool>,
}

/// 配置选项
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct ClaudeConfigSelectOption {
    pub label: String,
    pub value: serde_json::Value,
}

// ============== Claude 安装信息缓存数据 ==============

/// Claude Code 安装信息
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeInstallation {
    pub env_type: String,
    pub env_name: String,
    pub version: Option<String>,
    pub path: Option<String>,
    pub config_dir: String,
    pub config_files: Vec<ConfigFileInfo>,
}

/// 配置文件信息
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct ConfigFileInfo {
    pub name: String,
    pub path: String,
    pub exists: bool,
}

// ============== AI 供应商配置数据 ==============

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiModelConfig {
    pub id: String,
    pub model: String,
    pub enabled: bool,
    pub is_default: bool,
    pub thinking: bool,
    #[serde(default = "default_true")]
    pub stream: bool,
    #[serde(default)]
    pub vision: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderConfig {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub preset_key: Option<String>,
    pub base_url: String,
    pub api_key: Option<String>,
    pub enabled: bool,
    pub is_default_provider: bool,
    pub models: Vec<AiModelConfig>,
}

// ============== 对话会话数据 ==============

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
    pub tokens: Option<u32>,
    pub thinking: Option<bool>,
    pub thinking_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edited: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_status: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_method: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_elapsed_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_body_bytes: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_truncated: Option<bool>,
    /// 接口对话内联可重试错误气泡标记（assistant 角色 + error=true）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<bool>,
    /// 工具调用进行中占位（"调用中…"）；执行完成后清除并回填结果
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_pending: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachments: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub provider_id: String,
    pub model_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frequency_penalty: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presence_penalty: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    /// 会话级"始终允许"的工具名列表（用户在授权弹窗勾"始终允许"后写入）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<Vec<String>>,
    /// 会话启用的工具集合；缺省使用全局默认
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled_tools: Option<Vec<String>>,
    /// 工具（Read/Write/Bash 等）允许操作的根目录；缺省则禁止写入/执行类工具
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_cwd: Option<String>,
    /// 是否在本会话里启用 MCP gateway 工具（从已注册的接口里取）。缺省 true。
    /// 仅当 MCP gateway 已启动时实际生效。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_mcp_gateway_tools: Option<bool>,
    /// 当前生效的上下文压缩版本号（如 "v2"）。None 表示从未压缩
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_compaction_version: Option<String>,
    /// 对话引擎："builtin"（默认，内置 agent 循环）或 "dsh"（DeepSeek Harness 子进程）。
    /// None = builtin，老会话不受影响。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
}

// ============== 上下文压缩 ==============

/// 单次压缩的元数据；正文 markdown 单独存放在 <sessionId>/compactions/<version>.md
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CompactionMeta {
    /// 版本号，如 "v1"、"v2"
    pub version: String,
    pub created_at: String,
    /// 压缩时摘要覆盖的原始消息条数（即被压缩的早期消息条数）
    pub source_message_count: usize,
    /// 压缩时保留的尾部条数
    pub tail_kept: usize,
    /// 摘要字符数
    pub char_count: usize,
    /// 生成摘要使用的模型（可选，便于排查）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

/// 压缩目录的索引文件 <sessionId>/compactions/index.json
#[derive(Debug, Serialize, Deserialize, Clone, Default, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CompactionIndex {
    /// 当前生效版本号；None 表示无版本（不会出现在已写过的索引里）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
    pub versions: Vec<CompactionMeta>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionSummary {
    pub id: String,
    pub title: String,
    pub provider_id: String,
    pub model_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
}

/// 获取当前 ISO 时间字符串
pub fn current_iso_time() -> String {
    chrono::Utc::now().to_rfc3339()
}

// ============== 剪贴板历史数据 ==============

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardEntry {
    pub id: String,
    pub content: String,
    pub content_preview: String,
    pub timestamp: i64,
    pub pinned: bool,
    pub char_count: usize,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardSettings {
    pub enabled: bool,
    pub max_items: u32,
    pub monitor_interval_ms: u64,
}

impl Default for ClipboardSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            max_items: 50,
            monitor_interval_ms: 800,
        }
    }
}

/// 生成唯一 ID
pub fn generate_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before UNIX epoch")
        .as_nanos();
    format!("{:x}", timestamp)
}

// ============== API 对话（ApiChat）数据 ==============

/// Session 鉴权中 token 如何注入后续请求
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SessionInject {
    /// 完全依赖 reqwest 的 cookie_store
    Cookie,
    /// 从登录响应 JSON 抽 token，按 format 注入到指定 header
    Header {
        name: String,
        /// 例如 "Bearer {token}"
        format: String,
    },
}

/// API 鉴权配置
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
#[derive(Default)]
pub enum ApiAuthConfig {
    #[default]
    None,
    Bearer {
        token: String,
    },
    Basic {
        username: String,
        password: String,
    },
    ApiKey {
        header: String,
        value: String,
    },
    Session {
        /// 可为相对路径（拼 group.baseUrl）或绝对 URL
        login_url: String,
        /// 通常 "POST"
        login_method: String,
        /// 登录 body，用户自定义 JSON 字符串
        credentials_json: String,
        /// 从登录响应提取 token 的 JSON path，如 "data.token"；为空依赖 Cookie
        token_json_path: Option<String>,
        inject_as: SessionInject,
    },
}


/// 接口分组（同一项目共享鉴权）
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApiGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub base_url: String,
    pub auth: ApiAuthConfig,
    pub created_at: String,
    pub updated_at: String,
}

/// 单个 API 接口
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApiEndpoint {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// None 表示独立接口（不属于任何组）
    #[serde(default)]
    pub group_id: Option<String>,
    /// GET / POST / PUT / PATCH / DELETE
    pub method: String,
    /// 可含 {path_param}；或绝对 URL（此时忽略组 baseUrl）
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    /// 覆盖组鉴权
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_override: Option<ApiAuthConfig>,
    /// 喂给 LLM function-calling 的 JSON Schema
    pub params_schema: serde_json::Value,
    /// 响应截断字节数（默认 8192）
    #[serde(default)]
    pub response_trim_bytes: Option<u32>,
    /// 单接口请求超时（毫秒），缺省 30000
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u32>,
    pub created_at: String,
    pub updated_at: String,
}

/// API 对话会话（与 ChatSession 字段大致对齐，额外携带绑定的接口集合）
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApiChatSession {
    pub id: String,
    pub title: String,
    pub provider_id: String,
    pub model_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub selected_endpoint_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frequency_penalty: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presence_penalty: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApiChatSessionSummary {
    pub id: String,
    pub title: String,
    pub provider_id: String,
    pub model_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: usize,
    pub endpoint_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
}
