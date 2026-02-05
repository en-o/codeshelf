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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub email: String,
    pub date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_changed: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub insertions: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletions: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refs: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_hashes: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitFileChange {
    pub insertions: u32,
    pub deletions: u32,
    pub filename: String,
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

/// 解析分支/标签引用
fn parse_refs(refs_str: &str) -> Option<Vec<String>> {
    let refs_str = refs_str.trim();
    if refs_str.is_empty() {
        return None;
    }

    let refs: Vec<String> = refs_str
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if refs.is_empty() {
        None
    } else {
        Some(refs)
    }
}

/// 解析父提交哈希
fn parse_parent_hashes(hashes_str: &str) -> Option<Vec<String>> {
    let hashes_str = hashes_str.trim();
    if hashes_str.is_empty() {
        return None;
    }

    let hashes: Vec<String> = hashes_str
        .split_whitespace()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if hashes.is_empty() {
        None
    } else {
        Some(hashes)
    }
}

/// 获取单个提交的统计信息
fn get_commit_stats_sync(path: &str, commit_hash: &str) -> Option<(u32, u32, u32)> {
    let args = vec![
        "show",
        "--numstat",
        "--format=",
        commit_hash,
    ];

    let output = run_git_command(path, &args).ok()?;

    let mut files_changed = 0u32;
    let mut insertions = 0u32;
    let mut deletions = 0u32;

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 {
            files_changed += 1;
            // 解析新增行数 (可能是 "-" 表示二进制文件)
            if let Ok(add) = parts[0].parse::<u32>() {
                insertions += add;
            }
            // 解析删除行数
            if let Ok(del) = parts[1].parse::<u32>() {
                deletions += del;
            }
        }
    }

    Some((files_changed, insertions, deletions))
}

#[tauri::command]
pub async fn get_commit_history(path: String, limit: Option<u32>, ref_name: Option<String>) -> Result<Vec<CommitInfo>, String> {
    let limit_str = limit.unwrap_or(50).to_string();

    // 使用 %x1f (Unit Separator) 作为字段分隔符，%x1e (Record Separator) 作为提交分隔符
    // 这样可以避免提交信息中的特殊字符干扰解析
    let format = [
        "%H",   // hash - 完整哈希
        "%h",   // short_hash - 短哈希
        "%s",   // message - 提交标题
        "%an",  // author - 作者名
        "%ae",  // email - 作者邮箱
        "%aI",  // date - ISO 8601 格式日期
        "%b",   // body - 完整提交信息体
        "%D",   // refs - 分支/标签引用
        "%P",   // parent_hashes - 父提交哈希
    ]
    .join("%x1f");

    let mut args = vec![
        "log".to_string(),
        format!("-{}", limit_str),
        format!("--format=%x1e{}", format),
    ];

    // 如果指定了 ref_name（如 origin/main），则获取该引用的提交历史
    if let Some(ref_name) = ref_name {
        args.push(ref_name);
    }

    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = run_git_command(&path, &args_ref)?;

    // 解析提交信息
    let commits: Vec<CommitInfo> = output
        .split('\x1e')
        .filter(|s| !s.trim().is_empty())
        .filter_map(|record| {
            let parts: Vec<&str> = record.split('\x1f').collect();
            if parts.len() >= 9 {
                let hash = parts[0].trim().to_string();

                // 获取统计信息
                let stats = get_commit_stats_sync(&path, &hash);

                Some(CommitInfo {
                    hash,
                    short_hash: parts[1].trim().to_string(),
                    message: parts[2].trim().to_string(),
                    author: parts[3].trim().to_string(),
                    email: parts[4].trim().to_string(),
                    date: parts[5].trim().to_string(),
                    body: {
                        let body = parts[6].trim();
                        if body.is_empty() {
                            None
                        } else {
                            Some(body.to_string())
                        }
                    },
                    refs: parse_refs(parts[7]),
                    parent_hashes: parse_parent_hashes(parts[8]),
                    files_changed: stats.map(|s| s.0),
                    insertions: stats.map(|s| s.1),
                    deletions: stats.map(|s| s.2),
                })
            } else {
                None
            }
        })
        .collect();

    Ok(commits)
}

/// 获取单个提交的详细信息（用于按需加载）
#[tauri::command]
pub async fn get_commit_detail(path: String, commit_hash: String) -> Result<CommitInfo, String> {
    let format = [
        "%H", "%h", "%s", "%an", "%ae", "%aI", "%b", "%D", "%P",
    ]
    .join("%x1f");

    let args = vec!["show", "--format", &format, "-s", &commit_hash];
    let output = run_git_command(&path, &args)?;

    let parts: Vec<&str> = output.trim().split('\x1f').collect();
    if parts.len() < 9 {
        return Err("Invalid commit format".to_string());
    }

    let stats = get_commit_stats_sync(&path, &commit_hash);

    Ok(CommitInfo {
        hash: parts[0].trim().to_string(),
        short_hash: parts[1].trim().to_string(),
        message: parts[2].trim().to_string(),
        author: parts[3].trim().to_string(),
        email: parts[4].trim().to_string(),
        date: parts[5].trim().to_string(),
        body: {
            let body = parts[6].trim();
            if body.is_empty() {
                None
            } else {
                Some(body.to_string())
            }
        },
        refs: parse_refs(parts[7]),
        parent_hashes: parse_parent_hashes(parts[8]),
        files_changed: stats.map(|s| s.0),
        insertions: stats.map(|s| s.1),
        deletions: stats.map(|s| s.2),
    })
}

/// 获取提交的文件变更列表
#[tauri::command]
pub async fn get_commit_files(
    path: String,
    commit_hash: String,
) -> Result<Vec<CommitFileChange>, String> {
    let args = vec![
        "show",
        "--numstat",
        "--format=",
        commit_hash.as_str(),
    ];

    let output = run_git_command(&path, &args)?;

    let files: Vec<CommitFileChange> = output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }

            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 3 {
                Some(CommitFileChange {
                    insertions: parts[0].parse().unwrap_or(0),
                    deletions: parts[1].parse().unwrap_or(0),
                    filename: parts[2..].join("\t"),
                })
            } else {
                None
            }
        })
        .collect();

    Ok(files)
}

/// 搜索提交历史
#[tauri::command]
pub async fn search_commits(
    path: String,
    query: String,
    search_type: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<CommitInfo>, String> {
    let limit_str = limit.unwrap_or(50).to_string();
    let format = [
        "%H", "%h", "%s", "%an", "%ae", "%aI", "%b", "%D", "%P",
    ]
    .join("%x1f");

    let mut args = vec![
        "log".to_string(),
        format!("-{}", limit_str),
        format!("--format=%x1e{}", format),
    ];

    // 根据搜索类型添加参数
    match search_type.as_deref() {
        Some("author") => {
            args.push(format!("--author={}", query));
        }
        Some("message") => {
            args.push(format!("--grep={}", query));
        }
        Some("hash") => {
            // 直接查找特定提交
            return get_commit_detail(path, query).await.map(|c| vec![c]);
        }
        _ => {
            // 默认搜索提交信息
            args.push(format!("--grep={}", query));
        }
    }

    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = run_git_command(&path, &args_ref)?;

    let commits: Vec<CommitInfo> = output
        .split('\x1e')
        .filter(|s| !s.trim().is_empty())
        .filter_map(|record| {
            let parts: Vec<&str> = record.split('\x1f').collect();
            if parts.len() >= 9 {
                Some(CommitInfo {
                    hash: parts[0].trim().to_string(),
                    short_hash: parts[1].trim().to_string(),
                    message: parts[2].trim().to_string(),
                    author: parts[3].trim().to_string(),
                    email: parts[4].trim().to_string(),
                    date: parts[5].trim().to_string(),
                    body: {
                        let body = parts[6].trim();
                        if body.is_empty() {
                            None
                        } else {
                            Some(body.to_string())
                        }
                    },
                    refs: parse_refs(parts[7]),
                    parent_hashes: parse_parent_hashes(parts[8]),
                    files_changed: None,
                    insertions: None,
                    deletions: None,
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
