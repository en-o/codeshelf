// 数据迁移模块 - 处理从旧版本到新版本的数据迁移
// 注意：数据结构已封版，不会有第二次迁移

use super::config::{get_old_config_dir, get_old_data_dir, StorageConfig};
use super::schema::*;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// 当前数据版本（封版，不再变动）
pub const CURRENT_VERSION: u32 = 1;

/// 迁移结果
#[derive(Debug, Clone)]
pub struct MigrationResult {
    pub success: bool,
    pub migrated_items: Vec<String>,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

impl Default for MigrationResult {
    fn default() -> Self {
        Self {
            success: true,
            migrated_items: Vec::new(),
            errors: Vec::new(),
            warnings: Vec::new(),
        }
    }
}

/// 执行所有必要的迁移
pub fn run_migrations(config: &StorageConfig) -> Result<MigrationResult, String> {
    // 确保目录存在
    config.ensure_dirs()?;

    let migration_file = config.migration_file();

    // 读取当前迁移状态
    let mut migration_data = if migration_file.exists() {
        let content = fs::read_to_string(&migration_file)
            .map_err(|e| format!("读取迁移文件失败: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        MigrationData::default()
    };

    let mut result = MigrationResult::default();

    // 检查是否需要执行 v0 -> v1 迁移（首次迁移）
    if migration_data.last_migration_version == 0 {
        log::info!("执行数据迁移: v0 -> v1");

        // 执行迁移
        let migration_result = migrate_v0_to_v1(config);

        // 记录迁移结果
        migration_data.migrations.push(MigrationRecord {
            id: "v1_initial".to_string(),
            completed_at: current_iso_time(),
            success: migration_result.success,
        });
        migration_data.last_migration_version = 1;

        // 合并结果
        result = migration_result;

        // 保存迁移状态
        save_migration_data(&migration_file, &migration_data)?;

        if !result.errors.is_empty() {
            log::error!("数据迁移有错误: {:?}", result.errors);
        }
        if !result.warnings.is_empty() {
            log::warn!("数据迁移有警告: {:?}", result.warnings);
        }
        if !result.migrated_items.is_empty() {
            log::info!("已迁移数据: {:?}", result.migrated_items);
        }
    }

    // 每次启动都检查并初始化缺失的数据文件
    ensure_all_data_files(config)?;

    Ok(result)
}

/// v0 -> v1 迁移
/// 从旧位置迁移数据到新位置，并转换格式
fn migrate_v0_to_v1(config: &StorageConfig) -> MigrationResult {
    let mut result = MigrationResult::default();

    // 1. 迁移项目数据（关键数据，失败则报错）
    match migrate_projects(config) {
        Ok(Some(msg)) => result.migrated_items.push(msg),
        Ok(None) => {}
        Err(e) => {
            result.success = false;
            result.errors.push(format!("项目数据迁移失败: {}", e));
        }
    }

    // 2. 迁移统计缓存（非关键，可以重建）
    match migrate_stats_cache(config) {
        Ok(Some(msg)) => result.migrated_items.push(msg),
        Ok(None) => {}
        Err(e) => {
            result.warnings.push(format!("统计缓存迁移失败（将重新生成）: {}", e));
            // 创建空文件
            let _ = create_empty_stats_cache_file(&config.stats_cache_file());
        }
    }

    // 3. 迁移 Claude 配置档案
    match migrate_claude_profiles(config) {
        Ok(Some(msg)) => result.migrated_items.push(msg),
        Ok(None) => {}
        Err(e) => {
            result.warnings.push(format!("Claude 配置档案迁移失败: {}", e));
        }
    }

    // 4. 迁移标签数据
    match migrate_labels(config) {
        Ok(Some(msg)) => result.migrated_items.push(msg),
        Ok(None) => {}
        Err(e) => {
            result.warnings.push(format!("标签数据迁移失败: {}", e));
        }
    }

    // 5. 迁移分类数据
    match migrate_categories(config) {
        Ok(Some(msg)) => result.migrated_items.push(msg),
        Ok(None) => {}
        Err(e) => {
            result.warnings.push(format!("分类数据迁移失败: {}", e));
        }
    }

    result
}

/// 迁移项目数据
fn migrate_projects(config: &StorageConfig) -> Result<Option<String>, String> {
    let new_file = config.projects_file();

    // 如果新文件已存在，跳过
    if new_file.exists() {
        return Ok(None);
    }

    // 尝试从旧位置读取
    if let Some(old_dir) = get_old_data_dir() {
        let old_file = old_dir.join("projects.json");
        if old_file.exists() {
            log::info!("迁移项目数据: {} -> {}", old_file.display(), new_file.display());

            let content = fs::read_to_string(&old_file)
                .map_err(|e| format!("读取旧项目文件失败: {} - {}", old_file.display(), e))?;

            // 尝试解析旧格式
            // 旧格式可能是:
            // 1. Vec<Project> - 直接数组
            // 2. { "projects": Vec<Project> } - 包装对象
            // 3. { "version": 1, "data": { "projects": [...] } } - 新格式（已迁移过）

            let projects = parse_old_projects(&content)
                .map_err(|e| format!("解析旧项目数据失败: {}", e))?;

            let new_data = VersionedData {
                version: CURRENT_VERSION,
                last_updated: current_iso_time(),
                data: ProjectsData { projects },
            };

            let new_content = serde_json::to_string(&new_data)
                .map_err(|e| format!("序列化新项目数据失败: {}", e))?;

            fs::write(&new_file, new_content)
                .map_err(|e| format!("写入新项目文件失败: {}", e))?;

            return Ok(Some(format!("项目数据 ({} 个项目)", new_data.data.projects.len())));
        }
    }

    // 没有旧数据，创建空文件
    create_empty_projects_file(&new_file)?;
    Ok(None)
}

/// 解析旧版项目数据（支持多种格式）
fn parse_old_projects(content: &str) -> Result<Vec<Project>, String> {
    // 尝试解析为 JSON
    let value: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    // 格式1: 直接是数组 [...]
    if value.is_array() {
        return serde_json::from_value(value)
            .map_err(|e| format!("解析项目数组失败: {}", e));
    }

    // 格式2: 新格式 { "version": ..., "data": { "projects": [...] } }
    if let Some(data) = value.get("data") {
        if let Some(projects) = data.get("projects") {
            return serde_json::from_value(projects.clone())
                .map_err(|e| format!("解析 data.projects 失败: {}", e));
        }
    }

    // 格式3: { "projects": [...] }
    if let Some(projects) = value.get("projects") {
        return serde_json::from_value(projects.clone())
            .map_err(|e| format!("解析 projects 字段失败: {}", e));
    }

    Err("无法识别的项目数据格式".to_string())
}

/// 迁移统计缓存
fn migrate_stats_cache(config: &StorageConfig) -> Result<Option<String>, String> {
    let new_file = config.stats_cache_file();

    if new_file.exists() {
        return Ok(None);
    }

    if let Some(old_dir) = get_old_data_dir() {
        let old_file = old_dir.join("stats_cache.json");
        if old_file.exists() {
            log::info!("迁移统计缓存: {} -> {}", old_file.display(), new_file.display());

            let content = fs::read_to_string(&old_file)
                .map_err(|e| format!("读取旧统计缓存失败: {}", e))?;

            // 尝试解析，失败则使用默认值
            let old_cache: StatsCacheData = serde_json::from_str(&content)
                .unwrap_or_default();

            let new_data = VersionedData {
                version: CURRENT_VERSION,
                last_updated: current_iso_time(),
                data: old_cache,
            };

            let new_content = serde_json::to_string(&new_data)
                .map_err(|e| format!("序列化新统计缓存失败: {}", e))?;

            fs::write(&new_file, new_content)
                .map_err(|e| format!("写入新统计缓存失败: {}", e))?;

            return Ok(Some("统计缓存".to_string()));
        }
    }

    // 没有旧数据，创建空文件
    create_empty_stats_cache_file(&new_file)?;
    Ok(None)
}

/// 迁移 Claude 配置档案
fn migrate_claude_profiles(config: &StorageConfig) -> Result<Option<String>, String> {
    let new_file = config.claude_profiles_file();

    if new_file.exists() {
        return Ok(None);
    }

    let mut all_profiles = ClaudeProfilesData::default();
    let mut profile_count = 0;

    if let Some(old_dir) = get_old_config_dir() {
        if old_dir.exists() {
            if let Ok(entries) = fs::read_dir(&old_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if name.starts_with("claude_profiles_") && name.ends_with(".json") {
                            let env_name = name
                                .trim_start_matches("claude_profiles_")
                                .trim_end_matches(".json");

                            log::info!("迁移 Claude 配置档案: {} ({})", path.display(), env_name);

                            if let Ok(content) = fs::read_to_string(&path) {
                                if let Ok(profiles) = serde_json::from_str::<Vec<ConfigProfile>>(&content) {
                                    profile_count += profiles.len();
                                    all_profiles.environments.insert(
                                        env_name.to_string(),
                                        EnvironmentProfiles { profiles },
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 写入配置
    let new_data = VersionedData {
        version: CURRENT_VERSION,
        last_updated: current_iso_time(),
        data: all_profiles,
    };

    let new_content = serde_json::to_string(&new_data)
        .map_err(|e| format!("序列化 Claude 配置档案失败: {}", e))?;

    fs::write(&new_file, new_content)
        .map_err(|e| format!("写入 Claude 配置档案失败: {}", e))?;

    if profile_count > 0 {
        Ok(Some(format!("Claude 配置档案 ({} 个)", profile_count)))
    } else {
        Ok(None)
    }
}

/// 迁移标签数据
fn migrate_labels(config: &StorageConfig) -> Result<Option<String>, String> {
    let new_file = config.labels_file();

    if new_file.exists() {
        return Ok(None);
    }

    // 尝试从旧位置读取
    if let Some(old_dir) = get_old_data_dir() {
        let old_file = old_dir.join("labels.json");
        if old_file.exists() {
            log::info!("迁移标签数据: {} -> {}", old_file.display(), new_file.display());

            let content = fs::read_to_string(&old_file)
                .map_err(|e| format!("读取旧标签文件失败: {}", e))?;

            let labels = parse_old_string_array(&content, "labels")?;

            let new_data = VersionedData {
                version: CURRENT_VERSION,
                last_updated: current_iso_time(),
                data: LabelsData { labels: labels.clone() },
            };

            let new_content = serde_json::to_string(&new_data)
                .map_err(|e| format!("序列化标签数据失败: {}", e))?;

            fs::write(&new_file, new_content)
                .map_err(|e| format!("写入标签文件失败: {}", e))?;

            return Ok(Some(format!("标签 ({} 个)", labels.len())));
        }
    }

    // 没有旧数据，创建默认标签
    create_empty_labels_file(&new_file)?;
    Ok(None)
}

/// 迁移分类数据
fn migrate_categories(config: &StorageConfig) -> Result<Option<String>, String> {
    let new_file = config.categories_file();

    if new_file.exists() {
        return Ok(None);
    }

    // 尝试从旧位置读取
    if let Some(old_dir) = get_old_data_dir() {
        // 可能叫 categories.json 或 tags.json
        for filename in &["categories.json", "tags.json"] {
            let old_file = old_dir.join(filename);
            if old_file.exists() {
                log::info!("迁移分类数据: {} -> {}", old_file.display(), new_file.display());

                let content = fs::read_to_string(&old_file)
                    .map_err(|e| format!("读取旧分类文件失败: {}", e))?;

                let categories = parse_old_string_array(&content, "categories")?;

                let new_data = VersionedData {
                    version: CURRENT_VERSION,
                    last_updated: current_iso_time(),
                    data: CategoriesData { categories: categories.clone() },
                };

                let new_content = serde_json::to_string(&new_data)
                    .map_err(|e| format!("序列化分类数据失败: {}", e))?;

                fs::write(&new_file, new_content)
                    .map_err(|e| format!("写入分类文件失败: {}", e))?;

                return Ok(Some(format!("分类 ({} 个)", categories.len())));
            }
        }
    }

    // 没有旧数据，创建默认分类
    create_empty_categories_file(&new_file)?;
    Ok(None)
}

/// 解析旧版字符串数组数据
fn parse_old_string_array(content: &str, field_name: &str) -> Result<Vec<String>, String> {
    let value: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    // 格式1: 直接是数组 [...]
    if value.is_array() {
        return serde_json::from_value(value)
            .map_err(|e| format!("解析数组失败: {}", e));
    }

    // 格式2: 新格式 { "version": ..., "data": { "field": [...] } }
    if let Some(data) = value.get("data") {
        if let Some(arr) = data.get(field_name) {
            return serde_json::from_value(arr.clone())
                .map_err(|e| format!("解析 data.{} 失败: {}", field_name, e));
        }
    }

    // 格式3: { "field": [...] }
    if let Some(arr) = value.get(field_name) {
        return serde_json::from_value(arr.clone())
            .map_err(|e| format!("解析 {} 字段失败: {}", field_name, e));
    }

    // 如果都不匹配，返回空数组
    Ok(Vec::new())
}

// ============== 创建空文件的辅助函数 ==============

fn create_empty_projects_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let data = VersionedData {
        version: CURRENT_VERSION,
        last_updated: current_iso_time(),
        data: ProjectsData::default(),
    };
    let content = serde_json::to_string(&data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

fn create_empty_stats_cache_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let data = VersionedData {
        version: CURRENT_VERSION,
        last_updated: current_iso_time(),
        data: StatsCacheData::default(),
    };
    let content = serde_json::to_string(&data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

fn create_empty_claude_profiles_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let data = VersionedData {
        version: CURRENT_VERSION,
        last_updated: current_iso_time(),
        data: ClaudeProfilesData::default(),
    };
    let content = serde_json::to_string(&data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

fn create_empty_download_tasks_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let data = VersionedData {
        version: CURRENT_VERSION,
        last_updated: current_iso_time(),
        data: DownloadTasksData::default(),
    };
    let content = serde_json::to_string(&data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

fn create_empty_forward_rules_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let data = VersionedData {
        version: CURRENT_VERSION,
        last_updated: current_iso_time(),
        data: ForwardRulesData::default(),
    };
    let content = serde_json::to_string(&data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

fn create_empty_server_configs_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let data = VersionedData {
        version: CURRENT_VERSION,
        last_updated: current_iso_time(),
        data: ServerConfigsData::default(),
    };
    let content = serde_json::to_string(&data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

fn create_empty_labels_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    // 默认标签
    let data = VersionedData {
        version: CURRENT_VERSION,
        last_updated: current_iso_time(),
        data: LabelsData {
            labels: vec![
                "Java".to_string(),
                "Python".to_string(),
                "JavaScript".to_string(),
                "TypeScript".to_string(),
                "Rust".to_string(),
                "Go".to_string(),
                "Vue".to_string(),
                "React".to_string(),
                "Spring Boot".to_string(),
                "小程序".to_string(),
            ],
        },
    };
    let content = serde_json::to_string(&data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

fn create_empty_categories_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    // 默认分类
    let data = VersionedData {
        version: CURRENT_VERSION,
        last_updated: current_iso_time(),
        data: CategoriesData {
            categories: vec![
                "工作".to_string(),
                "个人".to_string(),
                "学习".to_string(),
                "测试".to_string(),
            ],
        },
    };
    let content = serde_json::to_string(&data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

fn create_empty_editors_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let data = VersionedData {
        version: CURRENT_VERSION,
        last_updated: current_iso_time(),
        data: EditorsData::default(),
    };
    let content = serde_json::to_string(&data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

fn create_empty_terminal_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let data = VersionedData {
        version: CURRENT_VERSION,
        last_updated: current_iso_time(),
        data: TerminalData::default(),
    };
    let content = serde_json::to_string(&data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

fn create_empty_app_settings_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let data = VersionedData {
        version: CURRENT_VERSION,
        last_updated: current_iso_time(),
        data: AppSettingsData::default(),
    };
    let content = serde_json::to_string(&data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

fn create_empty_ui_state_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let data = VersionedData {
        version: CURRENT_VERSION,
        last_updated: current_iso_time(),
        data: UiStateData::default(),
    };
    let content = serde_json::to_string(&data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

fn create_empty_notifications_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let data = VersionedData {
        version: CURRENT_VERSION,
        last_updated: current_iso_time(),
        data: NotificationsData::default(),
    };
    let content = serde_json::to_string(&data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

fn create_empty_claude_quick_configs_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let data = VersionedData {
        version: CURRENT_VERSION,
        last_updated: current_iso_time(),
        data: ClaudeQuickConfigsData::default(),
    };
    let content = serde_json::to_string(&data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

fn create_empty_claude_installations_cache_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let data = VersionedData {
        version: CURRENT_VERSION,
        last_updated: current_iso_time(),
        data: ClaudeInstallationsCacheData::default(),
    };
    let content = serde_json::to_string(&data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

fn save_migration_data(path: &Path, data: &MigrationData) -> Result<(), String> {
    let versioned = VersionedData {
        version: CURRENT_VERSION,
        last_updated: current_iso_time(),
        data: data.clone(),
    };
    let content = serde_json::to_string(&versioned)
        .map_err(|e| format!("序列化迁移数据失败: {}", e))?;
    fs::write(path, content).map_err(|e| format!("写入迁移文件失败: {}", e))
}

/// 确保所有数据文件都存在，不存在则创建默认文件
/// 每次启动时调用，防止文件被意外删除导致程序异常
pub fn ensure_all_data_files(config: &StorageConfig) -> Result<(), String> {
    // 确保目录存在
    config.ensure_dirs()?;

    // 项目数据
    create_empty_projects_file(&config.projects_file())?;

    // 统计缓存
    create_empty_stats_cache_file(&config.stats_cache_file())?;

    // Claude 配置档案
    create_empty_claude_profiles_file(&config.claude_profiles_file())?;

    // 工具箱数据
    create_empty_download_tasks_file(&config.download_tasks_file())?;
    create_empty_forward_rules_file(&config.forward_rules_file())?;
    create_empty_server_configs_file(&config.server_configs_file())?;

    // 设置数据
    create_empty_labels_file(&config.labels_file())?;
    create_empty_categories_file(&config.categories_file())?;
    create_empty_editors_file(&config.editors_file())?;
    create_empty_terminal_file(&config.terminal_file())?;
    create_empty_app_settings_file(&config.app_settings_file())?;

    // UI 状态
    create_empty_ui_state_file(&config.ui_state_file())?;

    // 通知
    create_empty_notifications_file(&config.notifications_file())?;

    // Claude 快捷配置
    create_empty_claude_quick_configs_file(&config.claude_quick_configs_file())?;

    // Claude 安装信息缓存
    create_empty_claude_installations_cache_file(&config.claude_installations_cache_file())?;

    Ok(())
}
