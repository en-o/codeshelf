// TCP 服务器实现

use super::types::*;
use crate::commands::toolbox::generate_id;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, RwLock};
use tauri::{AppHandle, Emitter};

/// 连接的客户端写入器
struct ClientWriter {
    tx: mpsc::Sender<Vec<u8>>,
}

/// 全局服务器客户端管理
use once_cell::sync::Lazy;
use tokio::sync::RwLock as TokioRwLock;

static SERVER_CLIENTS: Lazy<TokioRwLock<HashMap<String, HashMap<String, ClientWriter>>>> =
    Lazy::new(|| TokioRwLock::new(HashMap::new()));

/// 启动 TCP 服务器
pub async fn start_tcp_server(
    app: AppHandle,
    session_state: Arc<RwLock<SessionState>>,
    host: String,
    port: u16,
) -> Result<(), String> {
    let session_id = {
        let state = session_state.read().await;
        state.session.id.clone()
    };

    // 绑定监听
    let addr = format!("{}:{}", host, port);
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| {
            let err_msg = if e.kind() == std::io::ErrorKind::AddrInUse {
                format!("端口 {} 已被占用，请先停止占用该端口的服务或选择其他端口", port)
            } else {
                format!("绑定端口失败: {}", e)
            };
            // 更新状态为错误
            let session_state_clone = session_state.clone();
            let app_clone = app.clone();
            let session_id_clone = session_id.clone();
            tokio::spawn(async move {
                let mut state = session_state_clone.write().await;
                state.session.status = SessionStatus::Error;
                state.session.error_message = Some(err_msg.clone());
                emit_status_changed(&app_clone, &session_id_clone, SessionStatus::Error, Some(err_msg));
            });
            format!("绑定端口失败: {}", e)
        })?;

    // 更新状态为监听中
    {
        let mut state = session_state.write().await;
        state.session.status = SessionStatus::Listening;
        state.session.connected_at = Some(current_timestamp());
    }

    emit_status_changed(&app, &session_id, SessionStatus::Listening, None);

    // 初始化客户端存储
    SERVER_CLIENTS.write().await.insert(session_id.clone(), HashMap::new());

    // 创建关闭通道
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
    {
        let mut state = session_state.write().await;
        state.shutdown_tx = Some(shutdown_tx);
    }

    // 接受连接循环
    loop {
        tokio::select! {
            _ = shutdown_rx.recv() => {
                break;
            }
            result = listener.accept() => {
                match result {
                    Ok((stream, addr)) => {
                        let client_id = generate_id();
                        let client_addr = addr.to_string();

                        handle_client_connection(
                            app.clone(),
                            session_state.clone(),
                            session_id.clone(),
                            client_id,
                            client_addr,
                            stream,
                        ).await;
                    }
                    Err(e) => {
                        eprintln!("接受连接失败: {}", e);
                    }
                }
            }
        }
    }

    // 清理
    {
        let mut state = session_state.write().await;
        state.session.status = SessionStatus::Disconnected;
        state.clients.clear();
    }

    SERVER_CLIENTS.write().await.remove(&session_id);
    emit_status_changed(&app, &session_id, SessionStatus::Disconnected, None);

    Ok(())
}

/// 处理客户端连接
async fn handle_client_connection(
    app: AppHandle,
    session_state: Arc<RwLock<SessionState>>,
    session_id: String,
    client_id: String,
    client_addr: String,
    stream: TcpStream,
) {
    let now = current_timestamp();

    // 创建客户端信息
    let client = ConnectedClient {
        id: client_id.clone(),
        addr: client_addr.clone(),
        connected_at: now,
        last_activity: now,
        bytes_sent: 0,
        bytes_received: 0,
    };

    // 添加到会话状态
    {
        let mut state = session_state.write().await;
        state.clients.insert(client_id.clone(), client.clone());
        state.session.client_count = state.clients.len() as u32;
    }

    // 发送客户端连接事件
    let _ = app.emit("netcat-event", NetcatEvent::ClientConnected {
        session_id: session_id.clone(),
        client: client.clone(),
    });

    // 分割流
    let (mut reader, writer) = stream.into_split();
    let writer = Arc::new(RwLock::new(writer));

    // 创建发送通道
    let (send_tx, mut send_rx) = mpsc::channel::<Vec<u8>>(100);

    // 保存客户端写入器
    {
        let mut servers = SERVER_CLIENTS.write().await;
        if let Some(clients) = servers.get_mut(&session_id) {
            clients.insert(client_id.clone(), ClientWriter { tx: send_tx });
        }
    }

    let session_state_clone = session_state.clone();
    let app_clone = app.clone();
    let session_id_clone = session_id.clone();
    let client_id_clone = client_id.clone();

    // 启动发送任务
    let writer_clone = writer.clone();
    let session_state_clone2 = session_state.clone();
    let client_id_clone2 = client_id.clone();
    let client_addr_clone = client_addr.clone();

    tokio::spawn(async move {
        log::info!("Netcat Server 发送任务启动: client={}", client_addr_clone);
        while let Some(data) = send_rx.recv().await {
            log::info!("Netcat Server 从通道收到数据: {} bytes, 准备写入客户端 {}",
                data.len(), client_addr_clone);

            let mut w = writer_clone.write().await;
            if let Err(e) = w.write_all(&data).await {
                log::error!("发送数据到客户端失败: {}", e);
                break;
            }
            // 刷新缓冲区，确保数据立即发送
            if let Err(e) = w.flush().await {
                log::error!("刷新数据到客户端失败: {}", e);
                break;
            }

            log::info!("Netcat Server 数据已写入并刷新到客户端: {} bytes", data.len());

            // 更新统计
            let mut state = session_state_clone2.write().await;
            state.session.bytes_sent += data.len() as u64;
            if let Some(client) = state.clients.get_mut(&client_id_clone2) {
                client.bytes_sent += data.len() as u64;
                client.last_activity = current_timestamp();
            }
        }
        log::info!("Netcat Server 发送任务结束: client={}", client_addr_clone);
    });

    // 启动读取任务
    tokio::spawn(async move {
        let mut buffer = vec![0u8; 8192];
        let mut message_count: u64 = 0;
        log::info!("Netcat Server 读取任务启动: client={}", client_addr);

        loop {
            log::debug!("Netcat Server [{}] 等待读取数据 (已收{}条): client={}",
                client_id_clone, message_count, client_addr);

            // 使用 tokio::time::timeout 防止永久阻塞
            let read_result = tokio::time::timeout(
                std::time::Duration::from_secs(300), // 5分钟超时
                reader.read(&mut buffer)
            ).await;

            match read_result {
                Ok(Ok(0)) => {
                    // 客户端断开
                    log::info!("Netcat Server [{}] 客户端断开 (read=0): client={}, 共收到{}条消息",
                        client_id_clone, client_addr, message_count);
                    break;
                }
                Ok(Ok(n)) => {
                    message_count += 1;
                    log::info!("Netcat Server [{}] 收到第{}条数据: {} bytes from {}",
                        client_id_clone, message_count, n, client_addr);
                    let data = buffer[..n].to_vec();

                    // 使用 spawn 来避免阻塞读取循环
                    let app_for_handle = app_clone.clone();
                    let state_for_handle = session_state_clone.clone();
                    let client_id_for_handle = client_id_clone.clone();
                    let client_addr_for_handle = client_addr.clone();
                    let msg_num = message_count;

                    tokio::spawn(async move {
                        handle_received_data(
                            &app_for_handle,
                            &state_for_handle,
                            data,
                            Some(client_id_for_handle.clone()),
                            Some(client_addr_for_handle.clone()),
                        ).await;
                        log::debug!("Netcat Server [{}] 第{}条数据处理完成", client_id_for_handle, msg_num);
                    });

                    log::debug!("Netcat Server [{}] 数据已提交处理: client={}", client_id_clone, client_addr);
                }
                Ok(Err(e)) => {
                    log::error!("Netcat Server [{}] 读取客户端数据失败: {} - {}, 已收到{}条消息",
                        client_id_clone, client_addr, e, message_count);
                    break;
                }
                Err(_) => {
                    log::warn!("Netcat Server [{}] 读取超时 (5分钟无数据): client={}",
                        client_id_clone, client_addr);
                    // 继续等待，不断开连接
                    continue;
                }
            }
        }

        log::info!("Netcat Server 读取任务结束: client={}, 共收到{}条消息", client_addr, message_count);
        // 客户端断开处理
        handle_client_disconnect(
            &app_clone,
            &session_state_clone,
            &session_id_clone,
            &client_id_clone,
        ).await;
    });
}

/// 处理客户端断开
async fn handle_client_disconnect(
    app: &AppHandle,
    session_state: &Arc<RwLock<SessionState>>,
    session_id: &str,
    client_id: &str,
) {
    // 从会话状态移除
    {
        let mut state = session_state.write().await;
        state.clients.remove(client_id);
        state.session.client_count = state.clients.len() as u32;
    }

    // 从全局存储移除
    {
        let mut servers = SERVER_CLIENTS.write().await;
        if let Some(clients) = servers.get_mut(session_id) {
            clients.remove(client_id);
        }
    }

    // 发送断开事件
    let _ = app.emit("netcat-event", NetcatEvent::ClientDisconnected {
        session_id: session_id.to_string(),
        client_id: client_id.to_string(),
    });
}

/// 处理接收到的数据
async fn handle_received_data(
    app: &AppHandle,
    session_state: &Arc<RwLock<SessionState>>,
    data: Vec<u8>,
    client_id: Option<String>,
    client_addr: Option<String>,
) {
    let now = current_timestamp();
    let message_id = generate_id();
    let data_preview = bytes_to_display_string(&data);

    // 安全截断预览（字符边界安全）
    let preview_safe: String = data_preview.chars().take(50).collect();
    log::info!("Netcat Server handle_received_data: {} bytes, from={:?}, preview={}",
        data.len(), client_addr, preview_safe);

    // 使用超时来获取锁，避免死锁
    let lock_result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        session_state.write()
    ).await;

    let (session_id, message) = match lock_result {
        Ok(mut state) => {
            state.session.bytes_received += data.len() as u64;
            state.session.message_count += 1;
            state.session.last_activity = Some(now);

            // 更新客户端统计
            if let Some(ref cid) = client_id {
                if let Some(client) = state.clients.get_mut(cid) {
                    client.bytes_received += data.len() as u64;
                    client.last_activity = now;
                }
            }

            let message = NetcatMessage {
                id: message_id.clone(),
                session_id: state.session.id.clone(),
                direction: MessageDirection::Received,
                data: data_preview,
                format: DataFormat::Text,
                size: data.len(),
                timestamp: now,
                client_id,
                client_addr,
            };

            state.messages.push(message.clone());

            // 限制消息历史
            if state.messages.len() > 1000 {
                state.messages.remove(0);
            }

            let sid = state.session.id.clone();
            let msg_count = state.session.message_count;
            log::debug!("Netcat Server 状态更新完成: session={}, 消息总数={}", sid, msg_count);

            (sid, message)
        }
        Err(_) => {
            log::error!("Netcat Server 获取写锁超时，跳过此消息: id={}", message_id);
            return;
        }
    };

    // 发送事件 - 在锁释放后
    let event = NetcatEvent::MessageReceived {
        session_id: session_id.clone(),
        message,
    };

    log::debug!("Netcat Server 准备发送事件: session={}", session_id);
    match app.emit("netcat-event", &event) {
        Ok(_) => log::info!("Netcat Server 消息事件已发送: session={}", session_id),
        Err(e) => log::error!("Netcat Server 消息事件发送失败: {} (session={})", e, session_id),
    }
}

/// 发送数据到指定客户端
pub async fn send_to_client(session_id: &str, client_id: &str, data: Vec<u8>) -> Result<(), String> {
    log::info!("Netcat Server 发送数据到客户端: session={}, client={}, size={}",
        session_id, client_id, data.len());

    let servers = SERVER_CLIENTS.read().await;

    // 调试：打印当前所有会话和客户端
    log::debug!("当前会话列表: {:?}", servers.keys().collect::<Vec<_>>());

    if let Some(clients) = servers.get(session_id) {
        log::debug!("会话 {} 的客户端列表: {:?}", session_id, clients.keys().collect::<Vec<_>>());

        if let Some(client) = clients.get(client_id) {
            match client.tx.send(data).await {
                Ok(_) => {
                    log::info!("Netcat Server 数据已发送到通道: client={}", client_id);
                    Ok(())
                }
                Err(e) => {
                    log::error!("Netcat Server 发送到通道失败: {}", e);
                    Err(format!("发送失败: {}", e))
                }
            }
        } else {
            log::error!("Netcat Server 客户端不存在: {}", client_id);
            Err("客户端不存在".to_string())
        }
    } else {
        log::error!("Netcat Server 会话不存在: {}", session_id);
        Err("会话不存在".to_string())
    }
}

/// 广播数据到所有客户端
pub async fn broadcast_to_clients(session_id: &str, data: Vec<u8>) -> Result<(), String> {
    log::info!("Netcat Server 广播数据: session={}, size={}", session_id, data.len());

    let servers = SERVER_CLIENTS.read().await;
    if let Some(clients) = servers.get(session_id) {
        let client_count = clients.len();
        log::info!("Netcat Server 广播到 {} 个客户端", client_count);

        if client_count == 0 {
            log::warn!("Netcat Server 没有已连接的客户端");
            return Err("没有已连接的客户端".to_string());
        }

        for (client_id, client) in clients.iter() {
            match client.tx.send(data.clone()).await {
                Ok(_) => log::debug!("广播到客户端 {} 成功", client_id),
                Err(e) => log::error!("广播到客户端 {} 失败: {}", client_id, e),
            }
        }
        Ok(())
    } else {
        log::error!("Netcat Server 会话不存在: {}", session_id);
        Err("会话不存在".to_string())
    }
}

/// 断开指定客户端连接
pub async fn disconnect_client(session_id: &str, client_id: &str) -> Result<(), String> {
    let mut servers = SERVER_CLIENTS.write().await;
    if let Some(clients) = servers.get_mut(session_id) {
        clients.remove(client_id);
        Ok(())
    } else {
        Err("会话不存在".to_string())
    }
}

/// 断开所有客户端连接（清理服务器资源）
pub async fn shutdown_all_clients(session_id: &str) {
    let mut servers = SERVER_CLIENTS.write().await;
    if let Some(clients) = servers.get_mut(session_id) {
        // 清空所有客户端，发送通道会被 drop，导致发送任务退出
        clients.clear();
        log::info!("Netcat Server 所有客户端已断开: {}", session_id);
    }
    // 移除整个会话的客户端存储
    servers.remove(session_id);
}

/// 发送状态变更事件
fn emit_status_changed(app: &AppHandle, session_id: &str, status: SessionStatus, error: Option<String>) {
    let event = NetcatEvent::StatusChanged {
        session_id: session_id.to_string(),
        status,
        error: error.clone(),
    };

    match app.emit("netcat-event", &event) {
        Ok(_) => log::info!("Netcat Server 状态变更: session={}, status={:?}", session_id, status),
        Err(e) => log::error!("Netcat Server 状态事件发送失败: {}", e),
    }
}

/// 获取当前时间戳
fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// 将字节转换为显示字符串
fn bytes_to_display_string(data: &[u8]) -> String {
    match String::from_utf8(data.to_vec()) {
        Ok(s) => s,
        Err(_) => {
            data.iter()
                .map(|b| format!("{:02X}", b))
                .collect::<Vec<_>>()
                .join(" ")
        }
    }
}
