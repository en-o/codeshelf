// 静态服务运行时：run_server / proxy_handler / 解码与 hop-by-hop 处理

use crate::error::AppResult;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, Request, StatusCode},
    response::IntoResponse,
    routing::any,
    Router,
};
use socket2::{Domain, Socket, Type};
use tower_http::{
    compression::CompressionLayer,
    cors::{Any, CorsLayer},
    services::ServeDir,
};

use super::super::ServerConfig;
use super::auth;
use super::ServerController;

/// 代理状态
#[derive(Clone)]
struct ProxyState {
    target: String,
}

/// 运行服务
pub(super) async fn run_server(
    _server_id: &str,
    config: ServerConfig,
    controller: Arc<ServerController>,
) -> AppResult<()> {
    // 创建静态文件服务
    let serve_dir = ServeDir::new(&config.root_dir).append_index_html_on_directories(true);

    // 构建路由
    let mut app = Router::new();

    // 计算 URL 前缀（用于代理规则）
    let url_prefix_clean = if config.url_prefix == "/" {
        "".to_string()
    } else {
        format!("/{}", config.url_prefix.trim_matches('/'))
    };

    // 添加多个 API 代理规则
    // API 代理同时在根路径和 URL 前缀路径下生效，以便前端可以使用相对路径
    for proxy in &config.proxies {
        let proxy_state = ProxyState {
            target: proxy.target.clone(),
        };

        // 确保前缀格式正确（以 / 开头，不以 / 结尾）
        let clean_prefix = proxy.prefix.trim_matches('/');

        // 1. 首先在根路径注册代理（全局生效）
        let root_route_path = if clean_prefix.is_empty() {
            "/*path".to_string()
        } else {
            format!("/{}/*path", clean_prefix)
        };
        let root_route_exact = if clean_prefix.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", clean_prefix)
        };

        app = app.route(
            &root_route_path,
            any(proxy_handler).with_state(proxy_state.clone()),
        );
        if !root_route_exact.is_empty() && root_route_exact != "/" {
            app = app.route(
                &root_route_exact,
                any(proxy_handler).with_state(proxy_state.clone()),
            );
        }
        log::info!("代理规则（全局）: {} -> {}", root_route_path, proxy.target);

        // 2. 如果有 URL 前缀，也在前缀路径下注册代理（兼容性）
        if !url_prefix_clean.is_empty() {
            let prefixed_route_path = if clean_prefix.is_empty() {
                format!("{}/*path", url_prefix_clean)
            } else {
                format!("{}/{}/*path", url_prefix_clean, clean_prefix)
            };
            let prefixed_route_exact = if clean_prefix.is_empty() {
                url_prefix_clean.clone()
            } else {
                format!("{}/{}", url_prefix_clean, clean_prefix)
            };

            app = app.route(
                &prefixed_route_path,
                any(proxy_handler).with_state(proxy_state.clone()),
            );
            if !prefixed_route_exact.is_empty() {
                app = app.route(
                    &prefixed_route_exact,
                    any(proxy_handler).with_state(proxy_state),
                );
            }
            log::info!(
                "代理规则（前缀）: {} -> {}",
                prefixed_route_path,
                proxy.target
            );
        }
    }

    // 根据 URL 前缀配置静态文件服务
    if config.url_prefix == "/" {
        // 无前缀，直接在根路径提供服务
        app = app.fallback_service(serve_dir);
    } else {
        // 有前缀，使用 nest_service 挂载静态文件服务
        let prefix = config.url_prefix.trim_matches('/');
        app = app.nest_service(&format!("/{}", prefix), serve_dir);

        // 根路径重定向到前缀路径
        let redirect_prefix = config.url_prefix.clone();
        app = app.route(
            "/",
            axum::routing::get(move || async move {
                axum::response::Redirect::permanent(&format!("{}/", redirect_prefix))
            }),
        );
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

    // 访问控制：登录路由挂在根路径（不受 urlPrefix 影响），鉴权中间件包在最外层，
    // 静态文件和 API 代理一并受保护。没有启用的规则时整段跳过，行为与以前完全一致。
    let auth_state = auth::AuthState::new(config.auth_rules.clone(), config.port);
    if auth_state.has_enabled_rules() {
        log::info!(
            "访问控制已启用，{} 条规则，登录页: {}/login",
            config.auth_rules.iter().filter(|r| r.enabled).count(),
            auth::AUTH_PREFIX
        );
        app = app
            .merge(auth::auth_routes(auth_state.clone()))
            .layer(axum::middleware::from_fn_with_state(
                auth_state,
                auth::require_auth,
            ));
    }

    // 绑定地址：默认只绑 loopback，勾了「对局域网开放」才绑 0.0.0.0
    let addr = SocketAddr::from((
        crate::commands::toolbox::listen_ip(config.expose_lan),
        config.port,
    ));

    log::info!(
        "静态服务启动: http://{}:{}{}",
        crate::commands::toolbox::listen_display_host(config.expose_lan),
        config.port,
        if config.url_prefix == "/" {
            "".to_string()
        } else {
            format!("{}/", config.url_prefix)
        }
    );
    log::info!("根目录: {}", config.root_dir);

    // 使用 socket2 创建支持 SO_REUSEADDR 的 socket
    let socket = Socket::new(Domain::IPV4, Type::STREAM, None)
        .map_err(|e| crate::error::AppError::from(format!("创建 socket 失败: {}", e)))?;

    // 设置 SO_REUSEADDR，允许在 TIME_WAIT 状态时复用端口
    socket
        .set_reuse_address(true)
        .map_err(|e| crate::error::AppError::from(format!("设置 SO_REUSEADDR 失败: {}", e)))?;

    // 设置 SO_LINGER 为 0，使 socket 关闭时立即释放端口（发送 RST 而非 FIN）
    socket
        .set_linger(Some(std::time::Duration::from_secs(0)))
        .map_err(|e| crate::error::AppError::from(format!("设置 SO_LINGER 失败: {}", e)))?;

    // 设置非阻塞模式
    socket
        .set_nonblocking(true)
        .map_err(|e| crate::error::AppError::from(format!("设置非阻塞模式失败: {}", e)))?;

    // 绑定地址
    socket
        .bind(&addr.into())
        .map_err(|e| crate::error::AppError::from(format!("绑定端口失败: {}", e)))?;

    // 监听
    socket
        .listen(1024)
        .map_err(|e| crate::error::AppError::from(format!("监听端口失败: {}", e)))?;

    // 转换为 tokio TcpListener
    let std_listener: std::net::TcpListener = socket.into();
    let listener = tokio::net::TcpListener::from_std(std_listener)
        .map_err(|e| crate::error::AppError::from(format!("创建 TcpListener 失败: {}", e)))?;

    // 使用 axum::serve 并添加 graceful shutdown
    let server = axum::serve(listener, app);

    // 创建 shutdown 信号
    let ctrl = controller.clone();
    let shutdown_signal = async move {
        loop {
            if ctrl.is_stopped() {
                break;
            }
            // 减少检测间隔，更快响应停止信号
            tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
        }
    };

    // 运行服务器
    server
        .with_graceful_shutdown(shutdown_signal)
        .await
        .map_err(|e| crate::error::AppError::from(format!("服务错误: {}", e)))?;

    log::info!("静态服务停止: {}", config.port);

    Ok(())
}

/// API 代理处理器 - 使用 TCP 级别转发
/// 代理请求的读取上限与超时。裸 `read_to_end` 没有任何边界：
/// 目标服务器发多少就吃多少，一个大响应或慢连接就能拖垮整个静态服务进程。
const PROXY_MAX_BODY_BYTES: usize = 32 * 1024 * 1024;
const PROXY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
const PROXY_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// 反向代理。
///
/// 这里原本是约 170 行手写的 HTTP/1.1 客户端（裸 `TcpStream` + 自己拼请求、
/// 自己解析响应头、自己解 chunked）。它有几个真问题：
///   - 配置里写 `https://` 也会被剥掉 scheme 后走**明文** TCP，HTTPS 目标根本用不了；
///   - `read_to_end` 无上限、无读超时，大响应或慢连接直接把服务拖垮；
///   - 手写的 header/chunked 解析在边缘情况上与规范有出入。
///
/// 换成 reqwest（已是直接依赖，带 rustls）：协议正确、超时和大小边界齐全，
/// 顺带删掉了 `decode_chunked` 那一整套手写解码。
async fn proxy_handler(
    State(state): State<ProxyState>,
    Path(path): Path<String>,
    req: Request<Body>,
) -> impl IntoResponse {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let headers = req.headers().clone();

    let query = uri.query().map(|q| format!("?{}", q)).unwrap_or_default();
    let target_path = if path.is_empty() {
        if query.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", query.trim_start_matches('?'))
        }
    } else {
        format!("/{}{}", path, query)
    };

    // 目标可以是 http:// 或 https://；没写 scheme 时按 http 处理（兼容既有配置）
    let target = state.target.trim_end_matches('/');
    let target_url = if target.starts_with("http://") || target.starts_with("https://") {
        format!("{}{}", target, target_path)
    } else {
        format!("http://{}{}", target, target_path)
    };

    log::info!("代理请求: {} {} -> {}", method, uri, target_url);

    let body_bytes = match axum::body::to_bytes(req.into_body(), PROXY_MAX_BODY_BYTES).await {
        Ok(bytes) => bytes,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("读取请求体失败: {}", e)).into_response();
        }
    };

    let client = match reqwest::Client::builder()
        .timeout(PROXY_TIMEOUT)
        .connect_timeout(PROXY_CONNECT_TIMEOUT)
        // 代理要如实转发上游的重定向响应，不能自己跟过去
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("创建代理客户端失败: {}", e),
            )
                .into_response();
        }
    };

    let mut outbound = client.request(method.clone(), &target_url);
    for (name, value) in headers.iter() {
        let name_str = name.as_str().to_lowercase();
        // host 交给 reqwest 按目标地址重设；content-length 由 body 决定
        if name_str != "host" && name_str != "content-length" && !is_hop_by_hop_header(&name_str) {
            outbound = outbound.header(name, value);
        }
    }
    if !body_bytes.is_empty() {
        outbound = outbound.body(body_bytes.to_vec());
    }

    let resp = match outbound.send().await {
        Ok(r) => r,
        Err(e) => {
            log::error!("代理请求失败: {} -> {}", target_url, e);
            return (StatusCode::BAD_GATEWAY, format!("代理请求失败: {}", e)).into_response();
        }
    };

    let status = resp.status();
    let mut response_headers = HeaderMap::new();
    for (name, value) in resp.headers().iter() {
        if !is_hop_by_hop_header(name.as_str()) {
            response_headers.insert(name.clone(), value.clone());
        }
    }

    // 流式读取并在上限处停止（reqwest 已经替我们解好了 chunked）
    let (body, truncated) = match crate::http_body::read_capped(resp, PROXY_MAX_BODY_BYTES).await {
        Ok(v) => v,
        Err(e) => {
            return (StatusCode::BAD_GATEWAY, format!("读取代理响应失败: {}", e)).into_response();
        }
    };
    if truncated {
        log::warn!(
            "代理响应超过 {} MB 上限，已截断: {}",
            PROXY_MAX_BODY_BYTES / 1024 / 1024,
            target_url
        );
    }

    if !status.is_success() {
        log::warn!(
            "代理响应: {} -> {} | body: {}",
            target_url,
            status,
            String::from_utf8_lossy(&body).chars().take(200).collect::<String>()
        );
    }

    response_headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        header::HeaderValue::from_static("*"),
    );
    // 长度已由实际 body 决定；chunked 也已经解开，这两个头必须去掉，否则与实际不符
    response_headers.remove(header::CONTENT_LENGTH);
    response_headers.remove(header::TRANSFER_ENCODING);

    (status, response_headers, body).into_response()
}

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
