// SSH 隧道运行时：
// - run_tunnel_server: 长生命周期监听器，本地端口在隧道整个生命周期常驻，
//   每个入站连接从共享槽取"当前"SSH 句柄开 direct-tcpip。
// - run_reconnect_supervisor: 健康探测 + 反应式触发 + 指数退避自动重连，维护共享句柄。
//
// 关键：channel_open_* / disconnect 均为 `&self`，因此句柄用 Arc<Handle> 共享，
// 取句柄时只瞬时持有槽锁克隆 Arc，绝不跨越 await 持锁 —— 并发连接互不串行化。

use crate::error::AppResult;
use std::sync::Arc;

use russh::client;
use socket2::{Domain, Socket, Type};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio::sync::Semaphore;
use tokio::time::{sleep, timeout, Duration};

use super::super::SshTunnel;
use super::auth::connect_and_authenticate;
use super::{SharedHandle, SshClient, SshTunnelController, SSH_CONTROLLERS, SSH_TUNNELS};

/// 监听本地端口，每个入站连接通过"当前"SSH 句柄开 direct-tcpip。
/// 句柄在重连时被监督任务替换，本监听器不感知 —— 本地端口全程不释放。
pub(super) async fn run_tunnel_server(
    tunnel_id: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    expose_lan: bool,
    shared: SharedHandle,
    controller: Arc<SshTunnelController>,
) -> AppResult<()> {
    // 默认只绑 loopback：以前一律 0.0.0.0，整个局域网都能借这条隧道访问远端服务
    let addr = std::net::SocketAddr::from((
        crate::commands::toolbox::listen_ip(expose_lan),
        local_port,
    ));

    let socket = Socket::new(Domain::IPV4, Type::STREAM, None)
        .map_err(|e| crate::error::AppError::from(format!("创建 socket 失败: {}", e)))?;
    socket
        .set_reuse_address(true)
        .map_err(|e| crate::error::AppError::from(format!("设置 SO_REUSEADDR 失败: {}", e)))?;
    socket
        .set_linger(Some(std::time::Duration::from_secs(0)))
        .map_err(|e| crate::error::AppError::from(format!("设置 SO_LINGER 失败: {}", e)))?;
    socket
        .set_nonblocking(true)
        .map_err(|e| crate::error::AppError::from(format!("设置非阻塞失败: {}", e)))?;
    socket
        .bind(&addr.into())
        .map_err(|e| crate::error::AppError::from(format!("绑定端口失败: {}", e)))?;
    socket
        .listen(128)
        .map_err(|e| crate::error::AppError::from(format!("监听端口失败: {}", e)))?;

    let std_listener: std::net::TcpListener = socket.into();
    let listener = TcpListener::from_std(std_listener)
        .map_err(|e| crate::error::AppError::from(format!("创建 TcpListener 失败: {}", e)))?;

    log::info!(
        "SSH 隧道服务启动: localhost:{} -> ssh -> {}:{}",
        local_port,
        remote_host,
        remote_port
    );

    let semaphore = Arc::new(Semaphore::new(64));

    loop {
        if controller.is_stopped() {
            log::info!("SSH 隧道停止: {}", local_port);
            break;
        }

        let accept_result = timeout(Duration::from_secs(1), listener.accept()).await;
        match accept_result {
            Ok(Ok((inbound, peer_addr))) => {
                let permit = semaphore.clone().acquire_owned().await;
                if permit.is_err() {
                    continue;
                }

                let shared = shared.clone();
                let ctrl = controller.clone();
                let id = tunnel_id.clone();
                let rhost = remote_host.clone();
                let rport = remote_port;

                tokio::spawn(async move {
                    let _permit = permit;
                    ctrl.inc_connections();
                    update_tunnel_stats(&id).await;

                    if let Err(e) = handle_tunnel_connection(
                        inbound,
                        peer_addr,
                        shared,
                        &rhost,
                        rport,
                        ctrl.clone(),
                    )
                    .await
                    {
                        log::debug!("SSH 隧道连接错误 {}: {}", peer_addr, e);
                    }

                    ctrl.dec_connections();
                    update_tunnel_stats(&id).await;
                });
            }
            Ok(Err(e)) => {
                log::error!("accept 失败: {}", e);
            }
            Err(_) => continue,
        }
    }

    Ok(())
}

/// 处理一个入站连接：取当前句柄 -> 开 direct-tcpip -> 双向拷贝。
/// 句柄为 None（重连中）时最多等待 ~5s；打通失败时主动触发重连。
async fn handle_tunnel_connection(
    mut inbound: tokio::net::TcpStream,
    peer_addr: std::net::SocketAddr,
    shared: SharedHandle,
    remote_host: &str,
    remote_port: u16,
    controller: Arc<SshTunnelController>,
) -> AppResult<()> {
    // 取"当前"句柄：仅瞬时持槽锁克隆 Arc；重连中（None）则短轮询等待
    let handle = {
        let mut waited_ms: u64 = 0;
        loop {
            if controller.is_stopped() {
                return Ok(());
            }
            let cur = {
                let g = shared.lock().await;
                g.clone()
            };
            if let Some(h) = cur {
                break h;
            }
            if waited_ms >= 5000 {
                return Err(crate::error::AppError::from(
                    "SSH 会话重连中，连接暂不可用".to_string(),
                ));
            }
            sleep(Duration::from_millis(100)).await;
            waited_ms += 100;
        }
    };

    // channel_open_direct_tcpip 取 &self —— 此处不持有任何锁跨越 await
    let channel = match handle
        .channel_open_direct_tcpip(
            remote_host,
            remote_port as u32,
            peer_addr.ip().to_string(),
            peer_addr.port() as u32,
        )
        .await
    {
        Ok(c) => c,
        Err(e) => {
            // 打通失败：多半 SSH 会话已断，立即唤醒监督任务复核/重连
            controller.request_reconnect();
            return Err(crate::error::AppError::from(format!(
                "打开 direct-tcpip 失败: {}",
                e
            )));
        }
    };

    let mut stream = channel.into_stream();
    let (mut ri, mut wi) = inbound.split();
    let (mut ro, mut wo) = tokio::io::split(&mut stream);

    let ctrl1 = controller.clone();
    let ctrl2 = controller.clone();
    let check_interval = Duration::from_millis(100);

    let client_to_server = async {
        let mut buf = [0u8; 8192];
        loop {
            if ctrl1.is_stopped() {
                break;
            }
            match timeout(
                check_interval,
                tokio::io::AsyncReadExt::read(&mut ri, &mut buf),
            )
            .await
            {
                Ok(Ok(0)) => break,
                Ok(Ok(n)) => {
                    ctrl1.add_bytes_out(n as u64);
                    if tokio::io::AsyncWriteExt::write_all(&mut wo, &buf[..n])
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(Err(_)) => break,
                Err(_) => continue,
            }
        }
        let _ = wo.shutdown().await;
    };

    let server_to_client = async {
        let mut buf = [0u8; 8192];
        loop {
            if ctrl2.is_stopped() {
                break;
            }
            match timeout(
                check_interval,
                tokio::io::AsyncReadExt::read(&mut ro, &mut buf),
            )
            .await
            {
                Ok(Ok(0)) => break,
                Ok(Ok(n)) => {
                    ctrl2.add_bytes_in(n as u64);
                    if tokio::io::AsyncWriteExt::write_all(&mut wi, &buf[..n])
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(Err(_)) => break,
                Err(_) => continue,
            }
        }
        let _ = wi.shutdown().await;
    };

    tokio::join!(client_to_server, server_to_client);
    Ok(())
}

/// 重连监督器：维护共享句柄。
/// - 有句柄：周期(5s)或反应式触发后探测存活，存活则继续，断线则清槽转 reconnecting。
/// - 重连：指数退避 1s→2s→…→30s，无限重试直到手动停止；成功后回填句柄、状态 running。
/// - auto_reconnect=false：检测到断线即停止整个隧道（置 stopped、停掉监听器），不重试。
pub(super) async fn run_reconnect_supervisor(
    tunnel: SshTunnel,
    shared: SharedHandle,
    controller: Arc<SshTunnelController>,
) {
    let tunnel_id = tunnel.id.clone();
    let probe_interval = Duration::from_secs(5);
    let max_backoff: u64 = 30;
    let mut backoff: u64 = 1;

    loop {
        if controller.is_stopped() {
            break;
        }

        let current = {
            let g = shared.lock().await;
            g.clone()
        };

        if let Some(h) = current {
            // 有句柄：等待探测周期或反应式触发后复核存活
            tokio::select! {
                _ = sleep(probe_interval) => {}
                _ = controller.wait_reconnect_signal() => {}
            }
            if controller.is_stopped() {
                break;
            }
            if is_session_alive(&h).await {
                backoff = 1; // 健康，重置退避
                continue;
            }

            // 判定已断
            log::warn!("SSH 隧道 {} 会话断开", tunnel_id);
            let _ = h
                .disconnect(russh::Disconnect::ByApplication, "", "en")
                .await;
            {
                *shared.lock().await = None;
            }
            update_tunnel_stats(&tunnel_id).await;

            if !tunnel.auto_reconnect {
                // 不自动重连：停止整个隧道（含监听器），与旧语义一致
                set_last_error(&tunnel_id, "SSH 会话已断开".to_string()).await;
                controller.stop();
                break;
            }
            set_status(&tunnel_id, "reconnecting").await;
        } else {
            // 槽空（首连失败后进入）：仅自动重连场景会到这里
            if !tunnel.auto_reconnect {
                break;
            }
            set_status(&tunnel_id, "reconnecting").await;
        }

        // ---- 重连一次 ----
        if controller.is_stopped() {
            break;
        }
        match connect_and_authenticate(&tunnel).await {
            Ok(handle) => {
                if controller.is_stopped() {
                    let _ = handle
                        .disconnect(russh::Disconnect::ByApplication, "", "en")
                        .await;
                    break;
                }
                {
                    *shared.lock().await = Some(Arc::new(handle));
                }
                controller.inc_reconnects();
                set_status_clear_error(&tunnel_id, "running").await;
                update_tunnel_stats(&tunnel_id).await;
                backoff = 1;
                log::info!("SSH 隧道 {} 重连成功", tunnel_id);
                continue;
            }
            Err(e) => {
                set_last_error(&tunnel_id, e.to_string()).await;
                log::warn!(
                    "SSH 隧道 {} 重连失败: {}（{}s 后重试）",
                    tunnel_id,
                    e,
                    backoff
                );
            }
        }

        // ---- 退避（可被停止/触发打断）----
        tokio::select! {
            _ = sleep(Duration::from_secs(backoff)) => {}
            _ = controller.wait_reconnect_signal() => {}
        }
        backoff = (backoff * 2).min(max_backoff);
    }

    // 退出清理：断开当前句柄
    let cur = {
        let mut g = shared.lock().await;
        g.take()
    };
    if let Some(h) = cur {
        let _ = h
            .disconnect(russh::Disconnect::ByApplication, "", "en")
            .await;
    }

    // 仅当当前注册的控制器仍是自己时才落 stopped 并摘除，避免覆盖随后的新启动
    let still_mine = {
        let controllers = SSH_CONTROLLERS.lock().await;
        controllers
            .get(&tunnel_id)
            .map(|c| Arc::ptr_eq(c, &controller))
            .unwrap_or(false)
    };
    if still_mine {
        set_status(&tunnel_id, "stopped").await;
        let mut controllers = SSH_CONTROLLERS.lock().await;
        controllers.remove(&tunnel_id);
    }
    log::info!("SSH 隧道 {} 监督任务退出", tunnel_id);
}

/// 探测 SSH 会话是否存活：
/// - is_closed() 立即判死
/// - 开一个 session 通道：成功=活；被服务端策略拒绝(ChannelOpenFailure)=活；其余/超时=死
async fn is_session_alive(h: &client::Handle<SshClient>) -> bool {
    if h.is_closed() {
        return false;
    }
    match timeout(Duration::from_secs(3), h.channel_open_session()).await {
        Ok(Ok(_ch)) => true, // _ch drop 时发送 close
        Ok(Err(russh::Error::ChannelOpenFailure(_))) => true, // 仅被策略拒绝，连接仍活
        Ok(Err(_)) => false, // Disconnect / SendError / HUP / *Timeout 等
        Err(_) => false,     // 探测超时 -> 视为死
    }
}

async fn set_status(tunnel_id: &str, status: &str) {
    let mut tunnels = SSH_TUNNELS.lock().await;
    if let Some(t) = tunnels.get_mut(tunnel_id) {
        t.status = status.to_string();
    }
}

async fn set_status_clear_error(tunnel_id: &str, status: &str) {
    let mut tunnels = SSH_TUNNELS.lock().await;
    if let Some(t) = tunnels.get_mut(tunnel_id) {
        t.status = status.to_string();
        t.last_error = None;
    }
}

async fn set_last_error(tunnel_id: &str, err: String) {
    let mut tunnels = SSH_TUNNELS.lock().await;
    if let Some(t) = tunnels.get_mut(tunnel_id) {
        t.last_error = Some(err);
    }
}

pub(super) async fn update_tunnel_stats(tunnel_id: &str) {
    let stats = {
        let controllers = SSH_CONTROLLERS.lock().await;
        controllers
            .get(tunnel_id)
            .map(|c| (c.get_stats(), c.get_reconnects()))
    };

    if let Some(((connections, bytes_in, bytes_out), reconnects)) = stats {
        let mut tunnels = SSH_TUNNELS.lock().await;
        if let Some(t) = tunnels.get_mut(tunnel_id) {
            t.connections = connections;
            t.bytes_in = bytes_in;
            t.bytes_out = bytes_out;
            t.reconnects = reconnects;
        }
    }
}
