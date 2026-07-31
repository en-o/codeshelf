// 工作区状态与冲突处理：get_git_status / 冲突相关命令

use super::{
    is_system_junk_file, run_git_command, run_git_command_raw, ConflictFileContent, GitStatus,
};
use crate::error::AppResult;

#[tauri::command]
#[specta::specta]
pub async fn get_git_status(path: String) -> AppResult<GitStatus> {
    // Get current branch
    let branch = run_git_command(&path, &["rev-parse", "--abbrev-ref", "HEAD"])
        .unwrap_or_else(|_| "unknown".to_string());

    // 用 `-z` 解析工作区状态。
    //
    // 默认 porcelain 输出对「特殊」路径会加引号并做 **C 风格八进制转义**
    // （中文 `改名.txt` 变成 `"\346\224\271\345\220\215.txt"`），
    // 而 rename 会写成 `old -> new` 两个路径挤在一行。
    // 之前的 `unquote_git_path` 只处理 `\n \t \\ \"` 四种转义、也不拆 rename，
    // 于是中文/emoji/空格路径和 rename 都会解析成**不存在的假路径**，
    // 再被 stage / discard / resolve 拿去操作。
    //
    // `-z` 不加引号、不转义，条目以 NUL 结尾；rename 条目额外跟一个 NUL 分隔的旧路径。
    let raw = run_git_command_raw(&path, &["status", "--porcelain", "-uall", "-z"])?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();
    let mut conflicted = Vec::new();

    let mut fields = raw.split(|b| *b == 0);
    while let Some(entry) = fields.next() {
        if entry.is_empty() {
            continue;
        }
        // 每条格式：XY<空格>路径
        if entry.len() < 3 {
            continue;
        }
        let status = &entry[0..2];
        let path_bytes = &entry[3..];

        // rename / copy 的条目后面**紧跟**一个 NUL 分隔的旧路径，必须一并消费掉，
        // 否则它会被当成下一条状态记录来解析。
        let is_rename = status[0] == b'R' || status[0] == b'C';
        let old_path = if is_rename { fields.next() } else { None };

        // 非 UTF-8 路径无法在前端安全表示，也无法回传给 git 做后续操作。
        // 显式跳过并记日志，而不是 lossy 转换出一个"看起来像但打不开"的路径。
        let file = match std::str::from_utf8(path_bytes) {
            Ok(s) => s.to_string(),
            Err(_) => {
                log::warn!(
                    "跳过非 UTF-8 路径（暂不支持）: {}",
                    String::from_utf8_lossy(path_bytes)
                );
                continue;
            }
        };
        if is_rename {
            if let Some(old) = old_path {
                if std::str::from_utf8(old).is_err() {
                    log::warn!("跳过 rename 的非 UTF-8 旧路径");
                    continue;
                }
            }
        }

        if file.is_empty() || is_system_junk_file(&file) {
            continue;
        }

        // 冲突：任一位是 U，或 AA / DD
        if status.contains(&b'U') || status == b"AA" || status == b"DD" {
            conflicted.push(file);
            continue;
        }

        // 第一位 = index 状态，第二位 = 工作区状态。两位可以同时非空
        // （`MM` 表示既有暂存改动又有未暂存改动），必须分别记入两个列表。
        match status[0] {
            b'?' => untracked.push(file),
            b' ' => unstaged.push(file),
            _ => {
                if status[1] == b' ' {
                    staged.push(file);
                } else {
                    staged.push(file.clone());
                    unstaged.push(file);
                }
            }
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

    /// 特殊文件名与 rename 必须解析成**真实存在**的路径。
    ///
    /// 默认 porcelain 会把中文写成 `"\346\224\271..."` 八进制转义、
    /// 把 rename 写成 `old -> new` 一行两路径。旧解析器两者都处理不了，
    /// 产出的假路径会被 stage / discard 拿去操作。
    #[tokio::test]
    async fn special_filenames_and_renames_resolve_to_real_paths() {
        let dir = std::env::temp_dir().join(format!("codeshelf-zparse-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.to_string_lossy().to_string();
        let git = |args: &[&str]| run_git_command(&p, args).unwrap_or_else(|e| panic!("{args:?}: {e:?}"));

        git(&["init", "-q", "."]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        std::fs::write(dir.join("base.txt"), b"x").unwrap();
        git(&["add", "."]);
        git(&["commit", "-qm", "init"]);

        // 各类特殊文件名
        std::fs::write(dir.join("中文文件.txt"), b"a").unwrap();
        std::fs::write(dir.join("emoji 🙂.txt"), b"b").unwrap();
        std::fs::write(dir.join("有 空格.txt"), b"c").unwrap();
        git(&["add", "中文文件.txt"]);
        // rename
        git(&["mv", "base.txt", "改名后.txt"]);
        // 同一文件既有暂存改动又有未暂存改动
        std::fs::write(dir.join("双重.txt"), b"v1").unwrap();
        git(&["add", "双重.txt"]);
        std::fs::write(dir.join("双重.txt"), b"v1+v2").unwrap();

        let st = get_git_status(p.clone()).await.expect("status");
        let all: Vec<&String> = st
            .staged
            .iter()
            .chain(st.unstaged.iter())
            .chain(st.untracked.iter())
            .collect();

        // 每一条报出来的路径都必须真实存在 —— 这是整条修复的核心断言。
        // 旧解析器在这里会给出 `"\346..."` 之类的假路径。
        for f in &all {
            assert!(
                dir.join(f).exists(),
                "报出的路径不存在（解析错误）: {:?}\n全部: {:?}",
                f,
                all
            );
        }

        assert!(st.staged.contains(&"中文文件.txt".to_string()), "{:?}", st.staged);
        assert!(st.untracked.contains(&"emoji 🙂.txt".to_string()), "{:?}", st.untracked);
        assert!(st.untracked.contains(&"有 空格.txt".to_string()), "{:?}", st.untracked);
        // rename 的新路径进 staged，且**不能**混进 `base.txt -> 改名后.txt` 这种拼接串
        assert!(st.staged.contains(&"改名后.txt".to_string()), "{:?}", st.staged);
        assert!(
            !all.iter().any(|f| f.contains("->")),
            "rename 未被拆开: {:?}",
            all
        );
        // 双重状态必须同时出现在两个列表里
        assert!(st.staged.contains(&"双重.txt".to_string()), "{:?}", st.staged);
        assert!(st.unstaged.contains(&"双重.txt".to_string()), "{:?}", st.unstaged);

        let _ = std::fs::remove_dir_all(&dir);
    }

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
