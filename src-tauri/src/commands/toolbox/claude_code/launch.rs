// Claude Code 启动：在终端中运行 claude，含 Windows/macOS/Linux/WSL 各分支

#[allow(unused_imports)]
use crate::error::AppResult;
#[allow(unused_imports)]
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(not(target_os = "windows"))]
use super::get_extra_path_dirs;

#[cfg(target_os = "macos")]
use super::get_augmented_path;

/// 将 Windows 路径转换为 WSL 路径
/// 例如: C:\work\blog → /mnt/c/work/blog
/// 如果路径已经是 Linux 格式 (/home/...) 则不转换
#[cfg(target_os = "windows")]
fn windows_path_to_wsl(path: &str) -> String {
    if path.starts_with('/') {
        return path.to_string();
    }
    if path.len() >= 3 && path.as_bytes()[1] == b':' {
        let drive = (path.as_bytes()[0] as char)
            .to_lowercase()
            .next()
            .expect("char::to_lowercase always yields at least one char");
        let rest = &path[2..];
        let linux_rest = rest.replace('\\', "/");
        return format!("/mnt/{}{}", drive, linux_rest);
    }
    if path.starts_with("\\\\wsl") {
        let normalized = path.replace('\\', "/");
        if let Some(pos) = normalized[2..].find('/') {
            let after_host = &normalized[2 + pos + 1..];
            if let Some(pos2) = after_host.find('/') {
                return after_host[pos2..].to_string();
            }
        }
    }
    path.to_string()
}

/// 校验要运行的 CLI：只允许 claude / codex。
/// cli 会被拼进 shell 命令串(cmd /k、Set-Location; xxx、do script 等),
/// 用白名单挡住任意命令注入,非法值一律回退 claude。
fn resolve_cli(cli: Option<String>) -> &'static str {
    match cli.as_deref() {
        Some("codex") => "codex",
        _ => "claude",
    }
}

/// Windows：判断自定义终端是否是 Windows Terminal。
/// 直接启动 WindowsApps 里的 WindowsTerminal.exe 会报 0x80070005(拒绝访问),
/// 必须改用应用执行别名 wt.exe，且它才认识 -d / 子命令语法。
#[cfg(target_os = "windows")]
fn is_windows_terminal(path: &str) -> bool {
    let name = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_ascii_lowercase();
    name == "wt.exe" || name == "windowsterminal.exe"
}

/// Windows：解析 wt.exe 的可用路径。
/// GUI 进程的 PATH 常常不含 %LOCALAPPDATA%\Microsoft\WindowsApps，裸 `wt.exe` 会「找不到程序」；
/// 优先用该目录下的应用执行别名全路径(它可执行，而 Program Files\WindowsApps 里的真身会被拒绝访问)。
#[cfg(target_os = "windows")]
fn resolve_wt() -> String {
    if let Some(local) = dirs::data_local_dir() {
        let p = local.join("Microsoft").join("WindowsApps").join("wt.exe");
        if p.exists() {
            return p.to_string_lossy().to_string();
        }
    }
    "wt.exe".to_string()
}

/// Windows：优先用 Windows Terminal(wt.exe -d <dir> cmd /k <cli>)在目标目录打开并运行 CLI。
/// wt 不可用(未安装 / 别名不在 PATH)时退回 cmd，保证永不硬失败。
/// cmd 用 .current_dir 设定目录而非 `cd /d "..."`，避开 Rust 转义把内层引号变成 cmd 不认的 \"。
#[cfg(target_os = "windows")]
fn launch_wt_or_cmd(dir: &str, cli: &str) -> AppResult<()> {
    const CREATE_NEW_CONSOLE: u32 = 0x00000010;
    let wt = resolve_wt();
    let wt_ok = Command::new(&wt)
        .args(["-d", dir, "cmd", "/k", cli])
        .spawn()
        .is_ok();
    if !wt_ok {
        Command::new("cmd")
            .current_dir(dir)
            .args(["/k", cli])
            .creation_flags(CREATE_NEW_CONSOLE)
            .spawn()
            .map_err(|e| crate::error::AppError::from(format!("启动终端失败: {}", e)))?;
    }
    Ok(())
}

/// 在终端中启动 Claude Code / Codex
#[tauri::command]
#[specta::specta]
#[allow(unused_variables)]
pub async fn launch_claude_in_terminal(
    work_dir: Option<String>,
    terminal_type: Option<String>,
    custom_path: Option<String>,
    terminal_path: Option<String>,
    env_type: Option<String>,
    env_name: Option<String>,
    cli: Option<String>,
) -> AppResult<()> {
    let dir = work_dir.unwrap_or_else(|| {
        dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string())
    });

    let term_type = terminal_type.unwrap_or_else(|| "default".to_string());
    let cli = resolve_cli(cli);

    #[allow(unused_variables)]
    let is_wsl_env = env_type.as_deref() == Some("wsl");
    #[allow(unused_variables)]
    let wsl_distro = env_name
        .as_deref()
        .and_then(|n| n.strip_prefix("WSL: "))
        .unwrap_or("")
        .to_string();

    #[cfg(target_os = "windows")]
    {
        const CREATE_NEW_CONSOLE: u32 = 0x00000010;

        if is_wsl_env {
            let wsl_dir = windows_path_to_wsl(&dir);
            let escaped_dir = wsl_dir.replace("'", "'\\''");
            let wsl_bash_cmd = format!("cd '{}' && {}", escaped_dir, cli);

            let mut wsl_args: Vec<String> = Vec::new();
            if !wsl_distro.is_empty() {
                wsl_args.push("-d".to_string());
                wsl_args.push(wsl_distro.clone());
            }
            wsl_args.push("--".to_string());
            wsl_args.push("bash".to_string());
            wsl_args.push("-lc".to_string());
            wsl_args.push(wsl_bash_cmd.clone());

            match term_type.as_str() {
                "custom" => {
                    if let Some(custom) = custom_path {
                        if is_windows_terminal(&custom) {
                            // Windows Terminal 必须走 wt.exe(全路径)，带上完整 wsl 子命令运行 CLI；
                            // wt 不可用时退回直接起 wsl.exe。
                            let mut wt_args = vec!["wsl.exe".to_string()];
                            wt_args.extend(wsl_args.clone());
                            let wt_ok = Command::new(resolve_wt()).args(&wt_args).spawn().is_ok();
                            if !wt_ok {
                                Command::new("wsl.exe")
                                    .args(&wsl_args)
                                    .creation_flags(CREATE_NEW_CONSOLE)
                                    .spawn()
                                    .map_err(|e| {
                                        crate::error::AppError::from(format!(
                                            "启动终端失败: {}",
                                            e
                                        ))
                                    })?;
                            }
                        } else {
                            Command::new(&custom)
                                .args(&wsl_args[..wsl_args.len() - 4])
                                .creation_flags(CREATE_NEW_CONSOLE)
                                .spawn()
                                .map_err(|e| {
                                    crate::error::AppError::from(format!(
                                        "启动自定义终端失败: {}",
                                        e
                                    ))
                                })?;
                        }
                    } else {
                        return Err(crate::error::AppError::from(
                            "未提供自定义终端路径".to_string(),
                        ));
                    }
                }
                _ => {
                    let wt_path = terminal_path.clone().unwrap_or_else(resolve_wt);
                    let mut wt_args = vec!["wsl.exe".to_string()];
                    wt_args.extend(wsl_args.clone());
                    let wt_result = Command::new(&wt_path).args(&wt_args).spawn();

                    if wt_result.is_err() {
                        Command::new("wsl.exe")
                            .args(&wsl_args)
                            .creation_flags(CREATE_NEW_CONSOLE)
                            .spawn()
                            .map_err(|e| {
                                crate::error::AppError::from(format!("启动终端失败: {}", e))
                            })?;
                    }
                }
            }
        } else {
            // 统一用 .current_dir(&dir) 设定工作目录，而非 `cd /d "..."` / `Set-Location '...'`：
            // Rust 传参会把内层引号转义成 cmd 不认识的 \"（表现为「语法不正确」），current_dir 从根上绕开。
            // cli 只含 claude/codex，无空格无需转义。
            match term_type.as_str() {
                "powershell" => {
                    let ps_path = terminal_path.as_deref().unwrap_or("powershell");
                    Command::new(ps_path)
                        .current_dir(&dir)
                        .args(["-NoExit", "-Command", cli])
                        .creation_flags(CREATE_NEW_CONSOLE)
                        .spawn()
                        .map_err(|e| {
                            crate::error::AppError::from(format!("启动终端失败: {}", e))
                        })?;
                }
                "cmd" => {
                    let cmd_path = terminal_path.as_deref().unwrap_or("cmd");
                    Command::new(cmd_path)
                        .current_dir(&dir)
                        .args(["/k", cli])
                        .creation_flags(CREATE_NEW_CONSOLE)
                        .spawn()
                        .map_err(|e| {
                            crate::error::AppError::from(format!("启动终端失败: {}", e))
                        })?;
                }
                "custom" => {
                    if let Some(custom) = custom_path {
                        let lower = custom.to_ascii_lowercase();
                        if is_windows_terminal(&custom) {
                            // Windows Terminal：走 wt.exe -d <dir> cmd /k <cli>，
                            // 直接启动 WindowsTerminal.exe 会 0x80070005，裸 wt.exe 又常「找不到程序」。
                            launch_wt_or_cmd(&dir, cli)?;
                        } else if lower.ends_with("powershell.exe") || lower.ends_with("pwsh.exe") {
                            Command::new(&custom)
                                .current_dir(&dir)
                                .args(["-NoExit", "-Command", cli])
                                .creation_flags(CREATE_NEW_CONSOLE)
                                .spawn()
                                .map_err(|e| {
                                    crate::error::AppError::from(format!(
                                        "启动自定义终端失败: {}",
                                        e
                                    ))
                                })?;
                        } else if lower.ends_with("cmd.exe") {
                            Command::new(&custom)
                                .current_dir(&dir)
                                .args(["/k", cli])
                                .creation_flags(CREATE_NEW_CONSOLE)
                                .spawn()
                                .map_err(|e| {
                                    crate::error::AppError::from(format!(
                                        "启动自定义终端失败: {}",
                                        e
                                    ))
                                })?;
                        } else {
                            // 未知自定义终端无法通用地注入命令，退回 wt/cmd 确保 CLI 真正跑起来
                            // (而不是只开一个空终端窗口)。
                            launch_wt_or_cmd(&dir, cli)?;
                        }
                    } else {
                        return Err(crate::error::AppError::from(
                            "未提供自定义终端路径".to_string(),
                        ));
                    }
                }
                _ => {
                    launch_wt_or_cmd(&dir, cli)?;
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let extra_dirs = get_extra_path_dirs();
        let escaped_dir = dir.replace("\\", "\\\\").replace("\"", "\\\"");
        let path_prefix = if extra_dirs.is_empty() {
            String::new()
        } else {
            format!("export PATH=\"{}:$PATH\" && ", extra_dirs.join(":"))
        };
        let script_cmd = format!("cd \"{}\" && {}{}", escaped_dir, path_prefix, cli);

        match term_type.as_str() {
            "iterm" => {
                let apple_script = format!(
                    r#"tell application "iTerm"
                        activate
                        set newWindow to (create window with default profile)
                        tell current session of newWindow
                            write text "{}"
                        end tell
                    end tell"#,
                    script_cmd.replace("\"", "\\\"")
                );
                Command::new("osascript")
                    .args(["-e", &apple_script])
                    .spawn()
                    .map_err(|e| crate::error::AppError::from(format!("启动 iTerm 失败: {}", e)))?;
            }
            "custom" => {
                let full_path = get_augmented_path();
                if let Some(custom) = custom_path {
                    if custom.ends_with(".app") {
                        // 用 open -na 启动图形终端，并通过 -e 让它在目标目录运行 CLI(claude/codex)。
                        // 不能去跑 .app/Contents/MacOS 里的可执行文件——Ghostty 这类
                        // 「GUI+CLI 二合一」的程序被直接调用只会打印帮助、不开窗口。
                        // Ghostty / Alacritty 等支持 `-e <命令>`；不支持 -e 的应用会忽略它、仅打开窗口(优雅降级)。
                        let sh_cmd = format!(
                            "cd '{}' && {}exec {}",
                            dir.replace('\'', "'\\''"),
                            path_prefix,
                            cli
                        );
                        Command::new("open")
                            .args(["-na", &custom, "--args", "-e", "/bin/sh", "-lc", &sh_cmd])
                            .spawn()
                            .map_err(|e| {
                                crate::error::AppError::from(format!(
                                    "启动自定义终端失败: {}",
                                    e
                                ))
                            })?;
                    } else {
                        Command::new(&custom)
                            .current_dir(&dir)
                            .env("PATH", &full_path)
                            .spawn()
                            .map_err(|e| {
                                crate::error::AppError::from(format!("启动自定义终端失败: {}", e))
                            })?;
                    }
                } else {
                    return Err(crate::error::AppError::from(
                        "未提供自定义终端路径".to_string(),
                    ));
                }
            }
            _ => {
                let apple_script = format!(
                    r#"tell application "Terminal"
                        activate
                        do script "{}"
                    end tell"#,
                    script_cmd.replace("\"", "\\\"")
                );
                Command::new("osascript")
                    .args(["-e", &apple_script])
                    .spawn()
                    .map_err(|e| {
                        crate::error::AppError::from(format!("启动 Terminal 失败: {}", e))
                    })?;
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let extra_dirs = get_extra_path_dirs();
        let path_prefix = if extra_dirs.is_empty() {
            String::new()
        } else {
            format!("export PATH='{}:$PATH' && ", extra_dirs.join(":"))
        };
        let bash_cmd = format!(
            "cd '{}' && {}{}",
            dir.replace("'", "'\\''"),
            path_prefix,
            cli
        );

        let in_wsl = std::fs::read_to_string("/proc/version")
            .map(|v| v.to_lowercase().contains("microsoft"))
            .unwrap_or(false);

        match term_type.as_str() {
            "custom" => {
                if let Some(custom) = custom_path {
                    Command::new(&custom)
                        .current_dir(&dir)
                        .spawn()
                        .map_err(|e| {
                            crate::error::AppError::from(format!("启动自定义终端失败: {}", e))
                        })?;
                } else {
                    return Err(crate::error::AppError::from(
                        "未提供自定义终端路径".to_string(),
                    ));
                }
            }
            "powershell" => {
                let ps_path = terminal_path.as_deref().unwrap_or("powershell.exe");
                if in_wsl {
                    let wsl_cmd =
                        format!("wsl.exe bash -lc \"{}\"", bash_cmd.replace("\"", "\\\""));
                    let mut cmd = Command::new(ps_path);
                    cmd.args(["-NoExit", "-Command", &wsl_cmd]);
                    if let Ok(cwd) = std::env::current_dir() {
                        let cwd_str = cwd.to_string_lossy();
                        if cwd_str.starts_with("/mnt/") {
                            cmd.current_dir(&cwd);
                        }
                    }
                    cmd.spawn().map_err(|e| {
                        crate::error::AppError::from(format!("启动终端失败: {}", e))
                    })?;
                } else {
                    let escaped_path = dir.replace("'", "''");
                    Command::new(ps_path)
                        .args([
                            "-NoExit",
                            "-Command",
                            &format!("Set-Location -LiteralPath '{}'; claude", escaped_path),
                        ])
                        .spawn()
                        .map_err(|e| {
                            crate::error::AppError::from(format!("启动终端失败: {}", e))
                        })?;
                }
            }
            "cmd" => {
                let cmd_path = terminal_path.as_deref().unwrap_or("cmd.exe");
                if in_wsl {
                    let wsl_cmd =
                        format!("wsl.exe bash -lc \"{}\"", bash_cmd.replace("\"", "\\\""));
                    let mut cmd = Command::new(cmd_path);
                    cmd.args(["/k", &wsl_cmd]);
                    if let Ok(cwd) = std::env::current_dir() {
                        let cwd_str = cwd.to_string_lossy();
                        if cwd_str.starts_with("/mnt/") {
                            cmd.current_dir(&cwd);
                        }
                    }
                    cmd.spawn().map_err(|e| {
                        crate::error::AppError::from(format!("启动终端失败: {}", e))
                    })?;
                } else {
                    Command::new(cmd_path)
                        .args(["/k", &format!("cd /d \"{}\" && claude", dir)])
                        .spawn()
                        .map_err(|e| {
                            crate::error::AppError::from(format!("启动终端失败: {}", e))
                        })?;
                }
            }
            _ => {
                if in_wsl {
                    let wt_path = terminal_path.as_deref().unwrap_or("wt.exe");
                    let mut cmd = Command::new(wt_path);
                    cmd.args(["--", "wsl.exe", "bash", "-lc", &bash_cmd]);
                    if let Ok(cwd) = std::env::current_dir() {
                        let cwd_str = cwd.to_string_lossy();
                        if cwd_str.starts_with("/mnt/") {
                            cmd.current_dir(&cwd);
                        }
                    }
                    let wt_result = cmd.spawn();

                    if wt_result.is_err() {
                        let mut opened = false;
                        let terminals = ["gnome-terminal", "konsole", "xterm", "xfce4-terminal"];
                        for term in terminals {
                            let result = match term {
                                "gnome-terminal" => Command::new(term)
                                    .args(["--", "bash", "-lc", &bash_cmd])
                                    .spawn(),
                                "konsole" => Command::new(term)
                                    .args(["-e", "bash", "-lc", &bash_cmd])
                                    .spawn(),
                                _ => Command::new(term)
                                    .args([
                                        "-e",
                                        &format!("bash -lc '{}'", bash_cmd.replace("'", "'\\''")),
                                    ])
                                    .spawn(),
                            };
                            if result.is_ok() {
                                opened = true;
                                break;
                            }
                        }
                        if !opened {
                            return Err(crate::error::AppError::from(
                                "未找到可用的终端程序".to_string(),
                            ));
                        }
                    }
                } else {
                    let terminals = ["gnome-terminal", "konsole", "xterm", "xfce4-terminal"];
                    let mut opened = false;
                    for term in terminals {
                        let result = match term {
                            "gnome-terminal" => Command::new(term)
                                .args(["--", "bash", "-lc", &bash_cmd])
                                .spawn(),
                            "konsole" => Command::new(term)
                                .args(["-e", "bash", "-lc", &bash_cmd])
                                .spawn(),
                            _ => Command::new(term)
                                .args([
                                    "-e",
                                    &format!("bash -lc '{}'", bash_cmd.replace("'", "'\\''")),
                                ])
                                .spawn(),
                        };
                        if result.is_ok() {
                            opened = true;
                            break;
                        }
                    }
                    if !opened {
                        return Err(crate::error::AppError::from(
                            "未找到可用的终端程序".to_string(),
                        ));
                    }
                }
            }
        }
    }

    Ok(())
}
