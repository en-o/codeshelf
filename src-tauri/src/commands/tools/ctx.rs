//! 工具会话上下文：路径校验、~ 展开、输出截断。

use crate::error::AppResult;
use std::fs;
use std::path::{Path, PathBuf};

pub(super) fn session_tasks_path(session_id: &str) -> AppResult<PathBuf> {
    let dir = crate::commands::chat::resolve_chat_history_dir_pub()?;
    // session_id 来自前端，直接拼文件名等于把 `../` 交给文件系统
    crate::path_guard::safe_data_path(&dir, session_id, ".tasks.json")
}

/// 当前工具上下文
pub(super) struct ToolCtx {
    pub session_id: String,
    pub allowed_cwd: Option<PathBuf>,
}

pub(super) async fn load_ctx(session_id: &str) -> AppResult<ToolCtx> {
    let session = crate::commands::chat::get_chat_session(session_id.to_string()).await?;
    Ok(ToolCtx {
        session_id: session_id.to_string(),
        allowed_cwd: session.allowed_cwd.as_ref().map(PathBuf::from),
    })
}

/// 校验某路径是否在 allowed_cwd 内（canonicalize 后比较）
pub(super) fn require_under_cwd(ctx: &ToolCtx, target: &Path) -> AppResult<PathBuf> {
    let base = ctx.allowed_cwd.as_ref().ok_or_else(|| {
        crate::error::AppError::from("会话未设置 allowedCwd，禁止写/执行类工具".to_string())
    })?;
    let base_canon = fs::canonicalize(base)
        .map_err(|e| crate::error::AppError::from(format!("allowedCwd 无效: {}", e)))?;

    // 允许目标文件不存在（Write 新建）；对其父目录做校验
    let candidate = if target.is_absolute() {
        target.to_path_buf()
    } else {
        base_canon.join(target)
    };
    let check = if candidate.exists() {
        fs::canonicalize(&candidate)
            .map_err(|e| crate::error::AppError::from(format!("目标路径无效: {}", e)))?
    } else {
        let parent = candidate
            .parent()
            .ok_or_else(|| crate::error::AppError::from("目标路径无父目录".to_string()))?;
        let parent_canon = fs::canonicalize(parent)
            .map_err(|e| crate::error::AppError::from(format!("目标父目录无效: {}", e)))?;
        parent_canon.join(candidate.file_name().unwrap_or_default())
    };
    if !check.starts_with(&base_canon) {
        return Err(crate::error::AppError::from(format!(
            "路径越界：{} 不在 allowedCwd {} 下",
            check.display(),
            base_canon.display()
        )));
    }
    Ok(check)
}

pub(super) fn truncate(s: String, max: usize) -> String {
    if s.len() <= max {
        return s;
    }
    // `&s[..max]` 会在多字节字符中间切断并 panic。命令输出、文件内容里
    // 中文和 emoji 很常见，按字符边界回退到 max 之前最近的合法位置。
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n… [已截断，共 {} 字节]", &s[..end], s.len())
}

/// 展开路径开头的 `~` / `~/` 为 $HOME（Windows 下为 %USERPROFILE%）。
/// 其它情况原样返回。
pub(super) fn expand_home(input: &str) -> String {
    let home = if cfg!(windows) {
        std::env::var("USERPROFILE").ok()
    } else {
        std::env::var("HOME").ok()
    };
    let Some(home) = home else {
        return input.to_string();
    };
    if input == "~" {
        return home;
    }
    if let Some(rest) = input.strip_prefix("~/") {
        return format!("{}/{}", home.trim_end_matches('/'), rest);
    }
    #[cfg(windows)]
    {
        if let Some(rest) = input.strip_prefix("~\\") {
            return format!("{}\\{}", home.trim_end_matches('\\'), rest);
        }
    }
    input.to_string()
}

#[cfg(test)]
mod truncate_tests {
    #[test]
    fn does_not_split_multibyte_chars() {
        // 「中」是 3 字节：max=4 落在第二个字符中间，旧实现会 panic
        let s = "中文abc".to_string();
        let out = super::truncate(s.clone(), 4);
        assert!(out.starts_with("中"), "{out}");
        assert!(out.contains("已截断"));
        // emoji 是 4 字节，同样不能切开
        let e = "🙂🙂🙂".to_string();
        let out = super::truncate(e, 6);
        assert!(out.starts_with("🙂"), "{out}");
        // 不超限时原样返回
        assert_eq!(super::truncate("abc".to_string(), 10), "abc");
    }
}
