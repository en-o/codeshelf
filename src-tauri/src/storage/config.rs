// 存储配置
// - macOS: ~/Library/Application Support/com.codeshelf.desktop/ (避免更新时 .app bundle 被替换导致数据丢失)
// - Windows/Linux: 安装目录下的 data 和 logs 文件夹

use crate::error::AppResult;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

/// 存储配置（全局单例）
static STORAGE_CONFIG: OnceLock<StorageConfig> = OnceLock::new();

/// 存储配置
#[derive(Debug, Clone)]
pub struct StorageConfig {
    pub data_dir: PathBuf,
    pub logs_dir: PathBuf,
}

impl StorageConfig {
    /// 创建存储配置
    pub fn new() -> AppResult<Self> {
        // macOS: 使用系统标准路径，避免更新时 .app bundle 被替换导致数据丢失
        #[cfg(target_os = "macos")]
        let base_dir = dirs::data_dir()
            .ok_or_else(|| {
                crate::error::AppError::from(
                    "无法获取系统数据目录 (Application Support)".to_string(),
                )
            })?
            .join("com.codeshelf.desktop");

        // Windows/Linux: 使用安装目录
        #[cfg(not(target_os = "macos"))]
        let base_dir = std::env::current_exe()
            .map_err(|e| crate::error::AppError::from(format!("获取可执行文件路径失败: {}", e)))?
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| crate::error::AppError::from("无法获取安装目录".to_string()))?;

        Ok(Self {
            data_dir: base_dir.join("data"),
            logs_dir: base_dir.join("logs"),
        })
    }

    /// 确保目录存在
    pub fn ensure_dirs(&self) -> AppResult<()> {
        fs::create_dir_all(&self.data_dir)
            .map_err(|e| crate::error::AppError::from(format!("创建数据目录失败: {}", e)))?;
        fs::create_dir_all(&self.logs_dir)
            .map_err(|e| crate::error::AppError::from(format!("创建日志目录失败: {}", e)))?;
        Ok(())
    }

    // ============== 数据文件路径 ==============

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

    pub fn ssh_tunnels_file(&self) -> PathBuf {
        self.data_dir.join("ssh_tunnels.json")
    }

    pub fn reverse_tunnels_file(&self) -> PathBuf {
        self.data_dir.join("reverse_tunnels.json")
    }

    pub fn server_configs_file(&self) -> PathBuf {
        self.data_dir.join("server_configs.json")
    }

    pub fn netcat_sessions_file(&self) -> PathBuf {
        self.data_dir.join("netcat_sessions.json")
    }

    pub fn claude_launch_dirs_file(&self) -> PathBuf {
        self.data_dir.join("claude_launch_dirs.json")
    }

    pub fn shortcuts_file(&self) -> PathBuf {
        self.data_dir.join("shortcuts.json")
    }

    pub fn app_shortcuts_file(&self) -> PathBuf {
        self.data_dir.join("app_shortcuts.json")
    }

    pub fn recommended_template_file(&self) -> PathBuf {
        self.data_dir.join("recommended_template.json")
    }

    /// 远程 Claude 配置模板目录的本地缓存（"本地历史"）
    pub fn claude_config_templates_file(&self) -> PathBuf {
        self.data_dir.join("claude_config_templates.json")
    }

    pub fn ai_providers_file(&self) -> PathBuf {
        self.data_dir.join("ai_providers.json")
    }

    pub fn conversations_dir(&self) -> PathBuf {
        self.data_dir.join("conversations")
    }

    pub fn memory_file(&self) -> PathBuf {
        self.data_dir.join("MEMORY.md")
    }

    pub fn skills_dir(&self) -> PathBuf {
        self.data_dir.join("skills")
    }

    pub fn workflows_dir(&self) -> PathBuf {
        self.data_dir.join("workflows")
    }

    pub fn clipboard_settings_file(&self) -> PathBuf {
        self.data_dir.join("clipboard_settings.json")
    }

    pub fn sensitive_file_patterns_file(&self) -> PathBuf {
        self.data_dir.join("sensitive_file_patterns.json")
    }

    pub fn resumes_file(&self) -> PathBuf {
        self.data_dir.join("resumes.json")
    }

    pub fn api_groups_file(&self) -> PathBuf {
        self.data_dir.join("api_groups.json")
    }

    pub fn api_endpoints_file(&self) -> PathBuf {
        self.data_dir.join("api_endpoints.json")
    }

    pub fn api_chat_sessions_dir(&self) -> PathBuf {
        self.data_dir.join("api_chat_sessions")
    }

    /// SQLite 主库文件路径。阶段 2 起作为 projects / chat / clipboard / stats 的存储。
    pub fn db_file(&self) -> PathBuf {
        self.data_dir.join("codeshelf.db")
    }
}

/// 把 project_id 之类的标识符压成可以安全做文件名的形式：
/// 只保留字母、数字、`-`、`_`，其它字符替换为 `_`。
/// 初始化存储配置
pub fn init_storage() -> AppResult<&'static StorageConfig> {
    let config = StorageConfig::new()?;
    config.ensure_dirs()?;

    // macOS: 从旧位置(.app bundle 内)迁移数据到新位置
    #[cfg(target_os = "macos")]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let old_data = exe_dir.join("data");
                let old_logs = exe_dir.join("logs");
                if old_data.exists() && old_data != config.data_dir {
                    if let Err(e) = migrate_dir(&old_data, &config.data_dir) {
                        eprintln!("迁移数据目录失败: {}", e);
                    }
                }
                if old_logs.exists() && old_logs != config.logs_dir {
                    if let Err(e) = migrate_dir(&old_logs, &config.logs_dir) {
                        eprintln!("迁移日志目录失败: {}", e);
                    }
                }
            }
        }
    }

    let _ = STORAGE_CONFIG.set(config);

    log::info!(
        "存储初始化完成，数据目录: {:?}",
        STORAGE_CONFIG
            .get()
            .expect("STORAGE_CONFIG just set above")
            .data_dir
    );

    Ok(STORAGE_CONFIG.get().expect("STORAGE_CONFIG just set above"))
}

/// macOS: 将旧目录中的文件迁移到新目录（仅当新目录为空时）
#[cfg(target_os = "macos")]
fn migrate_dir(src: &std::path::Path, dst: &std::path::Path) -> AppResult<()> {
    // 目标目录已有文件，跳过迁移（说明已经迁移过或用户已有新数据）
    if dst.exists() {
        let has_files = fs::read_dir(dst)
            .map(|mut d| d.next().is_some())
            .unwrap_or(false);
        if has_files {
            return Ok(());
        }
    }

    fs::create_dir_all(dst)
        .map_err(|e| crate::error::AppError::from(format!("创建目标目录失败: {}", e)))?;

    let entries = fs::read_dir(src)
        .map_err(|e| crate::error::AppError::from(format!("读取旧目录失败: {}", e)))?;

    for entry in entries {
        let entry =
            entry.map_err(|e| crate::error::AppError::from(format!("读取目录条目失败: {}", e)))?;
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            let dest_file = dst.join(entry.file_name());
            fs::copy(entry.path(), &dest_file).map_err(|e| {
                crate::error::AppError::from(format!(
                    "迁移文件 {:?} 失败: {}",
                    entry.file_name(),
                    e
                ))
            })?;
        }
    }

    eprintln!("数据迁移完成: {:?} -> {:?}", src, dst);
    Ok(())
}

/// 获取存储配置
pub fn get_storage_config() -> AppResult<&'static StorageConfig> {
    match STORAGE_CONFIG.get() {
        Some(config) => Ok(config),
        None => {
            // 未初始化，尝试初始化
            init_storage()
        }
    }
}
