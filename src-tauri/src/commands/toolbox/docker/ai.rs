use super::types::{DockerAiGenerateInput, DockerAiGenerateOutput};
use super::utils::{project_root, read_project_context, resolve_existing_project_file};
use crate::error::AppResult;
use serde_json::{json, Value};
use std::fs;
use std::time::Duration;

fn extract_dockerfile_content(text: &str) -> String {
    if let Some(start) = text.find("```") {
        let rest = &text[start + 3..];
        let rest = rest
            .strip_prefix("Dockerfile")
            .or_else(|| rest.strip_prefix("dockerfile"))
            .unwrap_or(rest)
            .trim_start_matches('\n');
        if let Some(end) = rest.find("```") {
            return rest[..end].trim().to_string();
        }
    }
    text.trim().to_string()
}

pub(super) async fn generate_dockerfile_with_ai(
    input: DockerAiGenerateInput,
) -> AppResult<DockerAiGenerateOutput> {
    let root = project_root(&input.project_path)?;
    let providers = crate::commands::settings::get_ai_providers().await?;
    let provider = if let Some(provider_id) = input
        .provider_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        providers
            .iter()
            .find(|p| p.id == provider_id)
            .ok_or_else(|| {
                crate::error::AppError::from(format!("未找到 AI 供应商: {}", provider_id))
            })?
    } else {
        providers
            .iter()
            .find(|p| p.enabled && p.is_default_provider)
            .or_else(|| providers.iter().find(|p| p.enabled))
            .ok_or_else(|| {
                crate::error::AppError::from(
                    "未配置可用的 AI 供应商，请先在 AI 供应商中启用模型".to_string(),
                )
            })?
    };
    let model = if let Some(model_id) = input.model_id.as_deref().filter(|s| !s.trim().is_empty()) {
        provider
            .models
            .iter()
            .find(|m| m.id == model_id)
            .ok_or_else(|| crate::error::AppError::from(format!("未找到 AI 模型: {}", model_id)))?
    } else {
        provider
            .models
            .iter()
            .find(|m| m.enabled && m.is_default)
            .or_else(|| provider.models.iter().find(|m| m.enabled))
            .ok_or_else(|| {
                crate::error::AppError::from("当前 AI 供应商没有启用的模型".to_string())
            })?
    };

    let dockerfile_path = input
        .dockerfile_path
        .unwrap_or_else(|| "Dockerfile".to_string());
    let existing = resolve_existing_project_file(&root, &dockerfile_path)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .unwrap_or_default();
    let prompt = format!(
        "你是资深 DevOps 工程师。请根据项目上下文生成一个生产可用 Dockerfile。\n\
         只返回 Dockerfile 内容，不要解释，不要 Markdown。\n\n\
         项目目录: {}\n\
         目标 Dockerfile: {}\n\
         目标镜像名: {}\n\n\
         现有 Dockerfile:\n{}\n\n\
         {}\n\n\
         要求:\n\
         1. 如果适合，使用多阶段构建。\n\
         2. 只复制必要文件，优先利用依赖缓存。\n\
         3. 使用合理的基础镜像和生产启动命令。\n\
         4. 暴露项目最可能使用的端口。\n\
         5. 兼容 Docker Desktop 在 Windows/macOS 的常规构建方式，避免依赖宿主机绝对路径。\n\
         6. 不要包含解释文字。",
        root.display(),
        dockerfile_path,
        input.image_name.unwrap_or_else(|| "<未设置>".into()),
        if existing.trim().is_empty() {
            "<无>"
        } else {
            existing.as_str()
        },
        read_project_context(&root)
    );

    crate::commands::chat_anthropic::reject_if_anthropic(
        provider.preset_key.as_deref(),
        "Dockerfile 生成",
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
        "stream": false
    }));
    if let Some(key) = provider.api_key.as_ref() {
        if !key.trim().is_empty() {
            req = req.bearer_auth(key);
        }
    }
    let resp = req
        .send()
        .await
        .map_err(|e| crate::error::AppError::from(format!("AI 请求失败: {}", e)))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(crate::error::AppError::from(format!(
            "AI {}: {}",
            status, text
        )));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| crate::error::AppError::from(format!("AI 响应解析失败: {}", e)))?;
    let content = body
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if content.is_empty() {
        return Err("AI 未返回 Dockerfile 内容".into());
    }

    Ok(DockerAiGenerateOutput {
        content: extract_dockerfile_content(content),
        provider_name: provider.name.clone(),
        model_name: model.model.clone(),
    })
}
