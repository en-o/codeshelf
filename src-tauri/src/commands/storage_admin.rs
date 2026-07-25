// 数据备份管理 Tauri 命令。
//
// SQLite 迁移每次启动会自动备份 data_dir 到 ../backup_<ISO8601>/。
// 这里暴露两个命令让前端管理备份：
//   - list_data_backups: 列出所有可用备份的时间戳
//   - restore_from_backup: 标记下次启动时从指定备份恢复（写 flag 文件 + 提示重启）

use crate::error::AppResult;
use crate::storage::get_storage_config;
use crate::storage::migrations::{list_backup_timestamps, schedule_restore};

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
