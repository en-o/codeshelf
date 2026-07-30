// 路径安全守卫：所有破坏性文件操作在落地前共用的一处检查。
//
// 分散在各命令里的「危险路径字符串列表」挡不住 symlink、`..`、平台分隔符差异
// 和大小写归一，所以这里只认 canonical path，并且把判断收敛到一个函数里
// （改守卫只改一处，不会漏掉某个调用方）。

use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

/// 不允许被递归删除的目录：文件系统根 / 盘符根、用户 HOME、系统目录、应用自身数据目录。
///
/// 返回 canonical 形式；取不到或不存在的条目直接跳过（`/System` 在 Linux 上不存在）。
fn protected_dirs() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();

    let mut push = |p: Option<PathBuf>| {
        if let Some(p) = p {
            if let Ok(c) = p.canonicalize() {
                out.push(c);
            }
        }
    };

    // 用户目录：HOME 自身以及各类系统定义的用户数据根，都不该被整个删掉
    push(dirs::home_dir());
    push(dirs::data_dir());
    push(dirs::data_local_dir());
    push(dirs::config_dir());
    push(dirs::cache_dir());
    push(dirs::desktop_dir());
    push(dirs::document_dir());
    push(dirs::download_dir());
    push(dirs::picture_dir());
    push(dirs::video_dir());

    // 应用自身的数据 / 日志目录，以及它们的父目录（Windows 下就是安装目录）
    if let Ok(cfg) = crate::storage::get_storage_config() {
        push(Some(cfg.data_dir.clone()));
        push(Some(cfg.logs_dir.clone()));
        push(cfg.data_dir.parent().map(|p| p.to_path_buf()));
    }

    #[cfg(not(target_os = "windows"))]
    for p in [
        "/", "/etc", "/usr", "/bin", "/sbin", "/var", "/lib", "/opt", "/tmp", "/dev", "/boot",
        "/root", "/home", "/Users", "/System", "/Library", "/Applications", "/private", "/Volumes",
    ] {
        push(Some(PathBuf::from(p)));
    }

    #[cfg(target_os = "windows")]
    for key in [
        "SystemDrive",
        "SystemRoot",
        "windir",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramData",
        "PUBLIC",
    ] {
        if let Ok(v) = std::env::var(key) {
            if !v.is_empty() {
                // SystemDrive 是 `C:`，不带分隔符时 canonicalize 会解析成当前目录
                let v = if v.ends_with(':') {
                    format!("{}\\", v)
                } else {
                    v
                };
                push(Some(PathBuf::from(v)));
            }
        }
    }

    out
}

/// canonical 路径是否落在受保护集合内。
///
/// 三种命中方式：
/// 1. 就是受保护目录本身（`~`、`/`、`C:\`）；
/// 2. 是受保护目录的祖先（`/Users` 是 HOME 的祖先，删了同样致命）；
/// 3. 位于应用数据目录内部（删项目不该顺手删掉自己的库）。
fn protection_hit(canonical: &Path) -> Option<PathBuf> {
    // 根目录没有父级，任何平台都直接拒绝（`/`、`C:\`、`\\server\share`）
    if canonical.parent().is_none() {
        return Some(canonical.to_path_buf());
    }

    // 应用自身的数据 / 日志目录：连内部条目都不允许被当成项目删掉
    if let Ok(cfg) = crate::storage::get_storage_config() {
        for d in [&cfg.data_dir, &cfg.logs_dir] {
            let d = d.canonicalize().unwrap_or_else(|_| d.clone());
            if canonical.starts_with(&d) {
                return Some(d);
            }
        }
    }

    // 其余受保护目录：命中自身或它的祖先（`/Users` 是 HOME 的祖先，删了同样致命）。
    // 注意方向：`p.starts_with(canonical)`，反过来会把 HOME 下的普通项目全部误伤。
    protected_dirs().into_iter().find(|p| p.starts_with(canonical))
}

/// 添加 / 导入项目时的守卫。路径存在就按 canonical 判定，不存在（导入他机备份）
/// 时退化为对原始路径的字面判定 —— 真正的删除边界还会再校验一次。
pub fn ensure_safe_project_path(path: &Path) -> AppResult<()> {
    let resolved = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    match protection_hit(&resolved) {
        Some(hit) => Err(AppError::from(format!(
            "拒绝操作受保护目录：{}（命中 {}）",
            path.display(),
            hit.display()
        ))),
        None => Ok(()),
    }
}

/// 递归删除前的守卫：重新 canonicalize（不信任数据库里的历史路径），
/// 确认它是真实目录且不在受保护集合内，返回**应当被删除的 canonical 路径**。
pub fn ensure_deletable_dir(path: &Path) -> AppResult<PathBuf> {
    let canonical = path
        .canonicalize()
        .map_err(|e| AppError::from(format!("无法解析路径 {}：{}", path.display(), e)))?;

    if !canonical.is_dir() {
        return Err(AppError::from(format!(
            "不是文件夹，拒绝删除：{}",
            canonical.display()
        )));
    }

    if let Some(hit) = protection_hit(&canonical) {
        return Err(AppError::from(format!(
            "拒绝删除受保护目录：{}（命中 {}）",
            canonical.display(),
            hit.display()
        )));
    }

    Ok(canonical)
}

/// 校验一个会被拼进文件名的外部标识（workflow id、会话 id、artifact id、时间戳……）。
///
/// 只放行 `[A-Za-z0-9._-]`，并显式排除 `.` / `..` 与以 `.` 开头的名字。
/// 这样 `../x`、绝对路径、`a/b`、`a\b`、URL 编码变体（`%2e%2e` 里的 `%` 就被挡了）
/// 都拿不到「跳出目录」的能力，也不会盖掉 `.pending_restore` 这类点文件。
///
/// 现有 ID 由 `generate_id()` 产生（纳秒时间戳的十六进制），天然合法。
pub fn safe_file_id(id: &str) -> AppResult<&str> {
    if id.is_empty() || id.len() > 128 {
        return Err(AppError::from(format!("非法标识（长度）: {:?}", id)));
    }
    if id == "." || id == ".." || id.starts_with('.') {
        return Err(AppError::from(format!("非法标识: {:?}", id)));
    }
    if !id
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_')
    {
        return Err(AppError::from(format!(
            "非法标识（只允许字母、数字、`.`、`-`、`_`）: {:?}",
            id
        )));
    }
    Ok(id)
}

/// 用外部标识拼一个数据目录内的文件路径，并验证结果确实落在 `dir` 内。
///
/// `safe_file_id` 已经挡住了穿越，这里的 containment 是第二道：
/// `dir` 本身若是 symlink 或将来校验被放宽，也不会写到目录外。
pub fn safe_data_path(dir: &Path, id: &str, suffix: &str) -> AppResult<PathBuf> {
    let id = safe_file_id(id)?;
    let candidate = dir.join(format!("{}{}", id, suffix));

    // dir 可能还不存在（首次写入），存在时按 canonical 比较
    if let Ok(dir_canon) = dir.canonicalize() {
        let parent_ok = candidate
            .parent()
            .and_then(|p| p.canonicalize().ok())
            .map(|p| p == dir_canon)
            .unwrap_or(false);
        if !parent_ok {
            return Err(AppError::from(format!(
                "路径越界：{} 不在 {} 下",
                candidate.display(),
                dir.display()
            )));
        }
    }
    Ok(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 只做判定，不删除任何真实目录。
    #[test]
    fn rejects_roots_home_and_ancestors() {
        let home = dirs::home_dir().expect("测试环境需要 HOME");

        // 根、HOME、HOME 的祖先都必须被拒
        assert!(ensure_deletable_dir(Path::new("/")).is_err());
        assert!(ensure_deletable_dir(&home).is_err());
        assert!(ensure_deletable_dir(home.parent().unwrap()).is_err());

        // 用户数据根同样不可删
        if let Some(d) = dirs::document_dir().filter(|p| p.exists()) {
            assert!(ensure_deletable_dir(&d).is_err());
        }
    }

    #[test]
    fn rejects_symlink_pointing_at_protected_dir() {
        let home = dirs::home_dir().expect("测试环境需要 HOME");
        let dir = std::env::temp_dir().join(format!("codeshelf-guard-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let link = dir.join("home-link");
        let _ = std::fs::remove_file(&link);

        #[cfg(unix)]
        std::os::unix::fs::symlink(&home, &link).unwrap();
        #[cfg(windows)]
        let _ = std::os::windows::fs::symlink_dir(&home, &link);

        if link.exists() {
            // canonicalize 会把 symlink 解析成 HOME，于是命中保护
            assert!(ensure_deletable_dir(&link).is_err());
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn allows_ordinary_project_dir() {
        let dir = std::env::temp_dir()
            .join(format!("codeshelf-guard-ok-{}", std::process::id()))
            .join("my-project");
        std::fs::create_dir_all(&dir).unwrap();

        assert!(ensure_deletable_dir(&dir).is_ok());
        assert!(ensure_safe_project_path(&dir).is_ok());

        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn file_id_blocks_traversal_variants() {
        // generate_id() 的产物与常见历史 ID 必须继续可用
        for ok in ["1a2b3c4d5e6f", "session-2024_01", "run.1", "abcDEF123"] {
            assert!(safe_file_id(ok).is_ok(), "应放行: {ok}");
        }
        for bad in [
            "../x",
            "..",
            ".",
            ".pending_restore",
            "a/b",
            "a\\b",
            "/etc/passwd",
            "C:\\Windows\\x",
            "%2e%2e%2fx",
            "a\0b",
            "a b",
            "",
            &"x".repeat(129),
        ] {
            assert!(safe_file_id(bad).is_err(), "应拒绝: {bad:?}");
        }
    }

    #[test]
    fn safe_data_path_stays_in_dir() {
        let dir = std::env::temp_dir().join(format!("codeshelf-id-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let p = safe_data_path(&dir, "abc123", ".json").unwrap();
        assert_eq!(p, dir.join("abc123.json"));
        assert!(safe_data_path(&dir, "../escape", ".json").is_err());
        assert!(safe_data_path(&dir, "sub/escape", ".json").is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_nonexistent_and_file_targets() {
        let dir = std::env::temp_dir().join(format!("codeshelf-guard-f-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.txt");
        std::fs::write(&file, b"x").unwrap();

        assert!(ensure_deletable_dir(&file).is_err());
        assert!(ensure_deletable_dir(&dir.join("does-not-exist")).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
