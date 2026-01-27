use std::process::Command;

#[tauri::command]
pub async fn open_in_editor(path: String, editor: Option<String>) -> Result<(), String> {
    let editor_cmd = editor.unwrap_or_else(|| "code".to_string());

    Command::new(&editor_cmd)
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open editor '{}': {}", editor_cmd, e))?;

    Ok(())
}

#[tauri::command]
pub async fn open_in_terminal(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/c", "start", "cmd", "/k", &format!("cd /d {}", path)])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", "Terminal", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
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
