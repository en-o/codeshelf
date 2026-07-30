// Claude Code 快捷配置：选项列表、应用、持久化

use crate::error::AppResult;
use std::fs;

use crate::storage;
use crate::storage::schema::ClaudeQuickConfig;

use super::{EnvType, QuickConfigOption};

/// 获取快捷配置选项列表
#[tauri::command]
#[specta::specta]
pub async fn get_quick_config_options() -> AppResult<Vec<QuickConfigOption>> {
    Ok(vec![
        // 模型设置
        QuickConfigOption {
            id: "model_sonnet".to_string(),
            name: "使用 Claude Sonnet".to_string(),
            description: "使用 Claude Sonnet 4 模型（推荐，平衡性能和成本）".to_string(),
            category: "模型".to_string(),
            config_key: "model".to_string(),
            config_value: serde_json::json!("claude-sonnet-4-20250514"),
        },
        QuickConfigOption {
            id: "model_opus".to_string(),
            name: "使用 Claude Opus".to_string(),
            description: "使用 Claude Opus 4 模型（最强大，成本较高）".to_string(),
            category: "模型".to_string(),
            config_key: "model".to_string(),
            config_value: serde_json::json!("claude-opus-4-20250514"),
        },
        QuickConfigOption {
            id: "model_haiku".to_string(),
            name: "使用 Claude Haiku".to_string(),
            description: "使用 Claude Haiku 模型（快速，成本低）".to_string(),
            category: "模型".to_string(),
            config_key: "model".to_string(),
            config_value: serde_json::json!("claude-haiku-3-5-20241022"),
        },
        // 主题设置
        QuickConfigOption {
            id: "theme_auto".to_string(),
            name: "自动主题".to_string(),
            description: "跟随系统主题自动切换".to_string(),
            category: "外观".to_string(),
            config_key: "theme".to_string(),
            config_value: serde_json::json!("auto"),
        },
        QuickConfigOption {
            id: "theme_dark".to_string(),
            name: "深色主题".to_string(),
            description: "始终使用深色主题".to_string(),
            category: "外观".to_string(),
            config_key: "theme".to_string(),
            config_value: serde_json::json!("dark"),
        },
        QuickConfigOption {
            id: "theme_light".to_string(),
            name: "浅色主题".to_string(),
            description: "始终使用浅色主题".to_string(),
            category: "外观".to_string(),
            config_key: "theme".to_string(),
            config_value: serde_json::json!("light"),
        },
        // 权限设置
        QuickConfigOption {
            id: "perm_safe".to_string(),
            name: "安全模式".to_string(),
            description: "只允许读取文件，禁止写入和执行".to_string(),
            category: "权限".to_string(),
            config_key: "permissions".to_string(),
            config_value: serde_json::json!({
                "allow_read": true,
                "allow_write": false,
                "allow_execute": false
            }),
        },
        QuickConfigOption {
            id: "perm_normal".to_string(),
            name: "正常模式".to_string(),
            description: "允许读取和写入，禁止执行命令".to_string(),
            category: "权限".to_string(),
            config_key: "permissions".to_string(),
            config_value: serde_json::json!({
                "allow_read": true,
                "allow_write": true,
                "allow_execute": false
            }),
        },
        QuickConfigOption {
            id: "perm_full".to_string(),
            name: "完全权限".to_string(),
            description: "允许所有操作（需谨慎使用）".to_string(),
            category: "权限".to_string(),
            config_key: "permissions".to_string(),
            config_value: serde_json::json!({
                "allow_read": true,
                "allow_write": true,
                "allow_execute": true
            }),
        },
        // 行为设置
        QuickConfigOption {
            id: "auto_approve".to_string(),
            name: "自动批准安全操作".to_string(),
            description: "自动批准低风险操作，减少确认提示".to_string(),
            category: "行为".to_string(),
            config_key: "auto_approve_safe_operations".to_string(),
            config_value: serde_json::json!(true),
        },
        QuickConfigOption {
            id: "verbose_output".to_string(),
            name: "详细输出".to_string(),
            description: "显示更多调试信息和详细日志".to_string(),
            category: "行为".to_string(),
            config_key: "verbose".to_string(),
            config_value: serde_json::json!(true),
        },
        QuickConfigOption {
            id: "no_telemetry".to_string(),
            name: "禁用遥测".to_string(),
            description: "禁止发送使用数据和错误报告".to_string(),
            category: "隐私".to_string(),
            config_key: "telemetry".to_string(),
            config_value: serde_json::json!(false),
        },
    ])
}

/// 应用快捷配置
#[tauri::command]
#[specta::specta]
pub async fn apply_quick_config(
    env_type: EnvType,
    env_name: String,
    config_path: String,
    options: Vec<String>,
) -> AppResult<()> {
    // 读取现有配置
    let existing_content = super::config_io::read_claude_config_file(
        env_type.clone(),
        env_name.clone(),
        config_path.clone(),
    )
    .await
    .ok();

    // 这是**用户自己的** Claude 配置文件（settings.json），里面有 API key、MCP server、
    // 权限规则等。解析失败时绝不能 `unwrap_or(json!({}))` —— 那会用一个只含本次勾选项的
    // 空对象覆盖回去，用户的全部配置当场消失。
    //
    // 也不走 parse_json_or_backup：那会在用户目录里改名留下 `.corrupt-*` 文件，
    // 对别人的目录太越界。这里直接拒绝并说明原因，让用户自己去修那几行 JSON。
    let mut config: serde_json::Value = match existing_content {
        Some(content) if !content.trim().is_empty() => {
            serde_json::from_str(&content).map_err(|e| {
                crate::error::AppError::from(format!(
                    "现有 Claude 配置不是合法 JSON（{}），已中止写入以免覆盖你的配置。\n\
                     请先修正 {} 后重试。",
                    e, config_path
                ))
            })?
        }
        _ => serde_json::json!({}),
    };
    // 解析出来是合法 JSON 但不是对象（比如整个文件是个数组）时同样不能往里塞键
    if !config.is_object() {
        return Err(crate::error::AppError::from(format!(
            "现有 Claude 配置的顶层不是 JSON 对象，已中止写入以免破坏它。请检查 {}",
            config_path
        )));
    }

    // 获取所有快捷配置选项
    let all_options = get_quick_config_options().await?;

    // 应用选中的配置
    for option_id in options {
        if let Some(opt) = all_options.iter().find(|o| o.id == option_id) {
            if let Some(obj) = config.as_object_mut() {
                obj.insert(opt.config_key.clone(), opt.config_value.clone());
            }
        }
    }

    // 写入配置
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| crate::error::AppError::from(format!("序列化配置失败: {}", e)))?;

    super::config_io::write_claude_config_file(env_type, env_name, config_path, content).await
}

// ============== Claude 快捷配置持久化 ==============

/// 获取保存的 Claude 快捷配置
#[tauri::command]
#[specta::specta]
pub async fn get_saved_quick_configs() -> AppResult<Vec<ClaudeQuickConfig>> {
    if let Ok(config) = storage::get_storage_config() {
        let path = config.claude_quick_configs_file();
        if path.exists() {
            let content = fs::read_to_string(&path)
                .map_err(|e| crate::error::AppError::from(format!("读取快捷配置失败: {}", e)))?;

            // 直接解析为配置数组
            let configs: Vec<ClaudeQuickConfig> =
                crate::storage::parse_json_or_backup(&path, &content);
            return Ok(configs);
        }
    }
    Ok(vec![])
}

/// 保存 Claude 快捷配置
#[tauri::command]
#[specta::specta]
pub async fn save_quick_configs(configs: Vec<ClaudeQuickConfig>) -> AppResult<()> {
    let config = storage::get_storage_config()?;
    config.ensure_dirs()?;

    // 直接保存为配置数组
    let content = serde_json::to_string(&configs)
        .map_err(|e| crate::error::AppError::from(format!("序列化快捷配置失败: {}", e)))?;
    crate::storage::write_atomic(config.claude_quick_configs_file(), content)
        .map_err(|e| crate::error::AppError::from(format!("保存快捷配置失败: {}", e)))?;
    Ok(())
}
