// SSH 认证：解析 ~/.ssh/config、列出 host 别名、connect + authenticate

use crate::error::AppResult;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use russh::client;
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};
use tokio::time::Duration;

use super::super::{SshAuthMethod, SshTunnel};
use super::SshClient;

/// 解析 ~/.ssh/config 中某个 Host 别名，返回 (user, host, port, identity_files)
fn resolve_ssh_config(alias: &str) -> AppResult<(String, String, u16, Vec<PathBuf>)> {
    let cfg = russh_config::parse_home(alias)
        .map_err(|e| crate::error::AppError::from(format!("解析 ~/.ssh/config 失败: {}", e)))?;
    let user = cfg.user();
    let host = cfg.host().to_string();
    let port = cfg.port();
    let identity_files = cfg.host_config.identity_file.unwrap_or_default();
    Ok((user, host, port, identity_files))
}

/// 列出 ~/.ssh/config 中的 Host 别名（用于前端下拉）
pub(super) fn list_host_aliases_from_config() -> Vec<String> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return vec![],
    };
    let path = home.join(".ssh").join("config");
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut aliases: Vec<String> = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let mut parts = trimmed.splitn(2, char::is_whitespace);
        let key = parts.next().unwrap_or("").to_lowercase();
        if key != "host" {
            continue;
        }
        let value = parts.next().unwrap_or("").trim();
        for pattern in value.split_whitespace() {
            // 跳过通配符 (eg "*", "*.example.com")
            if pattern.contains('*') || pattern.contains('?') || pattern.starts_with('!') {
                continue;
            }
            if !aliases.iter().any(|a| a == pattern) {
                aliases.push(pattern.to_string());
            }
        }
    }
    aliases
}

/// 连接 SSH 并完成认证，返回 client handle
pub(super) async fn connect_and_authenticate(
    tunnel: &SshTunnel,
) -> AppResult<client::Handle<SshClient>> {
    let config = Arc::new(client::Config {
        // None = 不做 inactivity 检测；保活由 keepalive_interval 负责。
        // 之前误用 Some(Duration::from_secs(0)) 反而会"0 秒后超时"，立刻断开。
        inactivity_timeout: None,
        // 10s 间隔 × 3 次未响应 ≈ 30s 内判定死连接，作为自动重连的兜底信号
        // （监督任务还会用 is_closed()/通道探测更快发现断线）。
        keepalive_interval: Some(Duration::from_secs(10)),
        keepalive_max: 3,
        ..<_>::default()
    });

    let (effective_user, effective_host, effective_port, identity_files) = match &tunnel.auth {
        SshAuthMethod::SshConfig { host_alias } => resolve_ssh_config(host_alias)?,
        _ => (
            tunnel.ssh_user.clone(),
            tunnel.ssh_host.clone(),
            tunnel.ssh_port,
            vec![],
        ),
    };

    if effective_user.is_empty() {
        return Err(crate::error::AppError::from(
            "SSH 用户名不能为空".to_string(),
        ));
    }
    if effective_host.is_empty() {
        return Err(crate::error::AppError::from("SSH 主机不能为空".to_string()));
    }

    log::info!(
        "SSH 连接 {}@{}:{}",
        effective_user,
        effective_host,
        effective_port
    );

    let handler = SshClient {
        host: effective_host.clone(),
        port: effective_port,
    };
    let mut session = client::connect(config, (effective_host.as_str(), effective_port), handler)
        .await
        .map_err(|e| {
            crate::error::AppError::from(crate::commands::toolbox::ssh_hostkey::describe_connect_error(
                &effective_host,
                effective_port,
                &e.to_string(),
            ))
        })?;

    let success = match &tunnel.auth {
        SshAuthMethod::Password { password } => session
            .authenticate_password(&effective_user, password)
            .await
            .map_err(|e| crate::error::AppError::from(format!("SSH 密码认证失败: {}", e)))?
            .success(),

        SshAuthMethod::Key {
            key_path,
            passphrase,
        } => {
            let pp = passphrase.as_deref().filter(|s| !s.is_empty());
            let key = load_secret_key(key_path, pp).map_err(|e| {
                crate::error::AppError::from(format!("加载私钥失败 ({}): {}", key_path, e))
            })?;
            let hash = session
                .best_supported_rsa_hash()
                .await
                .map_err(|e| crate::error::AppError::from(format!("协商 RSA hash 失败: {}", e)))?
                .flatten();
            session
                .authenticate_publickey(
                    &effective_user,
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                )
                .await
                .map_err(|e| crate::error::AppError::from(format!("SSH 私钥认证失败: {}", e)))?
                .success()
        }

        SshAuthMethod::SshConfig { host_alias } => {
            if identity_files.is_empty() {
                return Err(crate::error::AppError::from(format!(
                    "~/.ssh/config 中 Host '{}' 未配置 IdentityFile",
                    host_alias
                )));
            }
            let mut last_err: Option<String> = None;
            let mut authed = false;
            for path in &identity_files {
                let path_str = path.to_string_lossy().to_string();
                let key = match load_secret_key(path, None) {
                    Ok(k) => k,
                    Err(e) => {
                        last_err = Some(format!("加载私钥 {} 失败: {}", path_str, e));
                        continue;
                    }
                };
                let hash = session
                    .best_supported_rsa_hash()
                    .await
                    .map_err(|e| {
                        crate::error::AppError::from(format!("协商 RSA hash 失败: {}", e))
                    })?
                    .flatten();
                let res = session
                    .authenticate_publickey(
                        &effective_user,
                        PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                    )
                    .await
                    .map_err(|e| {
                        crate::error::AppError::from(format!(
                            "SSH 私钥认证失败 ({}): {}",
                            path_str, e
                        ))
                    })?;
                if res.success() {
                    authed = true;
                    break;
                } else {
                    last_err = Some(format!("私钥 {} 认证被拒绝", path_str));
                }
            }
            if !authed {
                return Err(crate::error::AppError::from(
                    last_err.unwrap_or_else(|| "所有 IdentityFile 认证均失败".to_string()),
                ));
            }
            true
        }
    };

    if !success {
        return Err(crate::error::AppError::from("SSH 认证被拒绝".to_string()));
    }

    Ok(session)
}
