//! 静态目录索引。
//!
//! `tower_http::ServeDir` 擅长文件响应（Range、Last-Modified、MIME 等），但目录里没有
//! `index.html` 时只会返回 404。这里作为它的 fallback：请求确实指向目录时生成可浏览
//! 的文件列表；普通的不存在路径仍然返回 404。

use axum::{
    extract::State,
    http::{header, HeaderValue, StatusCode, Uri},
    response::{Html, IntoResponse, Response},
};
use chrono::{DateTime, Local};
use std::{
    cmp::Ordering,
    fmt::Write as _,
    io,
    path::{Component, Path, PathBuf},
    time::SystemTime,
};

#[derive(Clone)]
pub(super) struct DirectoryListingState {
    root_dir: PathBuf,
}

impl DirectoryListingState {
    pub(super) fn new(root_dir: impl Into<PathBuf>) -> Self {
        Self {
            root_dir: root_dir.into(),
        }
    }
}

#[derive(Debug)]
enum ListingError {
    InvalidPath,
    NotFound,
    Forbidden,
    Io(io::Error),
}

#[derive(Debug)]
struct ListingEntry {
    name: String,
    is_dir: bool,
    size: Option<u64>,
    modified: Option<SystemTime>,
}

pub(super) async fn directory_listing(
    State(state): State<DirectoryListingState>,
    uri: Uri,
) -> Response {
    match render_directory_listing(&state.root_dir, uri.path()).await {
        Ok(html) => html_response(StatusCode::OK, html),
        Err(ListingError::InvalidPath | ListingError::NotFound) => {
            error_response(StatusCode::NOT_FOUND, "找不到此文件或目录", uri.path())
        }
        Err(ListingError::Forbidden) => {
            error_response(StatusCode::FORBIDDEN, "无法读取此目录", uri.path())
        }
        Err(ListingError::Io(error)) => {
            log::error!("生成目录索引失败 ({}): {}", uri.path(), error);
            error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "读取目录时发生错误",
                uri.path(),
            )
        }
    }
}

async fn render_directory_listing(
    root_dir: &Path,
    request_path: &str,
) -> Result<String, ListingError> {
    let directory = resolve_path(root_dir, request_path).ok_or(ListingError::InvalidPath)?;
    let metadata = tokio::fs::metadata(&directory)
        .await
        .map_err(map_io_error)?;
    if !metadata.is_dir() {
        return Err(ListingError::NotFound);
    }

    let mut reader = tokio::fs::read_dir(&directory)
        .await
        .map_err(map_io_error)?;
    let mut entries = Vec::new();
    while let Some(entry) = reader.next_entry().await.map_err(map_io_error)? {
        let file_type = match entry.file_type().await {
            Ok(file_type) => file_type,
            Err(error) => {
                log::warn!(
                    "读取目录条目类型失败 ({}): {}",
                    entry.path().display(),
                    error
                );
                continue;
            }
        };
        let metadata = entry.metadata().await.ok();
        entries.push(ListingEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir: file_type.is_dir(),
            size: metadata
                .as_ref()
                .filter(|_| !file_type.is_dir())
                .map(|m| m.len()),
            modified: metadata.and_then(|m| m.modified().ok()),
        });
    }

    sort_entries(&mut entries);

    let decoded_path = urlencoding::decode(request_path.trim_start_matches('/'))
        .map_err(|_| ListingError::InvalidPath)?;
    let display_path = if decoded_path.is_empty() {
        "/".to_string()
    } else {
        format!("/{}/", decoded_path.trim_matches('/'))
    };

    Ok(render_html(&display_path, &entries))
}

fn sort_entries(entries: &mut [ListingEntry]) {
    entries.sort_by(|left, right| match (left.is_dir, right.is_dir) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => left
            .name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.name.cmp(&right.name)),
    });
}

/// 与 `ServeDir` 使用同一套路径约束：只接受普通相对路径组件，拒绝 `..`、盘符和根路径。
fn resolve_path(root_dir: &Path, request_path: &str) -> Option<PathBuf> {
    let decoded = urlencoding::decode(request_path.trim_start_matches('/')).ok()?;
    let relative = Path::new(decoded.as_ref());
    let mut resolved = root_dir.to_path_buf();

    for component in relative.components() {
        match component {
            Component::Normal(value)
                if Path::new(value)
                    .components()
                    .all(|part| matches!(part, Component::Normal(_))) =>
            {
                resolved.push(value);
            }
            Component::CurDir => {}
            Component::Normal(_)
            | Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_) => return None,
        }
    }

    Some(resolved)
}

fn render_html(display_path: &str, entries: &[ListingEntry]) -> String {
    let escaped_path = escape_html(display_path);
    let mut rows = String::new();

    if display_path != "/" {
        rows.push_str(
            r#"<a class="entry parent" href="../"><span class="icon">↩</span><span class="name">上一级目录</span><span class="modified"></span><span class="size">—</span></a>"#,
        );
    }

    for entry in entries {
        let escaped_name = escape_html(&entry.name);
        let encoded_name = percent_encode_component(&entry.name);
        let suffix = if entry.is_dir { "/" } else { "" };
        let icon = if entry.is_dir { "📁" } else { "📄" };
        let class = if entry.is_dir {
            "entry directory"
        } else {
            "entry file"
        };
        let modified = entry
            .modified
            .map(format_modified)
            .unwrap_or_else(|| "—".to_string());
        let size = entry
            .size
            .map(format_size)
            .unwrap_or_else(|| "—".to_string());

        let _ = write!(
            rows,
            r#"<a class="{class}" href="./{encoded_name}{suffix}"><span class="icon">{icon}</span><span class="name">{escaped_name}{suffix}</span><span class="modified">{modified}</span><span class="size">{size}</span></a>"#,
        );
    }

    if entries.is_empty() {
        rows.push_str(r#"<div class="empty">这个目录是空的</div>"#);
    }

    format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Index of {escaped_path}</title>
  <style>
    :root {{ color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; background: #f5f7fb; color: #182033; }}
    main {{ width: min(960px, calc(100% - 32px)); margin: 48px auto; }}
    .panel {{ overflow: hidden; border: 1px solid #e4e8f0; border-radius: 16px; background: #fff; box-shadow: 0 10px 30px rgba(31, 41, 55, .07); }}
    header {{ padding: 24px 28px 20px; border-bottom: 1px solid #edf0f5; }}
    h1 {{ margin: 0; font-size: 21px; font-weight: 650; }}
    .path {{ margin-top: 8px; color: #657087; font: 14px ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }}
    .columns, .entry {{ display: grid; grid-template-columns: 34px minmax(180px, 1fr) 180px 90px; align-items: center; gap: 8px; }}
    .columns {{ padding: 10px 24px; color: #8a94a8; background: #fafbfc; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }}
    .entry {{ min-height: 48px; padding: 6px 24px; border-top: 1px solid #f0f2f6; color: inherit; text-decoration: none; }}
    .entry:hover {{ background: #f2f7ff; }}
    .icon {{ font-size: 19px; text-align: center; }}
    .name {{ min-width: 0; overflow-wrap: anywhere; color: #2563eb; }}
    .modified, .size {{ color: #7b8599; font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }}
    .size {{ text-align: right; }}
    .empty {{ padding: 56px 24px; color: #8a94a8; text-align: center; }}
    footer {{ margin-top: 14px; color: #9aa3b4; font-size: 12px; text-align: center; }}
    @media (max-width: 680px) {{
      main {{ margin-top: 20px; }}
      .columns, .entry {{ grid-template-columns: 30px minmax(0, 1fr) 72px; }}
      .columns .modified, .entry .modified {{ display: none; }}
    }}
    @media (prefers-color-scheme: dark) {{
      body {{ background: #11151d; color: #e7eaf0; }}
      .panel {{ background: #181d27; border-color: #2a3140; box-shadow: none; }}
      header, .entry {{ border-color: #292f3c; }}
      .columns {{ background: #151a23; color: #8892a6; }}
      .entry:hover {{ background: #202a3a; }}
      .name {{ color: #75a7ff; }}
    }}
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <header><h1>目录浏览</h1><div class="path">{escaped_path}</div></header>
      <div class="columns"><span></span><span>名称</span><span class="modified">修改时间</span><span class="size">大小</span></div>
      <div>{rows}</div>
    </section>
    <footer>CodeShelf Local Service</footer>
  </main>
</body>
</html>"#
    )
}

fn error_response(status: StatusCode, message: &str, request_path: &str) -> Response {
    let title = format!(
        "{} {}",
        status.as_u16(),
        status.canonical_reason().unwrap_or("Error")
    );
    let body = format!(
        r#"<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{}</title><style>:root{{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}body{{display:grid;min-height:100vh;margin:0;place-items:center;background:#f5f7fb;color:#182033}}main{{padding:36px;text-align:center}}h1{{font-size:56px;margin:0 0 12px}}p{{color:#697386}}code{{overflow-wrap:anywhere}}@media(prefers-color-scheme:dark){{body{{background:#11151d;color:#e7eaf0}}p{{color:#9aa3b4}}}}</style></head><body><main><h1>{}</h1><p>{}</p><code>{}</code></main></body></html>"#,
        escape_html(&title),
        status.as_u16(),
        escape_html(message),
        escape_html(request_path),
    );
    html_response(status, body)
}

fn html_response(status: StatusCode, body: String) -> Response {
    let mut response = (status, Html(body)).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; style-src 'unsafe-inline'"),
    );
    response
}

fn map_io_error(error: io::Error) -> ListingError {
    match error.kind() {
        io::ErrorKind::NotFound => ListingError::NotFound,
        io::ErrorKind::PermissionDenied => ListingError::Forbidden,
        _ => ListingError::Io(error),
    }
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn percent_encode_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(*byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(*byte));
        } else {
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

fn format_modified(value: SystemTime) -> String {
    let local: DateTime<Local> = value.into();
    local.format("%Y-%m-%d %H:%M:%S").to_string()
}

fn format_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    if bytes < 1024 {
        return format!("{bytes} B");
    }

    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    format!("{value:.1} {}", UNITS[unit])
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::get, Router};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tower_http::services::ServeDir;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "codeshelf-directory-listing-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn path_resolution_rejects_traversal() {
        let root = Path::new("/tmp/static-root");
        assert_eq!(resolve_path(root, "/docs/"), Some(root.join("docs")));
        assert_eq!(resolve_path(root, "/%2e%2e/secret"), None);
        assert_eq!(resolve_path(root, "/../secret"), None);
    }

    #[test]
    fn names_are_safe_in_html_and_links() {
        assert_eq!(escape_html("<a & \"b\">"), "&lt;a &amp; &quot;b&quot;&gt;");
        assert_eq!(
            percent_encode_component("报告 1#.pdf"),
            "%E6%8A%A5%E5%91%8A%201%23.pdf"
        );
    }

    #[test]
    fn directories_are_rendered_before_files() {
        let mut entries = vec![
            ListingEntry {
                name: "z.txt".to_string(),
                is_dir: false,
                size: Some(1),
                modified: None,
            },
            ListingEntry {
                name: "docs".to_string(),
                is_dir: true,
                size: None,
                modified: None,
            },
        ];
        sort_entries(&mut entries);

        let html = render_html("/", &entries);
        assert!(html.find("./docs/").unwrap() < html.find("./z.txt").unwrap());
    }

    #[tokio::test]
    async fn serve_dir_uses_listing_fallback_and_keeps_file_downloads() {
        let root = TestDirectory::new();
        std::fs::create_dir(root.0.join("docs")).unwrap();
        std::fs::write(root.0.join("报告 1.txt"), "download content").unwrap();

        let listing = get(directory_listing).with_state(DirectoryListingState::new(root.0.clone()));
        let static_files = ServeDir::new(&root.0)
            .append_index_html_on_directories(true)
            .fallback(listing);
        let app = Router::new().nest_service("/files", static_files);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let listing_response = reqwest::get(format!("http://{address}/files/"))
            .await
            .unwrap();
        assert_eq!(listing_response.status().as_u16(), 200);
        let listing_html = listing_response.text().await.unwrap();
        assert!(listing_html.contains("./docs/"));
        assert!(listing_html.contains("./%E6%8A%A5%E5%91%8A%201.txt"));

        let file_response =
            reqwest::get(format!("http://{address}/files/%E6%8A%A5%E5%91%8A%201.txt"))
                .await
                .unwrap();
        assert_eq!(file_response.status().as_u16(), 200);
        assert_eq!(file_response.text().await.unwrap(), "download content");

        server.abort();
    }
}


