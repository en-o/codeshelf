use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use tokio::task;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// Windows: CREATE_NO_WINDOW flag to hide console window
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DashboardStats {
    pub total_projects: u32,
    pub today_commits: u32,
    pub week_commits: u32,
    pub unpushed_commits: u32,
    pub unmerged_branches: u32,
    pub last_updated: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyActivity {
    pub date: String,
    pub count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
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

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CachedDashboardData {
    pub stats: DashboardStats,
    pub heatmap_data: Vec<DailyActivity>,
    pub recent_commits: Vec<RecentCommit>,
}

/// 持久化的统计缓存结构
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct PersistedStatsCache {
    pub data: CachedDashboardData,
    pub last_updated: i64,  // Unix 时间戳
    pub dirty_projects: HashSet<String>,  // 需要重新统计的项目路径
    /// 每个项目的统计数据缓存
    pub project_stats: HashMap<String, ProjectStatsCache>,
}

/// 单个项目的统计缓存
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ProjectStatsCache {
    pub unpushed: u32,
    pub commits_by_date: HashMap<String, u32>,
    pub recent_commits: Vec<RecentCommit>,
    pub last_updated: i64,
}

// Global stats cache (内存缓存)
static STATS_CACHE: Lazy<Mutex<PersistedStatsCache>> = Lazy::new(|| {
    // 启动时从文件加载
    let cache = load_stats_from_file().unwrap_or_default();
    Mutex::new(cache)
});

/// 获取统计缓存文件路径
fn get_stats_cache_path() -> PathBuf {
    let mut path = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("codeshelf");
    let _ = fs::create_dir_all(&path);
    path.push("stats_cache.json");
    path
}

/// 从文件加载统计缓存
fn load_stats_from_file() -> Result<PersistedStatsCache, String> {
    let path = get_stats_cache_path();
    if !path.exists() {
        return Ok(PersistedStatsCache::default());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read stats cache: {}", e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse stats cache: {}", e))
}

/// 保存统计缓存到文件
fn save_stats_to_file(cache: &PersistedStatsCache) -> Result<(), String> {
    let path = get_stats_cache_path();
    let content = serde_json::to_string_pretty(cache)
        .map_err(|e| format!("Failed to serialize stats: {}", e))?;

    fs::write(&path, content)
        .map_err(|e| format!("Failed to write stats cache: {}", e))?;

    Ok(())
}

fn run_git_command(path: &str, args: &[&str]) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    let output = Command::new("git")
        .args(["-C", path])
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("git")
        .args(["-C", path])
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
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

// Get commit history for a project (last year for heatmap)
fn get_project_commits(path: &str, limit: u32) -> Vec<(String, String, String, String, String, String)> {
    let format = "%H|%h|%s|%an|%ae|%ai";
    let output = run_git_command(path, &["log", &format!("-{}", limit), &format!("--format={}", format)]);

    match output {
        Ok(result) => {
            result
                .lines()
                .filter_map(|line| {
                    let parts: Vec<&str> = line.split('|').collect();
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
                .collect()
        }
        Err(_) => Vec::new(),
    }
}

// Get unpushed commit count
fn get_unpushed_count(path: &str) -> u32 {
    let output = run_git_command(path, &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);

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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectInfo {
    pub id: Option<String>,
    pub name: String,
    pub path: String,
}

/// 分析单个项目
fn analyze_project(name: String, path: String) -> ProjectStatsCache {
    let unpushed = get_unpushed_count(&path);
    let commits = get_project_commits(&path, 365);

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

    ProjectStatsCache {
        unpushed,
        commits_by_date,
        recent_commits,
        last_updated: get_current_timestamp(),
    }
}

/// 从项目缓存聚合生成 Dashboard 数据
fn aggregate_dashboard_data(
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
    let week_commits: u32 = week_dates.iter()
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

/// 标记项目为脏数据（需要重新统计）
#[tauri::command]
pub async fn mark_project_dirty(project_path: String) -> Result<(), String> {
    let mut cache = STATS_CACHE.lock().map_err(|e| e.to_string())?;
    cache.dirty_projects.insert(project_path);
    // 不立即保存，等刷新时再保存
    Ok(())
}

/// 标记所有项目为脏数据
#[tauri::command]
pub async fn mark_all_projects_dirty(projects: Vec<ProjectInfo>) -> Result<(), String> {
    let mut cache = STATS_CACHE.lock().map_err(|e| e.to_string())?;
    for project in projects {
        cache.dirty_projects.insert(project.path);
    }
    Ok(())
}

/// 检查是否有脏数据
#[tauri::command]
pub async fn has_dirty_stats() -> Result<bool, String> {
    let cache = STATS_CACHE.lock().map_err(|e| e.to_string())?;
    Ok(!cache.dirty_projects.is_empty())
}

/// 获取缓存的统计数据（快速，不执行 Git 操作）
#[tauri::command]
pub async fn get_dashboard_stats() -> Result<CachedDashboardData, String> {
    let cache = STATS_CACHE.lock().map_err(|e| e.to_string())?;
    Ok(cache.data.clone())
}

/// 只刷新脏项目的统计数据（增量更新）
#[tauri::command]
pub async fn refresh_dirty_stats(projects: Vec<ProjectInfo>) -> Result<CachedDashboardData, String> {
    // 获取脏项目列表
    let dirty_paths: Vec<String> = {
        let cache = STATS_CACHE.lock().map_err(|e| e.to_string())?;
        cache.dirty_projects.iter().cloned().collect()
    };

    if dirty_paths.is_empty() {
        // 没有脏数据，直接返回缓存
        let cache = STATS_CACHE.lock().map_err(|e| e.to_string())?;
        return Ok(cache.data.clone());
    }

    // 找出需要更新的项目
    let projects_to_update: Vec<ProjectInfo> = projects
        .iter()
        .filter(|p| dirty_paths.contains(&p.path))
        .cloned()
        .collect();

    if projects_to_update.is_empty() {
        let cache = STATS_CACHE.lock().map_err(|e| e.to_string())?;
        return Ok(cache.data.clone());
    }

    // 并行分析脏项目
    let mut handles = Vec::new();
    for project in projects_to_update {
        let name = project.name.clone();
        let path = project.path.clone();
        let handle = task::spawn_blocking(move || (path.clone(), analyze_project(name, path)));
        handles.push(handle);
    }

    // 收集结果
    let mut new_stats: HashMap<String, ProjectStatsCache> = HashMap::new();
    for handle in handles {
        if let Ok((path, stats)) = handle.await {
            new_stats.insert(path, stats);
        }
    }

    // 更新缓存
    let cached_data = {
        let mut cache = STATS_CACHE.lock().map_err(|e| e.to_string())?;

        // 合并新统计到现有缓存
        for (path, stats) in new_stats {
            cache.project_stats.insert(path.clone(), stats);
            cache.dirty_projects.remove(&path);
        }

        // 重新聚合 Dashboard 数据
        cache.data = aggregate_dashboard_data(&cache.project_stats, projects.len() as u32);
        cache.last_updated = get_current_timestamp();

        // 保存到文件
        let _ = save_stats_to_file(&cache);

        cache.data.clone()
    };

    Ok(cached_data)
}

/// 完整刷新所有项目统计（首次加载或手动刷新）
#[tauri::command]
pub async fn refresh_dashboard_stats(projects: Vec<ProjectInfo>) -> Result<CachedDashboardData, String> {
    let total_projects = projects.len() as u32;

    if total_projects == 0 {
        let cached_data = CachedDashboardData::default();
        let mut cache = STATS_CACHE.lock().map_err(|e| e.to_string())?;
        cache.data = cached_data.clone();
        cache.project_stats.clear();
        cache.dirty_projects.clear();
        let _ = save_stats_to_file(&cache);
        return Ok(cached_data);
    }

    // 并行分析所有项目
    let mut handles = Vec::new();
    for project in &projects {
        let name = project.name.clone();
        let path = project.path.clone();
        let handle = task::spawn_blocking(move || (path.clone(), analyze_project(name, path)));
        handles.push(handle);
    }

    // 收集结果
    let mut project_stats: HashMap<String, ProjectStatsCache> = HashMap::new();
    for handle in handles {
        if let Ok((path, stats)) = handle.await {
            project_stats.insert(path, stats);
        }
    }

    // 聚合数据
    let cached_data = aggregate_dashboard_data(&project_stats, total_projects);

    // 更新缓存
    {
        let mut cache = STATS_CACHE.lock().map_err(|e| e.to_string())?;
        cache.data = cached_data.clone();
        cache.project_stats = project_stats;
        cache.dirty_projects.clear();
        cache.last_updated = get_current_timestamp();

        // 保存到文件
        let _ = save_stats_to_file(&cache);
    }

    Ok(cached_data)
}

/// 初始化统计缓存（应用启动时调用）
/// 如果文件缓存存在且有效，直接使用；否则标记所有项目为脏
#[tauri::command]
pub async fn init_stats_cache(projects: Vec<ProjectInfo>) -> Result<CachedDashboardData, String> {
    let mut cache = STATS_CACHE.lock().map_err(|e| e.to_string())?;

    // 如果缓存有数据且不是太旧（24小时内），直接返回
    let now = get_current_timestamp();
    let cache_age = now - cache.last_updated;
    let has_valid_cache = cache.last_updated > 0
        && cache_age < 86400  // 24 小时
        && !cache.project_stats.is_empty();

    if has_valid_cache {
        // 检查项目列表是否变化
        let cached_paths: HashSet<_> = cache.project_stats.keys().cloned().collect();
        let current_paths: HashSet<_> = projects.iter().map(|p| p.path.clone()).collect();

        // 新增的项目标记为脏
        for path in current_paths.difference(&cached_paths) {
            cache.dirty_projects.insert(path.clone());
        }

        // 删除的项目从缓存移除
        for path in cached_paths.difference(&current_paths) {
            cache.project_stats.remove(path);
        }

        // 重新聚合（项目数可能变化）
        cache.data = aggregate_dashboard_data(&cache.project_stats, projects.len() as u32);

        return Ok(cache.data.clone());
    }

    // 缓存无效，标记所有项目为脏，但先返回空数据让 UI 快速显示
    for project in &projects {
        cache.dirty_projects.insert(project.path.clone());
    }

    // 返回空数据或旧数据，让 UI 先显示
    Ok(cache.data.clone())
}

/// 清理已删除项目的缓存
#[tauri::command]
pub async fn cleanup_stats_cache(current_project_paths: Vec<String>) -> Result<(), String> {
    let mut cache = STATS_CACHE.lock().map_err(|e| e.to_string())?;

    let paths_set: HashSet<_> = current_project_paths.into_iter().collect();

    // 移除不存在的项目
    cache.project_stats.retain(|path, _| paths_set.contains(path));
    cache.dirty_projects.retain(|path| paths_set.contains(path));

    let _ = save_stats_to_file(&cache);
    Ok(())
}
