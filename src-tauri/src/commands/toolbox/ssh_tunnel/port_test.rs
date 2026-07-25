// 端口连通性测试命令：
//   - macOS / Linux: `nc -z -w 2 127.0.0.1 <port>` （-v 走 stderr，便于复刻 issue 里的输出）
//   - Windows: PowerShell `Test-NetConnection -ComputerName ... -Port ...`
//   - 命令缺失时回退到原生 TCP connect，行为一致

#[allow(unused_imports)]
use crate::error::AppResult;
use std::path::PathBuf;
#[allow(unused_imports)]
use std::process::Stdio;

#[allow(unused_imports)]
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use super::super::TestPortResult;
use super::{ensure_tunnels_loaded, SSH_TUNNELS};

const TEST_HOST: &str = "127.0.0.1";
const TEST_TIMEOUT_SECS: u64 = 3;

// Windows: 隐藏控制台窗口，避免打包后端口测试调用 PowerShell(Test-NetConnection) 时闪黑窗
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
#[specta::specta]
pub async fn test_ssh_tunnel(tunnel_id: String) -> AppResult<TestPortResult> {
    ensure_tunnels_loaded().await;
    let port = {
        let tunnels = SSH_TUNNELS.lock().await;
        tunnels.get(&tunnel_id).map(|t| t.local_port)
    };
    let port =
        port.ok_or_else(|| crate::error::AppError::from(format!("隧道不存在: {}", tunnel_id)))?;
    Ok(test_local_port_inner(port).await)
}

#[tauri::command]
#[specta::specta]
pub async fn test_local_port(port: u16) -> AppResult<TestPortResult> {
    Ok(test_local_port_inner(port).await)
}

async fn test_local_port_inner(port: u16) -> TestPortResult {
    let start = std::time::Instant::now();

    #[cfg(target_os = "windows")]
    let native = test_via_test_net_connection(TEST_HOST, port).await;

    #[cfg(not(target_os = "windows"))]
    let native = test_via_nc(TEST_HOST, port).await;

    let mut result = match native {
        Some(r) => r,
        None => test_via_tcp(TEST_HOST, port).await,
    };
    result.duration_ms = start.elapsed().as_millis() as u64;
    result
}

/// 兜底：纯 Rust TCP 连接，所有平台一致
async fn test_via_tcp(host: &str, port: u16) -> TestPortResult {
    let addr = format!("{}:{}", host, port);
    match timeout(
        Duration::from_secs(TEST_TIMEOUT_SECS),
        tokio::net::TcpStream::connect(&addr),
    )
    .await
    {
        Ok(Ok(_)) => TestPortResult {
            success: true,
            output: format!("Connection to {} port {} [tcp/*] succeeded!", host, port),
            method: "tcp".to_string(),
            duration_ms: 0,
        },
        Ok(Err(e)) => TestPortResult {
            success: false,
            output: format!("Connection to {} port {} failed: {}", host, port, e),
            method: "tcp".to_string(),
            duration_ms: 0,
        },
        Err(_) => TestPortResult {
            success: false,
            output: format!(
                "Connection to {} port {} timed out after {}s",
                host, port, TEST_TIMEOUT_SECS
            ),
            method: "tcp".to_string(),
            duration_ms: 0,
        },
    }
}

/// macOS / Linux: 用 nc -z -v -w
#[cfg(not(target_os = "windows"))]
async fn test_via_nc(host: &str, port: u16) -> Option<TestPortResult> {
    // 同步检测命令是否存在，避免 nc 不存在时的 spawn error 体验
    which_unix("nc")?;
    let output = match timeout(
        Duration::from_secs(TEST_TIMEOUT_SECS + 2),
        Command::new("nc")
            .args([
                "-z",
                "-v",
                "-w",
                &TEST_TIMEOUT_SECS.to_string(),
                host,
                &port.to_string(),
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    {
        Ok(Ok(o)) => o,
        Ok(Err(_)) => return None,
        Err(_) => {
            return Some(TestPortResult {
                success: false,
                output: format!("nc 超时（{}s）", TEST_TIMEOUT_SECS + 2),
                method: "nc".to_string(),
                duration_ms: 0,
            })
        }
    };

    // nc 把详细输出写到 stderr，stdout 通常为空
    let mut text = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if text.is_empty() {
        text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    }
    Some(TestPortResult {
        success: output.status.success(),
        output: if text.is_empty() {
            if output.status.success() {
                format!("nc -z {} {} → 成功", host, port)
            } else {
                format!("nc -z {} {} → 失败", host, port)
            }
        } else {
            text
        },
        method: "nc".to_string(),
        duration_ms: 0,
    })
}

/// Windows: PowerShell Test-NetConnection
#[cfg(target_os = "windows")]
async fn test_via_test_net_connection(host: &str, port: u16) -> Option<TestPortResult> {
    // 优先 pwsh（Win 11+ / PowerShell 7），回退 powershell
    let shell = if which_windows("pwsh.exe").is_some() {
        "pwsh.exe"
    } else if which_windows("powershell.exe").is_some() {
        "powershell.exe"
    } else {
        return None;
    };

    let script = format!(
        // 强制 PowerShell 把 stdout/stderr 都编成 UTF-8，
        // 否则中文 Windows 的 PowerShell 5 默认 console 编码是 GBK，
        // stderr 上任何中文错误（解析不到主机名等）会被 from_utf8_lossy 替换成 �
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
         $OutputEncoding=[System.Text.Encoding]::UTF8; \
         $ProgressPreference='SilentlyContinue'; \
         $r = Test-NetConnection -ComputerName '{}' -Port {} -InformationLevel Quiet -WarningAction SilentlyContinue; \
         if ($r) {{ Write-Output 'TcpTestSucceeded'; exit 0 }} else {{ Write-Output 'TcpTestFailed'; exit 1 }}",
        host, port
    );

    let output = match timeout(
        Duration::from_secs(TEST_TIMEOUT_SECS + 5),
        Command::new(shell)
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    {
        Ok(Ok(o)) => o,
        Ok(Err(_)) => return None,
        Err(_) => {
            return Some(TestPortResult {
                success: false,
                output: format!("Test-NetConnection 超时（{}s）", TEST_TIMEOUT_SECS + 5),
                method: "Test-NetConnection".to_string(),
                duration_ms: 0,
            })
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let success = output.status.success();
    let summary = if success {
        format!(
            "Test-NetConnection -ComputerName {} -Port {} → succeeded",
            host, port
        )
    } else {
        format!(
            "Test-NetConnection -ComputerName {} -Port {} → failed",
            host, port
        )
    };
    let combined = match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => summary,
        (false, true) => format!("{}\n{}", summary, stdout),
        (true, false) => format!("{}\n{}", summary, stderr),
        (false, false) => format!("{}\n{}\n{}", summary, stdout, stderr),
    };
    Some(TestPortResult {
        success,
        output: combined,
        method: "Test-NetConnection".to_string(),
        duration_ms: 0,
    })
}

/// 极简的 PATH 查找（Unix）：扫 PATH 里第一个可执行的同名文件
#[cfg(not(target_os = "windows"))]
fn which_unix(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if let Ok(meta) = std::fs::metadata(&candidate) {
            if meta.is_file() {
                use std::os::unix::fs::PermissionsExt;
                if meta.permissions().mode() & 0o111 != 0 {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

/// PATH 查找（Windows）
#[cfg(target_os = "windows")]
fn which_windows(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}
