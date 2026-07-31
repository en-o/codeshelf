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

/// 目录是否真的可写。
///
/// 不看 permissions 位：只读挂载（AppImage、squashfs）下权限位可能是 0755，
/// 真正写的时候才会失败。所以直接试着创建一个临时文件。
///
/// `allow(dead_code)`：非 Linux 平台不调用它，但**故意保持编译**（见 `linux_base_dir`）。
#[allow(dead_code)]
fn is_writable(dir: &std::path::Path) -> bool {
    let probe = dir.join(format!(".codeshelf-write-probe-{}", std::process::id()));
    match fs::File::create(&probe) {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// 用户数据目录下的应用目录（XDG / Application Support / AppData）。
#[allow(dead_code)]
fn user_data_base() -> AppResult<PathBuf> {
    dirs::data_dir()
        .ok_or_else(|| {
            crate::error::AppError::from(
                "无法获取用户数据目录（XDG_DATA_HOME / ~/.local/share）".to_string(),
            )
        })
        .map(|d| d.join("com.codeshelf.desktop"))
}

/// Linux 的数据根目录选择。
///
/// **刻意不加 `#[cfg(target_os = "linux")]`**：加了的话这段逻辑在 macOS/Windows 上
/// 根本不参与编译，本机 `cargo check` 全绿也说明不了什么（CLAUDE.md 硬约束 3 说的
/// 就是这个坑）。写成普通函数后，任何平台的编译和单测都能覆盖它，
/// 只有最后「调不调用它」那一行才是平台相关的。
///
/// 规则：exe 旁边**已经有** data/ 且该目录可写时沿用（兼容早期以可写方式安装的用户），
/// 否则用 XDG 用户数据目录 —— deb 装在 /usr/... 、AppImage 跑在只读挂载点，
/// 普通用户在 exe 旁边建不了 data/ 和 logs/，首次启动就会失败。
#[allow(dead_code)]
fn linux_base_dir(exe_dir: Option<PathBuf>) -> AppResult<PathBuf> {
    let legacy = exe_dir.filter(|dir| dir.join("data").is_dir() && is_writable(dir));
    match legacy {
        Some(dir) => Ok(dir),
        None => user_data_base(),
    }
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

        // Windows: 数据放安装目录旁边。
        //
        // 这是既定现状，**不要改**：Windows 的便携版就是靠「数据跟着 exe 走」实现的，
        // 而安装版的数据目录位置也已经被 NSIS 升级逻辑和用户的既有数据绑定
        // （见 CLAUDE.md 硬约束 7：安装目录一旦多套一层，老数据就被留在上一层，
        // 表现为「更新后数据全没了」）。改这里影响面极大。
        #[cfg(target_os = "windows")]
        let base_dir = std::env::current_exe()
            .map_err(|e| crate::error::AppError::from(format!("获取可执行文件路径失败: {}", e)))?
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| crate::error::AppError::from("无法获取安装目录".to_string()))?;

        // Linux: 用 XDG 用户数据目录。
        //
        // 原来 Linux 跟着 Windows 走「exe 旁边」，但 deb 装到 /usr/... 、AppImage 从
        // 只读挂载点运行，普通用户在那里根本建不了 data/ 和 logs/ —— 首次启动就失败。
        //
        // 兼容既有安装：exe 旁边**已经存在** data/ 目录且可写时继续用它，
        // 免得早期用可写目录跑起来的用户升级后看到「数据全没了」。
        // Linux：见 `linux_base_dir`（逻辑写在 cfg 外面，好让本机也能编译和测试）
        #[cfg(target_os = "linux")]
        let base_dir = linux_base_dir(
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_path_buf())),
        )?;

        // 其它类 Unix（BSD 等）：同样走用户数据目录，别往安装目录写
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let base_dir = user_data_base()?;

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

#[cfg(test)]
mod tests {
    use super::*;

    /// `linux_base_dir` 的分支逻辑。之所以能在 macOS 上测，正是因为这个函数
    /// 没有藏在 `#[cfg(target_os = "linux")]` 里 —— 藏起来的代码本机一行都不编译。
    #[test]
    fn linux_prefers_existing_writable_data_dir_else_xdg() {
        let xdg = user_data_base().expect("测试环境应能取到用户数据目录");

        // 1) exe 目录不可知（取不到 current_exe）→ 用户数据目录
        assert_eq!(linux_base_dir(None).unwrap(), xdg);

        // 2) exe 旁边没有 data/ → 用户数据目录（deb 首次安装就是这种）
        let empty = std::env::temp_dir().join(format!("codeshelf-nodata-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&empty);
        std::fs::create_dir_all(&empty).unwrap();
        assert_eq!(linux_base_dir(Some(empty.clone())).unwrap(), xdg);

        // 3) exe 旁边已有 data/ 且可写 → 沿用旧位置，不能让老用户「数据全没了」
        let legacy = crate::storage::unique_test_dir("codeshelf-cfg-legacy");
        let _ = std::fs::remove_dir_all(&legacy);
        std::fs::create_dir_all(legacy.join("data")).unwrap();
        assert_eq!(linux_base_dir(Some(legacy.clone())).unwrap(), legacy);

        // 4) 有 data/ 但目录不可写（只读挂载 / 系统目录）→ 退回用户数据目录
        let readonly =
            std::env::temp_dir().join(format!("codeshelf-readonly-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&readonly);
        std::fs::create_dir_all(readonly.join("data")).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&readonly, std::fs::Permissions::from_mode(0o555)).unwrap();
            // root 无视权限位，这种环境下跳过该断言
            if !is_writable(&readonly) {
                assert_eq!(linux_base_dir(Some(readonly.clone())).unwrap(), xdg);
            }
            std::fs::set_permissions(&readonly, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        for d in [empty, legacy, readonly] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    /// 探针文件不能留在用户目录里
    #[test]
    fn write_probe_leaves_no_trace() {
        let dir = std::env::temp_dir().join(format!("codeshelf-probe-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        assert!(is_writable(&dir));
        let leftovers: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(leftovers.is_empty(), "探针文件残留: {leftovers:?}");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
