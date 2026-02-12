// 设置管理模块 - 标签、分类、编辑器、终端、应用设置、UI状态、通知

use serde::{Deserialize, Serialize};
use std::fs;

use crate::storage::{
    get_storage_config, generate_id, current_iso_time,
    EditorConfig, TerminalConfig, AppSettings, UiState, Notification,
};

// ============== 标签管理 ==============

#[tauri::command]
pub async fn get_labels() -> Result<Vec<String>, String> {
    let config = get_storage_config()?;
    let path = config.labels_file();

    if !path.exists() {
        return Ok(vec![
            "Java".to_string(), "Python".to_string(), "JavaScript".to_string(),
            "TypeScript".to_string(), "Rust".to_string(), "Go".to_string(),
            "Vue".to_string(), "React".to_string(),
        ]);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取标签文件失败: {}", e))?;

    let labels: Vec<String> = serde_json::from_str(&content).unwrap_or_default();
    Ok(labels)
}

#[tauri::command]
pub async fn save_labels(labels: Vec<String>) -> Result<(), String> {
    let config = get_storage_config()?;
    config.ensure_dirs()?;

    let content = serde_json::to_string(&labels)
        .map_err(|e| format!("序列化标签失败: {}", e))?;

    fs::write(config.labels_file(), content)
        .map_err(|e| format!("保存标签失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn add_label(label: String) -> Result<Vec<String>, String> {
    let mut labels = get_labels().await?;
    if !labels.contains(&label) {
        labels.push(label);
        save_labels(labels.clone()).await?;
    }
    Ok(labels)
}

#[tauri::command]
pub async fn remove_label(label: String) -> Result<Vec<String>, String> {
    let mut labels = get_labels().await?;
    labels.retain(|l| l != &label);
    save_labels(labels.clone()).await?;
    Ok(labels)
}

// ============== 分类管理 ==============

#[tauri::command]
pub async fn get_categories() -> Result<Vec<String>, String> {
    let config = get_storage_config()?;
    let path = config.categories_file();

    if !path.exists() {
        return Ok(vec!["工作".to_string(), "个人".to_string(), "学习".to_string(), "测试".to_string()]);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取分类文件失败: {}", e))?;

    let categories: Vec<String> = serde_json::from_str(&content).unwrap_or_default();
    Ok(categories)
}

#[tauri::command]
pub async fn save_categories(categories: Vec<String>) -> Result<(), String> {
    let config = get_storage_config()?;
    config.ensure_dirs()?;

    let content = serde_json::to_string(&categories)
        .map_err(|e| format!("序列化分类失败: {}", e))?;

    fs::write(config.categories_file(), content)
        .map_err(|e| format!("保存分类失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn add_category(category: String) -> Result<Vec<String>, String> {
    let mut categories = get_categories().await?;
    if !categories.contains(&category) {
        categories.push(category);
        save_categories(categories.clone()).await?;
    }
    Ok(categories)
}

#[tauri::command]
pub async fn remove_category(category: String) -> Result<Vec<String>, String> {
    let mut categories = get_categories().await?;
    categories.retain(|c| c != &category);
    save_categories(categories.clone()).await?;
    Ok(categories)
}

// ============== 编辑器配置管理 ==============

#[derive(Debug, Serialize, Deserialize)]
pub struct EditorInput {
    pub name: String,
    pub path: String,
    pub icon: Option<String>,
    pub is_default: Option<bool>,
}

#[tauri::command]
pub async fn get_editors() -> Result<Vec<EditorConfig>, String> {
    let config = get_storage_config()?;
    let path = config.editors_file();

    if !path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取编辑器配置失败: {}", e))?;

    let editors: Vec<EditorConfig> = serde_json::from_str(&content).unwrap_or_default();
    Ok(editors)
}

async fn save_editors(editors: &[EditorConfig]) -> Result<(), String> {
    let config = get_storage_config()?;
    config.ensure_dirs()?;

    let content = serde_json::to_string(editors)
        .map_err(|e| format!("序列化编辑器配置失败: {}", e))?;

    fs::write(config.editors_file(), content)
        .map_err(|e| format!("保存编辑器配置失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn add_editor(input: EditorInput) -> Result<Vec<EditorConfig>, String> {
    let mut editors = get_editors().await?;
    let is_first = editors.is_empty();
    let is_default = input.is_default.unwrap_or(is_first);

    if is_default {
        for editor in &mut editors {
            editor.is_default = false;
        }
    }

    let new_editor = EditorConfig {
        id: generate_id(),
        name: input.name,
        path: input.path,
        icon: input.icon,
        is_default,
    };

    editors.push(new_editor);
    save_editors(&editors).await?;
    Ok(editors)
}

#[tauri::command]
pub async fn update_editor(id: String, input: EditorInput) -> Result<Vec<EditorConfig>, String> {
    let mut editors = get_editors().await?;
    let is_default = input.is_default.unwrap_or(false);

    if is_default {
        for editor in &mut editors {
            editor.is_default = false;
        }
    }

    if let Some(editor) = editors.iter_mut().find(|e| e.id == id) {
        editor.name = input.name;
        editor.path = input.path;
        editor.icon = input.icon;
        editor.is_default = is_default;
    }

    save_editors(&editors).await?;
    Ok(editors)
}

#[tauri::command]
pub async fn remove_editor(id: String) -> Result<Vec<EditorConfig>, String> {
    let mut editors = get_editors().await?;
    let was_default = editors.iter().find(|e| e.id == id).map(|e| e.is_default).unwrap_or(false);

    editors.retain(|e| e.id != id);

    if was_default && !editors.is_empty() {
        editors[0].is_default = true;
    }

    save_editors(&editors).await?;
    Ok(editors)
}

#[tauri::command]
pub async fn set_default_editor(id: String) -> Result<Vec<EditorConfig>, String> {
    let mut editors = get_editors().await?;

    for editor in &mut editors {
        editor.is_default = editor.id == id;
    }

    save_editors(&editors).await?;
    Ok(editors)
}

// ============== 终端配置管理 ==============

#[derive(Debug, Serialize, Deserialize)]
pub struct TerminalInput {
    pub terminal_type: String,
    pub custom_path: Option<String>,
    pub terminal_path: Option<String>,
}

#[tauri::command]
pub async fn get_terminal_config() -> Result<TerminalConfig, String> {
    let config = get_storage_config()?;
    let path = config.terminal_file();

    if !path.exists() {
        return Ok(TerminalConfig::default());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取终端配置失败: {}", e))?;

    let terminal: TerminalConfig = serde_json::from_str(&content).unwrap_or_default();
    Ok(terminal)
}

#[tauri::command]
pub async fn save_terminal_config(input: TerminalInput) -> Result<(), String> {
    let config = get_storage_config()?;
    config.ensure_dirs()?;

    let terminal = TerminalConfig {
        terminal_type: input.terminal_type,
        custom_path: input.custom_path,
        terminal_path: input.terminal_path,
    };

    let content = serde_json::to_string(&terminal)
        .map_err(|e| format!("序列化终端配置失败: {}", e))?;

    fs::write(config.terminal_file(), content)
        .map_err(|e| format!("保存终端配置失败: {}", e))?;
    Ok(())
}

// ============== 应用设置管理 ==============

#[derive(Debug, Serialize, Deserialize)]
pub struct AppSettingsInput {
    pub theme: Option<String>,
    pub view_mode: Option<String>,
    pub sidebar_collapsed: Option<bool>,
    pub scan_depth: Option<u32>,
}

#[tauri::command]
pub async fn get_app_settings() -> Result<AppSettings, String> {
    let config = get_storage_config()?;
    let path = config.app_settings_file();

    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取应用设置失败: {}", e))?;

    let settings: AppSettings = serde_json::from_str(&content).unwrap_or_default();
    Ok(settings)
}

#[tauri::command]
pub async fn save_app_settings(input: AppSettingsInput) -> Result<AppSettings, String> {
    let mut settings = get_app_settings().await?;

    if let Some(theme) = input.theme { settings.theme = theme; }
    if let Some(view_mode) = input.view_mode { settings.view_mode = view_mode; }
    if let Some(sidebar_collapsed) = input.sidebar_collapsed { settings.sidebar_collapsed = sidebar_collapsed; }
    if let Some(scan_depth) = input.scan_depth { settings.scan_depth = scan_depth; }

    let config = get_storage_config()?;
    config.ensure_dirs()?;

    let content = serde_json::to_string(&settings)
        .map_err(|e| format!("序列化应用设置失败: {}", e))?;

    fs::write(config.app_settings_file(), content)
        .map_err(|e| format!("保存应用设置失败: {}", e))?;

    Ok(settings)
}

// ============== UI 状态管理 ==============

#[derive(Debug, Serialize, Deserialize)]
pub struct UiStateInput {
    pub recent_detail_project_ids: Option<Vec<String>>,
}

#[tauri::command]
pub async fn get_ui_state() -> Result<UiState, String> {
    let config = get_storage_config()?;
    let path = config.ui_state_file();

    if !path.exists() {
        return Ok(UiState::default());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取UI状态失败: {}", e))?;

    let ui_state: UiState = serde_json::from_str(&content).unwrap_or_default();
    Ok(ui_state)
}

#[tauri::command]
pub async fn save_ui_state(input: UiStateInput) -> Result<UiState, String> {
    let mut ui_state = get_ui_state().await?;

    if let Some(ids) = input.recent_detail_project_ids {
        ui_state.recent_detail_project_ids = ids;
    }

    let config = get_storage_config()?;
    config.ensure_dirs()?;

    let content = serde_json::to_string(&ui_state)
        .map_err(|e| format!("序列化UI状态失败: {}", e))?;

    fs::write(config.ui_state_file(), content)
        .map_err(|e| format!("保存UI状态失败: {}", e))?;

    Ok(ui_state)
}

// ============== 通知管理 ==============

#[derive(Debug, Serialize, Deserialize)]
pub struct NotificationInput {
    pub notification_type: String,
    pub title: String,
    pub message: String,
}

#[tauri::command]
pub async fn get_notifications() -> Result<Vec<Notification>, String> {
    let config = get_storage_config()?;
    let path = config.notifications_file();

    if !path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取通知失败: {}", e))?;

    let notifications: Vec<Notification> = serde_json::from_str(&content).unwrap_or_default();
    Ok(notifications)
}

async fn save_notifications_internal(notifications: &[Notification]) -> Result<(), String> {
    let config = get_storage_config()?;
    config.ensure_dirs()?;

    let content = serde_json::to_string(notifications)
        .map_err(|e| format!("序列化通知失败: {}", e))?;

    fs::write(config.notifications_file(), content)
        .map_err(|e| format!("保存通知失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn add_notification(input: NotificationInput) -> Result<Vec<Notification>, String> {
    let mut notifications = get_notifications().await?;

    let notification = Notification {
        id: generate_id(),
        notification_type: input.notification_type,
        title: input.title,
        message: input.message,
        created_at: current_iso_time(),
    };

    notifications.insert(0, notification);
    if notifications.len() > 100 {
        notifications.truncate(100);
    }

    save_notifications_internal(&notifications).await?;
    Ok(notifications)
}

#[tauri::command]
pub async fn remove_notification(id: String) -> Result<Vec<Notification>, String> {
    let mut notifications = get_notifications().await?;
    notifications.retain(|n| n.id != id);
    save_notifications_internal(&notifications).await?;
    Ok(notifications)
}

#[tauri::command]
pub async fn clear_notifications() -> Result<(), String> {
    save_notifications_internal(&[]).await
}

#[tauri::command]
pub async fn save_notifications(notifications: Vec<Notification>) -> Result<(), String> {
    save_notifications_internal(&notifications).await
}
