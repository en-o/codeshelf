// 存储配置 - 使用安装目录下的 data 和 logs 文件夹

use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

/// 存储配置（全局单例）
static STORAGE_CONFIG: OnceLock<StorageConfig> = OnceLock::new();

/// 存储配置
#[derive(Debug, Clone)]
pub struct StorageConfig {
    /// 数据目录: <安装目录>/data
    pub data_dir: PathBuf,
    /// 日志目录: <安装目录>/logs
    pub logs_dir: PathBuf,
}

impl StorageConfig {
    /// 创建存储配置
    pub fn new() -> Result<Self, String> {
        let install_dir = std::env::current_exe()
            .map_err(|e| format!("获取可执行文件路径失败: {}", e))?
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| "无法获取安装目录".to_string())?;

        Ok(Self {
            data_dir: install_dir.join("data"),
            logs_dir: install_dir.join("logs"),
        })
    }

    /// 确保目录存在
    pub fn ensure_dirs(&self) -> Result<(), String> {
        fs::create_dir_all(&self.data_dir)
            .map_err(|e| format!("创建数据目录失败: {}", e))?;
        fs::create_dir_all(&self.logs_dir)
            .map_err(|e| format!("创建日志目录失败: {}", e))?;
        Ok(())
    }

    // ============== 数据文件路径 ==============

    pub fn projects_file(&self) -> PathBuf {
        self.data_dir.join("projects.json")
    }

    pub fn categories_file(&self) -> PathBuf {
        self.data_dir.join("categories.json")
    }

    pub fn labels_file(&self) -> PathBuf {
        self.data_dir.join("labels.json")
    }

    pub fn editors_file(&self) -> PathBuf {
        self.data_dir.join("editors.json")
    }

    pub fn terminal_file(&self) -> PathBuf {
        self.data_dir.join("terminal.json")
    }

    pub fn app_settings_file(&self) -> PathBuf {
        self.data_dir.join("app_settings.json")
    }

    pub fn ui_state_file(&self) -> PathBuf {
        self.data_dir.join("ui_state.json")
    }

    pub fn notifications_file(&self) -> PathBuf {
        self.data_dir.join("notifications.json")
    }

    pub fn stats_cache_file(&self) -> PathBuf {
        self.data_dir.join("stats_cache.json")
    }

    pub fn claude_quick_configs_file(&self) -> PathBuf {
        self.data_dir.join("claude_quick_configs.json")
    }

    pub fn claude_installations_cache_file(&self) -> PathBuf {
        self.data_dir.join("claude_installations_cache.json")
    }

    pub fn download_tasks_file(&self) -> PathBuf {
        self.data_dir.join("download_tasks.json")
    }

    pub fn forward_rules_file(&self) -> PathBuf {
        self.data_dir.join("forward_rules.json")
    }

    pub fn server_configs_file(&self) -> PathBuf {
        self.data_dir.join("server_configs.json")
    }

    pub fn netcat_sessions_file(&self) -> PathBuf {
        self.data_dir.join("netcat_sessions.json")
    }
}

/// 初始化存储配置
pub fn init_storage() -> Result<&'static StorageConfig, String> {
    let config = StorageConfig::new()?;
    config.ensure_dirs()?;

    let _ = STORAGE_CONFIG.set(config);

    log::info!("存储初始化完成，数据目录: {:?}", STORAGE_CONFIG.get().unwrap().data_dir);

    Ok(STORAGE_CONFIG.get().unwrap())
}

/// 获取存储配置
pub fn get_storage_config() -> Result<&'static StorageConfig, String> {
    match STORAGE_CONFIG.get() {
        Some(config) => Ok(config),
        None => {
            // 未初始化，尝试初始化
            init_storage()
        }
    }
}
