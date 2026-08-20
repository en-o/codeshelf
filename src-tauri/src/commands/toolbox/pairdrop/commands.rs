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
            list.sort_by_key(|device| std::cmp::Reverse(device.last_seen_at));
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

    // 文件已经在磁盘上（中转临时目录），直接移过去即可；不再经手内存。
    // 临时目录和目标可能不在同一个卷（Windows 上尤其常见），rename 会失败 → 退回复制。
    if tokio::fs::rename(&file.path, &save_path).await.is_err() {
        tokio::fs::copy(&file.path, &save_path)
            .await
            .map_err(|e| crate::error::AppError::from(format!("写入文件失败: {}", e)))?;
    }
    Ok(file.size)
}

/// 从"加入的对方桌面端"按 URL 下载文件并写到本地。
/// 本机自身收到的文件走 [`pairdrop_save_file`]（读本机内存缓存）；加入对方桌面端时，
/// 文件缓存在对方服务上，只能通过 HTTP 拉取——走这个命令，避免前端 fs 插件的路径 scope 限制。
#[tauri::command]
#[specta::specta]
pub async fn pairdrop_download_save(url: String, save_path: String) -> AppResult<u64> {
    // 对端是另一台桌面端，随时可能掉线/关机。裸 Client::new() 没有任何超时，
    // 对端不可达时这个命令会永久挂起、前端一直转圈。
    // 只设连接超时与读超时，不设总超时——大文件传输合法地耗时长，总超时会误杀。
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .read_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| crate::error::AppError::from(format!("创建 HTTP 客户端失败: {}", e)))?;
    let resp = client
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
    let path = std::path::Path::new(&save_path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| crate::error::AppError::from(format!("创建目录失败: {}", e)))?;
        }
    }

    // 边下边写：`resp.bytes()` 会把整份文件先攒在内存里，几百 MB 的包足够把桌面端顶爆
    use futures::StreamExt;
    use tokio::io::AsyncWriteExt;
    let mut stream = resp.bytes_stream();
    let mut file = tokio::fs::File::create(&save_path)
        .await
        .map_err(|e| crate::error::AppError::from(format!("创建文件失败: {}", e)))?;
    let mut n: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|e| crate::error::AppError::from(format!("读取响应失败: {}", e)))?;
        n += chunk.len() as u64;
        file.write_all(&chunk)
            .await
            .map_err(|e| crate::error::AppError::from(format!("写入文件失败: {}", e)))?;
    }
    file.flush()
        .await
        .map_err(|e| crate::error::AppError::from(format!("写入文件失败: {}", e)))?;
    Ok(n)
}

/// [`pairdrop_upload_path`] 的返回值。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UploadedFile {
    pub token: String,
    pub name: String,
    pub size: u64,
}

/// 从**本地真实路径**上传文件到中继（自身服务或已加入的对方桌面端）。
///
/// 前端的 `<input type=file>` / 拖拽拿到的 `File` 对象在 WebView 里没有磁盘路径，
/// 发送方那条消息只能显示"已发送"、点不开源文件。走系统文件对话框选出来的路径经这里上传，
/// 发送方就能一直指着自己的真实文件——中转缓存被领取删除之后也照样能打开。
///
/// 边读边发（`ReaderStream` + `wrap_stream`），10GB 的文件也不会进内存。
#[tauri::command]
#[specta::specta]
pub async fn pairdrop_upload_path(
    app: tauri::AppHandle,
    api_base: String,
    from: String,
    to: String,
    path: String,
    upload_id: String,
) -> AppResult<UploadedFile> {
    use futures::StreamExt;
    use tauri::Emitter;

    let file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| crate::error::AppError::from(format!("打开文件失败: {}", e)))?;
    let size = file
        .metadata()
        .await
        .map_err(|e| crate::error::AppError::from(format!("读取文件信息失败: {}", e)))?
        .len();
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());

    let app_for_progress = app.clone();
    let progress_id = upload_id.clone();
    let mut sent: u64 = 0;
    let mut last_pct: u64 = u64::MAX;
    let stream = tokio_util::io::ReaderStream::new(file).map(move |chunk| {
        if let Ok(bytes) = &chunk {
            sent += bytes.len() as u64;
            // 按百分比节流：8KB 一个 chunk，10GB 就是 130 万次事件，全发出去前端会被淹掉
            let pct = if size == 0 { 100 } else { sent * 100 / size };
            if pct != last_pct {
                last_pct = pct;
                let _ = app_for_progress.emit(
                    "pairdrop:upload-progress",
                    serde_json::json!({ "uploadId": progress_id, "loaded": sent, "total": size }),
                );
            }
        }
        chunk
    });

    // to / from 必须排在 file 之前：服务端在开始读文件内容前就要能判断这次上传是否被授权。
    // reqwest 的 multipart 按插入顺序发送。
    let part = reqwest::multipart::Part::stream_with_length(reqwest::Body::wrap_stream(stream), size)
        .file_name(name.clone())
        .mime_str("application/octet-stream")
        .map_err(|e| crate::error::AppError::from(format!("构造上传数据失败: {}", e)))?;
    let form = reqwest::multipart::Form::new()
        .text("to", to)
        .text("from", from.clone())
        .part("file", part);

    // 只设连接超时：上传大文件合法地耗时长，总超时会误杀。
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| crate::error::AppError::from(format!("创建 HTTP 客户端失败: {}", e)))?;
    let resp = client
        .post(format!("{}/api/upload", api_base.trim_end_matches('/')))
        .header("x-peer-id", from)
        .multipart(form)
        .send()
        .await
        .map_err(|e| crate::error::AppError::from(format!("上传失败: {}", e)))?;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        // 服务端 JSON 里有具体原因（无权限 / 缓存已满 / 并发已满），别吞成一句 HTTP xxx
        let detail = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string));
        return Err(crate::error::AppError::from(
            detail.unwrap_or_else(|| format!("上传失败: HTTP {}", status.as_u16())),
        ));
    }
    let token = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| v.get("token").and_then(|t| t.as_str()).map(str::to_string))
        .ok_or_else(|| crate::error::AppError::from("上传成功但没拿到 token"))?;

    Ok(UploadedFile { token, name, size })
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
