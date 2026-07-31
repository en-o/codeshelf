//! 网络环境诊断（第一阶段：本机诊断）。
//!
//! 对应 `docs/specs/20260730-01-网络环境一致性检测整合评估.md` 的第一阶段。
//!
//! 边界（spec 明确要求，不要越过）：
//! - 本地模式**只描述**本机地址、路由和配置的 DNS，**不声称**已验证公网 IPv4/IPv6
//!   出口或 DNS 递归路径 —— 那需要公网观察点，属于第二阶段；
//! - 不展示总风险分，只给问题清单 + 状态 + 检测覆盖率；
//! - 不自动修改任何系统网络设置；
//! - 需要浏览器环境的检查一律通过 `open_url` 打开**固定** HTTPS 地址，
//!   不在 WebView 里做指纹结论（WebView 不是用户的真实浏览器）。

pub mod connectivity;
pub mod history;
pub mod local;
pub mod redact;
pub mod types;

use crate::error::AppResult;
use std::time::Duration;

/// 单个目标的检测超时上限。超过这个值的等待对排障没有额外价值，
/// 只会让用户以为程序卡死。
const CHECK_TIMEOUT: Duration = Duration::from_secs(15);

/// 跑一次本机诊断。
///
/// 纯本地操作，**不产生任何远程请求** —— 用户点开工具页时可以先跑这个，
/// 需要联网的检测由 `netdiag_check_services` 单独触发（spec：进入工具页不自动访问第三方服务）。
#[tauri::command]
#[specta::specta]
pub async fn netdiag_local() -> AppResult<local::LocalDiagnostics> {
    // 平台命令是阻塞的，丢到阻塞线程池
    tokio::task::spawn_blocking(local::collect)
        .await
        .map_err(|e| crate::error::AppError::from(format!("本机诊断任务调度失败: {}", e)))
}

/// 内置的开发服务列表，供前端展示与合并用户自定义项。
#[tauri::command]
#[specta::specta]
pub fn netdiag_default_targets() -> Vec<connectivity::ServiceTarget> {
    connectivity::default_targets()
}

/// 检查开发服务连通性。**会产生真实网络请求**，必须由用户主动触发。
#[tauri::command]
#[specta::specta]
pub async fn netdiag_check_services(
    targets: Vec<connectivity::ServiceTarget>,
) -> AppResult<Vec<connectivity::ServiceCheck>> {
    // 只允许 HTTPS 且必须能解析出主机名：避免把这个命令变成任意地址探测器
    for t in &targets {
        let url = reqwest::Url::parse(&t.url)
            .map_err(|e| crate::error::AppError::from(format!("目标地址无效 {}: {}", t.url, e)))?;
        if url.scheme() != "https" {
            return Err(crate::error::AppError::from(format!(
                "只允许 https 目标，收到: {}",
                t.url
            )));
        }
        if url.host_str().is_none() {
            return Err(crate::error::AppError::from(format!(
                "目标地址缺少主机名: {}",
                t.url
            )));
        }
    }
    Ok(connectivity::check_all(targets, CHECK_TIMEOUT).await)
}

#[tauri::command]
#[specta::specta]
pub async fn netdiag_save_snapshot(
    label: String,
    payload: String,
) -> AppResult<history::NetDiagSnapshot> {
    history::save(label, payload).await
}

#[tauri::command]
#[specta::specta]
pub async fn netdiag_list_snapshots() -> AppResult<Vec<history::NetDiagSnapshotSummary>> {
    history::list().await
}

#[tauri::command]
#[specta::specta]
pub async fn netdiag_get_snapshot(id: String) -> AppResult<history::NetDiagSnapshot> {
    history::get(id).await
}

#[tauri::command]
#[specta::specta]
pub async fn netdiag_delete_snapshot(id: String) -> AppResult<()> {
    history::delete(id).await
}

#[tauri::command]
#[specta::specta]
pub async fn netdiag_clear_snapshots() -> AppResult<()> {
    history::clear().await
}
