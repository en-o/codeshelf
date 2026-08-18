// dsh 自带的 Web UI：`dsh web` 起一个本地 HTTP 服务，前端用 iframe 内嵌进 dsh 页。
//
// 为什么留这条路：官方界面里有我们没映射的东西（审批弹窗、plan/goal、工作区管理）。
// 原生视图负责「历史留在 CodeShelf」，官方界面负责「功能全」，同一页两个视图切换。
//
// 模型不再深绑 DeepSeek：启动时把用户在 CodeShelf 选的供应商按环境变量注入，
// 配合 home 级补丁里的路由声明（见 runtime.rs 的 HOME_PATCH），
// 官方界面里显示的就是用户自己的模型，密钥那栏是「由启动环境提供（只读）」。

use super::engine::DshEngineConfig;
use super::runtime::{
    dsh_entry_js, dsh_env_status, dsh_home, ensure_home_patch, ensure_profile_files, key_env_name,
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
pub async fn dsh_web_open(app: AppHandle, config: DshEngineConfig) -> AppResult<DshWebStatus> {
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

    // 端口自己挑：dsh web 默认 3080，用户机器上很可能被别的东西占着，
    // 撞了它会直接退出而不是换一个。
    let port = free_port()?;
    let work_dir = Some(config.cwd.clone())
        .filter(|c| !c.is_empty() && std::path::Path::new(c).is_dir())
        .or_else(|| dirs::home_dir().map(|p| p.to_string_lossy().to_string()))
        .unwrap_or_else(|| ".".to_string());

    // 官方界面走的是 dsh 的 web profile，模型路由来自 home 补丁 ——
    // 用户可能先开官方界面再用本地视图，所以这条路径上也要先把补丁写好。
    ensure_profile_files()?;
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
