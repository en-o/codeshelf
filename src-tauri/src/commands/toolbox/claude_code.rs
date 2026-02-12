// Claude Code 配置管理模块

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

/// 环境类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum EnvType {
    #[serde(rename = "host")]
    Host,
    #[serde(rename = "wsl")]
    Wsl,
}

/// Claude Code 安装信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeCodeInfo {
    pub env_type: EnvType,
    pub env_name: String,
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub config_dir: Option<String>,
    pub config_files: Vec<ConfigFileInfo>,
}

/// 配置文件信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigFileInfo {
    pub name: String,
    pub path: String,
    pub exists: bool,
    pub size: u64,
    pub modified: Option<String>,
    pub description: String,
}

/// 快捷配置选项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickConfigOption {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub config_key: String,
    pub config_value: serde_json::Value,
}

/// 保存的配置档案
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigProfile {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub settings: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

/// 检查所有环境的 Claude Code 安装情况
#[tauri::command]
pub async fn check_all_claude_installations() -> Result<Vec<ClaudeCodeInfo>, String> {
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
pub async fn check_claude_by_path(claude_path: String) -> Result<ClaudeCodeInfo, String> {
    let path = PathBuf::from(&claude_path);

    // 检查路径是否存在
    if !path.exists() {
        return Err(format!("指定的路径不存在: {}", claude_path));
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

    // 尝试获取版本
    if let Ok(output) = Command::new(&claude_path).arg("-version").output() {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !version.is_empty() {
                info.installed = true;
                info.version = Some(parse_version(&version));
            }
        }
        // 检查 stderr
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() && (stderr.contains("claude") || stderr.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)) {
            info.installed = true;
            info.version = Some(parse_version(&stderr));
        }
    }

    // 如果上面的方式失败，尝试其他版本参数
    if !info.installed {
        for arg in &["--version", "-v", "-V"] {
            if let Ok(output) = Command::new(&claude_path).arg(arg).output() {
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

    // 如果路径存在且可执行，标记为已安装
    if !info.installed && path.is_file() {
        info.installed = true;
        info.version = Some("未知版本".to_string());
    }

    // 获取配置目录
    let config_dir = get_host_config_dir();
    info.config_dir = Some(config_dir.to_string_lossy().to_string());
    info.config_files = scan_config_files(&config_dir);

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

    // 检查 claude 命令
    #[cfg(target_os = "windows")]
    let (which_cmd, which_args) = ("where", vec!["claude"]);
    #[cfg(not(target_os = "windows"))]
    let (which_cmd, which_args) = ("which", vec!["claude"]);

    if let Ok(output) = Command::new(which_cmd).args(&which_args).output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                info.installed = true;
                info.path = Some(path.lines().next().unwrap_or(&path).to_string());
            }
        }
    }

    // 获取版本 - 尝试多种方式
    if info.installed {
        info.version = get_claude_version_host();
    }

    // 获取配置目录
    let config_dir = get_host_config_dir();
    info.config_dir = Some(config_dir.to_string_lossy().to_string());
    info.config_files = scan_config_files(&config_dir);

    info
}

/// 获取主机上的 Claude 版本
fn get_claude_version_host() -> Option<String> {
    // 尝试 -version (单横杠，Claude Code 实际使用的格式)
    if let Ok(output) = Command::new("claude").arg("-version").output() {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !version.is_empty() {
                return Some(parse_version(&version));
            }
        }
        // 检查 stderr
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() && (stderr.contains("claude") || stderr.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)) {
            return Some(parse_version(&stderr));
        }
    }

    // 尝试 --version (双横杠)
    if let Ok(output) = Command::new("claude").arg("--version").output() {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !version.is_empty() {
                return Some(parse_version(&version));
            }
        }
        // 检查 stderr
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() && stderr.contains("claude") {
            return Some(parse_version(&stderr));
        }
    }

    // 尝试 -v
    if let Ok(output) = Command::new("claude").arg("-v").output() {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !version.is_empty() {
                return Some(parse_version(&version));
            }
        }
    }

    // 尝试 -V
    if let Ok(output) = Command::new("claude").arg("-V").output() {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !version.is_empty() {
                return Some(parse_version(&version));
            }
        }
    }

    // 尝试从 npm 获取版本
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = Command::new("npm").args(["list", "-g", "@anthropic-ai/claude-code", "--depth=0"]).output() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(version) = extract_npm_version(&stdout) {
                return Some(version);
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(output) = Command::new("npm").args(["list", "-g", "@anthropic-ai/claude-code", "--depth=0"]).output() {
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
    // 格式类似: @anthropic-ai/claude-code@1.0.0
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
fn parse_version(raw: &str) -> String {
    // 尝试提取版本号
    let raw = raw.trim();

    // 如果包含 "version" 关键字，提取后面的部分
    if let Some(idx) = raw.to_lowercase().find("version") {
        let after = raw[idx + 7..].trim();
        let version: String = after.chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-' || *c == '_')
            .collect();
        if !version.is_empty() {
            return version;
        }
    }

    // 尝试提取 x.x.x 格式的版本号
    let re_pattern: Vec<char> = raw.chars().collect();
    let mut version_start = None;
    for (i, c) in re_pattern.iter().enumerate() {
        if c.is_ascii_digit() {
            if version_start.is_none() {
                version_start = Some(i);
            }
        } else if *c != '.' && *c != '-' && *c != '_' {
            if version_start.is_some() {
                let version: String = re_pattern[version_start.unwrap()..i].iter().collect();
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
            return version.trim_end_matches(|c: char| !c.is_ascii_digit()).to_string();
        }
    }

    raw.to_string()
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

/// 获取主机配置目录
fn get_host_config_dir() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        return home.join(".claude");
    }
    PathBuf::from(".claude")
}

/// 获取 WSL 发行版列表
#[cfg(target_os = "windows")]
async fn get_wsl_distros() -> Result<Vec<String>, String> {
    let output = Command::new("wsl")
        .args(["--list", "--quiet"])
        .output()
        .map_err(|e| format!("执行 wsl 命令失败: {}", e))?;

    if !output.status.success() {
        return Ok(vec![]);
    }

    // WSL 输出可能是 UTF-16
    let stdout = String::from_utf8_lossy(&output.stdout);
    let distros: Vec<String> = stdout
        .lines()
        .map(|s| s.trim().replace('\0', ""))
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

    // 检查 claude 命令
    if let Ok(output) = Command::new("wsl")
        .args(["-d", distro, "--", "which", "claude"])
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                info.installed = true;
                info.path = Some(path);
            }
        }
    }

    // 获取版本 - 尝试多种方式
    if info.installed {
        // 首先尝试 claude -version (单横杠)
        if let Ok(output) = Command::new("wsl")
            .args(["-d", distro, "--", "claude", "-version"])
            .output()
        {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !version.is_empty() {
                    info.version = Some(parse_version(&version));
                }
            }
            // 检查 stderr
            if info.version.is_none() {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                if !stderr.is_empty() && (stderr.contains("claude") || stderr.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)) {
                    info.version = Some(parse_version(&stderr));
                }
            }
        }

        // 尝试 --version (双横杠)
        if info.version.is_none() {
            if let Ok(output) = Command::new("wsl")
                .args(["-d", distro, "--", "claude", "--version"])
                .output()
            {
                if output.status.success() {
                    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !version.is_empty() {
                        info.version = Some(parse_version(&version));
                    }
                }
            }
        }

        // 最后尝试 npm list
        if info.version.is_none() {
            if let Ok(output) = Command::new("wsl")
                .args(["-d", distro, "--", "npm", "list", "-g", "@anthropic-ai/claude-code", "--depth=0"])
                .output()
            {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(version) = extract_npm_version(&stdout) {
                    info.version = Some(version);
                }
            }
        }
    }

    // 获取配置目录 (WSL 中的 ~/.claude)
    if let Ok(output) = Command::new("wsl")
        .args(["-d", distro, "--", "bash", "-c", "echo $HOME/.claude"])
        .output()
    {
        if output.status.success() {
            let config_dir = String::from_utf8_lossy(&output.stdout).trim().to_string();
            info.config_dir = Some(config_dir.clone());

            // 扫描配置文件
            info.config_files = scan_wsl_config_files(distro, &config_dir);
        }
    }

    info
}

/// 扫描 WSL 配置文件
#[cfg(target_os = "windows")]
fn scan_wsl_config_files(distro: &str, config_dir: &str) -> Vec<ConfigFileInfo> {
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

        // 检查文件是否存在
        if let Ok(output) = Command::new("wsl")
            .args(["-d", distro, "--", "bash", "-c", &format!("test -f '{}' && stat -c '%s %Y' '{}'", path, path)])
            .output()
        {
            if output.status.success() {
                let stat = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let parts: Vec<&str> = stat.split_whitespace().collect();
                if parts.len() >= 2 {
                    file_info.exists = true;
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

        files.push(file_info);
    }

    files
}

/// 获取配置文件定义
fn get_config_file_definitions() -> Vec<(&'static str, &'static str)> {
    vec![
        ("settings.json", "全局设置：主题、模型偏好、API 配置等"),
        ("settings.local.json", "本地设置覆盖：不同步到其他设备的个人配置"),
        ("credentials.json", "认证凭据：API 密钥和身份验证信息（敏感）"),
        (".clauderc", "运行配置：自定义命令、别名、环境变量"),
        ("CLAUDE.md", "全局项目说明：为所有项目提供的默认上下文"),
        ("history.jsonl", "对话历史：记录与 Claude 的交互历史（只读）"),
        ("projects.json", "项目记录：最近打开的项目列表"),
        ("statsig.json", "功能标志：A/B 测试和功能开关配置"),
    ]
}

/// 扫描配置文件
fn scan_config_files(config_dir: &PathBuf) -> Vec<ConfigFileInfo> {
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

    // 扫描目录中的其他文件
    if config_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(config_dir) {
            let known_names: Vec<&str> = config_file_defs.iter().map(|(n, _)| *n).collect();

            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let name = path.file_name()
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

/// 读取配置文件内容
#[tauri::command]
pub async fn read_claude_config_file(env_type: EnvType, env_name: String, path: String) -> Result<String, String> {
    match env_type {
        EnvType::Host => {
            std::fs::read_to_string(&path)
                .map_err(|e| format!("读取配置文件失败: {}", e))
        }
        #[cfg(target_os = "windows")]
        EnvType::Wsl => {
            let distro = env_name.strip_prefix("WSL: ").unwrap_or(&env_name);
            let output = Command::new("wsl")
                .args(["-d", distro, "--", "cat", &path])
                .output()
                .map_err(|e| format!("执行 wsl 命令失败: {}", e))?;

            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).to_string())
            } else {
                Err(format!("读取文件失败: {}", String::from_utf8_lossy(&output.stderr)))
            }
        }
        #[cfg(not(target_os = "windows"))]
        EnvType::Wsl => {
            Err("WSL 仅在 Windows 上可用".to_string())
        }
    }
}

/// 写入配置文件内容
#[tauri::command]
pub async fn write_claude_config_file(env_type: EnvType, env_name: String, path: String, content: String) -> Result<(), String> {
    match env_type {
        EnvType::Host => {
            if let Some(parent) = std::path::Path::new(&path).parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("创建目录失败: {}", e))?;
            }
            std::fs::write(&path, content)
                .map_err(|e| format!("写入配置文件失败: {}", e))
        }
        #[cfg(target_os = "windows")]
        EnvType::Wsl => {
            let distro = env_name.strip_prefix("WSL: ").unwrap_or(&env_name);

            // 确保目录存在
            if let Some(parent) = std::path::Path::new(&path).parent() {
                let _ = Command::new("wsl")
                    .args(["-d", distro, "--", "mkdir", "-p", &parent.to_string_lossy()])
                    .output();
            }

            // 使用 echo 和管道写入文件
            let output = Command::new("wsl")
                .args(["-d", distro, "--", "bash", "-c", &format!("cat > '{}'", path)])
                .stdin(std::process::Stdio::piped())
                .spawn()
                .map_err(|e| format!("执行 wsl 命令失败: {}", e))?;

            if let Some(mut stdin) = output.stdin {
                use std::io::Write;
                stdin.write_all(content.as_bytes())
                    .map_err(|e| format!("写入内容失败: {}", e))?;
            }

            Ok(())
        }
        #[cfg(not(target_os = "windows"))]
        EnvType::Wsl => {
            Err("WSL 仅在 Windows 上可用".to_string())
        }
    }
}

/// 打开配置目录
#[tauri::command]
pub async fn open_claude_config_dir(env_type: EnvType, env_name: String, config_dir: String) -> Result<(), String> {
    match env_type {
        EnvType::Host => {
            let path = PathBuf::from(&config_dir);
            if !path.exists() {
                std::fs::create_dir_all(&path)
                    .map_err(|e| format!("创建配置目录失败: {}", e))?;
            }

            #[cfg(target_os = "windows")]
            {
                Command::new("explorer")
                    .arg(&config_dir)
                    .spawn()
                    .map_err(|e| format!("打开目录失败: {}", e))?;
            }

            #[cfg(target_os = "macos")]
            {
                Command::new("open")
                    .arg(&config_dir)
                    .spawn()
                    .map_err(|e| format!("打开目录失败: {}", e))?;
            }

            #[cfg(target_os = "linux")]
            {
                Command::new("xdg-open")
                    .arg(&config_dir)
                    .spawn()
                    .map_err(|e| format!("打开目录失败: {}", e))?;
            }

            Ok(())
        }
        #[cfg(target_os = "windows")]
        EnvType::Wsl => {
            let distro = env_name.strip_prefix("WSL: ").unwrap_or(&env_name);
            // 将 WSL 路径转换为 Windows 路径
            let output = Command::new("wsl")
                .args(["-d", distro, "--", "wslpath", "-w", &config_dir])
                .output()
                .map_err(|e| format!("转换路径失败: {}", e))?;

            if output.status.success() {
                let win_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                Command::new("explorer")
                    .arg(&win_path)
                    .spawn()
                    .map_err(|e| format!("打开目录失败: {}", e))?;
                Ok(())
            } else {
                Err("转换 WSL 路径失败".to_string())
            }
        }
        #[cfg(not(target_os = "windows"))]
        EnvType::Wsl => {
            Err("WSL 仅在 Windows 上可用".to_string())
        }
    }
}

/// 获取快捷配置选项列表
#[tauri::command]
pub async fn get_quick_config_options() -> Result<Vec<QuickConfigOption>, String> {
    Ok(vec![
        // 模型设置
        QuickConfigOption {
            id: "model_sonnet".to_string(),
            name: "使用 Claude Sonnet".to_string(),
            description: "使用 Claude Sonnet 4 模型（推荐，平衡性能和成本）".to_string(),
            category: "模型".to_string(),
            config_key: "model".to_string(),
            config_value: serde_json::json!("claude-sonnet-4-20250514"),
        },
        QuickConfigOption {
            id: "model_opus".to_string(),
            name: "使用 Claude Opus".to_string(),
            description: "使用 Claude Opus 4 模型（最强大，成本较高）".to_string(),
            category: "模型".to_string(),
            config_key: "model".to_string(),
            config_value: serde_json::json!("claude-opus-4-20250514"),
        },
        QuickConfigOption {
            id: "model_haiku".to_string(),
            name: "使用 Claude Haiku".to_string(),
            description: "使用 Claude Haiku 模型（快速，成本低）".to_string(),
            category: "模型".to_string(),
            config_key: "model".to_string(),
            config_value: serde_json::json!("claude-haiku-3-5-20241022"),
        },
        // 主题设置
        QuickConfigOption {
            id: "theme_auto".to_string(),
            name: "自动主题".to_string(),
            description: "跟随系统主题自动切换".to_string(),
            category: "外观".to_string(),
            config_key: "theme".to_string(),
            config_value: serde_json::json!("auto"),
        },
        QuickConfigOption {
            id: "theme_dark".to_string(),
            name: "深色主题".to_string(),
            description: "始终使用深色主题".to_string(),
            category: "外观".to_string(),
            config_key: "theme".to_string(),
            config_value: serde_json::json!("dark"),
        },
        QuickConfigOption {
            id: "theme_light".to_string(),
            name: "浅色主题".to_string(),
            description: "始终使用浅色主题".to_string(),
            category: "外观".to_string(),
            config_key: "theme".to_string(),
            config_value: serde_json::json!("light"),
        },
        // 权限设置
        QuickConfigOption {
            id: "perm_safe".to_string(),
            name: "安全模式".to_string(),
            description: "只允许读取文件，禁止写入和执行".to_string(),
            category: "权限".to_string(),
            config_key: "permissions".to_string(),
            config_value: serde_json::json!({
                "allow_read": true,
                "allow_write": false,
                "allow_execute": false
            }),
        },
        QuickConfigOption {
            id: "perm_normal".to_string(),
            name: "正常模式".to_string(),
            description: "允许读取和写入，禁止执行命令".to_string(),
            category: "权限".to_string(),
            config_key: "permissions".to_string(),
            config_value: serde_json::json!({
                "allow_read": true,
                "allow_write": true,
                "allow_execute": false
            }),
        },
        QuickConfigOption {
            id: "perm_full".to_string(),
            name: "完全权限".to_string(),
            description: "允许所有操作（需谨慎使用）".to_string(),
            category: "权限".to_string(),
            config_key: "permissions".to_string(),
            config_value: serde_json::json!({
                "allow_read": true,
                "allow_write": true,
                "allow_execute": true
            }),
        },
        // 行为设置
        QuickConfigOption {
            id: "auto_approve".to_string(),
            name: "自动批准安全操作".to_string(),
            description: "自动批准低风险操作，减少确认提示".to_string(),
            category: "行为".to_string(),
            config_key: "auto_approve_safe_operations".to_string(),
            config_value: serde_json::json!(true),
        },
        QuickConfigOption {
            id: "verbose_output".to_string(),
            name: "详细输出".to_string(),
            description: "显示更多调试信息和详细日志".to_string(),
            category: "行为".to_string(),
            config_key: "verbose".to_string(),
            config_value: serde_json::json!(true),
        },
        QuickConfigOption {
            id: "no_telemetry".to_string(),
            name: "禁用遥测".to_string(),
            description: "禁止发送使用数据和错误报告".to_string(),
            category: "隐私".to_string(),
            config_key: "telemetry".to_string(),
            config_value: serde_json::json!(false),
        },
    ])
}

/// 应用快捷配置
#[tauri::command]
pub async fn apply_quick_config(
    env_type: EnvType,
    env_name: String,
    config_path: String,
    options: Vec<String>,
) -> Result<(), String> {
    // 读取现有配置
    let existing_content = read_claude_config_file(env_type.clone(), env_name.clone(), config_path.clone()).await.ok();

    let mut config: serde_json::Value = if let Some(content) = existing_content {
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // 获取所有快捷配置选项
    let all_options = get_quick_config_options().await?;

    // 应用选中的配置
    for option_id in options {
        if let Some(opt) = all_options.iter().find(|o| o.id == option_id) {
            if let Some(obj) = config.as_object_mut() {
                obj.insert(opt.config_key.clone(), opt.config_value.clone());
            }
        }
    }

    // 写入配置
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("序列化配置失败: {}", e))?;

    write_claude_config_file(env_type, env_name, config_path, content).await
}

/// 获取保存的配置档案列表
#[tauri::command]
pub async fn get_config_profiles() -> Result<Vec<ConfigProfile>, String> {
    let profiles_path = get_profiles_storage_path();

    if !profiles_path.exists() {
        return Ok(vec![]);
    }

    let content = std::fs::read_to_string(&profiles_path)
        .map_err(|e| format!("读取配置档案失败: {}", e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("解析配置档案失败: {}", e))
}

/// 保存配置档案（如果名称已存在则更新，否则新建）
#[tauri::command]
pub async fn save_config_profile(
    name: String,
    description: Option<String>,
    settings: serde_json::Value,
) -> Result<ConfigProfile, String> {
    let mut profiles = get_config_profiles().await?;

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // 查找是否已存在同名档案
    if let Some(existing) = profiles.iter_mut().find(|p| p.name == name) {
        // 更新现有档案
        existing.description = description;
        existing.settings = settings;
        existing.updated_at = now;
        let profile = existing.clone();
        save_profiles(&profiles)?;
        return Ok(profile);
    }

    // 新建档案
    let profile = ConfigProfile {
        id: format!("{:x}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()),
        name,
        description,
        settings,
        created_at: now.clone(),
        updated_at: now,
    };

    profiles.push(profile.clone());
    save_profiles(&profiles)?;

    Ok(profile)
}

/// 删除配置档案
#[tauri::command]
pub async fn delete_config_profile(profile_id: String) -> Result<(), String> {
    let mut profiles = get_config_profiles().await?;
    profiles.retain(|p| p.id != profile_id);
    save_profiles(&profiles)
}

/// 应用配置档案
#[tauri::command]
pub async fn apply_config_profile(
    env_type: EnvType,
    env_name: String,
    config_path: String,
    profile_id: String,
) -> Result<(), String> {
    let profiles = get_config_profiles().await?;

    let profile = profiles.iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| "配置档案不存在".to_string())?;

    let content = serde_json::to_string_pretty(&profile.settings)
        .map_err(|e| format!("序列化配置失败: {}", e))?;

    write_claude_config_file(env_type, env_name, config_path, content).await
}

/// 获取配置档案存储路径
fn get_profiles_storage_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    config_dir.join("codeshelf").join("claude_profiles.json")
}

/// 保存配置档案到文件
fn save_profiles(profiles: &[ConfigProfile]) -> Result<(), String> {
    let path = get_profiles_storage_path();

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }

    let content = serde_json::to_string_pretty(profiles)
        .map_err(|e| format!("序列化配置档案失败: {}", e))?;

    std::fs::write(&path, content)
        .map_err(|e| format!("保存配置档案失败: {}", e))
}

/// 从当前配置创建档案
#[tauri::command]
pub async fn create_profile_from_current(
    env_type: EnvType,
    env_name: String,
    config_path: String,
    profile_name: String,
    description: Option<String>,
) -> Result<ConfigProfile, String> {
    let content = read_claude_config_file(env_type, env_name, config_path).await?;

    let settings: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析配置失败: {}", e))?;

    save_config_profile(profile_name, description, settings).await
}
