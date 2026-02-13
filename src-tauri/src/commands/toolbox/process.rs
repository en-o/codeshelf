// 进程查询模块 - 跨平台支持、端口查询、进程管理

use super::{ProcessFilter, ProcessInfo};
use std::collections::HashMap;
use sysinfo::{Pid, ProcessStatus, System};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// Windows: CREATE_NO_WINDOW flag to hide console window
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 获取进程列表
#[tauri::command]
pub async fn get_processes(filter: Option<ProcessFilter>) -> Result<Vec<ProcessInfo>, String> {
    let mut system = System::new_all();
    system.refresh_all();

    let mut processes: Vec<ProcessInfo> = Vec::new();

    // 如果有端口过滤，先获取端口-进程映射
    let port_pid_map = if filter
        .as_ref()
        .map(|f| f.port.is_some())
        .unwrap_or(false)
    {
        get_port_pid_map().await?
    } else {
        HashMap::new()
    };

    // 如果指定了端口，只返回占用该端口的进程
    if let Some(ref f) = filter {
        if let Some(port) = f.port {
            if let Some(pids) = port_pid_map.get(&port) {
                for pid in pids {
                    if let Some(proc) = system.process(Pid::from_u32(*pid)) {
                        let info = build_process_info(*pid, proc, Some(port), None);
                        processes.push(info);
                    }
                }
            }
            return Ok(processes);
        }
    }

    // 获取所有进程
    for (pid, proc) in system.processes() {
        let pid_u32 = pid.as_u32();

        // 应用过滤器
        if let Some(ref f) = filter {
            // 按 PID 过滤
            if let Some(filter_pid) = f.pid {
                if pid_u32 != filter_pid {
                    continue;
                }
            }

            // 按名称过滤
            if let Some(ref name) = f.name {
                let proc_name = proc.name().to_lowercase();
                if !proc_name.contains(&name.to_lowercase()) {
                    continue;
                }
            }
        }

        let info = build_process_info(pid_u32, proc, None, None);
        processes.push(info);
    }

    // 按 PID 排序
    processes.sort_by_key(|p| p.pid);

    Ok(processes)
}

/// 构建进程信息
fn build_process_info(
    pid: u32,
    proc: &sysinfo::Process,
    port: Option<u16>,
    protocol: Option<String>,
) -> ProcessInfo {
    ProcessInfo {
        pid,
        name: proc.name().to_string(),
        port,
        protocol,
        local_addr: None,
        remote_addr: None,
        status: format_process_status(proc.status()),
        memory: proc.memory(),
        cpu: proc.cpu_usage(),
        working_dir: proc.cwd().map(|p| p.to_string_lossy().to_string()),
        cmd: Some(
            proc.cmd()
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
                .join(" "),
        ),
    }
}

/// 格式化进程状态
fn format_process_status(status: ProcessStatus) -> String {
    match status {
        ProcessStatus::Run => "运行中",
        ProcessStatus::Sleep => "休眠",
        ProcessStatus::Stop => "停止",
        ProcessStatus::Zombie => "僵尸",
        ProcessStatus::Idle => "空闲",
        _ => "未知",
    }
    .to_string()
}

/// 获取端口-进程映射
#[cfg(target_os = "windows")]
async fn get_port_pid_map() -> Result<HashMap<u16, Vec<u32>>, String> {
    use std::process::Command;

    let output = Command::new("netstat")
        .args(["-ano"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("执行 netstat 失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut map: HashMap<u16, Vec<u32>> = HashMap::new();

    for line in stdout.lines().skip(4) {
        // 跳过头部
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 5 {
            // 解析本地地址
            if let Some(local_addr) = parts.get(1) {
                if let Some(port_str) = local_addr.rsplit(':').next() {
                    if let Ok(port) = port_str.parse::<u16>() {
                        // 解析 PID
                        if let Some(pid_str) = parts.last() {
                            if let Ok(pid) = pid_str.parse::<u32>() {
                                map.entry(port).or_default().push(pid);
                            }
                        }
                    }
                }
            }
        }
    }

    // 去重
    for pids in map.values_mut() {
        pids.sort();
        pids.dedup();
    }

    Ok(map)
}

/// 获取端口-进程映射（Linux）
#[cfg(target_os = "linux")]
async fn get_port_pid_map() -> Result<HashMap<u16, Vec<u32>>, String> {
    use std::process::Command;

    // 尝试使用 ss 命令（需要 root 权限才能看到 PID）
    let output = Command::new("ss")
        .args(["-tulnp"])
        .output()
        .map_err(|e| format!("执行 ss 失败: {}。请确保已安装 iproute2 包", e))?;

    if !output.status.success() {
        // ss 可能需要 root 权限
        return Err("获取端口信息失败，可能需要管理员权限".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut map: HashMap<u16, Vec<u32>> = HashMap::new();

    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 5 {
            // 解析本地地址（格式：*:port 或 0.0.0.0:port 或 [::]:port）
            if let Some(local_addr) = parts.get(4) {
                if let Some(port_str) = local_addr.rsplit(':').next() {
                    if let Ok(port) = port_str.parse::<u16>() {
                        // 解析 PID（格式：users:(("name",pid=123,fd=4))）
                        if let Some(users) = parts.get(6) {
                            if let Some(pid_start) = users.find("pid=") {
                                let pid_part = &users[pid_start + 4..];
                                if let Some(pid_end) = pid_part.find(|c| c == ',' || c == ')') {
                                    if let Ok(pid) = pid_part[..pid_end].parse::<u32>() {
                                        map.entry(port).or_default().push(pid);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 去重
    for pids in map.values_mut() {
        pids.sort();
        pids.dedup();
    }

    Ok(map)
}

/// 获取端口-进程映射（macOS）
#[cfg(target_os = "macos")]
async fn get_port_pid_map() -> Result<HashMap<u16, Vec<u32>>, String> {
    use std::process::Command;

    let output = Command::new("lsof")
        .args(["-i", "-P", "-n"])
        .output()
        .map_err(|e| format!("执行 lsof 失败: {}。请确保已安装 lsof", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("Permission denied") {
            return Err("获取端口信息失败，可能需要管理员权限".to_string());
        }
        return Err(format!("lsof 执行失败: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut map: HashMap<u16, Vec<u32>> = HashMap::new();

    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 9 {
            // PID 在第 2 列
            if let Ok(pid) = parts[1].parse::<u32>() {
                // 地址在第 9 列，格式：*:port 或 host:port (LISTEN)
                if let Some(addr) = parts.get(8) {
                    if let Some(port_str) = addr.rsplit(':').next() {
                        if let Ok(port) = port_str.parse::<u16>() {
                            map.entry(port).or_default().push(pid);
                        }
                    }
                }
            }
        }
    }

    // 去重
    for pids in map.values_mut() {
        pids.sort();
        pids.dedup();
    }

    Ok(map)
}

/// 查询端口占用
#[tauri::command]
pub async fn get_port_processes(port: u16) -> Result<Vec<ProcessInfo>, String> {
    get_processes(Some(ProcessFilter {
        port: Some(port),
        name: None,
        pid: None,
    }))
    .await
}

/// 终止进程
#[tauri::command]
pub async fn kill_process(pid: u32, force: Option<bool>) -> Result<(), String> {
    // 获取当前进程 PID，防止用户意外结束 CodeShelf 自身
    let current_pid = std::process::id();
    if pid == current_pid {
        return Err("无法终止 CodeShelf 进程。如需停止内部服务，请使用本地服务页面的停止按钮。".to_string());
    }

    let force = force.unwrap_or(false);

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;

        let mut cmd = Command::new("taskkill");
        cmd.creation_flags(CREATE_NO_WINDOW);
        if force {
            cmd.arg("/F");
        }
        cmd.args(["/PID", &pid.to_string()]);

        let output = cmd
            .output()
            .map_err(|e| format!("执行 taskkill 失败: {}", e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        use std::process::Command;

        let signal = if force { "-9" } else { "-15" };
        let output = Command::new("kill")
            .args([signal, &pid.to_string()])
            .output()
            .map_err(|e| format!("执行 kill 失败: {}", e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
    }

    Ok(())
}

/// 获取系统资源使用情况
#[tauri::command]
pub async fn get_system_stats() -> Result<SystemStats, String> {
    let mut system = System::new_all();
    system.refresh_all();

    Ok(SystemStats {
        total_memory: system.total_memory(),
        used_memory: system.used_memory(),
        total_swap: system.total_swap(),
        used_swap: system.used_swap(),
        cpu_count: system.cpus().len() as u32,
        process_count: system.processes().len() as u32,
    })
}

/// 系统统计信息
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub total_memory: u64,
    pub used_memory: u64,
    pub total_swap: u64,
    pub used_swap: u64,
    pub cpu_count: u32,
    pub process_count: u32,
}

/// 端口占用信息
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortOccupation {
    pub port: u16,
    pub protocol: String,
    pub pid: u32,
    pub process_name: String,
    pub local_addr: String,
    pub state: String,
}

/// 获取本地端口占用情况
#[tauri::command]
pub async fn get_local_port_occupation() -> Result<Vec<PortOccupation>, String> {
    #[cfg(target_os = "windows")]
    {
        get_port_occupation_windows().await
    }

    #[cfg(target_os = "linux")]
    {
        get_port_occupation_linux().await
    }

    #[cfg(target_os = "macos")]
    {
        get_port_occupation_macos().await
    }
}

/// Windows: 获取端口占用
#[cfg(target_os = "windows")]
async fn get_port_occupation_windows() -> Result<Vec<PortOccupation>, String> {
    use std::collections::HashMap;
    use std::process::Command;

    let output = Command::new("netstat")
        .args(["-ano"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("执行 netstat 失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut system = System::new_all();
    system.refresh_all();

    // 使用 HashMap 按 (port, protocol, pid) 聚合，保留最重要的状态
    // 状态优先级：LISTENING > ESTABLISHED > 其他
    let mut port_map: HashMap<(u16, String, u32), PortOccupation> = HashMap::new();

    for line in stdout.lines().skip(4) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 5 {
            let protocol = parts[0].to_uppercase();
            if protocol != "TCP" && protocol != "UDP" {
                continue;
            }

            // 解析本地地址
            if let Some(local_addr) = parts.get(1) {
                if let Some(port_str) = local_addr.rsplit(':').next() {
                    if let Ok(port) = port_str.parse::<u16>() {
                        // 解析状态（TCP 有状态，UDP 没有）
                        let (state, pid_idx) = if protocol == "TCP" {
                            (parts.get(3).unwrap_or(&"").to_string(), 4)
                        } else {
                            ("".to_string(), 3)
                        };

                        // 过滤掉 TIME_WAIT 和 CLOSE_WAIT 等非活跃状态
                        if state == "TIME_WAIT" || state == "CLOSE_WAIT" || state == "FIN_WAIT_1" || state == "FIN_WAIT_2" || state == "CLOSING" || state == "LAST_ACK" {
                            continue;
                        }

                        // 解析 PID
                        if let Some(pid_str) = parts.get(pid_idx) {
                            if let Ok(pid) = pid_str.parse::<u32>() {
                                // 过滤掉 PID 为 0 的条目（已关闭的连接）
                                if pid == 0 {
                                    continue;
                                }

                                let process_name = system
                                    .process(Pid::from_u32(pid))
                                    .map(|p| p.name().to_string())
                                    .unwrap_or_else(|| "Unknown".to_string());

                                let key = (port, protocol.to_lowercase(), pid);

                                // 如果已存在，根据优先级决定是否替换
                                if let Some(existing) = port_map.get(&key) {
                                    let existing_priority = state_priority(&existing.state);
                                    let new_priority = state_priority(&state);
                                    if new_priority <= existing_priority {
                                        continue; // 现有的优先级更高或相等，不替换
                                    }
                                }

                                port_map.insert(key, PortOccupation {
                                    port,
                                    protocol: protocol.to_lowercase(),
                                    pid,
                                    process_name,
                                    local_addr: local_addr.to_string(),
                                    state,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // 转换为 Vec 并排序
    let mut results: Vec<PortOccupation> = port_map.into_values().collect();
    results.sort_by_key(|r| (r.port, r.protocol.clone()));

    Ok(results)
}

/// 获取状态优先级（值越小优先级越高）
fn state_priority(state: &str) -> u8 {
    match state {
        "LISTENING" => 0,
        "ESTABLISHED" => 1,
        "SYN_SENT" => 2,
        "SYN_RECEIVED" => 3,
        _ => 10,
    }
}

/// Linux: 获取端口占用
#[cfg(target_os = "linux")]
async fn get_port_occupation_linux() -> Result<Vec<PortOccupation>, String> {
    use std::process::Command;

    let output = Command::new("ss")
        .args(["-tulnp"])
        .output()
        .map_err(|e| format!("执行 ss 失败: {}。请确保已安装 iproute2 包", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results: Vec<PortOccupation> = Vec::new();
    let mut system = System::new_all();
    system.refresh_all();

    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 5 {
            let protocol = parts[0].to_lowercase();

            // 解析本地地址
            if let Some(local_addr) = parts.get(4) {
                if let Some(port_str) = local_addr.rsplit(':').next() {
                    if let Ok(port) = port_str.parse::<u16>() {
                        // 解析状态
                        let state = parts.get(1).unwrap_or(&"").to_string();

                        // 解析 PID（格式：users:(("name",pid=123,fd=4))）
                        let mut pid = 0u32;
                        let mut process_name = "Unknown".to_string();

                        if let Some(users) = parts.get(6) {
                            if let Some(pid_start) = users.find("pid=") {
                                let pid_part = &users[pid_start + 4..];
                                if let Some(pid_end) = pid_part.find(|c| c == ',' || c == ')') {
                                    if let Ok(p) = pid_part[..pid_end].parse::<u32>() {
                                        pid = p;
                                        process_name = system
                                            .process(Pid::from_u32(pid))
                                            .map(|p| p.name().to_string())
                                            .unwrap_or_else(|| "Unknown".to_string());
                                    }
                                }
                            }
                        }

                        if pid > 0 {
                            results.push(PortOccupation {
                                port,
                                protocol,
                                pid,
                                process_name,
                                local_addr: local_addr.to_string(),
                                state,
                            });
                        }
                    }
                }
            }
        }
    }

    results.sort_by_key(|r| r.port);
    Ok(results)
}

/// macOS: 获取端口占用
#[cfg(target_os = "macos")]
async fn get_port_occupation_macos() -> Result<Vec<PortOccupation>, String> {
    use std::process::Command;

    let output = Command::new("lsof")
        .args(["-i", "-P", "-n", "-sTCP:LISTEN"])
        .output()
        .map_err(|e| format!("执行 lsof 失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results: Vec<PortOccupation> = Vec::new();

    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 9 {
            let process_name = parts[0].to_string();

            if let Ok(pid) = parts[1].parse::<u32>() {
                // 协议
                let protocol = if parts.get(7).map(|s| s.contains("TCP")).unwrap_or(false) {
                    "tcp".to_string()
                } else {
                    "udp".to_string()
                };

                // 地址
                if let Some(addr) = parts.get(8) {
                    if let Some(port_str) = addr.rsplit(':').next() {
                        if let Ok(port) = port_str.parse::<u16>() {
                            results.push(PortOccupation {
                                port,
                                protocol,
                                pid,
                                process_name: process_name.clone(),
                                local_addr: addr.to_string(),
                                state: "LISTEN".to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    results.sort_by_key(|r| r.port);
    results.dedup_by(|a, b| a.port == b.port && a.protocol == b.protocol);
    Ok(results)
}
