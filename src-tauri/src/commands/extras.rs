//! Memory / Skills / Mention 相关后端命令

use crate::error::AppResult;
use std::fs;
use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::storage::get_storage_config;

// ========== Memory ==========

#[tauri::command]
#[specta::specta]
pub async fn get_global_memory() -> AppResult<String> {
    let config = get_storage_config()?;
    let path = config.memory_file();
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取 MEMORY 失败: {}", e)))
}

#[tauri::command]
#[specta::specta]
pub async fn save_global_memory(content: String) -> AppResult<()> {
    let config = get_storage_config()?;
    let path = config.memory_file();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| crate::error::AppError::from(format!("创建目录失败: {}", e)))?;
    }
    crate::storage::write_atomic(&path, content).map_err(|e| crate::error::AppError::from(format!("保存失败: {}", e)))
}

// ========== Skills ==========

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub args_hint: Option<String>,
    pub body: String,
}

fn parse_skill(text: &str, default_name: &str) -> Skill {
    // 极简 frontmatter 解析：若以 "---\n" 开头则读取 key: value 行
    let mut name = default_name.to_string();
    let mut description = String::new();
    let mut args_hint: Option<String> = None;
    let mut body = text.to_string();
    if let Some(rest) = text.strip_prefix("---\n") {
        if let Some(end_idx) = rest.find("\n---\n") {
            let front = &rest[..end_idx];
            body = rest[end_idx + 5..].to_string();
            for line in front.lines() {
                if let Some((k, v)) = line.split_once(':') {
                    let key = k.trim();
                    let value = v.trim().trim_matches('"').to_string();
                    match key {
                        "name" => name = value,
                        "description" => description = value,
                        "args" | "argsHint" => args_hint = Some(value),
                        _ => {}
                    }
                }
            }
        }
    }
    Skill {
        name,
        description,
        args_hint,
        body,
    }
}

fn bundled_skills() -> Vec<(&'static str, &'static str)> {
    vec![
        (
            "code-review.md",
            r#"---
name: code-review
description: 对当前引用文件/仓库做代码审查，指出风险与改进点
args: "[files]"
---
请以资深工程师视角审查以下代码：

{args}

关注：
- 明显 bug、边界条件、错误处理缺失
- 安全漏洞（输入校验、注入、鉴权）
- 性能热点
- 可读性与命名
- 是否可以复用已有工具/函数避免重复实现

按"严重度：should-fix / nice-to-have"分组输出，每条给出文件/行号定位。
"#,
        ),
        (
            "commit-message.md",
            r#"---
name: commit-message
description: 根据 git diff 生成符合 Conventional Commits 的中文提交信息
args: "[optional scope]"
---
阅读当前仓库的 `git diff --staged`，用 Conventional Commits 规范生成一条简短中文提交信息。
要求：
- 首行 ≤ 50 字符，格式 `<type>(<scope>): <summary>`
- 正文（可选）解释 why 而非 what
- 若 {args} 非空，用它作为 scope
"#,
        ),
        (
            "debug.md",
            r#"---
name: debug
description: 定位一个问题：通读相关代码/日志，给出根因与修复建议
args: "[现象/错误信息]"
---
问题现象：{args}

请：
1. 使用 Grep/Read 工具搜索相关代码
2. 用最小因果链解释为什么会出现该现象
3. 给出修复建议，必要时用 Edit 工具写补丁
"#,
        ),
        (
            "translate-readme.md",
            r#"---
name: translate-readme
description: 将 README.md 翻译为指定语言
args: "<目标语言>，如 en / ja"
---
阅读项目根目录的 `README.md` 并翻译为 {args}。
- 保留 markdown 结构与代码块
- 技术术语保留原文
- 命令、路径不翻译
翻译完成后写入 `README.{args}.md`。
"#,
        ),
    ]
}

fn ensure_skills_dir() -> AppResult<std::path::PathBuf> {
    let config = get_storage_config()?;
    let dir = config.skills_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| crate::error::AppError::from(format!("创建目录失败: {}", e)))?;
        // 首次初始化：拷贝 bundled
        for (fname, body) in bundled_skills() {
            let p = dir.join(fname);
            if !p.exists() {
                let _ = fs::write(&p, body);
            }
        }
    }
    Ok(dir)
}

#[tauri::command]
#[specta::specta]
pub async fn list_skills() -> AppResult<Vec<Skill>> {
    let dir = ensure_skills_dir()?;
    let mut out = Vec::new();
    for entry in
        fs::read_dir(&dir).map_err(|e| crate::error::AppError::from(format!("读取失败: {}", e)))?
    {
        let entry = entry.map_err(|e| crate::error::AppError::from(format!("读取失败: {}", e)))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let default_name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("skill")
            .to_string();
        let text = fs::read_to_string(&path).unwrap_or_default();
        out.push(parse_skill(&text, &default_name));
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn save_skill(skill: Skill) -> AppResult<()> {
    let dir = ensure_skills_dir()?;
    let fname = format!("{}.md", sanitize_name(&skill.name));
    let path = dir.join(fname);
    let content = format!(
        "---\nname: {}\ndescription: {}\nargs: {}\n---\n{}",
        skill.name,
        skill.description,
        skill.args_hint.as_deref().unwrap_or(""),
        skill.body
    );
    crate::storage::write_atomic(&path, content).map_err(|e| crate::error::AppError::from(format!("保存失败: {}", e)))
}

#[tauri::command]
#[specta::specta]
pub async fn delete_skill(name: String) -> AppResult<()> {
    let dir = ensure_skills_dir()?;
    let fname = format!("{}.md", sanitize_name(&name));
    let path = dir.join(fname);
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| crate::error::AppError::from(format!("删除失败: {}", e)))?;
    }
    Ok(())
}

fn sanitize_name(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

// ========== 文件 @mention：读取文件内容（相对指定根目录） ==========

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MentionFileEntry {
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn list_dir_entries(root: String, max: Option<u32>) -> AppResult<Vec<MentionFileEntry>> {
    let cap = max.unwrap_or(5000) as usize;
    let mut out: Vec<MentionFileEntry> = Vec::new();
    let root_path = Path::new(&root);
    if !root_path.exists() {
        return Err("目录不存在".into());
    }
    walk_for_mention(root_path, root_path, &mut out, cap, 0)?;
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

fn should_skip_mention_name(fname: &str) -> bool {
    fname.starts_with('.')
        || matches!(
            fname,
            "node_modules" | "target" | "dist" | "build" | ".next" | ".cache"
        )
}

fn walk_for_mention(
    base: &Path,
    dir: &Path,
    out: &mut Vec<MentionFileEntry>,
    cap: usize,
    depth: u32,
) -> AppResult<()> {
    if out.len() >= cap || depth > 32 {
        return Ok(());
    }
    let mut entries: Vec<_> = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    }
    .flatten()
    .collect();
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());
    for entry in entries {
        if out.len() >= cap {
            return Ok(());
        }
        let path = entry.path();
        let fname = entry.file_name().to_string_lossy().to_string();
        if should_skip_mention_name(&fname) {
            continue;
        }
        let rel = path
            .strip_prefix(base)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let is_dir = path.is_dir();
        out.push(MentionFileEntry {
            path: rel.clone(),
            is_dir,
        });
        if is_dir {
            walk_for_mention(base, &path, out, cap, depth + 1)?;
        }
    }
    Ok(())
}

struct MentionDirReadState {
    files_read: usize,
    total_bytes: u64,
    truncated: bool,
}

fn looks_like_text(buf: &[u8]) -> bool {
    !buf.iter().take(4096).any(|b| *b == 0)
}

fn read_mention_file_bytes(path: &Path, max_bytes: u64) -> AppResult<(String, bool, u64)> {
    let meta = fs::metadata(path)
        .map_err(|e| crate::error::AppError::from(format!("读取元信息失败: {}", e)))?;
    let file = fs::File::open(path)
        .map_err(|e| crate::error::AppError::from(format!("打开失败: {}", e)))?;
    let mut buf = Vec::new();
    file.take(max_bytes + 1)
        .read_to_end(&mut buf)
        .map_err(|e| crate::error::AppError::from(format!("读取失败: {}", e)))?;
    let truncated = buf.len() as u64 > max_bytes;
    if truncated {
        buf.truncate(max_bytes as usize);
    }
    if !looks_like_text(&buf) {
        return Err("跳过二进制文件".into());
    }
    let text = String::from_utf8_lossy(&buf).into_owned();
    Ok((text, truncated, meta.len()))
}

fn read_mention_dir(
    base: &Path,
    dir: &Path,
    out: &mut Vec<String>,
    state: &mut MentionDirReadState,
    max_files: usize,
    max_total_bytes: u64,
    depth: u32,
) -> AppResult<()> {
    if state.files_read >= max_files || state.total_bytes >= max_total_bytes || depth > 32 {
        state.truncated = true;
        return Ok(());
    }

    let mut entries: Vec<_> = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    }
    .flatten()
    .collect();
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());

    for entry in entries {
        if state.files_read >= max_files || state.total_bytes >= max_total_bytes {
            state.truncated = true;
            return Ok(());
        }

        let path = entry.path();
        let fname = entry.file_name().to_string_lossy().to_string();
        if should_skip_mention_name(&fname) {
            continue;
        }

        if path.is_dir() {
            read_mention_dir(
                base,
                &path,
                out,
                state,
                max_files,
                max_total_bytes,
                depth + 1,
            )?;
            continue;
        }

        if !path.is_file() {
            continue;
        }

        let remaining = max_total_bytes.saturating_sub(state.total_bytes);
        if remaining == 0 {
            state.truncated = true;
            return Ok(());
        }

        let rel = path
            .strip_prefix(base)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        match read_mention_file_bytes(&path, remaining.min(200_000)) {
            Ok((text, file_truncated, original_len)) => {
                state.files_read += 1;
                state.total_bytes += text.len() as u64;
                out.push(format!("\n### {}\n```\n{}\n```", rel, text));
                if file_truncated || original_len > 200_000 {
                    out.push(format!(
                        "\n[{} 已截断，原始大小 {} 字节]",
                        rel, original_len
                    ));
                }
            }
            Err(_) => {
                continue;
            }
        }
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn read_mention_file(root: String, rel_path: String) -> AppResult<String> {
    const MAX_MENTION_FILE_BYTES: u64 = 1_000_000;
    const MAX_MENTION_DIR_BYTES: u64 = 1_000_000;
    const MAX_MENTION_DIR_FILES: usize = 80;

    let root_canon = fs::canonicalize(&root)
        .map_err(|e| crate::error::AppError::from(format!("根目录无效: {}", e)))?;
    let full = root_canon.join(&rel_path);
    let canon = fs::canonicalize(&full)
        .map_err(|e| crate::error::AppError::from(format!("路径无效: {}", e)))?;
    if !canon.starts_with(&root_canon) {
        return Err("路径越界".into());
    }
    let meta = fs::metadata(&canon)
        .map_err(|e| crate::error::AppError::from(format!("读取元信息失败: {}", e)))?;
    if meta.is_dir() {
        let mut sections = vec![format!("[引用目录] {}", rel_path)];
        let mut state = MentionDirReadState {
            files_read: 0,
            total_bytes: 0,
            truncated: false,
        };
        read_mention_dir(
            &canon,
            &canon,
            &mut sections,
            &mut state,
            MAX_MENTION_DIR_FILES,
            MAX_MENTION_DIR_BYTES,
            0,
        )?;
        if state.files_read == 0 {
            return Err("目录下没有可读取的文本文件".into());
        }
        if state.truncated {
            sections.push(format!(
                "\n[目录内容已截断，仅加载前 {} 个文件 / {} KB]",
                state.files_read,
                MAX_MENTION_DIR_BYTES / 1024
            ));
        }
        return Ok(sections.join("\n"));
    }
    let (text, truncated, original_len) = read_mention_file_bytes(&canon, MAX_MENTION_FILE_BYTES)?;
    if truncated {
        Ok(format!(
            "{}\n\n[文件过大（{} 字节），仅加载前 {} KB]",
            text,
            original_len,
            MAX_MENTION_FILE_BYTES / 1024
        ))
    } else {
        Ok(text)
    }
}
