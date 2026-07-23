// Claude Code 检测与扫描：check_*、scan_*、get_*_version、parse_version 等

#[allow(unused_imports)]
use crate::error::AppResult;
use std::path::PathBuf;
#[allow(unused_imports)]
use std::process::Command;

#[cfg_attr(not(target_os = "windows"), allow(unused_imports))]
use super::{
    clean_wsl_output, get_host_config_dir, new_command, ClaudeCodeInfo, ConfigFileInfo, EnvType,
};

/// 检查所有环境的 Claude Code 安装情况
#[tauri::command]
#[specta::specta]
pub async fn check_all_claude_installations() -> AppResult<Vec<ClaudeCodeInfo>> {
    let mut results = vec![];

    // 检查主机环境
    let host_info = check_host_claude().await;
    results.push(host_info);

    // Windows 下检查 WSL
    #[cfg(target_os = "windows")]
    {
        if let Ok(wsl_distros) = get_wsl_distros().await {
            for distro in wsl_distros {
                let wsl_info = check_wsl_claude(&distro).await;
                results.push(wsl_info);
            }
        }
    }

    Ok(results)
}

/// 根据指定路径检查 Claude Code 安装
#[tauri::command]
#[specta::specta]
pub async fn check_claude_by_path(claude_path: String) -> AppResult<ClaudeCodeInfo> {
    println!(
        "[DEBUG] check_claude_by_path called with: {:?}",
        claude_path
    );
    println!("[DEBUG] Path length: {}", claude_path.len());
    println!(
        "[DEBUG] Path bytes (first 50): {:?}",
        &claude_path.as_bytes()[..std::cmp::min(50, claude_path.len())]
    );

    #[cfg(target_os = "windows")]
    {
        let clean_path = claude_path.trim_start_matches("\\\\?\\");
        let normalized = clean_path.to_lowercase();

        println!("[DEBUG] Normalized path: {:?}", normalized);

        let is_wsl_path = normalized.starts_with("\\\\wsl.localhost\\")
            || normalized.starts_with("\\\\wsl$\\")
            || normalized.starts_with("\\\\wsl.localhost/")
            || normalized.starts_with("\\\\wsl$/")
            || normalized.contains("\\wsl.localhost\\")
            || normalized.contains("\\wsl$\\");

        println!("[DEBUG] Is WSL path: {}", is_wsl_path);

        if is_wsl_path {
            return check_claude_by_wsl_unc_path(&claude_path).await;
        }
    }

    let path = PathBuf::from(&claude_path);

    if !path.exists() {
        return Err(crate::error::AppError::from(format!(
            "路径不存在。\n\n收到的路径: {}\n路径长度: {}\n前20字节: {:?}\n\n请检查路径是否正确，然后重试。",
            claude_path,
            claude_path.len(),
            &claude_path.as_bytes()[..std::cmp::min(20, claude_path.len())]
        )));
    }

    let mut info = ClaudeCodeInfo {
        env_type: EnvType::Host,
        env_name: "手动指定".to_string(),
        installed: false,
        version: None,
        path: Some(claude_path.clone()),
        config_dir: None,
        config_files: vec![],
    };

    if let Ok(output) = new_command(&claude_path).arg("-version").output() {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !version.is_empty() {
                info.installed = true;
                info.version = Some(parse_version(&version));
            }
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty()
            && (stderr.contains("claude")
                || stderr
                    .chars()
                    .next()
                    .map(|c| c.is_ascii_digit())
                    .unwrap_or(false))
        {
            info.installed = true;
            info.version = Some(parse_version(&stderr));
        }
    }

    if !info.installed {
        for arg in &["--version", "-v", "-V"] {
            if let Ok(output) = new_command(&claude_path).arg(arg).output() {
                if output.status.success() {
                    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !version.is_empty() {
                        info.installed = true;
                        info.version = Some(parse_version(&version));
                        break;
                    }
                }
            }
        }
    }

    if !info.installed && path.is_file() {
        info.installed = true;
        info.version = Some("未知版本".to_string());
    }

    let config_dir = get_host_config_dir();
    info.config_dir = Some(config_dir.to_string_lossy().to_string());
    info.config_files = scan_config_files(&config_dir);

    Ok(info)
}

/// 通过 WSL UNC 路径检查 Claude Code 安装
#[cfg(target_os = "windows")]
pub(super) async fn check_claude_by_wsl_unc_path(unc_path: &str) -> AppResult<ClaudeCodeInfo> {
    println!(
        "[DEBUG] check_claude_by_wsl_unc_path called with: {:?}",
        unc_path
    );

    let clean_path = unc_path.trim_start_matches("\\\\?\\");
    println!("[DEBUG] Clean path: {:?}", clean_path);

    let lower_path = clean_path.to_lowercase();

    let (_prefix_end, distro_start) = if let Some(pos) = lower_path.find("wsl.localhost\\") {
        (pos + 14, pos + 14)
    } else if let Some(pos) = lower_path.find("wsl.localhost/") {
        (pos + 14, pos + 14)
    } else if let Some(pos) = lower_path.find("wsl$\\") {
        (pos + 5, pos + 5)
    } else if let Some(pos) = lower_path.find("wsl$/") {
        (pos + 5, pos + 5)
    } else {
        return Err(crate::error::AppError::from(
            "无效的 WSL 路径格式".to_string(),
        ));
    };

    let path_without_prefix = &clean_path[distro_start..];
    println!("[DEBUG] Path without prefix: {:?}", path_without_prefix);

    let parts: Vec<&str> = path_without_prefix.splitn(2, '\\').collect();
    if parts.len() < 2 {
        return Err(crate::error::AppError::from(
            "无效的 WSL 路径格式：无法解析发行版名称".to_string(),
        ));
    }

    let distro = parts[0];
    let linux_path = format!("/{}", parts[1].replace('\\', "/"));

    let unc_prefix = &clean_path[..distro_start + distro.len()];
    println!(
        "[DEBUG] Distro: {:?}, Linux path: {:?}, UNC prefix: {:?}",
        distro, linux_path, unc_prefix
    );

    let mut info = ClaudeCodeInfo {
        env_type: EnvType::Wsl,
        env_name: format!("WSL: {}", distro),
        installed: false,
        version: None,
        path: Some(unc_path.to_string()),
        config_dir: None,
        config_files: vec![],
    };

    let unc_file_path = PathBuf::from(unc_path);
    println!("[DEBUG] Checking UNC path exists: {:?}", unc_file_path);

    let file_exists = if unc_file_path.exists() {
        true
    } else {
        println!("[DEBUG] UNC path not accessible, falling back to wsl test -f");
        if let Ok(output) = new_command("wsl")
            .args(["-d", distro, "--", "test", "-f", &linux_path])
            .output()
        {
            output.status.success()
        } else {
            false
        }
    };

    if !file_exists {
        return Err(crate::error::AppError::from(format!(
            "WSL 中路径不存在: {} (Linux 路径: {})",
            unc_path, linux_path
        )));
    }

    info.installed = true;

    for arg in &["-version", "--version", "-v"] {
        let cmd_str = format!("{} {}", linux_path, arg);
        if let Ok(output) = new_command("wsl")
            .args(["-d", distro, "--", "bash", "-lc", &cmd_str])
            .output()
        {
            let stdout = clean_wsl_output(&output.stdout);
            let stderr = clean_wsl_output(&output.stderr);

            if !stdout.is_empty() {
                info.version = Some(parse_version(&stdout));
                break;
            }
            if !stderr.is_empty()
                && (stderr
                    .chars()
                    .next()
                    .map(|c| c.is_ascii_digit())
                    .unwrap_or(false)
                    || stderr.contains("claude"))
            {
                info.version = Some(parse_version(&stderr));
                break;
            }
        }
    }

    if info.version.is_none() {
        info.version = Some("未知版本".to_string());
    }

    if let Ok(output) = new_command("wsl")
        .args(["-d", distro, "--", "bash", "-lc", "echo $HOME/.claude"])
        .output()
    {
        if output.status.success() {
            let linux_config_dir = clean_wsl_output(&output.stdout);
            let unc_config_dir = format!("{}{}", unc_prefix, linux_config_dir.replace('/', "\\"));
            println!("[DEBUG] Config dir UNC: {:?}", unc_config_dir);
            info.config_dir = Some(unc_config_dir.clone());
            info.config_files = scan_config_files(&PathBuf::from(&unc_config_dir));
        }
    }

    Ok(info)
}

/// 检查主机上的 Claude Code
async fn check_host_claude() -> ClaudeCodeInfo {
    let mut info = ClaudeCodeInfo {
        env_type: EnvType::Host,
        env_name: get_host_name(),
        installed: false,
        version: None,
        path: None,
        config_dir: None,
        config_files: vec![],
    };

    #[cfg(target_os = "windows")]
    let (which_cmd, which_args) = ("where", vec!["claude"]);
    #[cfg(not(target_os = "windows"))]
    let (which_cmd, which_args) = ("which", vec!["claude"]);

    if let Ok(output) = new_command(which_cmd).args(&which_args).output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                info.installed = true;
                info.path = Some(path.lines().next().unwrap_or(&path).to_string());
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    if !info.installed {
        if let Some(path) = find_claude_via_login_shell() {
            info.installed = true;
            info.path = Some(path);
        }
    }

    if info.installed {
        info.version = get_claude_version_host();
    }

    let config_dir = get_host_config_dir();
    info.config_dir = Some(config_dir.to_string_lossy().to_string());
    info.config_files = scan_config_files(&config_dir);

    info
}

/// 获取主机上的 Claude 版本
fn get_claude_version_host() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = new_command("cmd")
            .args([
                "/c",
                "npm",
                "list",
                "-g",
                "@anthropic-ai/claude-code",
                "--depth=0",
            ])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(version) = extract_npm_version(&stdout) {
                return Some(version);
            }
        }
    }

    if let Ok(output) = new_command("claude").arg("-version").output() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() {
            return Some(parse_version(&stdout));
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty()
            && (stderr.contains("claude")
                || stderr
                    .chars()
                    .next()
                    .map(|c| c.is_ascii_digit())
                    .unwrap_or(false))
        {
            return Some(parse_version(&stderr));
        }
    }

    if let Ok(output) = new_command("claude").arg("--version").output() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() {
            return Some(parse_version(&stdout));
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() && stderr.contains("claude") {
            return Some(parse_version(&stderr));
        }
    }

    if let Ok(output) = new_command("claude").arg("-v").output() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() {
            return Some(parse_version(&stdout));
        }
    }

    if let Ok(output) = new_command("claude").arg("-V").output() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() {
            return Some(parse_version(&stdout));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(output) = new_command("npm")
            .args(["list", "-g", "@anthropic-ai/claude-code", "--depth=0"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(version) = extract_npm_version(&stdout) {
                return Some(version);
            }
        }
    }

    None
}

/// 从 npm list 输出中提取版本
fn extract_npm_version(output: &str) -> Option<String> {
    for line in output.lines() {
        if line.contains("@anthropic-ai/claude-code@") {
            if let Some(idx) = line.rfind('@') {
                let version = line[idx + 1..].trim();
                if !version.is_empty() {
                    return Some(version.to_string());
                }
            }
        }
    }
    None
}

/// 解析版本字符串
pub(super) fn parse_version(raw: &str) -> String {
    let raw = raw.trim();
    let lower = raw.to_lowercase();
    if lower.contains("not found")
        || lower.contains("error")
        || lower.contains("wsl:")
        || lower.contains("exec:")
        || lower.contains("command not found")
        || lower.contains("no such file")
        || lower.contains("permission denied")
        || lower.contains("cannot")
    {
        return "未知版本".to_string();
    }

    let non_ascii_count = raw.chars().filter(|c| !c.is_ascii()).count();
    if non_ascii_count > raw.len() / 3 {
        return "未知版本".to_string();
    }

    if let Some(idx) = lower.find("version") {
        let after = raw[idx + 7..].trim();
        let version: String = after
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-' || *c == '_')
            .collect();
        if !version.is_empty() {
            return version;
        }
    }

    let re_pattern: Vec<char> = raw.chars().collect();
    let mut version_start = None;
    for (i, c) in re_pattern.iter().enumerate() {
        if c.is_ascii_digit() {
            if version_start.is_none() {
                version_start = Some(i);
            }
        } else if *c != '.' && *c != '-' && *c != '_' {
            if let Some(start) = version_start {
                let version: String = re_pattern[start..i].iter().collect();
                if version.contains('.') {
                    return version;
                }
                version_start = None;
            }
        }
    }

    if let Some(start) = version_start {
        let version: String = re_pattern[start..].iter().collect();
        if version.contains('.') {
            return version
                .trim_end_matches(|c: char| !c.is_ascii_digit())
                .to_string();
        }
    }

    if raw.len() > 50
        || !raw
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false)
    {
        return "未知版本".to_string();
    }

    raw.to_string()
}

/// 通过登录 shell 查找 claude 命令路径（macOS/Linux）
#[cfg(not(target_os = "windows"))]
fn find_claude_via_login_shell() -> Option<String> {
    let shells = ["zsh", "bash"];
    for shell in &shells {
        if let Ok(output) = Command::new(shell).args(["-lc", "which claude"]).output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() && !path.contains("not found") {
                    return Some(path.lines().next().unwrap_or(&path).to_string());
                }
            }
        }
    }
    None
}

/// 获取主机名
fn get_host_name() -> String {
    #[cfg(target_os = "windows")]
    return "Windows 主机".to_string();
    #[cfg(target_os = "macos")]
    return "macOS".to_string();
    #[cfg(target_os = "linux")]
    return "Linux".to_string();
}

/// 检查 Codex CLI 的安装情况（仅主机环境）。
/// 复用 ClaudeCodeInfo 结构，只关心 env_type/env_name/installed/version，
/// 供「打开项目」菜单在 Claude 之外并列出 Codex 选项。
#[tauri::command]
#[specta::specta]
pub async fn check_codex_installations() -> AppResult<Vec<ClaudeCodeInfo>> {
    let mut info = ClaudeCodeInfo {
        env_type: EnvType::Host,
        env_name: get_host_name(),
        installed: false,
        version: None,
        path: None,
        config_dir: None,
        config_files: vec![],
    };

    #[cfg(target_os = "windows")]
    let (which_cmd, which_args) = ("where", vec!["codex"]);
    #[cfg(not(target_os = "windows"))]
    let (which_cmd, which_args) = ("which", vec!["codex"]);

    if let Ok(output) = new_command(which_cmd).args(&which_args).output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                info.installed = true;
                info.path = Some(path.lines().next().unwrap_or(&path).to_string());
            }
        }
    }

    // GUI 应用拿不到登录 shell 的 PATH，再用登录 shell 找一次
    #[cfg(not(target_os = "windows"))]
    if !info.installed {
        for shell in &["zsh", "bash"] {
            if let Ok(output) = Command::new(shell).args(["-lc", "which codex"]).output() {
                if output.status.success() {
                    let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !p.is_empty() && !p.contains("not found") {
                        info.installed = true;
                        info.path = Some(p.lines().next().unwrap_or(&p).to_string());
                        break;
                    }
                }
            }
        }
    }

    if info.installed {
        if let Ok(output) = new_command("codex").arg("--version").output() {
            let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let src = if out.is_empty() {
                String::from_utf8_lossy(&output.stderr).trim().to_string()
            } else {
                out
            };
            if !src.is_empty() {
                info.version = Some(parse_version(&src));
            }
        }
    }

    Ok(vec![info])
}

/// 获取 WSL 发行版列表
#[cfg(target_os = "windows")]
async fn get_wsl_distros() -> AppResult<Vec<String>> {
    let output = new_command("wsl")
        .args(["--list", "--quiet"])
        .output()
        .map_err(|e| crate::error::AppError::from(format!("执行 wsl 命令失败: {}", e)))?;

    if !output.status.success() {
        return Ok(vec![]);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let distros: Vec<String> = stdout
        .lines()
        .map(|s| s.trim().replace('\0', "").replace('\r', ""))
        .filter(|s| !s.is_empty())
        .collect();

    Ok(distros)
}

/// 检查 WSL 中的 Claude Code
#[cfg(target_os = "windows")]
async fn check_wsl_claude(distro: &str) -> ClaudeCodeInfo {
    let mut info = ClaudeCodeInfo {
        env_type: EnvType::Wsl,
        env_name: format!("WSL: {}", distro),
        installed: false,
        version: None,
        path: None,
        config_dir: None,
        config_files: vec![],
    };

    if let Ok(output) = new_command("wsl")
        .args(["-d", distro, "--", "bash", "-lc", "which claude"])
        .output()
    {
        if output.status.success() {
            let linux_path = clean_wsl_output(&output.stdout);
            if !linux_path.is_empty() {
                info.installed = true;
                let unc_path = format!(
                    "\\\\wsl.localhost\\{}{}",
                    distro,
                    linux_path.replace('/', "\\")
                );
                info.path = Some(unc_path);
            }
        }
    }

    if !info.installed {
        let common_paths = ["/usr/local/bin/claude", "/usr/bin/claude"];
        for test_path in &common_paths {
            if let Ok(output) = new_command("wsl")
                .args(["-d", distro, "--", "test", "-f", test_path])
                .output()
            {
                if output.status.success() {
                    info.installed = true;
                    let unc_path = format!(
                        "\\\\wsl.localhost\\{}{}",
                        distro,
                        test_path.replace('/', "\\")
                    );
                    info.path = Some(unc_path);
                    break;
                }
            }
        }
    }

    if info.installed {
        if let Ok(output) = new_command("wsl")
            .args(["-d", distro, "--", "bash", "-lc", "claude -version"])
            .output()
        {
            if output.status.success() {
                let version = clean_wsl_output(&output.stdout);
                if !version.is_empty() {
                    info.version = Some(parse_version(&version));
                }
            }
            if info.version.is_none() {
                let stderr = clean_wsl_output(&output.stderr);
                if !stderr.is_empty()
                    && (stderr.contains("claude")
                        || stderr
                            .chars()
                            .next()
                            .map(|c| c.is_ascii_digit())
                            .unwrap_or(false))
                {
                    info.version = Some(parse_version(&stderr));
                }
            }
        }

        if info.version.is_none() {
            if let Ok(output) = new_command("wsl")
                .args(["-d", distro, "--", "bash", "-lc", "claude --version"])
                .output()
            {
                if output.status.success() {
                    let version = clean_wsl_output(&output.stdout);
                    if !version.is_empty() {
                        info.version = Some(parse_version(&version));
                    }
                }
            }
        }

        if info.version.is_none() {
            if let Ok(output) = new_command("wsl")
                .args([
                    "-d",
                    distro,
                    "--",
                    "bash",
                    "-lc",
                    "npm list -g @anthropic-ai/claude-code --depth=0",
                ])
                .output()
            {
                let stdout = clean_wsl_output(&output.stdout);
                if let Some(version) = extract_npm_version(&stdout) {
                    info.version = Some(version);
                }
            }
        }
    }

    if let Ok(output) = new_command("wsl")
        .args(["-d", distro, "--", "bash", "-c", "echo $HOME/.claude"])
        .output()
    {
        if output.status.success() {
            let config_dir = clean_wsl_output(&output.stdout);
            info.config_dir = Some(config_dir.clone());
            info.config_files = scan_wsl_config_files(distro, &config_dir);
        }
    }

    info
}

/// 扫描 WSL 配置文件
#[cfg(target_os = "windows")]
pub(super) fn scan_wsl_config_files(distro: &str, config_dir: &str) -> Vec<ConfigFileInfo> {
    let mut files = vec![];
    let config_file_defs = get_config_file_definitions();

    for (name, description) in config_file_defs {
        let path = format!("{}/{}", config_dir, name);
        let mut file_info = ConfigFileInfo {
            name: name.to_string(),
            path: path.clone(),
            exists: false,
            size: 0,
            modified: None,
            description: description.to_string(),
        };

        if let Ok(output) = new_command("wsl")
            .args(["-d", distro, "--", "test", "-f", &path])
            .output()
        {
            if output.status.success() {
                file_info.exists = true;

                if let Ok(stat_output) = new_command("wsl")
                    .args(["-d", distro, "--", "stat", "-c", "%s %Y", &path])
                    .output()
                {
                    if stat_output.status.success() {
                        let stat = clean_wsl_output(&stat_output.stdout);
                        let parts: Vec<&str> = stat.split_whitespace().collect();
                        if parts.len() >= 2 {
                            file_info.size = parts[0].parse().unwrap_or(0);
                            if let Ok(timestamp) = parts[1].parse::<i64>() {
                                let datetime = chrono::DateTime::from_timestamp(timestamp, 0)
                                    .map(|dt| dt.with_timezone(&chrono::Local))
                                    .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string());
                                file_info.modified = datetime;
                            }
                        }
                    }
                }
            }
        }

        files.push(file_info);
    }

    files
}

/// 获取配置文件定义
fn get_config_file_definitions() -> Vec<(&'static str, &'static str)> {
    vec![
        ("settings.json", "全局设置：主题、模型偏好、API 配置等"),
        (
            "settings.local.json",
            "本地设置覆盖：不同步到其他设备的个人配置",
        ),
        (
            "credentials.json",
            "认证凭据：API 密钥和身份验证信息（敏感）",
        ),
        (".clauderc", "运行配置：自定义命令、别名、环境变量"),
        ("CLAUDE.md", "全局项目说明：为所有项目提供的默认上下文"),
        (
            "history.jsonl",
            "对话历史：记录与 Claude 的交互历史（只读）",
        ),
        ("projects.json", "项目记录：最近打开的项目列表"),
        ("statsig.json", "功能标志：A/B 测试和功能开关配置"),
    ]
}

/// 扫描配置文件
pub(super) fn scan_config_files(config_dir: &PathBuf) -> Vec<ConfigFileInfo> {
    let mut files = vec![];
    let config_file_defs = get_config_file_definitions();

    for (name, description) in &config_file_defs {
        let path = config_dir.join(name);
        let exists = path.exists();
        let (size, modified) = if exists {
            if let Ok(meta) = std::fs::metadata(&path) {
                let modified = meta.modified().ok().map(|t| {
                    let datetime: chrono::DateTime<chrono::Local> = t.into();
                    datetime.format("%Y-%m-%d %H:%M:%S").to_string()
                });
                (meta.len(), modified)
            } else {
                (0, None)
            }
        } else {
            (0, None)
        };

        files.push(ConfigFileInfo {
            name: name.to_string(),
            path: path.to_string_lossy().to_string(),
            exists,
            size,
            modified,
            description: description.to_string(),
        });
    }

    if config_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(config_dir) {
            let known_names: Vec<&str> = config_file_defs.iter().map(|(n, _)| *n).collect();

            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let name = path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();

                    if known_names.contains(&name.as_str()) {
                        continue;
                    }

                    let (size, modified) = if let Ok(meta) = std::fs::metadata(&path) {
                        let modified = meta.modified().ok().map(|t| {
                            let datetime: chrono::DateTime<chrono::Local> = t.into();
                            datetime.format("%Y-%m-%d %H:%M:%S").to_string()
                        });
                        (meta.len(), modified)
                    } else {
                        (0, None)
                    };

                    files.push(ConfigFileInfo {
                        name,
                        path: path.to_string_lossy().to_string(),
                        exists: true,
                        size,
                        modified,
                        description: "其他配置文件".to_string(),
                    });
                }
            }
        }
    }

    files
}

// 为防止未使用导入告警（部分项仅 cfg windows 才用到）
#[allow(dead_code)]
fn _unused_silencer() {}
