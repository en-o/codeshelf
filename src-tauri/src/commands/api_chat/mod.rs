//! ApiChat：通用 API 对话功能
//!
//! - 接口库：用户维护若干 Group（共享 BaseUrl + 鉴权）与 Endpoint（method/url/params_schema）。
//! - 对话会话：绑定多个 Endpoint；用户自然语言 → LLM via OpenAI Function Calling 挑接口 → 后端执行 HTTP → tool 消息回注。
//! - 鉴权：None / Bearer / Basic / ApiKey(header) / Session(登录拿 cookie 或 token)。
//!
//! 存储：
//!   - data_dir/api_groups.json   (Vec<ApiGroup>)
//!   - data_dir/api_endpoints.json (Vec<ApiEndpoint>)
//!   - data_dir/api_chat_sessions/<id>.json  (ApiChatSession)
//!
//! 子模块：
//! - groups:    Group CRUD
//! - endpoints: Endpoint CRUD
//! - sessions:  Session CRUD
//! - tools:     OpenAI function-calling tools 构造
//! - execute:   HTTP 执行 + 鉴权注入 + 在线文档抓取

use crate::error::AppResult;
use std::fs;
use std::path::{Path, PathBuf};

use crate::storage::{get_storage_config, ApiEndpoint, ApiGroup};

mod endpoints;
mod execute;
mod groups;
mod sessions;
mod tools;

pub use endpoints::*;
pub use execute::*;
pub use groups::*;
pub use sessions::*;
pub use tools::*;

// ============== 路径 / IO 辅助 ==============

pub(super) fn groups_file() -> AppResult<PathBuf> {
    Ok(get_storage_config()?.api_groups_file())
}

pub(super) fn endpoints_file() -> AppResult<PathBuf> {
    Ok(get_storage_config()?.api_endpoints_file())
}

pub(super) fn sessions_dir() -> AppResult<PathBuf> {
    Ok(get_storage_config()?.api_chat_sessions_dir())
}

pub(super) fn ensure_parent(path: &Path) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| crate::error::AppError::from(format!("创建目录失败: {}", e)))?;
    }
    Ok(())
}

pub(super) fn load_groups() -> AppResult<Vec<ApiGroup>> {
    let path = groups_file()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取 groups 失败: {}", e)))?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&content)
        .map_err(|e| crate::error::AppError::from(format!("解析 groups 失败: {}", e)))
}

pub(super) fn write_groups(groups: &[ApiGroup]) -> AppResult<()> {
    let path = groups_file()?;
    ensure_parent(&path)?;
    let content = serde_json::to_string_pretty(groups)
        .map_err(|e| crate::error::AppError::from(format!("序列化 groups 失败: {}", e)))?;
    crate::storage::write_atomic(&path, content)
        .map_err(|e| crate::error::AppError::from(format!("保存 groups 失败: {}", e)))
}

pub(super) fn load_endpoints() -> AppResult<Vec<ApiEndpoint>> {
    let path = endpoints_file()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取 endpoints 失败: {}", e)))?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&content)
        .map_err(|e| crate::error::AppError::from(format!("解析 endpoints 失败: {}", e)))
}

pub(super) fn write_endpoints(endpoints: &[ApiEndpoint]) -> AppResult<()> {
    let path = endpoints_file()?;
    ensure_parent(&path)?;
    let content = serde_json::to_string_pretty(endpoints)
        .map_err(|e| crate::error::AppError::from(format!("序列化 endpoints 失败: {}", e)))?;
    crate::storage::write_atomic(&path, content)
        .map_err(|e| crate::error::AppError::from(format!("保存 endpoints 失败: {}", e)))
}

pub(super) fn session_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{}.json", id))
}
