use crate::error::AppResult;
use axum::{
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, net::SocketAddr, sync::Arc};
use tokio::sync::{oneshot, Mutex};
use tower_http::cors::CorsLayer;

use crate::commands::api_chat::{execute_api_endpoint, list_api_endpoints};
use crate::storage::{self, ApiEndpoint, AppSettings, McpGatewayKey};

const DEFAULT_PROTOCOL_VERSION: &str = "2024-11-05";

static APP_HTTP_GATEWAY: Lazy<Mutex<Option<AppHttpGateway>>> = Lazy::new(|| Mutex::new(None));

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct McpGatewayStatus {
    pub running: bool,
    pub url: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub started_at: Option<String>,
}

/// 供前端"以 MCP 客户端身份"调用本地网关时使用：
/// - url：HTTP 端点（含 scheme/host/port），如果网关未运行则不返回
/// - api_key：从 mcp_gateway_keys 里挑第一个有效 key。若 keys 为空（网关无鉴权）则为 None
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct McpGatewayInternalEndpoint {
    pub url: String,
    pub api_key: Option<String>,
}

struct AppHttpGateway {
    host: String,
    port: u16,
    started_at: DateTime<Utc>,
    shutdown: Option<oneshot::Sender<()>>,
    task: tokio::task::JoinHandle<()>,
}

#[derive(Debug, Deserialize, specta::Type)]
struct JsonRpcRequest {
    #[serde(default)]
    jsonrpc: Option<String>,
    #[serde(default)]
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Option<Value>,
}

#[derive(Debug, Serialize, specta::Type)]
struct JsonRpcResponse {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize, specta::Type)]
struct JsonRpcError {
    code: i64,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct ToolsCallParams {
    name: String,
    #[serde(default)]
    arguments: Option<Value>,
}

#[derive(Clone)]
struct HttpState;

/// 允许携带 Origin 访问网关的来源，只有 Tauri webview 这几个。
///
/// 应用自己的前端是用浏览器 `fetch()` 打到 `http://127.0.0.1:port/mcp` 的（见
/// `src/services/mcp/client.ts`），所以 CORS 不能直接删掉；但也绝不能是 `*` ——
/// loopback 不是身份认证，任何网页都能往 localhost 发请求。
///
/// 真正的 MCP 客户端（Claude Desktop、curl、SDK）不是浏览器，不会带 Origin，
/// 走 `origin_allowed` 里 None 那条分支，只受密钥校验约束。
const ALLOWED_ORIGINS: [&str; 3] = [
    "tauri://localhost",       // macOS / Linux
    "http://tauri.localhost",  // Windows
    "https://tauri.localhost", // Windows（自定义协议走 https 时）
];

/// 无 Origin = 非浏览器请求，放行（仍需密钥）；有 Origin 则必须在白名单里。
fn origin_allowed(headers: &HeaderMap) -> bool {
    match headers.get("origin").and_then(|v| v.to_str().ok()) {
        None => true,
        Some(origin) => ALLOWED_ORIGINS.contains(&origin),
    }
}

fn http_router() -> Router {
    let cors = CorsLayer::new()
        .allow_origin(
            ALLOWED_ORIGINS
                .iter()
                .map(|o| HeaderValue::from_static(o))
                .collect::<Vec<_>>(),
        )
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
            axum::http::HeaderName::from_static("x-api-key"),
        ]);

    Router::new()
        .route("/", get(http_index))
        .route("/health", get(http_health))
        .route("/mcp", get(http_index).post(http_mcp))
        .layer(cors)
        .with_state(Arc::new(HttpState))
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_gateway_status() -> AppResult<McpGatewayStatus> {
    let guard = APP_HTTP_GATEWAY.lock().await;
    Ok(status_from_gateway(guard.as_ref()))
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_gateway_internal_endpoint() -> AppResult<Option<McpGatewayInternalEndpoint>> {
    let status = {
        let guard = APP_HTTP_GATEWAY.lock().await;
        status_from_gateway(guard.as_ref())
    };
    if !status.running {
        return Ok(None);
    }
    let url = match status.url {
        Some(u) => u,
        None => return Ok(None),
    };
    let settings = crate::commands::settings::get_app_settings().await?;
    // 网关运行时 ensure_gateway_key 保证至少有一个可用密钥，正常情况下这里必然拿得到
    let api_key = active_mcp_keys(&settings.mcp_gateway_keys)
        .first()
        .map(|k| k.key.clone());
    Ok(Some(McpGatewayInternalEndpoint { url, api_key }))
}

pub async fn apply_settings_from_storage() -> AppResult<McpGatewayStatus> {
    let settings = crate::commands::settings::get_app_settings().await?;
    apply_settings(&settings).await
}

pub async fn apply_settings(settings: &AppSettings) -> AppResult<McpGatewayStatus> {
    if settings.mcp_gateway_enabled {
        // 不存在「已启动但无鉴权」的状态：没有可用密钥就先自动生成一个再启动。
        //
        // 以前是「keys 为空 → validate_mcp_auth 直接放行」，只靠"必须监听回环"兜底。
        // 但 loopback 不是身份认证 —— 任何网页都能往 127.0.0.1 发请求，
        // 借用 CodeShelf 已保存的 endpoint 和认证信息打真实 API。
        ensure_gateway_key().await?;
        start_gateway(settings.mcp_gateway_host.clone(), settings.mcp_gateway_port).await
    } else {
        stop_gateway().await
    }
}

/// 保证设置里至少有一个启用且未过期的网关密钥，没有就生成一个并落盘。
/// 返回后 `active_mcp_keys` 必然非空。
async fn ensure_gateway_key() -> AppResult<()> {
    let settings = crate::commands::settings::get_app_settings().await?;
    if !active_mcp_keys(&settings.mcp_gateway_keys).is_empty() {
        return Ok(());
    }
    let key = McpGatewayKey {
        id: format!("auto-{}", Utc::now().timestamp_millis()),
        name: "自动生成".to_string(),
        key: generate_gateway_key()?,
        enabled: true,
        created_at: Utc::now().to_rfc3339(),
        expires_at: None,
    };
    let mut keys = settings.mcp_gateway_keys.clone();
    keys.push(key);
    crate::commands::settings::set_mcp_gateway_keys(keys).await
}

/// 生成 v1 格式的网关密钥：`cs_mcp_v1_<43 chars base64url>_<4 chars 校验码>`。
///
/// 格式与前端 `src/pages/Settings/mcpGateway/utils.ts` 保持一致 —— 那里定义了
/// 这套前缀 + 版本号 + FNV-1a 校验码，UI 会按它校验和展示，自动生成的密钥
/// 不能另起一套格式。随机源用 getrandom（操作系统 CSPRNG），32 字节。
fn generate_gateway_key() -> AppResult<String> {
    let mut buf = [0u8; 32];
    getrandom::getrandom(&mut buf)
        .map_err(|e| crate::error::AppError::from(format!("生成 MCP 网关密钥失败: {}", e)))?;

    let random = base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, buf);
    // 注意：校验码只覆盖**随机段**，不含 `cs_mcp_v1_` 前缀 —— 前端是 checksumOf(random)
    Ok(format!("cs_mcp_v1_{}_{}", random, fnv1a_checksum(&random)))
}

/// 32-bit FNV-1a 取 20bit → 4 字符 base32，与前端 `fnv1a` + `checksumOf` 逐位对应
/// （`wrapping_mul` 对应 JS 的 `Math.imul`）。
fn fnv1a_checksum(payload: &str) -> String {
    const CHECKSUM_ALPHABET: &[u8] = b"abcdefghijkmnpqrstuvwxyz23456789";
    let mut hash: u32 = 0x811c_9dc5;
    for b in payload.bytes() {
        hash ^= b as u32;
        hash = hash.wrapping_mul(0x0100_0193);
    }
    let pick = |shift: u32| CHECKSUM_ALPHABET[((hash >> shift) & 0x1f) as usize] as char;
    [pick(15), pick(10), pick(5), pick(0)].iter().collect()
}

async fn start_gateway(host: String, port: u16) -> AppResult<McpGatewayStatus> {
    storage::init_storage()?;
    let addr: SocketAddr = format!("{}:{}", host, port)
        .parse()
        .map_err(|e| crate::error::AppError::from(format!("invalid HTTP bind address: {}", e)))?;

    let mut guard = APP_HTTP_GATEWAY.lock().await;
    if let Some(existing) = guard.as_ref() {
        if existing.host == host && existing.port == port && !existing.task.is_finished() {
            return Ok(status_from_gateway(guard.as_ref()));
        }

        if let Some(mut old) = guard.take() {
            if let Some(tx) = old.shutdown.take() {
                let _ = tx.send(());
            }
            old.task.abort();
        }
    }

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| crate::error::AppError::from(format!("HTTP bind failed: {}", e)))?;
    let (tx, rx) = oneshot::channel::<()>();
    let task = tokio::spawn(async move {
        let server = axum::serve(listener, http_router()).with_graceful_shutdown(async {
            let _ = rx.await;
        });
        if let Err(err) = server.await {
            eprintln!("CodeShelf MCP gateway stopped with error: {}", err);
        }
    });

    *guard = Some(AppHttpGateway {
        host,
        port,
        started_at: Utc::now(),
        shutdown: Some(tx),
        task,
    });

    Ok(status_from_gateway(guard.as_ref()))
}

async fn stop_gateway() -> AppResult<McpGatewayStatus> {
    let mut guard = APP_HTTP_GATEWAY.lock().await;
    if let Some(mut gateway) = guard.take() {
        if let Some(tx) = gateway.shutdown.take() {
            let _ = tx.send(());
        }
        gateway.task.abort();
    }
    Ok(status_from_gateway(None))
}

fn status_from_gateway(gateway: Option<&AppHttpGateway>) -> McpGatewayStatus {
    if let Some(gateway) = gateway {
        if !gateway.task.is_finished() {
            return McpGatewayStatus {
                running: true,
                url: Some(format!("http://{}:{}/mcp", gateway.host, gateway.port)),
                host: Some(gateway.host.clone()),
                port: Some(gateway.port),
                started_at: Some(gateway.started_at.to_rfc3339()),
            };
        }
    }

    McpGatewayStatus {
        running: false,
        url: None,
        host: None,
        port: None,
        started_at: None,
    }
}

async fn http_index() -> impl IntoResponse {
    Json(json!({
        "name": "codeshelf-api-gateway",
        "ok": true,
        "mcp": {
            "endpoint": "/mcp",
            "transport": "streamable-http",
            "methods": ["initialize", "tools/list", "tools/call"]
        },
        "auth": {
            "required": true,
            "schemes": ["Authorization: Bearer <key>", "x-api-key: <key>", "?key=<key>"]
        },
        "configs": {
            "http": {
                "mcpServers": {
                    "codeshelf-api": {
                        "url": "/mcp"
                    }
                }
            }
        }
    }))
}

async fn http_health() -> impl IntoResponse {
    Json(json!({ "ok": true }))
}

async fn http_mcp(
    State(_state): State<Arc<HttpState>>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(req): Json<JsonRpcRequest>,
) -> impl IntoResponse {
    // Origin 先于密钥检查：跨站页面的「简单请求」（text/plain + 无自定义头）不会触发预检，
    // CORS 层拦不住它发出去，只能在 handler 里判。
    if !origin_allowed(&headers) {
        return (
            StatusCode::FORBIDDEN,
            Json(error_response(
                req.id.unwrap_or(Value::Null),
                -32002,
                "Forbidden origin",
                Some(json!({ "message": "该来源不允许访问本地 MCP 网关" })),
            )),
        )
            .into_response();
    }
    if let Err(resp) = validate_mcp_auth(&headers, &query, req.id.clone()).await {
        return resp.into_response();
    }

    match handle_json_rpc(req).await {
        Some(resp) => (StatusCode::OK, Json(resp)).into_response(),
        None => (StatusCode::ACCEPTED, Json(json!({ "ok": true }))).into_response(),
    }
}

async fn validate_mcp_auth(
    headers: &HeaderMap,
    query: &HashMap<String, String>,
    request_id: Option<Value>,
) -> Result<(), (StatusCode, Json<JsonRpcResponse>)> {
    let settings = match crate::commands::settings::get_app_settings().await {
        Ok(s) => s,
        Err(e) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(error_response(
                    request_id.unwrap_or(Value::Null),
                    -32603,
                    "Internal error",
                    Some(json!({ "message": e })),
                )),
            ));
        }
    };

    // 注意：这里**没有**「keys 为空就放行」的分支了。
    // 网关启动时 ensure_gateway_key 会保证至少有一个可用密钥，
    // 真出现空列表说明配置被外部改坏了，此时应当拒绝服务而不是裸奔。
    let active_keys = active_mcp_keys(&settings.mcp_gateway_keys);
    if active_keys.is_empty() {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(error_response(
                request_id.unwrap_or(Value::Null),
                -32001,
                "MCP authentication has no active keys",
                Some(json!({ "message": "没有未过期且启用的 MCP 密钥，网关拒绝所有请求" })),
            )),
        ));
    }

    let supplied = extract_mcp_key(headers, query);
    let authorized = supplied
        .as_deref()
        .map(|key| {
            let normalized = normalize_mcp_key(key);
            active_keys
                .iter()
                .any(|entry| normalize_mcp_key(&entry.key) == normalized)
        })
        .unwrap_or(false);

    if authorized {
        Ok(())
    } else {
        Err((
            StatusCode::UNAUTHORIZED,
            Json(error_response(
                request_id.unwrap_or(Value::Null),
                -32001,
                "Unauthorized",
                Some(json!({
                    "message": "缺少或无效的 MCP 密钥",
                    "configuredKeyCount": settings.mcp_gateway_keys.len(),
                    "activeKeyCount": active_keys.len(),
                    "receivedKey": supplied.is_some()
                })),
            )),
        ))
    }
}

fn active_mcp_keys(keys: &[McpGatewayKey]) -> Vec<&McpGatewayKey> {
    keys.iter()
        .filter(|key| {
            key.enabled
                && !key.key.trim().is_empty()
                && key
                    .expires_at
                    .as_deref()
                    .map(|expires_at| {
                        DateTime::parse_from_rfc3339(expires_at)
                            .map(|dt| dt.with_timezone(&Utc) > Utc::now())
                            .unwrap_or(false)
                    })
                    .unwrap_or(true)
        })
        .collect()
}

fn extract_mcp_key(headers: &HeaderMap, query: &HashMap<String, String>) -> Option<String> {
    if let Some(auth) = headers.get("authorization").and_then(|v| v.to_str().ok()) {
        let token = normalize_mcp_key(auth);
        if !token.is_empty() {
            return Some(token);
        }
    }

    for header in ["x-api-key", "x-mcp-key", "mcp-bearer-token"] {
        if let Some(value) = headers.get(header).and_then(|v| v.to_str().ok()) {
            let token = normalize_mcp_key(value);
            if !token.is_empty() {
                return Some(token);
            }
        }
    }

    for name in ["key", "token", "apiKey", "access_token", "bearer_token"] {
        if let Some(value) = query.get(name) {
            let token = normalize_mcp_key(value);
            if !token.is_empty() {
                return Some(token);
            }
        }
    }

    None
}

fn normalize_mcp_key(value: &str) -> String {
    let mut token = value.trim();
    loop {
        let Some((prefix, rest)) = token.split_once(char::is_whitespace) else {
            break;
        };
        if prefix.eq_ignore_ascii_case("bearer") {
            token = rest.trim();
        } else {
            break;
        }
    }
    token
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string()
}

async fn handle_json_rpc(req: JsonRpcRequest) -> Option<JsonRpcResponse> {
    let id = req.id.clone().unwrap_or(Value::Null);
    let is_notification = req.id.is_none();

    if req.jsonrpc.as_deref().unwrap_or("2.0") != "2.0" {
        return Some(error_response(
            id,
            -32600,
            "Invalid Request",
            Some(json!({ "message": "jsonrpc must be 2.0" })),
        ));
    }

    let result = match req.method.as_str() {
        "initialize" => initialize_result(req.params.as_ref()),
        "notifications/initialized" => {
            if is_notification {
                return None;
            }
            Ok(json!({}))
        }
        "ping" => Ok(json!({})),
        "tools/list" => tools_list_result().await,
        "tools/call" => tools_call_result(req.params).await,
        method => Err(json_rpc_error(
            -32601,
            "Method not found",
            Some(json!({ "method": method })),
        )),
    };

    match result {
        Ok(value) => {
            if is_notification {
                None
            } else {
                Some(JsonRpcResponse {
                    jsonrpc: "2.0",
                    id,
                    result: Some(value),
                    error: None,
                })
            }
        }
        Err(err) => Some(JsonRpcResponse {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(err),
        }),
    }
}

fn initialize_result(params: Option<&Value>) -> Result<Value, JsonRpcError> {
    let protocol_version = params
        .and_then(|p| p.get("protocolVersion"))
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_PROTOCOL_VERSION);

    Ok(json!({
        "protocolVersion": protocol_version,
        "capabilities": {
            "tools": {
                "listChanged": true
            }
        },
        "serverInfo": {
            "name": "codeshelf-api-gateway",
            "version": env!("CARGO_PKG_VERSION")
        },
        "instructions": "Expose CodeShelf API library endpoints as MCP tools."
    }))
}

async fn tools_list_result() -> Result<Value, JsonRpcError> {
    let endpoints = list_api_endpoints().await.map_err(internal_error)?;
    let (tools, _) = build_mcp_tool_index(&endpoints);

    Ok(json!({ "tools": tools }))
}

async fn tools_call_result(params: Option<Value>) -> Result<Value, JsonRpcError> {
    let params_value = params.ok_or_else(|| {
        json_rpc_error(
            -32602,
            "Invalid params",
            Some(json!({ "message": "missing params" })),
        )
    })?;
    let params: ToolsCallParams = serde_json::from_value(params_value).map_err(|e| {
        json_rpc_error(
            -32602,
            "Invalid params",
            Some(json!({ "message": e.to_string() })),
        )
    })?;

    let endpoints = list_api_endpoints().await.map_err(internal_error)?;
    let (_, tool_name_map) = build_mcp_tool_index(&endpoints);
    let endpoint_id = tool_name_map.get(&params.name).ok_or_else(|| {
        json_rpc_error(-32602, "Unknown tool", Some(json!({ "name": params.name })))
    })?;
    let arguments = params.arguments.unwrap_or_else(|| json!({}));
    let arguments_json = serde_json::to_string(&arguments).map_err(internal_error)?;

    let result = execute_api_endpoint(endpoint_id.clone(), arguments_json)
        .await
        .map_err(|e| {
            json_rpc_error(
                -32000,
                "Tool execution failed",
                Some(json!({ "message": e })),
            )
        })?;
    let text = serde_json::to_string_pretty(&result).map_err(internal_error)?;

    Ok(json!({
        "content": [
            {
                "type": "text",
                "text": text
            }
        ],
        "structuredContent": result,
        "isError": false
    }))
}

fn build_mcp_tool_index(endpoints: &[ApiEndpoint]) -> (Vec<Value>, HashMap<String, String>) {
    let mut used = HashMap::<String, usize>::new();
    let mut tools = Vec::with_capacity(endpoints.len());
    let mut map = HashMap::with_capacity(endpoints.len() * 2);

    for endpoint in endpoints {
        let name = endpoint_tool_name(endpoint, &mut used);
        let legacy_name = legacy_endpoint_tool_name(&endpoint.id);
        let description = endpoint
            .description
            .clone()
            .unwrap_or_else(|| format!("{} {}", endpoint.method.to_uppercase(), endpoint.url));
        let input_schema = if endpoint.params_schema.is_null() {
            json!({ "type": "object", "properties": {} })
        } else {
            endpoint.params_schema.clone()
        };
        let method = endpoint.method.to_uppercase();
        let read_only = method == "GET";
        let destructive = matches!(method.as_str(), "DELETE" | "PATCH" | "PUT");

        tools.push(json!({
            "name": name,
            "description": endpoint_description(&description, &method, &endpoint.url),
            "inputSchema": input_schema,
            "annotations": {
                "title": endpoint.name,
                "readOnlyHint": read_only,
                "destructiveHint": destructive,
                "idempotentHint": matches!(method.as_str(), "GET" | "PUT" | "DELETE")
            },
            "_meta": {
                "codeshelfEndpointId": endpoint.id,
                "codeshelfLegacyName": legacy_name,
                "method": method,
                "url": endpoint.url
            }
        }));

        map.insert(name, endpoint.id.clone());
        map.insert(legacy_name, endpoint.id.clone());
    }

    (tools, map)
}

fn endpoint_tool_name(endpoint: &ApiEndpoint, used: &mut HashMap<String, usize>) -> String {
    let method = endpoint.method.to_lowercase();
    let base = format!("api_{}_{}", method, endpoint.url);
    let mut slug = slugify_ascii(&base);
    if slug == "api" || slug.is_empty() {
        slug = slugify_ascii(&format!("api_{}_{}", method, endpoint.name));
    }
    if slug == "api" || slug.is_empty() {
        slug = "api_endpoint".to_string();
    }

    let suffix = short_endpoint_id(&endpoint.id);
    let max_prefix = 64usize.saturating_sub(suffix.len() + 1);
    let mut prefix = slug.chars().take(max_prefix).collect::<String>();
    prefix = prefix.trim_matches('_').to_string();
    if prefix.is_empty() {
        prefix = "api_endpoint".to_string();
    }

    let mut name = format!("{}_{}", prefix, suffix);
    let count = used.entry(name.clone()).or_insert(0);
    if *count > 0 {
        let collision_suffix = format!("_{}", *count + 1);
        let max = 64usize.saturating_sub(collision_suffix.len());
        name = format!(
            "{}{}",
            name.chars().take(max).collect::<String>(),
            collision_suffix
        );
    }
    *count += 1;
    name
}

fn legacy_endpoint_tool_name(endpoint_id: &str) -> String {
    let raw = format!("ep_{}", endpoint_id);
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.len() <= 60 {
        cleaned
    } else {
        cleaned.chars().take(60).collect()
    }
}

fn slugify_ascii(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_was_sep = false;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_was_sep = false;
        } else if !last_was_sep {
            out.push('_');
            last_was_sep = true;
        }
    }
    out.trim_matches('_').to_string()
}

fn short_endpoint_id(endpoint_id: &str) -> String {
    let normalized = endpoint_id
        .strip_prefix("api_ep_")
        .or_else(|| endpoint_id.strip_prefix("ep_"))
        .unwrap_or(endpoint_id);
    let cleaned = normalized
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>();
    if cleaned.is_empty() {
        "endpoint".to_string()
    } else {
        cleaned
    }
}

fn endpoint_description(description: &str, method: &str, url: &str) -> String {
    let signature = format!("{} {}", method, url);
    if description.contains(&signature) {
        description.to_string()
    } else {
        format!("{}\n{}", description, signature)
    }
}

fn error_response(id: Value, code: i64, message: &str, data: Option<Value>) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(json_rpc_error(code, message, data)),
    }
}

fn json_rpc_error(code: i64, message: &str, data: Option<Value>) -> JsonRpcError {
    JsonRpcError {
        code,
        message: message.to_string(),
        data,
    }
}

fn internal_error<E: ToString>(error: E) -> JsonRpcError {
    json_rpc_error(
        -32603,
        "Internal error",
        Some(json!({ "message": error.to_string() })),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 校验码必须与前端 `src/pages/Settings/mcpGateway/utils.ts` 的 fnv1a/checksumOf 逐位一致，
    /// 否则自动生成的密钥在 UI 里会被标成「校验码不匹配」。
    /// 下面的期望值是用前端那份 JS 实现直接算出来的。
    #[test]
    fn checksum_matches_frontend_algorithm() {
        assert_eq!(fnv1a_checksum("test"), "a6rf");
        assert_eq!(fnv1a_checksum("AAAA"), "gi93");
        assert_eq!(fnv1a_checksum("cs_mcp_v1_test"), "5pux");
    }

    #[test]
    fn generated_key_has_v1_shape() {
        let key = generate_gateway_key().expect("generate");
        let body = key
            .strip_prefix("cs_mcp_v1_")
            .unwrap_or_else(|| panic!("bad prefix: {}", key));
        // 随机段是 base64url，本身可能含 `_`，所以按最后一个下划线切
        // （前端 parseKey 用的也是 lastIndexOf("_")）
        let (random, checksum) = body.rsplit_once('_').expect("missing checksum");
        assert_eq!(random.len(), 43, "random = {}", random);
        assert_eq!(checksum.len(), 4, "checksum = {}", checksum);
        // 校验码必须能被前端复算通过
        assert_eq!(fnv1a_checksum(random), checksum);
        assert_ne!(key, generate_gateway_key().expect("generate"));
    }

    #[test]
    fn origin_policy_denies_untrusted_pages() {
        let mut h = HeaderMap::new();
        // 非浏览器客户端（Claude Desktop / curl）不带 Origin，必须放行
        assert!(origin_allowed(&h));

        // Tauri webview 自己的来源放行
        for ok in ALLOWED_ORIGINS {
            h.insert("origin", HeaderValue::from_static(ok));
            assert!(origin_allowed(&h), "should allow {}", ok);
        }

        // 任意网页即使打到 127.0.0.1 也必须被拒 —— loopback 不是身份认证
        for bad in [
            "http://evil.example",
            "https://evil.example",
            "http://localhost:3000",
            "http://127.0.0.1:5173",
            "null",
        ] {
            h.insert("origin", HeaderValue::from_str(bad).unwrap());
            assert!(!origin_allowed(&h), "should deny {}", bad);
        }
    }
}
