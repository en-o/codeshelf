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

fn http_router() -> Router {
    let cors = CorsLayer::new()
        .allow_origin(HeaderValue::from_static("*"))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(tower_http::cors::Any);

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
    // keys 为空时，网关本身不鉴权（validate_mcp_auth 直接放行），api_key 返回 None
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
        // 安全闸：keys 为空时网关不鉴权（见 validate_mcp_auth），此时只允许监听回环地址。
        // 非回环 + 无密钥 = 局域网内任何人都能无鉴权调用已配置的 API 端点，拒绝启动；
        // 已在跑的实例也要停掉（鉴权是每个请求实时读设置的，不停会继续裸奔）。
        // 仅拦这一种危险组合：回环无密钥、任意地址有密钥，行为均不变。
        let host = settings.mcp_gateway_host.trim();
        let is_loopback = host
            .parse::<std::net::IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false);
        if !is_loopback && settings.mcp_gateway_keys.is_empty() {
            let _ = stop_gateway().await;
            return Err(crate::error::AppError::from(format!(
                "MCP 网关监听非本机地址（{}）时必须至少配置一个访问密钥，否则局域网内任何设备都可无鉴权调用。请先添加密钥，或将监听地址改回 127.0.0.1",
                host
            )));
        }
        start_gateway(settings.mcp_gateway_host.clone(), settings.mcp_gateway_port).await
    } else {
        stop_gateway().await
    }
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

    let active_keys = active_mcp_keys(&settings.mcp_gateway_keys);
    if settings.mcp_gateway_keys.is_empty() {
        return Ok(());
    }

    if active_keys.is_empty() {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(error_response(
                request_id.unwrap_or(Value::Null),
                -32001,
                "MCP authentication has no active keys",
                Some(json!({ "message": "已配置 MCP 密钥，但没有未过期且启用的密钥" })),
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
