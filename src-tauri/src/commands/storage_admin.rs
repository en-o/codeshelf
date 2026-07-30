// 数据备份 / 启动健康状态的 Tauri 命令。
//
// SQLite 迁移每次启动会自动备份 data_dir 到 ../backup_<ISO8601>/。
// 这里暴露给前端：
//   - get_startup_status:  启动是否失败、失败原因、数据目录位置（前端据此整屏阻断）
//   - list_data_backups:   列出所有可用备份的时间戳
//   - restore_from_backup: 标记下次启动时从指定备份恢复（写 flag 文件 + 提示重启）
//
// 恢复本身是"先 staging 校验、再原子切换"，实现见 storage::migrations。

use crate::error::AppResult;
use crate::storage::get_storage_config;
use crate::storage::migrations::{last_restore_failure, list_backup_timestamps, schedule_restore};

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StartupStatus {
    /// 非空表示启动阶段有致命错误，前端不应加载任何数据
    pub fatal_error: Option<String>,
    /// 上一次备份恢复的失败原因（如果有）
    pub restore_error: Option<String>,
    pub data_dir: String,
    pub logs_dir: String,
    /// 可用备份时间戳，新到旧
    pub backups: Vec<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn get_startup_status() -> AppResult<StartupStatus> {
    // 存储配置本身取不到时也要给出可诊断的结果，不能直接 `?` 掉
    let (data_dir, logs_dir, restore_error, backups) = match get_storage_config() {
        Ok(c) => (
            c.data_dir.display().to_string(),
            c.logs_dir.display().to_string(),
            last_restore_failure(&c.data_dir),
            list_backup_timestamps(&c.data_dir).unwrap_or_default(),
        ),
        Err(_) => (String::new(), String::new(), None, Vec::new()),
    };

    Ok(StartupStatus {
        fatal_error: crate::storage::startup_error().cloned(),
        restore_error,
        data_dir,
        logs_dir,
        backups,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn list_data_backups() -> AppResult<Vec<String>> {
    let config = get_storage_config()?;
    list_backup_timestamps(&config.data_dir)
}

#[tauri::command]
#[specta::specta]
pub async fn restore_from_backup(timestamp: String) -> AppResult<String> {
    let config = get_storage_config()?;
    schedule_restore(&config.data_dir, &timestamp)?;
    Ok(format!(
        "已标记从备份 {} 恢复。请关闭并重启应用以完成恢复。",
        timestamp
    ))
}
