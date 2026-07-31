//! 诊断历史（本地 SQLite）。
//!
//! spec：「保存『切换前 / 切换后』两次网络快照并突出变化项」「历史默认仅保存在本地，
//! 支持单条删除和全部清除」。
//!
//! 落盘前提是 AUD-023 已完成（Linux 用 XDG 用户目录、Windows 区分安装版与便携版），
//! 这条已经整改，所以历史可以直接用现有 SQLite，不需要另起 JSON 文件。
//!
//! 保留上限 20 条：足够覆盖「切网络前后各测一次」的实际用法，
//! 又不会让诊断结果无限堆积在用户库里。

use crate::error::AppResult;
use crate::storage::db::pool;
use serde::{Deserialize, Serialize};

/// 保留的最大快照数。超出时删除最旧的。
pub const MAX_SNAPSHOTS: usize = 20;

/// 一次完整诊断的快照。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NetDiagSnapshot {
    pub id: String,
    /// 用户可编辑的备注，例如「开 VPN 前」
    pub label: String,
    pub created_at: String,
    /// 完整结果的 JSON（LocalDiagnostics + Vec<ServiceCheck>）
    pub payload: String,
}

/// 列表项：不带 payload，避免列表页把所有快照全量读出来。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NetDiagSnapshotSummary {
    pub id: String,
    pub label: String,
    pub created_at: String,
}

pub async fn ensure_table() -> AppResult<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS netdiag_snapshots (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            created_at TEXT NOT NULL,
            payload TEXT NOT NULL
        )",
    )
    .execute(pool())
    .await
    .map_err(|e| crate::error::AppError::from(format!("创建 netdiag_snapshots 表失败: {}", e)))?;
    Ok(())
}

pub async fn save(label: String, payload: String) -> AppResult<NetDiagSnapshot> {
    ensure_table().await?;

    let snap = NetDiagSnapshot {
        id: format!(
            "nd-{}-{}",
            chrono::Utc::now().timestamp_millis(),
            std::process::id()
        ),
        label,
        created_at: chrono::Local::now().to_rfc3339(),
        payload,
    };

    sqlx::query("INSERT INTO netdiag_snapshots (id, label, created_at, payload) VALUES (?, ?, ?, ?)")
        .bind(&snap.id)
        .bind(&snap.label)
        .bind(&snap.created_at)
        .bind(&snap.payload)
        .execute(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("保存诊断快照失败: {}", e)))?;

    // 剪枝：按 created_at 倒序保留前 MAX_SNAPSHOTS 条。
    // 用子查询一次删完，避免"先查再删"之间又插进来新记录。
    sqlx::query(
        "DELETE FROM netdiag_snapshots WHERE id NOT IN (
            SELECT id FROM netdiag_snapshots ORDER BY created_at DESC, id DESC LIMIT ?
         )",
    )
    .bind(MAX_SNAPSHOTS as i64)
    .execute(pool())
    .await
    .map_err(|e| crate::error::AppError::from(format!("清理旧快照失败: {}", e)))?;

    Ok(snap)
}

pub async fn list() -> AppResult<Vec<NetDiagSnapshotSummary>> {
    ensure_table().await?;
    let rows: Vec<(String, String, String)> =
        sqlx::query_as("SELECT id, label, created_at FROM netdiag_snapshots ORDER BY created_at DESC, id DESC")
            .fetch_all(pool())
            .await
            .map_err(|e| crate::error::AppError::from(format!("读取诊断历史失败: {}", e)))?;

    Ok(rows
        .into_iter()
        .map(|(id, label, created_at)| NetDiagSnapshotSummary {
            id,
            label,
            created_at,
        })
        .collect())
}

pub async fn get(id: String) -> AppResult<NetDiagSnapshot> {
    ensure_table().await?;
    let row: Option<(String, String, String, String)> =
        sqlx::query_as("SELECT id, label, created_at, payload FROM netdiag_snapshots WHERE id = ?")
            .bind(&id)
            .fetch_optional(pool())
            .await
            .map_err(|e| crate::error::AppError::from(format!("读取诊断快照失败: {}", e)))?;

    row.map(|(id, label, created_at, payload)| NetDiagSnapshot {
        id,
        label,
        created_at,
        payload,
    })
    .ok_or_else(|| crate::error::AppError::from(format!("快照不存在: {}", id)))
}

pub async fn delete(id: String) -> AppResult<()> {
    ensure_table().await?;
    sqlx::query("DELETE FROM netdiag_snapshots WHERE id = ?")
        .bind(&id)
        .execute(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("删除诊断快照失败: {}", e)))?;
    Ok(())
}

pub async fn clear() -> AppResult<()> {
    ensure_table().await?;
    sqlx::query("DELETE FROM netdiag_snapshots")
        .execute(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("清空诊断历史失败: {}", e)))?;
    Ok(())
}
