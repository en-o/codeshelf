//! WebFetch 工具：HTTP(S) 抓取，自动识别 HTML/JSON/纯文本/二进制并做对应处理。
//! 可选「规则提取」：CSS 选择器(selector) + 正则(regex)，对任意站点通用，不内置任何站点专属逻辑。
//! 工作流模块也直接复用 `run_web_fetch_for_workflow`。
//!
//! 支持的 args（均可选，除 url 外）：
//! - url:        必填，http/https
//! - max_bytes:  最终输出上限字节数（默认 500_000，上限 2_000_000）；提取在截断之前进行
//! - timeout_ms: 请求超时毫秒（默认 30_000，范围 1_000..=120_000）
//! - proxy:      代理地址，如 "http://127.0.0.1:7890"（留空不走代理）
//! - headers:    自定义请求头对象
//! - selector:   CSS 选择器，命中后只保留匹配元素（HTML 页面才生效）
//! - extract_mode/extractMode: "text"(默认) | "html"，selector 命中后取文本还是原始 HTML
//! - regex:      正则；在 selector/正文之后再提取（有捕获组取组1，否则取整段匹配；多个匹配按行拼接）
//! - meta:       是否在输出前加 [WebFetch ...] 头（默认 true；工作流内传 false 以输出纯内容）

use crate::error::AppResult;
use serde_json::Value;
use std::time::Duration;

/// 单次抓取的**下载**硬上限。与 `max_bytes`（输出上限）不同：
/// 提取要在完整正文上做，所以下载上限更宽松，但必须存在 —— 否则一个
/// 无限 chunked 响应就能把内存吃光。
const MAX_DOWNLOAD_BYTES: usize = 10 * 1024 * 1024;

pub(super) async fn tool_web_fetch(args: &Value) -> AppResult<String> {
    run_web_fetch(args).await
}

/// 供工作流模块调用
pub async fn run_web_fetch_for_workflow(args: &Value) -> AppResult<String> {
    run_web_fetch(args).await
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
}

async fn run_web_fetch(args: &Value) -> AppResult<String> {
    let url = args
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or("缺少 url")?
        .trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("仅支持 http/https URL".into());
    }
    let max_bytes = args
        .get("max_bytes")
        .and_then(|v| v.as_u64())
        .unwrap_or(500_000)
        .min(2_000_000) as usize;
    let timeout_ms = args
        .get("timeout_ms")
        .and_then(|v| v.as_u64())
        .unwrap_or(30_000)
        .clamp(1_000, 120_000);
    let proxy = arg_str(args, "proxy");
    let selector = arg_str(args, "selector");
    let regex_pat = arg_str(args, "regex");
    let extract_mode = args
        .get("extract_mode")
        .or_else(|| args.get("extractMode"))
        .and_then(|v| v.as_str())
        .unwrap_or("text");
    let include_meta = args.get("meta").and_then(|v| v.as_bool()).unwrap_or(true);

    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        // 连接阶段单独设上限：总超时可以放宽到 120s，但连不上的地址不该占满这段时间
        .connect_timeout(Duration::from_millis(timeout_ms.min(10_000)))
        .user_agent("codeshelf/0.1 (+https://github.com/)");
    if let Some(p) = proxy {
        let pr = reqwest::Proxy::all(p)
            .map_err(|e| crate::error::AppError::from(format!("代理地址无效: {}", e)))?;
        builder = builder.proxy(pr);
    }
    let client = builder
        .build()
        .map_err(|e| crate::error::AppError::from(format!("客户端构建失败: {}", e)))?;

    let headers = args.get("headers").and_then(|v| v.as_object());

    // 发送（连接/超时类错误重试一次）
    let resp = match send_once(&client, url, headers).await {
        Ok(r) => r,
        Err(e) if e.is_connect() || e.is_timeout() => {
            tokio::time::sleep(Duration::from_millis(600)).await;
            send_once(&client, url, headers).await.map_err(|e| {
                crate::error::AppError::from(format!("请求失败（已重试）: {}", e))
            })?
        }
        Err(e) => return Err(crate::error::AppError::from(format!("请求失败: {}", e))),
    };

    let status = resp.status();
    let final_url = resp.url().to_string();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    // 流式读取并在上限处停止。不能用 `resp.bytes()` ——
    // 那会把完整 body 先收进内存，之后才按 max_bytes 截断；
    // 没有 Content-Length 的 chunked 响应在到达截断那一行之前就已经吃满内存了。
    //
    // 注意这里的上限是**下载**上限，与 `max_bytes`（输出上限）是两回事：
    // CSS selector / regex 提取需要在完整正文上做，所以下载上限必须更宽松，
    // 但仍要有一个确定的天花板。
    let (bytes, download_truncated) = crate::http_body::read_capped(resp, MAX_DOWNLOAD_BYTES)
        .await
        .map_err(crate::error::AppError::from)?;
    let bytes = bytes.as_slice();
    let total_len = bytes.len();

    let ct_lower = content_type.to_lowercase();
    let is_binary_ct = [
        "image/",
        "audio/",
        "video/",
        "application/octet-stream",
        "application/pdf",
        "application/zip",
        "application/gzip",
        "application/x-tar",
        "application/x-7z",
        "application/x-rar",
    ]
    .iter()
    .any(|p| ct_lower.starts_with(p) || ct_lower.contains(p));

    // 1) 先在「完整正文」上做提取（不受 max_bytes 截断影响）
    let mut body = if is_binary_ct {
        format!(
            "（二进制内容，Content-Type={}，大小={} 字节，已跳过正文）",
            content_type, total_len
        )
    } else {
        let raw = String::from_utf8_lossy(&bytes).to_string();
        let is_json = ct_lower.contains("application/json") || ct_lower.contains("+json");
        let looks_html = ct_lower.contains("text/html")
            || ct_lower.contains("application/xhtml")
            || ((ct_lower.is_empty() || ct_lower.contains("xml")) && raw.trim_start().starts_with('<'));

        if let Some(sel) = selector {
            if looks_html {
                extract_by_selector(&raw, sel, extract_mode)?
            } else if is_json {
                pretty_json(&raw)
            } else {
                raw
            }
        } else if is_json {
            pretty_json(&raw)
        } else if looks_html {
            html_to_text(&raw)
        } else {
            raw
        }
    };

    // 2) 再按 regex 提取（二进制不处理）
    if !is_binary_ct {
        if let Some(pat) = regex_pat {
            body = apply_regex(&body, pat)?;
        }
    }

    // 3) 最后按 max_bytes 截断输出
    let (body_out, truncated) = truncate_on_char_boundary(&body, max_bytes);
    let trailer = if download_truncated {
        format!(
            "\n\n[响应超过下载上限 {} MB，已在读取过程中终止；以下内容不完整]",
            MAX_DOWNLOAD_BYTES / 1024 / 1024
        )
    } else if truncated {
        format!("\n\n[已截断，输出上限 {} 字节]", max_bytes)
    } else {
        String::new()
    };

    if include_meta {
        Ok(format!(
            "[WebFetch {}]\nURL: {}\nContent-Type: {}\nSize: {} bytes\n\n{}{}",
            status.as_u16(),
            final_url,
            content_type,
            total_len,
            body_out,
            trailer
        ))
    } else {
        Ok(format!("{}{}", body_out, trailer))
    }
}

async fn send_once(
    client: &reqwest::Client,
    url: &str,
    headers: Option<&serde_json::Map<String, Value>>,
) -> reqwest::Result<reqwest::Response> {
    let mut req = client.get(url);
    if let Some(h) = headers {
        for (k, v) in h {
            if let Some(val) = v.as_str() {
                req = req.header(k.as_str(), val);
            }
        }
    }
    req.send().await
}

fn pretty_json(raw: &str) -> String {
    match serde_json::from_str::<Value>(raw) {
        Ok(v) => serde_json::to_string_pretty(&v).unwrap_or_else(|_| raw.to_string()),
        Err(_) => raw.to_string(),
    }
}

/// 用 CSS 选择器从 HTML 中提取命中元素；mode="html" 返回元素原始 HTML，否则返回文本。
fn extract_by_selector(html: &str, selector: &str, mode: &str) -> AppResult<String> {
    use kuchikiki::traits::*;
    let document = kuchikiki::parse_html().one(html).document_node;
    let matches = document
        .select(selector)
        .map_err(|_| crate::error::AppError::from(format!("CSS 选择器无效: {}", selector)))?;
    let want_html = mode.eq_ignore_ascii_case("html");
    let mut parts: Vec<String> = Vec::new();
    for m in matches {
        if want_html {
            parts.push(m.as_node().to_string());
        } else {
            let text = m.as_node().text_contents();
            let collapsed = text
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            parts.push(collapsed);
        }
    }
    if parts.is_empty() {
        return Ok(format!("[选择器未匹配到任何元素: {}]", selector));
    }
    Ok(parts.join("\n\n"))
}

/// 用正则提取：有捕获组取组1，否则取整段匹配；多个匹配按行拼接。
fn apply_regex(text: &str, pattern: &str) -> AppResult<String> {
    let re = regex::Regex::new(pattern)
        .map_err(|e| crate::error::AppError::from(format!("正则表达式无效: {}", e)))?;
    let mut out: Vec<String> = Vec::new();
    for caps in re.captures_iter(text) {
        if let Some(g1) = caps.get(1) {
            out.push(g1.as_str().to_string());
        } else if let Some(g0) = caps.get(0) {
            out.push(g0.as_str().to_string());
        }
    }
    if out.is_empty() {
        return Ok(format!("[正则未匹配到内容: {}]", pattern));
    }
    Ok(out.join("\n"))
}

fn truncate_on_char_boundary(s: &str, max_bytes: usize) -> (String, bool) {
    if s.len() <= max_bytes {
        return (s.to_string(), false);
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    (s[..end].to_string(), true)
}

/// 最朴素的 HTML → 纯文本转换：去 <script>/<style>，再剥标签、折叠空白。
fn html_to_text(html: &str) -> String {
    let mut s = html.to_string();
    for tag in ["script", "style", "noscript"] {
        loop {
            let open = format!("<{}", tag);
            let close = format!("</{}>", tag);
            let lower = s.to_lowercase();
            let Some(start) = lower.find(&open) else {
                break;
            };
            let Some(end_rel) = lower[start..].find(&close) else {
                break;
            };
            let end = start + end_rel + close.len();
            s.replace_range(start..end, "");
        }
    }
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    let out = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    let mut lines: Vec<&str> = out
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();
    lines.dedup();
    lines.join("\n")
}
