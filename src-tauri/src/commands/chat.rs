use crate::error::AppResult;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use futures::StreamExt;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sqlx::Acquire;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;

use crate::storage::db::pool;
use crate::storage::{
    current_iso_time, generate_id, get_storage_config, AppSettings, ChatMessage, ChatSession,
    ChatSessionSummary, CompactionIndex, CompactionMeta,
};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamRequest {
    pub request_id: String,
    pub provider_id: String,
    pub model: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub thinking: Option<bool>,
    pub stream: Option<bool>,
    pub messages: Vec<ChatStreamMessage>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub top_p: Option<f32>,
    pub frequency_penalty: Option<f32>,
    pub presence_penalty: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<serde_json::Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<serde_json::Value>,
    /// 供应商协议。缺省（None）走 OpenAI 兼容格式；"anthropic" 走 Claude 原生
    /// `/v1/messages`（见 chat_anthropic.rs）。前端按供应商预设决定。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ChatStreamMessage {
    pub role: String,
    /// string 或 OpenAI 多模态内容数组
    pub content: serde_json::Value,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "thinkingContent",
        alias = "reasoningContent"
    )]
    pub reasoning_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "toolCalls")]
    pub tool_calls: Option<Vec<serde_json::Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "toolCallId")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallDelta {
    pub index: u32,
    pub id: Option<String>,
    pub name: Option<String>,
    pub arguments_delta: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamEvent {
    pub request_id: String,
    pub delta: Option<String>,
    pub done: bool,
    pub error: Option<String>,
    pub thinking_delta: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_delta: Option<ToolCallDelta>,
    /// 某一轮完成时携带的 finish_reason（"stop" / "tool_calls" 等）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
    /// 本轮 token 用量（若供应商返回 usage）；通常随 done 事件带出
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
}

impl ChatStreamEvent {
    /// `pub(crate)`：Anthropic 适配（chat_anthropic.rs）要往同一个事件通道发同样的事件
    pub(crate) fn new(request_id: &str) -> Self {
        Self {
            request_id: request_id.to_string(),
            delta: None,
            done: false,
            error: None,
            thinking_delta: None,
            tool_call_delta: None,
            finish_reason: None,
            usage: None,
        }
    }
}

static CHAT_ABORTS: Lazy<Arc<RwLock<HashMap<String, tokio::task::AbortHandle>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

/// 复用的 HTTP 客户端：设连接超时 + TCP keepalive；
/// 流式请求不设整体超时（长连接），仅靠 connect_timeout 守护拨号阶段。
static HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .tcp_keepalive(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});

// ============== 物理目录（仅 tasks.json 还在用） ==============
//
// 注意：chat sessions / messages / compactions 全部走 SQLite。
// 这个目录现在只用于存 <session_id>.tasks.json（commands/tools/tasks.rs）。
// chat_history_dir 设置以后仅影响 task 文件位置，不再影响 chat 主数据。

fn get_default_chat_dir() -> AppResult<PathBuf> {
    let config = get_storage_config()?;
    Ok(config.conversations_dir())
}

fn get_app_settings() -> AppResult<AppSettings> {
    let config = get_storage_config()?;
    let path = config.app_settings_file();
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取应用设置失败: {}", e)))?;
    let settings: AppSettings = crate::storage::parse_json_or_backup(&path, &content);
    Ok(settings)
}

fn resolve_chat_history_dir() -> AppResult<PathBuf> {
    let settings = get_app_settings()?;
    if let Some(dir) = settings.chat_history_dir {
        if dir.trim().is_empty() {
            return get_default_chat_dir();
        }
        return Ok(PathBuf::from(dir));
    }
    get_default_chat_dir()
}

/// 供 tools 模块访问（task 文件路径解析）
pub fn resolve_chat_history_dir_pub() -> AppResult<PathBuf> {
    resolve_chat_history_dir()
}

#[tauri::command]
#[specta::specta]
pub async fn get_chat_history_dir() -> AppResult<String> {
    let dir = resolve_chat_history_dir()?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn migrate_chat_history_dir(new_dir: String) -> AppResult<String> {
    // 注意：迁移到 SQLite 后，这个命令只影响 <session_id>.tasks.json 类的物理文件。
    // chat sessions / messages / compactions 都在主 data_dir/codeshelf.db 里，不受影响。
    let new_path = PathBuf::from(new_dir);
    if !new_path.exists() {
        if let Some(parent) = new_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| crate::error::AppError::from(format!("创建目标目录失败: {}", e)))?;
        }
    } else {
        let is_empty = fs::read_dir(&new_path)
            .map_err(|e| crate::error::AppError::from(format!("读取目标目录失败: {}", e)))?
            .next()
            .is_none();

        if !is_empty {
            return Err(crate::error::AppError::from(
                "目标目录必须为空目录".to_string(),
            ));
        }

        fs::remove_dir(&new_path)
            .map_err(|e| crate::error::AppError::from(format!("清理目标目录失败: {}", e)))?;
    }

    let old_dir = resolve_chat_history_dir()?;
    if old_dir == new_path {
        return Ok(new_path.to_string_lossy().to_string());
    }

    if !old_dir.exists() {
        return Ok(new_path.to_string_lossy().to_string());
    }

    // 迁移 tasks.json 等物理文件；旧的 chat session JSON（如果未清理）也一起搬走
    fs::rename(&old_dir, &new_path)
        .map_err(|e| crate::error::AppError::from(format!("迁移会话目录失败: {}", e)))?;

    Ok(new_path.to_string_lossy().to_string())
}

// ============== sqlite helpers ==============

#[derive(sqlx::FromRow)]
struct SessionDbRow {
    id: String,
    title: String,
    provider_id: String,
    model_id: String,
    created_at: String,
    updated_at: String,
    system_prompt: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
    top_p: Option<f64>,
    frequency_penalty: Option<f64>,
    presence_penalty: Option<f64>,
    pinned: Option<i64>,
    allowed_cwd: Option<String>,
    use_mcp_gateway_tools: Option<i64>,
    current_compaction_version: Option<String>,
    engine: Option<String>,
}

const SESSION_SELECT: &str = "SELECT id, title, provider_id, model_id, created_at, updated_at,
    system_prompt, temperature, max_tokens, top_p, frequency_penalty, presence_penalty,
    pinned, allowed_cwd, use_mcp_gateway_tools, current_compaction_version, engine FROM chat_sessions";

#[derive(sqlx::FromRow)]
struct MessageDbRow {
    id: String,
    role: String,
    content: String,
    created_at: String,
    tokens: Option<i64>,
    thinking: Option<i64>,
    thinking_content: Option<String>,
    edited: Option<i64>,
    tool_calls_json: Option<String>,
    tool_call_id: Option<String>,
    tool_name: Option<String>,
    tool_status: Option<i64>,
    tool_method: Option<String>,
    tool_url: Option<String>,
    tool_elapsed_ms: Option<i64>,
    tool_body_bytes: Option<i64>,
    tool_truncated: Option<i64>,
    attachments_json: Option<String>,
}

const MESSAGE_SELECT: &str = "SELECT id, role, content, created_at, tokens, thinking,
    thinking_content, edited, tool_calls_json, tool_call_id, tool_name, tool_status,
    tool_method, tool_url, tool_elapsed_ms, tool_body_bytes, tool_truncated, attachments_json
    FROM chat_messages";

fn parse_json_value(s: &Option<String>) -> Option<serde_json::Value> {
    s.as_ref().and_then(|raw| serde_json::from_str(raw).ok())
}

fn message_from_row(row: MessageDbRow) -> ChatMessage {
    ChatMessage {
        id: row.id,
        role: row.role,
        content: row.content,
        created_at: row.created_at,
        tokens: row.tokens.map(|x| x as u32),
        thinking: row.thinking.map(|x| x != 0),
        thinking_content: row.thinking_content,
        edited: row.edited.map(|x| x != 0),
        tool_calls: parse_json_value(&row.tool_calls_json),
        tool_call_id: row.tool_call_id,
        tool_name: row.tool_name,
        tool_status: row.tool_status.map(|x| x as u16),
        tool_method: row.tool_method,
        tool_url: row.tool_url,
        tool_elapsed_ms: row.tool_elapsed_ms.map(|x| x as u64),
        tool_body_bytes: row.tool_body_bytes.map(|x| x as usize),
        tool_truncated: row.tool_truncated.map(|x| x != 0),
        // error / tool_pending 仅用于接口对话（ApiChat，JSON 持久化），SQLite 会话不落这两列
        error: None,
        tool_pending: None,
        attachments: parse_json_value(&row.attachments_json),
    }
}

fn session_from_row(row: SessionDbRow) -> ChatSession {
    ChatSession {
        id: row.id,
        title: row.title,
        provider_id: row.provider_id,
        model_id: row.model_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        messages: Vec::new(),
        system_prompt: row.system_prompt,
        temperature: row.temperature.map(|x| x as f32),
        max_tokens: row.max_tokens.map(|x| x as u32),
        top_p: row.top_p.map(|x| x as f32),
        frequency_penalty: row.frequency_penalty.map(|x| x as f32),
        presence_penalty: row.presence_penalty.map(|x| x as f32),
        pinned: row.pinned.map(|x| x != 0),
        allowed_tools: None,
        enabled_tools: None,
        allowed_cwd: row.allowed_cwd,
        use_mcp_gateway_tools: row.use_mcp_gateway_tools.map(|x| x != 0),
        current_compaction_version: row.current_compaction_version,
        engine: row.engine,
    }
}

async fn read_session_messages(session_id: &str) -> AppResult<Vec<ChatMessage>> {
    let rows: Vec<MessageDbRow> = sqlx::query_as(&format!(
        "{} WHERE session_id = ? ORDER BY sort_order ASC",
        MESSAGE_SELECT
    ))
    .bind(session_id)
    .fetch_all(pool())
    .await
    .map_err(|e| crate::error::AppError::from(format!("查询消息失败: {}", e)))?;
    Ok(rows.into_iter().map(message_from_row).collect())
}

async fn read_session_tools(session_id: &str) -> AppResult<(Vec<String>, Vec<String>)> {
    let rows: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT tool_name, is_allowed, is_enabled FROM chat_session_tools WHERE session_id = ?",
    )
    .bind(session_id)
    .fetch_all(pool())
    .await
    .map_err(|e| crate::error::AppError::from(format!("查询工具失败: {}", e)))?;

    let mut allowed = Vec::new();
    let mut enabled = Vec::new();
    for (name, is_allowed, is_enabled) in rows {
        if is_allowed != 0 {
            allowed.push(name.clone());
        }
        if is_enabled != 0 {
            enabled.push(name);
        }
    }
    Ok((allowed, enabled))
}

async fn read_session_full(session_id: &str) -> AppResult<Option<ChatSession>> {
    let row: Option<SessionDbRow> = sqlx::query_as(&format!("{} WHERE id = ?", SESSION_SELECT))
        .bind(session_id)
        .fetch_optional(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("查询会话失败: {}", e)))?;

    let Some(row) = row else {
        return Ok(None);
    };

    let mut session = session_from_row(row);
    session.messages = read_session_messages(session_id).await?;
    let (allowed, enabled) = read_session_tools(session_id).await?;
    session.allowed_tools = if allowed.is_empty() {
        None
    } else {
        Some(allowed)
    };
    session.enabled_tools = if enabled.is_empty() {
        None
    } else {
        Some(enabled)
    };
    Ok(Some(session))
}

/// 全量保存 session：upsert sessions 表 + 清空并重插 messages / tools。
async fn write_session_full(session: &ChatSession) -> AppResult<()> {
    let pool = pool();
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| crate::error::AppError::from(format!("获取连接失败: {}", e)))?;
    let mut tx = conn
        .begin()
        .await
        .map_err(|e| crate::error::AppError::from(format!("开启事务失败: {}", e)))?;

    sqlx::query(
        "INSERT INTO chat_sessions (
            id, title, provider_id, model_id, created_at, updated_at,
            system_prompt, temperature, max_tokens, top_p, frequency_penalty,
            presence_penalty, pinned, allowed_cwd, use_mcp_gateway_tools,
            current_compaction_version, engine
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            provider_id = excluded.provider_id,
            model_id = excluded.model_id,
            updated_at = excluded.updated_at,
            system_prompt = excluded.system_prompt,
            temperature = excluded.temperature,
            max_tokens = excluded.max_tokens,
            top_p = excluded.top_p,
            frequency_penalty = excluded.frequency_penalty,
            presence_penalty = excluded.presence_penalty,
            pinned = excluded.pinned,
            allowed_cwd = excluded.allowed_cwd,
            use_mcp_gateway_tools = excluded.use_mcp_gateway_tools,
            current_compaction_version = excluded.current_compaction_version,
            engine = excluded.engine",
    )
    .bind(&session.id)
    .bind(&session.title)
    .bind(&session.provider_id)
    .bind(&session.model_id)
    .bind(&session.created_at)
    .bind(&session.updated_at)
    .bind(&session.system_prompt)
    .bind(session.temperature.map(|x| x as f64))
    .bind(session.max_tokens.map(|x| x as i64))
    .bind(session.top_p.map(|x| x as f64))
    .bind(session.frequency_penalty.map(|x| x as f64))
    .bind(session.presence_penalty.map(|x| x as f64))
    .bind(session.pinned.map(|x| x as i64))
    .bind(&session.allowed_cwd)
    .bind(session.use_mcp_gateway_tools.map(|x| x as i64))
    .bind(&session.current_compaction_version)
    .bind(&session.engine)
    .execute(&mut *tx)
    .await
    .map_err(|e| crate::error::AppError::from(format!("upsert chat_sessions 失败: {}", e)))?;

    // 全量重插 messages
    sqlx::query("DELETE FROM chat_messages WHERE session_id = ?")
        .bind(&session.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| crate::error::AppError::from(format!("清空旧 messages 失败: {}", e)))?;

    for (idx, m) in session.messages.iter().enumerate() {
        let tool_calls_json = m.tool_calls.as_ref().map(|v| v.to_string());
        let attachments_json = m.attachments.as_ref().map(|v| v.to_string());

        sqlx::query(
            "INSERT INTO chat_messages (
                id, session_id, role, content, created_at, tokens, thinking,
                thinking_content, edited, tool_calls_json, tool_call_id,
                tool_name, tool_status, tool_method, tool_url, tool_elapsed_ms,
                tool_body_bytes, tool_truncated, attachments_json, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&m.id)
        .bind(&session.id)
        .bind(&m.role)
        .bind(&m.content)
        .bind(&m.created_at)
        .bind(m.tokens.map(|x| x as i64))
        .bind(m.thinking.map(|x| x as i64))
        .bind(&m.thinking_content)
        .bind(m.edited.map(|x| x as i64))
        .bind(&tool_calls_json)
        .bind(&m.tool_call_id)
        .bind(&m.tool_name)
        .bind(m.tool_status.map(|x| x as i64))
        .bind(&m.tool_method)
        .bind(&m.tool_url)
        .bind(m.tool_elapsed_ms.map(|x| x as i64))
        .bind(m.tool_body_bytes.map(|x| x as i64))
        .bind(m.tool_truncated.map(|x| x as i64))
        .bind(&attachments_json)
        .bind(idx as i64)
        .execute(&mut *tx)
        .await
        .map_err(|e| crate::error::AppError::from(format!("插入消息 {} 失败: {}", m.id, e)))?;
    }

    // 全量重插 tools
    sqlx::query("DELETE FROM chat_session_tools WHERE session_id = ?")
        .bind(&session.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| crate::error::AppError::from(format!("清空旧 tools 失败: {}", e)))?;

    if let Some(allowed) = &session.allowed_tools {
        for tn in allowed {
            sqlx::query(
                "INSERT INTO chat_session_tools (session_id, tool_name, is_allowed, is_enabled)
                 VALUES (?, ?, 1, 0)
                 ON CONFLICT(session_id, tool_name) DO UPDATE SET is_allowed = 1",
            )
            .bind(&session.id)
            .bind(tn)
            .execute(&mut *tx)
            .await
            .map_err(|e| crate::error::AppError::from(format!("插入 allowed_tool 失败: {}", e)))?;
        }
    }
    if let Some(enabled) = &session.enabled_tools {
        for tn in enabled {
            sqlx::query(
                "INSERT INTO chat_session_tools (session_id, tool_name, is_allowed, is_enabled)
                 VALUES (?, ?, 0, 1)
                 ON CONFLICT(session_id, tool_name) DO UPDATE SET is_enabled = 1",
            )
            .bind(&session.id)
            .bind(tn)
            .execute(&mut *tx)
            .await
            .map_err(|e| crate::error::AppError::from(format!("插入 enabled_tool 失败: {}", e)))?;
        }
    }

    tx.commit()
        .await
        .map_err(|e| crate::error::AppError::from(format!("提交事务失败: {}", e)))?;
    Ok(())
}

// ============== session 命令 ==============

#[tauri::command]
#[specta::specta]
pub async fn list_chat_sessions() -> AppResult<Vec<ChatSessionSummary>> {
    let rows: Vec<(
        String,
        String,
        String,
        String,
        String,
        String,
        Option<i64>,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT id, title, provider_id, model_id, created_at, updated_at, pinned, engine
         FROM chat_sessions ORDER BY updated_at DESC",
    )
    .fetch_all(pool())
    .await
    .map_err(|e| crate::error::AppError::from(format!("查询 chat_sessions 失败: {}", e)))?;

    if rows.is_empty() {
        return Ok(Vec::new());
    }

    // 一次性查所有 message_count
    let count_rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT session_id, COUNT(*) FROM chat_messages GROUP BY session_id")
            .fetch_all(pool())
            .await
            .map_err(|e| crate::error::AppError::from(format!("统计消息条数失败: {}", e)))?;

    let mut counts: HashMap<String, i64> = HashMap::new();
    for (sid, c) in count_rows {
        counts.insert(sid, c);
    }

    Ok(rows
        .into_iter()
        .map(
            |(id, title, provider_id, model_id, created_at, updated_at, pinned, engine)| {
                let message_count = counts.get(&id).copied().unwrap_or(0) as usize;
                ChatSessionSummary {
                    id,
                    title,
                    provider_id,
                    model_id,
                    created_at,
                    updated_at,
                    message_count,
                    pinned: pinned.map(|x| x != 0),
                    engine,
                }
            },
        )
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn get_chat_session(session_id: String) -> AppResult<ChatSession> {
    read_session_full(&session_id)
        .await?
        .ok_or_else(|| crate::error::AppError::from("会话不存在".to_string()))
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateChatSessionInput {
    pub title: Option<String>,
    pub provider_id: String,
    pub model_id: String,
    /// "dsh" 由 dsh 页创建时传入；缺省 builtin
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn create_chat_session(input: CreateChatSessionInput) -> AppResult<ChatSession> {
    let now = current_iso_time();
    let session = ChatSession {
        id: generate_id(),
        title: input.title.unwrap_or_else(|| "新会话".to_string()),
        provider_id: input.provider_id,
        model_id: input.model_id,
        created_at: now.clone(),
        updated_at: now,
        messages: Vec::new(),
        system_prompt: None,
        temperature: None,
        max_tokens: None,
        top_p: None,
        frequency_penalty: None,
        presence_penalty: None,
        pinned: None,
        allowed_tools: None,
        enabled_tools: None,
        allowed_cwd: None,
        use_mcp_gateway_tools: None,
        current_compaction_version: None,
        engine: input.engine,
    };
    write_session_full(&session).await?;
    Ok(session)
}

#[tauri::command]
#[specta::specta]
pub async fn save_chat_session(mut session: ChatSession) -> AppResult<ChatSession> {
    session.updated_at = current_iso_time();
    write_session_full(&session).await?;
    Ok(session)
}

#[tauri::command]
#[specta::specta]
pub async fn rename_chat_session(session_id: String, title: String) -> AppResult<ChatSession> {
    let now = current_iso_time();
    let result = sqlx::query("UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?")
        .bind(&title)
        .bind(&now)
        .bind(&session_id)
        .execute(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("重命名会话失败: {}", e)))?;

    if result.rows_affected() == 0 {
        return Err(crate::error::AppError::from("会话不存在".to_string()));
    }

    read_session_full(&session_id)
        .await?
        .ok_or_else(|| crate::error::AppError::from("会话不存在".to_string()))
}

#[tauri::command]
#[specta::specta]
pub async fn delete_chat_session(session_id: String) -> AppResult<()> {
    // CASCADE 会自动清理 chat_messages / chat_session_tools / chat_compactions
    sqlx::query("DELETE FROM chat_sessions WHERE id = ?")
        .bind(&session_id)
        .execute(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("删除会话失败: {}", e)))?;
    Ok(())
}

// ============== 上下文压缩 ==============

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SaveCompactionInput {
    pub session_id: String,
    pub content: String,
    pub source_message_count: usize,
    pub tail_kept: usize,
    pub model: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn save_compaction(input: SaveCompactionInput) -> AppResult<CompactionMeta> {
    if input.content.trim().is_empty() {
        return Err(crate::error::AppError::from("压缩内容为空".to_string()));
    }

    // 查当前最大 vN
    let max_n: Option<(String,)> = sqlx::query_as(
        "SELECT version FROM chat_compactions WHERE session_id = ?
         ORDER BY CAST(SUBSTR(version, 2) AS INTEGER) DESC LIMIT 1",
    )
    .bind(&input.session_id)
    .fetch_optional(pool())
    .await
    .map_err(|e| crate::error::AppError::from(format!("查询当前压缩版本失败: {}", e)))?;

    let next_n = max_n
        .as_ref()
        .and_then(|(v,)| v.strip_prefix('v').and_then(|s| s.parse::<u32>().ok()))
        .unwrap_or(0)
        + 1;
    let version = format!("v{}", next_n);

    let meta = CompactionMeta {
        version: version.clone(),
        created_at: current_iso_time(),
        source_message_count: input.source_message_count,
        tail_kept: input.tail_kept,
        char_count: input.content.chars().count(),
        model: input.model.clone(),
    };

    let pool = pool();
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| crate::error::AppError::from(format!("获取连接失败: {}", e)))?;
    let mut tx = conn
        .begin()
        .await
        .map_err(|e| crate::error::AppError::from(format!("开启事务失败: {}", e)))?;

    sqlx::query(
        "INSERT INTO chat_compactions (
            session_id, version, content, created_at,
            source_message_count, tail_kept, char_count, model
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&input.session_id)
    .bind(&meta.version)
    .bind(&input.content)
    .bind(&meta.created_at)
    .bind(meta.source_message_count as i64)
    .bind(meta.tail_kept as i64)
    .bind(meta.char_count as i64)
    .bind(&meta.model)
    .execute(&mut *tx)
    .await
    .map_err(|e| crate::error::AppError::from(format!("插入 compaction 失败: {}", e)))?;

    // 更新 session.current_compaction_version 标记
    sqlx::query("UPDATE chat_sessions SET current_compaction_version = ? WHERE id = ?")
        .bind(&meta.version)
        .bind(&input.session_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            crate::error::AppError::from(format!("更新 current_compaction_version 失败: {}", e))
        })?;

    tx.commit()
        .await
        .map_err(|e| crate::error::AppError::from(format!("提交事务失败: {}", e)))?;

    Ok(meta)
}

#[tauri::command]
#[specta::specta]
pub async fn list_compactions(session_id: String) -> AppResult<CompactionIndex> {
    let rows: Vec<(String, String, i64, i64, i64, Option<String>)> = sqlx::query_as(
        "SELECT version, created_at, source_message_count, tail_kept, char_count, model
         FROM chat_compactions WHERE session_id = ?
         ORDER BY CAST(SUBSTR(version, 2) AS INTEGER) ASC",
    )
    .bind(&session_id)
    .fetch_all(pool())
    .await
    .map_err(|e| crate::error::AppError::from(format!("查询压缩列表失败: {}", e)))?;

    let current: Option<(Option<String>,)> =
        sqlx::query_as("SELECT current_compaction_version FROM chat_sessions WHERE id = ?")
            .bind(&session_id)
            .fetch_optional(pool())
            .await
            .map_err(|e| {
                crate::error::AppError::from(format!("查询 current_compaction_version 失败: {}", e))
            })?;

    let versions: Vec<CompactionMeta> = rows
        .into_iter()
        .map(
            |(version, created_at, source_message_count, tail_kept, char_count, model)| {
                CompactionMeta {
                    version,
                    created_at,
                    source_message_count: source_message_count as usize,
                    tail_kept: tail_kept as usize,
                    char_count: char_count as usize,
                    model,
                }
            },
        )
        .collect();

    Ok(CompactionIndex {
        current: current.and_then(|(v,)| v),
        versions,
    })
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CompactionContent {
    pub version: String,
    pub content: String,
    pub meta: Option<CompactionMeta>,
}

#[tauri::command]
#[specta::specta]
pub async fn get_compaction(
    session_id: String,
    version: Option<String>,
) -> AppResult<Option<CompactionContent>> {
    // 决定要取的版本：参数优先；否则取 session.current_compaction_version
    let target = match version {
        Some(v) => Some(v),
        None => {
            let row: Option<(Option<String>,)> =
                sqlx::query_as("SELECT current_compaction_version FROM chat_sessions WHERE id = ?")
                    .bind(&session_id)
                    .fetch_optional(pool())
                    .await
                    .map_err(|e| {
                        crate::error::AppError::from(format!(
                            "查询 current_compaction_version 失败: {}",
                            e
                        ))
                    })?;
            row.and_then(|(v,)| v)
        }
    };

    let Some(target) = target else {
        return Ok(None);
    };

    let row: Option<(String, String, i64, i64, i64, Option<String>)> = sqlx::query_as(
        "SELECT content, created_at, source_message_count, tail_kept, char_count, model
         FROM chat_compactions WHERE session_id = ? AND version = ?",
    )
    .bind(&session_id)
    .bind(&target)
    .fetch_optional(pool())
    .await
    .map_err(|e| crate::error::AppError::from(format!("查询 compaction 失败: {}", e)))?;

    let Some((content, created_at, source_message_count, tail_kept, char_count, model)) = row
    else {
        return Ok(None);
    };

    let meta = CompactionMeta {
        version: target.clone(),
        created_at,
        source_message_count: source_message_count as usize,
        tail_kept: tail_kept as usize,
        char_count: char_count as usize,
        model,
    };

    Ok(Some(CompactionContent {
        version: target,
        content,
        meta: Some(meta),
    }))
}

#[tauri::command]
#[specta::specta]
pub async fn chat_cancel(request_id: String) -> AppResult<()> {
    let mut map = CHAT_ABORTS.write().await;
    if let Some(handle) = map.remove(&request_id) {
        handle.abort();
    }
    Ok(())
}

/// 从一帧/一次响应里解析 OpenAI 兼容的 usage（缺失或 null 返回 None）。
fn parse_usage(parsed: &serde_json::Value) -> Option<TokenUsage> {
    let u = parsed.get("usage")?;
    if u.is_null() {
        return None;
    }
    Some(TokenUsage {
        prompt_tokens: u
            .get("prompt_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
        completion_tokens: u
            .get("completion_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
        total_tokens: u
            .get("total_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
    })
}

fn build_chat_payload(
    request: &ChatStreamRequest,
    use_stream: bool,
) -> AppResult<(String, reqwest::header::HeaderMap, serde_json::Value)> {
    let base_url = request.base_url.trim_end_matches('/');
    let url = format!("{}/chat/completions", base_url);
    let is_deepseek = base_url.to_ascii_lowercase().contains("deepseek");

    let mut headers = reqwest::header::HeaderMap::new();
    if let Some(key) = request.api_key.as_ref() {
        if !key.is_empty() {
            let auth_value = format!("Bearer {}", key);
            headers.insert(
                reqwest::header::AUTHORIZATION,
                auth_value
                    .parse()
                    .map_err(|e| crate::error::AppError::from(format!("无效 API Key: {}", e)))?,
            );
        }
    }

    let filtered_messages: Vec<&ChatStreamMessage> = request
        .messages
        .iter()
        .filter(|m| {
            if m.role != "assistant" {
                return true;
            }
            if m.tool_calls.as_ref().is_some_and(|t| !t.is_empty()) {
                return true;
            }
            if m.reasoning_content
                .as_ref()
                .is_some_and(|s| !s.trim().is_empty())
            {
                return true;
            }
            match &m.content {
                serde_json::Value::String(s) => !s.trim().is_empty(),
                serde_json::Value::Array(a) => !a.is_empty(),
                _ => true,
            }
        })
        .collect();

    let mut payload = serde_json::json!({
        "model": request.model,
        "messages": filtered_messages,
        "stream": use_stream,
    });
    let keep_reasoning_content = is_deepseek && request.thinking == Some(true);
    if !keep_reasoning_content {
        if let Some(messages) = payload.get_mut("messages").and_then(|v| v.as_array_mut()) {
            for msg in messages {
                if let Some(obj) = msg.as_object_mut() {
                    obj.remove("reasoning_content");
                }
            }
        }
    }

    if use_stream {
        // 让供应商在流式末帧带出 token 用量
        payload["stream_options"] = serde_json::json!({ "include_usage": true });
    }

    if let Some(max_tokens) = request.max_tokens {
        payload["max_tokens"] = serde_json::json!(max_tokens);
    }
    if is_deepseek {
        if request.thinking == Some(true) {
            payload["thinking"] = serde_json::json!({ "type": "enabled" });
            payload["reasoning_effort"] = serde_json::json!("high");
        } else {
            // DeepSeek defaults thinking to enabled, so close it explicitly for normal chat models.
            payload["thinking"] = serde_json::json!({ "type": "disabled" });
        }
    } else {
        if let Some(temperature) = request.temperature {
            payload["temperature"] = serde_json::json!(temperature);
        }
        if let Some(top_p) = request.top_p {
            payload["top_p"] = serde_json::json!(top_p);
        }
        if let Some(frequency_penalty) = request.frequency_penalty {
            payload["frequency_penalty"] = serde_json::json!(frequency_penalty);
        }
        if let Some(presence_penalty) = request.presence_penalty {
            payload["presence_penalty"] = serde_json::json!(presence_penalty);
        }
        if let Some(true) = request.thinking {
            payload["enable_thinking"] = serde_json::json!(true);
            payload["reasoning"] = serde_json::json!({ "effort": "medium" });
        }
    }
    if let Some(tools) = request.tools.as_ref() {
        if !tools.is_empty() {
            payload["tools"] = serde_json::json!(tools);
            if let Some(tc) = request.tool_choice.as_ref() {
                payload["tool_choice"] = tc.clone();
            } else {
                payload["tool_choice"] = serde_json::json!("auto");
            }
        }
    }

    Ok((url, headers, payload))
}

#[tauri::command]
#[specta::specta]
pub async fn chat_complete(request: ChatStreamRequest) -> AppResult<String> {
    if crate::commands::chat_anthropic::is_anthropic(&request) {
        return crate::commands::chat_anthropic::complete(&request, HTTP_CLIENT.clone()).await;
    }
    let (url, headers, body) = build_chat_payload(&request, false)?;
    let client = HTTP_CLIENT.clone();
    let response = client
        .post(&url)
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| crate::error::AppError::from(format!("请求失败: {}", e)))?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(crate::error::AppError::from(format!(
            "HTTP {}: {}",
            status, text
        )));
    }
    let parsed: serde_json::Value = response
        .json()
        .await
        .map_err(|e| crate::error::AppError::from(format!("解析响应失败: {}", e)))?;
    let content = parsed
        .get("choices")
        .and_then(|v| v.get(0))
        .and_then(|v| v.get("message"))
        .and_then(|v| v.get("content"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| crate::error::AppError::from("AI 返回无 content".to_string()))?
        .to_string();
    Ok(content)
}

#[tauri::command]
#[specta::specta]
pub async fn chat_stream(app: AppHandle, request: ChatStreamRequest) -> AppResult<()> {
    // Anthropic 走另一套请求与流解析，但取消（CHAT_ABORTS）与事件出口共用这里的机制
    if crate::commands::chat_anthropic::is_anthropic(&request) {
        let request_id = request.request_id.clone();
        let client = HTTP_CLIENT.clone();
        let handle = tokio::spawn(async move {
            crate::commands::chat_anthropic::stream(app, request, client).await;
        });
        CHAT_ABORTS.write().await.insert(request_id, handle.abort_handle());
        return Ok(());
    }

    let request_id = request.request_id.clone();
    let use_stream = request.stream.unwrap_or(true);
    let (url, headers, body) = build_chat_payload(&request, use_stream)?;

    let client = HTTP_CLIENT.clone();

    let app_handle = app.clone();
    let handle = tokio::spawn(async move {
        let response = client.post(&url).headers(headers).json(&body).send().await;

        let send_error = |err: String| async {
            let mut ev = ChatStreamEvent::new(&request_id);
            ev.done = true;
            ev.error = Some(err);
            let _ = app_handle.emit("chat-stream", ev);
        };

        let response = match response {
            Ok(resp) => resp,
            Err(err) => {
                send_error(format!("请求失败: {}", err)).await;
                return;
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            send_error(format!("HTTP {}: {}", status, text)).await;
            return;
        }

        if !use_stream {
            // 非流式：一次性读取
            let text = match response.text().await {
                Ok(t) => t,
                Err(err) => {
                    send_error(format!("读取响应失败: {}", err)).await;
                    return;
                }
            };
            let parsed: serde_json::Value = match serde_json::from_str(&text) {
                Ok(v) => v,
                Err(err) => {
                    send_error(format!("解析响应失败: {}", err)).await;
                    return;
                }
            };
            let choice0 = parsed.get("choices").and_then(|v| v.get(0));
            let message = choice0.and_then(|v| v.get("message"));
            let content = message
                .and_then(|v| v.get("content"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let reasoning = message
                .and_then(|v| v.get("reasoning_content"))
                .and_then(|v| v.as_str());
            let tool_calls = message
                .and_then(|v| v.get("tool_calls"))
                .and_then(|v| v.as_array());
            let finish_reason = choice0
                .and_then(|v| v.get("finish_reason"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            if let Some(r) = reasoning {
                let mut ev = ChatStreamEvent::new(&request_id);
                ev.thinking_delta = Some(r.to_string());
                let _ = app_handle.emit("chat-stream", ev);
            }
            if !content.is_empty() {
                let mut ev = ChatStreamEvent::new(&request_id);
                ev.delta = Some(content.to_string());
                let _ = app_handle.emit("chat-stream", ev);
            }
            if let Some(calls) = tool_calls {
                for (idx, call) in calls.iter().enumerate() {
                    let id = call
                        .get("id")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let func = call.get("function");
                    let name = func
                        .and_then(|v| v.get("name"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let args = func
                        .and_then(|v| v.get("arguments"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let mut ev = ChatStreamEvent::new(&request_id);
                    ev.tool_call_delta = Some(ToolCallDelta {
                        index: idx as u32,
                        id,
                        name,
                        arguments_delta: args,
                    });
                    let _ = app_handle.emit("chat-stream", ev);
                }
            }
            let mut ev = ChatStreamEvent::new(&request_id);
            ev.done = true;
            ev.finish_reason = finish_reason;
            ev.usage = parse_usage(&parsed);
            let _ = app_handle.emit("chat-stream", ev);
            return;
        }

        // 流式
        let mut stream = response.bytes_stream();
        // 字节缓冲而非字符串缓冲：网络分片可能把多字节 UTF-8 字符（中文）切成两半，
        // 按 chunk 做 from_utf8_lossy 会产生 � 乱码；按 \n 切完整行后再转字符串就没有这个问题。
        let mut buffer: Vec<u8> = Vec::new();
        let mut last_finish: Option<String> = None;
        let mut last_usage: Option<TokenUsage> = None;

        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    buffer.extend_from_slice(&bytes);
                    while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                        let line_bytes: Vec<u8> = buffer.drain(..=pos).collect();
                        let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
                        if line.is_empty() || !line.starts_with("data:") {
                            continue;
                        }
                        let data = line.trim_start_matches("data:").trim();
                        if data == "[DONE]" {
                            let mut ev = ChatStreamEvent::new(&request_id);
                            ev.done = true;
                            ev.finish_reason = last_finish.clone();
                            ev.usage = last_usage.clone();
                            let _ = app_handle.emit("chat-stream", ev);
                            return;
                        }
                        let parsed: serde_json::Value = match serde_json::from_str(data) {
                            Ok(v) => v,
                            Err(_) => continue,
                        };
                        if let Some(u) = parse_usage(&parsed) {
                            last_usage = Some(u);
                        }
                        let choice0 = parsed.get("choices").and_then(|v| v.get(0));
                        let delta = choice0.and_then(|v| v.get("delta"));

                        if let Some(fr) = choice0
                            .and_then(|v| v.get("finish_reason"))
                            .and_then(|v| v.as_str())
                        {
                            last_finish = Some(fr.to_string());
                        }

                        if let Some(content) = delta
                            .and_then(|v| v.get("content"))
                            .and_then(|v| v.as_str())
                        {
                            let mut ev = ChatStreamEvent::new(&request_id);
                            ev.delta = Some(content.to_string());
                            let _ = app_handle.emit("chat-stream", ev);
                        }
                        if let Some(thinking) = delta
                            .and_then(|v| v.get("reasoning_content"))
                            .and_then(|v| v.as_str())
                        {
                            let mut ev = ChatStreamEvent::new(&request_id);
                            ev.thinking_delta = Some(thinking.to_string());
                            let _ = app_handle.emit("chat-stream", ev);
                        }
                        if let Some(tool_calls) = delta
                            .and_then(|v| v.get("tool_calls"))
                            .and_then(|v| v.as_array())
                        {
                            for call in tool_calls {
                                let index =
                                    call.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                                let id = call
                                    .get("id")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string());
                                let func = call.get("function");
                                let name = func
                                    .and_then(|v| v.get("name"))
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string());
                                let args = func
                                    .and_then(|v| v.get("arguments"))
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string());
                                if id.is_none() && name.is_none() && args.is_none() {
                                    continue;
                                }
                                let mut ev = ChatStreamEvent::new(&request_id);
                                ev.tool_call_delta = Some(ToolCallDelta {
                                    index,
                                    id,
                                    name,
                                    arguments_delta: args,
                                });
                                let _ = app_handle.emit("chat-stream", ev);
                            }
                        }
                    }
                }
                Err(err) => {
                    let mut ev = ChatStreamEvent::new(&request_id);
                    ev.done = true;
                    ev.error = Some(format!("读取流失败: {}", err));
                    let _ = app_handle.emit("chat-stream", ev);
                    return;
                }
            }
        }

        // 流自然结束（未见 [DONE]）：补发 done，带出 finish_reason 与 usage
        let mut ev = ChatStreamEvent::new(&request_id);
        ev.done = true;
        ev.finish_reason = last_finish.clone();
        ev.usage = last_usage.clone();
        let _ = app_handle.emit("chat-stream", ev);
    });

    let abort = handle.abort_handle();
    CHAT_ABORTS.write().await.insert(request.request_id, abort);
    Ok(())
}
