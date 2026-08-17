// dsh 自带的 Web UI：`dsh web` 起一个本地 HTTP 服务，我们在应用内开个窗口显示它。
//
// 为什么留这条路：dsh 官方界面里有我们没映射的东西（审批弹窗、plan/goal、
// 它自己的模型设置）。原生 dsh 页负责「历史留在 CodeShelf」，官方界面负责「功能全」，
// 两条路并存，用户按需要选。

use super::runtime::{dsh_entry_js, dsh_env_status, dsh_home};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// 启动日志（含 dsh 首次初始化 web profile 的输出）
const EVENT_LOG: &str = "dsh-web-log";
const WINDOW_LABEL: &str = "dsh-web";
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

/// 启动（或复用）dsh 的 Web UI，并在应用内窗口打开它。
#[tauri::command]
#[specta::specta]
pub async fn dsh_web_open(app: AppHandle, cwd: Option<String>) -> AppResult<DshWebStatus> {
    if WEB_PID.load(Ordering::SeqCst) != 0 {
        if let Some(url) = current_url() {
            show_window(&app, &url)?;
            return dsh_web_status().await;
        }
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
    let work_dir = cwd
        .filter(|c| std::path::Path::new(c).is_dir())
        .or_else(|| dirs::home_dir().map(|p| p.to_string_lossy().to_string()))
        .unwrap_or_else(|| ".".to_string());

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
        *slot = Some(url.clone());
    }
    show_window(&app, &url)?;
    dsh_web_status().await
}

#[tauri::command]
#[specta::specta]
pub async fn dsh_web_stop(app: AppHandle) -> AppResult<DshWebStatus> {
    if let Some(win) = app.get_webview_window(WINDOW_LABEL) {
        let _ = win.close();
    }
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

/// 在应用内开一个窗口显示它。
///
/// 窗口在 Rust 侧创建，不走前端 API —— capabilities 里没开
/// `core:webview:allow-create-webview-window`，也**不需要**开：
/// 这个窗口加载的是 dsh 自己的页面，不该拿到 CodeShelf 的 IPC 权限。
fn show_window(app: &AppHandle, url: &str) -> AppResult<()> {
    if let Some(win) = app.get_webview_window(WINDOW_LABEL) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }
    let parsed = url
        .parse()
        .map_err(|e| AppError::Other(format!("dsh web 地址不合法（{url}）：{e}")))?;
    WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(parsed))
        .title("dsh · 官方界面")
        .inner_size(1200.0, 820.0)
        .build()
        .map_err(|e| AppError::Other(format!("打开 dsh 界面窗口失败：{e}")))?;
    Ok(())
}
