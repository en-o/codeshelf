//! 会话级任务（前端任务面板）：存储 + 工具实现 + Tauri 命令。

use crate::error::AppResult;
use std::fs;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::storage::{current_iso_time, generate_id};

use super::ctx::{session_tasks_path, ToolCtx};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatTask {
    pub id: String,
    pub subject: String,
    pub description: String,
    pub active_form: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

pub(super) fn read_tasks(session_id: &str) -> AppResult<Vec<ChatTask>> {
    let path = session_tasks_path(session_id)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取任务失败: {}", e)))?;
    serde_json::from_str(&text)
        .map_err(|e| crate::error::AppError::from(format!("解析任务失败: {}", e)))
}

pub(super) fn write_tasks(session_id: &str, tasks: &[ChatTask]) -> AppResult<()> {
    let path = session_tasks_path(session_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| crate::error::AppError::from(format!("创建目录失败: {}", e)))?;
    }
    let text = serde_json::to_string_pretty(tasks)
        .map_err(|e| crate::error::AppError::from(format!("序列化任务失败: {}", e)))?;
    crate::storage::write_atomic(&path, text).map_err(|e| crate::error::AppError::from(format!("写入任务失败: {}", e)))
}

pub(super) fn tool_task_create(ctx: &ToolCtx, args: &Value, app: &AppHandle) -> AppResult<String> {
    let subject = args
        .get("subject")
        .and_then(|v| v.as_str())
        .ok_or("缺少 subject")?;
    let description = args
        .get("description")
        .and_then(|v| v.as_str())
        .ok_or("缺少 description")?;
    let active_form = args
        .get("activeForm")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let mut tasks = read_tasks(&ctx.session_id)?;
    let task = ChatTask {
        id: generate_id(),
        subject: subject.to_string(),
        description: description.to_string(),
        active_form,
        status: "pending".to_string(),
        created_at: current_iso_time(),
        updated_at: current_iso_time(),
    };
    let task_id = task.id.clone();
    tasks.push(task);
    write_tasks(&ctx.session_id, &tasks)?;
    let _ = app.emit("chat-tasks-changed", json!({"sessionId": ctx.session_id}));
    Ok(format!("已创建任务 {}", task_id))
}

pub(super) fn tool_task_update(ctx: &ToolCtx, args: &Value, app: &AppHandle) -> AppResult<String> {
    let task_id = args
        .get("taskId")
        .and_then(|v| v.as_str())
        .ok_or("缺少 taskId")?;
    let mut tasks = read_tasks(&ctx.session_id)?;
    let t = tasks
        .iter_mut()
        .find(|t| t.id == task_id)
        .ok_or_else(|| crate::error::AppError::from(format!("任务不存在: {}", task_id)))?;
    if let Some(s) = args.get("status").and_then(|v| v.as_str()) {
        match s {
            "pending" | "in_progress" | "completed" => t.status = s.to_string(),
            _ => return Err(crate::error::AppError::from(format!("非法 status: {}", s))),
        }
    }
    if let Some(s) = args.get("subject").and_then(|v| v.as_str()) {
        t.subject = s.to_string();
    }
    if let Some(s) = args.get("description").and_then(|v| v.as_str()) {
        t.description = s.to_string();
    }
    t.updated_at = current_iso_time();
    write_tasks(&ctx.session_id, &tasks)?;
    let _ = app.emit("chat-tasks-changed", json!({"sessionId": ctx.session_id}));
    Ok("任务已更新".into())
}

pub(super) fn tool_task_list(ctx: &ToolCtx) -> AppResult<String> {
    let tasks = read_tasks(&ctx.session_id)?;
    if tasks.is_empty() {
        return Ok("（无任务）".into());
    }
    let mut out = String::new();
    for t in &tasks {
        out.push_str(&format!(
            "[{}] {} — {}\n    id={}\n",
            t.status, t.subject, t.description, t.id
        ));
    }
    Ok(out)
}

// ========== Tauri 命令 ==========

#[tauri::command]
#[specta::specta]
pub async fn list_chat_tasks(session_id: String) -> AppResult<Vec<ChatTask>> {
    read_tasks(&session_id)
}

#[tauri::command]
#[specta::specta]
pub async fn create_chat_task(
    app: AppHandle,
    session_id: String,
    subject: String,
    description: String,
    active_form: Option<String>,
) -> AppResult<ChatTask> {
    let mut tasks = read_tasks(&session_id)?;
    let task = ChatTask {
        id: generate_id(),
        subject,
        description,
        active_form,
        status: "pending".to_string(),
        created_at: current_iso_time(),
        updated_at: current_iso_time(),
    };
    let copy = task.clone();
    tasks.push(task);
    write_tasks(&session_id, &tasks)?;
    let _ = app.emit("chat-tasks-changed", json!({"sessionId": session_id}));
    Ok(copy)
}

#[tauri::command]
#[specta::specta]
pub async fn update_chat_task(
    app: AppHandle,
    session_id: String,
    task_id: String,
    status: Option<String>,
    subject: Option<String>,
    description: Option<String>,
) -> AppResult<ChatTask> {
    let mut tasks = read_tasks(&session_id)?;
    let t = tasks
        .iter_mut()
        .find(|t| t.id == task_id)
        .ok_or_else(|| crate::error::AppError::from(format!("任务不存在: {}", task_id)))?;
    if let Some(s) = status {
        t.status = s;
    }
    if let Some(s) = subject {
        t.subject = s;
    }
    if let Some(s) = description {
        t.description = s;
    }
    t.updated_at = current_iso_time();
    let copy = t.clone();
    write_tasks(&session_id, &tasks)?;
    let _ = app.emit("chat-tasks-changed", json!({"sessionId": session_id}));
    Ok(copy)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_chat_task(
    app: AppHandle,
    session_id: String,
    task_id: String,
) -> AppResult<()> {
    let mut tasks = read_tasks(&session_id)?;
    tasks.retain(|t| t.id != task_id);
    write_tasks(&session_id, &tasks)?;
    let _ = app.emit("chat-tasks-changed", json!({"sessionId": session_id}));
    Ok(())
}
