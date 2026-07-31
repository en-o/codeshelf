// Git 工具模块：类型、共享 helpers 与子模块声明

use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

mod branches;
mod clone;
mod commits;
mod remotes;
mod scan;
mod staging;
mod status;

pub use branches::*;
pub use clone::*;
pub use commits::*;
pub use remotes::*;
pub use scan::*;
pub use staging::*;
pub use status::*;

/// Windows: CREATE_NO_WINDOW flag to hide console window
#[cfg(target_os = "windows")]
pub(super) const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct GitStatus {
    pub branch: String,
    pub is_clean: bool,
    pub staged: Vec<String>,
    pub unstaged: Vec<String>,
    pub untracked: Vec<String>,
    pub conflicted: Vec<String>,
    pub ahead: u32,
    pub behind: u32,
    /// `ahead`/`behind` 是相对 `@{upstream}` 算的。把 upstream 究竟是谁一起报出来，
    /// 界面才能保证「统计的目标」和「push/pull 的目标」是同一个 —— 以前界面拿
    /// remotes[0] 当默认远程，统计却来自 upstream，两者可以指向不同仓库。
    /// 没有设置 upstream 时为 None，此时 ahead/behind 都是 0。
    pub upstream_remote: Option<String>,
    pub upstream_branch: Option<String>,
}

/// 单个分支的同步结果。
#[derive(Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncBranchResult {
    pub branch: String,
    pub ok: bool,
    pub is_default: bool,
    /// 失败原因；成功时为 None
    pub error: Option<String>,
}

/// 同步整体结果。
///
/// 以前返回的是一个把 `✗ branch: err` 拼进去的字符串，且**永远是 Ok** ——
/// 全部分支推送失败时前端照样弹「同步成功」然后关窗。改成结构化结果，
/// 让前端能区分全成功 / 部分失败，并且失败明细不会被折叠进一句提示里。
#[derive(Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub target_remote: String,
    pub succeeded: u32,
    pub failed: u32,
    pub branches: Vec<SyncBranchResult>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct ConflictFileContent {
    pub file: String,
    pub base: Option<String>,
    pub current: Option<String>,
    pub incoming: Option<String>,
    pub worktree: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub email: String,
    pub date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_changed: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub insertions: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletions: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refs: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_hashes: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CommitFileChange {
    pub insertions: u32,
    pub deletions: u32,
    pub filename: String,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
    pub fetch_url: Option<String>,
    pub push_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct GitRepo {
    pub path: String,
    pub name: String,
}

#[derive(Clone, serde::Serialize, specta::Type)]
pub struct GitCloneProgress {
    pub phase: String,
    pub percent: i32,
    pub message: String,
}

/// 执行 `git -C <path> <args>` 并返回 stdout（trim 后），失败返回 stderr
pub(super) fn run_git_command(path: &str, args: &[&str]) -> AppResult<String> {
    #[cfg(target_os = "windows")]
    let output = Command::new("git")
        .args(["-C", path])
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| crate::error::AppError::from(e.to_string()))?;

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("git")
        .args(["-C", path])
        .args(args)
        .output()
        .map_err(|e| crate::error::AppError::from(e.to_string()))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(crate::error::AppError::from(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ))
    }
}

/// 与 `run_git_command` 相同，但返回**原始字节**且不做 trim。
///
/// `--porcelain -z` 的输出以 NUL 分隔、条目以 NUL 结尾，trim 会破坏最后一条；
/// 而且路径可能不是合法 UTF-8，先转 String 会丢信息。解析方自己决定怎么处理。
pub(super) fn run_git_command_raw(path: &str, args: &[&str]) -> AppResult<Vec<u8>> {
    #[cfg(target_os = "windows")]
    let output = Command::new("git")
        .args(["-C", path])
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| crate::error::AppError::from(e.to_string()))?;

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("git")
        .args(["-C", path])
        .args(args)
        .output()
        .map_err(|e| crate::error::AppError::from(e.to_string()))?;

    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(crate::error::AppError::from(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ))
    }
}

/// `run_git_command` 的异步版：在阻塞线程池里跑，不占用 tokio worker。
///
/// 本地 git 操作（status/log/branch）是毫秒级，直接调同步版即可；但**网络类操作**
/// （push/pull/fetch/clone）耗时可达分钟级，在 async 命令里直接调同步版会把
/// tokio worker 线程占满整个时长，导致其它 IPC 命令排队、界面转圈。
pub(super) async fn run_git_command_async(path: String, args: Vec<String>) -> AppResult<String> {
    tokio::task::spawn_blocking(move || {
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        run_git_command(&path, &arg_refs)
    })
    .await
    .map_err(|e| crate::error::AppError::from(format!("git 任务调度失败: {}", e)))?
}

pub(super) fn is_system_junk_file(file: &str) -> bool {
    std::path::Path::new(file)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name == ".DS_Store")
        .unwrap_or(false)
}

