// Claude Code 配置文件读写：read/write/open/scan + WSL UNC 辅助

#[allow(unused_imports)]
use crate::error::AppResult;
use std::path::PathBuf;

#[cfg_attr(not(target_os = "windows"), allow(unused_imports))]
use super::{clean_wsl_output, new_command, ConfigFileInfo, EnvType};

/// 判断是否为 WSL UNC 路径
pub(super) fn is_wsl_unc_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.starts_with("\\\\wsl.localhost\\") || lower.starts_with("\\\\wsl$\\")
}

/// 将 WSL UNC 路径解析为 (distro, linux_path)
/// 例如: \\wsl.localhost\Ubuntu\home\user\.claude -> ("Ubuntu", "/home/user/.claude")
#[allow(dead_code)]
pub(super) fn parse_wsl_unc_to_linux(unc_path: &str) -> Option<(String, String)> {
    let lower = unc_path.to_lowercase();
    let prefix_len = if lower.starts_with("\\\\wsl.localhost\\") {
        "\\\\wsl.localhost\\".len()
    } else if lower.starts_with("\\\\wsl$\\") {
        "\\\\wsl$\\".len()
    } else {
        return None;
    };

    let rest = &unc_path[prefix_len..];
    let parts: Vec<&str> = rest.splitn(2, '\\').collect();
    if parts.len() < 2 {
        return None;
    }

    let distro = parts[0].to_string();
    let linux_path = format!("/{}", parts[1].replace('\\', "/"));
    Some((distro, linux_path))
}

/// 读取配置文件内容
#[tauri::command]
#[specta::specta]
#[allow(unused_variables)]
pub async fn read_claude_config_file(
    env_type: EnvType,
    env_name: String,
    path: String,
) -> AppResult<String> {
    // 如果是 UNC 路径，优先用 Windows API 读取，失败则通过 wsl 命令
    if is_wsl_unc_path(&path) {
        if let Ok(content) = std::fs::read_to_string(&path) {
            return Ok(content);
        }
        // UNC 不可达，尝试通过 wsl 命令读取
        #[cfg(target_os = "windows")]
        {
            if let Some((distro, linux_path)) = parse_wsl_unc_to_linux(&path) {
                let output = new_command("wsl")
                    .args(["-d", &distro, "--", "cat", &linux_path])
                    .output()
                    .map_err(|e| {
                        crate::error::AppError::from(format!("执行 wsl 命令失败: {}", e))
                    })?;
                if output.status.success() {
                    return Ok(String::from_utf8_lossy(&output.stdout).to_string());
                }
                return Err(crate::error::AppError::from(format!(
                    "读取文件失败: {}",
                    String::from_utf8_lossy(&output.stderr)
                )));
            }
        }
        return Err(crate::error::AppError::from(format!(
            "读取配置文件失败: UNC 路径不可达: {}",
            path
        )));
    }

    match env_type {
        EnvType::Host => std::fs::read_to_string(&path)
            .map_err(|e| crate::error::AppError::from(format!("读取配置文件失败: {}", e))),
        #[cfg(target_os = "windows")]
        EnvType::Wsl => {
            let distro = env_name.strip_prefix("WSL: ").unwrap_or(&env_name);
            let output = new_command("wsl")
                .args(["-d", distro, "--", "cat", &path])
                .output()
                .map_err(|e| crate::error::AppError::from(format!("执行 wsl 命令失败: {}", e)))?;

            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).to_string())
            } else {
                Err(crate::error::AppError::from(format!(
                    "读取文件失败: {}",
                    String::from_utf8_lossy(&output.stderr)
                )))
            }
        }
        #[cfg(not(target_os = "windows"))]
        EnvType::Wsl => Err(crate::error::AppError::from(
            "WSL 仅在 Windows 上可用".to_string(),
        )),
    }
}

/// 写入配置文件内容
#[tauri::command]
#[specta::specta]
#[allow(unused_variables)]
pub async fn write_claude_config_file(
    env_type: EnvType,
    env_name: String,
    path: String,
    content: String,
) -> AppResult<()> {
    // 如果是 UNC 路径，优先用 Windows API 写入，失败则通过 wsl 命令
    if is_wsl_unc_path(&path) {
        // 先尝试 UNC 直接写入
        let unc_ok = (|| -> AppResult<()> {
            if let Some(parent) = std::path::Path::new(&path).parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| crate::error::AppError::from(format!("创建目录失败: {}", e)))?;
            }
            std::fs::write(&path, &content)
                .map_err(|e| crate::error::AppError::from(format!("写入配置文件失败: {}", e)))
        })();
        if unc_ok.is_ok() {
            return Ok(());
        }
        // UNC 不可达，尝试通过 wsl 命令写入
        #[cfg(target_os = "windows")]
        {
            if let Some((distro, linux_path)) = parse_wsl_unc_to_linux(&path) {
                // 确保目录存在
                if let Some(parent) = linux_path.rfind('/') {
                    let parent_dir = &linux_path[..parent];
                    let _ = new_command("wsl")
                        .args(["-d", &distro, "--", "mkdir", "-p", parent_dir])
                        .output();
                }
                // 用 tee 把目标路径作为 argv 参数传进去，不再拼 `bash -c "cat > '<path>'"`：
                // 路径里的 `'`、`$()`、`;` 在那种写法下会变成额外命令。
                let output = new_command("wsl")
                    .args(["-d", &distro, "--", "tee", &linux_path])
                    .stdout(std::process::Stdio::null())
                    .stdin(std::process::Stdio::piped())
                    .spawn()
                    .and_then(|mut child| {
                        use std::io::Write;
                        if let Some(mut stdin) = child.stdin.take() {
                            stdin.write_all(content.as_bytes())?;
                        }
                        child.wait_with_output()
                    })
                    .map_err(|e| {
                        crate::error::AppError::from(format!("执行 wsl 命令失败: {}", e))
                    })?;
                if output.status.success() {
                    return Ok(());
                }
                return Err(crate::error::AppError::from(format!(
                    "写入文件失败: {}",
                    String::from_utf8_lossy(&output.stderr)
                )));
            }
        }
        return Err(crate::error::AppError::from(format!(
            "写入配置文件失败: UNC 路径不可达: {}",
            path
        )));
    }

    match env_type {
        EnvType::Host => {
            if let Some(parent) = std::path::Path::new(&path).parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| crate::error::AppError::from(format!("创建目录失败: {}", e)))?;
            }
            std::fs::write(&path, content)
                .map_err(|e| crate::error::AppError::from(format!("写入配置文件失败: {}", e)))
        }
        #[cfg(target_os = "windows")]
        EnvType::Wsl => {
            let distro = env_name.strip_prefix("WSL: ").unwrap_or(&env_name);

            // 确保目录存在
            if let Some(parent) = std::path::Path::new(&path).parent() {
                let _ = new_command("wsl")
                    .args(["-d", distro, "--", "mkdir", "-p", &parent.to_string_lossy()])
                    .output();
            }

            // 使用 echo 和管道写入文件
            let output = new_command("wsl")
                .args([
                    "-d",
                    distro,
                    "--",
                    "bash",
                    "-c",
                    &format!("cat > '{}'", path),
                ])
                .stdin(std::process::Stdio::piped())
                .spawn()
                .map_err(|e| crate::error::AppError::from(format!("执行 wsl 命令失败: {}", e)))?;

            if let Some(mut stdin) = output.stdin {
                use std::io::Write;
                stdin
                    .write_all(content.as_bytes())
                    .map_err(|e| crate::error::AppError::from(format!("写入内容失败: {}", e)))?;
            }

            Ok(())
        }
        #[cfg(not(target_os = "windows"))]
        EnvType::Wsl => Err(crate::error::AppError::from(
            "WSL 仅在 Windows 上可用".to_string(),
        )),
    }
}

/// 打开配置目录
#[tauri::command]
#[specta::specta]
#[allow(unused_variables)]
pub async fn open_claude_config_dir(
    env_type: EnvType,
    env_name: String,
    config_dir: String,
) -> AppResult<()> {
    // 如果是 UNC 路径，直接用 explorer 打开
    if is_wsl_unc_path(&config_dir) {
        let path = PathBuf::from(&config_dir);
        if !path.exists() {
            std::fs::create_dir_all(&path)
                .map_err(|e| crate::error::AppError::from(format!("创建配置目录失败: {}", e)))?;
        }
        new_command("explorer")
            .arg(&config_dir)
            .spawn()
            .map_err(|e| crate::error::AppError::from(format!("打开目录失败: {}", e)))?;
        return Ok(());
    }

    match env_type {
        EnvType::Host => {
            let path = PathBuf::from(&config_dir);
            if !path.exists() {
                std::fs::create_dir_all(&path).map_err(|e| {
                    crate::error::AppError::from(format!("创建配置目录失败: {}", e))
                })?;
            }

            #[cfg(target_os = "windows")]
            {
                new_command("explorer")
                    .arg(&config_dir)
                    .spawn()
                    .map_err(|e| crate::error::AppError::from(format!("打开目录失败: {}", e)))?;
            }

            #[cfg(target_os = "macos")]
            {
                new_command("open")
                    .arg(&config_dir)
                    .spawn()
                    .map_err(|e| crate::error::AppError::from(format!("打开目录失败: {}", e)))?;
            }

            #[cfg(target_os = "linux")]
            {
                new_command("xdg-open")
                    .arg(&config_dir)
                    .spawn()
                    .map_err(|e| crate::error::AppError::from(format!("打开目录失败: {}", e)))?;
            }

            Ok(())
        }
        #[cfg(target_os = "windows")]
        EnvType::Wsl => {
            let distro = env_name.strip_prefix("WSL: ").unwrap_or(&env_name);
            // 将 WSL 路径转换为 Windows 路径
            let output = new_command("wsl")
                .args(["-d", distro, "--", "wslpath", "-w", &config_dir])
                .output()
                .map_err(|e| crate::error::AppError::from(format!("转换路径失败: {}", e)))?;

            if output.status.success() {
                let win_path = clean_wsl_output(&output.stdout);
                new_command("explorer")
                    .arg(&win_path)
                    .spawn()
                    .map_err(|e| crate::error::AppError::from(format!("打开目录失败: {}", e)))?;
                Ok(())
            } else {
                Err(crate::error::AppError::from(
                    "转换 WSL 路径失败".to_string(),
                ))
            }
        }
        #[cfg(not(target_os = "windows"))]
        EnvType::Wsl => Err(crate::error::AppError::from(
            "WSL 仅在 Windows 上可用".to_string(),
        )),
    }
}

/// WSL 配置目录结果
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct WslConfigDirResult {
    pub linux_path: String,
    pub unc_path: String,
}

/// 获取 WSL 配置目录（返回 Linux 路径和 UNC 路径）
#[cfg(target_os = "windows")]
#[tauri::command]
#[specta::specta]
pub async fn get_wsl_config_dir(distro: String) -> AppResult<WslConfigDirResult> {
    // 清理 distro 名称中的特殊字符
    let distro = distro.trim().replace('\r', "").replace('\0', "");

    // 获取 WSL 用户的 home 目录
    let output = new_command("wsl")
        .args(["-d", &distro, "--", "bash", "-c", "echo $HOME/.claude"])
        .output()
        .map_err(|e| crate::error::AppError::from(format!("执行 wsl 命令失败: {}", e)))?;

    if !output.status.success() {
        return Err(crate::error::AppError::from(format!(
            "获取 WSL home 目录失败: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    let linux_path = clean_wsl_output(&output.stdout);

    // 转换为 UNC 路径
    let unc_path = format!(
        "\\\\wsl.localhost\\{}{}",
        distro,
        linux_path.replace('/', "\\")
    );

    Ok(WslConfigDirResult {
        linux_path,
        unc_path,
    })
}

/// 非 Windows 系统的 stub
#[cfg(not(target_os = "windows"))]
#[tauri::command]
#[specta::specta]
pub async fn get_wsl_config_dir(_distro: String) -> AppResult<WslConfigDirResult> {
    Err(crate::error::AppError::from(
        "WSL 仅在 Windows 上可用".to_string(),
    ))
}

/// 扫描指定配置目录的配置文件
#[tauri::command]
#[specta::specta]
#[allow(unused_variables)]
pub async fn scan_claude_config_dir(
    env_type: EnvType,
    env_name: String,
    config_dir: String,
) -> AppResult<Vec<ConfigFileInfo>> {
    // 如果是 UNC 路径，直接用 Windows API 扫描
    if is_wsl_unc_path(&config_dir) {
        let path = PathBuf::from(&config_dir);
        return Ok(super::detect::scan_config_files(&path));
    }

    match env_type {
        EnvType::Host => {
            let path = PathBuf::from(&config_dir);
            Ok(super::detect::scan_config_files(&path))
        }
        #[cfg(target_os = "windows")]
        EnvType::Wsl => {
            let distro = env_name.strip_prefix("WSL: ").unwrap_or(&env_name);
            Ok(super::detect::scan_wsl_config_files(distro, &config_dir))
        }
        #[cfg(not(target_os = "windows"))]
        EnvType::Wsl => Err(crate::error::AppError::from(
            "WSL 仅在 Windows 上可用".to_string(),
        )),
    }
}
