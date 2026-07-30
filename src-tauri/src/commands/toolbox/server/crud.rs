// 静态服务 CRUD：create / stop / remove / get / update

use crate::error::AppResult;
use std::path::PathBuf;
use std::sync::Arc;

use super::super::{current_time, generate_id, ServerConfig, ServerConfigInput};
use super::runtime::run_server;
use super::{
    ensure_servers_loaded, save_servers_to_file, ServerController, SERVERS, SERVER_CONTROLLERS,
};

/// 创建服务
#[tauri::command]
#[specta::specta]
pub async fn create_server(input: ServerConfigInput) -> AppResult<ServerConfig> {
    ensure_servers_loaded().await;

    // 验证
    if input.port == 0 {
        return Err(crate::error::AppError::from("端口不能为 0".to_string()));
    }
    if input.root_dir.is_empty() {
        return Err(crate::error::AppError::from("根目录不能为空".to_string()));
    }

    // 检查目录是否存在
    let root_path = PathBuf::from(&input.root_dir);
    if !root_path.exists() {
        return Err(crate::error::AppError::from(format!(
            "目录不存在: {}",
            input.root_dir
        )));
    }

    // 检查端口是否已被使用
    {
        let servers = SERVERS.lock().await;
        for server in servers.values() {
            if server.port == input.port && server.status == "running" {
                return Err(crate::error::AppError::from(format!(
                    "端口 {} 已被其他服务使用",
                    input.port
                )));
            }
        }
    }

    // 处理 URL 前缀：默认使用目录名
    let url_prefix = match input.url_prefix {
        Some(ref prefix) if prefix == "/" => "/".to_string(),
        Some(ref prefix) if !prefix.is_empty() => {
            let p = prefix.trim_matches('/');
            if p.is_empty() {
                "/".to_string()
            } else {
                format!("/{}", p)
            }
        }
        _ => {
            // 默认使用目录名作为前缀
            if let Some(dir_name) = root_path.file_name().and_then(|n| n.to_str()) {
                format!("/{}", dir_name)
            } else {
                "/".to_string()
            }
        }
    };

    // 处理首页设置
    let index_page = input.index_page.filter(|s| !s.is_empty());

    let server_id = generate_id();
    let config = ServerConfig {
        id: server_id.clone(),
        name: input.name,
        port: input.port,
        root_dir: input.root_dir,
        cors: input.cors.unwrap_or(true),
        gzip: input.gzip.unwrap_or(true),
        cache_control: input.cache_control,
        url_prefix,
        index_page,
        proxies: input.proxies.unwrap_or_default(),
        expose_lan: input.expose_lan.unwrap_or(false),
        status: "stopped".to_string(),
        created_at: current_time(),
    };

    // 保存配置
    {
        let mut servers = SERVERS.lock().await;
        servers.insert(server_id.clone(), config.clone());
    }

    // 持久化到文件
    if let Err(e) = save_servers_to_file().await {
        log::error!("保存服务配置失败: {}", e);
        // 移除刚添加的配置，因为无法持久化
        let mut servers = SERVERS.lock().await;
        servers.remove(&server_id);
        return Err(crate::error::AppError::from(format!(
            "保存服务配置失败: {}",
            e
        )));
    }

    Ok(config)
}

/// 停止服务
#[tauri::command]
#[specta::specta]
pub async fn stop_server(server_id: String) -> AppResult<()> {
    log::info!("停止服务: {}", server_id);

    // 发送停止信号
    let has_controller = {
        let controllers = SERVER_CONTROLLERS.lock().await;
        if let Some(controller) = controllers.get(&server_id) {
            controller.stop();
            log::info!("已发送停止信号");
            true
        } else {
            log::warn!("未找到服务控制器: {}", server_id);
            false
        }
    };

    // 立即更新状态，不等待服务实际停止
    {
        let mut servers = SERVERS.lock().await;
        if let Some(server) = servers.get_mut(&server_id) {
            server.status = "stopped".to_string();
            log::info!("服务状态已更新为停止");
        }
    }

    // 移除控制器
    {
        let mut controllers = SERVER_CONTROLLERS.lock().await;
        controllers.remove(&server_id);
    }

    // 只在找到控制器时短暂等待（让服务有机会清理）
    if has_controller {
        // 非常短的等待，让 shutdown 信号传递
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    }

    log::info!("服务停止完成: {}", server_id);
    Ok(())
}

/// 启动服务
#[tauri::command]
#[specta::specta]
pub async fn start_server(server_id: String) -> AppResult<String> {
    ensure_servers_loaded().await;

    // 获取配置
    let config = {
        let servers = SERVERS.lock().await;
        servers.get(&server_id).cloned()
    };

    let config =
        config.ok_or_else(|| crate::error::AppError::from(format!("服务不存在: {}", server_id)))?;

    if config.status == "running" {
        return Err(crate::error::AppError::from("服务已在运行中".to_string()));
    }

    // 创建控制器
    let controller = Arc::new(ServerController::new());

    // 保存控制器
    {
        let mut controllers = SERVER_CONTROLLERS.lock().await;
        controllers.insert(server_id.clone(), controller.clone());
    }

    // 更新状态
    {
        let mut servers = SERVERS.lock().await;
        if let Some(s) = servers.get_mut(&server_id) {
            s.status = "running".to_string();
        }
    }

    let id = server_id.clone();
    let port = config.port;
    let url_prefix = config.url_prefix.clone();
    let index_page = config.index_page.clone();

    // 启动服务
    tokio::spawn(async move {
        let result = run_server(&id, config, controller).await;

        match result {
            Ok(()) => {
                log::info!("服务正常停止: {}", port);
            }
            Err(e) => {
                log::error!("服务错误 (端口 {}): {}", port, e);
            }
        }

        // 更新状态（使用 try_lock 避免死锁）
        if let Ok(mut servers) = SERVERS.try_lock() {
            if let Some(s) = servers.get_mut(&id) {
                s.status = "stopped".to_string();
            }
        } else {
            // 如果获取锁失败，延迟重试
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            let mut servers = SERVERS.lock().await;
            if let Some(s) = servers.get_mut(&id) {
                s.status = "stopped".to_string();
            }
        }
    });

    // 返回带前缀和首页的 URL
    let base_url = if url_prefix == "/" {
        format!("http://127.0.0.1:{}", port)
    } else {
        format!("http://127.0.0.1:{}{}", port, url_prefix)
    };

    // 拼接首页
    let full_url = match index_page {
        Some(page) => {
            let page = page.trim_start_matches('/');
            if base_url.ends_with('/') {
                format!("{}{}", base_url, page)
            } else {
                format!("{}/{}", base_url, page)
            }
        }
        None => {
            if base_url.ends_with('/') || url_prefix == "/" {
                base_url
            } else {
                format!("{}/", base_url)
            }
        }
    };

    Ok(full_url)
}

/// 移除服务
#[tauri::command]
#[specta::specta]
pub async fn remove_server(server_id: String) -> AppResult<()> {
    ensure_servers_loaded().await;

    // 先停止服务
    let _ = stop_server(server_id.clone()).await;

    // 保存旧配置以便回滚
    let old_config = {
        let servers = SERVERS.lock().await;
        servers.get(&server_id).cloned()
    };

    // 移除配置
    {
        let mut servers = SERVERS.lock().await;
        servers.remove(&server_id);
    }

    // 持久化到文件
    if let Err(e) = save_servers_to_file().await {
        log::error!("保存服务配置失败: {}", e);
        // 回滚：恢复删除的配置
        if let Some(config) = old_config {
            let mut servers = SERVERS.lock().await;
            servers.insert(server_id, config);
        }
        return Err(crate::error::AppError::from(format!(
            "保存服务配置失败: {}",
            e
        )));
    }

    Ok(())
}

/// 获取所有服务
#[tauri::command]
#[specta::specta]
pub async fn get_servers() -> AppResult<Vec<ServerConfig>> {
    ensure_servers_loaded().await;

    let servers = SERVERS.lock().await;
    Ok(servers.values().cloned().collect())
}

/// 获取单个服务
#[tauri::command]
#[specta::specta]
pub async fn get_server(server_id: String) -> AppResult<Option<ServerConfig>> {
    ensure_servers_loaded().await;

    let servers = SERVERS.lock().await;
    Ok(servers.get(&server_id).cloned())
}

/// 更新服务配置
#[tauri::command]
#[specta::specta]
pub async fn update_server(server_id: String, input: ServerConfigInput) -> AppResult<ServerConfig> {
    ensure_servers_loaded().await;

    // 获取当前配置（用于回滚）
    let current = {
        let servers = SERVERS.lock().await;
        servers.get(&server_id).cloned()
    };

    let current = current
        .ok_or_else(|| crate::error::AppError::from(format!("服务不存在: {}", server_id)))?;
    let old_config = current.clone();

    // 如果正在运行，先停止
    if current.status == "running" {
        stop_server(server_id.clone()).await?;
    }

    // 处理 URL 前缀
    let root_path = PathBuf::from(&input.root_dir);
    let url_prefix = match input.url_prefix {
        Some(ref prefix) if prefix == "/" => "/".to_string(),
        Some(ref prefix) if !prefix.is_empty() => {
            let p = prefix.trim_matches('/');
            if p.is_empty() {
                "/".to_string()
            } else {
                format!("/{}", p)
            }
        }
        _ => {
            // 默认使用目录名作为前缀
            if let Some(dir_name) = root_path.file_name().and_then(|n| n.to_str()) {
                format!("/{}", dir_name)
            } else {
                "/".to_string()
            }
        }
    };

    // 处理首页设置
    let index_page = input.index_page.filter(|s| !s.is_empty());

    // 更新配置
    {
        let mut servers = SERVERS.lock().await;
        if let Some(server) = servers.get_mut(&server_id) {
            server.name = input.name;
            server.port = input.port;
            server.root_dir = input.root_dir;
            server.cors = input.cors.unwrap_or(true);
            server.gzip = input.gzip.unwrap_or(true);
            server.cache_control = input.cache_control;
            server.url_prefix = url_prefix;
            server.index_page = index_page;
            server.proxies = input.proxies.unwrap_or_default();
            server.expose_lan = input.expose_lan.unwrap_or(false);
        }
    }

    // 持久化到文件
    if let Err(e) = save_servers_to_file().await {
        log::error!("保存服务配置失败: {}", e);
        // 回滚：恢复旧配置
        let mut servers = SERVERS.lock().await;
        servers.insert(server_id.clone(), old_config);
        return Err(crate::error::AppError::from(format!(
            "保存服务配置失败: {}",
            e
        )));
    }

    let servers = SERVERS.lock().await;
    servers
        .get(&server_id)
        .cloned()
        .ok_or_else(|| crate::error::AppError::from("服务不存在".to_string()))
}
