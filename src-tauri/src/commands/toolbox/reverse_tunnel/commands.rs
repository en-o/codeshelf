// 内网穿透 Tauri 命令：CRUD + start/stop + get + stats + list_hosts
// 命令名统一带 reverse 前/后缀，避免与 ssh_tunnel 的命令重名。

use crate::error::AppResult;
use std::sync::Arc;

use tokio::sync::Mutex;
use tokio::time::Duration;

use super::super::{current_time, default_group, generate_id, SshAuthMethod};
use super::auth::list_host_aliases_from_config;
use super::runtime::{connect_and_forward, run_reconnect_supervisor, update_tunnel_stats};
use super::{
    ensure_tunnels_loaded, save_tunnels_to_file, ReverseSharedHandle, ReverseTunnel,
    ReverseTunnelController, ReverseTunnelInput, ReverseTunnelStats, REVERSE_CONTROLLERS,
    REVERSE_TUNNELS,
};

fn validate_input(input: &ReverseTunnelInput) -> AppResult<()> {
    if input.local_port == 0 {
        return Err(crate::error::AppError::from("本地端口不能为 0".to_string()));
    }
    if input.remote_port == 0 {
        return Err(crate::error::AppError::from("公网端口不能为 0".to_string()));
    }
    if input.ssh_host.trim().is_empty()
        && !matches!(&input.auth, SshAuthMethod::SshConfig { .. })
    {
        return Err(crate::error::AppError::from("SSH 主机不能为空".to_string()));
    }
    if matches!(&input.auth, SshAuthMethod::SshConfig { host_alias } if host_alias.is_empty()) {
        return Err(crate::error::AppError::from(
            "SSH config Host 别名不能为空".to_string(),
        ));
    }
    Ok(())
}

fn build_tunnel(id: String, input: ReverseTunnelInput) -> ReverseTunnel {
    ReverseTunnel {
        id,
        name: input.name,
        local_host: input
            .local_host
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "127.0.0.1".to_string()),
        local_port: input.local_port,
        ssh_host: input.ssh_host,
        ssh_port: input.ssh_port.unwrap_or(22),
        ssh_user: input.ssh_user.unwrap_or_default(),
        auth: input.auth,
        remote_bind_addr: input
            .remote_bind_addr
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "127.0.0.1".to_string()),
        remote_port: input.remote_port,
        domain: input.domain.filter(|s| !s.trim().is_empty()),
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
    }
}

#[tauri::command]
#[specta::specta]
pub async fn add_reverse_tunnel(input: ReverseTunnelInput) -> AppResult<ReverseTunnel> {
    ensure_tunnels_loaded().await;
    validate_input(&input)?;

    let id = generate_id();
    let tunnel = build_tunnel(id.clone(), input);

    {
        let mut tunnels = REVERSE_TUNNELS.lock().await;
        tunnels.insert(id.clone(), tunnel.clone());
    }

    if let Err(e) = save_tunnels_to_file().await {
        let mut tunnels = REVERSE_TUNNELS.lock().await;
        tunnels.remove(&id);
        return Err(crate::error::AppError::from(format!(
            "保存内网穿透隧道失败: {}",
            e
        )));
    }

    Ok(tunnel)
}

#[tauri::command]
#[specta::specta]
pub async fn update_reverse_tunnel(
    tunnel_id: String,
    input: ReverseTunnelInput,
) -> AppResult<ReverseTunnel> {
    ensure_tunnels_loaded().await;
    validate_input(&input)?;

    let old = {
        let tunnels = REVERSE_TUNNELS.lock().await;
        tunnels.get(&tunnel_id).cloned()
    };
    let old =
        old.ok_or_else(|| crate::error::AppError::from(format!("隧道不存在: {}", tunnel_id)))?;

    if old.status == "running" || old.status == "reconnecting" {
        stop_reverse_tunnel(tunnel_id.clone()).await?;
    }

    let mut updated = build_tunnel(tunnel_id.clone(), input);
    updated.created_at = old.created_at.clone();

    {
        let mut tunnels = REVERSE_TUNNELS.lock().await;
        tunnels.insert(tunnel_id.clone(), updated);
    }

    if let Err(e) = save_tunnels_to_file().await {
        let mut tunnels = REVERSE_TUNNELS.lock().await;
        tunnels.insert(tunnel_id.clone(), old);
        return Err(crate::error::AppError::from(format!(
            "保存内网穿透隧道失败: {}",
            e
        )));
    }

    let tunnels = REVERSE_TUNNELS.lock().await;
    tunnels
        .get(&tunnel_id)
        .cloned()
        .ok_or_else(|| crate::error::AppError::from("隧道不存在".to_string()))
}

#[tauri::command]
#[specta::specta]
pub async fn remove_reverse_tunnel(tunnel_id: String) -> AppResult<()> {
    ensure_tunnels_loaded().await;

    let _ = stop_reverse_tunnel(tunnel_id.clone()).await;

    let old = {
        let tunnels = REVERSE_TUNNELS.lock().await;
        tunnels.get(&tunnel_id).cloned()
    };

    {
        let mut tunnels = REVERSE_TUNNELS.lock().await;
        tunnels.remove(&tunnel_id);
    }

    if let Err(e) = save_tunnels_to_file().await {
        if let Some(t) = old {
            let mut tunnels = REVERSE_TUNNELS.lock().await;
            tunnels.insert(tunnel_id, t);
        }
        return Err(crate::error::AppError::from(format!(
            "保存内网穿透隧道失败: {}",
            e
        )));
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn start_reverse_tunnel(tunnel_id: String) -> AppResult<()> {
    ensure_tunnels_loaded().await;

    let tunnel = {
        let tunnels = REVERSE_TUNNELS.lock().await;
        tunnels.get(&tunnel_id).cloned()
    };
    let tunnel =
        tunnel.ok_or_else(|| crate::error::AppError::from(format!("隧道不存在: {}", tunnel_id)))?;

    if tunnel.status == "running" || tunnel.status == "reconnecting" {
        return Err(crate::error::AppError::from("隧道已在运行中".to_string()));
    }

    {
        let mut tunnels = REVERSE_TUNNELS.lock().await;
        if let Some(t) = tunnels.get_mut(&tunnel_id) {
            t.last_error = None;
        }
    }

    let controller = Arc::new(ReverseTunnelController::new());
    {
        let mut controllers = REVERSE_CONTROLLERS.lock().await;
        controllers.insert(tunnel_id.clone(), controller.clone());
    }

    let shared: ReverseSharedHandle = Arc::new(Mutex::new(None));

    // 首次：连接 + 请求远端转发。成功立即可用；失败时开自动重连则交后台重试，否则报错清理。
    match connect_and_forward(&tunnel, controller.clone()).await {
        Ok(handle) => {
            *shared.lock().await = Some(Arc::new(handle));
            let mut tunnels = REVERSE_TUNNELS.lock().await;
            if let Some(t) = tunnels.get_mut(&tunnel_id) {
                t.status = "running".to_string();
            }
        }
        Err(e) => {
            if tunnel.auto_reconnect {
                let mut tunnels = REVERSE_TUNNELS.lock().await;
                if let Some(t) = tunnels.get_mut(&tunnel_id) {
                    t.status = "reconnecting".to_string();
                    t.last_error = Some(e.to_string());
                }
            } else {
                {
                    let mut controllers = REVERSE_CONTROLLERS.lock().await;
                    controllers.remove(&tunnel_id);
                }
                let mut tunnels = REVERSE_TUNNELS.lock().await;
                if let Some(t) = tunnels.get_mut(&tunnel_id) {
                    t.last_error = Some(e.to_string());
                }
                return Err(e);
            }
        }
    }

    tokio::spawn(run_reconnect_supervisor(tunnel, shared, controller));

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn stop_reverse_tunnel(tunnel_id: String) -> AppResult<()> {
    log::info!("停止内网穿透隧道: {}", tunnel_id);

    {
        let controllers = REVERSE_CONTROLLERS.lock().await;
        if let Some(controller) = controllers.get(&tunnel_id) {
            controller.stop();
            controller.request_reconnect();
        }
    }

    {
        let mut tunnels = REVERSE_TUNNELS.lock().await;
        if let Some(t) = tunnels.get_mut(&tunnel_id) {
            t.status = "stopped".to_string();
        }
    }

    {
        let mut controllers = REVERSE_CONTROLLERS.lock().await;
        controllers.remove(&tunnel_id);
    }

    tokio::time::sleep(Duration::from_millis(50)).await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_reverse_tunnels() -> AppResult<Vec<ReverseTunnel>> {
    ensure_tunnels_loaded().await;

    let ids: Vec<String> = {
        let tunnels = REVERSE_TUNNELS.lock().await;
        tunnels
            .values()
            .filter(|t| matches!(t.status.as_str(), "running" | "reconnecting"))
            .map(|t| t.id.clone())
            .collect()
    };
    for id in ids {
        update_tunnel_stats(&id).await;
    }

    let tunnels = REVERSE_TUNNELS.lock().await;
    Ok(tunnels.values().cloned().collect())
}

#[tauri::command]
#[specta::specta]
pub async fn get_reverse_tunnel(tunnel_id: String) -> AppResult<Option<ReverseTunnel>> {
    ensure_tunnels_loaded().await;
    update_tunnel_stats(&tunnel_id).await;
    let tunnels = REVERSE_TUNNELS.lock().await;
    Ok(tunnels.get(&tunnel_id).cloned())
}

#[tauri::command]
#[specta::specta]
pub async fn get_reverse_tunnel_stats(tunnel_id: String) -> AppResult<ReverseTunnelStats> {
    let controllers = REVERSE_CONTROLLERS.lock().await;
    let (connections, bytes_in, bytes_out) = controllers
        .get(&tunnel_id)
        .map(|c| c.get_stats())
        .unwrap_or((0, 0, 0));
    Ok(ReverseTunnelStats {
        tunnel_id,
        connections,
        bytes_in,
        bytes_out,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn list_reverse_ssh_config_hosts() -> AppResult<Vec<String>> {
    Ok(list_host_aliases_from_config())
}

/// 仅迁移分组：只改 group 字段并持久化，不停止运行中的隧道。
#[tauri::command]
#[specta::specta]
pub async fn set_reverse_tunnel_group(
    tunnel_id: String,
    group: String,
) -> AppResult<ReverseTunnel> {
    ensure_tunnels_loaded().await;

    let old = {
        let tunnels = REVERSE_TUNNELS.lock().await;
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
        let mut tunnels = REVERSE_TUNNELS.lock().await;
        if let Some(t) = tunnels.get_mut(&tunnel_id) {
            t.group = group;
        }
    }

    if let Err(e) = save_tunnels_to_file().await {
        let mut tunnels = REVERSE_TUNNELS.lock().await;
        tunnels.insert(tunnel_id.clone(), old);
        return Err(crate::error::AppError::from(format!(
            "保存内网穿透隧道失败: {}",
            e
        )));
    }

    let tunnels = REVERSE_TUNNELS.lock().await;
    tunnels
        .get(&tunnel_id)
        .cloned()
        .ok_or_else(|| crate::error::AppError::from("隧道不存在".to_string()))
}
