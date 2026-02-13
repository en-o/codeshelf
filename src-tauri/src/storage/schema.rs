// 数据结构定义 - 简洁的数据格式，无版本包装

use serde::{Deserialize, Serialize};

// ============== 项目数据 ==============

/// 项目
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_favorite: bool,
    pub tags: Vec<String>,      // 分类（单选，但保留数组兼容）
    pub labels: Vec<String>,    // 标签（多选）
    pub created_at: String,
    pub updated_at: String,
    pub last_opened: Option<String>,
}

// ============== 编辑器配置数据 ==============

/// 编辑器配置
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EditorConfig {
    pub id: String,
    pub name: String,
    pub path: String,
    pub icon: Option<String>,
    pub is_default: bool,
}

// ============== 终端配置数据 ==============

/// 终端配置
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TerminalConfig {
    pub terminal_type: String,
    pub custom_path: Option<String>,
    pub terminal_path: Option<String>,
}

// ============== 应用设置数据 ==============

/// 应用设置
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub theme: String,
    pub view_mode: String,
    pub sidebar_collapsed: bool,
    pub scan_depth: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "light".to_string(),
            view_mode: "grid".to_string(),
            sidebar_collapsed: false,
            scan_depth: 3,
        }
    }
}

// ============== UI 状态数据 ==============

/// UI 状态
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct UiState {
    pub recent_detail_project_ids: Vec<String>,
}

// ============== 通知数据 ==============

/// 单条通知
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Notification {
    pub id: String,
    pub notification_type: String,
    pub title: String,
    pub message: String,
    pub created_at: String,
}

// ============== Claude 快捷配置数据 ==============

/// Claude 快捷配置选项
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeQuickConfig {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub config_key: String,
    pub value_type: String,
    pub default_value: serde_json::Value,
    pub options: Option<Vec<ClaudeConfigSelectOption>>,
    pub placeholder: Option<String>,
    pub allow_empty: Option<bool>,
}

/// 配置选项
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClaudeConfigSelectOption {
    pub label: String,
    pub value: serde_json::Value,
}

// ============== Claude 安装信息缓存数据 ==============

/// Claude Code 安装信息
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeInstallation {
    pub env_type: String,
    pub env_name: String,
    pub version: Option<String>,
    pub path: Option<String>,
    pub config_dir: String,
    pub config_files: Vec<ConfigFileInfo>,
}

/// 配置文件信息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigFileInfo {
    pub name: String,
    pub path: String,
    pub exists: bool,
}

// ============== 工具函数 ==============

/// 获取当前 ISO 时间字符串
pub fn current_iso_time() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// 生成唯一 ID
pub fn generate_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{:x}", timestamp)
}
