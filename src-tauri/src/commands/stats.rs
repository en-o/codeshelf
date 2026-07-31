// 统计数据缓存（SQLite 后端版）
//
// 存储布局（v1 schema）：
//   - project_stats(project_path, unpushed, last_updated)
//   - project_stats_commits_by_date(project_path, date, count)
//   - project_stats_recent_commits(project_path, sort_order, ...)
//   - stats_dirty(project_path)               -- 待重新统计的项目
//   - stats_meta(key, value)                  -- 聚合 dashboard 数据（key='dashboard'）
//
// 读路径：
//   - get_dashboard_stats / has_dirty_stats -> 一次 SELECT，飞快
//
// 写路径：
//   - refresh_xxx_stats 跑 git → 写 3 张明细表 → 重新聚合 dashboard → 写 stats_meta
//
// 这些 struct 仍然保留，因为：
//   1. command 签名要兼容
//   2. v1_from_json 反序列化老 JSON 需要 PersistedStatsCache

use crate::error::AppResult;
use std::collections::{HashMap, HashSet};
use std::process::Command;

use serde::{Deserialize, Serialize};
use sqlx::Acquire;
use tokio::task;

use crate::storage::db::pool;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ============== 公开数据结构 ==============

#[derive(Debug, Serialize, Deserialize, Clone, Default, specta::Type)]
pub struct DashboardStats {
    pub total_projects: u32,
    pub today_commits: u32,
    pub week_commits: u32,
    pub unpushed_commits: u32,
    pub unmerged_branches: u32,
    pub last_updated: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct DailyActivity {
    pub date: String,
    pub count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct RecentCommit {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub email: String,
    pub date: String,
    pub project_name: String,
    pub project_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, specta::Type)]
pub struct CachedDashboardData {
    pub stats: DashboardStats,
    pub heatmap_data: Vec<DailyActivity>,
    pub recent_commits: Vec<RecentCommit>,
}

/// 持久化的统计缓存结构 — 仅用于从老 JSON 反序列化迁移
#[derive(Debug, Serialize, Deserialize, Clone, Default, specta::Type)]
pub struct PersistedStatsCache {
    pub data: CachedDashboardData,
    pub last_updated: i64,
    pub dirty_projects: HashSet<String>,
    pub project_stats: HashMap<String, ProjectStatsCache>,
}

/// 单个项目的统计缓存 — 同样用于反序列化迁移
#[derive(Debug, Serialize, Deserialize, Clone, Default, specta::Type)]
pub struct ProjectStatsCache {
    pub unpushed: u32,
    pub commits_by_date: HashMap<String, u32>,
    pub recent_commits: Vec<RecentCommit>,
    pub last_updated: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct ProjectInfo {
    pub id: Option<String>,
    pub name: String,
    pub path: String,
}

// ============== 工具函数 ==============

fn run_git_command(path: &str, args: &[&str]) -> AppResult<String> {
    #[cfg(target_os = "windows")]
    let output = Command::new("git")
        .args(["-C", path])
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| crate::error::AppError::from(e.to_string()))?;

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("git")
        .args(["-C", path])
        .args(args)
        .output()
        .map_err(|e| crate::error::AppError::from(e.to_string()))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(crate::error::AppError::from(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ))
    }
}

fn get_current_time() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn get_current_timestamp() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn get_today_date() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn get_dates_in_last_week() -> Vec<String> {
    let mut dates = Vec::new();
    let now = chrono::Local::now();
    for i in 0..7 {
        let date = now - chrono::Duration::days(i);
        dates.push(date.format("%Y-%m-%d").to_string());
    }
    dates
}

/// 读取提交记录。
///
/// 返回 `Err` 表示**分析失败**（git 不可用 / 不是仓库 / 权限问题），
/// 与「仓库确实没有提交」是两回事 —— 原来两者都返回空 Vec，
/// 于是一次 git 失败会被当成"0 次提交"覆盖掉上一次正确的缓存。
fn get_project_commits(
    path: &str,
    limit: u32,
) -> Result<Vec<(String, String, String, String, String, String)>, String> {
    // 字段用 `%x1f`（US, 单元分隔符）、记录用 `-z`（NUL）分隔。
    //
    // 原来用 `|` 分隔：提交主题和作者名里出现竖线是很常见的
    // （`fix: 处理 a|b`、`作者|带竖线`），一旦出现，`split('|')` 之后
    // 所有字段整体错位 —— 作者变成主题的后半截、日期变成邮箱，
    // 「最近活动」时间也跟着错。这两个控制字符不会出现在正常的 git 元数据里。
    let format = "%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%ai";
    let output = run_git_command(
        path,
        &[
            "log",
            "-z",
            &format!("-{}", limit),
            &format!("--format={}", format),
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(output
        .split('\0')
        .filter(|r| !r.trim().is_empty())
        .filter_map(|record| {
            let parts: Vec<&str> = record.split('\u{1f}').collect();
            if parts.len() >= 6 {
                Some((
                    parts[0].to_string(),
                    parts[1].to_string(),
                    parts[2].to_string(),
                    parts[3].to_string(),
                    parts[4].to_string(),
                    parts[5].to_string(),
                ))
            } else {
                None
            }
        })
        .collect())
}

fn get_unpushed_count(path: &str) -> u32 {
    let output = run_git_command(
        path,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    );

    match output {
        Ok(result) => {
            let parts: Vec<&str> = result.split_whitespace().collect();
            if !parts.is_empty() {
                parts[0].parse().unwrap_or(0)
            } else {
                0
            }
        }
        Err(_) => 0,
    }
}

/// 跑 git 收集一个项目的统计（spawn_blocking 调用）。
///
/// 返回 `Err` 表示分析失败，调用方**不应该**用它覆盖已有缓存 ——
/// 一次 git 失败不代表这个项目真的没有提交。
fn analyze_project(name: String, path: String) -> Result<ProjectStatsCache, String> {
    let unpushed = get_unpushed_count(&path);
    let commits = get_project_commits(&path, 365)?;

    let mut commits_by_date: HashMap<String, u32> = HashMap::new();
    let mut recent_commits: Vec<RecentCommit> = Vec::new();

    for (hash, short_hash, message, author, email, date) in commits {
        let commit_date = date.split_whitespace().next().unwrap_or(&date).to_string();
        *commits_by_date.entry(commit_date).or_insert(0) += 1;

        if recent_commits.len() < 10 {
            recent_commits.push(RecentCommit {
                hash,
                short_hash,
                message,
                author,
                email,
                date,
                project_name: name.clone(),
                project_path: path.clone(),
            });
        }
    }

    Ok(ProjectStatsCache {
        unpushed,
        commits_by_date,
        recent_commits,
        last_updated: get_current_timestamp(),
    })
}

// ============== sqlite 持久化 ==============

/// 一次性把一个项目的统计写入 sqlite（覆盖该项目的旧数据）
async fn write_project_stats(project_path: &str, stats: &ProjectStatsCache) -> AppResult<()> {
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
        "INSERT INTO project_stats (project_path, unpushed, last_updated)
         VALUES (?, ?, ?)
         ON CONFLICT(project_path) DO UPDATE SET
            unpushed = excluded.unpushed,
            last_updated = excluded.last_updated",
    )
    .bind(project_path)
    .bind(stats.unpushed as i64)
    .bind(stats.last_updated)
    .execute(&mut *tx)
    .await
    .map_err(|e| crate::error::AppError::from(format!("写 project_stats 失败: {}", e)))?;

    // 清空旧明细，重新插入
    sqlx::query("DELETE FROM project_stats_commits_by_date WHERE project_path = ?")
        .bind(project_path)
        .execute(&mut *tx)
        .await
        .map_err(|e| crate::error::AppError::from(format!("清空 commits_by_date 失败: {}", e)))?;
    for (date, count) in &stats.commits_by_date {
        sqlx::query(
            "INSERT INTO project_stats_commits_by_date (project_path, date, count)
             VALUES (?, ?, ?)",
        )
        .bind(project_path)
        .bind(date)
        .bind(*count as i64)
        .execute(&mut *tx)
        .await
        .map_err(|e| crate::error::AppError::from(format!("插入 commits_by_date 失败: {}", e)))?;
    }

    sqlx::query("DELETE FROM project_stats_recent_commits WHERE project_path = ?")
        .bind(project_path)
        .execute(&mut *tx)
        .await
        .map_err(|e| crate::error::AppError::from(format!("清空 recent_commits 失败: {}", e)))?;
    for (idx, rc) in stats.recent_commits.iter().enumerate() {
        sqlx::query(
            "INSERT INTO project_stats_recent_commits (
                project_path, sort_order, hash, short_hash, message,
                author, email, date, project_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(project_path)
        .bind(idx as i64)
        .bind(&rc.hash)
        .bind(&rc.short_hash)
        .bind(&rc.message)
        .bind(&rc.author)
        .bind(&rc.email)
        .bind(&rc.date)
        .bind(&rc.project_name)
        .execute(&mut *tx)
        .await
        .map_err(|e| crate::error::AppError::from(format!("插入 recent_commits 失败: {}", e)))?;
    }

    tx.commit()
        .await
        .map_err(|e| crate::error::AppError::from(format!("提交事务失败: {}", e)))?;
    Ok(())
}

/// 读所有项目的统计明细（用于聚合 dashboard）
async fn read_all_project_stats() -> AppResult<HashMap<String, ProjectStatsCache>> {
    let pool = pool();

    let basics: Vec<(String, i64, i64)> =
        sqlx::query_as("SELECT project_path, unpushed, last_updated FROM project_stats")
            .fetch_all(pool)
            .await
            .map_err(|e| crate::error::AppError::from(format!("查询 project_stats 失败: {}", e)))?;

    if basics.is_empty() {
        return Ok(HashMap::new());
    }

    let all_dates: Vec<(String, String, i64)> =
        sqlx::query_as("SELECT project_path, date, count FROM project_stats_commits_by_date")
            .fetch_all(pool)
            .await
            .map_err(|e| {
                crate::error::AppError::from(format!("查询 commits_by_date 失败: {}", e))
            })?;

    let all_recent: Vec<(
        String,
        i64,
        String,
        String,
        String,
        String,
        String,
        String,
        String,
    )> = sqlx::query_as(
        "SELECT project_path, sort_order, hash, short_hash, message, author, email, date, project_name
         FROM project_stats_recent_commits
         ORDER BY project_path, sort_order",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| crate::error::AppError::from(format!("查询 recent_commits 失败: {}", e)))?;

    let mut date_map: HashMap<String, HashMap<String, u32>> = HashMap::new();
    for (proj, date, count) in all_dates {
        date_map.entry(proj).or_default().insert(date, count as u32);
    }

    let mut recent_map: HashMap<String, Vec<RecentCommit>> = HashMap::new();
    for (proj, _idx, hash, short_hash, message, author, email, date, project_name) in all_recent {
        recent_map
            .entry(proj.clone())
            .or_default()
            .push(RecentCommit {
                hash,
                short_hash,
                message,
                author,
                email,
                date,
                project_name,
                project_path: proj,
            });
    }

    let mut out = HashMap::new();
    for (path, unpushed, last_updated) in basics {
        let commits_by_date = date_map.remove(&path).unwrap_or_default();
        let recent_commits = recent_map.remove(&path).unwrap_or_default();
        out.insert(
            path,
            ProjectStatsCache {
                unpushed: unpushed as u32,
                commits_by_date,
                recent_commits,
                last_updated,
            },
        );
    }
    Ok(out)
}

async fn read_dirty() -> AppResult<HashSet<String>> {
    let rows: Vec<String> = sqlx::query_scalar("SELECT project_path FROM stats_dirty")
        .fetch_all(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("查询 stats_dirty 失败: {}", e)))?;
    Ok(rows.into_iter().collect())
}

async fn write_dirty(path: &str) -> AppResult<()> {
    sqlx::query("INSERT INTO stats_dirty (project_path) VALUES (?) ON CONFLICT DO NOTHING")
        .bind(path)
        .execute(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("写 stats_dirty 失败: {}", e)))?;
    Ok(())
}

async fn clear_dirty(paths: &[String]) -> AppResult<()> {
    let pool = pool();
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| crate::error::AppError::from(format!("获取连接失败: {}", e)))?;
    let mut tx = conn
        .begin()
        .await
        .map_err(|e| crate::error::AppError::from(format!("开启事务失败: {}", e)))?;
    for p in paths {
        sqlx::query("DELETE FROM stats_dirty WHERE project_path = ?")
            .bind(p)
            .execute(&mut *tx)
            .await
            .map_err(|e| crate::error::AppError::from(format!("清除 stats_dirty 失败: {}", e)))?;
    }
    tx.commit()
        .await
        .map_err(|e| crate::error::AppError::from(format!("提交事务失败: {}", e)))?;
    Ok(())
}

async fn read_dashboard() -> AppResult<CachedDashboardData> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM stats_meta WHERE key = ?")
        .bind("dashboard")
        .fetch_optional(pool())
        .await
        .map_err(|e| {
            crate::error::AppError::from(format!("查询 stats_meta dashboard 失败: {}", e))
        })?;

    if let Some((json,)) = row {
        serde_json::from_str(&json)
            .map_err(|e| crate::error::AppError::from(format!("解析 dashboard JSON 失败: {}", e)))
    } else {
        Ok(CachedDashboardData::default())
    }
}

async fn write_dashboard(data: &CachedDashboardData) -> AppResult<()> {
    let json = serde_json::to_string(data)
        .map_err(|e| crate::error::AppError::from(format!("序列化 dashboard 失败: {}", e)))?;
    sqlx::query(
        "INSERT INTO stats_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind("dashboard")
    .bind(&json)
    .execute(pool())
    .await
    .map_err(|e| crate::error::AppError::from(format!("写 stats_meta dashboard 失败: {}", e)))?;
    Ok(())
}

fn aggregate_dashboard(
    project_stats: &HashMap<String, ProjectStatsCache>,
    total_projects: u32,
) -> CachedDashboardData {
    let today = get_today_date();
    let week_dates = get_dates_in_last_week();

    let mut commits_by_date: HashMap<String, u32> = HashMap::new();
    let mut all_recent_commits: Vec<RecentCommit> = Vec::new();
    let mut unpushed_commits = 0u32;

    for stats in project_stats.values() {
        unpushed_commits += stats.unpushed;
        for (date, count) in &stats.commits_by_date {
            *commits_by_date.entry(date.clone()).or_insert(0) += count;
        }
        all_recent_commits.extend(stats.recent_commits.clone());
    }

    let today_commits = *commits_by_date.get(&today).unwrap_or(&0);
    let week_commits: u32 = week_dates
        .iter()
        .map(|d| *commits_by_date.get(d).unwrap_or(&0))
        .sum();

    let heatmap_data: Vec<DailyActivity> = commits_by_date
        .into_iter()
        .map(|(date, count)| DailyActivity { date, count })
        .collect();

    all_recent_commits.sort_by(|a, b| b.date.cmp(&a.date));
    let recent_commits: Vec<RecentCommit> = all_recent_commits.into_iter().take(30).collect();

    CachedDashboardData {
        stats: DashboardStats {
            total_projects,
            today_commits,
            week_commits,
            unpushed_commits,
            unmerged_branches: 0,
            last_updated: get_current_time(),
        },
        heatmap_data,
        recent_commits,
    }
}

// ============== Tauri 命令 ==============

#[tauri::command]
#[specta::specta]
pub async fn mark_project_dirty(project_path: String) -> AppResult<()> {
    write_dirty(&project_path).await
}

#[tauri::command]
#[specta::specta]
pub async fn mark_all_projects_dirty(projects: Vec<ProjectInfo>) -> AppResult<()> {
    let pool = pool();
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| crate::error::AppError::from(format!("获取连接失败: {}", e)))?;
    let mut tx = conn
        .begin()
        .await
        .map_err(|e| crate::error::AppError::from(format!("开启事务失败: {}", e)))?;
    for p in &projects {
        sqlx::query("INSERT INTO stats_dirty (project_path) VALUES (?) ON CONFLICT DO NOTHING")
            .bind(&p.path)
            .execute(&mut *tx)
            .await
            .map_err(|e| crate::error::AppError::from(format!("写 stats_dirty 失败: {}", e)))?;
    }
    tx.commit()
        .await
        .map_err(|e| crate::error::AppError::from(format!("提交事务失败: {}", e)))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn has_dirty_stats() -> AppResult<bool> {
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM stats_dirty")
        .fetch_one(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("查询 dirty 数量失败: {}", e)))?;
    Ok(count > 0)
}

#[tauri::command]
#[specta::specta]
pub async fn get_dashboard_stats() -> AppResult<CachedDashboardData> {
    read_dashboard().await
}

/// 只刷新脏项目的统计数据（增量更新）
#[tauri::command]
#[specta::specta]
pub async fn refresh_dirty_stats(projects: Vec<ProjectInfo>) -> AppResult<CachedDashboardData> {
    let dirty_paths = read_dirty().await?;

    if dirty_paths.is_empty() {
        return read_dashboard().await;
    }

    let projects_to_update: Vec<ProjectInfo> = projects
        .iter()
        .filter(|p| dirty_paths.contains(&p.path))
        .cloned()
        .collect();

    if projects_to_update.is_empty() {
        return read_dashboard().await;
    }

    // 并行跑 git
    let mut handles = Vec::new();
    for project in projects_to_update {
        let name = project.name.clone();
        let path = project.path.clone();
        let handle = task::spawn_blocking(move || (path.clone(), analyze_project(name, path)));
        handles.push(handle);
    }

    // 收集结果并写入
    let mut cleared_paths: Vec<String> = Vec::new();
    for handle in handles {
        if let Ok((path, result)) = handle.await {
            match result {
                Ok(stats) => {
                    write_project_stats(&path, &stats).await?;
                    // 只有分析成功才清 dirty；失败的项目保持 dirty，下次会重试
                    cleared_paths.push(path);
                }
                Err(e) => {
                    // 分析失败**不写缓存也不清 dirty**：
                    // 否则一次 git 失败就会把上一次正确的统计覆盖成 0，
                    // 而且 dirty 被清掉后再也不会自动重算。
                    log::warn!("项目统计分析失败，保留上次缓存并留待重试 ({}): {}", path, e);
                }
            }
        }
    }
    clear_dirty(&cleared_paths).await?;

    // 重新聚合 dashboard
    let all = read_all_project_stats().await?;
    let dashboard = aggregate_dashboard(&all, projects.len() as u32);
    write_dashboard(&dashboard).await?;
    Ok(dashboard)
}

/// 完整刷新所有项目统计
#[tauri::command]
#[specta::specta]
pub async fn refresh_dashboard_stats(projects: Vec<ProjectInfo>) -> AppResult<CachedDashboardData> {
    let total_projects = projects.len() as u32;

    if total_projects == 0 {
        // 清空所有 stats 数据
        sqlx::query("DELETE FROM project_stats")
            .execute(pool())
            .await
            .map_err(|e| crate::error::AppError::from(format!("清空 project_stats 失败: {}", e)))?;
        sqlx::query("DELETE FROM stats_dirty")
            .execute(pool())
            .await
            .map_err(|e| crate::error::AppError::from(format!("清空 stats_dirty 失败: {}", e)))?;
        let empty = CachedDashboardData::default();
        write_dashboard(&empty).await?;
        return Ok(empty);
    }

    let mut handles = Vec::new();
    for project in &projects {
        let name = project.name.clone();
        let path = project.path.clone();
        let handle = task::spawn_blocking(move || (path.clone(), analyze_project(name, path)));
        handles.push(handle);
    }

    let mut cleared_paths: Vec<String> = Vec::new();
    for handle in handles {
        if let Ok((path, result)) = handle.await {
            match result {
                Ok(stats) => {
                    write_project_stats(&path, &stats).await?;
                    // 只有分析成功才清 dirty；失败的项目保持 dirty，下次会重试
                    cleared_paths.push(path);
                }
                Err(e) => {
                    // 分析失败**不写缓存也不清 dirty**：
                    // 否则一次 git 失败就会把上一次正确的统计覆盖成 0，
                    // 而且 dirty 被清掉后再也不会自动重算。
                    log::warn!("项目统计分析失败，保留上次缓存并留待重试 ({}): {}", path, e);
                }
            }
        }
    }
    clear_dirty(&cleared_paths).await?;

    let all = read_all_project_stats().await?;
    let dashboard = aggregate_dashboard(&all, total_projects);
    write_dashboard(&dashboard).await?;
    Ok(dashboard)
}

/// 启动时调用。如果 sqlite 中已有缓存（24 小时内）就直接用；否则标记所有项目为脏
#[tauri::command]
#[specta::specta]
pub async fn init_stats_cache(projects: Vec<ProjectInfo>) -> AppResult<CachedDashboardData> {
    let now = get_current_timestamp();
    let all = read_all_project_stats().await?;

    let has_valid_cache = !all.is_empty()
        && all
            .values()
            .map(|s| s.last_updated)
            .max()
            .map(|t| now - t < 86400)
            .unwrap_or(false);

    if has_valid_cache {
        let cached_paths: HashSet<_> = all.keys().cloned().collect();
        let current_paths: HashSet<_> = projects.iter().map(|p| p.path.clone()).collect();

        // 新增项目 → 标记为脏
        for path in current_paths.difference(&cached_paths) {
            write_dirty(path).await?;
        }

        // 删除项目 → 从 sqlite 移除
        for path in cached_paths.difference(&current_paths) {
            sqlx::query("DELETE FROM project_stats WHERE project_path = ?")
                .bind(path)
                .execute(pool())
                .await
                .map_err(|e| {
                    crate::error::AppError::from(format!("清理过期 project_stats 失败: {}", e))
                })?;
        }

        let refreshed = read_all_project_stats().await?;
        let dashboard = aggregate_dashboard(&refreshed, projects.len() as u32);
        write_dashboard(&dashboard).await?;
        return Ok(dashboard);
    }

    // 缓存无效：标记所有项目为脏，让前端触发 refresh
    for project in &projects {
        write_dirty(&project.path).await?;
    }
    read_dashboard().await
}

/// 清理已删除项目的缓存
#[tauri::command]
#[specta::specta]
pub async fn cleanup_stats_cache(current_project_paths: Vec<String>) -> AppResult<()> {
    let all_paths: Vec<String> = sqlx::query_scalar("SELECT project_path FROM project_stats")
        .fetch_all(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("查询 project_stats 失败: {}", e)))?;

    let keep: HashSet<&String> = current_project_paths.iter().collect();
    let pool = pool();
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| crate::error::AppError::from(format!("获取连接失败: {}", e)))?;
    let mut tx = conn
        .begin()
        .await
        .map_err(|e| crate::error::AppError::from(format!("开启事务失败: {}", e)))?;
    for p in &all_paths {
        if !keep.contains(p) {
            sqlx::query("DELETE FROM project_stats WHERE project_path = ?")
                .bind(p)
                .execute(&mut *tx)
                .await
                .map_err(|e| {
                    crate::error::AppError::from(format!("删除 project_stats 失败: {}", e))
                })?;
            sqlx::query("DELETE FROM stats_dirty WHERE project_path = ?")
                .bind(p)
                .execute(&mut *tx)
                .await
                .map_err(|e| {
                    crate::error::AppError::from(format!("删除 stats_dirty 失败: {}", e))
                })?;
        }
    }
    tx.commit()
        .await
        .map_err(|e| crate::error::AppError::from(format!("提交事务失败: {}", e)))?;
    Ok(())
}

#[cfg(test)]
mod commit_parse_tests {
    use super::*;

    /// 提交主题和作者名里含 `|` 时字段不能错位。
    /// 旧实现用 `|` 分隔，`fix: 处理 a|b` + 作者 `作者|带竖线` 会让
    /// 主题、作者、邮箱、日期整体串位，"最近活动"时间也跟着错。
    #[test]
    fn pipe_in_subject_and_author_does_not_shift_fields() {
        let dir = std::env::temp_dir().join(format!("codeshelf-log-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.to_string_lossy().to_string();
        let git = |args: &[&str]| run_git_command(&p, args).unwrap_or_else(|e| panic!("{args:?}: {e:?}"));

        git(&["init", "-q", "."]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "作者|带竖线"]);
        std::fs::write(dir.join("a.txt"), b"x").unwrap();
        git(&["add", "."]);
        git(&["commit", "-qm", "fix: 处理 a|b 的边界情况"]);

        let commits = get_project_commits(&p, 10).expect("应能读取");
        assert_eq!(commits.len(), 1);
        let (hash, short, subject, author, email, date) = &commits[0];

        assert_eq!(subject, "fix: 处理 a|b 的边界情况", "主题被截断了");
        assert_eq!(author, "作者|带竖线", "作者被截断了");
        assert_eq!(email, "t@t", "邮箱字段错位");
        assert!(date.starts_with("20"), "日期字段错位: {date}");
        assert_eq!(hash.len(), 40, "完整 hash 长度不对");
        assert!(hash.starts_with(short.as_str()), "短 hash 与完整 hash 不匹配");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 非 git 仓库必须报错，而不是"0 次提交" —— 后者会覆盖掉上一次正确的缓存。
    #[test]
    fn non_repo_reports_error_not_empty() {
        let dir = std::env::temp_dir().join(format!("codeshelf-nolog-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let r = get_project_commits(&dir.to_string_lossy(), 10);
        assert!(r.is_err(), "非仓库应返回 Err，实际: {r:?}");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
