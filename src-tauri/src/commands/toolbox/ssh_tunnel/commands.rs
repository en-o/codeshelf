// SSH 隧道 Tauri 命令：CRUD + start/stop + get + stats + list_hosts

use crate::error::AppResult;
use std::sync::Arc;

use tokio::sync::Mutex;
use tokio::time::Duration;

use super::super::{
    current_time, default_group, generate_id, SshAuthMethod, SshTunnel, SshTunnelInput,
    SshTunnelStats,
};
use super::auth::{connect_and_authenticate, list_host_aliases_from_config};
use super::runtime::{run_reconnect_supervisor, run_tunnel_server, update_tunnel_stats};
use super::{
    ensure_tunnels_loaded, save_tunnels_to_file, SharedHandle, SshTunnelController, SSH_CONTROLLERS,
    SSH_TUNNELS,
};

#[tauri::command]
#[specta::specta]
pub async fn add_ssh_tunnel(input: SshTunnelInput) -> AppResult<SshTunnel> {
    ensure_tunnels_loaded().await;

    if input.local_port == 0 {
        return Err(crate::error::AppError::from("本地端口不能为 0".to_string()));
    }
    if input.remote_port == 0 {
        return Err(crate::error::AppError::from("远程端口不能为 0".to_string()));
    }
    if input.remote_host.is_empty() {
        return Err(crate::error::AppError::from("远程主机不能为空".to_string()));
    }
    if matches!(&input.auth, SshAuthMethod::SshConfig { host_alias } if host_alias.is_empty()) {
        return Err(crate::error::AppError::from(
            "SSH config Host 别名不能为空".to_string(),
        ));
    }

    {
        let tunnels = SSH_TUNNELS.lock().await;
        for t in tunnels.values() {
            if t.local_port == input.local_port
                && matches!(t.status.as_str(), "running" | "reconnecting")
            {
                return Err(crate::error::AppError::from(format!(
                    "端口 {} 已被其他隧道使用",
                    input.local_port
                )));
            }
        }
    }

    let id = generate_id();
    let tunnel = SshTunnel {
        id: id.clone(),
        name: input.name,
        local_port: input.local_port,
        remote_host: input.remote_host,
        remote_port: input.remote_port,
        ssh_host: input.ssh_host,
        ssh_port: input.ssh_port.unwrap_or(22),
        ssh_user: input.ssh_user.unwrap_or_default(),
        auth: input.auth,
        expose_lan: input.expose_lan.unwrap_or(false),
        status: "stopped".to_string(),
        connections: 0,
        bytes_in: 0,
        bytes_out: 0,
        last_error: None,
        auto_reconnect: input.auto_reconnect.unwrap_or(true),
        reconnects: 0,
        group: input
            .group
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(default_group),
        created_at: current_time(),
    };

    {
        let mut tunnels = SSH_TUNNELS.lock().await;
        tunnels.insert(id.clone(), tunnel.clone());
    }

    if let Err(e) = save_tunnels_to_file().await {
        log::error!("保存 SSH 隧道失败: {}", e);
        let mut tunnels = SSH_TUNNELS.lock().await;
        tunnels.remove(&id);
        return Err(crate::error::AppError::from(format!(
            "保存 SSH 隧道失败: {}",
            e
        )));
    }

    Ok(tunnel)
}

#[tauri::command]
#[specta::specta]
pub async fn update_ssh_tunnel(tunnel_id: String, input: SshTunnelInput) -> AppResult<SshTunnel> {
    ensure_tunnels_loaded().await;

    let old = {
        let tunnels = SSH_TUNNELS.lock().await;
        tunnels.get(&tunnel_id).cloned()
    };
    let old =
        old.ok_or_else(|| crate::error::AppError::from(format!("隧道不存在: {}", tunnel_id)))?;

    if old.status == "running" || old.status == "reconnecting" {
        stop_ssh_tunnel(tunnel_id.clone()).await?;
    }

    {
        let mut tunnels = SSH_TUNNELS.lock().await;
        if let Some(t) = tunnels.get_mut(&tunnel_id) {
            t.name = input.name;
            t.local_port = input.local_port;
            t.remote_host = input.remote_host;
            t.remote_port = input.remote_port;
            t.ssh_host = input.ssh_host;
            t.ssh_port = input.ssh_port.unwrap_or(22);
            t.ssh_user = input.ssh_user.unwrap_or_default();
            t.auth = input.auth;
            t.expose_lan = input.expose_lan.unwrap_or(false);
            t.auto_reconnect = input.auto_reconnect.unwrap_or(true);
            t.group = input
                .group
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(default_group);
            t.last_error = None;
        }
    }

    if let Err(e) = save_tunnels_to_file().await {
        log::error!("保存 SSH 隧道失败: {}", e);
        let mut tunnels = SSH_TUNNELS.lock().await;
        tunnels.insert(tunnel_id.clone(), old);
        return Err(crate::error::AppError::from(format!(
            "保存 SSH 隧道失败: {}",
            e
        )));
    }

    let tunnels = SSH_TUNNELS.lock().await;
    tunnels
        .get(&tunnel_id)
        .cloned()
        .ok_or_else(|| crate::error::AppError::from("隧道不存在".to_string()))
}

#[tauri::command]
#[specta::specta]
pub async fn remove_ssh_tunnel(tunnel_id: String) -> AppResult<()> {
    ensure_tunnels_loaded().await;

    let _ = stop_ssh_tunnel(tunnel_id.clone()).await;

    let old = {
        let tunnels = SSH_TUNNELS.lock().await;
        tunnels.get(&tunnel_id).cloned()
    };

    {
        let mut tunnels = SSH_TUNNELS.lock().await;
        tunnels.remove(&tunnel_id);
    }

    if let Err(e) = save_tunnels_to_file().await {
        if let Some(t) = old {
            let mut tunnels = SSH_TUNNELS.lock().await;
            tunnels.insert(tunnel_id, t);
        }
        return Err(crate::error::AppError::from(format!(
            "保存 SSH 隧道失败: {}",
            e
        )));
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn start_ssh_tunnel(tunnel_id: String) -> AppResult<()> {
    ensure_tunnels_loaded().await;

    let tunnel = {
        let tunnels = SSH_TUNNELS.lock().await;
        tunnels.get(&tunnel_id).cloned()
    };
    let tunnel =
        tunnel.ok_or_else(|| crate::error::AppError::from(format!("隧道不存在: {}", tunnel_id)))?;

    if tunnel.status == "running" || tunnel.status == "reconnecting" {
        return Err(crate::error::AppError::from("隧道已在运行中".to_string()));
    }

    // 先清除 last_error
    {
        let mut tunnels = SSH_TUNNELS.lock().await;
        if let Some(t) = tunnels.get_mut(&tunnel_id) {
            t.last_error = None;
        }
    }

    let controller = Arc::new(SshTunnelController::new());
    {
        let mut controllers = SSH_CONTROLLERS.lock().await;
        controllers.insert(tunnel_id.clone(), controller.clone());
    }

    // 监听器与监督器共享的"当前句柄"槽；重连时整体替换，监听器/本地端口不受影响
    let shared: SharedHandle = Arc::new(Mutex::new(None));

    // 首次连接：成功立即可用；失败时——开启自动重连则交后台重试(返回 Ok)，
    // 否则保持旧行为(返回 Err 并清理控制器)
    match connect_and_authenticate(&tunnel).await {
        Ok(handle) => {
            *shared.lock().await = Some(Arc::new(handle));
            let mut tunnels = SSH_TUNNELS.lock().await;
            if let Some(t) = tunnels.get_mut(&tunnel_id) {
                t.status = "running".to_string();
            }
        }
        Err(e) => {
            // 未知主机密钥需要回到前端让用户选择是否信任；不能吞进自动重连，
            // 否则界面只会显示 HOSTKEY_NOT_TRUSTED，却没有继续连接的入口。
            if tunnel.auto_reconnect
                && !crate::commands::toolbox::ssh_hostkey::needs_user_confirmation(&e.to_string())
            {
                let mut tunnels = SSH_TUNNELS.lock().await;
                if let Some(t) = tunnels.get_mut(&tunnel_id) {
                    t.status = "reconnecting".to_string();
                    t.last_error = Some(e.to_string());
                }
            } else {
                {
                    let mut controllers = SSH_CONTROLLERS.lock().await;
                    controllers.remove(&tunnel_id);
                }
                let mut tunnels = SSH_TUNNELS.lock().await;
                if let Some(t) = tunnels.get_mut(&tunnel_id) {
                    t.last_error = Some(e.to_string());
                }
                return Err(e);
            }
        }
    }

    // 监听任务（本地端口在隧道整个生命周期常驻）
    {
        let id = tunnel_id.clone();
        let shared = shared.clone();
        let controller = controller.clone();
        let local_port = tunnel.local_port;
        let remote_host = tunnel.remote_host.clone();
        let remote_port = tunnel.remote_port;
        let expose_lan = tunnel.expose_lan;
        tokio::spawn(async move {
            if let Err(e) = run_tunnel_server(
                id.clone(),
                local_port,
                remote_host,
                remote_port,
                expose_lan,
                shared,
                controller,
            )
            .await
            {
                log::error!("SSH 隧道监听错误: {}", e);
                let mut tunnels = SSH_TUNNELS.lock().await;
                if let Some(t) = tunnels.get_mut(&id) {
                    t.last_error = Some(e.to_string());
                }
            }
        });
    }

    // 监督任务（健康探测 + 指数退避自动重连；auto_reconnect=false 时检测到断线即停止）
    tokio::spawn(run_reconnect_supervisor(tunnel, shared, controller));

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn stop_ssh_tunnel(tunnel_id: String) -> AppResult<()> {
    log::info!("停止 SSH 隧道: {}", tunnel_id);

    {
        let controllers = SSH_CONTROLLERS.lock().await;
        if let Some(controller) = controllers.get(&tunnel_id) {
            controller.stop();
            // 唤醒可能停在 sleep/notified 的监督任务，使其立即观察到停止
            controller.request_reconnect();
        }
    }

    {
        let mut tunnels = SSH_TUNNELS.lock().await;
        if let Some(t) = tunnels.get_mut(&tunnel_id) {
            t.status = "stopped".to_string();
        }
    }

    {
        let mut controllers = SSH_CONTROLLERS.lock().await;
        controllers.remove(&tunnel_id);
    }

    tokio::time::sleep(Duration::from_millis(50)).await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_ssh_tunnels() -> AppResult<Vec<SshTunnel>> {
    ensure_tunnels_loaded().await;

    let ids: Vec<String> = {
        let tunnels = SSH_TUNNELS.lock().await;
        tunnels
            .values()
            .filter(|t| matches!(t.status.as_str(), "running" | "reconnecting"))
            .map(|t| t.id.clone())
            .collect()
    };
    for id in ids {
        update_tunnel_stats(&id).await;
    }

    let tunnels = SSH_TUNNELS.lock().await;
    Ok(tunnels.values().cloned().collect())
}

#[tauri::command]
#[specta::specta]
pub async fn get_ssh_tunnel(tunnel_id: String) -> AppResult<Option<SshTunnel>> {
    ensure_tunnels_loaded().await;
    update_tunnel_stats(&tunnel_id).await;
    let tunnels = SSH_TUNNELS.lock().await;
    Ok(tunnels.get(&tunnel_id).cloned())
}

#[tauri::command]
#[specta::specta]
pub async fn get_ssh_tunnel_stats(tunnel_id: String) -> AppResult<SshTunnelStats> {
    let controllers = SSH_CONTROLLERS.lock().await;
    let (connections, bytes_in, bytes_out) = controllers
        .get(&tunnel_id)
        .map(|c| c.get_stats())
        .unwrap_or((0, 0, 0));
    Ok(SshTunnelStats {
        tunnel_id,
        connections,
        bytes_in,
        bytes_out,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn list_ssh_config_hosts() -> AppResult<Vec<String>> {
    Ok(list_host_aliases_from_config())
}

/// 列出本机所有有效 IP（去重保序），供「远程主机」下拉选择。
/// 复用 pairdrop 已有的跨平台网卡枚举实现，避免新增依赖。
#[tauri::command]
#[specta::specta]
pub async fn list_local_ips() -> AppResult<Vec<String>> {
    let mut seen = std::collections::HashSet::new();
    let mut ips = Vec::new();
    for (_iface, ip) in crate::commands::toolbox::pairdrop::state::list_local_ipv4() {
        if seen.insert(ip.clone()) {
            ips.push(ip);
        }
    }
    Ok(ips)
}

/// 仅迁移分组：只改 group 字段并持久化，不停止运行中的隧道
/// （与 update_ssh_tunnel 不同，后者会先 stop 运行中的隧道）。
#[tauri::command]
#[specta::specta]
pub async fn set_ssh_tunnel_group(tunnel_id: String, group: String) -> AppResult<SshTunnel> {
    ensure_tunnels_loaded().await;

    let old = {
        let tunnels = SSH_TUNNELS.lock().await;
        tunnels.get(&tunnel_id).cloned()
    };
    let old =
        old.ok_or_else(|| crate::error::AppError::from(format!("隧道不存在: {}", tunnel_id)))?;

    let group = if group.trim().is_empty() {
        default_group()
    } else {
        group.trim().to_string()
    };

    {
        let mut tunnels = SSH_TUNNELS.lock().await;
        if let Some(t) = tunnels.get_mut(&tunnel_id) {
            t.group = group;
        }
    }

    if let Err(e) = save_tunnels_to_file().await {
        log::error!("保存 SSH 隧道失败: {}", e);
        let mut tunnels = SSH_TUNNELS.lock().await;
        tunnels.insert(tunnel_id.clone(), old);
        return Err(crate::error::AppError::from(format!(
            "保存 SSH 隧道失败: {}",
            e
        )));
    }

    let tunnels = SSH_TUNNELS.lock().await;
    tunnels
        .get(&tunnel_id)
        .cloned()
        .ok_or_else(|| crate::error::AppError::from("隧道不存在".to_string()))
}
