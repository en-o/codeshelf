// 内网穿透运行时：
// - ReverseClient 的 Handler 实现：入站（公网侧）连接经 server_channel_open_forwarded_tcpip
//   回调到达，spawn 一个任务拨号本地服务并双向对拷。
// - connect_and_forward: 连接认证后调用 tcpip_forward 请求 VPS 监听远端端口。
// - run_reconnect_supervisor: 健康探测 + 指数退避重连；**重连成功后必须重新 tcpip_forward**。
//
// 与 ssh_tunnel（正向）关键区别：没有本地监听器，"监听"发生在 VPS 上；入站连接由 russh
// 会话循环通过 Handler 回调交付。因此本模块只需保活会话 + 保证 tcpip_forward 生效。

use std::sync::Arc;

use russh::client;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::{sleep, timeout, Duration};

use super::auth::connect_and_authenticate;
use super::{
    ReverseClient, ReverseSharedHandle, ReverseTunnel, ReverseTunnelController, REVERSE_CONTROLLERS,
    REVERSE_TUNNELS,
};
use crate::error::AppResult;

impl client::Handler for ReverseClient {
    type Error = russh::Error;

    // 首版不校验 host key（与现有 ssh_tunnel 一致，作为已知限制；后续可加 known_hosts）
    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }

    // VPS 收到公网入站连接时，服务端反向打开一个 forwarded-tcpip 通道到这里。
    // 回调运行在会话循环内，绝不能阻塞——立即 spawn 出去做拨号 + 对拷。
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<client::Msg>,
        _connected_address: &str,
        _connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let local_host = self.local_host.clone();
        let local_port = self.local_port;
        let controller = self.controller.clone();
        tokio::spawn(async move {
            handle_forwarded_channel(channel, local_host, local_port, controller).await;
        });
        Ok(())
    }
}

/// 处理一个公网入站连接：拨号本地服务 -> 双向对拷。
async fn handle_forwarded_channel(
    channel: russh::Channel<client::Msg>,
    local_host: String,
    local_port: u16,
    controller: Arc<ReverseTunnelController>,
) {
    if controller.is_stopped() {
        return;
    }

    // 拨号本地服务
    let mut local = match tokio::net::TcpStream::connect((local_host.as_str(), local_port)).await {
        Ok(s) => s,
        Err(e) => {
            log::debug!(
                "内网穿透：连接本地 {}:{} 失败: {}",
                local_host,
                local_port,
                e
            );
            return;
        }
    };

    controller.inc_connections();

    let mut stream = channel.into_stream();
    let (mut cr, mut cw) = tokio::io::split(&mut stream);
    let (mut lr, mut lw) = local.split();

    let ctrl1 = controller.clone();
    let ctrl2 = controller.clone();
    let check_interval = Duration::from_millis(100);

    // 公网 -> 本地（入站请求）
    let remote_to_local = async {
        let mut buf = [0u8; 8192];
        loop {
            if ctrl1.is_stopped() {
                break;
            }
            match timeout(check_interval, cr.read(&mut buf)).await {
                Ok(Ok(0)) => break,
                Ok(Ok(n)) => {
                    ctrl1.add_bytes_in(n as u64);
                    if lw.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                }
                Ok(Err(_)) => break,
                Err(_) => continue,
            }
        }
        let _ = lw.shutdown().await;
    };

    // 本地 -> 公网（响应）
    let local_to_remote = async {
        let mut buf = [0u8; 8192];
        loop {
            if ctrl2.is_stopped() {
                break;
            }
            match timeout(check_interval, lr.read(&mut buf)).await {
                Ok(Ok(0)) => break,
                Ok(Ok(n)) => {
                    ctrl2.add_bytes_out(n as u64);
                    if cw.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                }
                Ok(Err(_)) => break,
                Err(_) => continue,
            }
        }
        let _ = cw.shutdown().await;
    };

    tokio::join!(remote_to_local, local_to_remote);
    controller.dec_connections();
}

/// 连接认证 + 请求远端端口转发。任一步失败即返回 Err。
pub(super) async fn connect_and_forward(
    tunnel: &ReverseTunnel,
    controller: Arc<ReverseTunnelController>,
) -> AppResult<client::Handle<ReverseClient>> {
    let handle = connect_and_authenticate(tunnel, controller).await?;

    handle
        .tcpip_forward(tunnel.remote_bind_addr.clone(), tunnel.remote_port as u32)
        .await
        .map_err(|e| {
            crate::error::AppError::from(format!(
                "请求远端端口转发失败（确认 VPS 允许该端口、对公网开放需 `GatewayPorts yes`）: {}",
                e
            ))
        })?;

    log::info!(
        "内网穿透已建立: {}:{} <- ssh <- {}:{}",
        tunnel.local_host,
        tunnel.local_port,
        tunnel.remote_bind_addr,
        tunnel.remote_port
    );

    Ok(handle)
}

/// 重连监督器：断线指数退避重连，重连成功后重新 tcpip_forward。
pub(super) async fn run_reconnect_supervisor(
    tunnel: ReverseTunnel,
    shared: ReverseSharedHandle,
    controller: Arc<ReverseTunnelController>,
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
            tokio::select! {
                _ = sleep(probe_interval) => {}
                _ = controller.wait_reconnect_signal() => {}
            }
            if controller.is_stopped() {
                break;
            }
            if is_session_alive(&h).await {
                backoff = 1;
                continue;
            }

            log::warn!("内网穿透 {} 会话断开", tunnel_id);
            let _ = h
                .disconnect(russh::Disconnect::ByApplication, "", "en")
                .await;
            {
                *shared.lock().await = None;
            }
            update_tunnel_stats(&tunnel_id).await;

            if !tunnel.auto_reconnect {
                set_last_error(&tunnel_id, "SSH 会话已断开".to_string()).await;
                controller.stop();
                break;
            }
            set_status(&tunnel_id, "reconnecting").await;
        } else {
            if !tunnel.auto_reconnect {
                break;
            }
            set_status(&tunnel_id, "reconnecting").await;
        }

        if controller.is_stopped() {
            break;
        }

        match connect_and_forward(&tunnel, controller.clone()).await {
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
                log::info!("内网穿透 {} 重连成功", tunnel_id);
                continue;
            }
            Err(e) => {
                set_last_error(&tunnel_id, e.to_string()).await;
                log::warn!(
                    "内网穿透 {} 重连失败: {}（{}s 后重试）",
                    tunnel_id,
                    e,
                    backoff
                );
            }
        }

        tokio::select! {
            _ = sleep(Duration::from_secs(backoff)) => {}
            _ = controller.wait_reconnect_signal() => {}
        }
        backoff = (backoff * 2).min(max_backoff);
    }

    // 退出清理：取消远端转发 + 断开
    let cur = {
        let mut g = shared.lock().await;
        g.take()
    };
    if let Some(h) = cur {
        let _ = h
            .cancel_tcpip_forward(tunnel.remote_bind_addr.clone(), tunnel.remote_port as u32)
            .await;
        let _ = h
            .disconnect(russh::Disconnect::ByApplication, "", "en")
            .await;
    }

    let still_mine = {
        let controllers = REVERSE_CONTROLLERS.lock().await;
        controllers
            .get(&tunnel_id)
            .map(|c| Arc::ptr_eq(c, &controller))
            .unwrap_or(false)
    };
    if still_mine {
        set_status(&tunnel_id, "stopped").await;
        let mut controllers = REVERSE_CONTROLLERS.lock().await;
        controllers.remove(&tunnel_id);
    }
    log::info!("内网穿透 {} 监督任务退出", tunnel_id);
}

/// 探测 SSH 会话是否存活。
///
/// 仅依赖 keepalive（见 auth.rs：keepalive_interval=10s / keepalive_max=3）支撑的
/// `is_closed()` 来判断真实断线。**不再主动 `channel_open_session` 探测**——旧实现每 5s
/// 新开一个探测通道并设 3s 超时，在瞬时高延迟或服务器 `MaxSessions` 限制下会误判**存活**
/// 会话为断开，进而拆掉正常隧道触发重连，并在重连瞬时 TCP 超时时冒出 `os error 10060`，
/// 表现为「一直重连中 + 报错但其实穿透正常」。
async fn is_session_alive(h: &client::Handle<ReverseClient>) -> bool {
    !h.is_closed()
}

async fn set_status(tunnel_id: &str, status: &str) {
    let mut tunnels = REVERSE_TUNNELS.lock().await;
    if let Some(t) = tunnels.get_mut(tunnel_id) {
        t.status = status.to_string();
    }
}

async fn set_status_clear_error(tunnel_id: &str, status: &str) {
    let mut tunnels = REVERSE_TUNNELS.lock().await;
    if let Some(t) = tunnels.get_mut(tunnel_id) {
        t.status = status.to_string();
        t.last_error = None;
    }
}

async fn set_last_error(tunnel_id: &str, err: String) {
    let mut tunnels = REVERSE_TUNNELS.lock().await;
    if let Some(t) = tunnels.get_mut(tunnel_id) {
        t.last_error = Some(err);
    }
}

pub(super) async fn update_tunnel_stats(tunnel_id: &str) {
    let stats = {
        let controllers = REVERSE_CONTROLLERS.lock().await;
        controllers
            .get(tunnel_id)
            .map(|c| (c.get_stats(), c.get_reconnects()))
    };

    if let Some(((connections, bytes_in, bytes_out), reconnects)) = stats {
        let mut tunnels = REVERSE_TUNNELS.lock().await;
        if let Some(t) = tunnels.get_mut(tunnel_id) {
            t.connections = connections;
            t.bytes_in = bytes_in;
            t.bytes_out = bytes_out;
            t.reconnects = reconnects;
        }
    }
}
