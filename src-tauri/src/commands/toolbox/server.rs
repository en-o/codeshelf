// 静态服务模块 - 本地 Web 服务器，支持 CORS、gzip、API 代理

use super::{current_time, generate_id, ServerConfig, ServerConfigInput};
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, Method, Request, StatusCode},
    response::IntoResponse,
    routing::any,
    Router,
};
use once_cell::sync::Lazy;
use socket2::{Domain, Socket, Type};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::{
    compression::CompressionLayer,
    cors::{Any, CorsLayer},
    services::ServeDir,
};

/// 服务配置存储
static SERVERS: Lazy<Arc<Mutex<HashMap<String, ServerConfig>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// 服务控制器
static SERVER_CONTROLLERS: Lazy<Arc<Mutex<HashMap<String, Arc<ServerController>>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// 服务控制器
struct ServerController {
    stop: AtomicBool,
}

impl ServerController {
    fn new() -> Self {
        Self {
            stop: AtomicBool::new(false),
        }
    }

    fn is_stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }

    fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

/// 代理状态
#[derive(Clone)]
struct ProxyState {
    target: String,
    client: reqwest::Client,
}

/// 创建服务
#[tauri::command]
pub async fn create_server(input: ServerConfigInput) -> Result<ServerConfig, String> {
    // 验证
    if input.port == 0 {
        return Err("端口不能为 0".to_string());
    }
    if input.root_dir.is_empty() {
        return Err("根目录不能为空".to_string());
    }

    // 检查目录是否存在
    let root_path = PathBuf::from(&input.root_dir);
    if !root_path.exists() {
        return Err(format!("目录不存在: {}", input.root_dir));
    }

    // 检查端口是否已被使用
    {
        let servers = SERVERS.lock().await;
        for server in servers.values() {
            if server.port == input.port && server.status == "running" {
                return Err(format!("端口 {} 已被其他服务使用", input.port));
            }
        }
    }

    // 处理 URL 前缀：默认使用目录名
    let url_prefix = match input.url_prefix {
        Some(ref prefix) if prefix == "/" => "/".to_string(),
        Some(ref prefix) if !prefix.is_empty() => {
            let p = prefix.trim_matches('/');
            if p.is_empty() { "/".to_string() } else { format!("/{}", p) }
        }
        _ => {
            // 默认使用目录名作为前缀
            if let Some(dir_name) = root_path.file_name().and_then(|n| n.to_str()) {
                format!("/{}", dir_name)
            } else {
                "/".to_string()
            }
        }
    };

    let server_id = generate_id();
    let config = ServerConfig {
        id: server_id.clone(),
        name: input.name,
        port: input.port,
        root_dir: input.root_dir,
        cors: input.cors.unwrap_or(true),
        gzip: input.gzip.unwrap_or(true),
        cache_control: input.cache_control,
        url_prefix,
        proxies: input.proxies.unwrap_or_default(),
        status: "stopped".to_string(),
        created_at: current_time(),
    };

    // 保存配置
    {
        let mut servers = SERVERS.lock().await;
        servers.insert(server_id.clone(), config.clone());
    }

    Ok(config)
}

/// 启动服务
#[tauri::command]
pub async fn start_server(server_id: String) -> Result<String, String> {
    // 获取配置
    let config = {
        let servers = SERVERS.lock().await;
        servers.get(&server_id).cloned()
    };

    let config = config.ok_or_else(|| format!("服务不存在: {}", server_id))?;

    if config.status == "running" {
        return Err("服务已在运行中".to_string());
    }

    // 创建控制器
    let controller = Arc::new(ServerController::new());

    // 保存控制器
    {
        let mut controllers = SERVER_CONTROLLERS.lock().await;
        controllers.insert(server_id.clone(), controller.clone());
    }

    // 更新状态
    {
        let mut servers = SERVERS.lock().await;
        if let Some(s) = servers.get_mut(&server_id) {
            s.status = "running".to_string();
        }
    }

    let id = server_id.clone();
    let port = config.port;
    let url_prefix = config.url_prefix.clone();

    // 启动服务
    tokio::spawn(async move {
        if let Err(e) = run_server(&id, config, controller).await {
            log::error!("服务错误: {}", e);
        }

        // 更新状态
        let mut servers = SERVERS.lock().await;
        if let Some(s) = servers.get_mut(&id) {
            s.status = "stopped".to_string();
        }
    });

    // 返回带前缀的 URL
    if url_prefix == "/" {
        Ok(format!("http://127.0.0.1:{}", port))
    } else {
        Ok(format!("http://127.0.0.1:{}{}/", port, url_prefix))
    }
}

/// 运行服务
async fn run_server(
    _server_id: &str,
    config: ServerConfig,
    controller: Arc<ServerController>,
) -> Result<(), String> {
    // 创建静态文件服务
    let serve_dir = ServeDir::new(&config.root_dir)
        .append_index_html_on_directories(true);

    // 构建路由
    let mut app = Router::new();

    // 添加多个 API 代理规则
    for proxy in &config.proxies {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

        let proxy_state = ProxyState {
            target: proxy.target.clone(),
            client,
        };

        let prefix = format!("/{}/*path", proxy.prefix.trim_matches('/'));
        app = app.route(&prefix, any(proxy_handler).with_state(proxy_state));

        log::info!("代理规则: /{} -> {}", proxy.prefix.trim_matches('/'), proxy.target);
    }

    // 根据 URL 前缀配置静态文件服务
    if config.url_prefix == "/" {
        // 无前缀，直接在根路径提供服务
        app = app.fallback_service(serve_dir);
    } else {
        // 有前缀，需要在特定路径提供服务
        let prefix = config.url_prefix.trim_matches('/');
        let nested_router = Router::new().fallback_service(serve_dir);
        app = app.nest(&format!("/{}", prefix), nested_router);

        // 根路径重定向到前缀路径
        let redirect_prefix = config.url_prefix.clone();
        app = app.route("/", axum::routing::get(move || async move {
            axum::response::Redirect::permanent(&format!("{}/", redirect_prefix))
        }));
    }

    // 添加 CORS
    if config.cors {
        app = app.layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        );
    }

    // 添加 gzip 压缩
    if config.gzip {
        app = app.layer(CompressionLayer::new());
    }

    // 绑定地址
    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));

    log::info!("静态服务启动: http://127.0.0.1:{}{}", config.port,
        if config.url_prefix == "/" { "".to_string() } else { format!("{}/", config.url_prefix) });
    log::info!("根目录: {}", config.root_dir);

    // 使用 socket2 创建支持 SO_REUSEADDR 的 socket
    let socket = Socket::new(Domain::IPV4, Type::STREAM, None)
        .map_err(|e| format!("创建 socket 失败: {}", e))?;

    // 设置 SO_REUSEADDR，允许在 TIME_WAIT 状态时复用端口
    socket.set_reuse_address(true)
        .map_err(|e| format!("设置 SO_REUSEADDR 失败: {}", e))?;

    // 设置非阻塞模式
    socket.set_nonblocking(true)
        .map_err(|e| format!("设置非阻塞模式失败: {}", e))?;

    // 绑定地址
    socket.bind(&addr.into())
        .map_err(|e| format!("绑定端口失败: {}", e))?;

    // 监听
    socket.listen(1024)
        .map_err(|e| format!("监听端口失败: {}", e))?;

    // 转换为 tokio TcpListener
    let std_listener: std::net::TcpListener = socket.into();
    let listener = tokio::net::TcpListener::from_std(std_listener)
        .map_err(|e| format!("创建 TcpListener 失败: {}", e))?;

    // 使用 axum::serve 并添加 graceful shutdown
    let server = axum::serve(listener, app);

    // 创建 shutdown 信号
    let ctrl = controller.clone();
    let shutdown_signal = async move {
        loop {
            if ctrl.is_stopped() {
                break;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
    };

    // 运行服务器
    server
        .with_graceful_shutdown(shutdown_signal)
        .await
        .map_err(|e| format!("服务错误: {}", e))?;

    log::info!("静态服务停止: {}", config.port);

    Ok(())
}

/// API 代理处理器
async fn proxy_handler(
    State(state): State<ProxyState>,
    Path(path): Path<String>,
    req: Request<Body>,
) -> impl IntoResponse {
    let method = req.method().clone();
    let headers = req.headers().clone();
    let uri = req.uri().clone();

    // 构建目标 URL
    let query = uri.query().map(|q| format!("?{}", q)).unwrap_or_default();
    let target_url = format!("{}/{}{}", state.target.trim_end_matches('/'), path, query);

    // 构建请求
    let mut proxy_req = state.client.request(
        convert_method(&method),
        &target_url,
    );

    // 复制请求头
    for (name, value) in headers.iter() {
        let name_str = name.as_str();
        // 跳过 hop-by-hop 头和 host
        if !is_hop_by_hop_header(name_str) && name_str != "host" {
            if let Ok(v) = value.to_str() {
                proxy_req = proxy_req.header(name_str, v);
            }
        }
    }

    // 设置正确的 Host 头
    if let Ok(url) = reqwest::Url::parse(&target_url) {
        if let Some(host) = url.host_str() {
            let host_header = if let Some(port) = url.port() {
                format!("{}:{}", host, port)
            } else {
                host.to_string()
            };
            proxy_req = proxy_req.header("Host", host_header);
        }
    }

    // 读取请求体
    let body_bytes = match axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                format!("读取请求体失败: {}", e),
            )
                .into_response();
        }
    };

    if !body_bytes.is_empty() {
        proxy_req = proxy_req.body(body_bytes.to_vec());
    }

    // 发送请求
    let response = match proxy_req.send().await {
        Ok(resp) => resp,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("代理请求失败: {}", e),
            )
                .into_response();
        }
    };

    // 构建响应
    let status = StatusCode::from_u16(response.status().as_u16())
        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);

    let mut response_headers = HeaderMap::new();
    for (name, value) in response.headers().iter() {
        if !is_hop_by_hop_header(name.as_str()) {
            if let Ok(v) = header::HeaderValue::from_str(value.to_str().unwrap_or("")) {
                response_headers.insert(name.clone(), v);
            }
        }
    }

    // 添加 CORS 头
    response_headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        header::HeaderValue::from_static("*"),
    );

    let body = match response.bytes().await {
        Ok(bytes) => bytes.to_vec(),
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("读取响应失败: {}", e),
            )
                .into_response();
        }
    };

    (status, response_headers, body).into_response()
}

/// 转换 HTTP 方法
fn convert_method(method: &Method) -> reqwest::Method {
    match *method {
        Method::GET => reqwest::Method::GET,
        Method::POST => reqwest::Method::POST,
        Method::PUT => reqwest::Method::PUT,
        Method::DELETE => reqwest::Method::DELETE,
        Method::PATCH => reqwest::Method::PATCH,
        Method::HEAD => reqwest::Method::HEAD,
        Method::OPTIONS => reqwest::Method::OPTIONS,
        _ => reqwest::Method::GET,
    }
}

/// 检查是否是 hop-by-hop 头
fn is_hop_by_hop_header(name: &str) -> bool {
    matches!(
        name.to_lowercase().as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailers"
            | "transfer-encoding"
            | "upgrade"
    )
}

/// 停止服务
#[tauri::command]
pub async fn stop_server(server_id: String) -> Result<(), String> {
    // 发送停止信号
    {
        let controllers = SERVER_CONTROLLERS.lock().await;
        if let Some(controller) = controllers.get(&server_id) {
            controller.stop();
        }
    }

    // 等待一小段时间让服务停止
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    // 更新状态
    {
        let mut servers = SERVERS.lock().await;
        if let Some(server) = servers.get_mut(&server_id) {
            server.status = "stopped".to_string();
        }
    }

    // 移除控制器
    {
        let mut controllers = SERVER_CONTROLLERS.lock().await;
        controllers.remove(&server_id);
    }

    Ok(())
}

/// 移除服务
#[tauri::command]
pub async fn remove_server(server_id: String) -> Result<(), String> {
    // 先停止服务
    let _ = stop_server(server_id.clone()).await;

    // 移除配置
    {
        let mut servers = SERVERS.lock().await;
        servers.remove(&server_id);
    }

    Ok(())
}

/// 获取所有服务
#[tauri::command]
pub async fn get_servers() -> Result<Vec<ServerConfig>, String> {
    let servers = SERVERS.lock().await;
    Ok(servers.values().cloned().collect())
}

/// 获取单个服务
#[tauri::command]
pub async fn get_server(server_id: String) -> Result<Option<ServerConfig>, String> {
    let servers = SERVERS.lock().await;
    Ok(servers.get(&server_id).cloned())
}

/// 更新服务配置
#[tauri::command]
pub async fn update_server(server_id: String, input: ServerConfigInput) -> Result<ServerConfig, String> {
    // 获取当前配置
    let current = {
        let servers = SERVERS.lock().await;
        servers.get(&server_id).cloned()
    };

    let current = current.ok_or_else(|| format!("服务不存在: {}", server_id))?;

    // 如果正在运行，先停止
    if current.status == "running" {
        stop_server(server_id.clone()).await?;
    }

    // 处理 URL 前缀
    let root_path = PathBuf::from(&input.root_dir);
    let url_prefix = match input.url_prefix {
        Some(ref prefix) if prefix == "/" => "/".to_string(),
        Some(ref prefix) if !prefix.is_empty() => {
            let p = prefix.trim_matches('/');
            if p.is_empty() { "/".to_string() } else { format!("/{}", p) }
        }
        _ => {
            // 默认使用目录名作为前缀
            if let Some(dir_name) = root_path.file_name().and_then(|n| n.to_str()) {
                format!("/{}", dir_name)
            } else {
                "/".to_string()
            }
        }
    };

    // 更新配置
    {
        let mut servers = SERVERS.lock().await;
        if let Some(server) = servers.get_mut(&server_id) {
            server.name = input.name;
            server.port = input.port;
            server.root_dir = input.root_dir;
            server.cors = input.cors.unwrap_or(true);
            server.gzip = input.gzip.unwrap_or(true);
            server.cache_control = input.cache_control;
            server.url_prefix = url_prefix;
            server.proxies = input.proxies.unwrap_or_default();
        }
    }

    let servers = SERVERS.lock().await;
    servers
        .get(&server_id)
        .cloned()
        .ok_or_else(|| "服务不存在".to_string())
}
