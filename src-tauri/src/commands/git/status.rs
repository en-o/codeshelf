// 工作区状态与冲突处理：get_git_status / 冲突相关命令

use super::{
    is_system_junk_file, run_git_command, unquote_git_path, ConflictFileContent, GitStatus,
};
use crate::error::AppResult;

#[tauri::command]
#[specta::specta]
pub async fn get_git_status(path: String) -> AppResult<GitStatus> {
    // Get current branch
    let branch = run_git_command(&path, &["rev-parse", "--abbrev-ref", "HEAD"])
        .unwrap_or_else(|_| "unknown".to_string());

    // Get status with -uall to show all untracked files recursively
    let status_output = run_git_command(&path, &["status", "--porcelain", "-uall"])?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();
    let mut conflicted = Vec::new();

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

        if is_system_junk_file(&file) {
            continue;
        }

        if status.contains('U') || matches!(status, "AA" | "DD") {
            conflicted.push(file);
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
    let (upstream_remote, upstream_branch) = get_upstream(&path);

    Ok(GitStatus {
        branch,
        is_clean: staged.is_empty()
            && unstaged.is_empty()
            && untracked.is_empty()
            && conflicted.is_empty(),
        staged,
        unstaged,
        untracked,
        conflicted,
        ahead,
        behind,
        upstream_remote,
        upstream_branch,
    })
}

/// 当前分支的 upstream，拆成 (remote, branch)。
///
/// `@{upstream}` 就是 ahead/behind 的基准。把它显式返回，界面才能保证
/// 「统计的目标」和「push/pull 的目标」一致，而不是拿 remotes 列表的第一项当默认。
///
/// 用 `rev-parse --abbrev-ref @{upstream}` 拿到 `origin/main` 这样的短名，
/// 再按已配置的 remote 名做**最长前缀**匹配 —— 不能简单按第一个 `/` 切，
/// 分支名里带斜杠（`feature/x`）时会切错。
fn get_upstream(path: &str) -> (Option<String>, Option<String>) {
    let full = match run_git_command(path, &["rev-parse", "--abbrev-ref", "@{upstream}"]) {
        Ok(s) => s.trim().to_string(),
        // 没设置 upstream 时 git 直接报错，这是正常状态
        Err(_) => return (None, None),
    };
    if full.is_empty() {
        return (None, None);
    }

    let remotes = run_git_command(path, &["remote"]).unwrap_or_default();
    let mut candidates: Vec<&str> = remotes.lines().map(str::trim).filter(|s| !s.is_empty()).collect();
    // 最长的 remote 名优先，避免 `origin` 抢先匹配掉 `origin-mirror`
    candidates.sort_by_key(|b| std::cmp::Reverse(b.len()));

    for r in candidates {
        if let Some(rest) = full.strip_prefix(&format!("{}/", r)) {
            return (Some(r.to_string()), Some(rest.to_string()));
        }
    }
    // remote 名对不上（配置异常）：至少把原始值报出来，别静默丢掉
    (None, Some(full))
}

fn get_ahead_behind(path: &str) -> (u32, u32) {
    let output = run_git_command(
        path,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    );

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

fn git_show_stage(path: &str, stage: &str, file: &str) -> Option<String> {
    run_git_command(path, &["show", &format!(":{}:{}", stage, file)]).ok()
}

#[tauri::command]
#[specta::specta]
pub async fn get_conflict_file_content(
    path: String,
    file: String,
) -> AppResult<ConflictFileContent> {
    let worktree = std::fs::read_to_string(std::path::Path::new(&path).join(&file)).ok();
    Ok(ConflictFileContent {
        file: file.clone(),
        base: git_show_stage(&path, "1", &file),
        current: git_show_stage(&path, "2", &file),
        incoming: git_show_stage(&path, "3", &file),
        worktree,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn git_checkout_conflict_version(
    path: String,
    file: String,
    version: String,
) -> AppResult<String> {
    match version.as_str() {
        "ours" => run_git_command(&path, &["checkout", "--ours", "--", &file])?,
        "theirs" => run_git_command(&path, &["checkout", "--theirs", "--", &file])?,
        _ => {
            return Err(crate::error::AppError::from(
                "version 必须是 ours 或 theirs".to_string(),
            ))
        }
    };
    run_git_command(&path, &["add", "--", &file])
}

#[tauri::command]
#[specta::specta]
pub async fn git_mark_resolved(path: String, file: String) -> AppResult<String> {
    run_git_command(&path, &["add", "--", &file])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 造一个带多个 remote 的真实仓库，验证 upstream 解析。
    /// 重点是分支名里带斜杠的情况 —— 按第一个 `/` 切会把 `feature/x` 切成 `feature`。
    #[test]
    fn upstream_is_split_on_remote_name_not_first_slash() {
        let dir = std::env::temp_dir().join(format!("codeshelf-up-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.to_string_lossy().to_string();

        let git = |args: &[&str]| {
            run_git_command(&p, args).unwrap_or_else(|e| panic!("git {args:?}: {e:?}"))
        };
        git(&["init", "-q", "."]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        std::fs::write(dir.join("a.txt"), b"x").unwrap();
        git(&["add", "."]);
        git(&["commit", "-qm", "init"]);

        // 没有 upstream 时必须干净地返回 None，而不是报错或塞垃圾
        assert_eq!(get_upstream(&p), (None, None));

        // 造一个「本地当远程」的 bare 仓库，remote 名故意用带连字符的长名，
        // 且与另一个短名共享前缀，验证最长前缀匹配
        let bare = dir.join("remote.git");
        std::process::Command::new("git")
            .args(["init", "-q", "--bare", &bare.to_string_lossy()])
            .status()
            .unwrap();
        git(&["remote", "add", "origin", &bare.to_string_lossy()]);
        git(&["remote", "add", "origin-mirror", &bare.to_string_lossy()]);

        // 分支名里带斜杠
        git(&["checkout", "-qb", "feature/deep/name"]);
        git(&["push", "-q", "origin-mirror", "feature/deep/name"]);
        git(&[
            "branch",
            "--set-upstream-to=origin-mirror/feature/deep/name",
            "feature/deep/name",
        ]);

        let (remote, branch) = get_upstream(&p);
        // `origin` 是 `origin-mirror` 的前缀，短名不能抢先匹配
        assert_eq!(remote.as_deref(), Some("origin-mirror"));
        // 分支名的斜杠必须完整保留
        assert_eq!(branch.as_deref(), Some("feature/deep/name"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
