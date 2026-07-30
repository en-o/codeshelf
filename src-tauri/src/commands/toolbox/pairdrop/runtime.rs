// axum HTTP + WebSocket 服务运行时
//
// 路由：
// - GET  /               浏览器 SPA
// - GET  /api/info       返回服务信息 + 所有可达 URL
// - GET  /ws             WebSocket 信令通道
// - POST /api/upload     上传文件（multipart），返回 token
// - GET  /api/file/:tok  下载文件（一次性消耗）

use std::collections::HashMap;
use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

use axum::{
    body::Body,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, DefaultBodyLimit, Multipart, Path, Query, State,
    },
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use futures::{sink::SinkExt, stream::StreamExt};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Deserialize;
use serde_json::json;
use socket2::{Domain, Socket, Type};
use tokio::sync::mpsc;
use tower_http::cors::{Any, CorsLayer};

use super::assets::INDEX_HTML;
use super::state::*;
use crate::error::AppResult;

const DISCOVERY_SERVICE_TYPE: &str = "_codeshelf-pairdrop._tcp.local.";
const DISCOVERY_TTL_MS: i64 = 20_000;

#[derive(Clone)]
struct ServerHandle {
    state: Arc<AppState>,
    port: u16,
}

#[derive(Debug, Deserialize)]
struct ConnectQuery {
    /// 客户端通过查询参数指定设备类型（如 desktop / mobile），可选
    #[serde(default)]
    role: Option<String>,
    /// 客户端可建议的初始名称
    #[serde(default)]
    name: Option<String>,
    /// 客户端持久化的设备 ID，用于重连后恢复同一会话历史
    #[serde(default, rename = "clientId")]
    client_id: Option<String>,
}

/// 启动服务（绑定到 0.0.0.0:port，0 表示由系统分配）
///
/// 返回实际监听的端口。
pub async fn start_server(
    port: u16,
) -> AppResult<(
    u16,
    Arc<AppState>,
    Arc<tokio::sync::Notify>,
    tokio::task::JoinHandle<()>,
)> {
    let state = Arc::new(AppState::new());
    let stop_signal = state.stop_signal.clone();

    let handle = ServerHandle {
        state: state.clone(),
        port: 0, // 占位，建立后会更新
    };

    // 桌面端 React UI 跑在 tauri:// 或 localhost:1420,axum 跑在 127.0.0.1:port,
    // 跨源 → 没 CORS 头浏览器会把响应吞掉,XHR 报 onerror(就是「网络中断」)。
    // 这台服务本来就只在 LAN,鉴权靠一次性 token,因此放开 CORS 不影响安全。
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/", get(serve_index))
        .route("/api/info", get(api_info))
        .route("/api/discovered", get(api_discovered))
        .route(
            "/api/upload",
            // axum 默认 2MB body 限制对图片/视频很容易就超了 → 连接被中止 → 浏览器收到 xhr.onerror（「网络错误」)
            // 这里按 MAX_FILE_SIZE + 1MB 的 multipart 头尾留余量，超过仍然返回 413,而不是闷掉连接
            post(api_upload).layer(DefaultBodyLimit::max(MAX_FILE_SIZE + 1024 * 1024)),
        )
        .route("/api/file/:token", get(api_file))
        .route("/ws", any(ws_handler))
        .with_state(handle.clone())
        .layer(cors);

    // 绑定 socket
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let socket = Socket::new(Domain::IPV4, Type::STREAM, None)
        .map_err(|e| crate::error::AppError::from(format!("创建 socket 失败: {}", e)))?;
    socket
        .set_reuse_address(true)
        .map_err(|e| crate::error::AppError::from(format!("设置 SO_REUSEADDR 失败: {}", e)))?;
    socket
        .set_nonblocking(true)
        .map_err(|e| crate::error::AppError::from(format!("设置非阻塞失败: {}", e)))?;
    socket
        .bind(&addr.into())
        .map_err(|e| {
            let kind = e.kind();
            let msg = if kind == std::io::ErrorKind::AddrInUse {
                format!(
                    "端口 {} 已被占用，请关闭占用该端口的程序后重试，或在「系统监控」中查看哪个进程在用",
                    port
                )
            } else if kind == std::io::ErrorKind::PermissionDenied {
                // Windows: WSAEACCES (10013) — 通常是 Hyper-V/WSL 保留了端口段
                format!(
                    "端口 {} 不允许绑定 (os error: {}); Windows 上一般是 Hyper-V/WSL 保留了端口段,可在 PowerShell 跑 `netsh interface ipv4 show excludedportrange protocol=tcp` 查看",
                    port, e
                )
            } else {
                format!("绑定端口 {} 失败: {}", port, e)
            };
            crate::error::AppError::from(msg)
        })?;
    socket
        .listen(1024)
        .map_err(|e| crate::error::AppError::from(format!("监听失败: {}", e)))?;
    let std_listener: std::net::TcpListener = socket.into();
    let actual_port = std_listener
        .local_addr()
        .map_err(|e| crate::error::AppError::from(format!("获取本地地址失败: {}", e)))?
        .port();
    let listener = tokio::net::TcpListener::from_std(std_listener)
        .map_err(|e| crate::error::AppError::from(format!("转换 listener 失败: {}", e)))?;

    log::info!("跨设备传输服务启动，端口: {}", actual_port);

    // 更新 handle 里的 port
    let mut handle_updated = handle.clone();
    handle_updated.port = actual_port;
    let app = app.with_state(handle_updated);

    let signal_clone = stop_signal.clone();
    let state_clone = state.clone();
    let task = tokio::spawn(async move {
        // 周期清理过期文件
        let cleanup_state = state_clone.clone();
        let cleanup_signal = signal_clone.clone();
        let discovery_state = state_clone.clone();
        let discovery_signal = signal_clone.clone();
        let discovery_task = tokio::spawn(async move {
            run_discovery(discovery_state, actual_port, discovery_signal).await;
        });
        let cleanup_task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = cleanup_signal.notified() => break,
                    _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => {
                        let mut files = cleanup_state.files.lock().await;
                        let before = files.len();
                        files.retain(|_, f| !f.is_expired());
                        let after = files.len();
                        if before != after {
                            log::info!("跨设备传输：清理过期文件 {} -> {}", before, after);
                        }
                    }
                }
            }
        });

        let serve = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            signal_clone.notified().await;
        });
        if let Err(e) = serve.await {
            log::error!("跨设备传输服务错误: {}", e);
        }
        cleanup_task.abort();
        discovery_task.abort();
        log::info!("跨设备传输服务已停止");
    });

    Ok((actual_port, state, stop_signal, task))
}

async fn serve_index() -> Html<&'static str> {
    Html(INDEX_HTML)
}

async fn api_info(State(handle): State<ServerHandle>) -> Json<serde_json::Value> {
    let urls = build_urls(handle.port);
    let discovered = discovered_devices(&handle.state).await;
    let peers = handle.state.peers.lock().await;
    Json(json!({
        "port": handle.port,
        "urls": urls,
        "discovered": discovered,
        "peerCount": peers.len(),
    }))
}

async fn api_discovered(State(handle): State<ServerHandle>) -> Json<Vec<DiscoveredDevice>> {
    Json(discovered_devices(&handle.state).await)
}

fn build_urls(port: u16) -> Vec<NetworkUrl> {
    list_local_ipv4()
        .into_iter()
        .map(|(iface, ip)| NetworkUrl {
            url: format!("http://{}:{}/", ip, port),
            interface: iface,
            ip,
        })
        .collect()
}

async fn discovered_devices(state: &AppState) -> Vec<DiscoveredDevice> {
    let now = now_millis();
    let mut devices = state.discovered.lock().await;
    devices.retain(|_, d| now - d.last_seen_at <= DISCOVERY_TTL_MS);
    let mut list: Vec<DiscoveredDevice> = devices.values().cloned().collect();
    list.sort_by(|a, b| b.last_seen_at.cmp(&a.last_seen_at));
    list
}

async fn run_discovery(
    state: Arc<AppState>,
    service_port: u16,
    stop_signal: Arc<tokio::sync::Notify>,
) {
    let mdns = match ServiceDaemon::new() {
        Ok(daemon) => daemon,
        Err(e) => {
            log::warn!("跨设备传输 mDNS：启动失败，自动发现已降级: {}", e);
            return;
        }
    };
    let display_name = default_desktop_name();
    let instance = discovery_instance_name();
    let host_name = format!("{}.local.", instance);
    let ips = list_local_ipv4()
        .into_iter()
        .map(|(_, ip)| ip)
        .collect::<Vec<_>>()
        .join(",");
    let mut properties = HashMap::new();
    properties.insert("deviceId".to_string(), DESKTOP_DEVICE_ID.clone());
    properties.insert("displayName".to_string(), display_name.clone());
    properties.insert("version".to_string(), env!("CARGO_PKG_VERSION").to_string());
    let info = match ServiceInfo::new(
        DISCOVERY_SERVICE_TYPE,
        &instance,
        &host_name,
        ips,
        service_port,
        properties,
    ) {
        Ok(info) => info,
        Err(e) => {
            log::warn!("跨设备传输 mDNS：创建服务信息失败: {}", e);
            return;
        }
    };
    if let Err(e) = mdns.register(info) {
        log::warn!("跨设备传输 mDNS：注册服务失败: {}", e);
    }
    let receiver = match mdns.browse(DISCOVERY_SERVICE_TYPE) {
        Ok(receiver) => receiver,
        Err(e) => {
            log::warn!("跨设备传输 mDNS：浏览服务失败: {}", e);
            let _ = mdns.shutdown();
            return;
        }
    };
    let discovery_state = state.clone();
    let discovery_thread = std::thread::spawn(move || {
        while let Ok(event) = receiver.recv() {
            match event {
                ServiceEvent::ServiceResolved(info) => {
                    let device_id = info
                        .get_property_val_str("deviceId")
                        .unwrap_or("")
                        .to_string();
                    if device_id.is_empty() || device_id == *DESKTOP_DEVICE_ID {
                        continue;
                    }
                    let display_name = info
                        .get_property_val_str("displayName")
                        .unwrap_or_else(|| info.get_fullname())
                        .to_string();
                    let host = info
                        .get_addresses_v4()
                        .into_iter()
                        .next()
                        .map(|ip| ip.to_string())
                        .unwrap_or_else(|| info.get_hostname().trim_end_matches('.').to_string());
                    let port = info.get_port();
                    let mut devices = discovery_state.discovered.blocking_lock();
                    devices.insert(
                        device_id.clone(),
                        DiscoveredDevice {
                            device_id,
                            display_name,
                            host: host.clone(),
                            port,
                            url: format!("http://{}:{}/", host, port),
                            last_seen_at: now_millis(),
                        },
                    );
                }
                ServiceEvent::ServiceRemoved(_, _) => {
                    let now = now_millis();
                    let mut devices = discovery_state.discovered.blocking_lock();
                    devices.retain(|_, d| now - d.last_seen_at <= DISCOVERY_TTL_MS);
                }
                _ => {}
            }
        }
    });

    stop_signal.notified().await;
    let _ = mdns.stop_browse(DISCOVERY_SERVICE_TYPE);
    let _ = mdns.shutdown();
    let _ = discovery_thread.join();
}

fn default_desktop_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "CodeShelf".to_string())
}

fn discovery_instance_name() -> String {
    let id = DESKTOP_DEVICE_ID.trim_start_matches("cs-");
    format!("cs-{}", &id[..id.len().min(8)])
}

// ============== File relay ==============

/// 上传前的准入：发送方与接收方都必须是**当前在线的 peer**。
///
/// 以前 `/api/upload` 谁都能打：局域网里任何设备（或被诱导访问该地址的网页）
/// 都能匿名塞 2GB 进内存。token 也从来没和接收方绑定过。
async fn check_upload_peers(
    state: &AppState,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<(String, String), Response> {
    let deny = |msg: &str| {
        (StatusCode::FORBIDDEN, Json(json!({ "error": msg }))).into_response()
    };
    let from = from.map(str::to_string).filter(|s| !s.is_empty());
    let to = to.map(str::to_string).filter(|s| !s.is_empty());
    let (Some(from), Some(to)) = (from, to) else {
        return Err(deny("缺少 from / to：请先加入会话"));
    };
    let peers = state.peers.lock().await;
    if !peers.contains_key(&from) {
        return Err(deny("发送方不在会话中"));
    }
    if !peers.contains_key(&to) {
        return Err(deny("接收方不在会话中"));
    }
    Ok((from, to))
}

/// in-flight 计数的 RAII 守卫：任何提前 return（含错误分支）都会归还名额。
struct UploadSlot(Arc<AppState>);

impl UploadSlot {
    fn acquire(state: &Arc<AppState>) -> Option<Self> {
        use std::sync::atomic::Ordering;
        let n = state.uploads_in_flight.fetch_add(1, Ordering::SeqCst);
        if n >= MAX_CONCURRENT_UPLOADS {
            state.uploads_in_flight.fetch_sub(1, Ordering::SeqCst);
            return None;
        }
        Some(UploadSlot(state.clone()))
    }
}

impl Drop for UploadSlot {
    fn drop(&mut self) {
        self.0
            .uploads_in_flight
            .fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
    }
}

async fn api_upload(
    State(handle): State<ServerHandle>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Response {
    let _slot = match UploadSlot::acquire(&handle.state) {
        Some(s) => s,
        None => {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({ "error": format!("并发上传已达上限（{}），请稍后重试", MAX_CONCURRENT_UPLOADS) })),
            )
                .into_response()
        }
    };

    // from 优先取 header（桌面端），其次取表单字段（浏览器端）
    let mut from = headers
        .get("x-peer-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let mut to: Option<String> = None;
    let mut name: Option<String> = None;
    let mut mime: Option<String> = None;
    let mut bytes: Option<axum::body::Bytes> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let field_name = field.name().unwrap_or("").to_string();
        if field_name == "to" {
            if let Ok(text) = field.text().await {
                to = Some(text);
            }
        } else if field_name == "from" {
            if let Ok(text) = field.text().await {
                if from.is_none() {
                    from = Some(text);
                }
            }
        } else if field_name == "file" {
            // 准入检查放在读 file 之前：未授权请求不该先把整个文件收进内存。
            // multipart 的 to/from 字段由两个客户端排在 file 之前发送。
            if let Err(resp) =
                check_upload_peers(&handle.state, from.as_deref(), to.as_deref()).await
            {
                return resp;
            }
            name = field.file_name().map(|s| s.to_string());
            mime = field.content_type().map(|s| s.to_string());
            match field.bytes().await {
                Ok(b) => {
                    if b.len() > MAX_FILE_SIZE {
                        return (
                            StatusCode::PAYLOAD_TOO_LARGE,
                            Json(json!({ "error": format!("文件超出单文件上限（{} MB）", MAX_FILE_SIZE / 1024 / 1024) })),
                        )
                            .into_response();
                    }
                    bytes = Some(b);
                }
                Err(e) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(json!({ "error": format!("读取文件失败: {}", e) })),
                    )
                        .into_response();
                }
            }
        }
    }

    let (from, to) = match check_upload_peers(&handle.state, from.as_deref(), to.as_deref()).await {
        Ok(pair) => pair,
        Err(resp) => return resp,
    };

    let bytes = match bytes {
        Some(b) => b,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "缺少 file 字段" })),
            )
                .into_response()
        }
    };

    let token = format!("f-{}-{:x}", generate_peer_id(), bytes.len() as u32);
    let size = bytes.len() as u64;

    {
        let mut files = handle.state.files.lock().await;
        // 先清掉过期条目，再算总量 —— 否则过期文件会一直占着额度
        files.retain(|_, f| !f.is_expired());
        let used: usize = files.values().map(|f| f.bytes.len()).sum();
        if used + bytes.len() > MAX_TOTAL_CACHE {
            return (
                StatusCode::INSUFFICIENT_STORAGE,
                Json(json!({
                    "error": format!(
                        "待领取文件缓存已满（{} / {} MB），请让接收方先取走已发送的文件",
                        used / 1024 / 1024,
                        MAX_TOTAL_CACHE / 1024 / 1024
                    )
                })),
            )
                .into_response();
        }
        files.insert(
            token.clone(),
            CachedFile {
                name: name.clone().unwrap_or_else(|| "file".to_string()),
                mime: mime.clone(),
                bytes,
                to,
                from,
                created_at: Instant::now(),
            },
        );
    }

    Json(json!({
        "token": token,
        "name": name,
        "size": size,
    }))
    .into_response()
}

/// `GET /api/file/:token?peer=<自己的 peerId>`
///
/// 下载走 `<a href>` / 后端拉取，带不了自定义请求头，所以身份用 query 参数传。
/// token 会随 WS 通知广播，光有 token 不构成授权 —— 必须是这份文件的收/发件人本人。
async fn api_file(
    State(handle): State<ServerHandle>,
    Path(token): Path<String>,
    axum::extract::Query(q): axum::extract::Query<HashMap<String, String>>,
) -> Response {
    let peer_id = q.get("peer").cloned().unwrap_or_default();
    if peer_id.is_empty() {
        return (StatusCode::FORBIDDEN, "缺少 peer 参数").into_response();
    }

    let cached = {
        let mut files = handle.state.files.lock().await;
        match files.get(&token) {
            // 无权下载时**不要**从缓存里删掉：否则任何人拿 token 打一次
            // 就能让真正的收件人再也取不到（一次性消费被当成删除原语用了）
            Some(f) if !f.may_download(&peer_id) => {
                return (StatusCode::FORBIDDEN, "无权下载该文件").into_response()
            }
            // 一次性消费：取出后从缓存中删除
            Some(_) => files.remove(&token),
            None => None,
        }
    };

    match cached {
        Some(file) => {
            if file.is_expired() {
                return (StatusCode::GONE, "文件已过期").into_response();
            }
            let mut headers = HeaderMap::new();
            let mime = file
                .mime
                .clone()
                .unwrap_or_else(|| "application/octet-stream".to_string());
            if let Ok(v) = HeaderValue::from_str(&mime) {
                headers.insert(header::CONTENT_TYPE, v);
            }
            // RFC 5987 编码文件名，避免非 ASCII 字符问题
            let safe_name = encode_filename(&file.name);
            let disposition = format!(
                "attachment; filename=\"{}\"; filename*=UTF-8''{}",
                file.name
                    .chars()
                    .map(|c| if c.is_ascii() && c != '"' { c } else { '_' })
                    .collect::<String>(),
                safe_name
            );
            if let Ok(v) = HeaderValue::from_str(&disposition) {
                headers.insert(header::CONTENT_DISPOSITION, v);
            }
            headers.insert(
                header::CONTENT_LENGTH,
                HeaderValue::from(file.bytes.len() as u64),
            );
            (StatusCode::OK, headers, Body::from(file.bytes)).into_response()
        }
        None => (StatusCode::NOT_FOUND, "文件不存在或已被领取").into_response(),
    }
}

fn encode_filename(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

// ============== WebSocket ==============

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(qs): Query<ConnectQuery>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    State(handle): State<ServerHandle>,
) -> Response {
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let role = qs.role;
    let suggested_name = qs.name;
    let client_id = qs.client_id;
    ws.on_upgrade(move |socket| {
        handle_socket(socket, addr, ua, role, suggested_name, client_id, handle)
    })
}

async fn handle_socket(
    socket: WebSocket,
    addr: SocketAddr,
    user_agent: String,
    role: Option<String>,
    suggested_name: Option<String>,
    client_id: Option<String>,
    handle: ServerHandle,
) {
    let requested_id = client_id
        .map(|id| {
            id.chars()
                .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
                .take(80)
                .collect::<String>()
        })
        .filter(|id| !id.is_empty());
    let peer_id = {
        let peers = handle.state.peers.lock().await;
        match requested_id {
            Some(id) if !peers.contains_key(&id) => id,
            _ => generate_peer_id(),
        }
    };
    let (default_base, default_type) = guess_display_name(&user_agent);
    let device_type = role.unwrap_or(default_type);
    // 默认名 = 设备类型 + 基于 IP 的 4 位短码（如 "Mac #3f2a"）：同设备稳定、不同设备基本不撞，
    // 比 " (2)" 序号更能区分谁是谁。用户仍可随时改名（set-name），去重作为最后兜底。
    let desired_name = suggested_name
        .map(|s| s.trim().chars().take(32).collect::<String>())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("{} #{}", default_base, short_ip_hash(&addr.ip())));

    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMessage>();

    // 注册 peer：在锁内按当前频道已有名字去重，保证同频道默认名唯一
    let display_name = {
        let mut peers = handle.state.peers.lock().await;
        let taken: HashSet<String> = peers
            .values()
            .map(|e| e.info.display_name.clone())
            .collect();
        let name = dedup_name(&desired_name, &taken);
        peers.insert(
            peer_id.clone(),
            PeerEntry {
                info: PeerInfo {
                    peer_id: peer_id.clone(),
                    display_name: name.clone(),
                    device_type: device_type.clone(),
                    user_agent: user_agent.clone(),
                    is_self: false,
                },
                sender: tx.clone(),
            },
        );
        name
    };

    log::info!(
        "跨设备传输：新连接 peer={} addr={} type={} name={}",
        peer_id,
        addr,
        device_type,
        display_name
    );

    // 发送 welcome
    let _ = tx.send(ServerMessage::Welcome {
        peer_id: peer_id.clone(),
        display_name: display_name.clone(),
    });

    // 广播 peer 列表
    broadcast_peers(&handle.state).await;

    let (mut sink, mut stream) = socket.split();

    // 发送循环
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let text = match serde_json::to_string(&msg) {
                Ok(s) => s,
                Err(e) => {
                    log::error!("序列化失败: {}", e);
                    continue;
                }
            };
            if sink.send(Message::Text(text)).await.is_err() {
                break;
            }
        }
        // 客户端断开时主动关闭，确保 graceful shutdown
        let _ = sink.send(Message::Close(None)).await;
    });

    // 接收循环
    while let Some(msg) = stream.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(e) => {
                log::warn!("WebSocket 接收错误 ({}): {}", peer_id, e);
                break;
            }
        };
        match msg {
            Message::Text(text) => match serde_json::from_str::<ClientMessage>(&text) {
                Ok(cmsg) => handle_client_message(&handle.state, &peer_id, cmsg).await,
                Err(e) => log::warn!("无法解析消息 ({}): {} text={}", peer_id, e, text),
            },
            Message::Close(_) => break,
            _ => {}
        }
    }

    // 清理：移除 peer
    {
        let mut peers = handle.state.peers.lock().await;
        peers.remove(&peer_id);
    }
    log::info!("跨设备传输：断开 peer={}", peer_id);
    send_task.abort();
    broadcast_peers(&handle.state).await;
}

async fn handle_client_message(state: &AppState, sender_id: &str, msg: ClientMessage) {
    match msg {
        ClientMessage::SetName { name } => {
            let trimmed: String = name.trim().chars().take(32).collect();
            if trimmed.is_empty() {
                return;
            }
            let mut peers = state.peers.lock().await;
            // 去重时排除自己，避免用户改的名与他人撞名
            let taken: HashSet<String> = peers
                .iter()
                .filter(|(id, _)| id.as_str() != sender_id)
                .map(|(_, e)| e.info.display_name.clone())
                .collect();
            let final_name = dedup_name(&trimmed, &taken);
            if let Some(entry) = peers.get_mut(sender_id) {
                entry.info.display_name = final_name.clone();
                // 回发 welcome 让发送方同步到最终名字（可能被去重为 "xxx (2)"），
                // 避免自己看到原名、别人看到去重名的不一致
                let _ = entry.sender.send(ServerMessage::Welcome {
                    peer_id: sender_id.to_string(),
                    display_name: final_name,
                });
            }
            drop(peers);
            broadcast_peers(state).await;
        }
        ClientMessage::SendText { to, text } => {
            let trimmed = text.trim().to_string();
            if trimmed.is_empty() {
                return;
            }
            // 单条文本上限 256KB(UTF-8 字节)——长文/粘贴代码够用,又能防滥用撑爆内存。
            // 超限时回发错误给发送方,避免旧行为里"本地显示已发、对方永远收不到"的静默丢失。
            if trimmed.len() > 256 * 1024 {
                let peers = state.peers.lock().await;
                if let Some(sender) = peers.get(sender_id) {
                    let _ = sender.sender.send(ServerMessage::Error {
                        message: "文本过长(超过 256KB),未发送".to_string(),
                    });
                }
                return;
            }
            relay_text(state, sender_id, &to, &trimmed).await;
        }
        ClientMessage::NotifyFile {
            to,
            token,
            name,
            size,
            mime,
        } => {
            relay_file_notice(state, sender_id, &to, &token, &name, size, mime).await;
        }
        ClientMessage::Ping => {
            let peers = state.peers.lock().await;
            if let Some(entry) = peers.get(sender_id) {
                let _ = entry.sender.send(ServerMessage::Pong);
            }
        }
    }
}

async fn broadcast_peers(state: &AppState) {
    let peers = state.peers.lock().await;
    let infos: Vec<PeerInfo> = peers.values().map(|e| e.info.clone()).collect();

    for (peer_id, entry) in peers.iter() {
        // 给每个客户端发的列表里把它自己标为 isSelf=true
        let view: Vec<PeerInfo> = infos
            .iter()
            .map(|p| {
                let mut v = p.clone();
                v.is_self = &v.peer_id == peer_id;
                v
            })
            .collect();
        let _ = entry.sender.send(ServerMessage::Peers { peers: view });
    }
}

async fn relay_text(state: &AppState, from: &str, to: &str, text: &str) {
    let peers = state.peers.lock().await;
    let from_name = peers
        .get(from)
        .map(|e| e.info.display_name.clone())
        .unwrap_or_else(|| "Unknown".to_string());
    if let Some(target) = peers.get(to) {
        let _ = target.sender.send(ServerMessage::Text {
            from: from.to_string(),
            from_name,
            text: text.to_string(),
            ts: now_ms(),
        });
    } else {
        // 通知发送方目标已下线
        if let Some(sender) = peers.get(from) {
            let _ = sender.sender.send(ServerMessage::Error {
                message: "对方已离线".to_string(),
            });
        }
    }
}

async fn relay_file_notice(
    state: &AppState,
    from: &str,
    to: &str,
    token: &str,
    name: &str,
    size: u64,
    mime: Option<String>,
) {
    let peers = state.peers.lock().await;
    let from_name = peers
        .get(from)
        .map(|e| e.info.display_name.clone())
        .unwrap_or_else(|| "Unknown".to_string());
    if let Some(target) = peers.get(to) {
        let _ = target.sender.send(ServerMessage::File {
            from: from.to_string(),
            from_name,
            token: token.to_string(),
            name: name.to_string(),
            size,
            mime,
            ts: now_ms(),
        });
    } else if let Some(sender) = peers.get(from) {
        let _ = sender.sender.send(ServerMessage::Error {
            message: "对方已离线，文件无人领取".to_string(),
        });
    }
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
