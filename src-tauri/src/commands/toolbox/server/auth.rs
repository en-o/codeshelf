// 静态服务的访问控制：按路径加密码 + 登录页 + Cookie 会话
//
// 对应 nginx 的 `auth_basic`，但用的是登录页而不是浏览器弹窗（可退出、可显示说明）。
//
// 三种用法都是同一套规则：
// - 锁整站     path="/"                 kind=prefix
// - 锁子目录   path="/private"          kind=prefix
// - 锁单个文件 path="/docs/salary.pdf"  kind=exact

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{
    body::Body,
    extract::State,
    http::{header, Request, StatusCode},
    middleware::Next,
    response::{Html, IntoResponse, Redirect, Response},
    routing::get,
    Form, Router,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

use super::super::AuthRule;
use crate::error::AppResult;

/// 登录页与登出接口的保留前缀。静态文件里叫这个名字的路径会被它挡住，
/// 概率低到可以接受，换来的是「不管 urlPrefix 配成什么，登录页地址都固定」。
pub(super) const AUTH_PREFIX: &str = "/__codeshelf_auth";

/// 会话有效期。先写死 12 小时 —— 做成配置项之前没有任何人提出过别的数值。
const SESSION_TTL: Duration = Duration::from_secs(12 * 60 * 60);

/// 哈希迭代轮数。写进哈希串里，改了以后老密码照样能校验。
const HASH_ROUNDS: u32 = 10_000;

const COOKIE_NAME: &str = "codeshelf_auth";

// ============== 密码哈希 ==============

/// 生成 `v1$<轮数>$<salt_hex>$<hash_hex>`。
///
/// 配置文件是明文 JSON 落盘的，密码绝不能原样写进去 —— 加盐是为了让
/// 同一个密码在不同服务里哈希不同，迭代是为了让离线爆破变慢。
pub fn hash_password(password: &str) -> String {
    let mut salt = [0u8; 16];
    // getrandom 失败（几乎只可能是系统熵源坏了）时退回时间戳做盐：
    // 比 panic 掉整个应用好，弱盐仍然比无盐强，而且哈希本身没变弱。
    if getrandom::getrandom(&mut salt).is_err() {
        let ns = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        salt.copy_from_slice(&ns.to_le_bytes()[..16.min(16)]);
    }
    let hash = derive(&salt, password, HASH_ROUNDS);
    format!(
        "v1${}${}${}",
        HASH_ROUNDS,
        to_hex(&salt),
        to_hex(&hash)
    )
}

/// 校验密码。哈希串格式不认识时一律返回 false（宁可锁死也不放行）。
pub fn verify_password(stored: &str, password: &str) -> bool {
    let mut parts = stored.split('$');
    if parts.next() != Some("v1") {
        return false;
    }
    let Some(rounds) = parts.next().and_then(|s| s.parse::<u32>().ok()) else {
        return false;
    };
    let (Some(salt), Some(expected)) = (
        parts.next().and_then(from_hex),
        parts.next().and_then(from_hex),
    ) else {
        return false;
    };
    let actual = derive(&salt, password, rounds);
    constant_time_eq(&actual, &expected)
}

fn derive(salt: &[u8], password: &str, rounds: u32) -> Vec<u8> {
    let mut buf = Sha256::new()
        .chain_update(salt)
        .chain_update(password.as_bytes())
        .finalize()
        .to_vec();
    for _ in 1..rounds.max(1) {
        buf = Sha256::new()
            .chain_update(salt)
            .chain_update(&buf)
            .finalize()
            .to_vec();
    }
    buf
}

/// 比较用时不随「前几个字节是否相同」变化。比的是哈希不是密码，
/// 但便宜到没有理由不做。
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn from_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

// ============== 规则匹配 ==============

/// 把 URL 路径规范化成用于匹配的形式：
/// percent 解码 + 合并重复斜杠 + 去掉结尾斜杠（根路径除外）。
///
/// **解码必须在匹配之前**：不解码的话 `/priv%61te/secret.txt` 与规则 `/private`
/// 对不上，直接绕过密码 —— 而 ServeDir 解码之后照样能把文件发出去。
fn normalize(path: &str) -> String {
    let decoded = urlencoding::decode(path)
        .map(|s| s.into_owned())
        .unwrap_or_else(|_| path.to_string());
    let mut out = String::with_capacity(decoded.len() + 1);
    if !decoded.starts_with('/') {
        out.push('/');
    }
    let mut prev_slash = false;
    for c in decoded.chars() {
        if c == '/' {
            if prev_slash {
                continue;
            }
            prev_slash = true;
        } else {
            prev_slash = false;
        }
        out.push(c);
    }
    while out.len() > 1 && out.ends_with('/') {
        out.pop();
    }
    out
}

/// 找出命中该请求路径的规则。多条命中时取**最长**的那条（更具体的规则赢）。
///
/// 路径里带 `..` 时不做「谁命中」的判断，直接返回最长的一条启用规则：
/// 这种路径本来就不该出现，能挡则挡。
pub fn match_rule<'a>(rules: &'a [AuthRule], path: &str) -> Option<&'a AuthRule> {
    let target = normalize(path);
    let enabled: Vec<&AuthRule> = rules.iter().filter(|r| r.enabled).collect();
    if enabled.is_empty() {
        return None;
    }
    if target.split('/').any(|seg| seg == "..") {
        return enabled
            .into_iter()
            .max_by_key(|r| normalize(&r.path).len());
    }

    enabled
        .into_iter()
        .filter(|rule| {
            let rule_path = normalize(&rule.path);
            if rule.match_kind == "exact" {
                target == rule_path
            } else if rule_path == "/" {
                true
            } else {
                target == rule_path || target.starts_with(&format!("{}/", rule_path))
            }
        })
        .max_by_key(|rule| normalize(&rule.path).len())
}

// ============== 前端输入 → 存储结构 ==============

/// 把前端提交的规则合并成可存储的规则。**create 和 update 共用这一份**。
///
/// 密码留空 = 沿用原密码（按 id 找回旧哈希）。这条语义是必需的：
/// 前端拿不到也不该拿到明文，用户改个端口就重新提交一遍表单时，
/// 没有它已设好的密码会被清空，目录悄悄变成公开的。
pub fn merge_auth_rules(
    input: Option<Vec<super::super::AuthRuleInput>>,
    existing: &[AuthRule],
) -> AppResult<Vec<AuthRule>> {
    let Some(list) = input else {
        return Ok(existing.to_vec());
    };

    let mut out = Vec::with_capacity(list.len());
    for item in list {
        let path = item.path.trim();
        if path.is_empty() {
            return Err(crate::error::AppError::from(
                "访问控制规则的路径不能为空".to_string(),
            ));
        }
        let path = if path.starts_with('/') {
            path.to_string()
        } else {
            format!("/{}", path)
        };

        let match_kind = match item.match_kind.as_deref() {
            Some("exact") => "exact",
            _ => "prefix",
        }
        .to_string();

        let old = item
            .id
            .as_deref()
            .and_then(|id| existing.iter().find(|r| r.id == id));

        let password_hash = match item.password.as_deref().map(str::trim) {
            Some(pw) if !pw.is_empty() => hash_password(pw),
            _ => match old {
                Some(rule) => rule.password_hash.clone(),
                None => {
                    return Err(crate::error::AppError::from(format!(
                        "规则 {} 还没有设置密码",
                        path
                    )))
                }
            },
        };

        out.push(AuthRule {
            id: old
                .map(|r| r.id.clone())
                .unwrap_or_else(super::super::generate_id),
            path,
            match_kind,
            label: item.label.filter(|s| !s.trim().is_empty()),
            password_hash,
            enabled: item.enabled.unwrap_or(true),
        });
    }
    Ok(out)
}

// ============== 会话 ==============

struct Session {
    /// 这个会话已经通过了哪些规则 —— 不同目录可以是不同密码，
    /// 通过了 `/a` 不代表能进 `/b`
    passed: HashSet<String>,
    expires_at: Instant,
}

/// 会话只存在内存里：服务一停就全部失效，用户需要重新登录。
/// 对「临时把某个目录发给同事看」这个场景来说这是想要的行为。
#[derive(Clone)]
pub(super) struct AuthState {
    rules: Arc<Vec<AuthRule>>,
    sessions: Arc<Mutex<HashMap<String, Session>>>,
}

impl AuthState {
    pub(super) fn new(rules: Vec<AuthRule>) -> Self {
        Self {
            rules: Arc::new(rules),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(super) fn has_enabled_rules(&self) -> bool {
        self.rules.iter().any(|r| r.enabled)
    }

    async fn passed(&self, token: &str, rule_id: &str) -> bool {
        let mut sessions = self.sessions.lock().await;
        let now = Instant::now();
        sessions.retain(|_, s| s.expires_at > now);
        sessions
            .get(token)
            .is_some_and(|s| s.passed.contains(rule_id))
    }

    /// 记录「这个会话通过了这条规则」，返回会话 token（沿用旧 token 或新建）。
    async fn grant(&self, existing: Option<String>, rule_id: &str) -> String {
        let mut sessions = self.sessions.lock().await;
        let now = Instant::now();
        sessions.retain(|_, s| s.expires_at > now);

        let token = match existing {
            Some(t) if sessions.contains_key(&t) => t,
            _ => new_token(),
        };
        let entry = sessions.entry(token.clone()).or_insert_with(|| Session {
            passed: HashSet::new(),
            expires_at: now + SESSION_TTL,
        });
        entry.passed.insert(rule_id.to_string());
        entry.expires_at = now + SESSION_TTL;
        token
    }

    async fn revoke(&self, token: &str) {
        self.sessions.lock().await.remove(token);
    }
}

fn new_token() -> String {
    let mut buf = [0u8; 32];
    if getrandom::getrandom(&mut buf).is_err() {
        // 熵源不可用时用时间戳兜底：会话 token 猜中的代价是越权访问，
        // 但直接 panic 会让整个服务起不来，两害取其轻。
        let ns = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        for (i, b) in ns.to_le_bytes().iter().cycle().take(32).enumerate() {
            buf[i] = *b;
        }
    }
    to_hex(&buf)
}

/// 从 Cookie 头里取出会话 token。没引 tower-cookies —— 只读一个键，手写更省。
fn cookie_token(req_headers: &axum::http::HeaderMap) -> Option<String> {
    let raw = req_headers.get(header::COOKIE)?.to_str().ok()?;
    raw.split(';')
        .filter_map(|kv| kv.split_once('='))
        .find(|(k, _)| k.trim() == COOKIE_NAME)
        .map(|(_, v)| v.trim().to_string())
}

// ============== 中间件 + 登录页 ==============

/// 鉴权中间件。命中规则且没有有效会话时：
/// 浏览器（Accept: text/html）跳登录页，其它客户端（curl / XHR / 下载器）收 401。
pub(super) async fn require_auth(
    State(state): State<AuthState>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let path = req.uri().path().to_string();

    // 登录页自己不能要求登录，否则就是死循环
    if path.starts_with(AUTH_PREFIX) {
        return next.run(req).await;
    }

    let Some(rule) = match_rule(&state.rules, &path) else {
        return next.run(req).await;
    };

    let token = cookie_token(req.headers());
    if let Some(token) = token.as_deref() {
        if state.passed(token, &rule.id).await {
            return next.run(req).await;
        }
    }

    let wants_html = req
        .headers()
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|a| a.contains("text/html"));

    if wants_html {
        let next_url = req
            .uri()
            .path_and_query()
            .map(|pq| pq.as_str())
            .unwrap_or("/");
        Redirect::to(&format!(
            "{}/login?next={}",
            AUTH_PREFIX,
            urlencoding::encode(next_url)
        ))
        .into_response()
    } else {
        (
            StatusCode::UNAUTHORIZED,
            [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
            format!(
                r#"{{"error":"需要密码访问","loginUrl":"{}/login"}}"#,
                AUTH_PREFIX
            ),
        )
            .into_response()
    }
}

#[derive(Deserialize)]
struct LoginQuery {
    #[serde(default)]
    next: Option<String>,
}

#[derive(Deserialize)]
struct LoginForm {
    password: String,
    #[serde(default)]
    next: Option<String>,
}

/// 登录 / 登出路由。注册在根路径上，不受 urlPrefix 影响。
pub(super) fn auth_routes(state: AuthState) -> Router {
    Router::new()
        .route(
            &format!("{}/login", AUTH_PREFIX),
            get(login_page).post(login_submit),
        )
        .route(&format!("{}/logout", AUTH_PREFIX), get(logout).post(logout))
        .with_state(state)
}

async fn login_page(
    State(state): State<AuthState>,
    axum::extract::Query(q): axum::extract::Query<LoginQuery>,
) -> Response {
    let next = sanitize_next(q.next.as_deref());
    let label = match_rule(&state.rules, &next)
        .and_then(|r| r.label.clone())
        .filter(|s| !s.trim().is_empty());
    Html(render_login(&next, label.as_deref(), false)).into_response()
}

async fn login_submit(
    State(state): State<AuthState>,
    headers: axum::http::HeaderMap,
    Form(form): Form<LoginForm>,
) -> Response {
    let next = sanitize_next(form.next.as_deref());
    let Some(rule) = match_rule(&state.rules, &next) else {
        // 目标本来就不需要密码，直接放过去
        return Redirect::to(&next).into_response();
    };

    if !verify_password(&rule.password_hash, &form.password) {
        return (
            StatusCode::UNAUTHORIZED,
            Html(render_login(
                &next,
                rule.label.as_deref(),
                true,
            )),
        )
            .into_response();
    }

    let token = state.grant(cookie_token(&headers), &rule.id).await;
    // 局域网是明文 http，不能加 Secure（加了浏览器直接不存）。
    // HttpOnly + SameSite=Lax 该给的还是给上。
    let cookie = format!(
        "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
        COOKIE_NAME,
        token,
        SESSION_TTL.as_secs()
    );
    (
        StatusCode::SEE_OTHER,
        [
            (header::SET_COOKIE, cookie.as_str()),
            (header::LOCATION, next.as_str()),
        ],
    )
        .into_response()
}

async fn logout(State(state): State<AuthState>, headers: axum::http::HeaderMap) -> Response {
    if let Some(token) = cookie_token(&headers) {
        state.revoke(&token).await;
    }
    let cookie = format!("{}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0", COOKIE_NAME);
    (
        StatusCode::SEE_OTHER,
        [
            (header::SET_COOKIE, cookie.as_str()),
            (header::LOCATION, "/"),
        ],
    )
        .into_response()
}

/// `next` 只允许站内绝对路径。放任 `next=https://evil.example` 就是一个开放重定向：
/// 别人把带这个参数的链接发出去，登录后直接被弹到钓鱼站。
fn sanitize_next(next: Option<&str>) -> String {
    match next.map(str::trim).filter(|s| !s.is_empty()) {
        // `//host` 会被浏览器当成协议相对 URL，同样要挡
        Some(v) if v.starts_with('/') && !v.starts_with("//") => v.to_string(),
        _ => "/".to_string(),
    }
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn render_login(next: &str, label: Option<&str>, failed: bool) -> String {
    let hint = label
        .map(|l| format!("<p class=\"hint\">{}</p>", html_escape(l)))
        .unwrap_or_default();
    let err = if failed {
        "<p class=\"err\">密码不对，再试一次</p>"
    } else {
        ""
    };
    format!(
        r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>需要密码</title>
<style>
* {{ box-sizing: border-box; }}
body {{ margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
  background:#f3f4f6; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif; }}
.card {{ background:#fff; padding:32px; border-radius:16px; box-shadow:0 8px 32px rgba(0,0,0,.08);
  width:100%; max-width:360px; }}
h1 {{ margin:0 0 8px; font-size:18px; color:#111827; }}
p {{ margin:0 0 16px; font-size:13px; color:#6b7280; line-height:1.6; }}
.err {{ color:#dc2626; }}
input {{ width:100%; padding:10px 12px; font-size:14px; border:1px solid #d1d5db; border-radius:8px;
  outline:none; margin-bottom:12px; }}
input:focus {{ border-color:#3b82f6; }}
button {{ width:100%; padding:10px; font-size:14px; background:#3b82f6; color:#fff; border:none;
  border-radius:8px; cursor:pointer; }}
button:hover {{ background:#2563eb; }}
@media (prefers-color-scheme: dark) {{
  body {{ background:#111827; }} .card {{ background:#1f2937; }}
  h1 {{ color:#f9fafb; }} input {{ background:#111827; border-color:#374151; color:#f9fafb; }}
}}
</style>
</head>
<body>
<form class="card" method="post" action="{prefix}/login">
  <h1>需要密码访问</h1>
  {hint}
  {err}
  <input type="hidden" name="next" value="{next}">
  <input type="password" name="password" placeholder="访问密码" autofocus autocomplete="current-password">
  <button type="submit">进入</button>
</form>
</body>
</html>"#,
        prefix = AUTH_PREFIX,
        hint = hint,
        err = err,
        next = html_escape(next),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(id: &str, path: &str, kind: &str) -> AuthRule {
        AuthRule {
            id: id.into(),
            path: path.into(),
            match_kind: kind.into(),
            label: None,
            password_hash: hash_password("pw"),
            enabled: true,
        }
    }

    #[test]
    fn password_roundtrip() {
        let stored = hash_password("hunter2");
        assert!(verify_password(&stored, "hunter2"));
        assert!(!verify_password(&stored, "hunter3"));
        // 同一个密码两次哈希必须不同（盐生效了），否则等于没加盐
        assert_ne!(stored, hash_password("hunter2"));
        // 格式不认识时不能放行
        assert!(!verify_password("plaintext", "plaintext"));
        assert!(!verify_password("", ""));
    }

    #[test]
    fn no_rules_means_public() {
        assert!(match_rule(&[], "/anything").is_none());
        let mut disabled = rule("a", "/", "prefix");
        disabled.enabled = false;
        assert!(match_rule(&[disabled], "/anything").is_none());
    }

    #[test]
    fn longest_prefix_wins() {
        let rules = vec![
            rule("root", "/", "prefix"),
            rule("docs", "/docs", "prefix"),
        ];
        assert_eq!(match_rule(&rules, "/docs/a.txt").unwrap().id, "docs");
        assert_eq!(match_rule(&rules, "/other").unwrap().id, "root");
    }

    #[test]
    fn prefix_matches_only_whole_segments() {
        let rules = vec![rule("p", "/private", "prefix")];
        assert!(match_rule(&rules, "/private").is_some());
        assert!(match_rule(&rules, "/private/x.txt").is_some());
        // `/private-public` 不该被 `/private` 锁住
        assert!(match_rule(&rules, "/private-public/x").is_none());
    }

    #[test]
    fn exact_matches_only_itself() {
        let rules = vec![rule("f", "/docs/salary.pdf", "exact")];
        assert!(match_rule(&rules, "/docs/salary.pdf").is_some());
        assert!(match_rule(&rules, "/docs/other.pdf").is_none());
        assert!(match_rule(&rules, "/docs/salary.pdf/x").is_none());
    }

    #[test]
    fn percent_encoding_cannot_bypass() {
        let rules = vec![rule("p", "/private", "prefix")];
        // 不解码就匹配的话，这两个都会绕过密码，而 ServeDir 照样把文件发出去
        assert!(match_rule(&rules, "/priv%61te/secret.txt").is_some());
        assert!(match_rule(&rules, "/private//secret.txt").is_some());
        assert!(match_rule(&rules, "/private/").is_some());
    }

    #[test]
    fn dot_dot_never_falls_through() {
        let rules = vec![rule("p", "/private", "prefix")];
        assert!(match_rule(&rules, "/public/../private/x").is_some());
    }

    #[test]
    fn next_must_stay_on_site() {
        assert_eq!(sanitize_next(Some("/docs/a.txt")), "/docs/a.txt");
        // 开放重定向：登录后被弹到外站
        assert_eq!(sanitize_next(Some("https://evil.example")), "/");
        assert_eq!(sanitize_next(Some("//evil.example")), "/");
        assert_eq!(sanitize_next(None), "/");
    }
}
