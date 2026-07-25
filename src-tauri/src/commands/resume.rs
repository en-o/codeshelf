// Resume persistence and model proxy commands.
//
// Background knowledge generation, project-experience generation, run logs,
// prompt config, and project file tools live in the Node resume-agent sidecar.

use serde::{Deserialize, Serialize};
use std::fs;

use crate::error::{AppError, AppResult};
use crate::storage::get_storage_config;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct LlmProxyHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct LlmProxyRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<LlmProxyHeader>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct LlmProxyResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<LlmProxyHeader>,
    pub body: String,
}

#[tauri::command]
#[specta::specta]
pub async fn llm_proxy_request(request: LlmProxyRequest) -> AppResult<LlmProxyResponse> {
    let url = reqwest::Url::parse(request.url.trim())
        .map_err(|e| AppError::invalid(format!("模型请求 URL 不合法: {}", e)))?;
    match url.scheme() {
        "http" | "https" => {}
        _ => return Err(AppError::invalid("模型请求只允许 http/https")),
    }

    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|e| AppError::invalid(format!("模型请求 method 不合法: {}", e)))?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| AppError::from(format!("创建模型请求客户端失败: {}", e)))?;

    let url_text = url.as_str().to_string();
    let mut builder = client.request(method, url);
    for header in request.headers {
        let name = header.name.trim();
        if name.is_empty() {
            continue;
        }
        let lower = name.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "host" | "content-length" | "connection" | "transfer-encoding" | "accept-encoding"
        ) {
            continue;
        }
        let Ok(header_name) = reqwest::header::HeaderName::from_bytes(name.as_bytes()) else {
            continue;
        };
        let Ok(header_value) = reqwest::header::HeaderValue::from_str(&header.value) else {
            continue;
        };
        builder = builder.header(header_name, header_value);
    }

    if let Some(body) = request.body {
        builder = builder.body(force_non_stream_body(body, &url_text));
    }

    let response = builder
        .send()
        .await
        .map_err(|e| AppError::from(format!("模型请求失败: {}", e)))?;
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let headers = response
        .headers()
        .iter()
        .filter(|(name, _)| {
            !matches!(
                name.as_str(),
                "content-length" | "content-encoding" | "transfer-encoding" | "connection"
            )
        })
        .filter_map(|(name, value)| {
            value.to_str().ok().map(|v| LlmProxyHeader {
                name: name.as_str().to_string(),
                value: v.to_string(),
            })
        })
        .collect();
    let body = response
        .text()
        .await
        .map_err(|e| AppError::from(format!("读取模型响应失败: {}", e)))?;

    Ok(LlmProxyResponse {
        status: status.as_u16(),
        status_text,
        headers,
        body,
    })
}

fn force_non_stream_body(body: String, url: &str) -> String {
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&body) else {
        return body;
    };
    if let Some(obj) = value.as_object_mut() {
        let is_deepseek = url.to_ascii_lowercase().contains("deepseek");
        let mut keep_reasoning_content = false;
        if obj.get("stream").and_then(|v| v.as_bool()) == Some(true) {
            obj.insert("stream".to_string(), serde_json::Value::Bool(false));
        }
        obj.remove("stream_options");
        if is_deepseek {
            let thinking_enabled = obj
                .remove("enable_thinking")
                .and_then(|v| v.as_bool())
                .unwrap_or_else(|| {
                    obj.get("thinking")
                        .and_then(|v| v.get("type"))
                        .and_then(|v| v.as_str())
                        == Some("enabled")
                });
            obj.insert(
                "thinking".to_string(),
                serde_json::json!({
                    "type": if thinking_enabled { "enabled" } else { "disabled" }
                }),
            );
            keep_reasoning_content = thinking_enabled;
            if let Some(effort) = obj
                .remove("reasoning")
                .and_then(|v| v.get("effort").cloned())
            {
                obj.insert("reasoning_effort".to_string(), effort);
            }
            if thinking_enabled {
                obj.remove("temperature");
                obj.remove("top_p");
                obj.remove("presence_penalty");
                obj.remove("frequency_penalty");
            }
        } else {
            obj.insert(
                "enable_thinking".to_string(),
                serde_json::Value::Bool(false),
            );
            obj.remove("thinking");
            obj.remove("reasoning_effort");
            obj.remove("reasoning");
        }
        obj.remove("reasoning_content");
        obj.insert(
            "parallel_tool_calls".to_string(),
            serde_json::Value::Bool(false),
        );
        if !keep_reasoning_content {
            if let Some(messages) = obj.get_mut("messages").and_then(|v| v.as_array_mut()) {
                for msg in messages {
                    if let Some(msg_obj) = msg.as_object_mut() {
                        msg_obj.remove("reasoning_content");
                    }
                }
            }
        }
    }
    serde_json::to_string(&value).unwrap_or(body)
}

#[tauri::command]
#[specta::specta]
pub async fn get_resumes() -> AppResult<serde_json::Value> {
    let config = get_storage_config()?;
    let path = config.resumes_file();

    if !path.exists() {
        return Ok(serde_json::json!([]));
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| AppError::from(format!("读取简历数据失败: {}", e)))?;

    if content.trim().is_empty() {
        return Ok(serde_json::json!([]));
    }

    let data: serde_json::Value = serde_json::from_str(&content).unwrap_or(serde_json::json!([]));
    Ok(data)
}

#[tauri::command]
#[specta::specta]
pub async fn save_resumes(data: serde_json::Value) -> AppResult<()> {
    let config = get_storage_config()?;
    config.ensure_dirs()?;

    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| AppError::from(format!("序列化简历数据失败: {}", e)))?;

    crate::storage::write_atomic(config.resumes_file(), content)
        .map_err(|e| AppError::from(format!("保存简历数据失败: {}", e)))?;
    Ok(())
}
