// Netcat 模块 - Tauri 命令导出

mod tcp_client;
mod tcp_server;
mod types;
mod udp;

pub use types::*;

use super::generate_id;
use crate::error::AppResult;
use crate::storage::get_storage_config;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::RwLock;

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
    pub async fn load_sessions(&self) -> AppResult<()> {
        let config = get_storage_config()?;
        let file_path = config.netcat_sessions_file();

        if !file_path.exists() {
            return Ok(());
        }

        let content = std::fs::read_to_string(&file_path).map_err(|e| {
            crate::error::AppError::from(format!("读取 Netcat 会话文件失败: {}", e))
        })?;

        let configs: Vec<NetcatSessionConfig> = serde_json::from_str(&content).map_err(|e| {
            crate::error::AppError::from(format!("解析 Netcat 会话文件失败: {}", e))
        })?;

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
                local_addr: None,
                client_count: 0,
                auto_send: cfg.auto_send,
            };
            let session_state = Arc::new(RwLock::new(SessionState::new(session)));
            sessions.insert(cfg.id, session_state);
        }

        Ok(())
    }

    /// 保存会话配置到文件
    pub async fn save_sessions(&self) -> AppResult<()> {
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
            .map_err(|e| crate::error::AppError::from(format!("序列化 Netcat 会话失败: {}", e)))?;

        crate::storage::write_atomic(&file_path, content).map_err(|e| {
            crate::error::AppError::from(format!("保存 Netcat 会话文件失败: {}", e))
        })?;

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
#[specta::specta]
pub async fn netcat_init(state: State<'_, NetcatState>) -> AppResult<()> {
    state.load_sessions().await
}

/// 创建新会话
#[tauri::command]
#[specta::specta]
pub async fn netcat_create_session(
    _app: AppHandle,
    state: State<'_, NetcatState>,
    input: NetcatSessionInput,
) -> AppResult<NetcatSession> {
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
        local_addr: None,
        client_count: 0,
        auto_send: AutoSendConfig::default(),
    };

    let session_state = Arc::new(RwLock::new(SessionState::new(session.clone())));

    // 添加到管理器
    state
        .sessions
        .write()
        .await
        .insert(session_id, session_state);

    // 保存到文件
    state.save_sessions().await?;

    Ok(session)
}

/// 启动会话
#[tauri::command]
#[specta::specta]
pub async fn netcat_start_session(
    app: AppHandle,
    state: State<'_, NetcatState>,
    session_id: String,
) -> AppResult<()> {
    let session_state = {
        let sessions = state.sessions.read().await;
        sessions.get(&session_id).cloned()
    };

    let session_state = session_state.ok_or("会话不存在")?;

    // 获取会话模式（用于后续清理）
    let session_mode = {
        let s = session_state.read().await;
        s.session.mode
    };

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

    // 清理旧的资源
    match session_mode {
        SessionMode::Server => {
            tcp_server::shutdown_all_clients(&session_id).await;
        }
        SessionMode::Client => {
            tcp_client::TCP_SENDERS.write().await.remove(&session_id);
        }
    }
    udp::shutdown_udp_session(&session_id).await;

    // 等待端口释放
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

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
                let _ =
                    tcp_client::start_tcp_client(app_clone, state_clone, host, port, timeout_ms)
                        .await;
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
#[specta::specta]
pub async fn netcat_stop_session(
    state: State<'_, NetcatState>,
    session_id: String,
) -> AppResult<()> {
    stop_session_internal(&state, &session_id).await
}

/// 内部停止会话逻辑（可复用）
async fn stop_session_internal(state: &NetcatState, session_id: &str) -> AppResult<()> {
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

    // 设置 shutdown 标志（优先于其他清理操作）
    match session_mode {
        SessionMode::Server => {
            // 服务器模式：设置 shutdown 标志会在 shutdown_all_clients 中完成
        }
        SessionMode::Client => {
            // 客户端模式：设置 shutdown 标志
            tcp_client::set_client_shutdown_flag(session_id).await;
        }
    }

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
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    // 根据模式清理资源
    match session_mode {
        SessionMode::Server => {
            // 服务器模式：断开所有客户端连接
            tcp_server::shutdown_all_clients(session_id).await;
        }
        SessionMode::Client => {
            // 客户端模式：清理 TCP 发送器和 shutdown 标志
            tcp_client::TCP_SENDERS.write().await.remove(session_id);
            tcp_client::cleanup_client_shutdown_flag(session_id).await;
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
#[specta::specta]
pub async fn netcat_remove_session(
    state: State<'_, NetcatState>,
    session_id: String,
) -> AppResult<()> {
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
#[specta::specta]
pub async fn netcat_update_auto_send(
    state: State<'_, NetcatState>,
    session_id: String,
    config: AutoSendConfig,
) -> AppResult<()> {
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
#[specta::specta]
pub async fn netcat_send_message(
    app: AppHandle,
    state: State<'_, NetcatState>,
    input: SendMessageInput,
) -> AppResult<NetcatMessage> {
    log::info!(
        "Netcat 发送消息: session={}, size={}, format={:?}, target_client={:?}, broadcast={:?}",
        input.session_id,
        input.data.len(),
        input.format,
        input.target_client,
        input.broadcast
    );

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

    let resolved_tcp_target_client = if protocol == Protocol::Tcp
        && mode == SessionMode::Server
        && !input.broadcast.unwrap_or(false)
    {
        let target = input.target_client.as_deref().unwrap_or("").trim();
        if target.is_empty() {
            None
        } else {
            let s = session_state.read().await;
            s.clients
                .iter()
                .find(|(id, client)| id.as_str() == target || client.addr == target)
                .map(|(id, _)| id.clone())
        }
    } else {
        None
    };

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
            } else if let Some(ref client_id) = resolved_tcp_target_client {
                log::info!("Netcat TCP 服务器模式发送到客户端: {}", client_id);
                tcp_server::send_to_client(&input.session_id, client_id, data.clone()).await?;
            } else {
                log::error!("Netcat TCP 服务器模式: 未指定目标客户端或广播");
                return Err(crate::error::AppError::from(
                    "服务器模式需要指定目标客户端或广播".to_string(),
                ));
            }
        }
        (Protocol::Udp, _) => {
            log::info!("Netcat UDP 模式发送");
            let target = input.target_client.clone();
            udp::send_udp_data(&input.session_id, data.clone(), target).await?;
        }
    }

    if protocol == Protocol::Tcp && mode == SessionMode::Server {
        let mirror_targets = if input.broadcast.unwrap_or(false) {
            None
        } else {
            resolved_tcp_target_client
                .as_ref()
                .map(|client_id| vec![client_id.clone()])
        };
        mirror_tcp_server_send_to_local_clients(
            &app,
            state.inner(),
            &input.session_id,
            mirror_targets.as_deref(),
            &data,
        )
        .await;
    }

    // 尝试获取 client_addr（如果指定了目标客户端）
    let message_client_id = resolved_tcp_target_client.or_else(|| input.target_client.clone());

    let client_addr = if let Some(ref cid) = message_client_id {
        let s = session_state.read().await;
        s.clients.get(cid).map(|c| c.addr.clone()).or_else(|| {
            s.clients
                .values()
                .find(|client| client.addr == *cid)
                .map(|client| client.addr.clone())
        })
    } else {
        None
    };

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
        client_id: message_client_id,
        client_addr,
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

async fn mirror_tcp_server_send_to_local_clients(
    app: &AppHandle,
    state: &NetcatState,
    server_session_id: &str,
    target_client_ids: Option<&[String]>,
    data: &[u8],
) {
    let data_preview = bytes_to_display_string(data);
    let now = current_timestamp();

    let (server_addr, target_addrs, local_sessions) = {
        let sessions = state.sessions.read().await;
        let server_state = match sessions.get(server_session_id) {
            Some(session_state) => session_state.clone(),
            None => return,
        };

        let server = server_state.read().await;
        let server_host = server.session.host.clone();
        let server_port = server.session.port;
        let server_addr = format!("{}:{}", server_host, server_port);
        let target_addrs: Vec<String> = match target_client_ids {
            Some(client_ids) => client_ids
                .iter()
                .filter_map(|client_id| {
                    server
                        .clients
                        .get(client_id)
                        .map(|client| client.addr.clone())
                })
                .collect(),
            None => server
                .clients
                .values()
                .map(|client| client.addr.clone())
                .collect(),
        };
        drop(server);

        if target_addrs.is_empty() {
            return;
        }

        let mut local_sessions = Vec::new();
        for (session_id, session_state) in sessions.iter() {
            if session_id == server_session_id {
                continue;
            }

            let session = session_state.read().await;
            let is_matching_tcp_client = session.session.protocol == Protocol::Tcp
                && session.session.mode == SessionMode::Client
                && session.session.host == server_host
                && session.session.port == server_port
                && session
                    .session
                    .local_addr
                    .as_ref()
                    .map(|addr| target_addrs.iter().any(|target| target == addr))
                    .unwrap_or(false);

            if is_matching_tcp_client {
                local_sessions.push(session_state.clone());
            }
        }

        (server_addr, target_addrs, local_sessions)
    };

    tokio::time::sleep(std::time::Duration::from_millis(120)).await;

    for session_state in local_sessions {
        let (session_id, message) = {
            let mut session = session_state.write().await;
            let already_received = session.messages.iter().rev().take(20).any(|message| {
                message.direction == MessageDirection::Received
                    && message.data == data_preview
                    && message.size == data.len()
                    && message.client_addr.as_deref() == Some(server_addr.as_str())
                    && message.timestamp >= now.saturating_sub(1000)
            });

            if already_received {
                log::debug!(
                    "Netcat TCP 本地客户端会话已通过真实读取收到数据，跳过同步: session={}",
                    session.session.id
                );
                continue;
            }

            let message = NetcatMessage {
                id: generate_id(),
                session_id: session.session.id.clone(),
                direction: MessageDirection::Received,
                data: data_preview.clone(),
                format: DataFormat::Text,
                size: data.len(),
                timestamp: now,
                client_id: None,
                client_addr: Some(server_addr.clone()),
            };

            session.session.bytes_received += data.len() as u64;
            session.session.message_count += 1;
            session.session.last_activity = Some(now);
            session.messages.push(message.clone());

            if session.messages.len() > 1000 {
                session.messages.remove(0);
            }

            (session.session.id.clone(), message)
        };

        let _ = app.emit(
            "netcat-event",
            NetcatEvent::MessageReceived {
                session_id,
                message,
            },
        );
    }

    if !target_addrs.is_empty() {
        log::info!(
            "Netcat TCP 服务端发送已同步到本地客户端会话: targets={:?}",
            target_addrs
        );
    }
}

/// 获取所有会话
#[tauri::command]
#[specta::specta]
pub async fn netcat_get_sessions(state: State<'_, NetcatState>) -> AppResult<Vec<NetcatSession>> {
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
#[specta::specta]
pub async fn netcat_get_session(
    state: State<'_, NetcatState>,
    session_id: String,
) -> AppResult<NetcatSession> {
    let sessions = state.sessions.read().await;
    let session_state = sessions.get(&session_id).ok_or("会话不存在")?;
    let s = session_state.read().await;
    Ok(s.session.clone())
}

/// 获取会话消息
#[tauri::command]
#[specta::specta]
pub async fn netcat_get_messages(
    state: State<'_, NetcatState>,
    session_id: String,
    limit: Option<usize>,
    offset: Option<usize>,
) -> AppResult<Vec<NetcatMessage>> {
    let sessions = state.sessions.read().await;
    let session_state = sessions.get(&session_id).ok_or("会话不存在")?;
    let s = session_state.read().await;

    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(100);

    let messages: Vec<NetcatMessage> = s
        .messages
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
#[specta::specta]
pub async fn netcat_get_clients(
    state: State<'_, NetcatState>,
    session_id: String,
) -> AppResult<Vec<ConnectedClient>> {
    let sessions = state.sessions.read().await;
    let session_state = sessions.get(&session_id).ok_or("会话不存在")?;
    let s = session_state.read().await;

    Ok(s.clients.values().cloned().collect())
}

/// 清空会话消息
#[tauri::command]
#[specta::specta]
pub async fn netcat_clear_messages(
    state: State<'_, NetcatState>,
    session_id: String,
) -> AppResult<()> {
    let sessions = state.sessions.read().await;
    let session_state = sessions.get(&session_id).ok_or("会话不存在")?;
    let mut s = session_state.write().await;
    s.messages.clear();
    Ok(())
}

/// 断开指定客户端（仅服务器模式）
#[tauri::command]
#[specta::specta]
pub async fn netcat_disconnect_client(
    state: State<'_, NetcatState>,
    session_id: String,
    client_id: String,
) -> AppResult<()> {
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
#[derive(Debug, Clone, serde::Deserialize, specta::Type)]
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
#[specta::specta]
pub async fn netcat_fetch_http(config: HttpFetchConfig) -> AppResult<String> {
    use reqwest::{Client, Method};
    use std::time::Duration;

    log::info!(
        "Netcat HTTP 请求: url={}, method={:?}",
        config.url,
        config.method
    );

    // 创建 HTTP 客户端，配置更宽松的选项
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5))
        .no_proxy() // 禁用系统代理
        .user_agent("CodeShelf-Netcat/1.0")
        .danger_accept_invalid_certs(true) // 接受无效证书（用于本地测试）
        .build()
        .map_err(|e| crate::error::AppError::from(format!("创建 HTTP 客户端失败: {}", e)))?;

    // 解析 HTTP 方法
    let method = match config
        .method
        .as_deref()
        .unwrap_or("GET")
        .to_uppercase()
        .as_str()
    {
        "GET" => Method::GET,
        "POST" => Method::POST,
        "PUT" => Method::PUT,
        "DELETE" => Method::DELETE,
        "PATCH" => Method::PATCH,
        "HEAD" => Method::HEAD,
        other => {
            return Err(crate::error::AppError::from(format!(
                "不支持的 HTTP 方法: {}",
                other
            )))
        }
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

    let response = request.send().await.map_err(|e| {
        // 提供更详细的错误信息
        let err_detail = if e.is_connect() {
            format!("连接失败 (目标服务器可能未启动或防火墙阻止): {}", e)
        } else if e.is_timeout() {
            format!("请求超时: {}", e)
        } else if e.is_request() {
            format!("请求错误: {}", e)
        } else {
            format!("HTTP 请求失败: {}", e)
        };
        log::error!("Netcat HTTP 请求失败: {}", err_detail);
        err_detail
    })?;

    let status = response.status();
    log::info!("Netcat HTTP 响应状态: {}", status);

    if !status.is_success() {
        return Err(crate::error::AppError::from(format!(
            "HTTP 请求失败: {} {}",
            status.as_u16(),
            status.canonical_reason().unwrap_or("")
        )));
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
        .map_err(|e| crate::error::AppError::from(format!("读取响应失败: {}", e)))?;

    log::info!(
        "Netcat HTTP 响应: {} bytes, content-type={}, preview={}",
        text.len(),
        content_type,
        &text[..text.len().min(100)]
    );

    // 如果是 JSON 并且指定了路径，则提取
    if content_type.contains("application/json") || content_type.contains("text/json") {
        if let Some(path) = config.json_path {
            if !path.trim().is_empty() {
                let result = extract_json_path(&text, &path)?;
                log::info!(
                    "Netcat HTTP JSON 提取结果: {}",
                    &result[..result.len().min(100)]
                );
                return Ok(result);
            }
        }
    }

    Ok(text)
}

/// 从 JSON 中提取指定路径的值
fn extract_json_path(json_str: &str, path: &str) -> AppResult<String> {
    let json: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| crate::error::AppError::from(format!("JSON 解析失败: {}", e)))?;

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
fn parse_input_data(data: &str, format: DataFormat) -> AppResult<Vec<u8>> {
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

            if !hex_str.len().is_multiple_of(2) {
                return Err(crate::error::AppError::from(
                    "十六进制字符串长度必须为偶数".to_string(),
                ));
            }

            (0..hex_str.len())
                .step_by(2)
                .map(|i| {
                    u8::from_str_radix(&hex_str[i..i + 2], 16)
                        .map_err(|e| crate::error::AppError::from(format!("无效的十六进制: {}", e)))
                })
                .collect()
        }
        DataFormat::Base64 => {
            use base64::{engine::general_purpose, Engine as _};
            general_purpose::STANDARD
                .decode(data.trim())
                .map_err(|e| crate::error::AppError::from(format!("Base64 解码失败: {}", e)))
        }
    }
}

/// 将字节转换为显示字符串
fn bytes_to_display_string(data: &[u8]) -> String {
    match String::from_utf8(data.to_vec()) {
        Ok(s) => s,
        Err(_) => data
            .iter()
            .map(|b| format!("{:02X}", b))
            .collect::<Vec<_>>()
            .join(" "),
    }
}

/// 获取当前时间戳
fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
