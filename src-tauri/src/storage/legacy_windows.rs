// Windows 历史嵌套安装遗留数据的发现与迁移。
//
// 背景：早期版本的 NSIS hook 有「末段不是产品名就补一层」的逻辑，每次升级都会
// 在已有的 CodeShelf 目录里再套一层，形成 `CodeShelf\CodeShelf\CodeShelf\...`。
// 而 Windows 的数据目录跟着 exe 走（`<exe 所在目录>\data`），于是老数据被留在
// 上一层，用户看到的是"更新后数据全没了"。
//
// nsis-hooks.nsi 已经不再继续嵌套（见 CLAUDE.md 硬约束 7），但**既往**受影响的
// 安装里，历史数据仍然躺在某个上层目录中不可见。这里负责把它找出来。
//
// 设计取舍：**只发现、不自动迁移**。自动复制别人的数据是本轮审计一直在修的那类
// 问题（静默覆盖），而这条路径无法在非 Windows 机器上验证。所以迁移必须由用户
// 显式触发，且**永不覆盖**已存在的文件，完成后写持久标记避免反复提示。

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 迁移完成标记文件名。放在当前 data 目录下，跟着数据走。
const MIGRATION_MARKER: &str = ".legacy-migrated";

/// 一处候选的历史数据目录。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LegacyDataCandidate {
    /// 历史 data 目录的绝对路径
    pub path: String,
    /// 目录里的文件数量（递归）
    pub file_count: u32,
    /// 所有文件的总字节数
    pub total_bytes: u64,
    /// 最近修改时间（RFC3339），拿不到时为 None
    pub last_modified: Option<String>,
    /// 当前 data 目录里**已经存在**的同名文件数量。
    /// 大于 0 意味着两边都有数据，迁移只会补齐缺失的部分，不会覆盖。
    pub conflicting_files: u32,
}

// 只在 Windows 的探测路径和单测里用到；其它平台 detect 直接返回空列表
#[cfg(any(target_os = "windows", test))]
fn dir_summary(dir: &Path) -> (u32, u64, Option<String>) {
    let mut count = 0u32;
    let mut bytes = 0u64;
    let mut newest: Option<std::time::SystemTime> = None;

    fn walk(
        dir: &Path,
        depth: u32,
        count: &mut u32,
        bytes: &mut u64,
        newest: &mut Option<std::time::SystemTime>,
    ) {
        if depth > 8 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, depth + 1, count, bytes, newest);
            } else if let Ok(md) = e.metadata() {
                *count += 1;
                *bytes += md.len();
                if let Ok(m) = md.modified() {
                    if newest.is_none_or(|n| m > n) {
                        *newest = Some(m);
                    }
                }
            }
        }
    }
    walk(dir, 0, &mut count, &mut bytes, &mut newest);

    let modified = newest.map(|t| {
        let dt: chrono::DateTime<chrono::Utc> = t.into();
        dt.to_rfc3339()
    });
    (count, bytes, modified)
}

/// 统计 `legacy` 里有多少文件在 `current` 中已经存在（相对路径同名）。
#[cfg(any(target_os = "windows", test))]
fn count_conflicts(legacy: &Path, current: &Path) -> u32 {
    let mut n = 0u32;
    fn walk(base: &Path, dir: &Path, current: &Path, depth: u32, n: &mut u32) {
        if depth > 8 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(base, &p, current, depth + 1, n);
            } else if let Ok(rel) = p.strip_prefix(base) {
                if current.join(rel).exists() {
                    *n += 1;
                }
            }
        }
    }
    walk(legacy, legacy, current, 0, &mut n);
    n
}

/// 扫描已知的历史嵌套层级，返回**确实有数据**的候选目录。
///
/// 只在 Windows 上有意义；其它平台返回空列表（macOS 用系统数据目录，
/// Linux 已在 AUD-023 改为 XDG 目录，都不存在这个嵌套问题）。
#[tauri::command]
#[specta::specta]
pub fn detect_legacy_windows_data() -> AppResult<Vec<LegacyDataCandidate>> {
    // macOS 用系统数据目录、Linux 用 XDG 目录（AUD-023），都不存在这个嵌套问题
    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }

    #[cfg(target_os = "windows")]
    {
        let config = super::get_storage_config()?;
        let current = &config.data_dir;

        // 已经迁移过就不再提示
        if current.join(MIGRATION_MARKER).exists() {
            return Ok(Vec::new());
        }

        let exe = std::env::current_exe()
            .map_err(|e| AppError::from(format!("获取可执行文件路径失败: {}", e)))?;
        let Some(install_dir) = exe.parent() else {
            return Ok(Vec::new());
        };

        // 历史嵌套形态：安装目录本身、以及它上面若干层的 `CodeShelf\data`。
        // 旧 hook 是「往里套」，所以老数据在**更浅**的层级上。
        let mut candidates: Vec<PathBuf> = Vec::new();
        let mut cursor = install_dir;
        for _ in 0..5 {
            let Some(parent) = cursor.parent() else { break };
            candidates.push(parent.join("data"));
            cursor = parent;
        }

        let current_canon = current.canonicalize().unwrap_or_else(|_| current.clone());
        let mut out = Vec::new();
        for cand in candidates {
            if !cand.is_dir() {
                continue;
            }
            // 别把当前目录当成"历史目录"
            let cand_canon = cand.canonicalize().unwrap_or_else(|_| cand.clone());
            if cand_canon == current_canon {
                continue;
            }
            let (file_count, total_bytes, last_modified) = dir_summary(&cand_canon);
            if file_count == 0 {
                continue;
            }
            out.push(LegacyDataCandidate {
                path: cand_canon.to_string_lossy().into_owned(),
                file_count,
                total_bytes,
                last_modified,
                conflicting_files: count_conflicts(&cand_canon, &current_canon),
            });
        }
        Ok(out)
    }
}

/// 递归复制 `base` 下缺失的文件到 `dest_root`，**已存在的一律跳过**。
fn copy_missing(
    base: &Path,
    dir: &Path,
    dest_root: &Path,
    depth: u32,
    copied: &mut u32,
) -> AppResult<()> {
    if depth > 8 {
        return Ok(());
    }
    let entries = std::fs::read_dir(dir)
        .map_err(|e| AppError::from(format!("读取 {} 失败: {}", dir.display(), e)))?;
    for e in entries.flatten() {
        let p = e.path();
        let Ok(rel) = p.strip_prefix(base) else {
            continue;
        };
        let target = dest_root.join(rel);
        if p.is_dir() {
            std::fs::create_dir_all(&target).ok();
            copy_missing(base, &p, dest_root, depth + 1, copied)?;
        } else if !target.exists() {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            std::fs::copy(&p, &target).map_err(|e| {
                AppError::from(format!("复制 {} 失败: {}", p.display(), e))
            })?;
            *copied += 1;
        }
        // target 已存在：保持当前版本，不覆盖
    }
    Ok(())
}

/// 把历史目录里的数据补进当前 data 目录。
///
/// **永不覆盖**已存在的文件：两边都有的条目保持当前版本不动，只补缺失的。
/// 这样即使用户选错了源目录，也不会毁掉正在用的数据。
///
/// 返回实际复制的文件数。完成后写入持久标记，后续启动不再提示。
#[tauri::command]
#[specta::specta]
pub fn migrate_legacy_windows_data(from: String) -> AppResult<u32> {
    let config = super::get_storage_config()?;
    let current = config.data_dir.clone();
    std::fs::create_dir_all(&current)
        .map_err(|e| AppError::from(format!("创建数据目录失败: {}", e)))?;

    let src = PathBuf::from(&from)
        .canonicalize()
        .map_err(|e| AppError::from(format!("历史目录不可用 {}：{}", from, e)))?;
    let current_canon = current.canonicalize().unwrap_or_else(|_| current.clone());
    if src == current_canon {
        return Err(AppError::from("源目录就是当前数据目录，无需迁移".to_string()));
    }
    // 源目录不能是当前目录的祖先/后代，否则复制会自我嵌套
    if current_canon.starts_with(&src) || src.starts_with(&current_canon) {
        return Err(AppError::from(
            "历史目录与当前数据目录存在包含关系，拒绝迁移以免自我复制".to_string(),
        ));
    }

    let mut copied = 0u32;
    copy_missing(&src, &src, &current_canon, 0, &mut copied)?;

    // 持久标记：避免下次启动又提示同一批数据
    let marker = current_canon.join(MIGRATION_MARKER);
    let note = format!(
        "migrated_from={}\nmigrated_at={}\ncopied_files={}\n",
        src.display(),
        chrono::Utc::now().to_rfc3339(),
        copied
    );
    crate::storage::write_atomic(&marker, note)
        .map_err(|e| AppError::from(format!("写入迁移标记失败: {}", e)))?;

    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 迁移**只补缺失**，绝不覆盖当前数据 —— 用户选错源目录也不该毁掉正在用的库。
    #[test]
    fn migration_never_overwrites_existing_files() {
        let root = crate::storage::unique_test_dir("codeshelf-legacy");
        let _ = std::fs::remove_dir_all(&root);
        let src = root.join("old").join("data");
        let dst = root.join("new").join("data");
        std::fs::create_dir_all(src.join("sub")).unwrap();
        std::fs::create_dir_all(&dst).unwrap();

        std::fs::write(src.join("shared.json"), b"OLD").unwrap();
        std::fs::write(src.join("only-old.json"), b"OLD-ONLY").unwrap();
        std::fs::write(src.join("sub").join("nested.json"), b"NESTED").unwrap();
        std::fs::write(dst.join("shared.json"), b"CURRENT").unwrap();

        let mut copied = 0u32;
        copy_missing(&src, &src, &dst, 0, &mut copied).unwrap();

        // 冲突文件保持当前版本
        assert_eq!(std::fs::read(dst.join("shared.json")).unwrap(), b"CURRENT");
        // 缺失的被补上，含子目录
        assert_eq!(std::fs::read(dst.join("only-old.json")).unwrap(), b"OLD-ONLY");
        assert_eq!(
            std::fs::read(dst.join("sub").join("nested.json")).unwrap(),
            b"NESTED"
        );
        assert_eq!(copied, 2, "只应复制 2 个缺失文件");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn summary_counts_files_recursively() {
        let root = crate::storage::unique_test_dir("codeshelf-sum");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("a").join("b")).unwrap();
        std::fs::write(root.join("x.json"), b"12345").unwrap();
        std::fs::write(root.join("a").join("y.json"), b"123").unwrap();
        std::fs::write(root.join("a").join("b").join("z.json"), b"1").unwrap();

        let (count, bytes, modified) = dir_summary(&root);
        assert_eq!(count, 3);
        assert_eq!(bytes, 9);
        assert!(modified.is_some());

        // 冲突统计：目标里已有 x.json
        let other = root.join("other");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(other.join("x.json"), b"dup").unwrap();
        assert_eq!(count_conflicts(&root, &other), 1);

        let _ = std::fs::remove_dir_all(&root);
    }
}
