// 剪贴板历史管理（SQLite 后端版）
//
// 持久化：
//   - 历史 -> clipboard_entries 表
//   - 设置 -> 仍然 clipboard_settings.json（低频读写，不迁库）
//
// 队列规则：
//   - 置顶不计入 max_items，只能手动删除
//   - 普通按 max_items 滚动淘汰最旧
//   - 去重：相同 content 已存在时，更新 timestamp，保留 pinned/note
//
// 并发：sqlite 自己处理 (WAL + busy_timeout)，不再需要 FILE_LOCK

use crate::error::AppResult;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use tauri::{AppHandle, Emitter};

use crate::storage::config::get_storage_config;
use crate::storage::db::pool;
use crate::storage::schema::{ClipboardEntry, ClipboardSettings};

// 上次剪贴板内容哈希，用于检测变化（监控线程跨循环复用）
static LAST_CLIP_HASH: Lazy<Mutex<u64>> = Lazy::new(|| Mutex::new(0));

// ============== 工具函数 ==============

fn generate_preview(content: &str) -> String {
    let preview: String = content.chars().take(200).collect();
    preview.replace('\n', " ").replace('\r', "")
}

fn compute_hash(content: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    hasher.finish()
}

fn generate_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", timestamp)
}

// ============== Settings（仍走 JSON 文件） ==============

fn read_settings_file() -> AppResult<ClipboardSettings> {
    let config = get_storage_config()?;
    let path = config.clipboard_settings_file();

    if !path.exists() {
        return Ok(ClipboardSettings::default());
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取剪贴板设置文件失败: {}", e)))?;

    if content.trim().is_empty() {
        return Ok(ClipboardSettings::default());
    }

    serde_json::from_str(&content)
        .map_err(|e| crate::error::AppError::from(format!("解析剪贴板设置文件失败: {}", e)))
}

fn write_settings_file(settings: &ClipboardSettings) -> AppResult<()> {
    let config = get_storage_config()?;
    let path = config.clipboard_settings_file();

    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| crate::error::AppError::from(format!("序列化剪贴板设置失败: {}", e)))?;

    crate::storage::write_atomic(&path, content)
        .map_err(|e| crate::error::AppError::from(format!("写入剪贴板设置文件失败: {}", e)))
}

// ============== sqlite 操作 ==============

type EntryRow = (String, String, String, i64, i64, i64, Option<String>);

const ENTRY_SELECT: &str =
    "SELECT id, content, content_preview, timestamp, pinned, char_count, note FROM clipboard_entries";

fn entry_from_row(row: EntryRow) -> ClipboardEntry {
    let (id, content, content_preview, timestamp, pinned, char_count, note) = row;
    ClipboardEntry {
        id,
        content,
        content_preview,
        timestamp,
        pinned: pinned != 0,
        char_count: char_count as usize,
        note,
    }
}

async fn fetch_all_sorted() -> AppResult<Vec<ClipboardEntry>> {
    let rows: Vec<EntryRow> = sqlx::query_as(&format!(
        "{} ORDER BY pinned DESC, timestamp DESC",
        ENTRY_SELECT
    ))
    .fetch_all(pool())
    .await
    .map_err(|e| crate::error::AppError::from(format!("查询剪贴板历史失败: {}", e)))?;
    Ok(rows.into_iter().map(entry_from_row).collect())
}

async fn fetch_by_id(id: &str) -> AppResult<Option<ClipboardEntry>> {
    let row: Option<EntryRow> = sqlx::query_as(&format!("{} WHERE id = ?", ENTRY_SELECT))
        .bind(id)
        .fetch_optional(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("查询剪贴板条目失败: {}", e)))?;
    Ok(row.map(entry_from_row))
}

async fn fetch_by_content(content: &str) -> AppResult<Option<ClipboardEntry>> {
    let row: Option<EntryRow> =
        sqlx::query_as(&format!("{} WHERE content = ? LIMIT 1", ENTRY_SELECT))
            .bind(content)
            .fetch_optional(pool())
            .await
            .map_err(|e| crate::error::AppError::from(format!("按 content 查询失败: {}", e)))?;
    Ok(row.map(entry_from_row))
}

/// 淘汰非置顶条目，保留最近 max_items 条；置顶条目不受影响。
async fn trim_unpinned(max_items: i64) -> AppResult<()> {
    sqlx::query(
        "DELETE FROM clipboard_entries
         WHERE pinned = 0
           AND id NOT IN (
             SELECT id FROM clipboard_entries
             WHERE pinned = 0
             ORDER BY timestamp DESC
             LIMIT ?
           )",
    )
    .bind(max_items)
    .execute(pool())
    .await
    .map_err(|e| crate::error::AppError::from(format!("清理过量条目失败: {}", e)))?;
    Ok(())
}

/// 内部：上报一条新内容（去重 + 写库 + 裁剪）。返回最终生效的条目。
async fn upsert_entry(content: String) -> AppResult<ClipboardEntry> {
    let now = chrono::Utc::now().timestamp_millis();
    let preview = generate_preview(&content);

    if let Some(existing) = fetch_by_content(&content).await? {
        // 已存在：更新时间戳和预览，pinned/note 不变
        sqlx::query("UPDATE clipboard_entries SET timestamp = ?, content_preview = ? WHERE id = ?")
            .bind(now)
            .bind(&preview)
            .bind(&existing.id)
            .execute(pool())
            .await
            .map_err(|e| crate::error::AppError::from(format!("更新剪贴板条目失败: {}", e)))?;

        let max_items = read_settings_file()?.max_items as i64;
        trim_unpinned(max_items).await?;

        return fetch_by_id(&existing.id)
            .await?
            .ok_or_else(|| crate::error::AppError::from("更新后条目消失".to_string()));
    }

    let entry = ClipboardEntry {
        id: generate_id(),
        content_preview: preview,
        char_count: content.chars().count(),
        content,
        timestamp: now,
        pinned: false,
        note: None,
    };

    sqlx::query(
        "INSERT INTO clipboard_entries (id, content, content_preview, timestamp, pinned, char_count, note)
         VALUES (?, ?, ?, ?, 0, ?, NULL)",
    )
    .bind(&entry.id)
    .bind(&entry.content)
    .bind(&entry.content_preview)
    .bind(entry.timestamp)
    .bind(entry.char_count as i64)
    .execute(pool())
    .await
    .map_err(|e| crate::error::AppError::from(format!("插入剪贴板条目失败: {}", e)))?;

    let max_items = read_settings_file()?.max_items as i64;
    trim_unpinned(max_items).await?;

    Ok(entry)
}

// ============== Tauri 命令 ==============

#[tauri::command]
#[specta::specta]
pub async fn get_clipboard_history() -> AppResult<Vec<ClipboardEntry>> {
    fetch_all_sorted().await
}

#[tauri::command]
#[specta::specta]
pub async fn add_clipboard_entry(content: String) -> AppResult<ClipboardEntry> {
    upsert_entry(content).await
}

#[tauri::command]
#[specta::specta]
pub async fn update_clipboard_note(id: String, note: String) -> AppResult<ClipboardEntry> {
    let final_note: Option<String> = if note.trim().is_empty() {
        None
    } else {
        Some(note)
    };
    let result = sqlx::query("UPDATE clipboard_entries SET note = ? WHERE id = ?")
        .bind(&final_note)
        .bind(&id)
        .execute(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("更新备注失败: {}", e)))?;
    if result.rows_affected() == 0 {
        return Err(crate::error::AppError::from(format!(
            "剪贴板条目 {} 不存在",
            id
        )));
    }
    fetch_by_id(&id)
        .await?
        .ok_or_else(|| crate::error::AppError::from(format!("剪贴板条目 {} 不存在", id)))
}

#[tauri::command]
#[specta::specta]
pub async fn delete_clipboard_entry(id: String) -> AppResult<()> {
    sqlx::query("DELETE FROM clipboard_entries WHERE id = ?")
        .bind(&id)
        .execute(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("删除剪贴板条目失败: {}", e)))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn toggle_pin_clipboard_entry(id: String) -> AppResult<ClipboardEntry> {
    let result = sqlx::query(
        "UPDATE clipboard_entries
         SET pinned = CASE pinned WHEN 0 THEN 1 ELSE 0 END
         WHERE id = ?",
    )
    .bind(&id)
    .execute(pool())
    .await
    .map_err(|e| crate::error::AppError::from(format!("切换置顶失败: {}", e)))?;
    if result.rows_affected() == 0 {
        return Err(crate::error::AppError::from(format!(
            "剪贴板条目 {} 不存在",
            id
        )));
    }

    let updated = fetch_by_id(&id)
        .await?
        .ok_or_else(|| crate::error::AppError::from(format!("剪贴板条目 {} 不存在", id)))?;

    // 取消置顶后可能需要裁剪
    if !updated.pinned {
        let max_items = read_settings_file()?.max_items as i64;
        trim_unpinned(max_items).await?;
    }

    Ok(updated)
}

/// 清空非置顶条目；置顶永远保留
#[tauri::command]
#[specta::specta]
pub async fn clear_clipboard_history() -> AppResult<()> {
    sqlx::query("DELETE FROM clipboard_entries WHERE pinned = 0")
        .execute(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("清空剪贴板历史失败: {}", e)))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_clipboard_settings() -> AppResult<ClipboardSettings> {
    read_settings_file()
}

#[tauri::command]
#[specta::specta]
pub async fn save_clipboard_settings(settings: ClipboardSettings) -> AppResult<()> {
    write_settings_file(&settings)?;
    let max_items = settings.max_items as i64;
    trim_unpinned(max_items).await?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn write_to_clipboard(content: String) -> AppResult<()> {
    // 更新哈希以阻止监控线程把这次设置作为新条目记录
    let hash = compute_hash(&content);
    if let Ok(mut last_hash) = LAST_CLIP_HASH.lock() {
        *last_hash = hash;
    }

    let mut clipboard = arboard::Clipboard::new()
        .map_err(|e| crate::error::AppError::from(format!("无法访问系统剪贴板: {}", e)))?;
    clipboard
        .set_text(&content)
        .map_err(|e| crate::error::AppError::from(format!("写入系统剪贴板失败: {}", e)))
}

// ============== 后台监控 ==============

/// 在 tokio runtime 上启动剪贴板轮询。
pub fn start_clipboard_monitor(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // 启动时初始化 hash：取最新历史 + 当前系统剪贴板
        if let Ok(entries) = fetch_all_sorted().await {
            if let Some(latest) = entries.iter().max_by_key(|e| e.timestamp) {
                let hash = compute_hash(&latest.content);
                if let Ok(mut last_hash) = LAST_CLIP_HASH.lock() {
                    *last_hash = hash;
                }
            }
        }
        if let Ok(mut cb) = arboard::Clipboard::new() {
            if let Ok(text) = cb.get_text() {
                let hash = compute_hash(&text);
                if let Ok(mut last_hash) = LAST_CLIP_HASH.lock() {
                    *last_hash = hash;
                }
            }
        }

        // 设置文件极少变动，缓存起来最多每 2s 从磁盘刷新一次，
        // 避免每轮（默认 800ms）都做一次 stat + 读文件 + JSON 解析的无谓磁盘 I/O。
        // 切换开关 / 调整间隔最迟 2s 生效，可接受。
        let mut settings = read_settings_file().unwrap_or_default();
        let mut last_settings_read = std::time::Instant::now();

        loop {
            if last_settings_read.elapsed() >= std::time::Duration::from_secs(2) {
                // 读失败时保留上次的有效设置，不回退到默认
                if let Ok(s) = read_settings_file() {
                    settings = s;
                }
                last_settings_read = std::time::Instant::now();
            }

            if !settings.enabled {
                tokio::time::sleep(std::time::Duration::from_millis(
                    settings.monitor_interval_ms.max(500),
                ))
                .await;
                continue;
            }

            // 读取系统剪贴板（同步 API，调用很快）
            let clip_text = match arboard::Clipboard::new() {
                Ok(mut cb) => cb.get_text().ok(),
                Err(_) => None,
            };

            if let Some(text) = clip_text {
                if !text.trim().is_empty() {
                    let hash = compute_hash(&text);
                    let is_new = {
                        match LAST_CLIP_HASH.lock() {
                            Ok(mut last) => {
                                if *last == hash {
                                    false
                                } else {
                                    *last = hash;
                                    true
                                }
                            }
                            // 锁中毒不要让监控崩溃 —— 跳过这一轮
                            Err(_) => false,
                        }
                    };

                    if is_new {
                        if upsert_entry(text).await.is_ok() {
                            let _ = app_handle.emit("clipboard-changed", ());
                        }
                    }
                }
            }

            tokio::time::sleep(std::time::Duration::from_millis(
                settings.monitor_interval_ms,
            ))
            .await;
        }
    });
}
