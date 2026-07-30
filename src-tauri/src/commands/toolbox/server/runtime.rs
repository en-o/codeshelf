// 静态服务运行时：run_server / proxy_handler / 解码与 hop-by-hop 处理

use crate::error::AppResult;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, Method, Request, StatusCode},
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
async fn proxy_handler(
    State(state): State<ProxyState>,
    Path(path): Path<String>,
    req: Request<Body>,
) -> impl IntoResponse {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let headers = req.headers().clone();

    // 构建目标 URL
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

    // 解析目标地址 (格式: http://host:port 或 http://host:port/path)
    let target = state.target.trim_end_matches('/');
    let target_without_scheme = target
        .strip_prefix("http://")
        .or_else(|| target.strip_prefix("https://"))
        .unwrap_or(target);

    // 分离 host:port 和 path
    let (host_port, base_path) = match target_without_scheme.find('/') {
        Some(pos) => (&target_without_scheme[..pos], &target_without_scheme[pos..]),
        None => (target_without_scheme, ""),
    };

    let target_addr = host_port.to_string();
    let full_path = format!("{}{}", base_path, target_path);

    log::info!(
        "代理请求: {} {} -> {}{}",
        method,
        uri,
        target_addr,
        full_path
    );

    // 读取请求体
    let body_bytes = match axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("读取请求体失败: {}", e)).into_response();
        }
    };

    // 连接到目标服务器
    let mut stream = match tokio::net::TcpStream::connect(&target_addr).await {
        Ok(s) => s,
        Err(e) => {
            log::error!("连接目标服务器失败: {} -> {}", target_addr, e);
            return (
                StatusCode::BAD_GATEWAY,
                format!("连接目标服务器失败: {}", e),
            )
                .into_response();
        }
    };

    // 构建原始 HTTP 请求
    let mut raw_request = format!("{} {} HTTP/1.1\r\n", method, full_path);
    raw_request.push_str(&format!("Host: {}\r\n", target_addr));

    // 复制请求头（跳过 host、content-length 和 hop-by-hop 头）
    for (name, value) in headers.iter() {
        let name_str = name.as_str().to_lowercase();
        if name_str != "host" && name_str != "content-length" && !is_hop_by_hop_header(&name_str) {
            if let Ok(v) = value.to_str() {
                raw_request.push_str(&format!("{}: {}\r\n", name, v));
            }
        }
    }

    // 设置 Content-Length（POST/PUT/PATCH 必须有）
    if !body_bytes.is_empty()
        || method == Method::POST
        || method == Method::PUT
        || method == Method::PATCH
    {
        raw_request.push_str(&format!("Content-Length: {}\r\n", body_bytes.len()));
    }

    raw_request.push_str("Connection: close\r\n");
    raw_request.push_str("\r\n");

    log::info!("原始请求行: {} {} HTTP/1.1", method, full_path);

    // 发送请求头
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    if let Err(e) = stream.write_all(raw_request.as_bytes()).await {
        return (StatusCode::BAD_GATEWAY, format!("发送请求失败: {}", e)).into_response();
    }

    // 发送请求体
    if !body_bytes.is_empty() {
        if let Err(e) = stream.write_all(&body_bytes).await {
            return (StatusCode::BAD_GATEWAY, format!("发送请求体失败: {}", e)).into_response();
        }
    }

    // 读取响应
    let mut response_bytes = Vec::new();
    if let Err(e) = stream.read_to_end(&mut response_bytes).await {
        return (StatusCode::BAD_GATEWAY, format!("读取响应失败: {}", e)).into_response();
    }

    // 解析响应
    let response_str = String::from_utf8_lossy(&response_bytes);
    let header_end = response_str.find("\r\n\r\n").unwrap_or(response_str.len());
    let header_part = &response_str[..header_end];
    let body_start = if header_end + 4 <= response_bytes.len() {
        header_end + 4
    } else {
        response_bytes.len()
    };

    // 解析状态码
    let status_line = header_part
        .lines()
        .next()
        .unwrap_or("HTTP/1.1 502 Bad Gateway");
    let status_code: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(502);

    let status = StatusCode::from_u16(status_code).unwrap_or(StatusCode::BAD_GATEWAY);

    // 检查是否是 chunked 编码
    let is_chunked = header_part
        .to_lowercase()
        .contains("transfer-encoding: chunked");

    // 获取响应体
    let body_data = &response_bytes[body_start..];
    let body = if is_chunked {
        // 解码 chunked 数据
        decode_chunked(body_data)
    } else {
        body_data.to_vec()
    };

    if !status.is_success() {
        log::warn!(
            "代理响应: {} -> {} | body: {}",
            target_addr,
            status,
            String::from_utf8_lossy(&body)
                .chars()
                .take(200)
                .collect::<String>()
        );
    }

    // 解析响应头
    let mut response_headers = HeaderMap::new();
    for line in header_part.lines().skip(1) {
        if let Some(pos) = line.find(':') {
            let name = line[..pos].trim();
            let value = line[pos + 1..].trim();
            if !is_hop_by_hop_header(name) {
                if let (Ok(n), Ok(v)) = (
                    header::HeaderName::from_bytes(name.as_bytes()),
                    header::HeaderValue::from_str(value),
                ) {
                    response_headers.insert(n, v);
                }
            }
        }
    }

    // 添加 CORS 头
    response_headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        header::HeaderValue::from_static("*"),
    );

    // 移除 transfer-encoding 头（因为我们已经解码了 chunked）
    response_headers.remove("transfer-encoding");

    (status, response_headers, body).into_response()
}

/// 解码 chunked 传输编码
fn decode_chunked(data: &[u8]) -> Vec<u8> {
    let mut result = Vec::new();
    let mut pos = 0;
    let data_str = String::from_utf8_lossy(data);

    loop {
        // 找到 chunk 大小行的结尾
        let line_end = match data_str[pos..].find("\r\n") {
            Some(p) => pos + p,
            None => break,
        };

        // 解析 chunk 大小（十六进制）
        let size_str = data_str[pos..line_end].trim();
        // chunk 大小可能带有扩展，如 "1a; ext=value"，只取第一部分
        let size_hex = size_str.split(';').next().unwrap_or("0").trim();
        let chunk_size = match usize::from_str_radix(size_hex, 16) {
            Ok(s) => s,
            Err(_) => break,
        };

        // chunk 大小为 0 表示结束
        if chunk_size == 0 {
            break;
        }

        // 数据开始位置
        let chunk_start = line_end + 2;
        let chunk_end = chunk_start + chunk_size;

        if chunk_end > data.len() {
            // 数据不完整，返回已解码的部分
            break;
        }

        // 复制 chunk 数据
        result.extend_from_slice(&data[chunk_start..chunk_end]);

        // 移动到下一个 chunk（跳过 \r\n）
        pos = chunk_end + 2;
        if pos >= data.len() {
            break;
        }
    }

    result
}

/// 转换 HTTP 方法
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
