// Session CRUD

use crate::error::AppResult;
use std::fs;

use serde::{Deserialize, Serialize};

use crate::storage::{current_iso_time, generate_id, ApiChatSession, ApiChatSessionSummary};

use super::{session_path, sessions_dir};

#[tauri::command]
#[specta::specta]
pub async fn list_api_chat_sessions() -> AppResult<Vec<ApiChatSessionSummary>> {
    let dir = sessions_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out: Vec<ApiChatSessionSummary> = Vec::new();
    for entry in fs::read_dir(&dir)
        .map_err(|e| crate::error::AppError::from(format!("读取会话目录失败: {}", e)))?
    {
        let entry =
            entry.map_err(|e| crate::error::AppError::from(format!("读取会话文件失败: {}", e)))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let content = fs::read_to_string(&path)
            .map_err(|e| crate::error::AppError::from(format!("读取会话失败: {}", e)))?;
        let session: ApiChatSession = match serde_json::from_str(&content) {
            Ok(s) => s,
            Err(_) => continue,
        };
        out.push(ApiChatSessionSummary {
            id: session.id,
            title: session.title,
            provider_id: session.provider_id,
            model_id: session.model_id,
            created_at: session.created_at,
            updated_at: session.updated_at,
            message_count: session.messages.len(),
            endpoint_count: session.selected_endpoint_ids.len(),
            pinned: session.pinned,
        });
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn get_api_chat_session(session_id: String) -> AppResult<ApiChatSession> {
    let dir = sessions_dir()?;
    let path = session_path(&dir, &session_id);
    if !path.exists() {
        return Err("会话不存在".into());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::from(format!("读取会话失败: {}", e)))?;
    serde_json::from_str(&content)
        .map_err(|e| crate::error::AppError::from(format!("解析会话失败: {}", e)))
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateApiChatSessionInput {
    pub title: Option<String>,
    pub provider_id: String,
    pub model_id: String,
    #[serde(default)]
    pub selected_endpoint_ids: Vec<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn create_api_chat_session(
    input: CreateApiChatSessionInput,
) -> AppResult<ApiChatSession> {
    let dir = sessions_dir()?;
    fs::create_dir_all(&dir)
        .map_err(|e| crate::error::AppError::from(format!("创建会话目录失败: {}", e)))?;
    let now = current_iso_time();
    let session = ApiChatSession {
        id: generate_id(),
        title: input.title.unwrap_or_else(|| "新接口对话".to_string()),
        provider_id: input.provider_id,
        model_id: input.model_id,
        created_at: now.clone(),
        updated_at: now,
        messages: Vec::new(),
        selected_endpoint_ids: input.selected_endpoint_ids,
        system_prompt: None,
        temperature: None,
        max_tokens: None,
        top_p: None,
        frequency_penalty: None,
        presence_penalty: None,
        pinned: None,
    };
    save_api_chat_session(session.clone()).await?;
    Ok(session)
}

#[tauri::command]
#[specta::specta]
pub async fn save_api_chat_session(mut session: ApiChatSession) -> AppResult<ApiChatSession> {
    let dir = sessions_dir()?;
    fs::create_dir_all(&dir)
        .map_err(|e| crate::error::AppError::from(format!("创建会话目录失败: {}", e)))?;
    session.updated_at = current_iso_time();
    let path = session_path(&dir, &session.id);
    let content = serde_json::to_string_pretty(&session)
        .map_err(|e| crate::error::AppError::from(format!("序列化会话失败: {}", e)))?;
    crate::storage::write_atomic(&path, content)
        .map_err(|e| crate::error::AppError::from(format!("保存会话失败: {}", e)))?;
    Ok(session)
}

#[tauri::command]
#[specta::specta]
pub async fn rename_api_chat_session(
    session_id: String,
    title: String,
) -> AppResult<ApiChatSession> {
    let mut session = get_api_chat_session(session_id).await?;
    session.title = title;
    save_api_chat_session(session).await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_api_chat_session(session_id: String) -> AppResult<()> {
    let dir = sessions_dir()?;
    let path = session_path(&dir, &session_id);
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| crate::error::AppError::from(format!("删除会话失败: {}", e)))?;
    }
    Ok(())
}
