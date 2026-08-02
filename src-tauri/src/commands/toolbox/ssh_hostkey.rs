// SSH 服务端身份验证 —— 正向隧道与反向隧道共用同一套策略。
//
// 之前两处 `check_server_key` 都直接 `Ok(true)`：任何中间人（恶意热点、DNS/ARP 劫持）
// 都能冒充服务端，拿到密码认证时的明文口令，并解密/篡改隧道里的全部流量。
//
// 策略（与 OpenSSH 一致，落在同一个 `~/.ssh/known_hosts`，用户可以用 ssh-keygen -R 审计和撤销）：
//   - 已记录且匹配        → 放行
//   - 已记录但**变了**    → 一律拒绝，不提供"继续"选项
//   - 没记录（首次连接）  → 拒绝，并让前端展示指纹由用户确认（TOFU），确认后写入 known_hosts
//
// 首次确认走两个命令：`ssh_probe_host_key` 只取指纹不认证，
// `ssh_trust_host_key` 重新探测并核对用户看到的那个指纹后才写入。

use crate::error::AppResult;
use russh::client;
use russh::keys::ssh_key::PublicKey;
use std::sync::{Arc, Mutex};

/// 校验结果。`Changed` 单列一档：它是主动攻击的信号，不能和"首次连接"混为一谈。
pub enum HostKeyVerdict {
    Known,
    Unknown,
    Changed,
}

pub fn verdict(host: &str, port: u16, key: &PublicKey) -> HostKeyVerdict {
    match russh::keys::check_known_hosts(host, port, key) {
        Ok(true) => HostKeyVerdict::Known,
        Ok(false) => HostKeyVerdict::Unknown,
        Err(russh::keys::Error::KeyChanged { .. }) => HostKeyVerdict::Changed,
        // known_hosts 读不出来（首次使用、无 HOME）时按"未记录"处理，
        // 走 TOFU 确认流程，而不是静默放行。
        Err(_) => HostKeyVerdict::Unknown,
    }
}

/// 两个 handler 共用的判定：只有 `Known` 放行，其余一律拒绝并留下可诊断日志。
pub fn accept_server_key(host: &str, port: u16, key: &PublicKey) -> bool {
    match verdict(host, port, key) {
        HostKeyVerdict::Known => true,
        HostKeyVerdict::Unknown => {
            log::warn!(
                "拒绝连接 {}:{}：主机密钥未记录（指纹 {}）。请在界面确认指纹后再连接。",
                host,
                port,
                fingerprint(key)
            );
            false
        }
        HostKeyVerdict::Changed => {
            log::error!(
                "拒绝连接 {}:{}：主机密钥已变更（当前指纹 {}）。可能是中间人攻击；\
                 确认服务端确实换过密钥后，用 `ssh-keygen -R \"[{}]:{}\"` 清除旧记录。",
                host,
                port,
                fingerprint(key),
                host,
                port
            );
            false
        }
    }
}

pub fn fingerprint(key: &PublicKey) -> String {
    key.fingerprint(Default::default()).to_string()
}

/// 主机密钥被拒时，russh 只会抛一个泛化的握手错误。
/// 这里补一句可执行的提示，并带上前端识别用的标记 —— 否则用户只看到"SSH 连接失败"。
pub const HOSTKEY_ERROR_MARKER: &str = "HOSTKEY_NOT_TRUSTED";

/// 这类错误需要用户先确认，自动重连无法自行恢复，调用方应立即返回给界面。
pub fn needs_user_confirmation(error: &str) -> bool {
    error.contains(HOSTKEY_ERROR_MARKER)
}

pub fn describe_connect_error(host: &str, port: u16, raw: &str) -> String {
    // 握手在 check_server_key 返回 false 后失败；此时 known_hosts 里要么没有记录、要么记录不匹配
    let unverified = match russh::keys::known_hosts::known_host_keys(host, port) {
        Ok(keys) => keys.is_empty(),
        Err(_) => true,
    };
    if unverified {
        format!(
            "SSH 连接失败: {}（若是首次连接 {}:{}，需要先确认主机密钥指纹）[{}]",
            raw, host, port, HOSTKEY_ERROR_MARKER
        )
    } else {
        format!("SSH 连接失败: {}", raw)
    }
}

// ============== 首次确认（TOFU） ==============

/// 只用来取服务端公钥的一次性 handler：拿到 key 后返回 false 中断握手，
/// 全程不发送任何凭据。
struct ProbeClient(Arc<Mutex<Option<PublicKey>>>);

impl client::Handler for ProbeClient {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &PublicKey) -> Result<bool, Self::Error> {
        if let Ok(mut slot) = self.0.lock() {
            *slot = Some(key.clone());
        }
        Ok(false)
    }
}

async fn probe(host: &str, port: u16) -> AppResult<PublicKey> {
    let slot = Arc::new(Mutex::new(None));
    let config = Arc::new(client::Config::default());
    // 握手会因为我们返回 false 而失败，这里只关心有没有拿到 key
    let _ = client::connect(config, (host, port), ProbeClient(slot.clone())).await;
    let key = slot
        .lock()
        .ok()
        .and_then(|mut s| s.take())
        .ok_or_else(|| {
            crate::error::AppError::from(format!("无法连接 {}:{} 获取主机密钥", host, port))
        })?;
    Ok(key)
}

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SshHostKeyInfo {
    /// "known" | "unknown" | "changed"
    pub status: String,
    pub fingerprint: String,
    pub algorithm: String,
    pub host: String,
    pub port: u16,
}

/// 探测主机密钥并返回指纹与状态。不发送任何凭据。
#[tauri::command]
#[specta::specta]
pub async fn ssh_probe_host_key(host: String, port: u16) -> AppResult<SshHostKeyInfo> {
    let key = probe(&host, port).await?;
    let status = match verdict(&host, port, &key) {
        HostKeyVerdict::Known => "known",
        HostKeyVerdict::Unknown => "unknown",
        HostKeyVerdict::Changed => "changed",
    };
    Ok(SshHostKeyInfo {
        status: status.to_string(),
        fingerprint: fingerprint(&key),
        algorithm: key.algorithm().to_string(),
        host,
        port,
    })
}

/// 把主机密钥写入 `~/.ssh/known_hosts`。
///
/// 必须带上用户在界面上看到的那个指纹：这里重新探测一次并比对，
/// 避免"展示 A 的指纹、信任了 B 的密钥"。
/// 已记录但发生变更的主机不走这里 —— 变更必须由用户在 known_hosts 里显式清除。
#[tauri::command]
#[specta::specta]
pub async fn ssh_trust_host_key(
    host: String,
    port: u16,
    expected_fingerprint: String,
) -> AppResult<()> {
    let key = probe(&host, port).await?;
    let actual = fingerprint(&key);
    if actual != expected_fingerprint {
        return Err(crate::error::AppError::from(format!(
            "指纹不一致，拒绝信任：界面显示 {}，实际 {}",
            expected_fingerprint, actual
        )));
    }
    if matches!(verdict(&host, port, &key), HostKeyVerdict::Changed) {
        return Err(crate::error::AppError::from(format!(
            "{}:{} 的主机密钥已变更，拒绝自动信任。确认服务端确实换过密钥后，\
             用 `ssh-keygen -R \"[{}]:{}\"` 清除旧记录再连接。",
            host, port, host, port
        )));
    }
    russh::keys::known_hosts::learn_known_hosts(&host, port, &key)
        .map_err(|e| crate::error::AppError::from(format!("写入 known_hosts 失败: {}", e)))
}
