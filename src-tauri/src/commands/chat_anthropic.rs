// Anthropic（Claude）协议适配。
//
// 为什么要单独一套：Anthropic 不是 OpenAI 兼容的。差异全在三处，别的都一样：
//   1. 端点与鉴权：POST /v1/messages，`x-api-key` + `anthropic-version` 头，不是 Bearer
//   2. 消息结构：system 是**顶层字段**不是一条消息；助手的工具调用是 `tool_use` 内容块，
//      工具结果是 user 消息里的 `tool_result` 块，而不是 role=tool 的独立消息
//   3. 流式事件：`content_block_delta` 里按块类型分 text_delta / thinking_delta /
//      input_json_delta，不是 OpenAI 的 choices[0].delta
//
// 出口仍是同一个 `ChatStreamEvent`（"chat-stream" 事件），前端一行都不用改。

use super::chat::{ChatStreamEvent, ChatStreamMessage, ChatStreamRequest, TokenUsage, ToolCallDelta};
use crate::error::{AppError, AppResult};
use futures::StreamExt;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

/// Anthropic 要求显式带版本头，且这个值是写死的日期串，不是我们的应用版本
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// `max_tokens` 在 Anthropic 是**必填**（OpenAI 是可选）。会话没设时给一个够用的默认值。
const DEFAULT_MAX_TOKENS: u32 = 8192;

/// 请求里 `protocol` 字段等于这个值时走本模块
pub const PROTOCOL: &str = "anthropic";

pub fn is_anthropic(request: &ChatStreamRequest) -> bool {
    request.protocol.as_deref() == Some(PROTOCOL)
}

/// 内部还有几处直接拼 OpenAI 兼容请求的功能（聊天桥接、流程、Docker 生成），
/// 它们暂时不会说 Anthropic 协议。与其让用户对着 HTTP 404 猜，不如直说，
/// 并给出一条能照做的出路。
pub fn reject_if_anthropic(preset_key: Option<&str>, feature: &str) -> AppResult<()> {
    if preset_key == Some(PROTOCOL) {
        return Err(AppError::Invalid(format!(
            "{feature} 暂不支持 Anthropic（Claude）协议，请换一个 OpenAI 兼容的供应商，             或用 OpenAI 兼容网关接入 Claude"
        )));
    }
    Ok(())
}

fn text_of(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .filter_map(|b| b.get("text").and_then(|v| v.as_str()))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// OpenAI 形状的消息数组 → Anthropic 的 (system, messages)。
///
/// 三条改写规则：
/// - system 消息抽到顶层（多条就拼起来）
/// - assistant.tool_calls → content 里的 `tool_use` 块
/// - role=tool 的结果消息 → user 消息里的 `tool_result` 块；连续多条合成一条 user 消息，
///   因为 Anthropic 要求 user/assistant 严格交替
fn convert_messages(messages: &[ChatStreamMessage]) -> (String, Vec<Value>) {
    let mut system = String::new();
    let mut out: Vec<Value> = Vec::new();

    for m in messages {
        match m.role.as_str() {
            "system" => {
                let text = text_of(&m.content);
                if !text.trim().is_empty() {
                    if !system.is_empty() {
                        system.push_str("\n\n");
                    }
                    system.push_str(&text);
                }
            }
            "tool" => {
                let block = json!({
                    "type": "tool_result",
                    "tool_use_id": m.tool_call_id.clone().unwrap_or_default(),
                    "content": text_of(&m.content),
                });
                // 紧邻的上一条也是 user 就并进去，保持 user/assistant 交替
                match out.last_mut() {
                    Some(last) if last.get("role").and_then(|v| v.as_str()) == Some("user") => {
                        if let Some(arr) = last.get_mut("content").and_then(|v| v.as_array_mut()) {
                            arr.push(block);
                        }
                    }
                    _ => out.push(json!({ "role": "user", "content": [block] })),
                }
            }
            "assistant" => {
                let mut blocks: Vec<Value> = Vec::new();
                let text = text_of(&m.content);
                if !text.trim().is_empty() {
                    blocks.push(json!({ "type": "text", "text": text }));
                }
                for call in m.tool_calls.iter().flatten() {
                    let func = call.get("function");
                    let args_raw = func
                        .and_then(|f| f.get("arguments"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("{}");
                    // Anthropic 的 input 是对象，不是 OpenAI 那样的 JSON 字符串
                    let input: Value = serde_json::from_str(args_raw).unwrap_or_else(|_| json!({}));
                    blocks.push(json!({
                        "type": "tool_use",
                        "id": call.get("id").and_then(|v| v.as_str()).unwrap_or_default(),
                        "name": func.and_then(|f| f.get("name")).and_then(|v| v.as_str()).unwrap_or_default(),
                        "input": input,
                    }));
                }
                if !blocks.is_empty() {
                    out.push(json!({ "role": "assistant", "content": blocks }));
                }
            }
            _ => {
                // user：图片等多模态块原样带过去（Anthropic 也用 content 块数组）
                let content = match &m.content {
                    Value::Array(_) => m.content.clone(),
                    other => json!([{ "type": "text", "text": text_of(other) }]),
                };
                out.push(json!({ "role": "user", "content": content }));
            }
        }
    }

    (system, out)
}

/// OpenAI 的 function tools → Anthropic 的 tools（字段名不同，语义一致）
fn convert_tools(tools: &[Value]) -> Vec<Value> {
    tools
        .iter()
        .filter_map(|t| {
            let f = t.get("function")?;
            Some(json!({
                "name": f.get("name")?,
                "description": f.get("description").cloned().unwrap_or(Value::String(String::new())),
                "input_schema": f.get("parameters").cloned().unwrap_or(json!({ "type": "object" })),
            }))
        })
        .collect()
}

pub fn build_payload(
    request: &ChatStreamRequest,
    use_stream: bool,
) -> AppResult<(String, reqwest::header::HeaderMap, Value)> {
    let base = request.base_url.trim_end_matches('/');
    // 用户可能填 https://api.anthropic.com 也可能填 …/v1，两种都接受
    let url = if base.ends_with("/v1") {
        format!("{}/messages", base)
    } else {
        format!("{}/v1/messages", base)
    };

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        "anthropic-version",
        ANTHROPIC_VERSION
            .parse()
            .map_err(|e| AppError::from(format!("无效的 anthropic-version: {e}")))?,
    );
    if let Some(key) = request.api_key.as_ref().filter(|k| !k.is_empty()) {
        headers.insert(
            "x-api-key",
            key.parse()
                .map_err(|e| AppError::from(format!("无效 API Key: {e}")))?,
        );
    }

    let (system, messages) = convert_messages(&request.messages);
    let mut payload = json!({
        "model": request.model,
        "messages": messages,
        "max_tokens": request.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS),
        "stream": use_stream,
    });
    if !system.trim().is_empty() {
        payload["system"] = json!(system);
    }
    if let Some(t) = request.temperature {
        payload["temperature"] = json!(t);
    }
    if let Some(p) = request.top_p {
        payload["top_p"] = json!(p);
    }
    if let Some(tools) = request.tools.as_ref().filter(|t| !t.is_empty()) {
        payload["tools"] = json!(convert_tools(tools));
    }
    Ok((url, headers, payload))
}

/// stop_reason → 前端认识的 finish_reason
fn finish_reason_of(stop: &str) -> &'static str {
    match stop {
        "tool_use" => "tool_calls",
        "max_tokens" => "length",
        _ => "stop",
    }
}

fn usage_of(value: &Value) -> Option<TokenUsage> {
    let u = value.get("usage")?;
    let input = u.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let output = u.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    if input == 0 && output == 0 {
        return None;
    }
    Some(TokenUsage {
        prompt_tokens: input,
        completion_tokens: output,
        total_tokens: input + output,
    })
}

/// 流式对话。事件出口与 OpenAI 分支完全一致，前端不区分协议。
pub async fn stream(app: AppHandle, request: ChatStreamRequest, client: reqwest::Client) {
    let request_id = request.request_id.clone();
    let emit_error = |err: String| {
        let mut ev = ChatStreamEvent::new(&request_id);
        ev.done = true;
        ev.error = Some(err);
        let _ = app.emit("chat-stream", ev);
    };

    let (url, headers, body) = match build_payload(&request, true) {
        Ok(v) => v,
        Err(e) => return emit_error(e.to_string()),
    };

    let response = match client.post(&url).headers(headers).json(&body).send().await {
        Ok(r) => r,
        Err(err) => return emit_error(format!("请求失败: {err}")),
    };
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return emit_error(format!("HTTP {status}: {text}"));
    }

    let mut stream = response.bytes_stream();
    // 与 OpenAI 分支同样按字节缓冲：网络分片会把多字节 UTF-8 切两半
    let mut buffer: Vec<u8> = Vec::new();
    let mut finish: Option<String> = None;
    let mut usage: Option<TokenUsage> = None;
    // 当前内容块的下标：工具调用的参数按块下标累积（同一轮可能有多个工具调用）
    let mut block_index: u32 = 0;

    while let Some(chunk) = stream.next().await {
        let bytes = match chunk {
            Ok(b) => b,
            Err(err) => return emit_error(format!("读取流失败: {err}")),
        };
        buffer.extend_from_slice(&bytes);

        while let Some(pos) = buffer.iter().position(|b| *b == b'\n') {
            let line = buffer.drain(..=pos).collect::<Vec<_>>();
            let line = String::from_utf8_lossy(&line);
            let line = line.trim();
            // SSE 的 `event:` 行不用管：每个 data 里都带 type，按它分发即可
            if line.is_empty() || !line.starts_with("data:") {
                continue;
            }
            let data = line.trim_start_matches("data:").trim();
            let Ok(parsed) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            match parsed.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                "content_block_start" => {
                    block_index = parsed.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                    let block = parsed.get("content_block");
                    let kind = block.and_then(|b| b.get("type")).and_then(|v| v.as_str());
                    if kind == Some("tool_use") {
                        // 工具调用的 id/name 只在块开始时出现一次，参数随后增量到达
                        let mut ev = ChatStreamEvent::new(&request_id);
                        ev.tool_call_delta = Some(ToolCallDelta {
                            index: block_index,
                            id: block
                                .and_then(|b| b.get("id"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            name: block
                                .and_then(|b| b.get("name"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            arguments_delta: None,
                        });
                        let _ = app.emit("chat-stream", ev);
                    }
                }
                "content_block_delta" => {
                    let delta = parsed.get("delta");
                    let kind = delta.and_then(|d| d.get("type")).and_then(|v| v.as_str());
                    let mut ev = ChatStreamEvent::new(&request_id);
                    match kind {
                        Some("text_delta") => {
                            ev.delta = delta
                                .and_then(|d| d.get("text"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                        }
                        Some("thinking_delta") => {
                            ev.thinking_delta = delta
                                .and_then(|d| d.get("thinking"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                        }
                        Some("input_json_delta") => {
                            ev.tool_call_delta = Some(ToolCallDelta {
                                index: block_index,
                                id: None,
                                name: None,
                                arguments_delta: delta
                                    .and_then(|d| d.get("partial_json"))
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string()),
                            });
                        }
                        _ => continue,
                    }
                    let _ = app.emit("chat-stream", ev);
                }
                "message_delta" => {
                    if let Some(stop) = parsed
                        .get("delta")
                        .and_then(|d| d.get("stop_reason"))
                        .and_then(|v| v.as_str())
                    {
                        finish = Some(finish_reason_of(stop).to_string());
                    }
                    // message_delta 的 usage 只有 output_tokens，输入量在 message_start 里
                    if let Some(u) = usage_of(&parsed) {
                        usage = Some(match usage.take() {
                            Some(prev) => TokenUsage {
                                prompt_tokens: prev.prompt_tokens.max(u.prompt_tokens),
                                completion_tokens: u.completion_tokens,
                                total_tokens: prev.prompt_tokens.max(u.prompt_tokens)
                                    + u.completion_tokens,
                            },
                            None => u,
                        });
                    }
                }
                "message_start" => {
                    if let Some(u) = parsed.get("message").and_then(usage_of) {
                        usage = Some(u);
                    }
                }
                "error" => {
                    let msg = parsed
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("未知错误");
                    return emit_error(format!("Anthropic 返回错误: {msg}"));
                }
                "message_stop" => {
                    let mut ev = ChatStreamEvent::new(&request_id);
                    ev.done = true;
                    ev.finish_reason = finish.clone();
                    ev.usage = usage.clone();
                    let _ = app.emit("chat-stream", ev);
                    return;
                }
                _ => {}
            }
        }
    }

    // 流断在 message_stop 之前：照样补一个 done，否则前端会一直转圈
    let mut ev = ChatStreamEvent::new(&request_id);
    ev.done = true;
    ev.finish_reason = finish;
    ev.usage = usage;
    let _ = app.emit("chat-stream", ev);
}

/// 非流式：给 chat_complete（标题生成、压缩摘要等）用
pub async fn complete(request: &ChatStreamRequest, client: reqwest::Client) -> AppResult<String> {
    let (url, headers, body) = build_payload(request, false)?;
    let response = client
        .post(&url)
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::from(format!("请求失败: {e}")))?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(AppError::from(format!("HTTP {status}: {text}")));
    }
    let parsed: Value = response
        .json()
        .await
        .map_err(|e| AppError::from(format!("解析响应失败: {e}")))?;
    Ok(text_of(
        parsed.get("content").unwrap_or(&Value::Null),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: &str, content: &str) -> ChatStreamMessage {
        ChatStreamMessage {
            role: role.to_string(),
            content: json!(content),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    #[test]
    fn system_goes_to_top_level_not_messages() {
        let (system, messages) = convert_messages(&[msg("system", "你是助手"), msg("user", "在吗")]);
        assert_eq!(system, "你是助手");
        assert_eq!(messages.len(), 1, "system 不能留在 messages 里");
        assert_eq!(messages[0]["role"], "user");
    }

    #[test]
    fn tool_results_merge_into_one_user_message() {
        // 真实序列：user → assistant(两个工具调用) → tool → tool。
        // Anthropic 要求 user/assistant 严格交替，两条工具结果必须并成一条 user 消息，
        // 分成两条会被接口拒绝。
        let mut assistant = msg("assistant", "");
        assistant.tool_calls = Some(vec![
            json!({ "id": "call_1", "function": { "name": "Read", "arguments": "{}" } }),
            json!({ "id": "call_2", "function": { "name": "Read", "arguments": "{}" } }),
        ]);
        let mut a = msg("tool", "结果1");
        a.tool_call_id = Some("call_1".into());
        let mut b = msg("tool", "结果2");
        b.tool_call_id = Some("call_2".into());

        let (_, messages) = convert_messages(&[msg("user", "跑一下"), assistant, a, b]);
        assert_eq!(messages.len(), 3, "两条工具结果要并成一条 user 消息");
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[2]["role"], "user");
        let blocks = messages[2]["content"].as_array().unwrap();
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0]["type"], "tool_result");
        assert_eq!(blocks[0]["tool_use_id"], "call_1");
        assert_eq!(blocks[1]["tool_use_id"], "call_2");
    }

    #[test]
    fn assistant_tool_calls_become_tool_use_blocks_with_object_input() {
        let mut m = msg("assistant", "我查一下");
        m.tool_calls = Some(vec![json!({
            "id": "call_1",
            "function": { "name": "Read", "arguments": "{\"path\":\"a.txt\"}" }
        })]);
        let (_, messages) = convert_messages(&[m]);
        let blocks = messages[0]["content"].as_array().unwrap();
        assert_eq!(blocks[0]["type"], "text");
        assert_eq!(blocks[1]["type"], "tool_use");
        // OpenAI 是 JSON 字符串，Anthropic 要对象
        assert_eq!(blocks[1]["input"]["path"], "a.txt");
    }

    #[test]
    fn url_accepts_both_with_and_without_v1() {
        let mut req = ChatStreamRequest {
            request_id: "r".into(),
            provider_id: "p".into(),
            model: "claude-sonnet-4-5".into(),
            base_url: "https://api.anthropic.com".into(),
            api_key: Some("k".into()),
            thinking: None,
            stream: Some(true),
            messages: vec![msg("user", "hi")],
            temperature: None,
            max_tokens: None,
            top_p: None,
            frequency_penalty: None,
            presence_penalty: None,
            tools: None,
            tool_choice: None,
            protocol: Some(PROTOCOL.into()),
        };
        let (url, headers, body) = build_payload(&req, true).unwrap();
        assert_eq!(url, "https://api.anthropic.com/v1/messages");
        assert!(headers.contains_key("x-api-key"));
        assert_eq!(headers["anthropic-version"], ANTHROPIC_VERSION);
        // max_tokens 是必填，没给也要有默认值
        assert_eq!(body["max_tokens"], DEFAULT_MAX_TOKENS);

        req.base_url = "https://gw.example.com/v1".into();
        let (url, _, _) = build_payload(&req, true).unwrap();
        assert_eq!(url, "https://gw.example.com/v1/messages");
    }

    #[test]
    fn stop_reason_maps_to_finish_reason() {
        assert_eq!(finish_reason_of("tool_use"), "tool_calls");
        assert_eq!(finish_reason_of("end_turn"), "stop");
        assert_eq!(finish_reason_of("max_tokens"), "length");
    }
}
