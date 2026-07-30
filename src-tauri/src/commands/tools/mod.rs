//! Chat agentic 工具集 —— 子模块入口与执行调度。
//!
//! 提供 Read/Write/Edit/Glob/Grep/Bash 文件系统 & shell 工具，
//! 以及会话级 TaskCreate/TaskUpdate/TaskList 任务工具。
//!
//! 工具执行不负责授权——授权由前端弹窗决定；后端只做 sandbox 级路径校验。
//!
//! 模块拆分：
//! - ctx        会话上下文、路径校验、~ 展开、输出截断
//! - schema     ToolSchema + all_tools()（含平台感知的 LLM 提示）
//! - tasks      ChatTask 存储 + TaskCreate/Update/List + Tauri 命令
//! - fs_ops     Read/Write/Edit/Glob/Grep（含极简 glob→regex）
//! - shell      Bash（Unix /bin/sh -c / Windows cmd /C）
//! - os_open    OpenPath/OpenInEditor/OpenTerminal/OpenUrl
//! - file_ops   CopyFile/MoveFile/DeleteFile
//! - web_fetch  WebFetch（工作流也复用）

use crate::error::AppResult;
use serde_json::Value;
use tauri::AppHandle;

mod ctx;
mod file_ops;
mod fs_ops;
mod os_open;
mod schema;
mod shell;
pub mod tasks;
mod web_fetch;

// 对外稳定 API（lib.rs / chat 模块 / workflows 模块都依赖以下符号）
pub use schema::{all_tools, ToolSchema};
pub use web_fetch::run_web_fetch_for_workflow;

pub async fn execute_tool(
    app: &AppHandle,
    session_id: &str,
    tool_name: &str,
    arguments_json: &str,
) -> AppResult<String> {
    let ctx = ctx::load_ctx(session_id).await?;
    let args: Value =
        serde_json::from_str(arguments_json).unwrap_or(Value::Object(Default::default()));
    match tool_name {
        "Read" => fs_ops::tool_read(&ctx, &args),
        "Write" => fs_ops::tool_write(&ctx, &args),
        "Edit" => fs_ops::tool_edit(&ctx, &args),
        "Glob" => fs_ops::tool_glob(&ctx, &args),
        "Grep" => fs_ops::tool_grep(&ctx, &args),
        "Bash" => shell::tool_bash(&ctx, &args).await,
        "TaskCreate" => tasks::tool_task_create(&ctx, &args, app),
        "TaskUpdate" => tasks::tool_task_update(&ctx, &args, app),
        "TaskList" => tasks::tool_task_list(&ctx),
        "WebFetch" => web_fetch::tool_web_fetch(&args).await,
        "OpenPath" => os_open::tool_open_path(&args).await,
        "OpenInEditor" => os_open::tool_open_in_editor(&args).await,
        "OpenTerminal" => os_open::tool_open_terminal(&args).await,
        "OpenUrl" => os_open::tool_open_url(&args).await,
        "CopyFile" => file_ops::tool_copy_file(&ctx, &args),
        "MoveFile" => file_ops::tool_move_file(&ctx, &args),
        "DeleteFile" => file_ops::tool_delete_file(&ctx, &args),
        "CreateWorkflow" => crate::commands::workflows::tool_create_workflow(&args, app).await,
        "RunWorkflowNow" => crate::commands::workflows::tool_run_workflow_now(&args, app).await,
        "ListWorkflows" => crate::commands::workflows::tool_list_workflows(app).await,
        _ => Err(crate::error::AppError::from(format!(
            "未知工具: {}",
            tool_name
        ))),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn chat_list_tools() -> AppResult<Vec<ToolSchema>> {
    Ok(all_tools())
}

#[tauri::command]
#[specta::specta]
pub async fn chat_execute_tool(
    app: AppHandle,
    session_id: String,
    tool_name: String,
    arguments_json: String,
) -> AppResult<String> {
    execute_tool(&app, &session_id, &tool_name, &arguments_json).await
}
