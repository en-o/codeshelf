use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::RwLock;

use crate::error::{AppError, AppResult};
use crate::storage::schema::{AiProviderConfig, Project};
use crate::storage::get_storage_config;

const RUN_EVENT: &str = "resume-agent-run-event-v3";

static RUN_PIDS: Lazy<Arc<RwLock<HashMap<String, u32>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum NodeJobDirection {
    Backend,
    Frontend,
    Fullstack,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum NodeTone {
    Professional,
    Concise,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ToolPermissionMode {
    ReadOnly,
    WorkspaceWrite,
    FullAgent,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RunResumeDeepAgentRequest {
    pub request_id: String,
    pub project_id: String,
    pub provider: AiProviderConfig,
    pub job_direction: NodeJobDirection,
    pub jd_keywords: Vec<String>,
    pub tone: NodeTone,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_config: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_permission_mode: Option<ToolPermissionMode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeInput {
    pub project_id: String,
    pub project_name: String,
    pub project_path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GenerateResumeFromKnowledgeRequest {
    pub request_id: String,
    pub provider: AiProviderConfig,
    pub job_direction: NodeJobDirection,
    pub jd_keywords: Vec<String>,
    pub tone: NodeTone,
    pub knowledge_docs: Vec<KnowledgeInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_config: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GenerateResumeFragmentRequest {
    pub request_id: String,
    pub provider: AiProviderConfig,
    pub job_direction: NodeJobDirection,
    pub jd_keywords: Vec<String>,
    pub tone: NodeTone,
    pub knowledge_docs: Vec<KnowledgeInput>,
    pub fragment: Value,
}

#[tauri::command]
#[specta::specta]
pub async fn run_resume_deep_agent(
    app: AppHandle,
    request: RunResumeDeepAgentRequest,
) -> AppResult<Value> {
    let project = load_project(&request.project_id).await?;
    let data_dir = get_storage_config()?.data_dir.to_string_lossy().to_string();
    let sensitive_rules = crate::commands::settings::load_sensitive_file_patterns()
        .unwrap_or_else(|_| crate::commands::settings::default_sensitive_file_patterns())
        .into_iter()
        .map(|pattern| json!({ "pattern": pattern, "enabled": true }))
        .collect::<Vec<_>>();

    let params = json!({
        "requestId": request.request_id,
        "project": {
            "id": project.id,
            "name": project.name,
            "path": project.path,
            "tags": project.tags,
            "labels": project.labels,
        },
        "provider": request.provider,
        "jobDirection": request.job_direction,
        "jdKeywords": request.jd_keywords,
        "tone": request.tone,
        "dataDir": data_dir,
        "sensitiveRules": sensitive_rules,
        "promptConfig": request.prompt_config,
        "toolPermissionMode": request.tool_permission_mode.unwrap_or(ToolPermissionMode::ReadOnly),
    });
    call_node_rpc_with_events(
        Some(app),
        "run_agent",
        params,
        Some(request.request_id.clone()),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn generate_resume_from_knowledge(
    app: AppHandle,
    request: GenerateResumeFromKnowledgeRequest,
) -> AppResult<Value> {
    let params = json!({
        "requestId": request.request_id,
        "provider": request.provider,
        "jobDirection": request.job_direction,
        "jdKeywords": request.jd_keywords,
        "tone": request.tone,
        "dataDir": data_dir_string()?,
        "knowledgeDocs": request.knowledge_docs,
        "promptConfig": request.prompt_config,
    });
    call_node_rpc_with_events(
        Some(app),
        "generate_resume",
        params,
        Some(request.request_id.clone()),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn generate_resume_fragment(
    app: AppHandle,
    request: GenerateResumeFragmentRequest,
) -> AppResult<Value> {
    let params = json!({
        "requestId": request.request_id,
        "provider": request.provider,
        "jobDirection": request.job_direction,
        "jdKeywords": request.jd_keywords,
        "tone": request.tone,
        "dataDir": data_dir_string()?,
        "knowledgeDocs": request.knowledge_docs,
        "fragment": request.fragment,
    });
    call_node_rpc_with_events(
        Some(app),
        "generate_resume_fragment",
        params,
        Some(request.request_id.clone()),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_resume_deep_agent(request_id: String) -> AppResult<()> {
    if let Some(pid) = RUN_PIDS.write().await.remove(&request_id) {
        kill_process_tree(pid).await;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_resume_agent_runs(app: AppHandle, project_id: String) -> AppResult<Value> {
    call_node_rpc(
        app,
        "get_runs",
        json!({
            "dataDir": data_dir_string()?,
            "projectId": project_id,
        }),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn read_resume_agent_artifact(
    app: AppHandle,
    project_id: String,
    artifact_id: String,
) -> AppResult<Value> {
    call_node_rpc(
        app,
        "read_artifact",
        json!({
            "dataDir": data_dir_string()?,
            "projectId": project_id,
            "artifactId": artifact_id,
        }),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_resume_agent_prompt_config(app: AppHandle) -> AppResult<Value> {
    call_node_rpc(
        app,
        "get_prompt_config",
        json!({ "dataDir": data_dir_string()? }),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn save_resume_agent_prompt_config(app: AppHandle, config: Value) -> AppResult<Value> {
    call_node_rpc(
        app,
        "save_prompt_config",
        json!({
            "dataDir": data_dir_string()?,
            "config": config,
        }),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn reset_resume_agent_prompt_config(app: AppHandle) -> AppResult<Value> {
    call_node_rpc(
        app,
        "reset_prompt_config",
        json!({ "dataDir": data_dir_string()? }),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn load_resume_agent_background(app: AppHandle, project_id: String) -> AppResult<Option<String>> {
    let value = call_node_rpc(
        app,
        "load_background",
        json!({
            "dataDir": data_dir_string()?,
            "projectId": project_id,
        }),
    )
    .await?;
    Ok(value.as_str().map(|s| s.to_string()))
}

#[tauri::command]
#[specta::specta]
pub async fn save_resume_agent_background(
    app: AppHandle,
    project_id: String,
    content: String,
) -> AppResult<()> {
    let _ = call_node_rpc(
        app,
        "save_background",
        json!({
            "dataDir": data_dir_string()?,
            "projectId": project_id,
            "content": content,
        }),
    )
    .await?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn list_resume_agent_background(app: AppHandle) -> AppResult<Value> {
    call_node_rpc(
        app,
        "list_background",
        json!({ "dataDir": data_dir_string()? }),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_resume_agent_background(app: AppHandle, project_id: String) -> AppResult<()> {
    let _ = call_node_rpc(
        app,
        "delete_background",
        json!({
            "dataDir": data_dir_string()?,
            "projectId": project_id,
        }),
    )
    .await?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_resume_agent_runs(app: AppHandle, project_id: String) -> AppResult<()> {
    let _ = call_node_rpc(
        app,
        "delete_runs",
        json!({
            "dataDir": data_dir_string()?,
            "projectId": project_id,
        }),
    )
    .await?;
    Ok(())
}

fn data_dir_string() -> AppResult<String> {
    Ok(get_storage_config()?.data_dir.to_string_lossy().to_string())
}

async fn call_node_rpc(app: AppHandle, method: &str, params: Value) -> AppResult<Value> {
    call_node_rpc_with_events(Some(app), method, params, None).await
}

async fn call_node_rpc_with_events(
    app: Option<AppHandle>,
    method: &str,
    params: Value,
    request_id_for_pid: Option<String>,
) -> AppResult<Value> {
    let runtime = node_agent_runtime(app.as_ref())?;
    let mut child = Command::new(&runtime.node_executable)
        .arg(&runtime.entry_script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::from(format!("启动 Node resume agent 失败: {}", e)))?;

    if let (Some(request_id), Some(pid)) = (request_id_for_pid.clone(), child.id()) {
        RUN_PIDS.write().await.insert(request_id, pid);
    }

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::from("Node resume agent stdin 不可用"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::from("Node resume agent stdout 不可用"))?;
    let stderr = child.stderr.take();

    let rpc_id = format!("rpc-{}", chrono::Utc::now().timestamp_micros());
    let payload = json!({ "id": rpc_id, "method": method, "params": params });
    stdin
        .write_all(format!("{}\n", payload).as_bytes())
        .await
        .map_err(|e| AppError::from(format!("写入 Node resume agent 请求失败: {}", e)))?;
    drop(stdin);

    let stderr_task = tokio::spawn(async move {
        let Some(stderr) = stderr else {
            return String::new();
        };
        let mut lines = BufReader::new(stderr).lines();
        let mut out = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            out.push_str(&line);
            out.push('\n');
        }
        out
    });

    let mut lines = BufReader::new(stdout).lines();
    let mut response: Option<Value> = None;
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| AppError::from(format!("读取 Node resume agent 输出失败: {}", e)))?
    {
        let parsed: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if parsed.get("type").and_then(|v| v.as_str()) == Some("event") {
            if let Some(app) = app.as_ref() {
                let _ = app.emit(RUN_EVENT, parsed);
            }
            continue;
        }
        if parsed.get("id").and_then(|v| v.as_str()) == Some(rpc_id.as_str()) {
            response = Some(parsed);
            break;
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| AppError::from(format!("等待 Node resume agent 退出失败: {}", e)))?;
    if let Some(request_id) = request_id_for_pid {
        RUN_PIDS.write().await.remove(&request_id);
    }
    let stderr_text = stderr_task.await.unwrap_or_default();
    let Some(response) = response else {
        return Err(AppError::from(format!(
            "Node resume agent 无响应, status={}, stderr={}",
            status, stderr_text
        )));
    };
    if response.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    } else {
        Err(AppError::from(
            response
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Node resume agent 调用失败")
                .to_string(),
        ))
    }
}

#[derive(Debug, Clone)]
struct NodeAgentRuntime {
    node_executable: PathBuf,
    entry_script: PathBuf,
}

/// Windows 上 canonicalize 过的路径带 `\\?\` verbatim 前缀（Tauri 的 resource_dir()
/// 基于 canonicalize 后的 exe 路径派生，打包安装后必然带该前缀）。Node 的入口模块
/// 解析器（resolveMainPath -> realpathSync）不支持 verbatim 路径，会报
/// `EISDIR: illegal operation on a directory, lstat '盘符:'` 并以 exit code 1 退出。
/// 传给子进程前必须剥掉该前缀。
fn simplify_verbatim_path(path: PathBuf) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let text = path.as_os_str().to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{}", rest));
        }
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(rest.to_string());
        }
    }
    path
}

fn make_node_runtime(node_executable: PathBuf, entry_script: PathBuf) -> NodeAgentRuntime {
    NodeAgentRuntime {
        node_executable: simplify_verbatim_path(node_executable),
        entry_script: simplify_verbatim_path(entry_script),
    }
}

fn node_agent_runtime(app: Option<&AppHandle>) -> AppResult<NodeAgentRuntime> {
    let cwd = std::env::current_dir()
        .map_err(|e| AppError::from(format!("获取当前目录失败: {}", e)))?;

    #[cfg(target_os = "windows")]
    let local_sidecar_candidates = [
        (
            cwd.join("src-tauri/resources/sidecars/node/node.exe"),
            cwd.join("src-tauri/resources/sidecars/resume-agent/main.cjs"),
        ),
        (
            cwd.join("../src-tauri/resources/sidecars/node/node.exe"),
            cwd.join("../src-tauri/resources/sidecars/resume-agent/main.cjs"),
        ),
    ];
    #[cfg(not(target_os = "windows"))]
    let local_sidecar_candidates = [
        (
            cwd.join("src-tauri/resources/sidecars/node/node"),
            cwd.join("src-tauri/resources/sidecars/resume-agent/main.cjs"),
        ),
        (
            cwd.join("../src-tauri/resources/sidecars/node/node"),
            cwd.join("../src-tauri/resources/sidecars/resume-agent/main.cjs"),
        ),
    ];
    if let Some((node_executable, entry_script)) = local_sidecar_candidates
        .into_iter()
        .find(|(node, entry)| node.exists() && entry.exists())
    {
        return Ok(make_node_runtime(node_executable, entry_script));
    }

    let dev_entry_candidates = [
        cwd.join("src-node/resume-agent/dist/main.js"),
        cwd.join("../src-node/resume-agent/dist/main.js"),
    ];
    if let Some(entry_script) = dev_entry_candidates.into_iter().find(|path| path.exists()) {
        return Ok(make_node_runtime(PathBuf::from("node"), entry_script));
    }

    // 装机后的资源目录：正常情况下 resource_dir() 就在 exe 旁边，拼 sidecars/… 即可。
    // 但 Windows 自定义安装目录、或 NSIS 把资源套进 productName 子目录（观察到
    // exe 在 c:/test/、资源却在 c:/test/CodeShelf/sidecars/…，两者不同层）时，单一路径
    // 拼不出来。这里收集多个候选根 + productName 子目录，逐个 .exists() 命中即用；
    // 对 macOS/Linux 无影响（第一个候选 resource_dir() 仍会正常命中）。
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(dir) = app.and_then(|handle| handle.path().resource_dir().ok()) {
        roots.push(dir);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            roots.push(parent.to_path_buf());
            roots.push(parent.join("resources"));
            // exe 名去掉后缀作为可能的资源子目录名（通用兜底）
            if let Some(stem) = exe.file_stem() {
                roots.push(parent.join(stem));
            }
        }
    }
    if roots.is_empty() {
        return Err(AppError::from(
            "未找到内置 Node resume agent 资源目录".to_string(),
        ));
    }

    #[cfg(target_os = "windows")]
    let node_rel = "sidecars/node/node.exe";
    #[cfg(not(target_os = "windows"))]
    let node_rel = "sidecars/node/node";
    let entry_rel = "sidecars/resume-agent/main.cjs";

    // productName 目录名：Windows NSIS 可能把资源多套进这一层
    let product = "CodeShelf";
    for root in &roots {
        for base in [root.clone(), root.join(product)] {
            let node = base.join(node_rel);
            let entry = base.join(entry_rel);
            if node.exists() && entry.exists() {
                return Ok(make_node_runtime(node, entry));
            }
        }
    }

    Err(AppError::from(
        "未找到内置 Node resume agent，请重新执行应用打包构建。".to_string(),
    ))
}

async fn load_project(project_id: &str) -> AppResult<Project> {
    crate::commands::project::get_projects()
        .await?
        .into_iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| AppError::from(format!("项目不存在: {}", project_id)))
}

async fn kill_process_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .await;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .output()
            .await;
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn simplify_verbatim_path_strips_prefix() {
        assert_eq!(
            simplify_verbatim_path(PathBuf::from(
                r"\\?\F:\apps\CodeShelf\sidecars\resume-agent\main.cjs"
            )),
            PathBuf::from(r"F:\apps\CodeShelf\sidecars\resume-agent\main.cjs")
        );
        assert_eq!(
            simplify_verbatim_path(PathBuf::from(r"\\?\UNC\server\share\main.cjs")),
            PathBuf::from(r"\\server\share\main.cjs")
        );
        assert_eq!(
            simplify_verbatim_path(PathBuf::from(r"F:\apps\main.cjs")),
            PathBuf::from(r"F:\apps\main.cjs")
        );
    }
}
