// 项目管理模块（SQLite 后端版）
//
// 设计：
// - 所有 CRUD 走 SQLite，不再有内存缓存
// - 多对多 tags/labels 通过关系表存储（project_tags / project_labels）
// - 写操作用事务保证原子性
// - command 签名与旧版完全一致（前端零感知）

use crate::error::AppResult;
use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use sqlx::Acquire;

use crate::storage::db::pool;
use crate::storage::{current_iso_time, generate_id, Project};

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct CreateProjectInput {
    pub name: String,
    pub path: String,
    pub tags: Option<Vec<String>>,
    pub labels: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct UpdateProjectInput {
    pub id: String,
    pub name: Option<String>,
    pub tags: Option<Vec<String>>,
    pub labels: Option<Vec<String>>,
}

// ============ helpers ============

type ProjectRow = (
    String,         // id
    String,         // name
    String,         // path
    i64,            // is_favorite
    String,         // created_at
    String,         // updated_at
    Option<String>, // last_opened
    Option<String>, // editor_id
    Option<String>, // claude_env_name
);

const PROJECT_SELECT: &str = "SELECT id, name, path, is_favorite, created_at, updated_at, last_opened, editor_id, claude_env_name FROM projects";

fn project_from_row(row: ProjectRow, tags: Vec<String>, labels: Vec<String>) -> Project {
    let (
        id,
        name,
        path,
        is_favorite,
        created_at,
        updated_at,
        last_opened,
        editor_id,
        claude_env_name,
    ) = row;
    Project {
        id,
        name,
        path,
        is_favorite: is_favorite != 0,
        tags,
        labels,
        created_at,
        updated_at,
        last_opened,
        editor_id,
        claude_env_name,
    }
}

/// 取一个项目的完整数据（含 tags / labels）
async fn fetch_project_by_id(id: &str) -> AppResult<Option<Project>> {
    let pool = pool();
    let row: Option<ProjectRow> = sqlx::query_as(&format!("{} WHERE id = ?", PROJECT_SELECT))
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| crate::error::AppError::from(format!("查询项目 {} 失败: {}", id, e)))?;

    let Some(row) = row else {
        return Ok(None);
    };

    let tags: Vec<String> =
        sqlx::query_scalar("SELECT tag FROM project_tags WHERE project_id = ? ORDER BY tag")
            .bind(id)
            .fetch_all(pool)
            .await
            .map_err(|e| crate::error::AppError::from(format!("查询 tags 失败: {}", e)))?;

    let labels: Vec<String> =
        sqlx::query_scalar("SELECT label FROM project_labels WHERE project_id = ? ORDER BY label")
            .bind(id)
            .fetch_all(pool)
            .await
            .map_err(|e| crate::error::AppError::from(format!("查询 labels 失败: {}", e)))?;

    Ok(Some(project_from_row(row, tags, labels)))
}

/// 取所有项目（一次查询拉全部 + 各拉一次 tags/labels，避免 N+1）
async fn fetch_all_projects() -> AppResult<Vec<Project>> {
    let pool = pool();
    let rows: Vec<ProjectRow> =
        sqlx::query_as(&format!("{} ORDER BY updated_at DESC", PROJECT_SELECT))
            .fetch_all(pool)
            .await
            .map_err(|e| crate::error::AppError::from(format!("查询项目列表失败: {}", e)))?;

    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let all_tags: Vec<(String, String)> =
        sqlx::query_as("SELECT project_id, tag FROM project_tags ORDER BY project_id, tag")
            .fetch_all(pool)
            .await
            .map_err(|e| crate::error::AppError::from(format!("查询全量 tags 失败: {}", e)))?;

    let all_labels: Vec<(String, String)> =
        sqlx::query_as("SELECT project_id, label FROM project_labels ORDER BY project_id, label")
            .fetch_all(pool)
            .await
            .map_err(|e| crate::error::AppError::from(format!("查询全量 labels 失败: {}", e)))?;

    let mut tags_map: HashMap<String, Vec<String>> = HashMap::new();
    for (pid, tag) in all_tags {
        tags_map.entry(pid).or_default().push(tag);
    }
    let mut labels_map: HashMap<String, Vec<String>> = HashMap::new();
    for (pid, label) in all_labels {
        labels_map.entry(pid).or_default().push(label);
    }

    Ok(rows
        .into_iter()
        .map(|row| {
            let tags = tags_map.remove(&row.0).unwrap_or_default();
            let labels = labels_map.remove(&row.0).unwrap_or_default();
            project_from_row(row, tags, labels)
        })
        .collect())
}

/// 规范化并校验项目路径 —— 所有「添加到书架」的入口共用这一处守卫。
///
/// 对话框、拖拽、命令行 `--add-project`、文件管理器右键都走这里，
/// 校验写在收敛点，不在每个入口各写一份。
///
/// canonicalize 顺带解决了三件事：相对路径转绝对、symlink 解析、
/// Windows 大小写归一 —— 都是查重的前提（`/a/b` 与 `/a/b/` 必须算同一个项目）。
///
/// 注意：`import_projects` 故意**不**走这里。导入备份文件时，路径可能
/// 属于另一台机器、本地并不存在，强制校验会让整个导入失败。
pub fn normalize_project_path(path: &str) -> AppResult<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(crate::error::AppError::from("项目路径为空".to_string()));
    }

    let p = PathBuf::from(trimmed);
    if !p.exists() {
        return Err(crate::error::AppError::from(format!(
            "路径不存在：{}",
            trimmed
        )));
    }
    if !p.is_dir() {
        return Err(crate::error::AppError::from(format!(
            "不是文件夹：{}",
            trimmed
        )));
    }

    // canonicalize 失败通常是权限不足或路径被占用
    let canonical = p.canonicalize().map_err(|e| {
        crate::error::AppError::from(format!("无法访问路径 {}：{}", trimmed, e))
    })?;

    // HOME、`/`、盘符根、应用数据目录等不能进书架 —— 一旦入库，
    // 「删除本地目录」就会拿它去 remove_dir_all。
    crate::path_guard::ensure_safe_project_path(&canonical)?;

    Ok(strip_verbatim_prefix(canonical.to_string_lossy().as_ref()))
}

/// Windows 的 canonicalize 返回 verbatim 路径（`\\?\C:\foo`）。
/// 直接入库会导致与历史记录对不上、界面难看、传给编辑器可能打不开，必须还原。
/// 网络路径 `\\?\UNC\server\share` 要还原成 `\\server\share`，不能只砍前缀。
fn strip_verbatim_prefix(path: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{}", rest);
        }
        if let Some(rest) = path.strip_prefix(r"\\?\") {
            return rest.to_string();
        }
    }
    path.to_string()
}

/// 从路径推导项目名（取最后一段目录名）
fn derive_project_name(path: &str) -> String {
    PathBuf::from(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Unknown".to_string())
}

/// 按路径查已有项目（查重用）
async fn fetch_project_by_path(path: &str) -> AppResult<Option<Project>> {
    let id: Option<(String,)> = sqlx::query_as("SELECT id FROM projects WHERE path = ?")
        .bind(path)
        .fetch_optional(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("查询路径唯一性失败: {}", e)))?;

    match id {
        Some((id,)) => fetch_project_by_id(&id).await,
        None => Ok(None),
    }
}

async fn project_exists(id: &str) -> AppResult<bool> {
    let exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM projects WHERE id = ?")
        .bind(id)
        .fetch_optional(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("查询项目存在性失败: {}", e)))?;
    Ok(exists.is_some())
}

// ============ commands ============

#[tauri::command]
#[specta::specta]
pub async fn get_projects() -> AppResult<Vec<Project>> {
    fetch_all_projects().await
}

#[tauri::command]
#[specta::specta]
pub async fn create_project(input: CreateProjectInput) -> AppResult<Project> {
    let path = normalize_project_path(&input.path)?;

    if fetch_project_by_path(&path).await?.is_some() {
        return Err(crate::error::AppError::from("项目路径已存在".to_string()));
    }
    let input = CreateProjectInput { path, ..input };

    let now = current_iso_time();
    let id = generate_id();
    let tags = input.tags.unwrap_or_default();
    let labels = input.labels.unwrap_or_default();

    let pool = pool();
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| crate::error::AppError::from(format!("获取连接失败: {}", e)))?;
    let mut tx = conn
        .begin()
        .await
        .map_err(|e| crate::error::AppError::from(format!("开启事务失败: {}", e)))?;

    sqlx::query(
        "INSERT INTO projects (id, name, path, is_favorite, created_at, updated_at, last_opened, editor_id, claude_env_name)
         VALUES (?, ?, ?, 0, ?, ?, NULL, NULL, NULL)",
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.path)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| crate::error::AppError::from(format!("插入项目失败: {}", e)))?;

    for tag in &tags {
        sqlx::query(
            "INSERT INTO project_tags (project_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING",
        )
        .bind(&id)
        .bind(tag)
        .execute(&mut *tx)
        .await
        .map_err(|e| crate::error::AppError::from(format!("插入 tag 失败: {}", e)))?;
    }
    for label in &labels {
        sqlx::query(
            "INSERT INTO project_labels (project_id, label) VALUES (?, ?) ON CONFLICT DO NOTHING",
        )
        .bind(&id)
        .bind(label)
        .execute(&mut *tx)
        .await
        .map_err(|e| crate::error::AppError::from(format!("插入 label 失败: {}", e)))?;
    }

    tx.commit()
        .await
        .map_err(|e| crate::error::AppError::from(format!("提交事务失败: {}", e)))?;

    Ok(Project {
        id,
        name: input.name,
        path: input.path,
        is_favorite: false,
        tags,
        labels,
        created_at: now.clone(),
        updated_at: now,
        last_opened: None,
        editor_id: None,
        claude_env_name: None,
    })
}

/// 只给了路径时的添加结果。`created = false` 表示书架里已有，
/// 前端据此提示「已在书架中」并定位过去，而不是报错。
#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct AddProjectByPathResult {
    pub project: Project,
    pub created: bool,
}

/// 只凭一个路径添加项目：拖拽、命令行 `--add-project`、文件管理器右键共用。
/// 名字从目录名推导，标签留空，用户之后自己补。
#[tauri::command]
#[specta::specta]
pub async fn add_project_by_path(path: String) -> AppResult<AddProjectByPathResult> {
    let path = normalize_project_path(&path)?;

    if let Some(project) = fetch_project_by_path(&path).await? {
        return Ok(AddProjectByPathResult {
            project,
            created: false,
        });
    }

    let project = create_project(CreateProjectInput {
        name: derive_project_name(&path),
        path,
        tags: None,
        labels: None,
    })
    .await?;

    Ok(AddProjectByPathResult {
        project,
        created: true,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn update_project(input: UpdateProjectInput) -> AppResult<Project> {
    if !project_exists(&input.id).await? {
        return Err(crate::error::AppError::from("项目不存在".to_string()));
    }

    let now = current_iso_time();
    let pool = pool();
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| crate::error::AppError::from(format!("获取连接失败: {}", e)))?;
    let mut tx = conn
        .begin()
        .await
        .map_err(|e| crate::error::AppError::from(format!("开启事务失败: {}", e)))?;

    if let Some(name) = &input.name {
        sqlx::query("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?")
            .bind(name)
            .bind(&now)
            .bind(&input.id)
            .execute(&mut *tx)
            .await
            .map_err(|e| crate::error::AppError::from(format!("更新 name 失败: {}", e)))?;
    } else {
        sqlx::query("UPDATE projects SET updated_at = ? WHERE id = ?")
            .bind(&now)
            .bind(&input.id)
            .execute(&mut *tx)
            .await
            .map_err(|e| crate::error::AppError::from(format!("更新 updated_at 失败: {}", e)))?;
    }

    if let Some(tags) = &input.tags {
        sqlx::query("DELETE FROM project_tags WHERE project_id = ?")
            .bind(&input.id)
            .execute(&mut *tx)
            .await
            .map_err(|e| crate::error::AppError::from(format!("清空旧 tags 失败: {}", e)))?;
        for tag in tags {
            sqlx::query(
                "INSERT INTO project_tags (project_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING",
            )
            .bind(&input.id)
            .bind(tag)
            .execute(&mut *tx)
            .await
            .map_err(|e| crate::error::AppError::from(format!("插入 tag 失败: {}", e)))?;
        }
    }

    if let Some(labels) = &input.labels {
        sqlx::query("DELETE FROM project_labels WHERE project_id = ?")
            .bind(&input.id)
            .execute(&mut *tx)
            .await
            .map_err(|e| crate::error::AppError::from(format!("清空旧 labels 失败: {}", e)))?;
        for label in labels {
            sqlx::query(
                "INSERT INTO project_labels (project_id, label) VALUES (?, ?) ON CONFLICT DO NOTHING",
            )
            .bind(&input.id)
            .bind(label)
            .execute(&mut *tx)
            .await
            .map_err(|e| crate::error::AppError::from(format!("插入 label 失败: {}", e)))?;
        }
    }

    tx.commit()
        .await
        .map_err(|e| crate::error::AppError::from(format!("提交事务失败: {}", e)))?;

    fetch_project_by_id(&input.id)
        .await?
        .ok_or_else(|| crate::error::AppError::from("项目不存在".to_string()))
}

#[tauri::command]
#[specta::specta]
pub async fn delete_project(id: String) -> AppResult<()> {
    let result = sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(&id)
        .execute(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("删除项目失败: {}", e)))?;
    if result.rows_affected() == 0 {
        return Err(crate::error::AppError::from("项目不存在".to_string()));
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_project_directory(id: String) -> AppResult<()> {
    let project = fetch_project_by_id(&id)
        .await?
        .ok_or_else(|| crate::error::AppError::from("项目不存在".to_string()))?;
    let path = PathBuf::from(&project.path);

    if path.exists() {
        // 不信任库里的历史路径：删除前按当前文件系统重新 canonicalize 并过守卫，
        // 删的也是解析后的路径（symlink 指向受保护目录时会在这里被拒）。
        let target = crate::path_guard::ensure_deletable_dir(&path)?;
        // 物理目录删除走阻塞线程，避免占住 tokio runtime
        tokio::task::spawn_blocking(move || std::fs::remove_dir_all(&target))
            .await
            .map_err(|e| crate::error::AppError::from(format!("删除任务调度失败: {}", e)))?
            .map_err(|e| crate::error::AppError::from(format!("删除目录失败: {}", e)))?;
    }

    sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(&id)
        .execute(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("删除项目记录失败: {}", e)))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn toggle_favorite(id: String) -> AppResult<Project> {
    let now = current_iso_time();
    let result = sqlx::query(
        "UPDATE projects
         SET is_favorite = CASE is_favorite WHEN 0 THEN 1 ELSE 0 END,
             updated_at = ?
         WHERE id = ?",
    )
    .bind(&now)
    .bind(&id)
    .execute(pool())
    .await
    .map_err(|e| crate::error::AppError::from(format!("切换收藏失败: {}", e)))?;

    if result.rows_affected() == 0 {
        return Err(crate::error::AppError::from("项目不存在".to_string()));
    }

    fetch_project_by_id(&id)
        .await?
        .ok_or_else(|| crate::error::AppError::from("项目不存在".to_string()))
}

#[tauri::command]
#[specta::specta]
pub async fn update_last_opened(id: String) -> AppResult<Project> {
    let now = current_iso_time();
    let result = sqlx::query("UPDATE projects SET last_opened = ?, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&now)
        .bind(&id)
        .execute(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("更新 last_opened 失败: {}", e)))?;

    if result.rows_affected() == 0 {
        return Err(crate::error::AppError::from("项目不存在".to_string()));
    }

    fetch_project_by_id(&id)
        .await?
        .ok_or_else(|| crate::error::AppError::from("项目不存在".to_string()))
}

#[tauri::command]
#[specta::specta]
pub async fn batch_update_projects(updates: Vec<UpdateProjectInput>) -> AppResult<Vec<Project>> {
    let now = current_iso_time();
    let pool = pool();

    let mut updated_ids: Vec<String> = Vec::new();

    for input in updates {
        // 单独的事务，单条失败不影响其他
        let mut conn = pool
            .acquire()
            .await
            .map_err(|e| crate::error::AppError::from(format!("获取连接失败: {}", e)))?;
        let mut tx = conn
            .begin()
            .await
            .map_err(|e| crate::error::AppError::from(format!("开启事务失败: {}", e)))?;

        let exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM projects WHERE id = ?")
            .bind(&input.id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| crate::error::AppError::from(format!("查询项目失败: {}", e)))?;
        if exists.is_none() {
            // 跳过不存在的，与旧实现一致
            continue;
        }

        if let Some(name) = &input.name {
            sqlx::query("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?")
                .bind(name)
                .bind(&now)
                .bind(&input.id)
                .execute(&mut *tx)
                .await
                .map_err(|e| crate::error::AppError::from(format!("更新 name 失败: {}", e)))?;
        } else {
            sqlx::query("UPDATE projects SET updated_at = ? WHERE id = ?")
                .bind(&now)
                .bind(&input.id)
                .execute(&mut *tx)
                .await
                .map_err(|e| {
                    crate::error::AppError::from(format!("更新 updated_at 失败: {}", e))
                })?;
        }

        if let Some(tags) = &input.tags {
            sqlx::query("DELETE FROM project_tags WHERE project_id = ?")
                .bind(&input.id)
                .execute(&mut *tx)
                .await
                .map_err(|e| crate::error::AppError::from(format!("清空 tags 失败: {}", e)))?;
            for tag in tags {
                sqlx::query(
                    "INSERT INTO project_tags (project_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING",
                )
                .bind(&input.id)
                .bind(tag)
                .execute(&mut *tx)
                .await
                .map_err(|e| crate::error::AppError::from(format!("插入 tag 失败: {}", e)))?;
            }
        }

        if let Some(labels) = &input.labels {
            sqlx::query("DELETE FROM project_labels WHERE project_id = ?")
                .bind(&input.id)
                .execute(&mut *tx)
                .await
                .map_err(|e| crate::error::AppError::from(format!("清空 labels 失败: {}", e)))?;
            for label in labels {
                sqlx::query(
                    "INSERT INTO project_labels (project_id, label) VALUES (?, ?) ON CONFLICT DO NOTHING",
                )
                .bind(&input.id)
                .bind(label)
                .execute(&mut *tx)
                .await
                .map_err(|e| crate::error::AppError::from(format!("插入 label 失败: {}", e)))?;
            }
        }

        tx.commit()
            .await
            .map_err(|e| crate::error::AppError::from(format!("提交事务失败: {}", e)))?;
        updated_ids.push(input.id);
    }

    // 批量返回更新后的项目
    let mut out = Vec::new();
    for id in updated_ids {
        if let Some(p) = fetch_project_by_id(&id).await? {
            out.push(p);
        }
    }
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn batch_delete_projects(ids: Vec<String>) -> AppResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let pool = pool();
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| crate::error::AppError::from(format!("获取连接失败: {}", e)))?;
    let mut tx = conn
        .begin()
        .await
        .map_err(|e| crate::error::AppError::from(format!("开启事务失败: {}", e)))?;

    for id in &ids {
        sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| crate::error::AppError::from(format!("删除项目 {} 失败: {}", id, e)))?;
    }
    tx.commit()
        .await
        .map_err(|e| crate::error::AppError::from(format!("提交事务失败: {}", e)))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn import_projects(new_projects: Vec<CreateProjectInput>) -> AppResult<Vec<Project>> {
    let mut imported = Vec::new();
    let pool = pool();

    for input in new_projects {
        // 导入的路径可能来自另一台机器、本地并不存在，所以不强制 canonicalize；
        // 但受保护目录一律不许写进库（否则「删除本地目录」会拿它当目标）。
        // 与「跳过重复路径」一致：跳过而不是让整份导入失败。
        if let Err(e) = crate::path_guard::ensure_safe_project_path(std::path::Path::new(&input.path))
        {
            log::warn!("导入跳过受保护路径 {}: {}", input.path, e);
            continue;
        }

        // 跳过已存在的路径（与旧实现一致）
        let exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM projects WHERE path = ?")
            .bind(&input.path)
            .fetch_optional(pool)
            .await
            .map_err(|e| crate::error::AppError::from(format!("查询路径唯一性失败: {}", e)))?;
        if exists.is_some() {
            continue;
        }

        let now = current_iso_time();
        let id = generate_id();
        let tags = input.tags.unwrap_or_default();
        let labels = input.labels.unwrap_or_default();

        let mut conn = pool
            .acquire()
            .await
            .map_err(|e| crate::error::AppError::from(format!("获取连接失败: {}", e)))?;
        let mut tx = conn
            .begin()
            .await
            .map_err(|e| crate::error::AppError::from(format!("开启事务失败: {}", e)))?;

        sqlx::query(
            "INSERT INTO projects (id, name, path, is_favorite, created_at, updated_at, last_opened, editor_id, claude_env_name)
             VALUES (?, ?, ?, 0, ?, ?, NULL, NULL, NULL)",
        )
        .bind(&id)
        .bind(&input.name)
        .bind(&input.path)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| crate::error::AppError::from(format!("插入项目失败: {}", e)))?;

        for tag in &tags {
            sqlx::query(
                "INSERT INTO project_tags (project_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING",
            )
            .bind(&id)
            .bind(tag)
            .execute(&mut *tx)
            .await
            .map_err(|e| crate::error::AppError::from(format!("插入 tag 失败: {}", e)))?;
        }
        for label in &labels {
            sqlx::query(
                "INSERT INTO project_labels (project_id, label) VALUES (?, ?) ON CONFLICT DO NOTHING",
            )
            .bind(&id)
            .bind(label)
            .execute(&mut *tx)
            .await
            .map_err(|e| crate::error::AppError::from(format!("插入 label 失败: {}", e)))?;
        }

        tx.commit()
            .await
            .map_err(|e| crate::error::AppError::from(format!("提交事务失败: {}", e)))?;

        imported.push(Project {
            id,
            name: input.name,
            path: input.path,
            is_favorite: false,
            tags,
            labels,
            created_at: now.clone(),
            updated_at: now,
            last_opened: None,
            editor_id: None,
            claude_env_name: None,
        });
    }

    Ok(imported)
}

/// 兼容旧 API：从持久层重新读取项目列表
#[tauri::command]
#[specta::specta]
pub async fn reload_projects() -> AppResult<Vec<Project>> {
    fetch_all_projects().await
}

#[tauri::command]
#[specta::specta]
pub async fn set_project_editor(id: String, editor_id: Option<String>) -> AppResult<Project> {
    let now = current_iso_time();
    let result = sqlx::query("UPDATE projects SET editor_id = ?, updated_at = ? WHERE id = ?")
        .bind(&editor_id)
        .bind(&now)
        .bind(&id)
        .execute(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("更新 editor_id 失败: {}", e)))?;

    if result.rows_affected() == 0 {
        return Err(crate::error::AppError::from("项目不存在".to_string()));
    }

    fetch_project_by_id(&id)
        .await?
        .ok_or_else(|| crate::error::AppError::from("项目不存在".to_string()))
}

#[tauri::command]
#[specta::specta]
pub async fn set_project_claude_env(
    id: String,
    claude_env_name: Option<String>,
) -> AppResult<Project> {
    let now = current_iso_time();
    let result =
        sqlx::query("UPDATE projects SET claude_env_name = ?, updated_at = ? WHERE id = ?")
            .bind(&claude_env_name)
            .bind(&now)
            .bind(&id)
            .execute(pool())
            .await
            .map_err(|e| {
                crate::error::AppError::from(format!("更新 claude_env_name 失败: {}", e))
            })?;

    if result.rows_affected() == 0 {
        return Err(crate::error::AppError::from("项目不存在".to_string()));
    }

    fetch_project_by_id(&id)
        .await?
        .ok_or_else(|| crate::error::AppError::from("项目不存在".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 守卫的三条边界 + 「带不带尾部斜杠必须算同一个路径」（查重的前提）
    #[test]
    fn test_normalize_project_path() {
        let dir = std::env::temp_dir().join("codeshelf_normalize_test");
        std::fs::create_dir_all(&dir).unwrap();
        let dir_str = dir.to_string_lossy().to_string();

        let normalized = normalize_project_path(&dir_str).unwrap();
        assert!(!normalized.is_empty());
        assert!(!normalized.starts_with(r"\\?\"), "verbatim 前缀没剥掉");

        // 尾部分隔符、前后空格都要归一到同一个结果，否则会重复添加
        assert_eq!(
            normalize_project_path(&format!("{}{}", dir_str, std::path::MAIN_SEPARATOR)).unwrap(),
            normalized
        );
        assert_eq!(
            normalize_project_path(&format!("  {}  ", dir_str)).unwrap(),
            normalized
        );

        // 不存在的路径
        assert!(normalize_project_path(&dir.join("no_such_dir").to_string_lossy()).is_err());
        // 空路径
        assert!(normalize_project_path("   ").is_err());

        // 文件不是文件夹
        let file = dir.join("a.txt");
        std::fs::write(&file, "x").unwrap();
        assert!(normalize_project_path(&file.to_string_lossy()).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_derive_project_name() {
        let sep = std::path::MAIN_SEPARATOR;
        assert_eq!(derive_project_name(&format!("{sep}a{sep}b{sep}my-proj")), "my-proj");
    }
}
