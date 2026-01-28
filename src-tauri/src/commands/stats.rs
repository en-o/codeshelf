use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use std::sync::Mutex;
use once_cell::sync::Lazy;

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

// Global stats cache
static DASHBOARD_CACHE: Lazy<Mutex<CachedDashboardData>> = Lazy::new(|| Mutex::new(CachedDashboardData::default()));

fn run_git_command(path: &str, args: &[&str]) -> Result<String, String> {
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
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    chrono::DateTime::from_timestamp(duration.as_secs() as i64, 0)
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|| format!("{}", duration.as_secs()))
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
                            parts[0].to_string(), // hash
                            parts[1].to_string(), // short_hash
                            parts[2].to_string(), // message
                            parts[3].to_string(), // author
                            parts[4].to_string(), // email
                            parts[5].to_string(), // date
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
            if parts.len() >= 1 {
                parts[0].parse().unwrap_or(0)
            } else {
                0
            }
        }
        Err(_) => 0,
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
}

/// Refresh dashboard stats for all projects
#[tauri::command]
pub async fn refresh_dashboard_stats(projects: Vec<ProjectInfo>) -> Result<CachedDashboardData, String> {
    let total_projects = projects.len() as u32;
    let mut unpushed_commits = 0u32;
    let mut commits_by_date: HashMap<String, u32> = HashMap::new();
    let mut all_recent_commits: Vec<RecentCommit> = Vec::new();

    let today = get_today_date();
    let week_dates = get_dates_in_last_week();

    for project in &projects {
        // Get unpushed count
        unpushed_commits += get_unpushed_count(&project.path);

        // Get commit history (last 365 for heatmap)
        let commits = get_project_commits(&project.path, 365);

        for (hash, short_hash, message, author, email, date) in commits {
            // Extract date part (YYYY-MM-DD)
            let commit_date = date.split_whitespace().next().unwrap_or(&date).to_string();

            // Update commits by date
            *commits_by_date.entry(commit_date.clone()).or_insert(0) += 1;

            // Collect recent commits (first 5 per project)
            if all_recent_commits.iter().filter(|c| c.project_path == project.path).count() < 5 {
                all_recent_commits.push(RecentCommit {
                    hash,
                    short_hash,
                    message,
                    author,
                    email,
                    date,
                    project_name: project.name.clone(),
                    project_path: project.path.clone(),
                });
            }
        }
    }

    // Calculate today's commits
    let today_commits = *commits_by_date.get(&today).unwrap_or(&0);

    // Calculate week's commits
    let week_commits: u32 = week_dates.iter()
        .map(|d| *commits_by_date.get(d).unwrap_or(&0))
        .sum();

    // Build heatmap data
    let heatmap_data: Vec<DailyActivity> = commits_by_date
        .into_iter()
        .map(|(date, count)| DailyActivity { date, count })
        .collect();

    // Sort and limit recent commits
    all_recent_commits.sort_by(|a, b| b.date.cmp(&a.date));
    let recent_commits: Vec<RecentCommit> = all_recent_commits.into_iter().take(10).collect();

    let cached_data = CachedDashboardData {
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
    };

    // Update cache
    if let Ok(mut cache) = DASHBOARD_CACHE.lock() {
        *cache = cached_data.clone();
    }

    Ok(cached_data)
}

/// Get cached dashboard stats (fast, no git operations)
#[tauri::command]
pub async fn get_dashboard_stats() -> Result<CachedDashboardData, String> {
    let cache = DASHBOARD_CACHE.lock().map_err(|e| e.to_string())?;
    Ok(cache.clone())
}

/// Refresh stats for a single project (after git operations)
#[tauri::command]
pub async fn refresh_project_stats(project: ProjectInfo, all_projects: Vec<ProjectInfo>) -> Result<CachedDashboardData, String> {
    // For simplicity, just refresh all stats
    // In a more optimized version, we could update only the affected project's data
    refresh_dashboard_stats(all_projects).await
}
