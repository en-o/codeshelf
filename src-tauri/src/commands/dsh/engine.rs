// dsh 引擎进程：一个常驻子进程 + stdio 上的换行分隔 JSON-RPC。
//
// 为什么只起一个进程：协议里 `sessionId` 已经区分会话，一个 runtime 能同时服务多个会话；
// 每个会话起一个 node 进程只是把内存翻倍。
//
// 与 resume_node_agent.rs 的区别：那边是「一次调用一个进程、拿到结果就退出」，
// 这边是常驻长连接（agent 要跨多轮保持上下文），所以 pending 表、reader task、
// 退出监控都得自己维护。

use super::runtime::{dsh_entry_js, dsh_home, dsh_env_status, PROFILE_NAME};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

/// 服务端通知原样转发给前端（外层包一个 sessionKey，见 `emit_notification`）
const EVENT_NOTIFY: &str = "dsh-event";
/// 引擎进程退出（正常关闭或崩溃），带退出码与 stderr 尾巴
const EVENT_EXIT: &str = "dsh-engine-exit";

/// stderr 只留尾部若干行：dsh 的诊断都在这里，但没必要把整个日志攒在内存里
const STDERR_TAIL_LINES: usize = 40;

const INIT_TIMEOUT: Duration = Duration::from_secs(60);
const PROMPT_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(1500);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DshEngineConfig {
    /// agent 的工作目录（dsh 的 workspace，沙箱写入被限制在这里面）
    pub cwd: String,
    pub model: String,
    /// 供应商端点（OpenAI 兼容或 Anthropic 原生，取决于 provider 路由）
    pub base_url: String,
    pub api_key: Option<String>,
    /// dsh 那边的模型路由名，由前端按供应商类型给：
    /// `deepseek-official`（dsh 自带的 DeepSeek 适配器）、`openai`、`anthropic`
    /// （pi-ai 目录路由），其余 OpenAI 兼容端点用 `codeshelf`（profile 里手工声明的路由）。
    /// 缺省 deepseek-official，兼容老会话。
    #[serde(default)]
    pub provider: Option<String>,
}

/// 路由白名单：profile 里声明了哪几条，这里就只允许哪几条。
/// 传个没注册的名字，dsh 会在 initialize 阶段失败，错误信息还不直白。
fn resolve_route(provider: Option<&str>) -> &'static str {
    match provider {
        Some("openai") => "openai",
        Some("anthropic") => "anthropic",
        Some("codeshelf") => "codeshelf",
        _ => "deepseek-official",
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DshEngineStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub config: Option<DshEngineConfig>,
    /// 本次运行的标识。dsh 的 sessionId 是一次性的（换了 runtime 再用同一个 id 会报
    /// 「已有持久化日志与当前会话不一致」），所以每次启动都要换一批会话 id。
    pub run_id: Option<String>,
}

struct Engine {
    pid: u32,
    run_id: String,
    config: DshEngineConfig,
    stdin: ChildStdin,
    next_id: u64,
    pending: Arc<StdMutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
    /// dsh sessionId → 调用方的会话 id。前端按 sessionKey 过滤事件，
    /// 不用自己拼「chatId + runId」，也就不会在引擎重启后拼错。
    sessions: Arc<StdMutex<HashMap<String, String>>>,
}

fn engine_slot() -> &'static Mutex<Option<Engine>> {
    static SLOT: OnceLock<Mutex<Option<Engine>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

/// 与 Engine 分开存：停止/退出清理要在**拿不到那把锁**的情况下也能杀掉进程
/// （比如某个请求正卡在超时里）。0 表示没有在跑的引擎。
static ENGINE_PID: AtomicU32 = AtomicU32::new(0);

// ========== 命令 ==========

#[tauri::command]
#[specta::specta]
pub async fn dsh_engine_status() -> AppResult<DshEngineStatus> {
    let guard = engine_slot().lock().await;
    Ok(match guard.as_ref() {
        Some(engine) => DshEngineStatus {
            running: true,
            pid: Some(engine.pid),
            config: Some(engine.config.clone()),
            run_id: Some(engine.run_id.clone()),
        },
        None => DshEngineStatus {
            running: false,
            pid: None,
            config: None,
            run_id: None,
        },
    })
}

/// 启动引擎（已在跑且配置相同则直接复用）。
/// 配置变了（换工作目录/换模型/换密钥）必须重启：这些值只在 initialize 和进程环境里出现一次。
#[tauri::command]
#[specta::specta]
pub async fn dsh_engine_start(app: AppHandle, config: DshEngineConfig) -> AppResult<DshEngineStatus> {
    {
        let guard = engine_slot().lock().await;
        if let Some(engine) = guard.as_ref() {
            if engine.config == config {
                return Ok(DshEngineStatus {
                    running: true,
                    pid: Some(engine.pid),
                    config: Some(engine.config.clone()),
                    run_id: Some(engine.run_id.clone()),
                });
            }
        }
    }
    stop_engine().await;
    start_engine(app, config).await
}

#[tauri::command]
#[specta::specta]
pub async fn dsh_engine_stop() -> AppResult<DshEngineStatus> {
    stop_engine().await;
    dsh_engine_status().await
}

/// 投递一条用户消息。返回的是**入队回执**（messageId），不是回答 ——
/// 回答通过 `dsh-event` 事件流出来。
#[tauri::command]
#[specta::specta]
pub async fn dsh_engine_prompt(session_key: String, text: String) -> AppResult<String> {
    let dsh_session_id = {
        let guard = engine_slot().lock().await;
        let engine = guard
            .as_ref()
            .ok_or_else(|| AppError::Other("dsh 引擎未启动".into()))?;
        // dsh 的 sessionId 一次性：带上 run_id，引擎重启后自然换一个新的会话
        let id = format!("{}-{}", session_key, engine.run_id);
        engine
            .sessions
            .lock()
            .map_err(|_| AppError::Internal("dsh 会话表锁中毒".into()))?
            .insert(id.clone(), session_key.clone());
        id
    };

    let result = request(
        "session/prompt",
        json!({
            "sessionId": dsh_session_id,
            "contentBlocks": [{ "type": "text", "text": text }],
        }),
        PROMPT_TIMEOUT,
    )
    .await?;

    Ok(result
        .get("messageId")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string())
}

/// 应用退出钩子：不留孤儿 node（它自己还会拉起 bash / 子 agent）。
pub fn kill_engine_on_exit() {
    let pid = ENGINE_PID.swap(0, Ordering::SeqCst);
    if pid != 0 {
        crate::process_guard::kill_tree(pid);
    }
}

// ========== 内部实现 ==========

async fn start_engine(app: AppHandle, config: DshEngineConfig) -> AppResult<DshEngineStatus> {
    let status = dsh_env_status().await?;
    if !status.node_ok {
        return Err(AppError::Other(format!(
            "需要 Node v{} 及以上（当前 {}）",
            status.node_min_major,
            status.node_version.unwrap_or_else(|| "未找到".into())
        )));
    }
    if !status.installed || !status.profile_ready {
        return Err(AppError::Other(
            "dsh 尚未安装，请到 设置 → dsh 引擎 里一键安装".into(),
        ));
    }
    let node = status
        .node_path
        .ok_or_else(|| AppError::Other("未找到 Node 可执行文件".into()))?;
    let entry = dsh_entry_js()?;
    let home = dsh_home()?;

    if !std::path::Path::new(&config.cwd).is_dir() {
        return Err(AppError::Invalid(format!(
            "工作目录不存在：{}",
            config.cwd
        )));
    }

    // profile 内容跟着应用代码走（比如新增模型路由），每次启动对齐一次，
    // 免得老用户装完就再也拿不到新配置。
    super::runtime::ensure_profile_files()?;

    let route = resolve_route(config.provider.as_deref());
    let api_key = config.api_key.clone().unwrap_or_default();
    let mut cmd = Command::new(&node);
    cmd.arg(&entry)
        .arg("--profile")
        .arg(PROFILE_NAME)
        .current_dir(&config.cwd)
        .env("DSH_HOME", &home)
        // deepseek-official 走 dsh 自带适配器，认这两个变量
        .env("DEEPSEEK_BASE_URL", &config.base_url)
        .env("DEEPSEEK_API_KEY", &api_key)
        // pi-ai 的三条路由按 profile 里的 apiKeyEnv 引用取这一组
        .env("CODESHELF_LLM_BASE_URL", &config.base_url)
        .env("CODESHELF_LLM_API_KEY", &api_key)
        .env("CODESHELF_LLM_MODEL", &config.model)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    // dsh 会拉起 bash / 子 agent，取消时必须整组回收
    crate::process_guard::configure(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("启动 dsh 失败：{e}")))?;
    let pid = child.id().unwrap_or(0);
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Other("dsh stdin 不可用".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Other("dsh stdout 不可用".into()))?;
    let stderr = child.stderr.take();

    let pending: Arc<StdMutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>> =
        Arc::new(StdMutex::new(HashMap::new()));
    let sessions: Arc<StdMutex<HashMap<String, String>>> = Arc::new(StdMutex::new(HashMap::new()));
    let stderr_tail: Arc<StdMutex<Vec<String>>> = Arc::new(StdMutex::new(Vec::new()));

    // stderr：dsh 把诊断全写这里（stdout 被协议占用），进程异常退出时要拿它解释原因
    if let Some(stderr) = stderr {
        let tail = stderr_tail.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Ok(mut tail) = tail.lock() {
                    tail.push(line);
                    let overflow = tail.len().saturating_sub(STDERR_TAIL_LINES);
                    if overflow > 0 {
                        tail.drain(0..overflow);
                    }
                }
            }
        });
    }

    // reader：响应回填 pending，通知转成 Tauri 事件
    {
        let app = app.clone();
        let pending = pending.clone();
        let sessions = sessions.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(frame) = serde_json::from_str::<Value>(&line) else {
                    // 协议规定 stdout 只走 JSON 帧；出现非 JSON 说明有插件在往 stdout 打日志。
                    // 丢弃即可，不能让它打断整条流。
                    continue;
                };
                if frame.get("method").is_some() {
                    emit_notification(&app, &sessions, frame);
                } else if let Some(id) = frame.get("id").and_then(|v| v.as_u64()) {
                    let sender = pending.lock().ok().and_then(|mut m| m.remove(&id));
                    if let Some(sender) = sender {
                        let payload = if let Some(err) = frame.get("error") {
                            Err(err
                                .get("message")
                                .and_then(|v| v.as_str())
                                .unwrap_or("dsh 返回错误")
                                .to_string())
                        } else {
                            Ok(frame.get("result").cloned().unwrap_or(Value::Null))
                        };
                        let _ = sender.send(payload);
                    }
                }
            }
        });
    }

    // 退出监控：进程没了就清空全局状态，并把退出码 + stderr 尾巴发给前端。
    // 少了这一步，界面会一直以为引擎还活着，之后每次发消息都卡到超时。
    {
        let app = app.clone();
        let tail = stderr_tail.clone();
        tokio::spawn(async move {
            let code = child.wait().await.ok().and_then(|s| s.code());
            ENGINE_PID.compare_exchange(pid, 0, Ordering::SeqCst, Ordering::SeqCst).ok();
            {
                let mut guard = engine_slot().lock().await;
                if guard.as_ref().is_some_and(|e| e.pid == pid) {
                    *guard = None;
                }
            }
            let stderr_tail = tail
                .lock()
                .map(|t| t.join("\n"))
                .unwrap_or_default();
            let _ = app.emit(EVENT_EXIT, json!({ "pid": pid, "code": code, "stderr": stderr_tail }));
        });
    }

    let run_id = format!("{:x}", chrono::Utc::now().timestamp_micros());
    {
        let mut guard = engine_slot().lock().await;
        *guard = Some(Engine {
            pid,
            run_id: run_id.clone(),
            config: config.clone(),
            stdin,
            next_id: 1,
            pending,
            sessions,
        });
    }
    ENGINE_PID.store(pid, Ordering::SeqCst);

    // 握手。失败就把进程收掉 —— 半启动的引擎比没有引擎更难排查。
    let init = request(
        "initialize",
        json!({
            "cwd": config.cwd,
            "provider": route,
            "model": config.model,
        }),
        INIT_TIMEOUT,
    )
    .await;
    if let Err(err) = init {
        let tail = stderr_tail.lock().map(|t| t.join("\n")).unwrap_or_default();
        stop_engine().await;
        let detail = tail.lines().rev().take(6).collect::<Vec<_>>().join(" / ");
        return Err(AppError::Other(if detail.is_empty() {
            format!("dsh 初始化失败：{err}")
        } else {
            format!("dsh 初始化失败：{err}；{detail}")
        }));
    }

    Ok(DshEngineStatus {
        running: true,
        pid: Some(pid),
        config: Some(config),
        run_id: Some(run_id),
    })
}

async fn stop_engine() {
    // 先礼后兵：shutdown 让 dsh 自己 flush 会话日志，再杀进程组兜底。
    // 协议没有取消方法，「停止生成」在上游文档里就是关掉进程这一条路。
    let _ = tokio::time::timeout(SHUTDOWN_TIMEOUT, request("shutdown", json!({}), SHUTDOWN_TIMEOUT)).await;

    let pid = ENGINE_PID.swap(0, Ordering::SeqCst);
    if pid != 0 {
        // kill_tree 是同步的（内含 300ms 等待），别占着 async 工作线程
        let _ = tokio::task::spawn_blocking(move || crate::process_guard::kill_tree(pid)).await;
    }
    let mut guard = engine_slot().lock().await;
    *guard = None;
}

/// 发一条 JSON-RPC 请求并等响应。
///
/// **锁只在写入期间持有**：注册好 pending、写完帧就放锁，等待在锁外进行。
/// 否则一次卡住的请求会连带 `dsh_engine_stop` 一起卡死 —— 而停止正是卡住时唯一的出路。
async fn request(method: &str, params: Value, timeout: Duration) -> AppResult<Value> {
    let rx = {
        let mut guard = engine_slot().lock().await;
        let engine = guard
            .as_mut()
            .ok_or_else(|| AppError::Other("dsh 引擎未启动".into()))?;
        let id = engine.next_id;
        engine.next_id += 1;
        let (tx, rx) = oneshot::channel();
        engine
            .pending
            .lock()
            .map_err(|_| AppError::Internal("dsh pending 表锁中毒".into()))?
            .insert(id, tx);
        let frame = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        engine
            .stdin
            .write_all(format!("{frame}\n").as_bytes())
            .await
            .map_err(|e| AppError::Other(format!("写入 dsh 失败：{e}")))?;
        rx
    };

    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(Ok(value))) => Ok(value),
        Ok(Ok(Err(message))) => Err(AppError::Other(message)),
        // sender 被丢弃 = reader 结束 = 进程没了
        Ok(Err(_)) => Err(AppError::Other("dsh 引擎已退出".into())),
        Err(_) => Err(AppError::Other(format!("dsh 请求超时：{method}"))),
    }
}

/// 通知原样转发，额外补一个 `sessionKey`（调用方的会话 id），
/// 前端按它过滤即可，不必自己还原 dsh 那套一次性 sessionId。
fn emit_notification(
    app: &AppHandle,
    sessions: &Arc<StdMutex<HashMap<String, String>>>,
    mut frame: Value,
) {
    let dsh_session_id = frame
        .get("params")
        .and_then(|p| p.get("sessionId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let session_key = dsh_session_id
        .and_then(|id| sessions.lock().ok().and_then(|m| m.get(&id).cloned()));
    if let Some(obj) = frame.as_object_mut() {
        obj.insert("sessionKey".into(), json!(session_key));
    }
    let _ = app.emit(EVENT_NOTIFY, frame);
}
