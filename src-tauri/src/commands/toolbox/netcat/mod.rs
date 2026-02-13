// Netcat 模块 - Tauri 命令导出

mod types;
mod tcp_client;
mod tcp_server;
mod udp;

pub use types::*;

use super::generate_id;
use crate::storage::get_storage_config;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;
use tauri::{AppHandle, State};

/// 全局会话管理器
pub struct NetcatState {
    pub sessions: SessionManager,
}

impl NetcatState {
    pub fn new() -> Self {
        Self {
            sessions: create_session_manager(),
        }
    }

    /// 从文件加载会话配置
    pub async fn load_sessions(&self) -> Result<(), String> {
        let config = get_storage_config()?;
        let file_path = config.netcat_sessions_file();

        if !file_path.exists() {
            return Ok(());
        }

        let content = std::fs::read_to_string(&file_path)
            .map_err(|e| format!("读取 Netcat 会话文件失败: {}", e))?;

        let configs: Vec<NetcatSessionConfig> = serde_json::from_str(&content)
            .map_err(|e| format!("解析 Netcat 会话文件失败: {}", e))?;

        let mut sessions = self.sessions.write().await;
        for cfg in configs {
            let session = NetcatSession {
                id: cfg.id.clone(),
                name: cfg.name,
                protocol: cfg.protocol,
                mode: cfg.mode,
                host: cfg.host,
                port: cfg.port,
                status: SessionStatus::Disconnected,
                auto_reconnect: cfg.auto_reconnect,
                timeout_ms: cfg.timeout_ms,
                created_at: cfg.created_at,
                connected_at: None,
                last_activity: None,
                bytes_sent: 0,
                bytes_received: 0,
                message_count: 0,
                error_message: None,
                client_count: 0,
                auto_send: cfg.auto_send,
            };
            let session_state = Arc::new(RwLock::new(SessionState::new(session)));
            sessions.insert(cfg.id, session_state);
        }

        Ok(())
    }

    /// 保存会话配置到文件
    pub async fn save_sessions(&self) -> Result<(), String> {
        let config = get_storage_config()?;
        let file_path = config.netcat_sessions_file();

        let sessions = self.sessions.read().await;
        let mut configs: Vec<NetcatSessionConfig> = Vec::new();

        for session_state in sessions.values() {
            let s = session_state.read().await;
            configs.push(NetcatSessionConfig {
                id: s.session.id.clone(),
                name: s.session.name.clone(),
                protocol: s.session.protocol,
                mode: s.session.mode,
                host: s.session.host.clone(),
                port: s.session.port,
                auto_reconnect: s.session.auto_reconnect,
                timeout_ms: s.session.timeout_ms,
                created_at: s.session.created_at,
                auto_send: s.session.auto_send.clone(),
            });
        }

        let content = serde_json::to_string_pretty(&configs)
            .map_err(|e| format!("序列化 Netcat 会话失败: {}", e))?;

        std::fs::write(&file_path, content)
            .map_err(|e| format!("保存 Netcat 会话文件失败: {}", e))?;

        Ok(())
    }
}

impl Default for NetcatState {
    fn default() -> Self {
        Self::new()
    }
}

/// 初始化并加载已保存的会话
#[tauri::command]
pub async fn netcat_init(
    state: State<'_, NetcatState>,
) -> Result<(), String> {
    state.load_sessions().await
}

/// 创建新会话
#[tauri::command]
pub async fn netcat_create_session(
    _app: AppHandle,
    state: State<'_, NetcatState>,
    input: NetcatSessionInput,
) -> Result<NetcatSession, String> {
    let now = current_timestamp();
    let session_id = generate_id();

    let name = input.name.unwrap_or_else(|| {
        format!(
            "{} {} {}:{}",
            match input.protocol {
                Protocol::Tcp => "TCP",
                Protocol::Udp => "UDP",
            },
            match input.mode {
                SessionMode::Client => "Client",
                SessionMode::Server => "Server",
            },
            input.host,
            input.port
        )
    });

    let session = NetcatSession {
        id: session_id.clone(),
        name,
        protocol: input.protocol,
        mode: input.mode,
        host: input.host.clone(),
        port: input.port,
        status: SessionStatus::Disconnected,
        auto_reconnect: input.auto_reconnect.unwrap_or(false),
        timeout_ms: input.timeout_ms.unwrap_or(5000),
        created_at: now,
        connected_at: None,
        last_activity: None,
        bytes_sent: 0,
        bytes_received: 0,
        message_count: 0,
        error_message: None,
        client_count: 0,
        auto_send: AutoSendConfig::default(),
    };

    let session_state = Arc::new(RwLock::new(SessionState::new(session.clone())));

    // 添加到管理器
    state.sessions.write().await.insert(session_id, session_state);

    // 保存到文件
    state.save_sessions().await?;

    Ok(session)
}

/// 启动会话
#[tauri::command]
pub async fn netcat_start_session(
    app: AppHandle,
    state: State<'_, NetcatState>,
    session_id: String,
) -> Result<(), String> {
    let session_state = {
        let sessions = state.sessions.read().await;
        sessions.get(&session_id).cloned()
    };

    let session_state = session_state.ok_or("会话不存在")?;

    // 先检查是否有旧任务在运行，如果有则终止它
    {
        let mut s = session_state.write().await;
        if let Some(handle) = s.task_handle.take() {
            log::info!("终止旧的 Netcat 任务: {}", session_id);
            handle.abort();
            // 清理旧的 shutdown channel
            s.shutdown_tx = None;
        }
    }

    let (protocol, mode, host, port, timeout_ms) = {
        let s = session_state.read().await;
        (
            s.session.protocol,
            s.session.mode,
            s.session.host.clone(),
            s.session.port,
            s.session.timeout_ms,
        )
    };

    // 根据协议和模式启动，并保存任务句柄
    let task_handle = match (protocol, mode) {
        (Protocol::Tcp, SessionMode::Client) => {
            let app_clone = app.clone();
            let state_clone = session_state.clone();
            let handle = tokio::spawn(async move {
                let _ = tcp_client::start_tcp_client(app_clone, state_clone, host, port, timeout_ms).await;
            });
            handle.abort_handle()
        }
        (Protocol::Tcp, SessionMode::Server) => {
            let app_clone = app.clone();
            let state_clone = session_state.clone();
            let handle = tokio::spawn(async move {
                let _ = tcp_server::start_tcp_server(app_clone, state_clone, host, port).await;
            });
            handle.abort_handle()
        }
        (Protocol::Udp, _) => {
            let app_clone = app.clone();
            let state_clone = session_state.clone();
            let handle = tokio::spawn(async move {
                let _ = udp::start_udp_session(app_clone, state_clone, host, port, mode).await;
            });
            handle.abort_handle()
        }
    };

    // 保存任务句柄
    {
        let mut s = session_state.write().await;
        s.task_handle = Some(task_handle);
    }

    Ok(())
}

/// 停止会话
#[tauri::command]
pub async fn netcat_stop_session(
    state: State<'_, NetcatState>,
    session_id: String,
) -> Result<(), String> {
    stop_session_internal(&state, &session_id).await
}

/// 内部停止会话逻辑（可复用）
async fn stop_session_internal(
    state: &NetcatState,
    session_id: &str,
) -> Result<(), String> {
    let session_state = {
        let sessions = state.sessions.read().await;
        sessions.get(session_id).cloned()
    };

    let session_state = session_state.ok_or("会话不存在")?;

    // 获取会话模式
    let session_mode = {
        let s = session_state.read().await;
        s.session.mode
    };

    // 发送关闭信号
    let shutdown_tx = {
        let mut s = session_state.write().await;
        s.shutdown_tx.take()
    };

    if let Some(tx) = shutdown_tx {
        let _ = tx.send(()).await;
        log::info!("Netcat 停止信号已发送: {}", session_id);
    }

    // 强制终止任务（如果关闭信号没有效果）
    {
        let mut s = session_state.write().await;
        if let Some(handle) = s.task_handle.take() {
            log::info!("强制终止 Netcat 任务: {}", session_id);
            handle.abort();
        }
    }

    // 等待一小段时间让任务终止
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // 根据模式清理资源
    match session_mode {
        SessionMode::Server => {
            // 服务器模式：断开所有客户端连接
            tcp_server::shutdown_all_clients(session_id).await;
        }
        SessionMode::Client => {
            // 客户端模式：清理 TCP 发送器
            tcp_client::TCP_SENDERS.write().await.remove(session_id);
        }
    }

    // UDP 清理
    udp::shutdown_udp_session(session_id).await;

    // 强制更新状态为已断开
    {
        let mut s = session_state.write().await;
        s.session.status = SessionStatus::Disconnected;
        s.session.error_message = None;
        s.clients.clear();
        s.session.client_count = 0;
    }

    // 等待资源释放
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    log::info!("Netcat 会话已停止: {}", session_id);

    Ok(())
}

/// 删除会话
#[tauri::command]
pub async fn netcat_remove_session(
    state: State<'_, NetcatState>,
    session_id: String,
) -> Result<(), String> {
    // 先停止
    let _ = stop_session_internal(&state, &session_id).await;

    // 移除
    state.sessions.write().await.remove(&session_id);

    // 保存到文件
    state.save_sessions().await?;

    Ok(())
}

/// 更新会话的自动发送配置
#[tauri::command]
pub async fn netcat_update_auto_send(
    state: State<'_, NetcatState>,
    session_id: String,
    config: AutoSendConfig,
) -> Result<(), String> {
    let sessions = state.sessions.read().await;
    let session_state = sessions.get(&session_id).ok_or("会话不存在")?;

    {
        let mut s = session_state.write().await;
        s.session.auto_send = config;
    }

    drop(sessions);

    // 保存到文件
    state.save_sessions().await?;

    Ok(())
}

/// 发送消息
#[tauri::command]
pub async fn netcat_send_message(
    _app: AppHandle,
    state: State<'_, NetcatState>,
    input: SendMessageInput,
) -> Result<NetcatMessage, String> {
    log::info!("Netcat 发送消息: session={}, size={}, format={:?}, target_client={:?}, broadcast={:?}",
        input.session_id, input.data.len(), input.format, input.target_client, input.broadcast);

    let session_state = {
        let sessions = state.sessions.read().await;
        sessions.get(&input.session_id).cloned()
    };

    let session_state = session_state.ok_or_else(|| {
        log::error!("Netcat 发送消息失败: 会话不存在 {}", input.session_id);
        "会话不存在".to_string()
    })?;

    // 解析数据
    let data = parse_input_data(&input.data, input.format)?;
    log::debug!("Netcat 解析后数据大小: {} bytes", data.len());

    let (protocol, mode) = {
        let s = session_state.read().await;
        (s.session.protocol, s.session.mode)
    };

    log::info!("Netcat 发送: protocol={:?}, mode={:?}", protocol, mode);

    // 根据协议和模式发送
    match (protocol, mode) {
        (Protocol::Tcp, SessionMode::Client) => {
            log::info!("Netcat TCP 客户端模式发送");
            tcp_client::send_tcp_client_data(&input.session_id, data.clone()).await?;
        }
        (Protocol::Tcp, SessionMode::Server) => {
            if input.broadcast.unwrap_or(false) {
                log::info!("Netcat TCP 服务器模式广播");
                tcp_server::broadcast_to_clients(&input.session_id, data.clone()).await?;
            } else if let Some(ref client_id) = input.target_client {
                log::info!("Netcat TCP 服务器模式发送到客户端: {}", client_id);
                tcp_server::send_to_client(&input.session_id, client_id, data.clone()).await?;
            } else {
                log::error!("Netcat TCP 服务器模式: 未指定目标客户端或广播");
                return Err("服务器模式需要指定目标客户端或广播".to_string());
            }
        }
        (Protocol::Udp, _) => {
            log::info!("Netcat UDP 模式发送");
            let target = input.target_client.clone();
            udp::send_udp_data(&input.session_id, data.clone(), target).await?;
        }
    }

    // 创建消息记录
    let now = current_timestamp();
    let message_id = generate_id();

    let message = NetcatMessage {
        id: message_id,
        session_id: input.session_id.clone(),
        direction: MessageDirection::Sent,
        data: input.data,
        format: input.format,
        size: data.len(),
        timestamp: now,
        client_id: input.target_client,
        client_addr: None,
    };

    // 保存到会话
    {
        let mut s = session_state.write().await;
        s.messages.push(message.clone());
        s.session.message_count += 1;
        s.session.last_activity = Some(now);

        if s.messages.len() > 1000 {
            s.messages.remove(0);
        }
    }

    log::info!("Netcat 消息发送成功");
    Ok(message)
}

/// 获取所有会话
#[tauri::command]
pub async fn netcat_get_sessions(
    state: State<'_, NetcatState>,
) -> Result<Vec<NetcatSession>, String> {
    let sessions = state.sessions.read().await;
    let mut result = Vec::new();

    for session_state in sessions.values() {
        let s = session_state.read().await;
        result.push(s.session.clone());
    }

    Ok(result)
}

/// 获取单个会话
#[tauri::command]
pub async fn netcat_get_session(
    state: State<'_, NetcatState>,
    session_id: String,
) -> Result<NetcatSession, String> {
    let sessions = state.sessions.read().await;
    let session_state = sessions.get(&session_id).ok_or("会话不存在")?;
    let s = session_state.read().await;
    Ok(s.session.clone())
}

/// 获取会话消息
#[tauri::command]
pub async fn netcat_get_messages(
    state: State<'_, NetcatState>,
    session_id: String,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<NetcatMessage>, String> {
    let sessions = state.sessions.read().await;
    let session_state = sessions.get(&session_id).ok_or("会话不存在")?;
    let s = session_state.read().await;

    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(100);

    let messages: Vec<NetcatMessage> = s.messages
        .iter()
        .rev()
        .skip(offset)
        .take(limit)
        .cloned()
        .collect();

    Ok(messages)
}

/// 获取连接的客户端
#[tauri::command]
pub async fn netcat_get_clients(
    state: State<'_, NetcatState>,
    session_id: String,
) -> Result<Vec<ConnectedClient>, String> {
    let sessions = state.sessions.read().await;
    let session_state = sessions.get(&session_id).ok_or("会话不存在")?;
    let s = session_state.read().await;

    Ok(s.clients.values().cloned().collect())
}

/// 清空会话消息
#[tauri::command]
pub async fn netcat_clear_messages(
    state: State<'_, NetcatState>,
    session_id: String,
) -> Result<(), String> {
    let sessions = state.sessions.read().await;
    let session_state = sessions.get(&session_id).ok_or("会话不存在")?;
    let mut s = session_state.write().await;
    s.messages.clear();
    Ok(())
}

/// 断开指定客户端（仅服务器模式）
#[tauri::command]
pub async fn netcat_disconnect_client(
    state: State<'_, NetcatState>,
    session_id: String,
    client_id: String,
) -> Result<(), String> {
    // 对于 TCP 服务器，从全局存储中移除客户端发送器会导致连接关闭
    let _ = tcp_server::disconnect_client(&session_id, &client_id).await;

    // 更新会话状态
    let sessions = state.sessions.read().await;
    if let Some(session_state) = sessions.get(&session_id) {
        let mut s = session_state.write().await;
        s.clients.remove(&client_id);
        s.session.client_count = s.clients.len() as u32;
    }

    Ok(())
}

/// HTTP 请求配置
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpFetchConfig {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: Option<std::collections::HashMap<String, String>>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub json_path: Option<String>,
}

/// HTTP 获取数据（用于自动发送的 HTTP 模式）
#[tauri::command]
pub async fn netcat_fetch_http(
    config: HttpFetchConfig,
) -> Result<String, String> {
    use reqwest::{Client, Method, Proxy};
    use std::time::Duration;

    log::info!("Netcat HTTP 请求: url={}, method={:?}",
        config.url, config.method);

    // 创建 HTTP 客户端，禁用系统代理以避免代理导致的问题
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .no_proxy()  // 禁用系统代理
        .user_agent("CodeShelf-Netcat/1.0")  // 添加 User-Agent
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    // 解析 HTTP 方法
    let method = match config.method.as_deref().unwrap_or("GET").to_uppercase().as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        "PUT" => Method::PUT,
        "DELETE" => Method::DELETE,
        "PATCH" => Method::PATCH,
        "HEAD" => Method::HEAD,
        other => return Err(format!("不支持的 HTTP 方法: {}", other)),
    };

    let mut request = client.request(method, &config.url);

    // 添加自定义头
    if let Some(headers) = config.headers {
        for (key, value) in headers {
            request = request.header(&key, &value);
        }
    }

    // 添加请求体
    if let Some(body) = config.body {
        request = request.body(body);
    }

    let response = request
        .send()
        .await
        .map_err(|e| {
            log::error!("Netcat HTTP 请求失败: {}", e);
            format!("HTTP 请求失败: {}", e)
        })?;

    let status = response.status();
    log::info!("Netcat HTTP 响应状态: {}", status);

    if !status.is_success() {
        return Err(format!("HTTP 请求失败: {} {}", status.as_u16(), status.canonical_reason().unwrap_or("")));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let text = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    log::info!("Netcat HTTP 响应: {} bytes, content-type={}, preview={}",
        text.len(), content_type, &text[..text.len().min(100)]);

    // 如果是 JSON 并且指定了路径，则提取
    if content_type.contains("application/json") || content_type.contains("text/json") {
        if let Some(path) = config.json_path {
            if !path.trim().is_empty() {
                let result = extract_json_path(&text, &path)?;
                log::info!("Netcat HTTP JSON 提取结果: {}", &result[..result.len().min(100)]);
                return Ok(result);
            }
        }
    }

    Ok(text)
}

/// 从 JSON 中提取指定路径的值
fn extract_json_path(json_str: &str, path: &str) -> Result<String, String> {
    let json: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    // 支持多路径: "data.name,data.id"
    let paths: Vec<&str> = path.split(',').map(|p| p.trim()).collect();
    let mut results: Vec<String> = Vec::new();

    for single_path in paths {
        if let Some(value) = get_json_value(&json, single_path) {
            let str_value = match value {
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Null => "null".to_string(),
                other => other.to_string(),
            };
            results.push(str_value);
        }
    }

    if results.is_empty() {
        Ok(json_str.to_string())
    } else {
        Ok(results.join(" "))
    }
}

/// 获取 JSON 路径对应的值
fn get_json_value<'a>(json: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
    let mut current = json;

    // 解析路径: "data.items[0].value"
    let parts: Vec<&str> = path.split('.').collect();

    for part in parts {
        // 检查是否有数组索引
        if let Some(bracket_pos) = part.find('[') {
            let key = &part[..bracket_pos];
            let index_str = &part[bracket_pos + 1..part.len() - 1];

            // 先获取对象属性
            if !key.is_empty() {
                current = current.get(key)?;
            }

            // 然后获取数组元素
            let index: usize = index_str.parse().ok()?;
            current = current.get(index)?;
        } else {
            current = current.get(part)?;
        }
    }

    Some(current)
}

// ============== 辅助函数 ==============

/// 解析输入数据
fn parse_input_data(data: &str, format: DataFormat) -> Result<Vec<u8>, String> {
    match format {
        DataFormat::Text => Ok(data.as_bytes().to_vec()),
        DataFormat::Hex => {
            // 支持多种十六进制格式: "48 65 6C 6C 6F" 或 "48656C6C6F" 或 "0x48 0x65"
            let cleaned: String = data
                .replace("0x", "")
                .replace("0X", "")
                .chars()
                .filter(|c| c.is_ascii_hexdigit() || c.is_whitespace())
                .collect();

            let hex_str: String = cleaned.split_whitespace().collect();

            if hex_str.len() % 2 != 0 {
                return Err("十六进制字符串长度必须为偶数".to_string());
            }

            (0..hex_str.len())
                .step_by(2)
                .map(|i| {
                    u8::from_str_radix(&hex_str[i..i + 2], 16)
                        .map_err(|e| format!("无效的十六进制: {}", e))
                })
                .collect()
        }
        DataFormat::Base64 => {
            use base64::{Engine as _, engine::general_purpose};
            general_purpose::STANDARD
                .decode(data.trim())
                .map_err(|e| format!("Base64 解码失败: {}", e))
        }
    }
}

/// 获取当前时间戳
fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
