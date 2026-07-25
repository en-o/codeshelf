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

/// Windows：解析 wt.exe 的应用执行别名全路径（%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe）。
/// GUI 进程的 PATH 常常不含 WindowsApps，裸 `wt.exe` 会「找不到程序」，所以用全路径。
///
/// 不做 `exists()` 预检 —— WindowsApps 里的 wt.exe 是 appexec 重解析点(IO_REPARSE_TAG_APPEXECLINK)，
/// `Path::exists()`/stat 无法解析它、恒返回 false，但 `CreateProcess` 能正常启动它。之前那个
/// exists() 预检恰恰把这条可用路径判成「不存在」→ 退回裸 wt.exe → PATH 里找不到 → 最终落到 cmd，
/// 表现就是「自定义了 Windows Terminal 却弹 DOS」。
#[cfg(target_os = "windows")]
fn resolve_wt() -> String {
    if let Some(local) = dirs::data_local_dir() {
        return local
            .join("Microsoft")
            .join("WindowsApps")
            .join("wt.exe")
            .to_string_lossy()
            .into_owned();
    }
    "wt.exe".to_string()
}

/// Windows：用 Windows Terminal(wt -d <dir> cmd /k <cli>)在目标目录打开并运行 CLI。
/// 按可靠性依次尝试候选 wt 路径，第一个 spawn 成功即用；全失败才退 cmd，保证永不硬失败。
/// `preferred` 是用户在设置里显式选中的 wt 路径，最优先(之前完全被忽略，是弹 DOS 的另一半原因)。
/// cmd 用 .current_dir 设定目录而非 `cd /d "..."`，避开 Rust 转义把内层引号变成 cmd 不认的 \"。
#[cfg(target_os = "windows")]
fn launch_wt_or_cmd(preferred: Option<&str>, dir: &str, cli: &str) -> AppResult<()> {
    const CREATE_NEW_CONSOLE: u32 = 0x00000010;
    let mut candidates: Vec<String> = Vec::new();
    if let Some(p) = preferred {
        let p = p.trim();
        if !p.is_empty() {
            candidates.push(p.to_string());
        }
    }
    candidates.push(resolve_wt());
    candidates.push("wt.exe".to_string());

    for wt in candidates {
        if Command::new(&wt)
            .args(["-d", dir, "cmd", "/k", cli])
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
    }

    Command::new("cmd")
        .current_dir(dir)
        .args(["/k", cli])
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map_err(|e| crate::error::AppError::from(format!("启动终端失败: {}", e)))?;
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
                            // Windows Terminal：走 wt -d <dir> cmd /k <cli>，优先用用户选中的路径。
                            // 直接启动 WindowsTerminal.exe 会 0x80070005，裸 wt.exe 又常「找不到程序」。
                            launch_wt_or_cmd(Some(&custom), &dir, cli)?;
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
                        } else if lower.ends_with("wezterm.exe")
                            || lower.ends_with("wezterm-gui.exe")
                        {
                            // WezTerm：start --cwd <dir> -- cmd /k <cli>。
                            // 外层是 wezterm 窗口，cmd /k 让 CLI 退出后窗口不关（与 wt 分支一致）。
                            Command::new(&custom)
                                .args(["start", "--cwd", &dir, "--", "cmd", "/k", cli])
                                .creation_flags(CREATE_NEW_CONSOLE)
                                .spawn()
                                .map_err(|e| {
                                    crate::error::AppError::from(format!(
                                        "启动自定义终端失败: {}",
                                        e
                                    ))
                                })?;
                        } else if lower.ends_with("alacritty.exe") {
                            // Alacritty：--working-directory <dir> -e cmd /k <cli>
                            Command::new(&custom)
                                .args(["--working-directory", &dir, "-e", "cmd", "/k", cli])
                                .creation_flags(CREATE_NEW_CONSOLE)
                                .spawn()
                                .map_err(|e| {
                                    crate::error::AppError::from(format!(
                                        "启动自定义终端失败: {}",
                                        e
                                    ))
                                })?;
                        } else {
                            // 无法通用注入命令的自定义终端：直接在工作目录打开它，尊重用户选择，
                            // 绝不退回 cmd/DOS。代价是不会自动运行 CLI，需用户在终端里自行输入。
                            // ponytail: 无通用的「向任意终端注入命令」机制，已知的几种上面单列；
                            //           其余保底开窗，要自动跑 CLI 就按需在上面加对应终端的语法。
                            Command::new(&custom)
                                .current_dir(&dir)
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
                    launch_wt_or_cmd(None, &dir, cli)?;
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
                        // 图形终端(Ghostty 等)必须经 open 启动(直接跑 .app/Contents/MacOS 里的
                        // 可执行文件只会打印帮助)。但 Ghostty 的 `-e` 会把参数塞进它自己的
                        // `login ... bash --noprofile --norc -c "exec -l ..."` 包装里:
                        //   1) 多层 shell + 引号会被打散(实测 `-e /bin/sh -lc "cd ... && exec x"` 直接失败)；
                        //   2) --norc 下不加载 .zshrc → nvm 的 PATH 缺失 → 连 CLI 的 `env node` 都找不到。
                        // 解法:写一个临时可执行脚本(对 -e 而言是「单个干净参数」，不触发上面两个坑)，
                        // 脚本里注入完整 PATH(含 nvm/homebrew) + cd + 运行 CLI。
                        use std::os::unix::fs::PermissionsExt;
                        let script = format!(
                            "#!/bin/sh\nexport PATH=\"{}\"\ncd \"{}\" && exec {}\n",
                            full_path, escaped_dir, cli
                        );
                        let uniq = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_nanos())
                            .unwrap_or(0);
                        let script_path = std::env::temp_dir()
                            .join(format!("codeshelf-launch-{}.sh", uniq));
                        std::fs::write(&script_path, script)
                            .and_then(|_| {
                                std::fs::set_permissions(
                                    &script_path,
                                    std::fs::Permissions::from_mode(0o755),
                                )
                            })
                            .map_err(|e| {
                                crate::error::AppError::from(format!("准备启动脚本失败: {}", e))
                            })?;
                        Command::new("open")
                            .args([
                                "-na",
                                custom.as_str(),
                                "--args",
                                "-e",
                                script_path.to_string_lossy().as_ref(),
                            ])
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
