use crate::error::AppResult;
use std::process::Command;

use crate::storage;
use serde::Serialize;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// Windows: CREATE_NEW_CONSOLE flag to open terminal in new window
#[cfg(target_os = "windows")]
const CREATE_NEW_CONSOLE: u32 = 0x00000010;

// Windows: CREATE_NO_WINDOW flag to hide console window for background commands
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Windows：判断自定义终端是否是 Windows Terminal。
/// 直接启动 WindowsApps 里的 WindowsTerminal.exe 会 0x80070005(拒绝访问),
/// 必须改用应用执行别名 wt.exe。
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
/// 不做 `exists()` 预检 —— 该 wt.exe 是 appexec 重解析点，`Path::exists()`/stat 无法解析它、
/// 恒返回 false，但 `CreateProcess` 能正常启动它。之前的 exists() 预检把它判成「不存在」→
/// 退回裸 wt.exe → PATH 找不到 → 落到 cmd，表现为「选了 Windows Terminal 却弹 DOS」。
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

/// Windows：在目标目录打开终端。优先 Windows Terminal(wt -d <dir>)，
/// 按可靠性依次尝试候选 wt 路径，第一个 spawn 成功即用；全失败才退 cmd。
/// `preferred` 是用户显式选中的 wt 路径，最优先(之前被忽略，是弹 DOS 的另一半原因)。
#[cfg(target_os = "windows")]
fn open_wt_or_cmd(preferred: Option<&str>, dir: &str) -> AppResult<()> {
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
        if Command::new(&wt).args(["-d", dir]).spawn().is_ok() {
            return Ok(());
        }
    }

    Command::new("cmd")
        .current_dir(dir)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map_err(|e| crate::error::AppError::from(format!("打开终端失败: {}", e)))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn open_in_explorer(path: String) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| crate::error::AppError::from(format!("Failed to open explorer: {}", e)))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| crate::error::AppError::from(format!("Failed to open Finder: {}", e)))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try common file managers
        let result = Command::new("xdg-open").arg(&path).spawn();

        if result.is_err() {
            Command::new("nautilus").arg(&path).spawn().map_err(|e| {
                crate::error::AppError::from(format!("Failed to open file manager: {}", e))
            })?;
        }
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn open_in_editor(path: String, editor_path: Option<String>) -> AppResult<()> {
    let editor = editor_path.unwrap_or_else(|| {
        // Default to VS Code if no editor specified
        #[cfg(target_os = "windows")]
        return "C:\\Program Files\\Microsoft VS Code\\Code.exe".to_string();

        #[cfg(target_os = "macos")]
        return "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code".to_string();

        #[cfg(target_os = "linux")]
        return "code".to_string();
    });

    #[cfg(target_os = "macos")]
    {
        if editor.ends_with(".app") {
            // macOS .app 应用包：用 open -a 启动
            Command::new("open")
                .args(["-a", &editor, &path])
                .spawn()
                .map_err(|e| {
                    crate::error::AppError::from(format!(
                        "Failed to open editor '{}': {}",
                        editor, e
                    ))
                })?;
        } else {
            Command::new(&editor).arg(&path).spawn().map_err(|e| {
                crate::error::AppError::from(format!("Failed to open editor '{}': {}", editor, e))
            })?;
        }
    }

    #[cfg(target_os = "windows")]
    {
        Command::new(&editor).arg(&path).spawn().map_err(|e| {
            crate::error::AppError::from(format!("Failed to open editor '{}': {}", editor, e))
        })?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new(&editor).arg(&path).spawn().map_err(|e| {
            crate::error::AppError::from(format!("Failed to open editor '{}': {}", editor, e))
        })?;
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
#[allow(unused_variables)]
pub async fn open_in_terminal(
    path: String,
    terminal_type: Option<String>,
    custom_path: Option<String>,
    terminal_path: Option<String>,
) -> AppResult<()> {
    let term_type = terminal_type.unwrap_or_else(|| "default".to_string());

    #[cfg(target_os = "windows")]
    {
        // 统一用 .current_dir(&path) 定位，而非 `cd /d "..."` / `Set-Location '...'`：
        // Rust 传参会把内层引号转义成 cmd 不认识的 \"（表现为「语法不正确」），current_dir 从根上绕开。
        match term_type.as_str() {
            "powershell" => {
                let ps_path = terminal_path.as_deref().unwrap_or("powershell");
                Command::new(ps_path)
                    .current_dir(&path)
                    .args(["-NoExit"])
                    .creation_flags(CREATE_NEW_CONSOLE)
                    .spawn()
                    .map_err(|e| crate::error::AppError::from(e.to_string()))?;
            }
            "cmd" => {
                let cmd_path = terminal_path.as_deref().unwrap_or("cmd");
                Command::new(cmd_path)
                    .current_dir(&path)
                    .args(["/k"])
                    .creation_flags(CREATE_NEW_CONSOLE)
                    .spawn()
                    .map_err(|e| crate::error::AppError::from(e.to_string()))?;
            }
            "custom" => {
                if let Some(custom) = custom_path {
                    if is_windows_terminal(&custom) {
                        // Windows Terminal：wt -d <dir>，优先用用户选中的路径（全路径解析 + cmd 兜底）。
                        // 直接启动 WindowsTerminal.exe 会 0x80070005，裸 wt.exe 又常「找不到程序」。
                        open_wt_or_cmd(Some(&custom), &path)?;
                    } else {
                        Command::new(&custom)
                            .current_dir(&path)
                            .creation_flags(CREATE_NEW_CONSOLE)
                            .spawn()
                            .map_err(|e| {
                                crate::error::AppError::from(format!(
                                    "Failed to open custom terminal '{}': {}",
                                    custom, e
                                ))
                            })?;
                    }
                } else {
                    return Err(crate::error::AppError::from(
                        "Custom terminal path not provided".to_string(),
                    ));
                }
            }
            _ => {
                open_wt_or_cmd(None, &path)?;
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        match term_type.as_str() {
            "iterm" => {
                Command::new("open")
                    .args(["-a", "iTerm", &path])
                    .spawn()
                    .map_err(|e| crate::error::AppError::from(e.to_string()))?;
            }
            "custom" => {
                if let Some(custom) = custom_path {
                    if custom.ends_with(".app") {
                        // macOS .app 应用包：用 open -a 启动（同 iTerm/Terminal 模式）
                        Command::new("open")
                            .args(["-a", &custom, &path])
                            .spawn()
                            .map_err(|e| {
                                crate::error::AppError::from(format!(
                                    "Failed to open custom terminal '{}': {}",
                                    custom, e
                                ))
                            })?;
                    } else {
                        Command::new(&custom).arg(&path).spawn().map_err(|e| {
                            crate::error::AppError::from(format!(
                                "Failed to open custom terminal '{}': {}",
                                custom, e
                            ))
                        })?;
                    }
                } else {
                    return Err(crate::error::AppError::from(
                        "Custom terminal path not provided".to_string(),
                    ));
                }
            }
            _ => {
                // Default: Terminal.app
                Command::new("open")
                    .args(["-a", "Terminal", &path])
                    .spawn()
                    .map_err(|e| crate::error::AppError::from(e.to_string()))?;
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        match term_type.as_str() {
            "custom" => {
                if let Some(custom) = custom_path {
                    Command::new(&custom)
                        .current_dir(&path)
                        .spawn()
                        .map_err(|e| {
                            crate::error::AppError::from(format!(
                                "Failed to open custom terminal '{}': {}",
                                custom, e
                            ))
                        })?;
                } else {
                    return Err(crate::error::AppError::from(
                        "Custom terminal path not provided".to_string(),
                    ));
                }
            }
            "powershell" => {
                // WSL: try powershell.exe or use custom path
                let ps_path = terminal_path.as_deref().unwrap_or("powershell.exe");
                let result = Command::new(ps_path)
                    .args(["-NoExit", "-Command", &format!("cd '{}'", path)])
                    .spawn();
                if result.is_err() {
                    // Fallback: native powershell with original path
                    Command::new("powershell")
                        .args(["-NoExit", "-Command", &format!("cd '{}'", path)])
                        .spawn()
                        .map_err(|e| crate::error::AppError::from(e.to_string()))?;
                }
            }
            "cmd" => {
                // WSL: try cmd.exe or use custom path
                let cmd_path = terminal_path.as_deref().unwrap_or("cmd.exe");
                let result = Command::new(cmd_path)
                    .args(["/k", &format!("cd /d {}", path)])
                    .spawn();
                if result.is_err() {
                    Command::new("cmd")
                        .args(["/k", &format!("cd /d {}", path)])
                        .spawn()
                        .map_err(|e| crate::error::AppError::from(e.to_string()))?;
                }
            }
            _ => {
                // Default: try Windows Terminal (WSL) with custom path, then common Linux terminals
                let wt_path = terminal_path.as_deref().unwrap_or("wt.exe");
                let wt_result = Command::new(wt_path).args(["-d", &path]).spawn();

                if wt_result.is_err() {
                    let terminals = ["gnome-terminal", "konsole", "xterm", "xfce4-terminal"];
                    let mut opened = false;

                    for term in terminals {
                        let result = match term {
                            "gnome-terminal" => Command::new(term)
                                .args(["--working-directory", &path])
                                .spawn(),
                            _ => Command::new(term).current_dir(&path).spawn(),
                        };

                        if result.is_ok() {
                            opened = true;
                            break;
                        }
                    }

                    if !opened {
                        return Err(crate::error::AppError::from(
                            "No supported terminal emulator found".to_string(),
                        ));
                    }
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn open_url(url: String) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/c", "start", "", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| crate::error::AppError::from(e.to_string()))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| crate::error::AppError::from(e.to_string()))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| crate::error::AppError::from(e.to_string()))?;
    }

    Ok(())
}

#[derive(serde::Serialize, specta::Type)]
pub struct TerminalTestResult {
    pub available: bool,
    pub error: Option<String>,
    pub suggested_path: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn test_terminal(
    terminal_type: String,
    custom_path: Option<String>,
) -> AppResult<TerminalTestResult> {
    // If custom path provided, test it directly
    if let Some(ref path) = custom_path {
        #[cfg(target_os = "windows")]
        let result = Command::new(path)
            .arg("--version")
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        #[cfg(not(target_os = "windows"))]
        let result = Command::new(path).arg("--version").output();

        return Ok(match result {
            Ok(_) => TerminalTestResult {
                available: true,
                error: None,
                suggested_path: Some(path.clone()),
            },
            Err(e) => TerminalTestResult {
                available: false,
                error: Some(format!("无法启动: {}", e)),
                suggested_path: None,
            },
        });
    }

    match terminal_type.as_str() {
        "powershell" => test_powershell(),
        "cmd" => test_cmd(),
        "terminal" => test_macos_terminal(),
        "iterm" => test_iterm(),
        "default" => test_default_terminal(),
        _ => Ok(TerminalTestResult {
            available: false,
            error: Some("未知的终端类型".to_string()),
            suggested_path: None,
        }),
    }
}

fn test_powershell() -> AppResult<TerminalTestResult> {
    // Try different PowerShell paths
    let paths_to_try = if cfg!(target_os = "windows") {
        vec![
            "powershell",
            "powershell.exe",
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        ]
    } else {
        // Linux/WSL
        vec![
            "powershell.exe",
            "pwsh.exe",
            "pwsh",
            "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
            "/mnt/c/Program Files/PowerShell/7/pwsh.exe",
        ]
    };

    for path in &paths_to_try {
        #[cfg(target_os = "windows")]
        let result = Command::new(path)
            .arg("-Command")
            .arg("echo test")
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        #[cfg(not(target_os = "windows"))]
        let result = Command::new(path).arg("-Command").arg("echo test").output();

        if result.is_ok() {
            return Ok(TerminalTestResult {
                available: true,
                error: None,
                suggested_path: Some(path.to_string()),
            });
        }
    }

    Ok(TerminalTestResult {
        available: false,
        error: Some("PowerShell 不可用，请手动设置路径".to_string()),
        suggested_path: if cfg!(target_os = "windows") {
            Some("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe".to_string())
        } else {
            Some("/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe".to_string())
        },
    })
}

fn test_cmd() -> AppResult<TerminalTestResult> {
    let paths_to_try = if cfg!(target_os = "windows") {
        vec!["cmd", "cmd.exe", "C:\\Windows\\System32\\cmd.exe"]
    } else {
        // Linux/WSL
        vec!["cmd.exe", "/mnt/c/Windows/System32/cmd.exe"]
    };

    for path in &paths_to_try {
        #[cfg(target_os = "windows")]
        let result = Command::new(path)
            .arg("/c")
            .arg("echo test")
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        #[cfg(not(target_os = "windows"))]
        let result = Command::new(path).arg("/c").arg("echo test").output();

        if result.is_ok() {
            return Ok(TerminalTestResult {
                available: true,
                error: None,
                suggested_path: Some(path.to_string()),
            });
        }
    }

    Ok(TerminalTestResult {
        available: false,
        error: Some("CMD 不可用，请手动设置路径".to_string()),
        suggested_path: if cfg!(target_os = "windows") {
            Some("C:\\Windows\\System32\\cmd.exe".to_string())
        } else {
            Some("/mnt/c/Windows/System32/cmd.exe".to_string())
        },
    })
}

fn test_macos_terminal() -> AppResult<TerminalTestResult> {
    #[cfg(target_os = "macos")]
    {
        let result = Command::new("osascript")
            .arg("-e")
            .arg("tell application \"Terminal\" to get version")
            .output();

        Ok(match result {
            Ok(_) => TerminalTestResult {
                available: true,
                error: None,
                suggested_path: None,
            },
            Err(e) => TerminalTestResult {
                available: false,
                error: Some(format!("Terminal.app 不可用: {}", e)),
                suggested_path: None,
            },
        })
    }

    #[cfg(not(target_os = "macos"))]
    Ok(TerminalTestResult {
        available: false,
        error: Some("Terminal.app 仅在 macOS 上可用".to_string()),
        suggested_path: None,
    })
}

fn test_iterm() -> AppResult<TerminalTestResult> {
    #[cfg(target_os = "macos")]
    {
        let result = Command::new("osascript")
            .arg("-e")
            .arg("tell application \"iTerm\" to get version")
            .output();

        Ok(match result {
            Ok(_) => TerminalTestResult {
                available: true,
                error: None,
                suggested_path: None,
            },
            Err(_) => TerminalTestResult {
                available: false,
                error: Some("iTerm2 未安装或不可用".to_string()),
                suggested_path: None,
            },
        })
    }

    #[cfg(not(target_os = "macos"))]
    Ok(TerminalTestResult {
        available: false,
        error: Some("iTerm2 仅在 macOS 上可用".to_string()),
        suggested_path: None,
    })
}

fn test_default_terminal() -> AppResult<TerminalTestResult> {
    #[cfg(target_os = "windows")]
    {
        // Try Windows Terminal first
        let wt_result = Command::new("wt")
            .arg("--version")
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        if wt_result.is_ok() {
            return Ok(TerminalTestResult {
                available: true,
                error: None,
                suggested_path: Some("wt".to_string()),
            });
        }

        // Fallback to PowerShell
        return test_powershell();
    }

    #[cfg(target_os = "macos")]
    {
        test_macos_terminal()
    }

    #[cfg(target_os = "linux")]
    {
        // Try Windows Terminal (WSL) first
        let wt_result = Command::new("wt.exe").arg("--version").output();

        if wt_result.is_ok() {
            return Ok(TerminalTestResult {
                available: true,
                error: None,
                suggested_path: Some("wt.exe".to_string()),
            });
        }

        // Try common Linux terminals
        let terminals = [
            ("gnome-terminal", "--version"),
            ("konsole", "--version"),
            ("xterm", "-version"),
            ("xfce4-terminal", "--version"),
        ];

        for (term, arg) in terminals {
            let result = Command::new(term).arg(arg).output();

            if result.is_ok() {
                return Ok(TerminalTestResult {
                    available: true,
                    error: None,
                    suggested_path: Some(term.to_string()),
                });
            }
        }

        Ok(TerminalTestResult {
            available: false,
            error: Some("未找到可用的终端程序".to_string()),
            suggested_path: None,
        })
    }
}

#[tauri::command]
#[specta::specta]
pub async fn read_readme(path: String) -> AppResult<String> {
    use std::fs;
    use std::path::PathBuf;

    let project_path = PathBuf::from(&path);

    // Try different README file names
    let readme_names = vec![
        "README.md",
        "readme.md",
        "Readme.md",
        "README.MD",
        "README",
        "readme",
    ];

    for name in readme_names {
        let readme_path = project_path.join(name);
        if readme_path.exists() {
            return fs::read_to_string(readme_path).map_err(|e| {
                crate::error::AppError::from(format!("Failed to read README: {}", e))
            });
        }
    }

    Err(crate::error::AppError::from(
        "README file not found".to_string(),
    ))
}

#[tauri::command]
#[specta::specta]
pub async fn check_git_version() -> AppResult<String> {
    #[cfg(target_os = "windows")]
    let output = Command::new("git")
        .arg("--version")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| crate::error::AppError::from(format!("Git not found: {}", e)))?;

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("git")
        .arg("--version")
        .output()
        .map_err(|e| crate::error::AppError::from(format!("Git not found: {}", e)))?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        // Extract version number from "git version 2.x.x"
        let version = version.replace("git version ", "");
        Ok(version)
    } else {
        Err(crate::error::AppError::from(
            "Git not installed".to_string(),
        ))
    }
}

#[tauri::command]
#[specta::specta]
pub async fn check_node_version() -> AppResult<String> {
    #[cfg(target_os = "windows")]
    let output = Command::new("node")
        .arg("--version")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| crate::error::AppError::from(format!("Node.js not found: {}", e)))?;

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("node")
        .arg("--version")
        .output()
        .map_err(|e| crate::error::AppError::from(format!("Node.js not found: {}", e)))?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(version)
    } else {
        Err(crate::error::AppError::from(
            "Node.js not installed".to_string(),
        ))
    }
}

#[derive(serde::Serialize, specta::Type)]
pub struct AppPaths {
    pub data_dir: String,
    pub config_dir: String,
    pub cache_dir: String,
    pub log_dir: String,
    pub install_dir: String,
}

#[tauri::command]
#[specta::specta]
pub async fn get_app_paths(app_handle: tauri::AppHandle) -> AppResult<AppPaths> {
    use tauri::Manager;

    let path_resolver = app_handle.path();

    // 优先使用新的存储路径
    let (data_dir, log_dir) = if let Ok(config) = storage::get_storage_config() {
        (
            config.data_dir.to_string_lossy().to_string(),
            config.logs_dir.to_string_lossy().to_string(),
        )
    } else {
        (
            path_resolver
                .app_data_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| "未知".to_string()),
            path_resolver
                .app_log_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| "未知".to_string()),
        )
    };

    let config_dir = path_resolver
        .app_config_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "未知".to_string());

    let cache_dir = path_resolver
        .app_cache_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "未知".to_string());

    // 获取当前可执行文件路径
    let install_dir = std::env::current_exe()
        .map(|p| {
            p.parent()
                .map(|parent| parent.to_string_lossy().to_string())
                .unwrap_or_else(|| "未知".to_string())
        })
        .unwrap_or_else(|_| "未知".to_string());

    Ok(AppPaths {
        data_dir,
        config_dir,
        cache_dir,
        log_dir,
        install_dir,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn clear_logs(app_handle: tauri::AppHandle) -> AppResult<String> {
    use std::fs;
    use tauri::Manager;

    // 优先使用新的日志路径
    let log_dir = if let Ok(config) = storage::get_storage_config() {
        config.logs_dir.clone()
    } else {
        let path_resolver = app_handle.path();
        path_resolver
            .app_log_dir()
            .map_err(|e| crate::error::AppError::from(format!("无法获取日志目录: {}", e)))?
    };

    if !log_dir.exists() {
        return Ok("日志目录不存在".to_string());
    }

    let mut deleted_count = 0;
    let mut total_size: u64 = 0;

    // 遍历日志目录中的所有文件
    let entries = fs::read_dir(&log_dir)
        .map_err(|e| crate::error::AppError::from(format!("无法读取日志目录: {}", e)))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Ok(metadata) = fs::metadata(&path) {
                total_size += metadata.len();
            }
            if fs::remove_file(&path).is_ok() {
                deleted_count += 1;
            }
        }
    }

    let size_str = if total_size > 1024 * 1024 {
        format!("{:.2} MB", total_size as f64 / 1024.0 / 1024.0)
    } else if total_size > 1024 {
        format!("{:.2} KB", total_size as f64 / 1024.0)
    } else {
        format!("{} B", total_size)
    };

    Ok(format!(
        "已清除 {} 个日志文件，释放 {}",
        deleted_count, size_str
    ))
}

#[derive(serde::Serialize, specta::Type)]
pub struct CursorPosition {
    pub x: f64,
    pub y: f64,
}

/// 获取鼠标光标的屏幕坐标（同步命令，在主线程执行）
#[tauri::command]
#[specta::specta]
pub fn get_cursor_position() -> AppResult<CursorPosition> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSEvent;
        use objc2_foundation::MainThreadMarker;

        let _mtm = MainThreadMarker::new()
            .ok_or_else(|| crate::error::AppError::from("必须在主线程调用".to_string()))?;
        let point = NSEvent::mouseLocation();
        // macOS 坐标系：原点在左下角，需要转换为左上角
        let screen_height = {
            use objc2_app_kit::NSScreen;
            NSScreen::mainScreen(_mtm)
                .map(|s| s.frame().size.height)
                .unwrap_or(900.0)
        };
        Ok(CursorPosition {
            x: point.x,
            y: screen_height - point.y,
        })
    }

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

        let mut point = POINT { x: 0, y: 0 };
        unsafe {
            GetCursorPos(&mut point)
                .map_err(|e| crate::error::AppError::from(format!("GetCursorPos failed: {}", e)))?;
        }
        Ok(CursorPosition {
            x: point.x as f64,
            y: point.y as f64,
        })
    }

    #[cfg(target_os = "linux")]
    {
        Err(crate::error::AppError::from(
            "Linux 暂不支持获取光标位置".to_string(),
        ))
    }
}

// ============== 架构检测（更新器使用） ==============

/// 当前 app 二进制 + 实际宿主机的架构状态
///
/// macOS 关键场景：Intel 二进制跑在 Apple Silicon 上时（Rosetta 翻译），
/// 编译时的 ARCH = "x86_64" 但宿主其实是 "aarch64"。Tauri 更新器只会
/// 按二进制架构去 latest.json 里查链接，永远拿不到匹配宿主的那一份。
#[derive(Debug, Serialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ArchStatus {
    /// 当前进程的编译目标架构（rust target arch）："x86_64" / "aarch64" / ...
    pub binary_arch: String,
    /// 宿主机的真实物理架构
    pub host_arch: String,
    /// 操作系统："macos" / "windows" / "linux"
    pub os: String,
    /// 是否运行在 Rosetta 翻译层下（macOS 专有；其他平台恒 false）
    pub is_rosetta: bool,
    /// binary_arch != host_arch 即视为不匹配
    pub mismatch: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn get_arch_status() -> AppResult<ArchStatus> {
    let binary_arch = std::env::consts::ARCH.to_string();
    let os = std::env::consts::OS.to_string();

    #[cfg(target_os = "macos")]
    let is_rosetta = is_running_under_rosetta();
    #[cfg(not(target_os = "macos"))]
    let is_rosetta = false;

    let host_arch = if is_rosetta {
        // Rosetta：x86_64 二进制 / aarch64 宿主
        "aarch64".to_string()
    } else {
        binary_arch.clone()
    };

    let mismatch = host_arch != binary_arch;

    Ok(ArchStatus {
        binary_arch,
        host_arch,
        os,
        is_rosetta,
        mismatch,
    })
}

#[cfg(target_os = "macos")]
fn is_running_under_rosetta() -> bool {
    // sysctl.proc_translated == 1 表示当前进程在 Rosetta 下运行
    match Command::new("sysctl")
        .args(["-in", "sysctl.proc_translated"])
        .output()
    {
        Ok(out) => String::from_utf8_lossy(&out.stdout).trim() == "1",
        Err(_) => false,
    }
}
