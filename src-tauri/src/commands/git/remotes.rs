// 远程仓库与同步：remotes / push / pull / fetch / sync_to_remote

use crate::error::AppResult;
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use super::{run_git_command, RemoteInfo};

#[cfg(target_os = "windows")]
use super::CREATE_NO_WINDOW;

#[tauri::command]
#[specta::specta]
pub async fn get_remotes(path: String) -> AppResult<Vec<RemoteInfo>> {
    let output = run_git_command(&path, &["remote", "-v"])?;

    let mut remotes: std::collections::HashMap<String, RemoteInfo> =
        std::collections::HashMap::new();

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
#[specta::specta]
pub async fn add_remote(path: String, name: String, url: String) -> AppResult<()> {
    run_git_command(&path, &["remote", "add", &name, &url])?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn verify_remote_url(url: String) -> AppResult<()> {
    // 使用 git ls-remote 验证远程仓库 URL 是否有效 (hide console window on Windows)
    #[cfg(target_os = "windows")]
    let output = Command::new("git")
        .args(&["ls-remote", "--exit-code", &url])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| crate::error::AppError::from(format!("执行 git 命令失败: {}", e)))?;

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("git")
        .args(["ls-remote", "--exit-code", &url])
        .output()
        .map_err(|e| crate::error::AppError::from(format!("执行 git 命令失败: {}", e)))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(crate::error::AppError::from(format!(
            "无法连接到远程仓库: {}",
            stderr.trim()
        )))
    }
}

#[tauri::command]
#[specta::specta]
pub async fn remove_remote(path: String, name: String) -> AppResult<()> {
    run_git_command(&path, &["remote", "remove", &name])?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn git_push(
    path: String,
    remote: String,
    branch: String,
    force: bool,
) -> AppResult<String> {
    let mut args = vec!["push", &remote, &branch];
    if force {
        args.push("--force");
    }
    run_git_command(&path, &args)
}

#[tauri::command]
#[specta::specta]
pub async fn git_pull(path: String, remote: String, branch: String) -> AppResult<String> {
    run_git_command(&path, &["pull", &remote, &branch])
}

#[tauri::command]
#[specta::specta]
pub async fn git_fetch(path: String, remote: Option<String>) -> AppResult<String> {
    match remote {
        Some(r) => run_git_command(&path, &["fetch", &r]),
        None => run_git_command(&path, &["fetch", "--all"]),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn sync_to_remote(
    path: String,
    source_remote: String,
    target_remote: String,
    sync_all_branches: bool,
    force: bool,
) -> AppResult<String> {
    // First, fetch all branches from source remote to ensure we have latest refs
    run_git_command(&path, &["fetch", &source_remote, "--prune"])?;

    if sync_all_branches {
        // Get the default branch of source remote (HEAD points to)
        let default_branch = run_git_command(
            &path,
            &[
                "symbolic-ref",
                &format!("refs/remotes/{}/HEAD", source_remote),
            ],
        )
        .ok()
        .and_then(|output| {
            // Output is like: refs/remotes/origin/main
            output.trim().split('/').next_back().map(|s| s.to_string())
        });

        // Get all branches from source remote (excluding HEAD)
        let branches_output = run_git_command(&path, &["branch", "-r"])?;
        let mut branches: Vec<String> = branches_output
            .lines()
            .filter_map(|line| {
                let branch = line.trim();
                if branch.starts_with(&format!("{}/", source_remote)) && !branch.contains("HEAD") {
                    Some(
                        branch
                            .trim_start_matches(&format!("{}/", source_remote))
                            .to_string(),
                    )
                } else {
                    None
                }
            })
            .collect();

        if branches.is_empty() {
            return Err(crate::error::AppError::from(
                "No branches found to sync".to_string(),
            ));
        }

        // Sort branches to push default branch first (important for new repos)
        if let Some(ref default_br) = default_branch {
            branches.sort_by(|a, b| {
                if a == default_br {
                    std::cmp::Ordering::Less
                } else if b == default_br {
                    std::cmp::Ordering::Greater
                } else {
                    a.cmp(b)
                }
            });
        }

        // Push each branch using remote tracking ref
        // Use: refs/remotes/origin/branch:refs/heads/branch
        let mut results = Vec::new();
        for branch in &branches {
            let refspec = format!(
                "refs/remotes/{}/{}:refs/heads/{}",
                source_remote, branch, branch
            );
            let mut args = vec!["push", &target_remote, &refspec];
            if force {
                args.push("--force");
            }

            let is_default = default_branch.as_ref() == Some(branch);
            match run_git_command(&path, &args) {
                Ok(_) => {
                    if is_default {
                        results.push(format!("✓ {} (默认分支)", branch));
                    } else {
                        results.push(format!("✓ {}", branch));
                    }
                }
                Err(e) => results.push(format!("✗ {}: {}", branch, e)),
            }
        }

        Ok(format!(
            "同步完成 {} 个分支:\n{}",
            branches.len(),
            results.join("\n")
        ))
    } else {
        // Sync only current branch
        let branch = run_git_command(&path, &["rev-parse", "--abbrev-ref", "HEAD"])?;

        let mut args = vec!["push", &target_remote, &branch];
        if force {
            args.push("--force");
        }

        run_git_command(&path, &args)?;
        Ok(format!(
            "Successfully synced branch '{}' to '{}'",
            branch, target_remote
        ))
    }
}
