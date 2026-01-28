use std::process::Command;

#[tauri::command]
pub async fn open_in_editor(path: String, editor_path: Option<String>) -> Result<(), String> {
    let editor = editor_path.unwrap_or_else(|| {
        // Default to VS Code if no editor specified
        #[cfg(target_os = "windows")]
        return "C:\\Program Files\\Microsoft VS Code\\Code.exe".to_string();

        #[cfg(target_os = "macos")]
        return "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code".to_string();

        #[cfg(target_os = "linux")]
        return "code".to_string();
    });

    #[cfg(target_os = "windows")]
    {
        Command::new(&editor)
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open editor '{}': {}", editor, e))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new(&editor)
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open editor '{}': {}", editor, e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn open_in_terminal(path: String, terminal_type: Option<String>, custom_path: Option<String>, terminal_path: Option<String>) -> Result<(), String> {
    let term_type = terminal_type.unwrap_or_else(|| "default".to_string());

    #[cfg(target_os = "windows")]
    {
        match term_type.as_str() {
            "powershell" => {
                let ps_path = terminal_path.as_deref().unwrap_or("powershell");
                Command::new(ps_path)
                    .args(["-NoExit", "-Command", &format!("cd '{}'", path)])
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            "cmd" => {
                let cmd_path = terminal_path.as_deref().unwrap_or("cmd");
                Command::new(cmd_path)
                    .args(["/k", &format!("cd /d {}", path)])
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            "custom" => {
                if let Some(custom) = custom_path {
                    Command::new(&custom)
                        .arg(&path)
                        .spawn()
                        .map_err(|e| format!("Failed to open custom terminal '{}': {}", custom, e))?;
                } else {
                    return Err("Custom terminal path not provided".to_string());
                }
            }
            _ => {
                // Default: Windows Terminal if available, otherwise PowerShell
                let wt_path = terminal_path.as_deref().unwrap_or("wt");
                let wt_result = Command::new(wt_path)
                    .args(["-d", &path])
                    .spawn();

                if wt_result.is_err() {
                    Command::new("powershell")
                        .args(["-NoExit", "-Command", &format!("cd '{}'", path)])
                        .spawn()
                        .map_err(|e| e.to_string())?;
                }
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
                    .map_err(|e| e.to_string())?;
            }
            "custom" => {
                if let Some(custom) = custom_path {
                    Command::new(&custom)
                        .arg(&path)
                        .spawn()
                        .map_err(|e| format!("Failed to open custom terminal '{}': {}", custom, e))?;
                } else {
                    return Err("Custom terminal path not provided".to_string());
                }
            }
            _ => {
                // Default: Terminal.app
                Command::new("open")
                    .args(["-a", "Terminal", &path])
                    .spawn()
                    .map_err(|e| e.to_string())?;
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
                        .map_err(|e| format!("Failed to open custom terminal '{}': {}", custom, e))?;
                } else {
                    return Err("Custom terminal path not provided".to_string());
                }
            }
            "powershell" => {
                // WSL: try powershell.exe or use custom path
                let ps_path = terminal_path.as_deref().unwrap_or("powershell.exe");
                let result = Command::new(ps_path)
                    .args(["-NoExit", "-Command", &format!("cd '{}'", path)])
                    .spawn();
                if result.is_err() {
                    // Fallback: native powershell
                    Command::new("powershell")
                        .args(["-NoExit", "-Command", &format!("cd '{}'", path)])
                        .spawn()
                        .map_err(|e| e.to_string())?;
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
                        .map_err(|e| e.to_string())?;
                }
            }
            _ => {
                // Default: try Windows Terminal (WSL) with custom path, then common Linux terminals
                let wt_path = terminal_path.as_deref().unwrap_or("wt.exe");
                let wt_result = Command::new(wt_path)
                    .args(["-d", &path])
                    .spawn();

                if wt_result.is_err() {
                    let terminals = ["gnome-terminal", "konsole", "xterm", "xfce4-terminal"];
                    let mut opened = false;

                    for term in terminals {
                        let result = match term {
                            "gnome-terminal" => Command::new(term)
                                .args(["--working-directory", &path])
                                .spawn(),
                            _ => Command::new(term)
                                .current_dir(&path)
                                .spawn(),
                        };

                        if result.is_ok() {
                            opened = true;
                            break;
                        }
                    }

                    if !opened {
                        return Err("No supported terminal emulator found".to_string());
                    }
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/c", "start", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[derive(serde::Serialize)]
pub struct TerminalTestResult {
    pub available: bool,
    pub error: Option<String>,
    pub suggested_path: Option<String>,
}

#[tauri::command]
pub async fn test_terminal(terminal_type: String, custom_path: Option<String>) -> Result<TerminalTestResult, String> {
    // If custom path provided, test it directly
    if let Some(ref path) = custom_path {
        let result = Command::new(path)
            .arg("--version")
            .output();

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

fn test_powershell() -> Result<TerminalTestResult, String> {
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
        let result = Command::new(path)
            .arg("-Command")
            .arg("echo test")
            .output();

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

fn test_cmd() -> Result<TerminalTestResult, String> {
    let paths_to_try = if cfg!(target_os = "windows") {
        vec![
            "cmd",
            "cmd.exe",
            "C:\\Windows\\System32\\cmd.exe",
        ]
    } else {
        // Linux/WSL
        vec![
            "cmd.exe",
            "/mnt/c/Windows/System32/cmd.exe",
        ]
    };

    for path in &paths_to_try {
        let result = Command::new(path)
            .arg("/c")
            .arg("echo test")
            .output();

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

fn test_macos_terminal() -> Result<TerminalTestResult, String> {
    #[cfg(target_os = "macos")]
    {
        let result = Command::new("osascript")
            .arg("-e")
            .arg("tell application \"Terminal\" to get version")
            .output();

        return Ok(match result {
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
        });
    }

    #[cfg(not(target_os = "macos"))]
    Ok(TerminalTestResult {
        available: false,
        error: Some("Terminal.app 仅在 macOS 上可用".to_string()),
        suggested_path: None,
    })
}

fn test_iterm() -> Result<TerminalTestResult, String> {
    #[cfg(target_os = "macos")]
    {
        let result = Command::new("osascript")
            .arg("-e")
            .arg("tell application \"iTerm\" to get version")
            .output();

        return Ok(match result {
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
        });
    }

    #[cfg(not(target_os = "macos"))]
    Ok(TerminalTestResult {
        available: false,
        error: Some("iTerm2 仅在 macOS 上可用".to_string()),
        suggested_path: None,
    })
}

fn test_default_terminal() -> Result<TerminalTestResult, String> {
    #[cfg(target_os = "windows")]
    {
        // Try Windows Terminal first
        let wt_result = Command::new("wt")
            .arg("--version")
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
        return test_macos_terminal();
    }

    #[cfg(target_os = "linux")]
    {
        // Try Windows Terminal (WSL) first
        let wt_result = Command::new("wt.exe")
            .arg("--version")
            .output();

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
            let result = Command::new(term)
                .arg(arg)
                .output();

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
pub async fn read_readme(path: String) -> Result<String, String> {
    use std::path::PathBuf;
    use std::fs;

    let project_path = PathBuf::from(&path);

    // Try different README file names
    let readme_names = vec!["README.md", "readme.md", "Readme.md", "README.MD", "README", "readme"];

    for name in readme_names {
        let readme_path = project_path.join(name);
        if readme_path.exists() {
            return fs::read_to_string(readme_path)
                .map_err(|e| format!("Failed to read README: {}", e));
        }
    }

    Err("README file not found".to_string())
}
