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
pub async fn open_in_terminal(path: String, terminal_type: Option<String>, custom_path: Option<String>) -> Result<(), String> {
    let term_type = terminal_type.unwrap_or_else(|| "default".to_string());

    #[cfg(target_os = "windows")]
    {
        match term_type.as_str() {
            "powershell" => {
                Command::new("powershell")
                    .args(["-NoExit", "-Command", &format!("cd '{}'", path)])
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            "cmd" => {
                Command::new("cmd")
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
                let wt_result = Command::new("wt")
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
        if term_type == "custom" {
            if let Some(custom) = custom_path {
                Command::new(&custom)
                    .current_dir(&path)
                    .spawn()
                    .map_err(|e| format!("Failed to open custom terminal '{}': {}", custom, e))?;
            } else {
                return Err("Custom terminal path not provided".to_string());
            }
        } else {
            // Try common terminal emulators
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
