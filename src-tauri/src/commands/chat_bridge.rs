//! OpenClaw 聊天桥接 poller
//!
//! 参考 Eye 项目的 AssistantSetting 设计（`chatBridgeEnabled` + `openclawRelayEndpoint`）。
//!
//! 工作流程：
//!   1. 启用后，后台任务每 N 秒 GET `{relay}/pending?clientId=<id>`；
//!   2. 对每条 pending 消息，用 `bridgeProviderId` + `bridgeModelId`
//!      （OpenAI 兼容协议）生成回复；
//!   3. POST `{relay}/reply` 带 `{id, clientId, content}`；失败的消息下次再拉。
//!
//! 中继服务协议（外部实现）：
//!   GET  /pending?clientId=<id>   → 200 JSON: [{id, content, channel?, userId?, createdAt?}, ...]
//!   POST /reply                   → body: {id, clientId, content} → 200 {}
//!   GET  /health                  → 200 {ok: true}

use crate::error::AppResult;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, RwLock};

use crate::storage::AppSettings;

const POLL_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct PendingMessage {
    id: String,
    content: String,
    #[serde(default)]
    channel: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
}

pub enum BridgeMsg {
    Reload,
}

pub struct BridgeHandle {
    pub tx: mpsc::Sender<BridgeMsg>,
}

fn load_settings_sync() -> Option<AppSettings> {
    let config = crate::storage::get_storage_config().ok()?;
    let path = config.app_settings_file();
    if !path.exists() {
        return Some(AppSettings::default());
    }
    let content = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str::<AppSettings>(&content).ok()
}

async fn fetch_pending(
    client: &reqwest::Client,
    relay: &str,
    client_id: &str,
) -> AppResult<Vec<PendingMessage>> {
    let url = format!(
        "{}/pending?clientId={}",
        relay.trim_end_matches('/'),
        urlencoding::encode(client_id)
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| crate::error::AppError::from(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(crate::error::AppError::from(format!(
            "relay {} returned {}",
            url,
            resp.status()
        )));
    }
    resp.json::<Vec<PendingMessage>>()
        .await
        .map_err(|e| crate::error::AppError::from(format!("解析 pending 失败: {}", e)))
}

async fn post_reply(
    client: &reqwest::Client,
    relay: &str,
    client_id: &str,
    id: &str,
    content: &str,
) -> AppResult<()> {
    let url = format!("{}/reply", relay.trim_end_matches('/'));
    let resp = client
        .post(&url)
        .json(&json!({"id": id, "clientId": client_id, "content": content}))
        .send()
        .await
        .map_err(|e| crate::error::AppError::from(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(crate::error::AppError::from(format!(
            "reply {} returned {}",
            url,
            resp.status()
        )));
    }
    Ok(())
}

async fn run_llm(provider_id: &str, model_id: &str, prompt: &str) -> AppResult<String> {
    let providers = crate::commands::settings::get_ai_providers().await?;
    let provider = providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| crate::error::AppError::from(format!("provider 未找到: {}", provider_id)))?;
    let model = provider
        .models
        .iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| crate::error::AppError::from(format!("model 未找到: {}", model_id)))?;
    crate::commands::chat_anthropic::reject_if_anthropic(
        provider.preset_key.as_deref(),
        "聊天桥接",
    )?;
    let url = format!(
        "{}/chat/completions",
        provider.base_url.trim_end_matches('/')
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| crate::error::AppError::from(e.to_string()))?;
    let mut req = client.post(&url).json(&json!({
        "model": model.model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": false,
    }));
    if let Some(key) = provider.api_key.as_ref() {
        if !key.trim().is_empty() {
            req = req.bearer_auth(key);
        }
    }
    let resp = req
        .send()
        .await
        .map_err(|e| crate::error::AppError::from(format!("LLM 请求失败: {}", e)))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(crate::error::AppError::from(format!(
            "LLM {}: {}",
            status, text
        )));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| crate::error::AppError::from(e.to_string()))?;
    Ok(body
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string())
}

async fn tick(app: &AppHandle, settings: &AppSettings) {
    let relay = match settings.openclaw_relay_endpoint.as_deref() {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => return,
    };
    let provider_id = match settings.bridge_provider_id.as_deref() {
        Some(s) if !s.is_empty() => s,
        _ => return,
    };
    let model_id = match settings.bridge_model_id.as_deref() {
        Some(s) if !s.is_empty() => s,
        _ => return,
    };
    let client_id = settings
        .bridge_client_id
        .as_deref()
        .unwrap_or("codeshelf")
        .to_string();

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(_) => return,
    };

    let pending = match fetch_pending(&client, &relay, &client_id).await {
        Ok(list) => list,
        Err(e) => {
            let _ = app.emit("chat-bridge-event", json!({"kind": "error", "message": e}));
            return;
        }
    };
    if pending.is_empty() {
        return;
    }

    for msg in pending {
        let _ = app.emit(
            "chat-bridge-event",
            json!({"kind": "inbound", "id": msg.id, "content": msg.content}),
        );
        let reply = match run_llm(provider_id, model_id, &msg.content).await {
            Ok(v) => v,
            Err(e) => format!("（桥接回复生成失败：{}）", e),
        };
        match post_reply(&client, &relay, &client_id, &msg.id, &reply).await {
            Ok(_) => {
                let _ = app.emit(
                    "chat-bridge-event",
                    json!({"kind": "outbound", "id": msg.id, "content": reply}),
                );
            }
            Err(e) => {
                let _ = app.emit(
                    "chat-bridge-event",
                    json!({"kind": "error", "message": format!("回复失败: {}", e)}),
                );
            }
        }
    }
}

pub fn spawn_bridge(app: AppHandle) -> BridgeHandle {
    let (tx, mut rx) = mpsc::channel::<BridgeMsg>(8);
    let tx_tick = tx.clone();
    // 定时滴答推送 Reload，让主循环自然 poll；也支持外部 Reload 打断 sleep
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(POLL_INTERVAL).await;
            if tx_tick.send(BridgeMsg::Reload).await.is_err() {
                break;
            }
        }
    });
    tauri::async_runtime::spawn(async move {
        while let Some(_msg) = rx.recv().await {
            let settings = match load_settings_sync() {
                Some(s) if s.chat_bridge_enabled => s,
                _ => continue,
            };
            tick(&app, &settings).await;
        }
    });
    BridgeHandle { tx }
}

pub async fn notify_reload(app: &AppHandle) {
    if let Some(h) = app.try_state::<Arc<RwLock<BridgeHandle>>>() {
        let guard = h.read().await;
        let _ = guard.tx.send(BridgeMsg::Reload).await;
    }
}

// ========== Tauri 命令 ==========

#[tauri::command]
#[specta::specta]
pub async fn chat_bridge_test(relay: String) -> AppResult<String> {
    let url = format!("{}/health", relay.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| crate::error::AppError::from(e.to_string()))?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| crate::error::AppError::from(format!("请求失败: {}", e)))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    Ok(format!(
        "HTTP {}: {}",
        status.as_u16(),
        text.chars().take(500).collect::<String>()
    ))
}
