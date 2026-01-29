use serde::{Deserialize, Serialize};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// Windows: CREATE_NO_WINDOW flag to hide console window
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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

/// 解析 git status --porcelain 输出中的文件路径
/// 处理引号包裹的路径（包含空格或特殊字符时）
fn unquote_git_path(path: &str) -> String {
    let path = path.trim();
    if path.starts_with('"') && path.ends_with('"') && path.len() >= 2 {
        // 去除引号并处理转义字符
        let inner = &path[1..path.len()-1];
        inner
            .replace("\\n", "\n")
            .replace("\\t", "\t")
            .replace("\\\\", "\\")
            .replace("\\\"", "\"")
    } else {
        path.to_string()
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

    // Get status with -uall to show all untracked files recursively
    let status_output = run_git_command(&path, &["status", "--porcelain", "-uall"])?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();

    for line in status_output.lines() {
        if line.len() < 3 {
            continue;
        }
        let status = &line[0..2];
        // 跳过状态码后的所有空白字符，更稳健地获取文件路径
        let file_part = line[2..].trim_start();
        let file = unquote_git_path(file_part);

        if file.is_empty() {
            continue;
        }

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
pub async fn get_commit_history(path: String, limit: Option<u32>, ref_name: Option<String>) -> Result<Vec<CommitInfo>, String> {
    let limit_str = limit.unwrap_or(50).to_string();
    let format = "%H|%h|%s|%an|%ae|%ai";

    let mut args = vec!["log".to_string(), format!("-{}", limit_str), format!("--format={}", format)];

    // 如果指定了 ref_name（如 origin/main），则获取该引用的提交历史
    if let Some(ref_name) = ref_name {
        args.push(ref_name);
    }

    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = run_git_command(&path, &args_ref)?;

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
pub async fn verify_remote_url(url: String) -> Result<(), String> {
    // 使用 git ls-remote 验证远程仓库 URL 是否有效 (hide console window on Windows)
    #[cfg(target_os = "windows")]
    let output = std::process::Command::new("git")
        .args(&["ls-remote", "--exit-code", &url])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("执行 git 命令失败: {}", e))?;

    #[cfg(not(target_os = "windows"))]
    let output = std::process::Command::new("git")
        .args(&["ls-remote", "--exit-code", &url])
        .output()
        .map_err(|e| format!("执行 git 命令失败: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("无法连接到远程仓库: {}", stderr.trim()))
    }
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

#[tauri::command]
pub async fn git_clone(url: String, target_dir: String, repo_name: String) -> Result<String, String> {
    use std::path::PathBuf;

    let target_path = PathBuf::from(&target_dir).join(&repo_name);
    let target_path_str = target_path.to_string_lossy().to_string();

    // Check if directory already exists
    if target_path.exists() {
        return Err(format!("Directory '{}' already exists", repo_name));
    }

    // Clone the repository (hide console window on Windows)
    #[cfg(target_os = "windows")]
    let output = Command::new("git")
        .args(&["clone", &url, &target_path_str])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed to execute git clone: {}", e))?;

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("git")
        .args(&["clone", &url, &target_path_str])
        .output()
        .map_err(|e| format!("Failed to execute git clone: {}", e))?;

    if output.status.success() {
        Ok(target_path_str)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
pub async fn sync_to_remote(
    path: String,
    source_remote: String,
    target_remote: String,
    sync_all_branches: bool,
    force: bool,
) -> Result<String, String> {
    // First, fetch from source remote to ensure we have latest refs
    run_git_command(&path, &["fetch", &source_remote])?;

    if sync_all_branches {
        // Get all branches from source remote
        let branches_output = run_git_command(&path, &["branch", "-r"])?;
        let branches: Vec<String> = branches_output
            .lines()
            .filter_map(|line| {
                let branch = line.trim();
                if branch.starts_with(&format!("{}/", source_remote)) && !branch.contains("HEAD") {
                    Some(branch.trim_start_matches(&format!("{}/", source_remote)).to_string())
                } else {
                    None
                }
            })
            .collect();

        if branches.is_empty() {
            return Err("No branches found to sync".to_string());
        }

        // Push each branch to target remote
        let mut results = Vec::new();
        for branch in branches {
            let branch_spec = format!("{}:{}", branch, branch);
            let mut args = vec!["push", &target_remote, &branch_spec];
            if force {
                args.push("--force");
            }

            match run_git_command(&path, &args) {
                Ok(_) => results.push(format!("✓ {}", branch)),
                Err(e) => results.push(format!("✗ {}: {}", branch, e)),
            }
        }

        Ok(results.join("\n"))
    } else {
        // Sync only current branch
        let branch = run_git_command(&path, &["rev-parse", "--abbrev-ref", "HEAD"])?;

        let mut args = vec!["push", &target_remote, &branch];
        if force {
            args.push("--force");
        }

        run_git_command(&path, &args)?;
        Ok(format!("Successfully synced branch '{}' to '{}'", branch, target_remote))
    }
}

#[tauri::command]
pub async fn checkout_branch(path: String, branch: String) -> Result<String, String> {
    run_git_command(&path, &["checkout", &branch])
}

#[tauri::command]
pub async fn create_branch(path: String, branch: String, checkout: bool) -> Result<String, String> {
    if checkout {
        // Create and checkout the new branch
        run_git_command(&path, &["checkout", "-b", &branch])
    } else {
        // Just create the branch without checking out
        run_git_command(&path, &["branch", &branch])
    }
}

#[tauri::command]
pub async fn git_add(path: String, files: Vec<String>) -> Result<String, String> {
    if files.is_empty() {
        // Add all changes
        run_git_command(&path, &["add", "-A"])
    } else {
        // Add specific files
        let mut args = vec!["add"];
        args.extend(files.iter().map(|s| s.as_str()));
        run_git_command(&path, &args)
    }
}

#[tauri::command]
pub async fn git_unstage(path: String, files: Vec<String>) -> Result<String, String> {
    if files.is_empty() {
        run_git_command(&path, &["reset", "HEAD"])
    } else {
        let mut args = vec!["reset", "HEAD", "--"];
        args.extend(files.iter().map(|s| s.as_str()));
        run_git_command(&path, &args)
    }
}

#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("提交信息不能为空".to_string());
    }
    run_git_command(&path, &["commit", "-m", &message])
}

#[tauri::command]
pub async fn git_add_and_commit(path: String, files: Vec<String>, message: String) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("提交信息不能为空".to_string());
    }

    // First add files
    git_add(path.clone(), files).await?;

    // Then commit
    git_commit(path, message).await
}

#[tauri::command]
pub async fn is_git_repo(path: String) -> Result<bool, String> {
    let git_dir = std::path::Path::new(&path).join(".git");
    Ok(git_dir.exists())
}

#[tauri::command]
pub async fn git_init(path: String) -> Result<String, String> {
    run_git_command(&path, &["init"])
}
