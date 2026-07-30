// HTTP 执行：execute_api_endpoint + 鉴权注入 + Session 缓存 + 在线文档抓取

use crate::error::AppResult;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::storage::{ApiAuthConfig, ApiEndpoint, ApiGroup, SessionInject};

use super::{load_endpoints, load_groups};

const DEFAULT_RESPONSE_TRIM_BYTES: usize = 8192;
const MAX_API_DOCUMENT_BYTES: u64 = 10 * 1024 * 1024;

/// Session 鉴权用的 reqwest::Client + 可选缓存 token（header 模式下）
#[derive(Clone)]
struct SessionClient {
    client: reqwest::Client,
    /// header 注入模式下，登录后抽取的 token
    token: Option<String>,
}

static SESSION_CLIENTS: Lazy<Arc<Mutex<HashMap<String, SessionClient>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

pub(super) async fn drop_session_client(group_id: &str) {
    let mut guard = SESSION_CLIENTS.lock().await;
    guard.remove(group_id);
}

fn build_session_base_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .cookie_store(true)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| crate::error::AppError::from(format!("构建 client 失败: {}", e)))
}

/// 发送请求；遇到瞬时网络错误（超时/连接失败）时自动重试一次。
/// 仅当请求体可克隆（JSON 等非流式）时才重试，避免重复消费 body。
async fn send_with_transient_retry(
    builder: reqwest::RequestBuilder,
) -> AppResult<reqwest::Response> {
    let retry = builder.try_clone();
    match builder.send().await {
        Ok(r) => Ok(r),
        Err(e) if e.is_timeout() || e.is_connect() => {
            if let Some(b) = retry {
                log::warn!("接口请求瞬时失败({})，400ms 后重试一次", e);
                tokio::time::sleep(Duration::from_millis(400)).await;
                b.send()
                    .await
                    .map_err(|e| crate::error::AppError::from(format!("请求失败: {}", e)))
            } else {
                Err(crate::error::AppError::from(format!("请求失败: {}", e)))
            }
        }
        Err(e) => Err(crate::error::AppError::from(format!("请求失败: {}", e))),
    }
}

fn join_url(base: &str, path: &str) -> String {
    if path.starts_with("http://") || path.starts_with("https://") {
        return path.to_string();
    }
    let base = base.trim_end_matches('/');
    if path.starts_with('/') {
        format!("{}{}", base, path)
    } else if base.is_empty() {
        path.to_string()
    } else {
        format!("{}/{}", base, path)
    }
}

/// 从响应 JSON 按 path（如 "data.token"）抽值
fn extract_json_path(v: &Value, path: &str) -> Option<String> {
    let mut current = v;
    for part in path.split('.').filter(|p| !p.is_empty()) {
        if let Some(next) = current.get(part) {
            current = next;
        } else {
            return None;
        }
    }
    match current {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// 替换 URL 里的 {path_param}
fn substitute_path_params(url: &str, params: &HashMap<String, Value>) -> String {
    let mut out = String::with_capacity(url.len());
    let bytes = url.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            if let Some(j) = url[i + 1..].find('}') {
                let key = &url[i + 1..i + 1 + j];
                if let Some(v) = params.get(key) {
                    let s = match v {
                        Value::String(s) => s.clone(),
                        other => other.to_string().trim_matches('"').to_string(),
                    };
                    out.push_str(&s);
                    i = i + 1 + j + 1;
                    continue;
                }
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

/// 约定：arguments 顶层字段 `_body`/`_query`/`_path` 显式分区；若无则按 method 默认分派
fn split_arguments(
    args: &Value,
    method: &str,
) -> (
    HashMap<String, Value>,
    HashMap<String, Value>,
    Option<Value>,
) {
    let empty = serde_json::Map::new();
    let obj = args.as_object().unwrap_or(&empty);
    let mut path_map: HashMap<String, Value> = HashMap::new();
    let mut query_map: HashMap<String, Value> = HashMap::new();
    let mut body: Option<Value> = None;

    let has_partitioned =
        obj.contains_key("_body") || obj.contains_key("_query") || obj.contains_key("_path");

    if has_partitioned {
        if let Some(Value::Object(m)) = obj.get("_path") {
            for (k, v) in m {
                path_map.insert(k.clone(), v.clone());
            }
        }
        if let Some(Value::Object(m)) = obj.get("_query") {
            for (k, v) in m {
                query_map.insert(k.clone(), v.clone());
            }
        }
        if let Some(b) = obj.get("_body") {
            body = Some(b.clone());
        }
    } else {
        let method_upper = method.to_uppercase();
        let is_body_method = matches!(method_upper.as_str(), "POST" | "PUT" | "PATCH" | "DELETE");
        if is_body_method {
            body = Some(args.clone());
        } else {
            for (k, v) in obj {
                query_map.insert(k.clone(), v.clone());
            }
        }
    }

    // path 占位参数优先从 path_map 取；若用户没显式分区，我们从 query/body 里挪一遍（best-effort）。
    if !has_partitioned {
        // 让 substitute_path_params 有机会从 query/body 中匹配
        // 统一暴露给调用处：把所有候选 map 合并成 path_map 备用
    }

    (path_map, query_map, body)
}

fn value_to_query_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::Null => "".to_string(),
        _ => v.to_string(),
    }
}

fn trim_response(bytes: &[u8], max_bytes: usize) -> String {
    if bytes.len() <= max_bytes {
        match std::str::from_utf8(bytes) {
            Ok(s) => s.to_string(),
            Err(_) => {
                let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
                format!("<binary {} bytes; base64>\n{}", bytes.len(), b64)
            }
        }
    } else {
        match std::str::from_utf8(&bytes[..max_bytes]) {
            Ok(s) => format!("{}\n…（已截断 {}/{} bytes）", s, max_bytes, bytes.len()),
            Err(_) => {
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes[..max_bytes]);
                format!(
                    "<binary {} bytes truncated to {}; base64>\n{}",
                    bytes.len(),
                    max_bytes,
                    b64
                )
            }
        }
    }
}

/// 单次接口调用的结构化返回：给前端做"调用链"展示用
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApiExecutionResult {
    pub status: u16,
    pub method: String,
    pub url: String,
    pub elapsed_ms: u64,
    pub total_bytes: usize,
    pub truncated: bool,
    pub body: String,
}

/// 为请求注入鉴权
/// 返回 (最终用的 client, 最终 builder)
/// 注意：Session 类型依赖有 cookie_store 的 client；其他类型用普通 client
async fn apply_auth(
    group_id_for_session_cache: Option<&str>,
    auth: &ApiAuthConfig,
    base_url_for_relative_login: &str,
    mut builder: reqwest::RequestBuilder,
    client_for_others: &reqwest::Client,
) -> AppResult<(reqwest::Client, reqwest::RequestBuilder)> {
    match auth {
        ApiAuthConfig::None => Ok((client_for_others.clone(), builder)),
        ApiAuthConfig::Bearer { token } => {
            builder = builder.header("Authorization", format!("Bearer {}", token));
            Ok((client_for_others.clone(), builder))
        }
        ApiAuthConfig::Basic { username, password } => {
            builder = builder.basic_auth(username, Some(password));
            Ok((client_for_others.clone(), builder))
        }
        ApiAuthConfig::ApiKey { header, value } => {
            builder = builder.header(header, value);
            Ok((client_for_others.clone(), builder))
        }
        ApiAuthConfig::Session {
            login_url,
            login_method,
            credentials_json,
            token_json_path,
            inject_as,
        } => {
            let cache_key = group_id_for_session_cache
                .unwrap_or("__endpoint_override__")
                .to_string();

            // 获取/创建 SessionClient
            let session = {
                let mut guard = SESSION_CLIENTS.lock().await;
                if let Some(s) = guard.get(&cache_key) {
                    s.clone()
                } else {
                    let new_client = build_session_base_client()?;
                    let s = SessionClient {
                        client: new_client,
                        token: None,
                    };
                    guard.insert(cache_key.clone(), s.clone());
                    s
                }
            };

            // 如果已有 token（header 模式），就注入
            let session_with_token = ensure_session_login(
                &cache_key,
                &session,
                base_url_for_relative_login,
                login_url,
                login_method,
                credentials_json,
                token_json_path.as_deref(),
                inject_as,
            )
            .await?;

            // 用 session 的 client 重建 builder（因为原 builder 绑定到 client_for_others）
            // 这里让调用方知道要重建——返回 session.client，调用方再接着构建。
            match inject_as {
                SessionInject::Cookie => {
                    // cookie 会走 client 自动附带，不需要改 builder
                    Ok((session_with_token.client.clone(), builder))
                }
                SessionInject::Header { name, format } => {
                    let token = session_with_token.token.clone().unwrap_or_default();
                    let header_value = format.replace("{token}", &token);
                    builder = builder.header(name, header_value);
                    Ok((session_with_token.client.clone(), builder))
                }
            }
        }
    }
}

async fn ensure_session_login(
    cache_key: &str,
    session: &SessionClient,
    base_url: &str,
    login_url: &str,
    login_method: &str,
    credentials_json: &str,
    token_json_path: Option<&str>,
    inject_as: &SessionInject,
) -> AppResult<SessionClient> {
    // 已登录过就直接返回
    match inject_as {
        SessionInject::Header { .. } => {
            if session.token.is_some() {
                return Ok(session.clone());
            }
        }
        SessionInject::Cookie => {
            // cookie 不容易判断是否在有效期，首次请求按已登录乐观处理；
            // 如果后续 401 再重登（由 execute 层处理）
            // 这里先不做任何登录；让普通请求尝试先
            // 但若从未登录过，需要先登录：用一个 marker——我们无法从 reqwest 观察 cookie 是否存在，所以第一次总是登录。
            // 简化：cookie 模式下每次新创建的 client 都触发一次登录。
            // 通过 session.token 作为"是否登录过"的 marker（即便不用 token 值）
            if session.token.is_some() {
                return Ok(session.clone());
            }
        }
    }

    let url = join_url(base_url, login_url);
    let method = reqwest::Method::from_bytes(login_method.as_bytes())
        .map_err(|e| crate::error::AppError::from(format!("非法 login_method: {}", e)))?;
    let body: Value = serde_json::from_str(credentials_json).map_err(|e| {
        crate::error::AppError::from(format!("credentialsJson 不是合法 JSON: {}", e))
    })?;

    let resp = session
        .client
        .request(method, &url)
        .json(&body)
        .send()
        .await
        .map_err(|e| crate::error::AppError::from(format!("登录请求失败: {}", e)))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(crate::error::AppError::from(format!(
            "Session 登录失败 {}: {}",
            status,
            text.chars().take(300).collect::<String>()
        )));
    }

    let token: Option<String>;
    match inject_as {
        SessionInject::Header { .. } => {
            let body: Value = resp
                .json()
                .await
                .map_err(|e| crate::error::AppError::from(format!("解析登录响应失败: {}", e)))?;
            let path = token_json_path.unwrap_or("token");
            token = extract_json_path(&body, path);
            if token.is_none() {
                return Err(crate::error::AppError::from(format!(
                    "登录响应中找不到 token（path={}）：{}",
                    path,
                    serde_json::to_string(&body).unwrap_or_default()
                )));
            }
        }
        SessionInject::Cookie => {
            // 不需要 token，但要标记已登录
            let _ = resp.text().await;
            token = Some(String::new());
        }
    }

    let updated = SessionClient {
        client: session.client.clone(),
        token,
    };
    {
        let mut guard = SESSION_CLIENTS.lock().await;
        guard.insert(cache_key.to_string(), updated.clone());
    }
    Ok(updated)
}

static NONE_AUTH: ApiAuthConfig = ApiAuthConfig::None;

fn resolve_effective_auth<'a>(
    endpoint: &'a ApiEndpoint,
    group: Option<&'a ApiGroup>,
) -> &'a ApiAuthConfig {
    if let Some(a) = endpoint.auth_override.as_ref() {
        return a;
    }
    group.map(|g| &g.auth).unwrap_or(&NONE_AUTH)
}

#[tauri::command]
#[specta::specta]
pub async fn execute_api_endpoint(
    endpoint_id: String,
    arguments_json: String,
) -> AppResult<ApiExecutionResult> {
    execute_api_endpoint_inner(endpoint_id, arguments_json, false).await
}

/// `relogged_in` 是重登深度标记：Session 鉴权收到 401/403 时清缓存重登**最多一次**。
///
/// 之前是无标记的自递归：如果服务端登录成功但发的 token 永远无效（配置写错、
/// 权限被回收、登录接口返回了另一个环境的 token），这里会无限重登 + 无限重发，
/// 每层还都在 `Box::pin` 里累积 future —— 命令永不返回，配额也白烧。
async fn execute_api_endpoint_inner(
    endpoint_id: String,
    arguments_json: String,
    relogged_in: bool,
) -> AppResult<ApiExecutionResult> {
    // 1. 加载 endpoint 和所属 group
    let endpoints = load_endpoints()?;
    let endpoint = endpoints
        .into_iter()
        .find(|e| e.id == endpoint_id)
        .ok_or_else(|| crate::error::AppError::from(format!("未找到接口: {}", endpoint_id)))?;
    let groups = load_groups()?;
    let group = endpoint
        .group_id
        .as_ref()
        .and_then(|gid| groups.into_iter().find(|g| &g.id == gid));

    let base_url = group.as_ref().map(|g| g.base_url.as_str()).unwrap_or("");
    let auth = resolve_effective_auth(&endpoint, group.as_ref());
    let group_cache_key = group.as_ref().map(|g| g.id.as_str());

    // 2. 解析参数
    let args_value: Value = if arguments_json.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&arguments_json)
            .map_err(|e| crate::error::AppError::from(format!("arguments 不是合法 JSON: {}", e)))?
    };

    let (mut path_map, mut query_map, mut body) = split_arguments(&args_value, &endpoint.method);

    // 若未显式分区，把扁平参数同时作为候选 path 参数
    if path_map.is_empty() {
        if let Some(obj) = args_value.as_object() {
            for (k, v) in obj {
                if !k.starts_with('_') {
                    path_map.insert(k.clone(), v.clone());
                }
            }
        }
    }

    // 3. 拼 URL（先替换 path 占位，再拼 baseUrl）
    let url_with_path = substitute_path_params(&endpoint.url, &path_map);
    let final_url = join_url(base_url, &url_with_path);

    // 4. 构建请求
    let method = reqwest::Method::from_bytes(endpoint.method.to_uppercase().as_bytes())
        .map_err(|e| crate::error::AppError::from(format!("非法 method: {}", e)))?;

    // 普通 client（非 Session 鉴权用）；超时按接口配置，缺省 30s
    let req_timeout = endpoint
        .timeout_ms
        .map(|m| Duration::from_millis(m as u64))
        .unwrap_or_else(|| Duration::from_secs(30));
    let default_client = reqwest::Client::builder()
        .timeout(req_timeout)
        .build()
        .map_err(|e| crate::error::AppError::from(format!("构建 client 失败: {}", e)))?;

    // 若 path 参数被替换到 URL 里，从 body 里挪掉它们避免重复发送
    if let Some(Value::Object(ref mut m)) = body {
        for k in path_map.keys() {
            if endpoint.url.contains(&format!("{{{}}}", k)) {
                m.remove(k);
            }
        }
    }
    if !query_map.is_empty() {
        let keys: Vec<String> = query_map.keys().cloned().collect();
        for k in keys {
            if endpoint.url.contains(&format!("{{{}}}", k)) {
                query_map.remove(&k);
            }
        }
    }

    // 基础 builder
    let mut builder = default_client.request(method.clone(), &final_url);

    // 固定 headers
    for (k, v) in &endpoint.headers {
        builder = builder.header(k, v);
    }

    // query
    if !query_map.is_empty() {
        let qs: Vec<(String, String)> = query_map
            .iter()
            .map(|(k, v)| (k.clone(), value_to_query_string(v)))
            .collect();
        builder = builder.query(&qs);
    }

    // body
    if let Some(ref b) = body {
        if !b.is_null() {
            // 如果 body 是空对象就不带
            let skip = matches!(b, Value::Object(m) if m.is_empty());
            if !skip {
                builder = builder.json(b);
            }
        }
    }

    // 5. 注入鉴权（可能切换到 session 的 client）
    let (active_client, builder) =
        apply_auth(group_cache_key, auth, base_url, builder, &default_client).await?;

    // Session 鉴权时需要从头用 active_client 重建请求（因为 builder 原来绑定在 default_client）
    let builder = if matches!(auth, ApiAuthConfig::Session { .. }) {
        let mut b = active_client.request(method, &final_url);
        for (k, v) in &endpoint.headers {
            b = b.header(k, v);
        }
        if !query_map.is_empty() {
            let qs: Vec<(String, String)> = query_map
                .iter()
                .map(|(k, v)| (k.clone(), value_to_query_string(v)))
                .collect();
            b = b.query(&qs);
        }
        if let Some(ref bd) = body {
            if !bd.is_null() {
                let skip = matches!(bd, Value::Object(m) if m.is_empty());
                if !skip {
                    b = b.json(bd);
                }
            }
        }
        // 再次注入鉴权（仅 header 模式需要重附 Authorization；cookie 模式靠 client）
        match auth {
            ApiAuthConfig::Session {
                inject_as: SessionInject::Header { name, format },
                ..
            } => {
                let guard = SESSION_CLIENTS.lock().await;
                let token = guard
                    .get(group_cache_key.unwrap_or("__endpoint_override__"))
                    .and_then(|s| s.token.clone())
                    .unwrap_or_default();
                drop(guard);
                let header_value = format.replace("{token}", &token);
                b = b.header(name, header_value);
                b
            }
            _ => b,
        }
    } else {
        builder
    };

    // 6. 首次发送（瞬时网络错误自动重试一次）+ Session 401/403 重登一次
    let started = Instant::now();
    let resp = send_with_transient_retry(builder).await?;

    let unauthorized = resp.status() == reqwest::StatusCode::UNAUTHORIZED
        || resp.status() == reqwest::StatusCode::FORBIDDEN;
    let resp = if matches!(auth, ApiAuthConfig::Session { .. }) && unauthorized {
        if relogged_in {
            // 已经重登过一次还是 401/403 —— 不是 token 过期，是配置或权限的问题。
            // 直接返回可诊断的错误，不再重试。
            return Err(crate::error::AppError::from(format!(
                "Session 鉴权失败（{}）：重新登录后仍被拒绝。请检查登录接口返回的 token \
                 是否被正确注入，以及该账号是否有权访问 {} {}",
                resp.status(),
                endpoint.method.to_uppercase(),
                final_url
            )));
        }
        // 清 client 缓存，重登重发（仅此一次）
        drop_session_client(group_cache_key.unwrap_or("__endpoint_override__")).await;
        return Box::pin(execute_api_endpoint_inner(
            endpoint_id,
            arguments_json,
            true,
        ))
        .await;
    } else {
        resp
    };

    // 7. 响应读取与截断
    let status = resp.status();
    let status_code = status.as_u16();
    let trim = endpoint
        .response_trim_bytes
        .map(|n| n as usize)
        .unwrap_or(DEFAULT_RESPONSE_TRIM_BYTES);
    // 流式读取，读到 trim 上限就停。原来是 `resp.bytes()` 先全收进内存再截断，
    // 对方发多少我们就吃多少 —— 无限 chunked 响应能直接把内存耗尽。
    //
    // 多读一个字节：用来区分「刚好等于上限」和「确实还有更多」。
    let (bytes, hit_cap) = crate::http_body::read_capped(resp, trim.saturating_add(1))
        .await
        .map_err(crate::error::AppError::from)?;
    let elapsed_ms = started.elapsed().as_millis() as u64;
    let total_bytes = bytes.len();
    let truncated = hit_cap || total_bytes > trim;
    let body_str = trim_response(&bytes, trim);

    Ok(ApiExecutionResult {
        status: status_code,
        method: endpoint.method.to_uppercase(),
        url: final_url,
        elapsed_ms,
        total_bytes,
        truncated,
        body: body_str,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_api_document_url(url: String) -> AppResult<String> {
    let trimmed = url.trim();
    let parsed = reqwest::Url::parse(trimmed)
        .map_err(|e| crate::error::AppError::from(format!("URL 不合法: {}", e)))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("只支持 http 或 https 链接".into());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| crate::error::AppError::from(format!("构建下载 client 失败: {}", e)))?;

    let resp = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| crate::error::AppError::from(format!("读取在线文档失败: {}", e)))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(crate::error::AppError::from(format!(
            "在线文档返回 {}: {}",
            status,
            text.chars().take(300).collect::<String>()
        )));
    }

    // read_capped 内部会先看 Content-Length 提前拒绝，再在读取过程中计量 ——
    // Content-Length 可以缺失也可以撒谎，只有边读边算才是真正的边界。
    let (bytes, truncated) = crate::http_body::read_capped(resp, MAX_API_DOCUMENT_BYTES as usize)
        .await
        .map_err(crate::error::AppError::from)?;
    if truncated {
        return Err("在线文档超过 10MB，已停止导入".into());
    }

    String::from_utf8(bytes)
        .map_err(|e| crate::error::AppError::from(format!("在线文档不是 UTF-8 文本: {}", e)))
}
