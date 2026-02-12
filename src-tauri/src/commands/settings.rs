// 设置管理模块 - 标签、分类、编辑器、终端、应用设置

use serde::{Deserialize, Serialize};
use std::fs;

use crate::storage;
use crate::storage::schema::{
    LabelsData, CategoriesData, EditorsData, EditorConfig,
    TerminalData, AppSettingsData, VersionedData, current_iso_time,
};

// ============== 标签管理 ==============

/// 获取所有标签
#[tauri::command]
pub async fn get_labels() -> Result<Vec<String>, String> {
    if let Ok(config) = storage::get_storage_config() {
        let path = config.labels_file();
        if path.exists() {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("读取标签文件失败: {}", e))?;

            if let Ok(versioned) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(labels) = versioned.get("data").and_then(|d| d.get("labels")) {
                    let labels: Vec<String> = serde_json::from_value(labels.clone())
                        .unwrap_or_default();
                    return Ok(labels);
                }
            }
        }
    }
    Ok(vec![])
}

/// 保存标签
#[tauri::command]
pub async fn save_labels(labels: Vec<String>) -> Result<(), String> {
    let config = storage::get_storage_config()?;
    config.ensure_dirs()?;

    let data = VersionedData {
        version: 1,
        last_updated: current_iso_time(),
        data: LabelsData { labels },
    };
    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("序列化标签失败: {}", e))?;
    fs::write(config.labels_file(), content)
        .map_err(|e| format!("保存标签失败: {}", e))?;
    Ok(())
}

/// 添加标签
#[tauri::command]
pub async fn add_label(label: String) -> Result<Vec<String>, String> {
    let mut labels = get_labels().await?;
    if !labels.contains(&label) {
        labels.push(label);
        save_labels(labels.clone()).await?;
    }
    Ok(labels)
}

/// 删除标签
#[tauri::command]
pub async fn remove_label(label: String) -> Result<Vec<String>, String> {
    let mut labels = get_labels().await?;
    labels.retain(|l| l != &label);
    save_labels(labels.clone()).await?;
    Ok(labels)
}

// ============== 分类管理 ==============

/// 获取所有分类
#[tauri::command]
pub async fn get_categories() -> Result<Vec<String>, String> {
    if let Ok(config) = storage::get_storage_config() {
        let path = config.categories_file();
        if path.exists() {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("读取分类文件失败: {}", e))?;

            if let Ok(versioned) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(categories) = versioned.get("data").and_then(|d| d.get("categories")) {
                    let categories: Vec<String> = serde_json::from_value(categories.clone())
                        .unwrap_or_default();
                    return Ok(categories);
                }
            }
        }
    }
    Ok(vec![])
}

/// 保存分类
#[tauri::command]
pub async fn save_categories(categories: Vec<String>) -> Result<(), String> {
    let config = storage::get_storage_config()?;
    config.ensure_dirs()?;

    let data = VersionedData {
        version: 1,
        last_updated: current_iso_time(),
        data: CategoriesData { categories },
    };
    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("序列化分类失败: {}", e))?;
    fs::write(config.categories_file(), content)
        .map_err(|e| format!("保存分类失败: {}", e))?;
    Ok(())
}

/// 添加分类
#[tauri::command]
pub async fn add_category(category: String) -> Result<Vec<String>, String> {
    let mut categories = get_categories().await?;
    if !categories.contains(&category) {
        categories.push(category);
        save_categories(categories.clone()).await?;
    }
    Ok(categories)
}

/// 删除分类
#[tauri::command]
pub async fn remove_category(category: String) -> Result<Vec<String>, String> {
    let mut categories = get_categories().await?;
    categories.retain(|c| c != &category);
    save_categories(categories.clone()).await?;
    Ok(categories)
}

// ============== 编辑器配置管理 ==============

/// 编辑器配置输入
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorConfigInput {
    pub name: String,
    pub path: String,
    pub icon: Option<String>,
    pub is_default: Option<bool>,
}

/// 获取所有编辑器配置
#[tauri::command]
pub async fn get_editors() -> Result<Vec<EditorConfig>, String> {
    if let Ok(config) = storage::get_storage_config() {
        let path = config.editors_file();
        if path.exists() {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("读取编辑器配置失败: {}", e))?;

            if let Ok(versioned) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(editors) = versioned.get("data").and_then(|d| d.get("editors")) {
                    let editors: Vec<EditorConfig> = serde_json::from_value(editors.clone())
                        .unwrap_or_default();
                    return Ok(editors);
                }
            }
        }
    }
    Ok(vec![])
}

/// 保存编辑器配置
async fn save_editors_internal(editors: &[EditorConfig]) -> Result<(), String> {
    let config = storage::get_storage_config()?;
    config.ensure_dirs()?;

    let data = VersionedData {
        version: 1,
        last_updated: current_iso_time(),
        data: EditorsData { editors: editors.to_vec() },
    };
    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("序列化编辑器配置失败: {}", e))?;
    fs::write(config.editors_file(), content)
        .map_err(|e| format!("保存编辑器配置失败: {}", e))?;
    Ok(())
}

/// 添加编辑器
#[tauri::command]
pub async fn add_editor(input: EditorConfigInput) -> Result<EditorConfig, String> {
    let mut editors = get_editors().await?;

    let editor = EditorConfig {
        id: format!("{:x}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()),
        name: input.name,
        path: input.path,
        icon: input.icon,
        is_default: input.is_default.unwrap_or(false),
    };

    // 如果设为默认，取消其他编辑器的默认状态
    if editor.is_default {
        for e in editors.iter_mut() {
            e.is_default = false;
        }
    }

    editors.push(editor.clone());
    save_editors_internal(&editors).await?;

    Ok(editor)
}

/// 更新编辑器
#[tauri::command]
pub async fn update_editor(id: String, input: EditorConfigInput) -> Result<EditorConfig, String> {
    let mut editors = get_editors().await?;

    // 如果设为默认，先取消其他编辑器的默认状态
    if input.is_default.unwrap_or(false) {
        for e in editors.iter_mut() {
            e.is_default = false;
        }
    }

    let editor = editors.iter_mut()
        .find(|e| e.id == id)
        .ok_or_else(|| "编辑器不存在".to_string())?;

    editor.name = input.name;
    editor.path = input.path;
    editor.icon = input.icon;
    editor.is_default = input.is_default.unwrap_or(editor.is_default);

    let result = editor.clone();
    save_editors_internal(&editors).await?;

    Ok(result)
}

/// 删除编辑器
#[tauri::command]
pub async fn remove_editor(id: String) -> Result<(), String> {
    let mut editors = get_editors().await?;
    editors.retain(|e| e.id != id);
    save_editors_internal(&editors).await
}

/// 设置默认编辑器
#[tauri::command]
pub async fn set_default_editor(id: String) -> Result<(), String> {
    let mut editors = get_editors().await?;
    for e in editors.iter_mut() {
        e.is_default = e.id == id;
    }
    save_editors_internal(&editors).await
}

// ============== 终端配置管理 ==============

/// 终端配置输入
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalConfigInput {
    pub terminal_type: String,
    pub custom_path: Option<String>,
    pub terminal_path: Option<String>,
}

/// 获取终端配置
#[tauri::command]
pub async fn get_terminal_config() -> Result<TerminalData, String> {
    if let Ok(config) = storage::get_storage_config() {
        let path = config.terminal_file();
        if path.exists() {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("读取终端配置失败: {}", e))?;

            if let Ok(versioned) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(data) = versioned.get("data") {
                    let terminal: TerminalData = serde_json::from_value(data.clone())
                        .unwrap_or_default();
                    return Ok(terminal);
                }
            }
        }
    }
    Ok(TerminalData::default())
}

/// 保存终端配置
#[tauri::command]
pub async fn save_terminal_config(input: TerminalConfigInput) -> Result<(), String> {
    let config = storage::get_storage_config()?;
    config.ensure_dirs()?;

    let data = VersionedData {
        version: 1,
        last_updated: current_iso_time(),
        data: TerminalData {
            terminal_type: input.terminal_type,
            custom_path: input.custom_path,
            terminal_path: input.terminal_path,
        },
    };
    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("序列化终端配置失败: {}", e))?;
    fs::write(config.terminal_file(), content)
        .map_err(|e| format!("保存终端配置失败: {}", e))?;
    Ok(())
}

// ============== 应用设置管理 ==============

/// 应用设置输入
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettingsInput {
    pub theme: Option<String>,
    pub view_mode: Option<String>,
    pub sidebar_collapsed: Option<bool>,
    pub scan_depth: Option<u32>,
}

/// 获取应用设置
#[tauri::command]
pub async fn get_app_settings() -> Result<AppSettingsData, String> {
    if let Ok(config) = storage::get_storage_config() {
        let path = config.app_settings_file();
        if path.exists() {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("读取应用设置失败: {}", e))?;

            if let Ok(versioned) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(data) = versioned.get("data") {
                    let settings: AppSettingsData = serde_json::from_value(data.clone())
                        .unwrap_or_default();
                    return Ok(settings);
                }
            }
        }
    }
    Ok(AppSettingsData::default())
}

/// 保存应用设置
#[tauri::command]
pub async fn save_app_settings(input: AppSettingsInput) -> Result<AppSettingsData, String> {
    let mut settings = get_app_settings().await?;

    if let Some(theme) = input.theme {
        settings.theme = theme;
    }
    if let Some(view_mode) = input.view_mode {
        settings.view_mode = view_mode;
    }
    if let Some(sidebar_collapsed) = input.sidebar_collapsed {
        settings.sidebar_collapsed = sidebar_collapsed;
    }
    if let Some(scan_depth) = input.scan_depth {
        settings.scan_depth = scan_depth;
    }

    let config = storage::get_storage_config()?;
    config.ensure_dirs()?;

    let data = VersionedData {
        version: 1,
        last_updated: current_iso_time(),
        data: settings.clone(),
    };
    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("序列化应用设置失败: {}", e))?;
    fs::write(config.app_settings_file(), content)
        .map_err(|e| format!("保存应用设置失败: {}", e))?;

    Ok(settings)
}
