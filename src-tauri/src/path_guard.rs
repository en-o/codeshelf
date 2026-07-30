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

/// 校验一个**用户可见的**文件/目录名（仓库名、导出文件名……）是单一正常路径组件。
///
/// 与 `safe_file_id` 的区别：那个是给机器生成的 ID 用的，只放行 ASCII `[A-Za-z0-9._-]`；
/// 仓库名是人写的，`我的项目`、`foo+bar`、`lib.rs~` 都合法，按 ID 那套会误杀。
/// 所以这里改成**黑名单**：只挡真正会造成穿越或跨平台炸掉的字符。
pub fn safe_path_component(name: &str) -> AppResult<&str> {
    let bad = |why: &str| AppError::from(format!("名称非法（{}）：{:?}", why, name));

    if name.is_empty() || name.len() > 255 {
        return Err(bad("长度"));
    }
    if name == "." || name == ".." {
        return Err(bad("保留名"));
    }
    // 路径分隔符两个平台都挡，避免「macOS 上放行、Windows 上变成子目录」
    if name.contains('/') || name.contains('\\') {
        return Err(bad("包含路径分隔符"));
    }
    // `:` 在 Windows 上是盘符 / NTFS 数据流分隔符
    if name.contains(':') {
        return Err(bad("包含冒号"));
    }
    if name.chars().any(|c| c.is_control()) {
        return Err(bad("包含控制字符"));
    }
    // Windows 不允许结尾是空格或点，且首尾空白基本都是误输入
    if name.trim() != name || name.ends_with('.') {
        return Err(bad("首尾空白或以点结尾"));
    }
    // Windows 保留设备名（含带扩展名的形式，如 `CON.txt`）
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.contains(&stem.as_str()) {
        return Err(bad("Windows 保留设备名"));
    }
    Ok(name)
}

/// 在 `parent` 下**原子地占位**一个新目录，并返回它的 canonical 路径。
///
/// 用于 git clone 这类「先建目录、失败再删掉」的流程。三件事一起做完，
/// 才谈得上「清理只删自己创建的那个目录」：
/// 1. `name` 必须是单一正常路径组件（`safe_path_component`：挡掉 `..`、绝对路径、
///    `/` 与 `\` 分隔符、控制字符、Windows 保留名；中文等非 ASCII 名字照常放行）；
/// 2. `create_dir` 而不是 `create_dir_all` —— 目标已存在就直接失败，
///    没有「先 exists() 再创建」那段 TOCTOU 窗口；
/// 3. 建完立刻 canonicalize 并复核仍落在 `parent` 内，且不在受保护集合里。
///
/// 调用方应保存返回的 canonical 路径；清理时用 `ensure_created_dir_unchanged`
/// 确认它还是同一个目录再删。
pub fn claim_new_subdir(parent: &Path, name: &str) -> AppResult<PathBuf> {
    let name = safe_path_component(name)?;

    let parent_canon = parent
        .canonicalize()
        .map_err(|e| AppError::from(format!("目标目录不可用 {}：{}", parent.display(), e)))?;
    if !parent_canon.is_dir() {
        return Err(AppError::from(format!(
            "目标不是文件夹：{}",
            parent_canon.display()
        )));
    }

    let candidate = parent_canon.join(name);
    // 原子占位：已存在（目录/文件/symlink）都会返回 AlreadyExists
    std::fs::create_dir(&candidate).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            AppError::from(format!("目录 '{}' 已存在", name))
        } else {
            AppError::from(format!("创建目录失败 {}：{}", candidate.display(), e))
        }
    })?;

    // 建完再解析一次：parent 若是 symlink，或期间被人换掉，这里才看得出来
    let canonical = match candidate.canonicalize() {
        Ok(c) => c,
        Err(e) => {
            let _ = std::fs::remove_dir(&candidate);
            return Err(AppError::from(format!("解析新建目录失败：{}", e)));
        }
    };
    if canonical.parent() != Some(parent_canon.as_path()) {
        let _ = std::fs::remove_dir(&canonical);
        return Err(AppError::from(format!(
            "路径越界：{} 不在 {} 下",
            canonical.display(),
            parent_canon.display()
        )));
    }
    if let Some(hit) = protection_hit(&canonical) {
        let _ = std::fs::remove_dir(&canonical);
        return Err(AppError::from(format!(
            "拒绝在受保护目录下创建：{}（命中 {}）",
            canonical.display(),
            hit.display()
        )));
    }

    Ok(canonical)
}

/// 清理前的复核：`created` 必须仍解析到当初 `claim_new_subdir` 返回的同一个 canonical 路径。
///
/// 期间目录被换成 symlink 或被替换掉时返回 Err，调用方就不该删 —— 那已经不是自己创建的东西了。
pub fn ensure_created_dir_unchanged(created: &Path) -> AppResult<PathBuf> {
    let canonical = ensure_deletable_dir(created)?;
    if canonical != created {
        return Err(AppError::from(format!(
            "目标已被替换，拒绝删除：{} 现在解析为 {}",
            created.display(),
            canonical.display()
        )));
    }
    Ok(canonical)
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
    fn claim_new_subdir_blocks_escapes_and_is_atomic() {
        let parent = std::env::temp_dir().join(format!("codeshelf-claim-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&parent);
        std::fs::create_dir_all(&parent).unwrap();

        // `..`、绝对路径、混合分隔符、点开头 —— 必须在建任何目录之前就失败
        for bad in [
            "..",
            "../outside",
            "..\\outside",
            "a/b",
            "a\\b",
            "/etc",
            "C:\\Windows",
            "",
            "CON",
            "nul.txt",
            "trailing ",
            "trailing.",
            "with\u{0}nul",
        ] {
            assert!(claim_new_subdir(&parent, bad).is_err(), "应拒绝: {bad:?}");
        }
        // 一个都不许落地
        assert_eq!(std::fs::read_dir(&parent).unwrap().count(), 0);

        // 正常名字：建出来、落在 parent 内。
        // 非 ASCII / `+` / 点开头都是合法仓库名，不能因为「安全」把它们误杀。
        for good in ["my-repo", "我的项目", "foo+bar", ".github", "a.b.c"] {
            let ok = claim_new_subdir(&parent, good).unwrap_or_else(|e| panic!("{good}: {e:?}"));
            assert!(ok.is_dir());
            assert_eq!(ok.parent().unwrap(), parent.canonicalize().unwrap());
        }

        // 原子占位：同名第二次必须失败（这就是取代 exists() 检查的那道 TOCTOU 防线）
        assert!(claim_new_subdir(&parent, "my-repo").is_err());

        // 目标位置已被文件占用时同样失败
        std::fs::write(parent.join("taken"), b"x").unwrap();
        assert!(claim_new_subdir(&parent, "taken").is_err());

        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn cleanup_refuses_when_target_was_swapped() {
        let parent = std::env::temp_dir().join(format!("codeshelf-swap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&parent);
        std::fs::create_dir_all(&parent).unwrap();

        let created = claim_new_subdir(&parent, "repo").unwrap();
        // 没被动过：允许清理
        assert!(ensure_created_dir_unchanged(&created).is_ok());

        // 换成指向别处的 symlink：canonical 变了，必须拒绝删除
        let elsewhere = parent.join("elsewhere");
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&created).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&elsewhere, &created).unwrap();
        #[cfg(windows)]
        let _ = std::os::windows::fs::symlink_dir(&elsewhere, &created);

        if created.exists() {
            assert!(
                ensure_created_dir_unchanged(&created).is_err(),
                "目标被换成 symlink 后不该允许删除"
            );
            // 被指向的目录必须毫发无损
            assert!(elsewhere.is_dir());
        }

        let _ = std::fs::remove_dir_all(&parent);
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
