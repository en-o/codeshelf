use super::ai::generate_dockerfile_with_ai;
use super::templates::generate_template;
use super::types::{
    DockerAiGenerateInput, DockerAiGenerateOutput, DockerBuildInput, DockerCommandResult,
    DockerContainerInfo, DockerImageInfo, DockerRunInput, DockerStatus,
};
use super::utils::{
    current_platform, project_root, resolve_existing_project_file, resolve_project_file,
    run_docker, walk_dockerfiles,
};
use crate::error::AppResult;
use serde_json::Value;
use std::fs;

fn label<'a>(labels: &'a Value, key: &str) -> Option<&'a str> {
    labels
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
}

fn compose_meta(
    container_id: &str,
) -> (Option<String>, Option<String>, Option<String>, Vec<String>) {
    let inspect = run_docker(&["inspect", container_id], None);
    if !inspect.success {
        return (None, None, None, Vec::new());
    }
    let Ok(value) = serde_json::from_str::<Value>(&inspect.stdout) else {
        return (None, None, None, Vec::new());
    };
    let labels = value
        .as_array()
        .and_then(|items| items.first())
        .and_then(|item| item.pointer("/Config/Labels"))
        .unwrap_or(&Value::Null);

    let project = label(labels, "com.docker.compose.project").map(str::to_string);
    let service = label(labels, "com.docker.compose.service").map(str::to_string);
    let working_dir = label(labels, "com.docker.compose.project.working_dir").map(str::to_string);
    let config_files = label(labels, "com.docker.compose.project.config_files")
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    (project, service, working_dir, config_files)
}

#[tauri::command]
#[specta::specta]
pub async fn docker_check_available() -> AppResult<DockerStatus> {
    let result = run_docker(&["--version"], None);
    if result.success {
        Ok(DockerStatus {
            available: true,
            version: Some(format!("{} ({})", result.stdout.trim(), current_platform())),
            error: None,
        })
    } else {
        Ok(DockerStatus {
            available: false,
            version: None,
            error: Some(result.stderr),
        })
    }
}

#[tauri::command]
#[specta::specta]
pub async fn docker_find_dockerfiles(project_path: String) -> AppResult<Vec<String>> {
    let root = project_root(&project_path)?;
    let mut out = Vec::new();
    walk_dockerfiles(&root, &root, &mut out, 0);
    out.sort();
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn docker_read_dockerfile(
    project_path: String,
    dockerfile_path: String,
) -> AppResult<String> {
    let root = project_root(&project_path)?;
    let full = resolve_existing_project_file(&root, &dockerfile_path)?;
    fs::read_to_string(full)
        .map_err(|e| crate::error::AppError::from(format!("读取 Dockerfile 失败: {}", e)))
}

#[tauri::command]
#[specta::specta]
pub async fn docker_write_dockerfile(
    project_path: String,
    dockerfile_path: String,
    content: String,
) -> AppResult<()> {
    let root = project_root(&project_path)?;
    let full = resolve_project_file(&root, &dockerfile_path)?;
    fs::write(full, content)
        .map_err(|e| crate::error::AppError::from(format!("写入 Dockerfile 失败: {}", e)))
}

#[tauri::command]
#[specta::specta]
pub async fn docker_generate_dockerfile_template(
    project_path: String,
    template: Option<String>,
) -> AppResult<String> {
    let root = project_root(&project_path)?;
    Ok(generate_template(&root, template.as_deref()))
}

#[tauri::command]
#[specta::specta]
pub async fn docker_generate_dockerfile_ai(
    input: DockerAiGenerateInput,
) -> AppResult<DockerAiGenerateOutput> {
    generate_dockerfile_with_ai(input).await
}

/// 镜像引用里是否**已经**带了 tag 或 digest。
///
/// 不能直接 `contains(':')`：registry 主机名可以带端口，
/// `localhost:5000/team/app` 里的冒号是端口，不是 tag ——
/// 误判成「已有 tag」会让用户填的 tag 被静默忽略，构建出错误的镜像。
///
/// 判定规则（对齐 Docker 的镜像引用语法）：
/// - 含 `@` → 带 digest（`name@sha256:...`），视为完整引用；
/// - 否则只看**最后一个 `/` 之后**的部分有没有 `:`。
///   registry 和端口一定在第一个 `/` 之前，所以这样切不会被端口干扰，
///   IPv6 形式 `[::1]:5000/team/app` 同理。
fn has_tag_or_digest(image: &str) -> bool {
    let image = image.trim();
    if image.contains('@') {
        return true;
    }
    let last_segment = match image.rfind('/') {
        Some(i) => &image[i + 1..],
        None => image,
    };
    last_segment.contains(':')
}

#[tauri::command]
#[specta::specta]
pub async fn docker_build_image(input: DockerBuildInput) -> AppResult<DockerCommandResult> {
    let root = project_root(&input.project_path)?;
    resolve_existing_project_file(&root, &input.dockerfile_path)?;
    let full_image = if has_tag_or_digest(&input.image_name) {
        input.image_name
    } else {
        format!(
            "{}:{}",
            input.image_name,
            input.tag.unwrap_or_else(|| "latest".into())
        )
    };
    let mut args = vec![
        "build",
        "-t",
        full_image.as_str(),
        "-f",
        input.dockerfile_path.as_str(),
    ];
    if input.no_cache.unwrap_or(false) {
        args.push("--no-cache");
    }
    args.push(".");
    Ok(run_docker(&args, Some(&root)))
}

#[tauri::command]
#[specta::specta]
pub async fn docker_list_images() -> AppResult<Vec<DockerImageInfo>> {
    let result = run_docker(&["image", "ls", "--format", "{{json .}}"], None);
    if !result.success {
        return Err(crate::error::AppError::from(result.stderr));
    }
    let mut out = Vec::new();
    for line in result.stdout.lines() {
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            out.push(DockerImageInfo {
                id: v["ID"].as_str().unwrap_or_default().to_string(),
                repository: v["Repository"].as_str().unwrap_or_default().to_string(),
                tag: v["Tag"].as_str().unwrap_or_default().to_string(),
                size: v["Size"].as_str().unwrap_or_default().to_string(),
                created_since: v["CreatedSince"].as_str().unwrap_or_default().to_string(),
            });
        }
    }
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn docker_remove_image(
    image: String,
    force: Option<bool>,
) -> AppResult<DockerCommandResult> {
    let mut args = vec!["rmi"];
    if force.unwrap_or(false) {
        args.push("-f");
    }
    args.push(image.as_str());
    Ok(run_docker(&args, None))
}

#[tauri::command]
#[specta::specta]
pub async fn docker_run_image(input: DockerRunInput) -> AppResult<DockerCommandResult> {
    let mut args = vec!["run", "-d"];
    if let Some(name) = input
        .container_name
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        args.push("--name");
        args.push(name);
    }
    let ports = input.ports.unwrap_or_default();
    for port in &ports {
        if !port.trim().is_empty() {
            args.push("-p");
            args.push(port);
        }
    }
    let env = input.env.unwrap_or_default();
    for item in &env {
        if !item.trim().is_empty() {
            args.push("-e");
            args.push(item);
        }
    }
    let volumes = input.volumes.unwrap_or_default();
    for volume in &volumes {
        if !volume.trim().is_empty() {
            args.push("-v");
            args.push(volume);
        }
    }
    if let Some(network) = input.network.as_deref().filter(|s| !s.trim().is_empty()) {
        args.push("--network");
        args.push(network);
    }
    if let Some(restart) = input.restart.as_deref().filter(|s| !s.trim().is_empty()) {
        args.push("--restart");
        args.push(restart);
    }
    if let Some(user) = input.user.as_deref().filter(|s| !s.trim().is_empty()) {
        args.push("-u");
        args.push(user);
    }
    if let Some(workdir) = input.workdir.as_deref().filter(|s| !s.trim().is_empty()) {
        args.push("-w");
        args.push(workdir);
    }
    if input.privileged.unwrap_or(false) {
        args.push("--privileged");
    }
    if input.read_only.unwrap_or(false) {
        args.push("--read-only");
    }
    let extra_args = input.extra_args.unwrap_or_default();
    for item in &extra_args {
        if !item.trim().is_empty() {
            args.push(item);
        }
    }
    args.push(input.image.as_str());
    let command_parts = input
        .command
        .as_deref()
        .unwrap_or("")
        .split_whitespace()
        .filter(|s| !s.trim().is_empty())
        .collect::<Vec<_>>();
    for part in command_parts {
        args.push(part);
    }
    Ok(run_docker(&args, None))
}

#[tauri::command]
#[specta::specta]
pub async fn docker_list_containers() -> AppResult<Vec<DockerContainerInfo>> {
    let result = run_docker(&["ps", "-a", "--format", "{{json .}}"], None);
    if !result.success {
        return Err(crate::error::AppError::from(result.stderr));
    }
    let mut out = Vec::new();
    for line in result.stdout.lines() {
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            let id = v["ID"].as_str().unwrap_or_default().to_string();
            let (compose_project, compose_service, compose_working_dir, compose_config_files) =
                compose_meta(&id);
            // 优先用 docker 给的 State 字段（running / exited / paused / ...）
            // 老版本 docker 没有 State，则从 Status 字符串推断
            let status_str = v["Status"].as_str().unwrap_or_default().to_string();
            let state = v["State"]
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| infer_state_from_status(&status_str));
            out.push(DockerContainerInfo {
                id,
                image: v["Image"].as_str().unwrap_or_default().to_string(),
                names: v["Names"].as_str().unwrap_or_default().to_string(),
                status: status_str,
                state,
                ports: v["Ports"].as_str().unwrap_or_default().to_string(),
                compose_project,
                compose_service,
                compose_working_dir,
                compose_config_files,
            });
        }
    }
    Ok(out)
}

/// 当 docker 版本太老不返回 State 时的兜底
fn infer_state_from_status(status: &str) -> String {
    let lower = status.to_lowercase();
    if lower.starts_with("up") {
        if lower.contains("paused") {
            "paused".to_string()
        } else {
            "running".to_string()
        }
    } else if lower.starts_with("exited") {
        "exited".to_string()
    } else if lower.starts_with("created") {
        "created".to_string()
    } else if lower.starts_with("restarting") {
        "restarting".to_string()
    } else if lower.starts_with("dead") {
        "dead".to_string()
    } else {
        "unknown".to_string()
    }
}

#[tauri::command]
#[specta::specta]
pub async fn docker_stop_container(container: String) -> AppResult<DockerCommandResult> {
    Ok(run_docker(&["stop", container.as_str()], None))
}

#[tauri::command]
#[specta::specta]
pub async fn docker_start_container(container: String) -> AppResult<DockerCommandResult> {
    Ok(run_docker(&["start", container.as_str()], None))
}

#[tauri::command]
#[specta::specta]
pub async fn docker_restart_container(container: String) -> AppResult<DockerCommandResult> {
    Ok(run_docker(&["restart", container.as_str()], None))
}

#[tauri::command]
#[specta::specta]
pub async fn docker_remove_container(
    container: String,
    force: Option<bool>,
) -> AppResult<DockerCommandResult> {
    let mut args = vec!["rm"];
    if force.unwrap_or(false) {
        args.push("-f");
    }
    args.push(container.as_str());
    Ok(run_docker(&args, None))
}

#[tauri::command]
#[specta::specta]
pub async fn docker_push_image(image: String) -> AppResult<DockerCommandResult> {
    Ok(run_docker(&["push", image.as_str()], None))
}

fn json_to_yaml(value: &Value, indent: usize) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(v) => v.to_string(),
        Value::Number(v) => v.to_string(),
        Value::String(v) => {
            if v.is_empty()
                || v.contains(':')
                || v.contains('#')
                || v.contains('\n')
                || v.contains('"')
                || v.contains('\'')
            {
                format!("{:?}", v)
            } else {
                v.to_string()
            }
        }
        Value::Array(items) => {
            if items.is_empty() {
                return "[]".to_string();
            }
            items
                .iter()
                .map(|item| {
                    let rendered = json_to_yaml(item, indent + 2);
                    if rendered.contains('\n') {
                        format!("{}- {}", " ".repeat(indent), rendered.trim_start())
                    } else {
                        format!("{}- {}", " ".repeat(indent), rendered)
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        Value::Object(map) => {
            if map.is_empty() {
                return "{}".to_string();
            }
            map.iter()
                .map(|(key, item)| {
                    let rendered = json_to_yaml(item, indent + 2);
                    if matches!(item, Value::Array(_) | Value::Object(_))
                        && rendered != "[]"
                        && rendered != "{}"
                    {
                        format!("{}{}:\n{}", " ".repeat(indent), key, rendered)
                    } else {
                        format!("{}{}: {}", " ".repeat(indent), key, rendered)
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn docker_inspect_container_yaml(container: String) -> AppResult<String> {
    let result = run_docker(&["inspect", container.as_str()], None);
    if !result.success {
        return Err(crate::error::AppError::from(result.stderr));
    }
    let value: Value = serde_json::from_str(&result.stdout)
        .map_err(|e| crate::error::AppError::from(format!("解析 docker inspect 失败: {}", e)))?;
    let first = value
        .as_array()
        .and_then(|items| items.first())
        .unwrap_or(&value);
    Ok(json_to_yaml(first, 0))
}

#[cfg(test)]
mod image_ref_tests {
    use super::has_tag_or_digest;

    #[test]
    fn registry_port_is_not_mistaken_for_a_tag() {
        // 带 registry 端口但**没有** tag —— 这正是原来 `contains(':')` 误判的情况，
        // 误判会导致用户填的 tag 被忽略
        assert!(!has_tag_or_digest("localhost:5000/team/app"));
        assert!(!has_tag_or_digest("registry.example.com:8443/a/b/c"));
        assert!(!has_tag_or_digest("[::1]:5000/team/app"));
        assert!(!has_tag_or_digest("[2001:db8::1]:5000/app"));

        // 带端口**且**带 tag
        assert!(has_tag_or_digest("localhost:5000/team/app:v1"));
        assert!(has_tag_or_digest("[::1]:5000/team/app:latest"));
    }

    #[test]
    fn plain_images_and_digests() {
        assert!(!has_tag_or_digest("nginx"));
        assert!(!has_tag_or_digest("library/nginx"));
        assert!(!has_tag_or_digest("ghcr.io/owner/repo"));

        assert!(has_tag_or_digest("nginx:1.25"));
        assert!(has_tag_or_digest("ghcr.io/owner/repo:main"));
        assert!(has_tag_or_digest(
            "nginx@sha256:0000000000000000000000000000000000000000000000000000000000000000"
        ));
        assert!(has_tag_or_digest(
            "localhost:5000/app@sha256:0000000000000000000000000000000000000000000000000000000000000000"
        ));
    }

    #[test]
    fn whitespace_is_ignored() {
        assert!(!has_tag_or_digest("  localhost:5000/team/app  "));
        assert!(has_tag_or_digest("  nginx:1.25  "));
    }
}
