// Claude Code 配置档案：CRUD 操作

use crate::error::AppResult;
use std::path::PathBuf;

use crate::storage;

use super::{ConfigProfile, EnvType};

/// 获取保存的配置档案列表
#[tauri::command]
#[specta::specta]
pub async fn get_config_profiles(
    env_type: EnvType,
    env_name: String,
) -> AppResult<Vec<ConfigProfile>> {
    let profiles_path = get_profiles_storage_path(&env_type, &env_name);

    if !profiles_path.exists() {
        return Ok(vec![]);
    }

    let content = std::fs::read_to_string(&profiles_path)
        .map_err(|e| crate::error::AppError::from(format!("读取配置档案失败: {}", e)))?;

    serde_json::from_str(&content)
        .map_err(|e| crate::error::AppError::from(format!("解析配置档案失败: {}", e)))
}

/// 保存配置档案（如果名称已存在则更新，否则新建）
#[tauri::command]
#[specta::specta]
pub async fn save_config_profile(
    env_type: EnvType,
    env_name: String,
    name: String,
    description: Option<String>,
    settings: serde_json::Value,
) -> AppResult<ConfigProfile> {
    let mut profiles = get_config_profiles(env_type.clone(), env_name.clone()).await?;

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // 查找是否已存在同名档案
    if let Some(existing) = profiles.iter_mut().find(|p| p.name == name) {
        // 更新现有档案
        existing.description = description;
        existing.settings = settings;
        existing.updated_at = now;
        let profile = existing.clone();
        save_profiles(&env_type, &env_name, &profiles)?;
        return Ok(profile);
    }

    // 新建档案
    let profile = ConfigProfile {
        id: format!(
            "{:x}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock before UNIX epoch")
                .as_nanos()
        ),
        name,
        description,
        settings,
        created_at: now.clone(),
        updated_at: now,
    };

    profiles.push(profile.clone());
    save_profiles(&env_type, &env_name, &profiles)?;

    Ok(profile)
}

/// 删除配置档案
#[tauri::command]
#[specta::specta]
pub async fn delete_config_profile(
    env_type: EnvType,
    env_name: String,
    profile_id: String,
) -> AppResult<()> {
    let mut profiles = get_config_profiles(env_type.clone(), env_name.clone()).await?;
    profiles.retain(|p| p.id != profile_id);
    save_profiles(&env_type, &env_name, &profiles)
}

/// 应用配置档案
#[tauri::command]
#[specta::specta]
pub async fn apply_config_profile(
    env_type: EnvType,
    env_name: String,
    config_path: String,
    profile_id: String,
) -> AppResult<()> {
    let profiles = get_config_profiles(env_type.clone(), env_name.clone()).await?;

    let profile = profiles
        .iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| crate::error::AppError::from("配置档案不存在".to_string()))?;

    let content = serde_json::to_string_pretty(&profile.settings)
        .map_err(|e| crate::error::AppError::from(format!("序列化配置失败: {}", e)))?;

    super::config_io::write_claude_config_file(env_type, env_name, config_path, content).await
}

/// 获取配置档案存储路径（按环境隔离）
fn get_profiles_storage_path(env_type: &EnvType, env_name: &str) -> PathBuf {
    // 根据环境类型和名称生成唯一的文件名
    let env_suffix = match env_type {
        EnvType::Host => "host".to_string(),
        EnvType::Wsl => {
            // 从 "WSL: Ubuntu" 中提取 "ubuntu"
            let distro = env_name.strip_prefix("WSL: ").unwrap_or(env_name);
            format!("wsl_{}", distro.to_lowercase().replace(' ', "_"))
        }
    };

    // 使用安装目录的 data 文件夹
    match storage::get_storage_config() {
        Ok(config) => config
            .data_dir
            .join(format!("claude_profiles_{}.json", env_suffix)),
        Err(e) => {
            log::error!("获取存储配置失败: {}", e);
            // 如果无法获取配置，使用当前目录的 data 文件夹
            PathBuf::from("data").join(format!("claude_profiles_{}.json", env_suffix))
        }
    }
}

/// 保存配置档案到文件
fn save_profiles(env_type: &EnvType, env_name: &str, profiles: &[ConfigProfile]) -> AppResult<()> {
    let path = get_profiles_storage_path(env_type, env_name);

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| crate::error::AppError::from(format!("创建目录失败: {}", e)))?;
    }

    let content = serde_json::to_string(profiles)
        .map_err(|e| crate::error::AppError::from(format!("序列化配置档案失败: {}", e)))?;

    crate::storage::write_atomic(&path, content)
        .map_err(|e| crate::error::AppError::from(format!("保存配置档案失败: {}", e)))
}

/// 从当前配置创建档案
#[tauri::command]
#[specta::specta]
pub async fn create_profile_from_current(
    env_type: EnvType,
    env_name: String,
    config_path: String,
    profile_name: String,
    description: Option<String>,
) -> AppResult<ConfigProfile> {
    let content =
        super::config_io::read_claude_config_file(env_type.clone(), env_name.clone(), config_path)
            .await?;

    let settings: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| crate::error::AppError::from(format!("解析配置失败: {}", e)))?;

    save_config_profile(env_type, env_name, profile_name, description, settings).await
}
