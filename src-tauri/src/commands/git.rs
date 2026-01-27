use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: String,
    pub is_clean: bool,
    pub staged: Vec<String>,
    pub unstaged: Vec<String>,
    pub untracked: Vec<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub email: String,
    pub date: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
    pub fetch_url: Option<String>,
    pub push_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitRepo {
    pub path: String,
    pub name: String,
}

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

#[tauri::command]
pub async fn scan_directory(path: String, depth: Option<u32>) -> Result<Vec<GitRepo>, String> {
    let mut repos = Vec::new();
    let scan_depth = depth.unwrap_or(3);
    scan_for_repos(&path, &mut repos, scan_depth)?;
    Ok(repos)
}

fn scan_for_repos(path: &str, repos: &mut Vec<GitRepo>, depth: u32) -> Result<(), String> {
    if depth == 0 {
        return Ok(());
    }

    let entries = std::fs::read_dir(path).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let entry_path = entry.path();
        if entry_path.is_dir() {
            let dir_name = entry_path.file_name().unwrap().to_string_lossy().to_string();

            // Skip hidden directories except .git
            if dir_name.starts_with('.') && dir_name != ".git" {
                continue;
            }

            if dir_name == ".git" {
                // Found a git repo, add the parent directory
                if let Some(parent) = entry_path.parent() {
                    let repo_name = parent
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| "Unknown".to_string());
                    repos.push(GitRepo {
                        path: parent.to_string_lossy().to_string(),
                        name: repo_name,
                    });
                }
            } else {
                // Continue scanning subdirectories
                scan_for_repos(&entry_path.to_string_lossy(), repos, depth - 1)?;
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn get_git_status(path: String) -> Result<GitStatus, String> {
    // Get current branch
    let branch = run_git_command(&path, &["rev-parse", "--abbrev-ref", "HEAD"])
        .unwrap_or_else(|_| "unknown".to_string());

    // Get status
    let status_output = run_git_command(&path, &["status", "--porcelain"])?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();

    for line in status_output.lines() {
        if line.len() < 3 {
            continue;
        }
        let status = &line[0..2];
        let file = line[3..].to_string();

        match status.chars().next() {
            Some('?') => untracked.push(file),
            Some(' ') => unstaged.push(file),
            Some(_) => {
                if status.chars().nth(1) == Some(' ') {
                    staged.push(file);
                } else {
                    staged.push(file.clone());
                    unstaged.push(file);
                }
            }
            None => {}
        }
    }

    // Get ahead/behind
    let (ahead, behind) = get_ahead_behind(&path);

    Ok(GitStatus {
        branch,
        is_clean: staged.is_empty() && unstaged.is_empty() && untracked.is_empty(),
        staged,
        unstaged,
        untracked,
        ahead,
        behind,
    })
}

fn get_ahead_behind(path: &str) -> (u32, u32) {
    let output = run_git_command(path, &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);

    if let Ok(result) = output {
        let parts: Vec<&str> = result.split_whitespace().collect();
        if parts.len() == 2 {
            let ahead = parts[0].parse().unwrap_or(0);
            let behind = parts[1].parse().unwrap_or(0);
            return (ahead, behind);
        }
    }
    (0, 0)
}

#[tauri::command]
pub async fn get_commit_history(path: String, limit: Option<u32>) -> Result<Vec<CommitInfo>, String> {
    let limit_str = limit.unwrap_or(50).to_string();
    let format = "%H|%h|%s|%an|%ae|%ai";

    let output = run_git_command(&path, &["log", &format!("-{}", limit_str), &format!("--format={}", format)])?;

    let commits: Vec<CommitInfo> = output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('|').collect();
            if parts.len() >= 6 {
                Some(CommitInfo {
                    hash: parts[0].to_string(),
                    short_hash: parts[1].to_string(),
                    message: parts[2].to_string(),
                    author: parts[3].to_string(),
                    email: parts[4].to_string(),
                    date: parts[5].to_string(),
                })
            } else {
                None
            }
        })
        .collect();

    Ok(commits)
}

#[tauri::command]
pub async fn get_branches(path: String) -> Result<Vec<BranchInfo>, String> {
    let output = run_git_command(&path, &["branch", "-a", "-vv"])?;

    let branches: Vec<BranchInfo> = output
        .lines()
        .map(|line| {
            let is_current = line.starts_with('*');
            let line = line.trim_start_matches(['*', ' '].as_ref());
            let parts: Vec<&str> = line.split_whitespace().collect();

            let name = parts.first().unwrap_or(&"").to_string();
            let is_remote = name.starts_with("remotes/");

            // Extract upstream from [origin/branch] format
            let upstream = line
                .find('[')
                .and_then(|start| {
                    line[start..].find(']').map(|end| {
                        line[start + 1..start + end].split(':').next().unwrap_or("").to_string()
                    })
                });

            BranchInfo {
                name: name.trim_start_matches("remotes/").to_string(),
                is_current,
                is_remote,
                upstream,
            }
        })
        .collect();

    Ok(branches)
}

#[tauri::command]
pub async fn get_remotes(path: String) -> Result<Vec<RemoteInfo>, String> {
    let output = run_git_command(&path, &["remote", "-v"])?;

    let mut remotes: std::collections::HashMap<String, RemoteInfo> = std::collections::HashMap::new();

    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            let name = parts[0].to_string();
            let url = parts[1].to_string();
            let remote_type = parts.get(2).unwrap_or(&"");

            let entry = remotes.entry(name.clone()).or_insert(RemoteInfo {
                name,
                url: url.clone(),
                fetch_url: None,
                push_url: None,
            });

            if remote_type.contains("fetch") {
                entry.fetch_url = Some(url);
            } else if remote_type.contains("push") {
                entry.push_url = Some(url);
            }
        }
    }

    Ok(remotes.into_values().collect())
}

#[tauri::command]
pub async fn add_remote(path: String, name: String, url: String) -> Result<(), String> {
    run_git_command(&path, &["remote", "add", &name, &url])?;
    Ok(())
}

#[tauri::command]
pub async fn remove_remote(path: String, name: String) -> Result<(), String> {
    run_git_command(&path, &["remote", "remove", &name])?;
    Ok(())
}

#[tauri::command]
pub async fn git_push(path: String, remote: String, branch: String, force: bool) -> Result<String, String> {
    let mut args = vec!["push", &remote, &branch];
    if force {
        args.push("--force");
    }
    run_git_command(&path, &args)
}

#[tauri::command]
pub async fn git_pull(path: String, remote: String, branch: String) -> Result<String, String> {
    run_git_command(&path, &["pull", &remote, &branch])
}

#[tauri::command]
pub async fn git_fetch(path: String, remote: Option<String>) -> Result<String, String> {
    match remote {
        Some(r) => run_git_command(&path, &["fetch", &r]),
        None => run_git_command(&path, &["fetch", "--all"]),
    }
}
