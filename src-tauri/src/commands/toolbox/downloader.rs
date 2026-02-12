// 文件下载模块 - 支持断点续传、重试机制、下载队列管理

use super::{current_time, generate_id, DownloadConfig, DownloadTask};
use crate::storage;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

/// 下载任务存储 - 延迟初始化
static DOWNLOAD_TASKS: Lazy<Arc<Mutex<HashMap<String, DownloadTask>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// 是否已从文件加载
static TASKS_LOADED: Lazy<Arc<Mutex<bool>>> = Lazy::new(|| Arc::new(Mutex::new(false)));

/// 下载取消标志
static DOWNLOAD_CANCELLED: Lazy<Arc<Mutex<HashMap<String, AtomicBool>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// 确保下载任务已从文件加载
async fn ensure_tasks_loaded() {
    let mut loaded = TASKS_LOADED.lock().await;
    if !*loaded {
        match load_tasks_from_file() {
            Ok(tasks) => {
                let mut tasks_map = DOWNLOAD_TASKS.lock().await;
                *tasks_map = tasks;
                *loaded = true;
            }
            Err(e) => {
                log::warn!("加载下载任务失败，将在下次重试: {}", e);
            }
        }
    }
}

/// 从文件加载下载任务
fn load_tasks_from_file() -> Result<HashMap<String, DownloadTask>, String> {
    let config = storage::get_storage_config()?;
    let path = config.download_tasks_file();

    log::info!("加载下载任务: {:?}", path);

    if !path.exists() {
        log::info!("下载任务文件不存在，返回空列表");
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取下载任务失败: {}", e))?;

    // 直接解析为任务数组
    let tasks: Vec<DownloadTask> = serde_json::from_str(&content)
        .unwrap_or_default();

    let result: HashMap<String, DownloadTask> = tasks.into_iter()
        .map(|mut t| {
            // 重启后，下载中的任务变为暂停
            if t.status == "downloading" {
                t.status = "paused".to_string();
            }
            (t.id.clone(), t)
        })
        .collect();

    log::info!("共加载 {} 个下载任务", result.len());
    Ok(result)
}

/// 保存下载任务到文件
async fn save_tasks_to_file() -> Result<(), String> {
    let config = storage::get_storage_config()?;
    config.ensure_dirs()?;

    let tasks = DOWNLOAD_TASKS.lock().await;
    let tasks_vec: Vec<&DownloadTask> = tasks.values().collect();

    // 直接保存为任务数组
    let content = serde_json::to_string(&tasks_vec)
        .map_err(|e| format!("序列化下载任务失败: {}", e))?;

    let path = config.download_tasks_file();
    log::info!("保存下载任务到: {:?}", path);

    fs::write(&path, content)
        .map_err(|e| format!("写入下载任务失败: {}", e))?;

    log::info!("下载任务保存成功，共 {} 个任务", tasks.len());
    Ok(())
}

/// 默认下载目录
fn default_download_dir() -> String {
    dirs::download_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string())
}

/// 从 URL 提取文件名
fn extract_filename(url: &str) -> String {
    // 尝试解析 URL
    if let Ok(parsed) = url::Url::parse(url) {
        if let Some(segments) = parsed.path_segments() {
            if let Some(last) = segments.last() {
                // 移除查询参数
                let name = last.split('?').next().unwrap_or(last);
                if !name.is_empty() {
                    return urlencoding::decode(name)
                        .unwrap_or_else(|_| name.into())
                        .to_string();
                }
            }
        }
    }

    // 回退：使用时间戳作为文件名
    format!("download_{}", chrono::Local::now().format("%Y%m%d_%H%M%S"))
}

/// 开始下载
#[tauri::command]
pub async fn start_download(config: DownloadConfig) -> Result<String, String> {
    ensure_tasks_loaded().await;

    let task_id = generate_id();

    // 确定保存路径
    let save_dir = config.save_dir.unwrap_or_else(default_download_dir);
    let file_name = config
        .file_name
        .unwrap_or_else(|| extract_filename(&config.url));
    let save_path = Path::new(&save_dir).join(&file_name);

    // 创建任务
    let task = DownloadTask {
        id: task_id.clone(),
        url: config.url.clone(),
        save_path: save_path.to_string_lossy().to_string(),
        file_name: file_name.clone(),
        total_size: 0,
        downloaded_size: 0,
        status: "pending".to_string(),
        speed: 0,
        error: None,
        created_at: current_time(),
        updated_at: current_time(),
    };

    // 保存任务
    {
        let mut tasks = DOWNLOAD_TASKS.lock().await;
        tasks.insert(task_id.clone(), task);
    }

    // 持久化保存
    if let Err(e) = save_tasks_to_file().await {
        log::error!("保存下载任务失败: {}", e);
    }

    // 初始化取消标志
    {
        let mut flags = DOWNLOAD_CANCELLED.lock().await;
        flags.insert(task_id.clone(), AtomicBool::new(false));
    }

    // 启动下载任务
    let id = task_id.clone();
    let url = config.url.clone();
    let path = save_path.to_string_lossy().to_string();
    let max_retries = config.max_retries.unwrap_or(3);

    tokio::spawn(async move {
        download_with_retry(&id, &url, &path, max_retries).await;
    });

    Ok(task_id)
}

/// 带重试的下载
async fn download_with_retry(task_id: &str, url: &str, save_path: &str, max_retries: u32) {
    let mut retries = 0;

    loop {
        // 更新状态为下载中
        update_task_status(task_id, "downloading", None).await;

        match download_file(task_id, url, save_path).await {
            Ok(_) => {
                update_task_status(task_id, "completed", None).await;
                return;
            }
            Err(e) => {
                // 检查是否被取消
                if is_cancelled(task_id).await {
                    update_task_status(task_id, "cancelled", Some(e.clone())).await;
                    return;
                }

                retries += 1;
                if retries > max_retries {
                    update_task_status(task_id, "failed", Some(e)).await;
                    return;
                }

                // 指数退避重试
                let delay = Duration::from_secs(2u64.pow(retries));
                sleep(delay).await;
            }
        }
    }
}

/// 执行下载
async fn download_file(task_id: &str, url: &str, save_path: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    // 检查是否存在部分下载的文件（断点续传）
    let existing_size = if Path::new(save_path).exists() {
        fs::metadata(save_path)
            .map(|m| m.len())
            .unwrap_or(0)
    } else {
        0
    };

    // 先尝试 HEAD 请求获取文件大小
    let mut total_size = 0u64;
    if let Ok(head_resp) = client.head(url).send().await {
        if head_resp.status().is_success() {
            total_size = head_resp.content_length().unwrap_or(0);
        }
    }

    // 更新任务的 total_size（如果 HEAD 请求获取到了）
    if total_size > 0 {
        let mut tasks = DOWNLOAD_TASKS.lock().await;
        if let Some(task) = tasks.get_mut(task_id) {
            task.total_size = total_size;
        }
    }

    // 构建请求，支持断点续传
    let mut request = client.get(url);
    if existing_size > 0 {
        request = request.header("Range", format!("bytes={}-", existing_size));
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    // 检查响应状态
    let status = response.status();
    if !status.is_success() && status.as_u16() != 206 {
        return Err(format!("HTTP 错误: {}", status));
    }

    // 从响应头获取文件大小（如果 HEAD 请求没有获取到）
    if total_size == 0 {
        total_size = if status.as_u16() == 206 {
            // 断点续传响应
            response
                .headers()
                .get("content-range")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.split('/').last())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0)
        } else {
            response.content_length().unwrap_or(0)
        };
    }

    // 更新任务大小
    {
        let mut tasks = DOWNLOAD_TASKS.lock().await;
        if let Some(task) = tasks.get_mut(task_id) {
            task.total_size = total_size;
            task.downloaded_size = existing_size;
        }
    }

    // 确保目录存在
    if let Some(parent) = Path::new(save_path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    // 打开文件（追加模式用于断点续传）
    let mut file = if existing_size > 0 && status.as_u16() == 206 {
        OpenOptions::new()
            .append(true)
            .open(save_path)
            .map_err(|e| format!("打开文件失败: {}", e))?
    } else {
        File::create(save_path).map_err(|e| format!("创建文件失败: {}", e))?
    };

    // 下载数据
    let mut downloaded = existing_size;
    let mut last_update = std::time::Instant::now();
    let mut last_downloaded = downloaded;

    let mut stream = response.bytes_stream();
    use futures::StreamExt;

    while let Some(chunk) = stream.next().await {
        // 检查是否被取消
        if is_cancelled(task_id).await {
            return Err("下载已取消".to_string());
        }

        let chunk = chunk.map_err(|e| format!("读取数据失败: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("写入文件失败: {}", e))?;

        downloaded += chunk.len() as u64;

        // 更新进度（每 100ms 更新一次，或每 64KB 更新一次）
        let now = std::time::Instant::now();
        let time_elapsed = now.duration_since(last_update).as_millis() >= 100;
        let size_threshold = downloaded - last_downloaded >= 65536; // 64KB

        if time_elapsed || size_threshold {
            let elapsed_secs = now.duration_since(last_update).as_secs_f64();
            let speed = if elapsed_secs > 0.0 {
                ((downloaded - last_downloaded) as f64 / elapsed_secs) as u64
            } else {
                0
            };

            {
                let mut tasks = DOWNLOAD_TASKS.lock().await;
                if let Some(task) = tasks.get_mut(task_id) {
                    task.downloaded_size = downloaded;
                    task.speed = speed;
                    task.updated_at = current_time();
                }
            }

            last_update = now;
            last_downloaded = downloaded;
        }
    }

    // 最终更新 - 确保 total_size 也被设置（对于不返回 Content-Length 的服务器）
    {
        let mut tasks = DOWNLOAD_TASKS.lock().await;
        if let Some(task) = tasks.get_mut(task_id) {
            task.downloaded_size = downloaded;
            // 如果 total_size 为 0，设置为实际下载大小
            if task.total_size == 0 {
                task.total_size = downloaded;
            }
            task.speed = 0;
            task.updated_at = current_time();
        }
    }

    Ok(())
}

/// 检查是否被取消
async fn is_cancelled(task_id: &str) -> bool {
    let flags = DOWNLOAD_CANCELLED.lock().await;
    flags
        .get(task_id)
        .map(|f| f.load(Ordering::SeqCst))
        .unwrap_or(false)
}

/// 更新任务状态
async fn update_task_status(task_id: &str, status: &str, error: Option<String>) {
    let mut tasks = DOWNLOAD_TASKS.lock().await;
    if let Some(task) = tasks.get_mut(task_id) {
        task.status = status.to_string();
        task.error = error;
        task.updated_at = current_time();
    }
    drop(tasks);

    // 在终态时持久化保存
    if status == "completed" || status == "failed" || status == "cancelled" || status == "paused" {
        if let Err(e) = save_tasks_to_file().await {
            log::error!("保存下载任务失败: {}", e);
        }
    }
}

/// 暂停下载
#[tauri::command]
pub async fn pause_download(task_id: String) -> Result<(), String> {
    ensure_tasks_loaded().await;

    // 设置取消标志
    {
        let flags = DOWNLOAD_CANCELLED.lock().await;
        if let Some(flag) = flags.get(&task_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }

    // 更新状态
    update_task_status(&task_id, "paused", None).await;

    Ok(())
}

/// 恢复下载
#[tauri::command]
pub async fn resume_download(task_id: String) -> Result<(), String> {
    ensure_tasks_loaded().await;

    // 获取任务信息
    let task = {
        let tasks = DOWNLOAD_TASKS.lock().await;
        tasks.get(&task_id).cloned()
    };

    let task = task.ok_or_else(|| format!("任务不存在: {}", task_id))?;

    if task.status != "paused" {
        return Err("任务未暂停，无法恢复".to_string());
    }

    // 重置取消标志
    {
        let mut flags = DOWNLOAD_CANCELLED.lock().await;
        flags.insert(task_id.clone(), AtomicBool::new(false));
    }

    // 重新启动下载
    let id = task_id.clone();
    let url = task.url.clone();
    let path = task.save_path.clone();

    tokio::spawn(async move {
        download_with_retry(&id, &url, &path, 3).await;
    });

    Ok(())
}

/// 取消下载
#[tauri::command]
pub async fn cancel_download(task_id: String) -> Result<(), String> {
    ensure_tasks_loaded().await;

    // 设置取消标志
    {
        let flags = DOWNLOAD_CANCELLED.lock().await;
        if let Some(flag) = flags.get(&task_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }

    // 获取保存路径并删除文件
    let save_path = {
        let tasks = DOWNLOAD_TASKS.lock().await;
        tasks.get(&task_id).map(|t| t.save_path.clone())
    };

    if let Some(path) = save_path {
        let _ = fs::remove_file(&path);
    }

    // 从任务列表中移除
    {
        let mut tasks = DOWNLOAD_TASKS.lock().await;
        tasks.remove(&task_id);
    }

    {
        let mut flags = DOWNLOAD_CANCELLED.lock().await;
        flags.remove(&task_id);
    }

    // 持久化保存
    if let Err(e) = save_tasks_to_file().await {
        log::error!("保存下载任务失败: {}", e);
    }

    Ok(())
}

/// 获取所有下载任务
#[tauri::command]
pub async fn get_download_tasks() -> Result<Vec<DownloadTask>, String> {
    ensure_tasks_loaded().await;

    let tasks = DOWNLOAD_TASKS.lock().await;
    Ok(tasks.values().cloned().collect())
}

/// 获取单个下载任务
#[tauri::command]
pub async fn get_download_task(task_id: String) -> Result<Option<DownloadTask>, String> {
    ensure_tasks_loaded().await;

    let tasks = DOWNLOAD_TASKS.lock().await;
    Ok(tasks.get(&task_id).cloned())
}

/// 清除已完成的下载任务
#[tauri::command]
pub async fn clear_completed_downloads() -> Result<u32, String> {
    ensure_tasks_loaded().await;

    let mut tasks = DOWNLOAD_TASKS.lock().await;
    let initial_count = tasks.len();

    tasks.retain(|_, task| task.status != "completed" && task.status != "failed");

    let removed_count = (initial_count - tasks.len()) as u32;
    drop(tasks);

    // 持久化保存
    if removed_count > 0 {
        if let Err(e) = save_tasks_to_file().await {
            log::error!("保存下载任务失败: {}", e);
        }
    }

    Ok(removed_count)
}

/// 打开下载文件夹
#[tauri::command]
pub async fn open_download_folder(task_id: String) -> Result<(), String> {
    ensure_tasks_loaded().await;

    let save_path = {
        let tasks = DOWNLOAD_TASKS.lock().await;
        tasks.get(&task_id).map(|t| t.save_path.clone())
    };

    let path = save_path.ok_or_else(|| "任务不存在".to_string())?;

    // 获取目录路径
    let dir = Path::new(&path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    // 使用系统命令打开文件夹
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    }

    Ok(())
}

/// 删除下载任务（可选删除文件）
#[tauri::command]
pub async fn remove_download_task(task_id: String, delete_file: Option<bool>) -> Result<(), String> {
    ensure_tasks_loaded().await;

    let delete_file = delete_file.unwrap_or(false);

    // 先取消下载（如果正在下载）
    {
        let flags = DOWNLOAD_CANCELLED.lock().await;
        if let Some(flag) = flags.get(&task_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }

    // 获取文件路径
    let save_path = {
        let tasks = DOWNLOAD_TASKS.lock().await;
        tasks.get(&task_id).map(|t| t.save_path.clone())
    };

    // 删除文件（如果需要）
    if delete_file {
        if let Some(path) = save_path {
            let _ = fs::remove_file(&path);
        }
    }

    // 从任务列表中移除
    {
        let mut tasks = DOWNLOAD_TASKS.lock().await;
        tasks.remove(&task_id);
    }

    {
        let mut flags = DOWNLOAD_CANCELLED.lock().await;
        flags.remove(&task_id);
    }

    // 持久化保存
    if let Err(e) = save_tasks_to_file().await {
        log::error!("保存下载任务失败: {}", e);
    }

    Ok(())
}
