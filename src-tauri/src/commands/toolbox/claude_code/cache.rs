// Claude Code 安装信息缓存与启动目录持久化

use crate::error::AppResult;
use std::fs;

use crate::storage;
use crate::storage::schema::{ClaudeInstallation, ConfigFileInfo as SchemaConfigFileInfo};

use super::{ClaudeCodeInfo, ConfigFileInfo, EnvType};

// ============== Claude 安装信息缓存 ==============

/// 获取缓存的 Claude 安装信息
#[tauri::command]
#[specta::specta]
pub async fn get_claude_installations_cache() -> AppResult<Option<Vec<ClaudeCodeInfo>>> {
    if let Ok(config) = storage::get_storage_config() {
        let path = config.claude_installations_cache_file();
        if path.exists() {
            let content = fs::read_to_string(&path)
                .map_err(|e| crate::error::AppError::from(format!("读取安装缓存失败: {}", e)))?;

            // 直接解析为安装信息数组
            let installations: Vec<ClaudeInstallation> =
                crate::storage::parse_json_or_backup(&path, &content);

            // 转换为 ClaudeCodeInfo
            let result: Vec<ClaudeCodeInfo> = installations
                .into_iter()
                .map(|i| ClaudeCodeInfo {
                    env_type: if i.env_type == "wsl" {
                        EnvType::Wsl
                    } else {
                        EnvType::Host
                    },
                    env_name: i.env_name,
                    installed: true,
                    version: i.version,
                    path: i.path,
                    config_dir: Some(i.config_dir),
                    config_files: i
                        .config_files
                        .into_iter()
                        .map(|f| ConfigFileInfo {
                            name: f.name,
                            path: f.path,
                            exists: f.exists,
                            size: 0,
                            modified: None,
                            description: String::new(),
                        })
                        .collect(),
                })
                .collect();
            return Ok(Some(result));
        }
    }
    Ok(None)
}

/// 保存 Claude 安装信息缓存
#[tauri::command]
#[specta::specta]
pub async fn save_claude_installations_cache(installs: Vec<ClaudeCodeInfo>) -> AppResult<()> {
    let config = storage::get_storage_config()?;
    config.ensure_dirs()?;

    // 转换为简化的安装信息格式
    let installations: Vec<ClaudeInstallation> = installs
        .iter()
        .map(|i| ClaudeInstallation {
            env_type: match i.env_type {
                EnvType::Host => "host".to_string(),
                EnvType::Wsl => "wsl".to_string(),
            },
            env_name: i.env_name.clone(),
            version: i.version.clone(),
            path: i.path.clone(),
            config_dir: i.config_dir.clone().unwrap_or_default(),
            config_files: i
                .config_files
                .iter()
                .map(|f| SchemaConfigFileInfo {
                    name: f.name.clone(),
                    path: f.path.clone(),
                    exists: f.exists,
                })
                .collect(),
        })
        .collect();

    // 直接保存为安装信息数组
    let content = serde_json::to_string(&installations)
        .map_err(|e| crate::error::AppError::from(format!("序列化安装缓存失败: {}", e)))?;
    crate::storage::write_atomic(config.claude_installations_cache_file(), content)
        .map_err(|e| crate::error::AppError::from(format!("保存安装缓存失败: {}", e)))?;
    Ok(())
}

/// 清除 Claude 安装信息缓存
#[tauri::command]
#[specta::specta]
pub async fn clear_claude_installations_cache() -> AppResult<()> {
    if let Ok(config) = storage::get_storage_config() {
        let path = config.claude_installations_cache_file();
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|e| crate::error::AppError::from(format!("删除缓存文件失败: {}", e)))?;
        }
    }
    Ok(())
}

// ============== 启动目录持久化 ==============

/// 获取保存的 Claude 启动目录列表
#[tauri::command]
#[specta::specta]
pub async fn get_claude_launch_dirs() -> AppResult<Vec<String>> {
    let config = storage::get_storage_config()?;
    let path = config.claude_launch_dirs_file();

    if !path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取启动目录列表失败: {}", e)))?;

    let dirs: Vec<String> = serde_json::from_str(&content)
        .map_err(|e| crate::error::AppError::from(format!("解析启动目录列表失败: {}", e)))?;

    Ok(dirs)
}

/// 保存 Claude 启动目录列表
#[tauri::command]
#[specta::specta]
pub async fn save_claude_launch_dirs(dirs: Vec<String>) -> AppResult<()> {
    let config = storage::get_storage_config()?;
    let content = serde_json::to_string_pretty(&dirs)
        .map_err(|e| crate::error::AppError::from(format!("序列化启动目录列表失败: {}", e)))?;
    crate::storage::write_atomic(config.claude_launch_dirs_file(), content)
        .map_err(|e| crate::error::AppError::from(format!("保存启动目录列表失败: {}", e)))?;
    Ok(())
}
