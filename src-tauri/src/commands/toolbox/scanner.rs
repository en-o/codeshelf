// 端口扫描模块 - 支持并发扫描、超时控制、进度回调

use super::{common_ports, port_service_name, ScanConfig, ScanResult};
use std::net::{IpAddr, SocketAddr};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio::time::timeout;

/// 全局扫描取消标志
static SCAN_CANCELLED: AtomicBool = AtomicBool::new(false);

/// 扫描端口
#[tauri::command]
pub async fn scan_ports(config: ScanConfig) -> Result<Vec<ScanResult>, String> {
    // 重置取消标志
    SCAN_CANCELLED.store(false, Ordering::SeqCst);

    // 解析目标 IP
    let target_ip = IpAddr::from_str(&config.target)
        .map_err(|_| format!("无效的 IP 地址: {}", config.target))?;

    // 确定要扫描的端口
    let ports = determine_ports(&config);

    // 配置参数
    let timeout_ms = config.timeout_ms.unwrap_or(3000);
    let concurrency = config.concurrency.unwrap_or(100);

    // 执行并发扫描
    let results = concurrent_scan(target_ip, ports, timeout_ms, concurrency).await?;

    Ok(results)
}

/// 停止扫描
#[tauri::command]
pub async fn stop_scan() -> Result<(), String> {
    SCAN_CANCELLED.store(true, Ordering::SeqCst);
    Ok(())
}

/// 获取常用端口列表
#[tauri::command]
pub async fn get_common_ports() -> Result<Vec<u16>, String> {
    Ok(common_ports())
}

/// 确定要扫描的端口列表
fn determine_ports(config: &ScanConfig) -> Vec<u16> {
    // 优先使用指定的端口列表
    if let Some(ref ports) = config.ports {
        if !ports.is_empty() {
            return ports.clone();
        }
    }

    // 其次使用端口范围
    if let (Some(start), Some(end)) = (config.port_start, config.port_end) {
        if start <= end {
            return (start..=end).collect();
        }
    }

    // 默认使用常用端口
    common_ports()
}

/// 并发扫描端口
async fn concurrent_scan(
    target: IpAddr,
    ports: Vec<u16>,
    timeout_ms: u64,
    concurrency: usize,
) -> Result<Vec<ScanResult>, String> {
    let results = Arc::new(Mutex::new(Vec::new()));
    let _total = ports.len();
    let scanned = Arc::new(AtomicU32::new(0));

    // 使用信号量控制并发
    let semaphore = Arc::new(tokio::sync::Semaphore::new(concurrency));
    let mut handles = Vec::new();

    for port in ports {
        // 检查是否被取消
        if SCAN_CANCELLED.load(Ordering::SeqCst) {
            break;
        }

        let sem = semaphore.clone();
        let results = results.clone();
        let scanned = scanned.clone();
        let timeout_duration = Duration::from_millis(timeout_ms);

        let handle = tokio::spawn(async move {
            // 获取信号量许可
            let _permit = sem.acquire().await.ok()?;

            // 检查是否被取消
            if SCAN_CANCELLED.load(Ordering::SeqCst) {
                return None;
            }

            // 扫描端口
            let addr = SocketAddr::new(target, port);
            let is_open = match timeout(timeout_duration, TcpStream::connect(addr)).await {
                Ok(Ok(_)) => true,
                _ => false,
            };

            // 更新进度
            scanned.fetch_add(1, Ordering::SeqCst);

            // 只记录开放的端口
            if is_open {
                let result = ScanResult {
                    ip: target.to_string(),
                    port,
                    status: "open".to_string(),
                    service: port_service_name(port).map(|s| s.to_string()),
                };
                results.lock().await.push(result.clone());
                Some(result)
            } else {
                None
            }
        });

        handles.push(handle);
    }

    // 等待所有任务完成
    for handle in handles {
        let _ = handle.await;
    }

    // 返回结果
    let final_results = results.lock().await.clone();

    // 按端口号排序
    let mut sorted_results = final_results;
    sorted_results.sort_by_key(|r| r.port);

    Ok(sorted_results)
}

/// 扫描单个端口（用于快速检测）
#[tauri::command]
pub async fn check_port(
    target: String,
    port: u16,
    timeout_ms: Option<u64>,
) -> Result<ScanResult, String> {
    let target_ip =
        IpAddr::from_str(&target).map_err(|_| format!("无效的 IP 地址: {}", target))?;

    let timeout_duration = Duration::from_millis(timeout_ms.unwrap_or(3000));
    let addr = SocketAddr::new(target_ip, port);

    let status = match timeout(timeout_duration, TcpStream::connect(addr)).await {
        Ok(Ok(_)) => "open",
        Ok(Err(_)) => "closed",
        Err(_) => "filtered", // 超时
    };

    Ok(ScanResult {
        ip: target,
        port,
        status: status.to_string(),
        service: port_service_name(port).map(|s| s.to_string()),
    })
}

/// 扫描本地常用开发端口
#[tauri::command]
pub async fn scan_local_dev_ports() -> Result<Vec<ScanResult>, String> {
    let dev_ports = vec![
        3000, 3001, 4200, 5000, 5173, 5174, 8000, 8080, 8081, 8888, 9000,
    ];

    let config = ScanConfig {
        target: "127.0.0.1".to_string(),
        ports: Some(dev_ports),
        port_start: None,
        port_end: None,
        timeout_ms: Some(1000),
        concurrency: Some(50),
    };

    scan_ports(config).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_common_ports() {
        let ports = common_ports();
        assert!(!ports.is_empty());
        assert!(ports.contains(&80));
        assert!(ports.contains(&443));
    }

    #[tokio::test]
    async fn test_port_service_name() {
        assert_eq!(port_service_name(80), Some("HTTP"));
        assert_eq!(port_service_name(443), Some("HTTPS"));
        assert_eq!(port_service_name(22), Some("SSH"));
        assert_eq!(port_service_name(99999), None);
    }
}
