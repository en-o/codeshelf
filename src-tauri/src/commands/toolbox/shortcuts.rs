// 快捷键备忘工具 - 预置 Mac/Windows 常用快捷键，支持自定义编辑、搜索、导入导出

use super::{generate_id, ShortcutEntry, ShortcutInput};
use crate::error::AppResult;
use crate::storage::config::get_storage_config;

// ============== 文件读写 ==============

fn read_shortcuts_file() -> AppResult<Vec<ShortcutEntry>> {
    let config = get_storage_config()?;
    let path = config.shortcuts_file();

    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取快捷键文件失败: {}", e)))?;

    if content.trim().is_empty() {
        return Ok(Vec::new());
    }

    serde_json::from_str(&content)
        .map_err(|e| crate::error::AppError::from(format!("解析快捷键文件失败: {}", e)))
}

fn write_shortcuts_file(shortcuts: &[ShortcutEntry]) -> AppResult<()> {
    let config = get_storage_config()?;
    let path = config.shortcuts_file();

    let content = serde_json::to_string_pretty(shortcuts)
        .map_err(|e| crate::error::AppError::from(format!("序列化快捷键数据失败: {}", e)))?;

    crate::storage::write_atomic(&path, content)
        .map_err(|e| crate::error::AppError::from(format!("写入快捷键文件失败: {}", e)))
}

// ============== 默认数据 ==============

fn default_shortcuts() -> Vec<ShortcutEntry> {
    let mut list = Vec::with_capacity(73);

    // ---- Mac 系统 (18个) ----
    let mac_system = vec![
        ("default_mac_system_001", "复制", "Command + C"),
        ("default_mac_system_002", "粘贴", "Command + V"),
        ("default_mac_system_003", "剪切", "Command + X"),
        ("default_mac_system_004", "全选", "Command + A"),
        ("default_mac_system_005", "撤销", "Command + Z"),
        ("default_mac_system_006", "重做", "Command + Shift + Z"),
        ("default_mac_system_007", "保存", "Command + S"),
        ("default_mac_system_008", "关闭窗口", "Command + W"),
        ("default_mac_system_009", "退出应用", "Command + Q"),
        ("default_mac_system_010", "切换应用", "Command + Tab"),
        ("default_mac_system_011", "截屏", "Command + Shift + 3"),
        ("default_mac_system_012", "截取区域", "Command + Shift + 4"),
        (
            "default_mac_system_013",
            "Spotlight 搜索",
            "Command + Space",
        ),
        (
            "default_mac_system_014",
            "前往文件夹",
            "Command + Shift + G",
        ),
        (
            "default_mac_system_015",
            "复制文件路径",
            "Command + Option + C",
        ),
        ("default_mac_system_016", "光标移到行首", "Command + Left"),
        ("default_mac_system_017", "光标移到行尾", "Command + Right"),
        (
            "default_mac_system_018",
            "强制退出",
            "Command + Option + Esc",
        ),
    ];

    for (id, desc, keys) in mac_system {
        list.push(ShortcutEntry {
            id: id.to_string(),
            category: "system".to_string(),
            description: desc.to_string(),
            keys: keys.to_string(),
            platform: "mac".to_string(),
            is_default: true,
            is_modified: false,
            original_keys: None,
        });
    }

    // ---- Mac VS Code (10个) ----
    let mac_vscode = vec![
        ("default_mac_vscode_001", "命令面板", "Command + Shift + P"),
        ("default_mac_vscode_002", "快速打开文件", "Command + P"),
        ("default_mac_vscode_003", "切换终端", "Control + `"),
        ("default_mac_vscode_004", "切换侧边栏", "Command + B"),
        ("default_mac_vscode_005", "查找", "Command + F"),
        ("default_mac_vscode_006", "全局替换", "Command + Shift + H"),
        ("default_mac_vscode_007", "格式化代码", "Option + Shift + F"),
        ("default_mac_vscode_008", "行注释", "Command + /"),
        ("default_mac_vscode_009", "跳转定义", "F12"),
        ("default_mac_vscode_010", "多光标选择", "Option + Click"),
    ];

    for (id, desc, keys) in mac_vscode {
        list.push(ShortcutEntry {
            id: id.to_string(),
            category: "vscode".to_string(),
            description: desc.to_string(),
            keys: keys.to_string(),
            platform: "mac".to_string(),
            is_default: true,
            is_modified: false,
            original_keys: None,
        });
    }

    // ---- Mac IDEA (10个) ----
    let mac_idea = vec![
        ("default_mac_idea_001", "搜索文件", "Command + Shift + O"),
        ("default_mac_idea_002", "查找操作", "Command + Shift + A"),
        ("default_mac_idea_003", "运行", "Control + R"),
        ("default_mac_idea_004", "调试", "Control + D"),
        ("default_mac_idea_005", "格式化代码", "Command + Option + L"),
        ("default_mac_idea_006", "行注释", "Command + /"),
        ("default_mac_idea_007", "跳转定义", "Command + B"),
        ("default_mac_idea_008", "重构重命名", "Shift + F6"),
        ("default_mac_idea_009", "自动补全", "Control + Space"),
        ("default_mac_idea_010", "生成代码", "Command + N"),
    ];

    for (id, desc, keys) in mac_idea {
        list.push(ShortcutEntry {
            id: id.to_string(),
            category: "idea".to_string(),
            description: desc.to_string(),
            keys: keys.to_string(),
            platform: "mac".to_string(),
            is_default: true,
            is_modified: false,
            original_keys: None,
        });
    }

    // ---- Windows 系统 (15个) ----
    let win_system = vec![
        ("default_win_system_001", "复制", "Ctrl + C"),
        ("default_win_system_002", "粘贴", "Ctrl + V"),
        ("default_win_system_003", "剪切", "Ctrl + X"),
        ("default_win_system_004", "全选", "Ctrl + A"),
        ("default_win_system_005", "撤销", "Ctrl + Z"),
        ("default_win_system_006", "重做", "Ctrl + Y"),
        ("default_win_system_007", "保存", "Ctrl + S"),
        ("default_win_system_008", "关闭窗口", "Alt + F4"),
        ("default_win_system_009", "切换应用", "Alt + Tab"),
        ("default_win_system_010", "截屏", "Print Screen"),
        ("default_win_system_011", "任务管理器", "Ctrl + Shift + Esc"),
        ("default_win_system_012", "文件管理器", "Win + E"),
        ("default_win_system_013", "锁屏", "Win + L"),
        ("default_win_system_014", "显示桌面", "Win + D"),
        ("default_win_system_015", "运行", "Win + R"),
    ];

    for (id, desc, keys) in win_system {
        list.push(ShortcutEntry {
            id: id.to_string(),
            category: "system".to_string(),
            description: desc.to_string(),
            keys: keys.to_string(),
            platform: "windows".to_string(),
            is_default: true,
            is_modified: false,
            original_keys: None,
        });
    }

    // ---- Windows VS Code (10个) ----
    let win_vscode = vec![
        ("default_win_vscode_001", "命令面板", "Ctrl + Shift + P"),
        ("default_win_vscode_002", "快速打开文件", "Ctrl + P"),
        ("default_win_vscode_003", "切换终端", "Ctrl + `"),
        ("default_win_vscode_004", "切换侧边栏", "Ctrl + B"),
        ("default_win_vscode_005", "查找", "Ctrl + F"),
        ("default_win_vscode_006", "全局替换", "Ctrl + Shift + H"),
        ("default_win_vscode_007", "格式化代码", "Shift + Alt + F"),
        ("default_win_vscode_008", "行注释", "Ctrl + /"),
        ("default_win_vscode_009", "跳转定义", "F12"),
        ("default_win_vscode_010", "多光标选择", "Alt + Click"),
    ];

    for (id, desc, keys) in win_vscode {
        list.push(ShortcutEntry {
            id: id.to_string(),
            category: "vscode".to_string(),
            description: desc.to_string(),
            keys: keys.to_string(),
            platform: "windows".to_string(),
            is_default: true,
            is_modified: false,
            original_keys: None,
        });
    }

    // ---- Windows IDEA (10个) ----
    let win_idea = vec![
        ("default_win_idea_001", "搜索文件", "Ctrl + Shift + N"),
        ("default_win_idea_002", "查找操作", "Ctrl + Shift + A"),
        ("default_win_idea_003", "运行", "Shift + F10"),
        ("default_win_idea_004", "调试", "Shift + F9"),
        ("default_win_idea_005", "格式化代码", "Ctrl + Alt + L"),
        ("default_win_idea_006", "行注释", "Ctrl + /"),
        ("default_win_idea_007", "跳转定义", "Ctrl + B"),
        ("default_win_idea_008", "重构重命名", "Shift + F6"),
        ("default_win_idea_009", "自动补全", "Ctrl + Space"),
        ("default_win_idea_010", "生成代码", "Alt + Insert"),
    ];

    for (id, desc, keys) in win_idea {
        list.push(ShortcutEntry {
            id: id.to_string(),
            category: "idea".to_string(),
            description: desc.to_string(),
            keys: keys.to_string(),
            platform: "windows".to_string(),
            is_default: true,
            is_modified: false,
            original_keys: None,
        });
    }

    list
}

// ============== Tauri 命令 ==============

/// 获取所有快捷键，首次自动写入默认数据
#[tauri::command]
#[specta::specta]
pub async fn get_shortcuts() -> AppResult<Vec<ShortcutEntry>> {
    let existing = read_shortcuts_file()?;

    if existing.is_empty() {
        let defaults = default_shortcuts();
        write_shortcuts_file(&defaults)?;
        Ok(defaults)
    } else {
        Ok(existing)
    }
}

/// 全量保存快捷键（导入用）
#[tauri::command]
#[specta::specta]
pub async fn save_shortcuts(shortcuts: Vec<ShortcutEntry>) -> AppResult<()> {
    write_shortcuts_file(&shortcuts)
}

/// 添加用户自定义快捷键
#[tauri::command]
#[specta::specta]
pub async fn add_shortcut(input: ShortcutInput) -> AppResult<ShortcutEntry> {
    let mut shortcuts = read_shortcuts_file()?;

    let entry = ShortcutEntry {
        id: generate_id(),
        category: input.category.unwrap_or_else(|| "custom".to_string()),
        description: input.description.unwrap_or_default(),
        keys: input.keys.unwrap_or_default(),
        platform: input.platform.unwrap_or_else(|| "windows".to_string()),
        is_default: false,
        is_modified: false,
        original_keys: None,
    };

    shortcuts.push(entry.clone());
    write_shortcuts_file(&shortcuts)?;

    Ok(entry)
}

/// 编辑快捷键（默认项首次编辑时保存 originalKeys）
#[tauri::command]
#[specta::specta]
pub async fn update_shortcut(id: String, input: ShortcutInput) -> AppResult<ShortcutEntry> {
    let mut shortcuts = read_shortcuts_file()?;

    let entry = shortcuts
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| crate::error::AppError::from(format!("快捷键 {} 不存在", id)))?;

    // 默认项首次编辑时保存原始按键
    if entry.is_default && !entry.is_modified {
        entry.original_keys = Some(entry.keys.clone());
        entry.is_modified = true;
    }

    if let Some(category) = input.category {
        entry.category = category;
    }
    if let Some(description) = input.description {
        entry.description = description;
    }
    if let Some(keys) = input.keys {
        entry.keys = keys;
    }
    if let Some(platform) = input.platform {
        entry.platform = platform;
    }

    let updated = entry.clone();
    write_shortcuts_file(&shortcuts)?;

    Ok(updated)
}

/// 删除快捷键（仅允许删除用户添加的）
#[tauri::command]
#[specta::specta]
pub async fn delete_shortcut(id: String) -> AppResult<()> {
    let mut shortcuts = read_shortcuts_file()?;

    let idx = shortcuts
        .iter()
        .position(|s| s.id == id)
        .ok_or_else(|| crate::error::AppError::from(format!("快捷键 {} 不存在", id)))?;

    if shortcuts[idx].is_default {
        return Err(crate::error::AppError::from(
            "不能删除默认快捷键".to_string(),
        ));
    }

    shortcuts.remove(idx);
    write_shortcuts_file(&shortcuts)
}

/// 恢复所有默认项 + 保留用户自定义项
#[tauri::command]
#[specta::specta]
pub async fn reset_shortcuts() -> AppResult<Vec<ShortcutEntry>> {
    let existing = read_shortcuts_file()?;

    // 保留用户自定义项
    let user_custom: Vec<ShortcutEntry> = existing.into_iter().filter(|s| !s.is_default).collect();

    // 生成完整默认列表
    let mut result = default_shortcuts();

    // 合并用户自定义项
    result.extend(user_custom);

    write_shortcuts_file(&result)?;
    Ok(result)
}

/// 返回当前平台
#[tauri::command]
#[specta::specta]
pub async fn get_current_platform() -> AppResult<String> {
    if cfg!(target_os = "macos") {
        Ok("mac".to_string())
    } else {
        Ok("windows".to_string())
    }
}
