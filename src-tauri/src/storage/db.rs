// SQLite 数据库连接池 + schema_version 管理
//
// 设计要点：
// - 全局单例 SqlitePool（OnceCell），通过 storage::db::pool() 访问
// - WAL 模式（并发写性能 + 崩溃恢复）
// - 启用外键约束（ON DELETE CASCADE 才会生效）
// - schema_version 表记录迁移版本，迁移逻辑在 migrations/ 子模块

use crate::error::AppResult;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::Path;
use std::str::FromStr;
use tokio::sync::OnceCell;

static DB_POOL: OnceCell<SqlitePool> = OnceCell::const_new();

/// 初始化 SQLite 连接池。`db_path` 不存在会自动创建。
/// 仅允许调用一次；重复调用会返回错误。
pub async fn init_db(db_path: &Path) -> AppResult<()> {
    let url = format!("sqlite://{}", db_path.display());
    let options = SqliteConnectOptions::from_str(&url)
        .map_err(|e| crate::error::AppError::from(format!("解析 SQLite URL 失败: {}", e)))?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(std::time::Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(options)
        .await
        .map_err(|e| crate::error::AppError::from(format!("打开 SQLite 失败: {}", e)))?;

    // 确保 schema_version 表存在（最先要做的事，迁移逻辑依赖它）
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        )",
    )
    .execute(&pool)
    .await
    .map_err(|e| crate::error::AppError::from(format!("创建 schema_version 表失败: {}", e)))?;

    DB_POOL
        .set(pool)
        .map_err(|_| "DB pool 已经初始化".to_string())?;

    log::info!("SQLite 已就绪: {:?}", db_path);
    Ok(())
}

/// 启动失败时的兜底：装一个空的内存库。
///
/// 前端会被启动错误界面挡住、不发数据命令（见 `get_startup_status`），
/// 这里只保证万一有命令漏过去时得到的是普通 SQL 错误，而不是 `pool()` panic
/// 把整个进程带走。内存库随进程消失，不会污染用户数据。
pub async fn init_fallback_pool() {
    if DB_POOL.get().is_some() {
        return;
    }
    if let Ok(pool) = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
    {
        let _ = DB_POOL.set(pool);
    }
}

/// 获取全局连接池。必须先调用 `init_db` 或 `init_fallback_pool`，否则 panic。
pub fn pool() -> &'static SqlitePool {
    DB_POOL
        .get()
        .expect("DB pool 尚未初始化，启动时必须先调用 storage::db::init_db")
}

/// 读取当前已应用的最高 schema 版本号。表不存在或无记录返回 0。
pub async fn get_schema_version() -> AppResult<u32> {
    let row: Option<(i64,)> =
        sqlx::query_as("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1")
            .fetch_optional(pool())
            .await
            .map_err(|e| {
                crate::error::AppError::from(format!("读取 schema_version 失败: {}", e))
            })?;

    Ok(row.map(|(v,)| v as u32).unwrap_or(0))
}

/// 标记某个版本已应用。同版本号重复写入会被主键拦下，返回错误。
pub async fn set_schema_version(version: u32) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)")
        .bind(version as i64)
        .bind(now)
        .execute(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("写入 schema_version 失败: {}", e)))?;
    Ok(())
}
