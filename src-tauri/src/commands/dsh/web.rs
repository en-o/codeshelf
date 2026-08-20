// dsh 自带的 Web UI：`dsh web` 起一个本地 HTTP 服务，前端用 iframe 内嵌进 dsh 页。
//
// 为什么留这条路：官方界面里有我们没映射的东西（审批弹窗、plan/goal、工作区管理）。
// 原生视图负责「历史留在 CodeShelf」，官方界面负责「功能全」，同一页两个视图切换。
//
// 模型不再深绑 DeepSeek：启动时把用户在 CodeShelf 选的供应商按环境变量注入，
// 配合 home 级补丁里的路由声明（见 runtime.rs 的 HOME_PATCH），
// 官方界面里显示的就是用户自己的模型，密钥那栏是「由启动环境提供（只读）」。

use super::runtime::{
    dsh_entry_js, dsh_env_status, dsh_home, ensure_home_patch, infer_context_window, key_env_name,
    DshProviderSpec, MIN_USABLE_CONTEXT_WINDOW,
};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// 启动日志（含 dsh 首次初始化 web profile 的输出）
const EVENT_LOG: &str = "dsh-web-log";
/// 等它把端口监听起来的上限
const READY_TIMEOUT: Duration = Duration::from_secs(120);

/// 启动 dsh 需要的一切：工作目录 + 模型来源。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DshLaunchConfig {
    /// dsh 的默认工作目录（它自己的界面里还能再加工作区）
    pub cwd: String,
    /// 当前选中的供应商 id（CodeShelf 侧），决定 dsh 的默认路由
    pub provider_id: String,
    pub model: String,
    /// CodeShelf「模型」页里所有启用的供应商，一一映射成 dsh 的模型路由。
    /// 传全量而不只是选中那个：dsh 界面里的模型下拉要能列出用户配的全部模型，
    /// 且每条各用各的端点与密钥（否则选 A 家的模型会拿 B 家的地址去打）。
    #[serde(default)]
    pub providers: Vec<DshProviderSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DshWebStatus {
    pub running: bool,
    pub url: Option<String>,
    pub pid: Option<u32>,
}

static WEB_PID: AtomicU32 = AtomicU32::new(0);

fn web_url_slot() -> &'static Mutex<Option<String>> {
    static SLOT: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

fn current_url() -> Option<String> {
    web_url_slot().lock().ok().and_then(|u| u.clone())
}

#[tauri::command]
#[specta::specta]
pub async fn dsh_web_status() -> AppResult<DshWebStatus> {
    let pid = WEB_PID.load(Ordering::SeqCst);
    Ok(DshWebStatus {
        running: pid != 0,
        url: current_url(),
        pid: (pid != 0).then_some(pid),
    })
}

/// 启动（或复用）dsh 的 Web UI，返回它的地址；界面由前端 iframe 内嵌。
///
/// `config` 与引擎用的是同一份（工作目录 / 模型 / 端点 / 密钥 / 路由），
/// 通过环境变量注入 —— 官方界面因此直接用上用户在 CodeShelf 里配的供应商，
/// 而不是让人再填一次 DeepSeek 的 key。
#[tauri::command]
#[specta::specta]
pub async fn dsh_web_open(app: AppHandle, config: DshLaunchConfig) -> AppResult<DshWebStatus> {
    if WEB_PID.load(Ordering::SeqCst) != 0 && current_url().is_some() {
        return dsh_web_status().await;
    }

    let status = dsh_env_status().await?;
    if !status.installed || !status.node_ok {
        return Err(AppError::Other(
            "dsh 尚未就绪，请先到 设置 → dsh 引擎 里安装".into(),
        ));
    }
    let node = status
        .node_path
        .ok_or_else(|| AppError::Other("未找到 Node 可执行文件".into()))?;

    // 窗口太小的模型直接挡在门外：dsh 每轮都要注入自己的系统提示 + skill 目录，
    // 一万多 token 起步。让它启动只会在用户发第一句话时收到
    // `CONTEXT_WINDOW_EXCEEDED`，那时错误看起来像是模型或密钥的问题。
    let window = infer_context_window(&config.model);
    if window < MIN_USABLE_CONTEXT_WINDOW {
        return Err(AppError::Invalid(format!(
            "{} 的上下文窗口只有 {}，装不下 dsh 每轮注入的系统提示（一万多 token）。\
             请在 设置 → dsh 引擎 里换一个 32K 以上的模型。",
            config.model, window
        )));
    }

    // 端口自己挑：dsh web 默认 3080，用户机器上很可能被别的东西占着，
    // 撞了它会直接退出而不是换一个。
    let port = free_port()?;
    let work_dir = Some(config.cwd.clone())
        .filter(|c| !c.is_empty() && std::path::Path::new(c).is_dir())
        .or_else(|| dirs::home_dir().map(|p| p.to_string_lossy().to_string()))
        .unwrap_or_else(|| ".".to_string());

    // 官方界面用的是 dsh 自带的 web profile；模型路由靠 home 补丁注入
    ensure_home_patch(&config.providers, &config.provider_id, &config.model)?;

    let mut cmd = Command::new(&node);
    cmd.arg(dsh_entry_js()?)
        .arg("web")
        .arg("--port")
        .arg(port.to_string())
        .current_dir(&work_dir)
        .env("DSH_HOME", dsh_home()?)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    // 每个供应商的密钥各走各的环境变量（补丁里 apiKeyEnv 引用），不落盘；
    // 官方界面把它显示为「由启动环境提供（只读）」
    for p in &config.providers {
        cmd.env(key_env_name(&p.id), p.api_key.clone().unwrap_or_default());
    }
    crate::process_guard::configure(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("启动 dsh web 失败：{e}")))?;
    let pid = child.id().unwrap_or(0);
    WEB_PID.store(pid, Ordering::SeqCst);

    // 输出转发给前端：web profile 首次使用会现场初始化，过程可能几十秒，
    // 不给日志用户只会看到一个卡住的按钮。
    for stream in [
        child.stdout.take().map(StdStream::Out),
        child.stderr.take().map(StdStream::Err),
    ]
    .into_iter()
    .flatten()
    {
        let app = app.clone();
        tokio::spawn(async move {
            match stream {
                StdStream::Out(s) => forward_lines(app, s).await,
                StdStream::Err(s) => forward_lines(app, s).await,
            }
        });
    }

    // 监控退出，清状态
    {
        let app = app.clone();
        tokio::spawn(async move {
            let code = child.wait().await.ok().and_then(|s| s.code());
            WEB_PID
                .compare_exchange(pid, 0, Ordering::SeqCst, Ordering::SeqCst)
                .ok();
            if let Ok(mut slot) = web_url_slot().lock() {
                *slot = None;
            }
            let _ = app.emit(EVENT_LOG, format!("[dsh web 已退出，退出码 {code:?}]"));
        });
    }

    // 就绪判定用「端口能连上」而不是解析它打印的 URL：
    // 输出格式属于它的界面文案，换一版就可能变，端口通不通不会变。
    let url = format!("http://127.0.0.1:{port}");
    wait_port_ready(port).await?;
    if let Ok(mut slot) = web_url_slot().lock() {
        *slot = Some(url);
    }
    dsh_web_status().await
}

#[tauri::command]
#[specta::specta]
pub async fn dsh_web_stop() -> AppResult<DshWebStatus> {
    kill_web_on_exit();
    dsh_web_status().await
}

/// 应用退出时回收（与引擎同理，不留孤儿 node）
pub fn kill_web_on_exit() {
    let pid = WEB_PID.swap(0, Ordering::SeqCst);
    if pid != 0 {
        crate::process_guard::kill_tree(pid);
    }
    if let Ok(mut slot) = web_url_slot().lock() {
        *slot = None;
    }
}

enum StdStream {
    Out(tokio::process::ChildStdout),
    Err(tokio::process::ChildStderr),
}

async fn forward_lines<R: tokio::io::AsyncRead + Unpin>(app: AppHandle, stream: R) {
    let mut lines = BufReader::new(stream).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let _ = app.emit(EVENT_LOG, line);
    }
}

/// 让系统分配一个空闲端口。绑 0 号端口拿到号后立刻释放，
/// 中间有极小的竞争窗口，但比写死 3080 强得多。
fn free_port() -> AppResult<u16> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| AppError::Other(format!("分配端口失败：{e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| AppError::Other(format!("读取端口失败：{e}")))?
        .port();
    Ok(port)
}

async fn wait_port_ready(port: u16) -> AppResult<()> {
    let deadline = tokio::time::Instant::now() + READY_TIMEOUT;
    loop {
        if WEB_PID.load(Ordering::SeqCst) == 0 {
            return Err(AppError::Other("dsh web 启动后立即退出，见日志".into()));
        }
        if tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(AppError::Other(format!(
                "dsh web 在 {} 秒内没起来（首次使用要初始化 web profile，可稍后重试）",
                READY_TIMEOUT.as_secs()
            )));
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
}
