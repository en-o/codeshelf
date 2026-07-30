//! CopyFile / MoveFile / DeleteFile —— 会话工作目录内的文件/目录复制移动删除。
//!
//! 边界与 Read/Write/Edit 完全一致：所有路径都过 `require_under_cwd`
//! （canonicalize 后比对 allowedCwd，`~`、项目外绝对路径、`..`、symlink 逃逸都会被拒）。
//! 删除再叠一层 `path_guard`，防止 allowedCwd 本身被设成 HOME 之类的受保护目录。
//!
//! 以前这里用的是「危险路径字符串列表」：`/tmp/../etc`、`~` 展开后的 HOME、
//! 指向系统目录的 symlink 全都能绕过，而且完全没看会话已经加载好的 allowedCwd。

use crate::error::AppResult;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::ctx::{expand_home, require_under_cwd, ToolCtx};

/// 取出参数里的路径，展开 `~`，再收敛到会话工作目录内。
fn arg_path(ctx: &ToolCtx, args: &Value, key: &str) -> AppResult<PathBuf> {
    let raw = args
        .get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| crate::error::AppError::from(format!("缺少 {}", key)))?;
    require_under_cwd(ctx, Path::new(&expand_home(raw)))
}

fn copy_recursively(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let dest = dst.join(entry.file_name());
            copy_recursively(&entry.path(), &dest)?;
        }
    } else {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(src, dst)?;
    }
    Ok(())
}

/// 覆盖前清掉目标。目标同样已经过 `require_under_cwd`。
fn remove_existing(dst: &Path) -> AppResult<()> {
    if !dst.exists() {
        return Ok(());
    }
    if dst.is_dir() {
        fs::remove_dir_all(dst).map_err(|e| crate::error::AppError::from(e.to_string()))
    } else {
        fs::remove_file(dst).map_err(|e| crate::error::AppError::from(e.to_string()))
    }
}

fn resolve_pair(ctx: &ToolCtx, args: &Value) -> AppResult<(PathBuf, PathBuf, bool)> {
    let src = arg_path(ctx, args, "src")?;
    let dst = arg_path(ctx, args, "dst")?;
    let overwrite = args
        .get("overwrite")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !src.exists() {
        return Err(crate::error::AppError::from(format!(
            "源不存在：{}",
            src.display()
        )));
    }
    if dst.exists() && !overwrite {
        return Err(crate::error::AppError::from(format!(
            "目标已存在（传 overwrite=true 覆盖）：{}",
            dst.display()
        )));
    }
    Ok((src, dst, overwrite))
}

pub(super) fn tool_copy_file(ctx: &ToolCtx, args: &Value) -> AppResult<String> {
    let (src, dst, _) = resolve_pair(ctx, args)?;
    remove_existing(&dst)?;
    copy_recursively(&src, &dst)
        .map_err(|e| crate::error::AppError::from(format!("复制失败: {}", e)))?;
    Ok(format!("已复制 {} → {}", src.display(), dst.display()))
}

pub(super) fn tool_move_file(ctx: &ToolCtx, args: &Value) -> AppResult<String> {
    let (src, dst, _) = resolve_pair(ctx, args)?;
    remove_existing(&dst)?;
    match fs::rename(&src, &dst) {
        Ok(_) => Ok(format!("已移动 {} → {}", src.display(), dst.display())),
        Err(_) => {
            // 跨盘：fallback copy + delete
            copy_recursively(&src, &dst)
                .map_err(|e| crate::error::AppError::from(format!("跨盘复制失败: {}", e)))?;
            if src.is_dir() {
                fs::remove_dir_all(&src)
                    .map_err(|e| crate::error::AppError::from(format!("删除源失败: {}", e)))?;
            } else {
                fs::remove_file(&src)
                    .map_err(|e| crate::error::AppError::from(format!("删除源失败: {}", e)))?;
            }
            Ok(format!("已跨盘移动 {} → {}", src.display(), dst.display()))
        }
    }
}

pub(super) fn tool_delete_file(ctx: &ToolCtx, args: &Value) -> AppResult<String> {
    let p = arg_path(ctx, args, "path")?;
    let recursive = args
        .get("recursive")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !p.exists() {
        return Err(crate::error::AppError::from(format!(
            "路径不存在：{}",
            p.display()
        )));
    }

    if p.is_dir() {
        if !recursive {
            return Err("删除目录需要 recursive=true".into());
        }
        // 第二层：allowedCwd 万一被设成 HOME/系统目录，这里仍然拦得住
        let target = crate::path_guard::ensure_deletable_dir(&p)?;
        fs::remove_dir_all(&target)
            .map_err(|e| crate::error::AppError::from(format!("删除失败: {}", e)))?;
    } else {
        fs::remove_file(&p).map_err(|e| crate::error::AppError::from(format!("删除失败: {}", e)))?;
    }
    Ok(format!("已删除：{}", p.display()))
}
