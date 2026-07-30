//! Read / Write / Edit / Glob / Grep —— allowedCwd 沙箱内的文件系统操作。

use crate::error::AppResult;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::ctx::{require_under_cwd, truncate, ToolCtx};

pub(super) fn tool_read(ctx: &ToolCtx, args: &Value) -> AppResult<String> {
    let path_str = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or("缺少 path")?;
    let path = require_under_cwd(ctx, Path::new(path_str))?;
    let text = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取失败: {}", e)))?;
    let offset = args.get("offset").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(2000) as usize;
    let lines: Vec<&str> = text.lines().collect();
    let start = offset.saturating_sub(1);
    let end = (start + limit).min(lines.len());
    let mut out = String::new();
    for (i, line) in lines[start..end].iter().enumerate() {
        out.push_str(&format!("{:>6}\t{}\n", start + i + 1, line));
    }
    Ok(truncate(out, 200_000))
}

pub(super) fn tool_write(ctx: &ToolCtx, args: &Value) -> AppResult<String> {
    let path_str = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or("缺少 path")?;
    let content = args
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or("缺少 content")?;
    let path = require_under_cwd(ctx, Path::new(path_str))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| crate::error::AppError::from(format!("创建目录失败: {}", e)))?;
    }
    fs::write(&path, content)
        .map_err(|e| crate::error::AppError::from(format!("写入失败: {}", e)))?;
    Ok(format!(
        "已写入 {}（{} 字节）",
        path.display(),
        content.len()
    ))
}

pub(super) fn tool_edit(ctx: &ToolCtx, args: &Value) -> AppResult<String> {
    let path_str = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or("缺少 path")?;
    let old = args
        .get("oldString")
        .and_then(|v| v.as_str())
        .ok_or("缺少 oldString")?;
    let new = args
        .get("newString")
        .and_then(|v| v.as_str())
        .ok_or("缺少 newString")?;
    let path = require_under_cwd(ctx, Path::new(path_str))?;
    let text = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取失败: {}", e)))?;
    let occurrences = text.matches(old).count();
    if occurrences == 0 {
        return Err("oldString 未在文件中找到".into());
    }
    if occurrences > 1 {
        return Err(crate::error::AppError::from(format!(
            "oldString 出现 {} 次，必须唯一",
            occurrences
        )));
    }
    let updated = text.replacen(old, new, 1);
    fs::write(&path, &updated)
        .map_err(|e| crate::error::AppError::from(format!("写入失败: {}", e)))?;
    Ok(format!("已替换 {} 中 1 处", path.display()))
}

// ========== glob/grep + 极简正则 ==========

fn glob_walk(root: &Path, pattern: &str) -> AppResult<Vec<PathBuf>> {
    let regex_src = glob_to_regex(pattern);
    // 用 regex crate 而不是手写匹配器。原来那份 `SimpleRegex` 有两个真 bug：
    //   1. `for i in 0..=s.len()` + `&s[i..]` 按**字节**下标切片，中文/emoji 文件名直接 panic；
    //   2. tokenize 时 `b as char` 把非 ASCII 字节按 Latin-1 解释，中文 pattern 永远匹配不上。
    // 当初写它的理由是「避免引入 regex crate」，但 regex 现在已经是直接依赖
    // （web_fetch 的规则提取在用），理由不成立了。
    let re = regex::Regex::new(&regex_src)
        .map_err(|e| crate::error::AppError::from(format!("glob 模式无效: {}", e)))?;
    let mut out = Vec::new();
    walk_dir(root, root, &re, &mut out, 0)?;
    out.sort();
    Ok(out)
}

fn walk_dir(
    base: &Path,
    dir: &Path,
    re: &regex::Regex,
    out: &mut Vec<PathBuf>,
    depth: u32,
) -> AppResult<()> {
    if depth > 16 {
        return Ok(());
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let fname = entry.file_name().to_string_lossy().to_string();
        if path.is_dir()
            && matches!(
                fname.as_str(),
                "node_modules" | ".git" | "target" | "dist" | ".next" | "build" | ".cache"
            )
        {
            continue;
        }
        if path.is_dir() {
            walk_dir(base, &path, re, out, depth + 1)?;
        } else if let Ok(rel) = path.strip_prefix(base) {
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            if re.is_match(&rel_str) {
                out.push(rel.to_path_buf());
            }
        }
    }
    Ok(())
}

/// 极简 glob->regex：支持 **, *, ? 和字面字符
fn glob_to_regex(pattern: &str) -> String {
    let mut out = String::from("^");
    let mut chars = pattern.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '*' => {
                if chars.peek() == Some(&'*') {
                    chars.next();
                    if chars.peek() == Some(&'/') {
                        chars.next();
                    }
                    out.push_str(".*");
                } else {
                    out.push_str("[^/]*");
                }
            }
            '?' => out.push_str("[^/]"),
            '.' | '+' | '(' | ')' | '|' | '^' | '$' | '{' | '}' | '[' | ']' | '\\' => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out.push('$');
    out
}

pub(super) fn tool_glob(ctx: &ToolCtx, args: &Value) -> AppResult<String> {
    let pattern = args
        .get("pattern")
        .and_then(|v| v.as_str())
        .ok_or("缺少 pattern")?;
    let base = ctx.allowed_cwd.as_ref().ok_or("会话未设置 allowedCwd")?;
    let base_canon = fs::canonicalize(base)
        .map_err(|e| crate::error::AppError::from(format!("allowedCwd 无效: {}", e)))?;
    let files = glob_walk(&base_canon, pattern)?;
    if files.is_empty() {
        return Ok("（无匹配）".into());
    }
    let mut out = String::new();
    for f in files.iter().take(500) {
        out.push_str(&f.to_string_lossy());
        out.push('\n');
    }
    if files.len() > 500 {
        out.push_str(&format!("… 共 {} 个匹配，只展示前 500\n", files.len()));
    }
    Ok(out)
}

pub(super) fn tool_grep(ctx: &ToolCtx, args: &Value) -> AppResult<String> {
    let pattern = args
        .get("pattern")
        .and_then(|v| v.as_str())
        .ok_or("缺少 pattern")?;
    let glob = args.get("glob").and_then(|v| v.as_str()).unwrap_or("**/*");
    let base = ctx.allowed_cwd.as_ref().ok_or("会话未设置 allowedCwd")?;
    let base_canon = fs::canonicalize(base)
        .map_err(|e| crate::error::AppError::from(format!("allowedCwd 无效: {}", e)))?;
    let files = glob_walk(&base_canon, glob)?;
    let mut out = String::new();
    let mut hits = 0;
    for rel in files.iter() {
        let path = base_canon.join(rel);
        if path.metadata().map(|m| m.len() > 1_000_000).unwrap_or(true) {
            continue;
        }
        let text = match fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        for (i, line) in text.lines().enumerate() {
            if line.contains(pattern) {
                out.push_str(&format!("{}:{}: {}\n", rel.display(), i + 1, line.trim()));
                hits += 1;
                if hits >= 200 {
                    out.push_str("… 结果已截断至 200 行\n");
                    return Ok(out);
                }
            }
        }
    }
    if hits == 0 {
        Ok("（无匹配）".into())
    } else {
        Ok(out)
    }
}

#[cfg(test)]
mod glob_tests {
    use super::*;

    fn matches(pattern: &str, path: &str) -> bool {
        let re = regex::Regex::new(&glob_to_regex(pattern)).expect("pattern");
        re.is_match(path)
    }

    /// 中文 / emoji / 组合字符：旧的手写匹配器在这里既会 panic（按字节切片）
    /// 又匹配不上（`b as char` 把 UTF-8 字节按 Latin-1 解释）。
    #[test]
    fn non_ascii_names_match_and_never_panic() {
        assert!(matches("*.md", "读我.md"));
        assert!(matches("**/*.ts", "源码/组件/按钮.ts"));
        assert!(matches("文档/*.txt", "文档/说明.txt"));
        assert!(matches("*", "🙂.txt"));
        assert!(matches("*.rs", "e\u{301}moji-组合.rs")); // e + 组合重音
        assert!(matches("**/中文/*", "a/中文/b.rs"));

        // 不该匹配的也要正确拒绝
        assert!(!matches("*.md", "读我.txt"));
        assert!(!matches("*.ts", "源码/按钮.ts")); // 单星不跨 /
    }

    #[test]
    fn basic_glob_semantics_unchanged() {
        assert!(matches("*.rs", "main.rs"));
        assert!(!matches("*.rs", "src/main.rs")); // * 不跨目录分隔符
        assert!(matches("**/*.rs", "src/a/b/main.rs"));
        assert!(matches("src/*.rs", "src/main.rs"));
        assert!(matches("?.rs", "a.rs"));
        assert!(!matches("?.rs", "ab.rs"));
        // 点号是字面量，不是「任意字符」
        assert!(!matches("a.rs", "axrs"));
    }

    /// glob 里的正则元字符必须当**字面量**处理，否则用户搜 `a+b.txt`
    /// 会被解释成正则量词，匹配到一堆无关文件。
    #[test]
    fn regex_metacharacters_are_literal() {
        assert!(matches("a+b.txt", "a+b.txt"));
        assert!(!matches("a+b.txt", "aab.txt")); // `+` 不是量词
        assert!(matches("(x).rs", "(x).rs"));
        assert!(matches("a|b.md", "a|b.md"));
        assert!(!matches("a|b.md", "a.md")); // `|` 不是或
        assert!(matches("v1.2.3.log", "v1.2.3.log"));
        assert!(!matches("v1.2.3.log", "v1x2x3xlog")); // `.` 不是任意字符

        // 所有这些模式都必须能编译成合法正则，不会让 glob 直接失败
        for p in ["[", "]", "(", ")", "{", "}", "$", "^", "\\", "a+*.rs"] {
            assert!(
                regex::Regex::new(&glob_to_regex(p)).is_ok(),
                "模式 {p:?} 应能编译"
            );
        }
    }
}
