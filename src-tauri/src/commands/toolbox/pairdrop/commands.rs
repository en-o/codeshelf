// 跨设备传输的 Tauri 命令
//
// 前端通过这几个命令控制服务开启/关闭，并获取当前状态用于渲染 QR / URL。

use crate::error::AppResult;

use super::runtime;
use super::state::*;

/// 启动服务。port=0 表示由系统选择。
#[tauri::command]
#[specta::specta]
pub async fn pairdrop_start(port: Option<u16>) -> AppResult<ServiceStatus> {
    let mut guard = SERVICE.lock().await;
    if let Some(svc) = guard.as_ref() {
        // 已运行，直接返回当前状态
        let peer_count = svc.state.peers.lock().await.len();
        return Ok(ServiceStatus {
            running: true,
            port: svc.port,
            urls: build_status_urls(svc.port),
            peer_count,
        });
    }

    let bind_port = port.unwrap_or(DEFAULT_PORT);
    let (actual_port, state, stop_signal, task) = match runtime::start_server(bind_port).await {
        Ok(v) => v,
        Err(e) if bind_port != 0 => {
            // 固定端口失败（典型情况：Windows Hyper-V 静默保留了该端口段），
            // 退回到 OS 随机端口,优先保证服务可用,代价是 QR 会变。
            log::warn!(
                "跨设备传输：固定端口 {} 启动失败({}),退回到随机端口",
                bind_port,
                e
            );
            runtime::start_server(0).await.map_err(|e2| {
                crate::error::AppError::from(format!(
                    "启动跨设备传输服务失败: 固定端口 {} 不可用({}); 随机端口也失败: {}",
                    bind_port, e, e2
                ))
            })?
        }
        Err(e) => {
            return Err(crate::error::AppError::from(format!(
                "启动跨设备传输服务失败: {}",
                e
            )))
        }
    };

    let peer_count = state.peers.lock().await.len();
    *guard = Some(RunningService {
        port: actual_port,
        state,
        stop_signal,
        task,
    });

    Ok(ServiceStatus {
        running: true,
        port: actual_port,
        urls: build_status_urls(actual_port),
        peer_count,
    })
}

/// 停止服务
#[tauri::command]
#[specta::specta]
pub async fn pairdrop_stop() -> AppResult<()> {
    let mut guard = SERVICE.lock().await;
    if let Some(svc) = guard.take() {
        svc.stop_signal.notify_waiters();
        // 不等任务完成——graceful shutdown 触发后任务会自然结束
        // 但要避免下次启动太快导致端口残留，给一点点时间
        drop(svc);
    }
    Ok(())
}

/// 查询当前状态
#[tauri::command]
#[specta::specta]
pub async fn pairdrop_status() -> AppResult<ServiceStatus> {
    let guard = SERVICE.lock().await;
    match guard.as_ref() {
        Some(svc) => {
            let peer_count = svc.state.peers.lock().await.len();
            Ok(ServiceStatus {
                running: true,
                port: svc.port,
                urls: build_status_urls(svc.port),
                peer_count,
            })
        }
        None => Ok(ServiceStatus {
            running: false,
            port: 0,
            urls: vec![],
            peer_count: 0,
        }),
    }
}

/// 获取当前 peer 列表（用于桌面端不通过 WebSocket 时也能查看）
#[tauri::command]
#[specta::specta]
pub async fn pairdrop_peers() -> AppResult<Vec<PeerInfo>> {
    let guard = SERVICE.lock().await;
    match guard.as_ref() {
        Some(svc) => {
            let peers = svc.state.peers.lock().await;
            Ok(peers.values().map(|e| e.info.clone()).collect())
        }
        None => Ok(vec![]),
    }
}

/// 获取局域网中主动发现到的其它桌面端
#[tauri::command]
#[specta::specta]
pub async fn pairdrop_discovered() -> AppResult<Vec<DiscoveredDevice>> {
    let guard = SERVICE.lock().await;
    match guard.as_ref() {
        Some(svc) => {
            let now = now_millis();
            let mut devices = svc.state.discovered.lock().await;
            devices.retain(|_, d| now - d.last_seen_at <= 20_000);
            let mut list: Vec<DiscoveredDevice> = devices.values().cloned().collect();
            list.sort_by(|a, b| b.last_seen_at.cmp(&a.last_seen_at));
            Ok(list)
        }
        None => Ok(vec![]),
    }
}

/// 把缓存中的接收文件直接写到本地。一次性消费 — 调用后 token 立即失效，
/// 避免再被 HTTP /api/file/:token 又下载一次。
#[tauri::command]
#[specta::specta]
pub async fn pairdrop_save_file(token: String, save_path: String) -> AppResult<u64> {
    let state = {
        let guard = SERVICE.lock().await;
        guard
            .as_ref()
            .map(|svc| svc.state.clone())
            .ok_or_else(|| crate::error::AppError::from("跨设备传输服务未启动"))?
    };

    let cached = {
        let mut files = state.files.lock().await;
        files.remove(&token)
    };

    let file = cached.ok_or_else(|| crate::error::AppError::from("文件不存在或已被领取/过期"))?;
    if file.is_expired() {
        return Err(crate::error::AppError::from("文件已过期"));
    }

    let path = std::path::Path::new(&save_path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| crate::error::AppError::from(format!("创建目录失败: {}", e)))?;
        }
    }

    let bytes_written = file.bytes.len() as u64;
    tokio::fs::write(&save_path, &file.bytes)
        .await
        .map_err(|e| crate::error::AppError::from(format!("写入文件失败: {}", e)))?;
    Ok(bytes_written)
}

/// 从"加入的对方桌面端"按 URL 下载文件并写到本地。
/// 本机自身收到的文件走 [`pairdrop_save_file`]（读本机内存缓存）；加入对方桌面端时，
/// 文件缓存在对方服务上，只能通过 HTTP 拉取——走这个命令，避免前端 fs 插件的路径 scope 限制。
#[tauri::command]
#[specta::specta]
pub async fn pairdrop_download_save(url: String, save_path: String) -> AppResult<u64> {
    let resp = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| crate::error::AppError::from(format!("下载失败: {}", e)))?;
    if !resp.status().is_success() {
        return Err(crate::error::AppError::from(format!(
            "下载失败: HTTP {}",
            resp.status().as_u16()
        )));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| crate::error::AppError::from(format!("读取响应失败: {}", e)))?;

    let path = std::path::Path::new(&save_path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| crate::error::AppError::from(format!("创建目录失败: {}", e)))?;
        }
    }
    let n = bytes.len() as u64;
    tokio::fs::write(&save_path, &bytes)
        .await
        .map_err(|e| crate::error::AppError::from(format!("写入文件失败: {}", e)))?;
    Ok(n)
}

fn build_status_urls(port: u16) -> Vec<NetworkUrl> {
    list_local_ipv4()
        .into_iter()
        .map(|(iface, ip)| NetworkUrl {
            url: format!("http://{}:{}/", ip, port),
            interface: iface,
            ip,
        })
        .collect()
}
