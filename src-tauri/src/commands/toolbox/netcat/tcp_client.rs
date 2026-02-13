// TCP 客户端实现

use super::types::*;
use crate::commands::toolbox::generate_id;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, RwLock};
use tauri::{AppHandle, Emitter};

/// 启动 TCP 客户端会话
pub async fn start_tcp_client(
    app: AppHandle,
    session_state: Arc<RwLock<SessionState>>,
    host: String,
    port: u16,
    timeout_ms: u64,
) -> Result<(), String> {
    let session_id = {
        let state = session_state.read().await;
        state.session.id.clone()
    };

    // 更新状态为连接中
    update_status(&app, &session_state, SessionStatus::Connecting, None).await;

    // 尝试连接
    let addr = format!("{}:{}", host, port);
    let connect_future = TcpStream::connect(&addr);
    let timeout = Duration::from_millis(timeout_ms);

    let stream = match tokio::time::timeout(timeout, connect_future).await {
        Ok(Ok(stream)) => stream,
        Ok(Err(e)) => {
            let err_msg = format!("连接失败: {}", e);
            update_status(&app, &session_state, SessionStatus::Error, Some(err_msg.clone())).await;
            return Err(err_msg);
        }
        Err(_) => {
            let err_msg = "连接超时".to_string();
            update_status(&app, &session_state, SessionStatus::Error, Some(err_msg.clone())).await;
            return Err(err_msg);
        }
    };

    // 连接成功
    let now = current_timestamp();
    {
        let mut state = session_state.write().await;
        state.session.status = SessionStatus::Connected;
        state.session.connected_at = Some(now);
        state.session.last_activity = Some(now);
        state.session.error_message = None;
    }

    emit_status_changed(&app, &session_id, SessionStatus::Connected, None);

    // 创建关闭通道
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
    {
        let mut state = session_state.write().await;
        state.shutdown_tx = Some(shutdown_tx);
    }

    // 分割流
    let (mut reader, writer) = stream.into_split();
    let writer = Arc::new(RwLock::new(writer));

    // 保存 writer 到某处以便发送数据（使用全局状态或闭包）
    // 这里我们用事件系统处理发送

    // 创建发送通道
    let (send_tx, mut send_rx) = mpsc::channel::<Vec<u8>>(100);

    // 保存发送通道
    TCP_SENDERS.write().await.insert(session_id.clone(), send_tx);

    let session_state_clone = session_state.clone();
    let app_clone = app.clone();
    let session_id_clone = session_id.clone();

    // 启动读取任务
    let read_task = tokio::spawn(async move {
        let mut buffer = vec![0u8; 8192];

        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    break;
                }
                result = reader.read(&mut buffer) => {
                    match result {
                        Ok(0) => {
                            // 连接关闭
                            update_status(&app_clone, &session_state_clone, SessionStatus::Disconnected, None).await;
                            break;
                        }
                        Ok(n) => {
                            let data = buffer[..n].to_vec();
                            handle_received_data(&app_clone, &session_state_clone, data, None).await;
                        }
                        Err(e) => {
                            let err_msg = format!("读取错误: {}", e);
                            update_status(&app_clone, &session_state_clone, SessionStatus::Error, Some(err_msg)).await;
                            break;
                        }
                    }
                }
            }
        }

        // 清理
        TCP_SENDERS.write().await.remove(&session_id_clone);
    });

    // 启动发送任务
    let writer_clone = writer.clone();
    let session_state_clone2 = session_state.clone();
    let addr_clone = addr.clone();
    let session_id_for_send = session_id.clone();

    tokio::spawn(async move {
        log::info!("Netcat Client 发送任务启动: target={}", addr_clone);
        while let Some(data) = send_rx.recv().await {
            log::info!("Netcat Client 从通道收到数据: {} bytes, 准备写入服务器", data.len());

            let mut w = writer_clone.write().await;
            if let Err(e) = w.write_all(&data).await {
                log::error!("发送数据失败: {}", e);
                // 发送失败时，清理 sender 并退出
                TCP_SENDERS.write().await.remove(&session_id_for_send);
                break;
            }
            // 刷新缓冲区，确保数据立即发送
            if let Err(e) = w.flush().await {
                log::error!("刷新数据失败: {}", e);
                // 刷新失败时，清理 sender 并退出
                TCP_SENDERS.write().await.remove(&session_id_for_send);
                break;
            }

            log::info!("Netcat Client 数据已写入并刷新到服务器: {} bytes", data.len());

            // 更新统计
            let mut state = session_state_clone2.write().await;
            state.session.bytes_sent += data.len() as u64;
            state.session.last_activity = Some(current_timestamp());
        }
        log::info!("Netcat Client 发送任务结束: target={}", addr_clone);
        // 任务结束时确保清理
        TCP_SENDERS.write().await.remove(&session_id_for_send);
    });

    // 等待读取任务完成
    let _ = read_task.await;

    Ok(())
}

/// 发送数据到 TCP 客户端
pub async fn send_tcp_client_data(session_id: &str, data: Vec<u8>) -> Result<(), String> {
    log::info!("Netcat Client 发送数据: session={}, size={}", session_id, data.len());

    let senders = TCP_SENDERS.read().await;

    // 调试：打印当前所有会话
    log::debug!("当前客户端会话列表: {:?}", senders.keys().collect::<Vec<_>>());

    if let Some(tx) = senders.get(session_id) {
        match tx.send(data).await {
            Ok(_) => {
                log::info!("Netcat Client 数据已发送到通道: session={}", session_id);
                Ok(())
            }
            Err(e) => {
                log::error!("Netcat Client 发送到通道失败: {}", e);
                Err(format!("发送失败: {}", e))
            }
        }
    } else {
        log::error!("Netcat Client 会话不存在或未连接: {}", session_id);
        Err("会话不存在或未连接".to_string())
    }
}

/// 更新会话状态
async fn update_status(
    app: &AppHandle,
    session_state: &Arc<RwLock<SessionState>>,
    status: SessionStatus,
    error: Option<String>,
) {
    let session_id = {
        let mut state = session_state.write().await;
        state.session.status = status;
        state.session.error_message = error.clone();
        if status == SessionStatus::Disconnected || status == SessionStatus::Error {
            state.shutdown_tx = None;
        }
        state.session.id.clone()
    };

    emit_status_changed(app, &session_id, status, error);
}

/// 处理接收到的数据
async fn handle_received_data(
    app: &AppHandle,
    session_state: &Arc<RwLock<SessionState>>,
    data: Vec<u8>,
    client_id: Option<String>,
) {
    let now = current_timestamp();
    let message_id = generate_id();
    let data_preview = bytes_to_display_string(&data);

    // 安全截断预览（字符边界安全）
    let preview_safe: String = data_preview.chars().take(50).collect();
    log::info!("Netcat Client 收到数据: {} bytes, preview={}",
        data.len(), preview_safe);

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

            let message = NetcatMessage {
                id: message_id.clone(),
                session_id: state.session.id.clone(),
                direction: MessageDirection::Received,
                data: data_preview,
                format: DataFormat::Text,
                size: data.len(),
                timestamp: now,
                client_id: client_id.clone(),
                client_addr: None,
            };

            state.messages.push(message.clone());

            // 限制消息历史
            if state.messages.len() > 1000 {
                state.messages.remove(0);
            }

            let sid = state.session.id.clone();
            let msg_count = state.session.message_count;
            log::debug!("Netcat Client 状态更新完成: session={}, 消息总数={}", sid, msg_count);

            (sid, message)
        }
        Err(_) => {
            log::error!("Netcat Client 获取写锁超时，跳过此消息: id={}", message_id);
            return;
        }
    };

    // 发送事件 - 在锁释放后
    let event = NetcatEvent::MessageReceived {
        session_id: session_id.clone(),
        message,
    };

    log::debug!("Netcat Client 准备发送事件: session={}", session_id);
    match app.emit("netcat-event", &event) {
        Ok(_) => log::info!("Netcat Client 消息事件已发送: session={}", session_id),
        Err(e) => log::error!("Netcat Client 消息事件发送失败: {} (session={})", e, session_id),
    }
}

/// 发送状态变更事件
fn emit_status_changed(app: &AppHandle, session_id: &str, status: SessionStatus, error: Option<String>) {
    let event = NetcatEvent::StatusChanged {
        session_id: session_id.to_string(),
        status,
        error: error.clone(),
    };

    match app.emit("netcat-event", &event) {
        Ok(_) => log::info!("Netcat 状态变更事件已发送: session={}, status={:?}", session_id, status),
        Err(e) => log::error!("Netcat 状态变更事件发送失败: {}", e),
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
    // 尝试 UTF-8 解码
    match String::from_utf8(data.to_vec()) {
        Ok(s) => s,
        Err(_) => {
            // 转为十六进制
            data.iter()
                .map(|b| format!("{:02X}", b))
                .collect::<Vec<_>>()
                .join(" ")
        }
    }
}

// 全局 TCP 发送器存储
use tokio::sync::RwLock as TokioRwLock;
use once_cell::sync::Lazy;

pub static TCP_SENDERS: Lazy<TokioRwLock<std::collections::HashMap<String, mpsc::Sender<Vec<u8>>>>> =
    Lazy::new(|| TokioRwLock::new(std::collections::HashMap::new()));
