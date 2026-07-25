//! 工作流：定时触发的 web_fetch → llm → webhook 流水线
//!
//! 数据模型、CRUD、执行引擎、调度器入口。

use crate::error::AppResult;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, RwLock};

use crate::storage::get_storage_config;

// ========== 数据模型 ==========

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowNode {
    pub id: String,
    pub node_type: String, // "web_fetch" | "llm" | "webhook"
    pub config: Value,     // 节点专属配置
    #[serde(default)]
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRun {
    pub started_at: String,
    pub finished_at: String,
    pub status: String, // "success" | "failure" | "running"
    pub outputs: HashMap<String, String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    pub id: String,
    pub name: String,
    pub cron: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub nodes: Vec<WorkflowNode>,
    #[serde(default)]
    pub last_run: Option<WorkflowRun>,
    pub created_at: String,
    pub updated_at: String,
}

fn default_true() -> bool {
    true
}

// ========== 存储 ==========

fn workflows_dir() -> AppResult<PathBuf> {
    let cfg = get_storage_config()?;
    let dir = cfg.workflows_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| crate::error::AppError::from(format!("创建目录失败: {}", e)))?;
    }
    Ok(dir)
}

fn workflow_path(id: &str) -> AppResult<PathBuf> {
    Ok(workflows_dir()?.join(format!("{}.json", id)))
}

pub fn list_workflows_sync() -> AppResult<Vec<Workflow>> {
    let dir = workflows_dir()?;
    let mut out = Vec::new();
    if !dir.exists() {
        return Ok(out);
    }
    for entry in fs::read_dir(&dir).map_err(|e| crate::error::AppError::from(e.to_string()))? {
        let entry = entry.map_err(|e| crate::error::AppError::from(e.to_string()))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let text = match fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        if let Ok(wf) = serde_json::from_str::<Workflow>(&text) {
            out.push(wf);
        }
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

pub fn load_workflow(id: &str) -> AppResult<Workflow> {
    let path = workflow_path(id)?;
    let text = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取失败: {}", e)))?;
    serde_json::from_str(&text)
        .map_err(|e| crate::error::AppError::from(format!("解析失败: {}", e)))
}

fn save_workflow_sync(wf: &Workflow) -> AppResult<()> {
    let path = workflow_path(&wf.id)?;
    let text = serde_json::to_string_pretty(wf)
        .map_err(|e| crate::error::AppError::from(e.to_string()))?;
    crate::storage::write_atomic(&path, text).map_err(|e| crate::error::AppError::from(format!("写入失败: {}", e)))
}

// ========== 校验 ==========

fn validate_workflow(wf: &Workflow) -> AppResult<()> {
    if wf.name.trim().is_empty() {
        return Err("name 不能为空".into());
    }
    // cron 校验（空字符串允许，代表"不自动触发，仅手动"）
    if !wf.cron.trim().is_empty() {
        let expr = to_six_field(&wf.cron);
        cron::Schedule::from_str(&expr).map_err(|e| {
            crate::error::AppError::from(format!(
                "cron 解析失败（5 段格式，如 '0 9 * * *'）: {}",
                e
            ))
        })?;
    }
    if wf.nodes.is_empty() {
        return Err("至少需要一个节点".into());
    }
    let ids: HashSet<&str> = wf.nodes.iter().map(|n| n.id.as_str()).collect();
    if ids.len() != wf.nodes.len() {
        return Err("节点 id 重复".into());
    }
    for n in &wf.nodes {
        for dep in &n.depends_on {
            if !ids.contains(dep.as_str()) {
                return Err(crate::error::AppError::from(format!(
                    "节点 {} 的 depends_on 引用了不存在的节点 {}",
                    n.id, dep
                )));
            }
        }
        match n.node_type.as_str() {
            "web_fetch" | "llm" | "webhook" => {}
            other => {
                return Err(crate::error::AppError::from(format!(
                    "未知节点类型: {}",
                    other
                )))
            }
        }
    }
    topological_order(&wf.nodes)?;
    Ok(())
}

/// 5 段 → 6 段（cron crate 需要秒字段）
fn to_six_field(expr: &str) -> String {
    let parts: Vec<&str> = expr.split_whitespace().collect();
    if parts.len() == 5 {
        format!("0 {}", expr)
    } else {
        expr.to_string()
    }
}

fn topological_order(nodes: &[WorkflowNode]) -> AppResult<Vec<String>> {
    let mut indeg: HashMap<String, usize> = HashMap::new();
    let mut rdeps: HashMap<String, Vec<String>> = HashMap::new();
    for n in nodes {
        indeg.entry(n.id.clone()).or_insert(0);
        for d in &n.depends_on {
            *indeg.entry(n.id.clone()).or_insert(0) += 1;
            rdeps.entry(d.clone()).or_default().push(n.id.clone());
        }
    }
    let mut q: Vec<String> = indeg
        .iter()
        .filter(|(_, v)| **v == 0)
        .map(|(k, _)| k.clone())
        .collect();
    q.sort();
    let mut order = Vec::new();
    while let Some(id) = q.pop() {
        order.push(id.clone());
        if let Some(outs) = rdeps.get(&id) {
            for o in outs.clone() {
                let c = indeg.get_mut(&o).ok_or_else(|| {
                    crate::error::AppError::from(format!(
                        "拓扑排序状态损坏：节点 {} 不在入度表中",
                        o
                    ))
                })?;
                *c -= 1;
                if *c == 0 {
                    q.push(o);
                }
            }
        }
    }
    if order.len() != nodes.len() {
        return Err("工作流存在环".into());
    }
    Ok(order)
}

// ========== 执行引擎 ==========

fn render_template(template: &str, outputs: &HashMap<String, String>) -> String {
    let mut s = template.to_string();
    for (k, v) in outputs {
        s = s.replace(&format!("{{{{{}}}}}", k), v);
    }
    s
}

async fn run_node_web_fetch(cfg: &Value) -> AppResult<String> {
    let url = cfg
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or("web_fetch 缺少 url")?
        .to_string();
    // 工作流内输出纯内容（不加 [WebFetch] 头），便于下游 LLM/webhook 直接使用
    let mut args = json!({"url": url, "meta": false});
    if let Some(mb) = cfg.get("maxBytes").or_else(|| cfg.get("max_bytes")) {
        args["max_bytes"] = mb.clone();
    }
    if let Some(h) = cfg.get("headers") {
        args["headers"] = h.clone();
    }
    if let Some(t) = cfg.get("timeoutMs").or_else(|| cfg.get("timeout_ms")) {
        args["timeout_ms"] = t.clone();
    }
    // 规则提取 / 代理 等通用透传（缺省即不启用）
    for (src, dst) in [
        ("selector", "selector"),
        ("regex", "regex"),
        ("extractMode", "extract_mode"),
        ("proxy", "proxy"),
    ] {
        if let Some(v) = cfg.get(src) {
            if !v.is_null() {
                args[dst] = v.clone();
            }
        }
    }
    super::tools::run_web_fetch_for_workflow(&args).await
}

async fn run_node_llm(cfg: &Value, outputs: &HashMap<String, String>) -> AppResult<String> {
    let provider_id = cfg
        .get("providerId")
        .and_then(|v| v.as_str())
        .ok_or("llm 缺少 providerId")?;
    let model_id = cfg
        .get("modelId")
        .and_then(|v| v.as_str())
        .ok_or("llm 缺少 modelId")?;
    let prompt = cfg
        .get("prompt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let rendered = render_template(&prompt, outputs);

    let providers = super::settings::get_ai_providers().await?;
    let provider = providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| crate::error::AppError::from(format!("未找到 provider: {}", provider_id)))?;
    let model = provider
        .models
        .iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| crate::error::AppError::from(format!("未找到 model: {}", model_id)))?;

    let url = format!(
        "{}/chat/completions",
        provider.base_url.trim_end_matches('/')
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| crate::error::AppError::from(e.to_string()))?;
    let mut req = client.post(&url).json(&json!({
        "model": model.model,
        "messages": [{"role": "user", "content": rendered}],
        "stream": false
    }));
    if let Some(key) = provider.api_key.as_ref() {
        if !key.trim().is_empty() {
            req = req.bearer_auth(key);
        }
    }
    let resp = req
        .send()
        .await
        .map_err(|e| crate::error::AppError::from(format!("LLM 请求失败: {}", e)))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(crate::error::AppError::from(format!(
            "LLM {}: {}",
            status, text
        )));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| crate::error::AppError::from(format!("LLM 响应解析失败: {}", e)))?;
    let content = body
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok(content)
}

/// 截取响应正文用于回显/报错
fn snippet(s: &str) -> String {
    s.chars().take(500).collect::<String>()
}

/// 飞书/Lark/企微：HTTP 2xx 且业务码为 0 才算成功
fn platform_ok(status: reqwest::StatusCode, body: &str, code_field: &str) -> bool {
    if !status.is_success() {
        return false;
    }
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    // 飞书新版用 "code"，旧版用 "StatusCode"；企微用 "errcode"
    let code = v
        .get(code_field)
        .and_then(|x| x.as_i64())
        .or_else(|| v.get("StatusCode").and_then(|x| x.as_i64()));
    match code {
        Some(c) => c == 0, // 有业务码：必须为 0
        None => true,      // 无业务码字段：以 HTTP 2xx 为准
    }
}

async fn run_node_webhook(cfg: &Value, outputs: &HashMap<String, String>) -> AppResult<String> {
    let kind = cfg
        .get("kind")
        .and_then(|v| v.as_str())
        .ok_or("webhook 缺少 kind")?;
    let body_template = cfg
        .get("bodyTemplate")
        .or_else(|| cfg.get("body_template"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let text = render_template(body_template, outputs);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| crate::error::AppError::from(e.to_string()))?;

    match kind {
        // 飞书(feishu.cn) 与 Lark(larksuite.com) 是两套部署：token 不通用。
        // token 字段允许直接粘整条 hook 链接（原样用）；只填 token 时按 region 拼域名。
        "feishu" | "lark" => {
            if text.trim().is_empty() {
                return Err("推送内容为空：请在 body 模板里填写文本，并用 {{上游节点id}} 引用抓取/LLM 结果".into());
            }
            let token = cfg
                .get("token")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .ok_or("飞书/Lark 缺少 token 或 hook 链接")?;
            let url = if token.starts_with("http://") || token.starts_with("https://") {
                token.to_string()
            } else {
                let region = cfg
                    .get("region")
                    .and_then(|v| v.as_str())
                    .unwrap_or("feishu");
                let host = if region.eq_ignore_ascii_case("lark") || kind == "lark" {
                    "open.larksuite.com"
                } else {
                    "open.feishu.cn"
                };
                format!("https://{}/open-apis/bot/v2/hook/{}", host, token)
            };
            let payload = json!({"msg_type": "text", "content": {"text": text}});
            let resp = client
                .post(&url)
                .json(&payload)
                .send()
                .await
                .map_err(|e| crate::error::AppError::from(format!("发送失败: {}", e)))?;
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            if platform_ok(status, &body, "code") {
                Ok(format!("飞书/Lark 推送成功: {}", snippet(&body)))
            } else {
                Err(crate::error::AppError::from(format!(
                    "飞书/Lark 推送失败 (HTTP {}): {}",
                    status.as_u16(),
                    snippet(&body)
                )))
            }
        }
        "wecom" => {
            if text.trim().is_empty() {
                return Err("推送内容为空：请在 body 模板里填写文本，并用 {{上游节点id}} 引用抓取/LLM 结果".into());
            }
            let key = cfg
                .get("key")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .ok_or("wecom 缺少 key 或 webhook 链接")?;
            let url = if key.starts_with("http://") || key.starts_with("https://") {
                key.to_string()
            } else {
                format!(
                    "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key={}",
                    key
                )
            };
            let payload = json!({"msgtype": "text", "text": {"content": text}});
            let resp = client
                .post(&url)
                .json(&payload)
                .send()
                .await
                .map_err(|e| crate::error::AppError::from(format!("发送失败: {}", e)))?;
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            if platform_ok(status, &body, "errcode") {
                Ok(format!("企业微信推送成功: {}", snippet(&body)))
            } else {
                Err(crate::error::AppError::from(format!(
                    "企业微信推送失败 (HTTP {}): {}",
                    status.as_u16(),
                    snippet(&body)
                )))
            }
        }
        "http" => {
            let url = cfg
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or("http 缺少 url")?;
            let method = cfg
                .get("method")
                .and_then(|v| v.as_str())
                .unwrap_or("POST")
                .to_uppercase();
            let content_type = cfg
                .get("contentType")
                .or_else(|| cfg.get("content_type"))
                .and_then(|v| v.as_str())
                .unwrap_or("application/json");
            let mut req = match method.as_str() {
                "GET" => client.get(url),
                "POST" => client.post(url),
                "PUT" => client.put(url),
                "DELETE" => client.delete(url),
                _ => {
                    return Err(crate::error::AppError::from(format!(
                        "不支持的 method: {}",
                        method
                    )))
                }
            };
            req = req.header("Content-Type", content_type);
            if let Some(headers) = cfg.get("headers").and_then(|v| v.as_object()) {
                for (k, v) in headers {
                    if let Some(val) = v.as_str() {
                        req = req.header(k.as_str(), val);
                    }
                }
            }
            if method != "GET" {
                req = req.body(text.clone());
            }
            let resp = req
                .send()
                .await
                .map_err(|e| crate::error::AppError::from(format!("发送失败: {}", e)))?;
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            if status.is_success() {
                Ok(format!("http {} sent: {}", status.as_u16(), snippet(&body)))
            } else {
                Err(crate::error::AppError::from(format!(
                    "HTTP 推送失败 ({}): {}",
                    status.as_u16(),
                    snippet(&body)
                )))
            }
        }
        other => Err(crate::error::AppError::from(format!(
            "未知 webhook kind: {}",
            other
        ))),
    }
}

pub async fn execute_workflow(app: &AppHandle, id: &str) -> AppResult<WorkflowRun> {
    let wf = load_workflow(id)?;
    let order = topological_order(&wf.nodes)?;
    let started_at = Utc::now().to_rfc3339();

    // 预置 running 状态
    {
        let mut running = wf.clone();
        running.last_run = Some(WorkflowRun {
            started_at: started_at.clone(),
            finished_at: String::new(),
            status: "running".into(),
            outputs: HashMap::new(),
            error: None,
        });
        let _ = save_workflow_sync(&running);
        let _ = app.emit("workflow-run-changed", json!({"id": id}));
    }

    let mut outputs: HashMap<String, String> = HashMap::new();
    let mut error: Option<String> = None;
    for nid in &order {
        let node = wf
            .nodes
            .iter()
            .find(|n| &n.id == nid)
            .expect("nid 来自 topo_order(wf.nodes) 的结果，必然能在 wf.nodes 中找到");
        let result = match node.node_type.as_str() {
            "web_fetch" => run_node_web_fetch(&node.config).await,
            "llm" => run_node_llm(&node.config, &outputs).await,
            "webhook" => run_node_webhook(&node.config, &outputs).await,
            _ => Err(crate::error::AppError::from(format!(
                "未知节点类型: {}",
                node.node_type
            ))),
        };
        match result {
            Ok(v) => {
                outputs.insert(nid.clone(), v);
            }
            Err(e) => {
                error = Some(format!("节点 {} 失败: {}", nid, e));
                break;
            }
        }
    }

    let status = if error.is_some() {
        "failure"
    } else {
        "success"
    };
    let run = WorkflowRun {
        started_at,
        finished_at: Utc::now().to_rfc3339(),
        status: status.into(),
        outputs,
        error,
    };

    let mut latest = load_workflow(id).unwrap_or(wf);
    latest.last_run = Some(run.clone());
    save_workflow_sync(&latest)?;
    let _ = app.emit("workflow-run-changed", json!({"id": id}));
    Ok(run)
}

// ========== 调度器 ==========

pub enum SchedulerMsg {
    Reload,
}

pub struct SchedulerHandle {
    pub tx: mpsc::Sender<SchedulerMsg>,
}

pub fn spawn_scheduler(app: AppHandle) -> SchedulerHandle {
    let (tx, mut rx) = mpsc::channel::<SchedulerMsg>(16);
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut task_handles: Vec<tauri::async_runtime::JoinHandle<()>> = Vec::new();
        let load_and_spawn = |handles: &mut Vec<tauri::async_runtime::JoinHandle<()>>| {
            for h in handles.drain(..) {
                h.abort();
            }
            let workflows = list_workflows_sync().unwrap_or_default();
            for wf in workflows
                .into_iter()
                .filter(|w| w.enabled && !w.cron.trim().is_empty())
            {
                let id = wf.id.clone();
                let cron_expr = to_six_field(&wf.cron);
                let Ok(schedule) = cron::Schedule::from_str(&cron_expr) else {
                    continue;
                };
                let app_inner = app_clone.clone();
                handles.push(tauri::async_runtime::spawn(async move {
                    loop {
                        // 按本地时区调度：UI 的人话预览（"每天 09:00"）说的是本地时间，
                        // 用 Utc 会让国内用户的任务偏移 8 小时。
                        let now = chrono::Local::now();
                        let Some(next) = schedule.upcoming(chrono::Local).next() else {
                            return;
                        };
                        let delta = (next - now).to_std().unwrap_or(Duration::from_secs(60));
                        tokio::time::sleep(delta).await;
                        let _ = execute_workflow(&app_inner, &id).await;
                    }
                }));
            }
        };
        load_and_spawn(&mut task_handles);
        while let Some(msg) = rx.recv().await {
            match msg {
                SchedulerMsg::Reload => load_and_spawn(&mut task_handles),
            }
        }
    });
    SchedulerHandle { tx }
}

async fn notify_reload(app: &AppHandle) {
    if let Some(h) = app.try_state::<Arc<RwLock<SchedulerHandle>>>() {
        let guard = h.read().await;
        let _ = guard.tx.send(SchedulerMsg::Reload).await;
    }
}

// ========== Tauri 命令 ==========

#[tauri::command]
#[specta::specta]
pub async fn workflow_list() -> AppResult<Vec<Workflow>> {
    list_workflows_sync()
}

#[tauri::command]
#[specta::specta]
pub async fn workflow_get(id: String) -> AppResult<Workflow> {
    load_workflow(&id)
}

#[tauri::command]
#[specta::specta]
pub async fn workflow_save(app: AppHandle, workflow: Workflow) -> AppResult<Workflow> {
    let mut wf = workflow;
    if wf.id.trim().is_empty() {
        wf.id = format!("wf-{}", Utc::now().timestamp_millis());
        wf.created_at = Utc::now().to_rfc3339();
    }
    wf.updated_at = Utc::now().to_rfc3339();
    validate_workflow(&wf)?;
    save_workflow_sync(&wf)?;
    notify_reload(&app).await;
    Ok(wf)
}

#[tauri::command]
#[specta::specta]
pub async fn workflow_delete(app: AppHandle, id: String) -> AppResult<()> {
    let path = workflow_path(&id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| crate::error::AppError::from(e.to_string()))?;
    }
    notify_reload(&app).await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn workflow_run_now(app: AppHandle, id: String) -> AppResult<WorkflowRun> {
    execute_workflow(&app, &id).await
}

#[tauri::command]
#[specta::specta]
pub async fn workflow_set_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> AppResult<Workflow> {
    let mut wf = load_workflow(&id)?;
    wf.enabled = enabled;
    wf.updated_at = Utc::now().to_rfc3339();
    save_workflow_sync(&wf)?;
    notify_reload(&app).await;
    Ok(wf)
}

// ========== Chat 工具入口 ==========

pub async fn tool_create_workflow(args: &Value, app: &AppHandle) -> AppResult<String> {
    let name = args
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or("缺少 name")?
        .to_string();
    let cron_expr = args
        .get("cron")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let enabled = args
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let nodes_val = args.get("nodes").ok_or("缺少 nodes")?;
    let nodes: Vec<WorkflowNode> = serde_json::from_value(nodes_val.clone())
        .map_err(|e| crate::error::AppError::from(format!("nodes 解析失败: {}", e)))?;

    let wf = Workflow {
        id: format!("wf-{}", Utc::now().timestamp_millis()),
        name,
        cron: cron_expr,
        enabled,
        nodes,
        last_run: None,
        created_at: Utc::now().to_rfc3339(),
        updated_at: Utc::now().to_rfc3339(),
    };
    validate_workflow(&wf)?;
    save_workflow_sync(&wf)?;
    notify_reload(app).await;
    Ok(format!(
        "已创建工作流：id={} name={} cron={} enabled={}",
        wf.id, wf.name, wf.cron, wf.enabled
    ))
}

pub async fn tool_run_workflow_now(args: &Value, app: &AppHandle) -> AppResult<String> {
    let id = args.get("id").and_then(|v| v.as_str()).ok_or("缺少 id")?;
    let run = execute_workflow(app, id).await?;
    Ok(format!(
        "运行完成 status={} outputs={}",
        run.status,
        serde_json::to_string(&run.outputs).unwrap_or_default()
    ))
}

pub async fn tool_list_workflows(_app: &AppHandle) -> AppResult<String> {
    let list = list_workflows_sync()?;
    let brief: Vec<Value> = list
        .iter()
        .map(|w| {
            json!({
                "id": w.id, "name": w.name, "cron": w.cron, "enabled": w.enabled,
                "nodeCount": w.nodes.len(),
                "lastStatus": w.last_run.as_ref().map(|r| r.status.clone()),
            })
        })
        .collect();
    Ok(serde_json::to_string_pretty(&brief).unwrap_or_default())
}
