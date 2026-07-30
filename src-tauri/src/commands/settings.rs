// 设置管理模块 - 标签、分类、编辑器、终端、应用设置、UI状态、通知

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::fs;

use crate::error::AppResult;
use crate::storage::{
    current_iso_time, generate_id, get_storage_config, AiProviderConfig, AppSettings, EditorConfig,
    McpGatewayKey, Notification, TerminalConfig, UiState,
};

// ============== 标签管理 ==============

#[tauri::command]
#[specta::specta]
pub async fn get_labels() -> AppResult<Vec<String>> {
    let config = get_storage_config()?;
    let path = config.labels_file();

    if !path.exists() {
        return Ok(vec![
            "Java".to_string(),
            "Python".to_string(),
            "JavaScript".to_string(),
            "TypeScript".to_string(),
            "Rust".to_string(),
            "Go".to_string(),
            "Vue".to_string(),
            "React".to_string(),
        ]);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取标签文件失败: {}", e)))?;

    let labels: Vec<String> = crate::storage::parse_json_or_backup(&path, &content);
    Ok(labels)
}

#[tauri::command]
#[specta::specta]
pub async fn save_labels(labels: Vec<String>) -> AppResult<()> {
    let config = get_storage_config()?;
    config.ensure_dirs()?;

    let content = serde_json::to_string(&labels)
        .map_err(|e| crate::error::AppError::from(format!("序列化标签失败: {}", e)))?;

    crate::storage::write_atomic(config.labels_file(), content)
        .map_err(|e| crate::error::AppError::from(format!("保存标签失败: {}", e)))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn add_label(label: String) -> AppResult<Vec<String>> {
    let mut labels = get_labels().await?;
    if !labels.contains(&label) {
        labels.push(label);
        save_labels(labels.clone()).await?;
    }
    Ok(labels)
}

#[tauri::command]
#[specta::specta]
pub async fn remove_label(label: String) -> AppResult<Vec<String>> {
    let mut labels = get_labels().await?;
    labels.retain(|l| l != &label);
    save_labels(labels.clone()).await?;
    Ok(labels)
}

// ============== 分类管理 ==============

#[tauri::command]
#[specta::specta]
pub async fn get_categories() -> AppResult<Vec<String>> {
    let config = get_storage_config()?;
    let path = config.categories_file();

    if !path.exists() {
        return Ok(vec![
            "工作".to_string(),
            "个人".to_string(),
            "学习".to_string(),
            "测试".to_string(),
        ]);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取分类文件失败: {}", e)))?;

    let categories: Vec<String> = crate::storage::parse_json_or_backup(&path, &content);
    Ok(categories)
}

#[tauri::command]
#[specta::specta]
pub async fn save_categories(categories: Vec<String>) -> AppResult<()> {
    let config = get_storage_config()?;
    config.ensure_dirs()?;

    let content = serde_json::to_string(&categories)
        .map_err(|e| crate::error::AppError::from(format!("序列化分类失败: {}", e)))?;

    crate::storage::write_atomic(config.categories_file(), content)
        .map_err(|e| crate::error::AppError::from(format!("保存分类失败: {}", e)))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn add_category(category: String) -> AppResult<Vec<String>> {
    let mut categories = get_categories().await?;
    if !categories.contains(&category) {
        categories.push(category);
        save_categories(categories.clone()).await?;
    }
    Ok(categories)
}

#[tauri::command]
#[specta::specta]
pub async fn remove_category(category: String) -> AppResult<Vec<String>> {
    let mut categories = get_categories().await?;
    categories.retain(|c| c != &category);
    save_categories(categories.clone()).await?;
    Ok(categories)
}

// ============== 编辑器配置管理 ==============

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct EditorInput {
    pub name: String,
    pub path: String,
    pub icon: Option<String>,
    pub is_default: Option<bool>,
}

#[tauri::command]
#[specta::specta]
pub async fn get_editors() -> AppResult<Vec<EditorConfig>> {
    let config = get_storage_config()?;
    let path = config.editors_file();

    if !path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取编辑器配置失败: {}", e)))?;

    let editors: Vec<EditorConfig> = crate::storage::parse_json_or_backup(&path, &content);
    Ok(editors)
}

async fn save_editors(editors: &[EditorConfig]) -> AppResult<()> {
    let config = get_storage_config()?;
    config.ensure_dirs()?;

    let content = serde_json::to_string(editors)
        .map_err(|e| crate::error::AppError::from(format!("序列化编辑器配置失败: {}", e)))?;

    crate::storage::write_atomic(config.editors_file(), content)
        .map_err(|e| crate::error::AppError::from(format!("保存编辑器配置失败: {}", e)))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn add_editor(input: EditorInput) -> AppResult<Vec<EditorConfig>> {
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
#[specta::specta]
pub async fn update_editor(id: String, input: EditorInput) -> AppResult<Vec<EditorConfig>> {
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
#[specta::specta]
pub async fn remove_editor(id: String) -> AppResult<Vec<EditorConfig>> {
    let mut editors = get_editors().await?;
    let was_default = editors
        .iter()
        .find(|e| e.id == id)
        .map(|e| e.is_default)
        .unwrap_or(false);

    editors.retain(|e| e.id != id);

    if was_default && !editors.is_empty() {
        editors[0].is_default = true;
    }

    save_editors(&editors).await?;
    Ok(editors)
}

#[tauri::command]
#[specta::specta]
pub async fn set_default_editor(id: String) -> AppResult<Vec<EditorConfig>> {
    let mut editors = get_editors().await?;

    for editor in &mut editors {
        editor.is_default = editor.id == id;
    }

    save_editors(&editors).await?;
    Ok(editors)
}

// ============== 终端配置管理 ==============

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct TerminalInput {
    pub terminal_type: String,
    pub custom_path: Option<String>,
    pub terminal_path: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn get_terminal_config() -> AppResult<TerminalConfig> {
    let config = get_storage_config()?;
    let path = config.terminal_file();

    if !path.exists() {
        return Ok(TerminalConfig::default());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取终端配置失败: {}", e)))?;

    let terminal: TerminalConfig = crate::storage::parse_json_or_backup(&path, &content);
    Ok(terminal)
}

#[tauri::command]
#[specta::specta]
pub async fn save_terminal_config(input: TerminalInput) -> AppResult<()> {
    let config = get_storage_config()?;
    config.ensure_dirs()?;

    let terminal = TerminalConfig {
        terminal_type: input.terminal_type,
        custom_path: input.custom_path,
        terminal_path: input.terminal_path,
    };

    let content = serde_json::to_string(&terminal)
        .map_err(|e| crate::error::AppError::from(format!("序列化终端配置失败: {}", e)))?;

    crate::storage::write_atomic(config.terminal_file(), content)
        .map_err(|e| crate::error::AppError::from(format!("保存终端配置失败: {}", e)))?;
    Ok(())
}

// ============== 应用设置管理 ==============

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct AppSettingsInput {
    pub theme: Option<String>,
    pub view_mode: Option<String>,
    pub sidebar_collapsed: Option<bool>,
    pub scan_depth: Option<u32>,
    pub auto_update: Option<bool>,
    pub chat_history_dir: Option<String>,
    pub chat_bridge_enabled: Option<bool>,
    pub openclaw_relay_endpoint: Option<String>,
    pub bridge_provider_id: Option<String>,
    pub bridge_model_id: Option<String>,
    pub bridge_client_id: Option<String>,
    pub mcp_gateway_enabled: Option<bool>,
    pub mcp_gateway_host: Option<String>,
    pub mcp_gateway_port: Option<u16>,
    pub mcp_gateway_keys: Option<Vec<McpGatewayKey>>,
    pub show_dock_icon: Option<bool>,
}

#[tauri::command]
#[specta::specta]
pub async fn get_app_settings() -> AppResult<AppSettings> {
    let config = get_storage_config()?;
    let path = config.app_settings_file();

    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取应用设置失败: {}", e)))?;

    let settings: AppSettings = crate::storage::parse_json_or_backup(&path, &content);
    Ok(settings)
}

/// save_app_settings 是读-改-写，无锁并发保存会互相覆盖字段，用全局锁串行化。
static SETTINGS_SAVE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tauri::command]
#[specta::specta]
pub async fn save_app_settings(
    app: tauri::AppHandle,
    input: AppSettingsInput,
) -> AppResult<AppSettings> {
    let guard = SETTINGS_SAVE_LOCK.lock().await;
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
    if let Some(auto_update) = input.auto_update {
        settings.auto_update = auto_update;
    }
    if let Some(chat_history_dir) = input.chat_history_dir {
        settings.chat_history_dir = Some(chat_history_dir);
    }
    if let Some(v) = input.chat_bridge_enabled {
        settings.chat_bridge_enabled = v;
    }
    if let Some(v) = input.openclaw_relay_endpoint {
        settings.openclaw_relay_endpoint = Some(v);
    }
    if let Some(v) = input.bridge_provider_id {
        settings.bridge_provider_id = Some(v);
    }
    if let Some(v) = input.bridge_model_id {
        settings.bridge_model_id = Some(v);
    }
    if let Some(v) = input.bridge_client_id {
        settings.bridge_client_id = Some(v);
    }
    if let Some(v) = input.mcp_gateway_enabled {
        settings.mcp_gateway_enabled = v;
    }
    if let Some(v) = input.mcp_gateway_host {
        settings.mcp_gateway_host = v;
    }
    if let Some(v) = input.mcp_gateway_port {
        settings.mcp_gateway_port = v;
    }
    if let Some(v) = input.mcp_gateway_keys {
        settings.mcp_gateway_keys = v;
    }
    if let Some(v) = input.show_dock_icon {
        settings.show_dock_icon = v;
        #[cfg(target_os = "macos")]
        crate::app_setup::apply_dock_visibility(&app, v);
    }

    let config = get_storage_config()?;
    config.ensure_dirs()?;

    let content = serde_json::to_string(&settings)
        .map_err(|e| crate::error::AppError::from(format!("序列化应用设置失败: {}", e)))?;

    crate::storage::write_atomic(config.app_settings_file(), content)
        .map_err(|e| crate::error::AppError::from(format!("保存应用设置失败: {}", e)))?;

    // 锁只保护「读-改-写」这一段。必须在 apply_settings 之前放开：
    // 网关启动会走 ensure_gateway_key → set_mcp_gateway_keys，那里要再拿同一把锁。
    drop(guard);

    // 通知聊天桥接 poller 重新加载配置
    super::chat_bridge::notify_reload(&app).await;
    crate::mcp_gateway::apply_settings(&settings).await?;

    // 网关可能刚补写了自动生成的密钥，回读一次让前端拿到最新的
    get_app_settings().await
}

/// 只更新 `mcp_gateway_keys` 的窄写入口，供网关自动补密钥使用。
///
/// 不走 `save_app_settings`：那个函数结尾会调 `apply_settings`，
/// 而调用方本身就在 `apply_settings` 里面 —— 会无限递归。
pub async fn set_mcp_gateway_keys(keys: Vec<McpGatewayKey>) -> AppResult<()> {
    let _guard = SETTINGS_SAVE_LOCK.lock().await;
    let mut settings = get_app_settings().await?;
    settings.mcp_gateway_keys = keys;

    let config = get_storage_config()?;
    config.ensure_dirs()?;
    let content = serde_json::to_string(&settings)
        .map_err(|e| crate::error::AppError::from(format!("序列化应用设置失败: {}", e)))?;
    crate::storage::write_atomic(config.app_settings_file(), content)
        .map_err(|e| crate::error::AppError::from(format!("保存 MCP 网关密钥失败: {}", e)))?;
    Ok(())
}

// ============== UI 状态管理 ==============

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct UiStateInput {
    pub recent_detail_project_ids: Option<Vec<String>>,
}

#[tauri::command]
#[specta::specta]
pub async fn get_ui_state() -> AppResult<UiState> {
    let config = get_storage_config()?;
    let path = config.ui_state_file();

    if !path.exists() {
        return Ok(UiState::default());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取UI状态失败: {}", e)))?;

    let ui_state: UiState = crate::storage::parse_json_or_backup(&path, &content);
    Ok(ui_state)
}

#[tauri::command]
#[specta::specta]
pub async fn save_ui_state(input: UiStateInput) -> AppResult<UiState> {
    let mut ui_state = get_ui_state().await?;

    if let Some(ids) = input.recent_detail_project_ids {
        ui_state.recent_detail_project_ids = ids;
    }

    let config = get_storage_config()?;
    config.ensure_dirs()?;

    let content = serde_json::to_string(&ui_state)
        .map_err(|e| crate::error::AppError::from(format!("序列化UI状态失败: {}", e)))?;

    crate::storage::write_atomic(config.ui_state_file(), content)
        .map_err(|e| crate::error::AppError::from(format!("保存UI状态失败: {}", e)))?;

    Ok(ui_state)
}

// ============== 通知管理 ==============

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct NotificationInput {
    pub notification_type: String,
    pub title: String,
    #[serde(default)]
    pub message: String,
}

#[tauri::command]
#[specta::specta]
pub async fn get_notifications() -> AppResult<Vec<Notification>> {
    let config = get_storage_config()?;
    let path = config.notifications_file();

    if !path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取通知失败: {}", e)))?;

    let notifications: Vec<Notification> = crate::storage::parse_json_or_backup(&path, &content);
    Ok(notifications)
}

async fn save_notifications_internal(notifications: &[Notification]) -> AppResult<()> {
    let config = get_storage_config()?;
    config.ensure_dirs()?;

    let content = serde_json::to_string(notifications)
        .map_err(|e| crate::error::AppError::from(format!("序列化通知失败: {}", e)))?;

    crate::storage::write_atomic(config.notifications_file(), content)
        .map_err(|e| crate::error::AppError::from(format!("保存通知失败: {}", e)))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn add_notification(input: NotificationInput) -> AppResult<Vec<Notification>> {
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
#[specta::specta]
pub async fn remove_notification(id: String) -> AppResult<Vec<Notification>> {
    let mut notifications = get_notifications().await?;
    notifications.retain(|n| n.id != id);
    save_notifications_internal(&notifications).await?;
    Ok(notifications)
}

#[tauri::command]
#[specta::specta]
pub async fn clear_notifications() -> AppResult<()> {
    save_notifications_internal(&[]).await
}

#[tauri::command]
#[specta::specta]
pub async fn save_notifications(notifications: Vec<Notification>) -> AppResult<()> {
    save_notifications_internal(&notifications).await
}

// ============== 应用快捷键管理 ==============

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppShortcutBinding {
    pub id: String,
    pub label: String,
    pub description: String,
    pub keys: String,
    pub default_keys: String,
    pub enabled: bool,
    #[serde(default)]
    pub global: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn get_app_shortcuts() -> AppResult<Vec<AppShortcutBinding>> {
    let config = get_storage_config()?;
    let path = config.app_shortcuts_file();

    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取应用快捷键配置失败: {}", e)))?;

    if content.trim().is_empty() {
        return Ok(Vec::new());
    }

    serde_json::from_str(&content).map_err(|e| format!("解析应用快捷键配置失败: {}", e).into())
}

#[tauri::command]
#[specta::specta]
pub async fn save_app_shortcuts(shortcuts: Vec<AppShortcutBinding>) -> AppResult<()> {
    let config = get_storage_config()?;
    config.ensure_dirs()?;

    let content = serde_json::to_string_pretty(&shortcuts)
        .map_err(|e| crate::error::AppError::from(format!("序列化应用快捷键配置失败: {}", e)))?;

    crate::storage::write_atomic(config.app_shortcuts_file(), content)
        .map_err(|e| crate::error::AppError::from(format!("保存应用快捷键配置失败: {}", e)))?;
    Ok(())
}

// ============== AI 供应商配置管理 ==============

fn default_ai_providers() -> Vec<AiProviderConfig> {
    vec![]
}

#[tauri::command]
#[specta::specta]
pub async fn get_ai_providers() -> AppResult<Vec<AiProviderConfig>> {
    let config = get_storage_config()?;
    let path = config.ai_providers_file();

    if !path.exists() {
        return Ok(default_ai_providers());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取 AI 供应商配置失败: {}", e)))?;

    if content.trim().is_empty() {
        return Ok(default_ai_providers());
    }

    let providers: Vec<AiProviderConfig> = crate::storage::parse_json_or_backup(&path, &content);
    Ok(providers)
}

#[tauri::command]
#[specta::specta]
pub async fn save_ai_providers(
    providers: Vec<AiProviderConfig>,
) -> AppResult<Vec<AiProviderConfig>> {
    let config = get_storage_config()?;
    config.ensure_dirs()?;

    let content = serde_json::to_string_pretty(&providers)
        .map_err(|e| crate::error::AppError::from(format!("序列化 AI 供应商配置失败: {}", e)))?;

    crate::storage::write_atomic(config.ai_providers_file(), content)
        .map_err(|e| crate::error::AppError::from(format!("保存 AI 供应商配置失败: {}", e)))?;

    Ok(providers)
}

#[tauri::command]
#[specta::specta]
pub async fn get_recommended_template() -> AppResult<Option<String>> {
    let config = get_storage_config()?;
    let path = config.recommended_template_file();

    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取推荐模板失败: {}", e)))?;

    Ok(Some(content))
}

#[tauri::command]
#[specta::specta]
pub async fn save_recommended_template(content: String) -> AppResult<()> {
    let config = get_storage_config()?;
    config.ensure_dirs()?;

    crate::storage::write_atomic(config.recommended_template_file(), content)
        .map_err(|e| crate::error::AppError::from(format!("保存推荐模板失败: {}", e)))?;
    Ok(())
}

// ============== 敏感文件规则管理 ==============

pub fn default_sensitive_file_patterns() -> Vec<String> {
    DEFAULT_SENSITIVE_FILE_PATTERNS.clone()
}

pub fn load_sensitive_file_patterns() -> AppResult<Vec<String>> {
    let config = get_storage_config()?;
    let path = config.sensitive_file_patterns_file();

    if !path.exists() {
        return Ok(default_sensitive_file_patterns());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取敏感文件规则失败: {}", e)))?;

    let patterns: Vec<String> = crate::storage::parse_json_or_backup(&path, &content);
    Ok(patterns)
}

#[tauri::command]
#[specta::specta]
pub async fn get_sensitive_file_patterns() -> AppResult<Vec<String>> {
    load_sensitive_file_patterns()
}

#[tauri::command]
#[specta::specta]
pub async fn save_sensitive_file_patterns(patterns: Vec<String>) -> AppResult<()> {
    let config = get_storage_config()?;
    config.ensure_dirs()?;

    let patterns: Vec<String> = patterns
        .into_iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();

    let content = serde_json::to_string(&patterns)
        .map_err(|e| crate::error::AppError::from(format!("序列化敏感文件规则失败: {}", e)))?;

    crate::storage::write_atomic(config.sensitive_file_patterns_file(), content)
        .map_err(|e| crate::error::AppError::from(format!("保存敏感文件规则失败: {}", e)))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn reset_recommended_template() -> AppResult<()> {
    let config = get_storage_config()?;
    let path = config.recommended_template_file();

    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| crate::error::AppError::from(format!("删除推荐模板失败: {}", e)))?;
    }
    Ok(())
}

// ============== Claude 配置模板目录（远程拉取 + 本地缓存回退） ==============

/// 远程模板目录文件（GitHub raw，main 分支）
const CLAUDE_CONFIG_TEMPLATES_URL: &str =
    "https://raw.githubusercontent.com/en-o/codeshelf/main/public/claude-config-templates.json";

/// 内置兜底目录：与 public/claude-config-templates.json 保持一致，离线首启时使用
const BUILTIN_CLAUDE_CONFIG_TEMPLATES: &str = r#"{
  "codex": {
    "alwaysThinkingEnabled": true,
    "enabledPlugins": {
      "claude-mem@thedotmack": true,
      "planning-with-files@planning-with-files": true
    },
    "env": {
      "ANTHROPIC_AUTH_TOKEN": "sk-",
      "ANTHROPIC_BASE_URL": "https://a-ocnfniawgw.cn-shanghai.fcapp.run/v1",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL": "gpt-5.5",
      "ANTHROPIC_DEFAULT_OPUS_MODEL": "gpt-5.5",
      "ANTHROPIC_DEFAULT_SONNET_MODEL": "gpt-5.5",
      "ANTHROPIC_MODEL": "gpt-5.5",
      "ANTHROPIC_REASONING_MODEL": "gpt-5.5",
      "CLAUDE_CODE_ATTRIBUTION_HEADER": "0",
      "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1",
      "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
    },
    "model": "opus[1m]"
  },
  "claude": {
    "effortLevel": "medium",
    "env": {
      "ANTHROPIC_AUTH_TOKEN": "sk-",
      "ANTHROPIC_BASE_URL": "https://a-ocnfniawgw.cn-shanghai.fcapp.run",
      "CLAUDE_CODE_ATTRIBUTION_HEADER": "0",
      "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1",
      "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
      "DISABLE_AUTOUPDATER": "1",
      "DISABLE_ERROR_REPORTING": "1",
      "DISABLE_TELEMETRY": "1"
    },
    "model": "opus[1m]",
    "permissions": {
      "defaultMode": "bypassPermissions"
    }
  }
}"#;

/// 拉取远程模板目录。任何网络/HTTP 错误都返回 Err，由调用方静默回退。
async fn fetch_remote_claude_config_templates() -> Result<String, reqwest::Error> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("codeshelf")
        .build()?;
    client
        .get(CLAUDE_CONFIG_TEMPLATES_URL)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await
}

/// 获取 Claude 配置模板目录。
///
/// 顺序：远程 GitHub → 本地缓存（上次成功拉取的"本地历史"）→ 内置默认。
/// 任何错误（网络异常、文件不存在、解析失败）都静默回退，**永远返回 Ok**，保证调用方每次都能拿到内容。
/// 远程拉取成功时会同步刷新本地缓存。
#[tauri::command]
#[specta::specta]
pub async fn get_claude_config_templates() -> AppResult<String> {
    // 1) 远程：拉到且能解析成 JSON 对象 → 更新本地缓存并返回
    if let Ok(body) = fetch_remote_claude_config_templates().await {
        if serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&body).is_ok() {
            if let Ok(config) = get_storage_config() {
                let _ = config.ensure_dirs();
                // 写缓存失败不影响返回
                let _ = crate::storage::write_atomic(config.claude_config_templates_file(), &body);
            }
            return Ok(body);
        }
    }

    // 2) 本地缓存
    if let Ok(config) = get_storage_config() {
        let path = config.claude_config_templates_file();
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                if serde_json::from_str::<serde_json::Value>(&content).is_ok() {
                    return Ok(content);
                }
            }
        }
    }

    // 3) 内置默认
    Ok(BUILTIN_CLAUDE_CONFIG_TEMPLATES.to_string())
}

// ============== 简历数据持久化已迁移到 commands::resume 模块 ==============
static DEFAULT_SENSITIVE_FILE_PATTERNS: Lazy<Vec<String>> = Lazy::new(|| {
    serde_json::from_str(include_str!("../../../src/config/defaultSensitiveFilePatterns.json"))
        .expect("defaultSensitiveFilePatterns.json must be valid JSON")
});
