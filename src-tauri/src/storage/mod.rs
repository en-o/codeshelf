// 存储模块 - 统一管理所有数据的持久化存储

pub mod config;
pub mod schema;
pub mod migration;

use config::StorageConfig;
use once_cell::sync::Lazy;
use std::sync::Mutex;

/// 全局存储配置
pub static STORAGE_CONFIG: Lazy<Mutex<Option<StorageConfig>>> = Lazy::new(|| Mutex::new(None));

/// 初始化存储系统
/// 应在应用启动时调用，可以安全地多次调用（幂等）
pub fn init_storage() -> Result<(), String> {
    // 检查是否已初始化
    {
        let config = STORAGE_CONFIG.lock().map_err(|e| e.to_string())?;
        if config.is_some() {
            return Ok(());
        }
    }

    let config = StorageConfig::new()?;
    config.ensure_dirs()?;

    // 执行数据迁移
    migration::run_migrations(&config)?;

    // 保存配置供后续使用
    let mut global_config = STORAGE_CONFIG.lock().map_err(|e| e.to_string())?;
    *global_config = Some(config);

    log::info!("存储系统初始化成功");
    Ok(())
}

/// 获取存储配置
/// 如果存储系统尚未初始化，会尝试自动初始化
pub fn get_storage_config() -> Result<StorageConfig, String> {
    {
        let config = STORAGE_CONFIG.lock().map_err(|e| e.to_string())?;
        if let Some(cfg) = config.clone() {
            return Ok(cfg);
        }
    }

    // 如果未初始化，尝试延迟初始化
    log::info!("存储系统未初始化，尝试延迟初始化");
    init_storage()?;

    let config = STORAGE_CONFIG.lock().map_err(|e| e.to_string())?;
    config.clone().ok_or_else(|| "存储系统初始化失败".to_string())
}
