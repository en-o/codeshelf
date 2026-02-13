// UDP 客户端/服务器实现

use super::types::*;
use crate::commands::toolbox::generate_id;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::net::UdpSocket;
use tokio::sync::{mpsc, RwLock};
use tauri::{AppHandle, Emitter};

/// 全局 UDP 套接字存储
use once_cell::sync::Lazy;
use tokio::sync::RwLock as TokioRwLock;

pub static UDP_SOCKETS: Lazy<TokioRwLock<HashMap<String, UdpSocketState>>> =
    Lazy::new(|| TokioRwLock::new(HashMap::new()));

pub struct UdpSocketState {
    pub send_tx: mpsc::Sender<(Vec<u8>, Option<SocketAddr>)>,
    pub target_addr: Option<SocketAddr>,
}

/// 启动 UDP 会话
pub async fn start_udp_session(
    app: AppHandle,
    session_state: Arc<RwLock<SessionState>>,
    host: String,
    port: u16,
    mode: SessionMode,
) -> Result<(), String> {
    let session_id = {
        let state = session_state.read().await;
        state.session.id.clone()
    };

    let bind_addr = match mode {
        SessionMode::Client => "0.0.0.0:0".to_string(), // 随机端口
        SessionMode::Server => format!("{}:{}", host, port),
    };

    // 绑定 UDP 套接字
    let socket = UdpSocket::bind(&bind_addr)
        .await
        .map_err(|e| format!("绑定 UDP 端口失败: {}", e))?;

    let socket = Arc::new(socket);

    // 如果是客户端模式，连接到目标
    let target_addr = if mode == SessionMode::Client {
        let addr = format!("{}:{}", host, port);
        Some(addr.parse::<SocketAddr>().map_err(|e| format!("解析地址失败: {}", e))?)
    } else {
        None
    };

    // 更新状态
    let now = current_timestamp();
    let status = match mode {
        SessionMode::Client => SessionStatus::Connected,
        SessionMode::Server => SessionStatus::Listening,
    };

    {
        let mut state = session_state.write().await;
        state.session.status = status;
        state.session.connected_at = Some(now);
        state.session.last_activity = Some(now);
    }

    emit_status_changed(&app, &session_id, status, None);

    // 创建关闭通道
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
    {
        let mut state = session_state.write().await;
        state.shutdown_tx = Some(shutdown_tx);
    }

    // 创建发送通道
    let (send_tx, mut send_rx) = mpsc::channel::<(Vec<u8>, Option<SocketAddr>)>(100);

    // 保存到全局存储
    UDP_SOCKETS.write().await.insert(session_id.clone(), UdpSocketState {
        send_tx,
        target_addr,
    });

    let socket_clone = socket.clone();
    let session_state_clone = session_state.clone();
    let app_clone = app.clone();
    let session_id_clone = session_id.clone();
    let mode_clone = mode;

    // 启动发送任务
    let socket_send = socket.clone();
    let session_state_send = session_state.clone();

    tokio::spawn(async move {
        while let Some((data, addr)) = send_rx.recv().await {
            let result = match addr {
                Some(target) => socket_send.send_to(&data, target).await,
                None => {
                    // 使用默认目标（仅客户端模式）
                    if let Some(ref target) = target_addr {
                        socket_send.send_to(&data, target).await
                    } else {
                        continue;
                    }
                }
            };

            if let Err(e) = result {
                eprintln!("UDP 发送失败: {}", e);
                continue;
            }

            // 更新统计
            let mut state = session_state_send.write().await;
            state.session.bytes_sent += data.len() as u64;
            state.session.last_activity = Some(current_timestamp());
        }
    });

    // 启动接收任务
    tokio::spawn(async move {
        let mut buffer = vec![0u8; 65535];

        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    break;
                }
                result = socket_clone.recv_from(&mut buffer) => {
                    match result {
                        Ok((n, addr)) => {
                            let data = buffer[..n].to_vec();
                            handle_received_data(
                                &app_clone,
                                &session_state_clone,
                                data,
                                addr.to_string(),
                                mode_clone,
                            ).await;
                        }
                        Err(e) => {
                            eprintln!("UDP 接收失败: {}", e);
                        }
                    }
                }
            }
        }

        // 清理
        UDP_SOCKETS.write().await.remove(&session_id_clone);

        let mut state = session_state_clone.write().await;
        state.session.status = SessionStatus::Disconnected;

        emit_status_changed(&app_clone, &session_id_clone, SessionStatus::Disconnected, None);
    });

    Ok(())
}

/// 发送 UDP 数据
pub async fn send_udp_data(
    session_id: &str,
    data: Vec<u8>,
    target_addr: Option<String>,
) -> Result<(), String> {
    let sockets = UDP_SOCKETS.read().await;
    if let Some(socket_state) = sockets.get(session_id) {
        let addr = match target_addr {
            Some(addr_str) => Some(addr_str.parse::<SocketAddr>().map_err(|e| format!("解析地址失败: {}", e))?),
            None => socket_state.target_addr,
        };

        socket_state.send_tx.send((data, addr))
            .await
            .map_err(|e| format!("发送失败: {}", e))
    } else {
        Err("会话不存在".to_string())
    }
}

/// 关闭 UDP 会话（清理资源）
pub async fn shutdown_udp_session(session_id: &str) {
    // 移除发送通道会导致发送任务退出
    let removed = UDP_SOCKETS.write().await.remove(session_id);
    if removed.is_some() {
        log::info!("Netcat UDP 会话已清理: {}", session_id);
    }
}

/// 处理接收到的数据
async fn handle_received_data(
    app: &AppHandle,
    session_state: &Arc<RwLock<SessionState>>,
    data: Vec<u8>,
    from_addr: String,
    mode: SessionMode,
) {
    let now = current_timestamp();
    let message_id = generate_id();

    let (session_id, message) = {
        let mut state = session_state.write().await;
        state.session.bytes_received += data.len() as u64;
        state.session.message_count += 1;
        state.session.last_activity = Some(now);

        // 服务器模式下跟踪客户端
        let client_id = if mode == SessionMode::Server {
            let client_id = format!("udp-{}", from_addr.replace([':', '.'], "-"));
            if !state.clients.contains_key(&client_id) {
                let client = ConnectedClient {
                    id: client_id.clone(),
                    addr: from_addr.clone(),
                    connected_at: now,
                    last_activity: now,
                    bytes_sent: 0,
                    bytes_received: data.len() as u64,
                };
                state.clients.insert(client_id.clone(), client.clone());
                state.session.client_count = state.clients.len() as u32;

                // 发送新客户端事件
                let _ = app.emit("netcat-event", NetcatEvent::ClientConnected {
                    session_id: state.session.id.clone(),
                    client,
                });
            } else if let Some(client) = state.clients.get_mut(&client_id) {
                client.bytes_received += data.len() as u64;
                client.last_activity = now;
            }
            Some(client_id)
        } else {
            None
        };

        let message = NetcatMessage {
            id: message_id,
            session_id: state.session.id.clone(),
            direction: MessageDirection::Received,
            data: bytes_to_display_string(&data),
            format: DataFormat::Text,
            size: data.len(),
            timestamp: now,
            client_id,
            client_addr: Some(from_addr),
        };

        state.messages.push(message.clone());

        // 限制消息历史
        if state.messages.len() > 1000 {
            state.messages.remove(0);
        }

        (state.session.id.clone(), message)
    };

    // 发送事件
    let _ = app.emit("netcat-event", NetcatEvent::MessageReceived {
        session_id,
        message,
    });
}

/// 发送状态变更事件
fn emit_status_changed(app: &AppHandle, session_id: &str, status: SessionStatus, error: Option<String>) {
    let _ = app.emit("netcat-event", NetcatEvent::StatusChanged {
        session_id: session_id.to_string(),
        status,
        error,
    });
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
