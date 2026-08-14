// dsh 运行时：环境探测 + 托管安装。
//
// 为什么是「托管安装」而不是用用户全局的 dsh：dsh 现在是 developer preview，
// 官方明说会有破坏性变更。我们把版本 pin 死装进应用数据目录，用户机器上的
// `npm i -g dsh` 升级到新 rc 时不会把 CodeShelf 的对话打挂。

use crate::error::{AppError, AppResult};
use crate::storage::{get_storage_config, write_atomic};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// 装哪个版本。**不要改成 latest** —— rc 版之间协议会变，出问题时用户看到的是
/// 「对话卡住」而不是「版本不兼容」。升级此常量必须重跑 docs/specs/dsh-engine.md 的冒烟。
pub const DSH_VERSION: &str = "0.1.0-rc.6";

/// profile 目录名（$DSH_HOME/profiles/<名字>）
pub const PROFILE_NAME: &str = "codeshelf";

/// dsh 依赖 Promise.withResolvers / zlib.createZstdDecompress，Node 20 上插件树直接加载失败。
pub const NODE_MIN_MAJOR: u32 = 22;

/// 安装过程按行推给前端的事件名
const INSTALL_LOG_EVENT: &str = "dsh-install-log";

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DshEnvStatus {
    /// 选中的 node 可执行文件（优先满足最低版本的那个）
    pub node_path: Option<String>,
    pub node_version: Option<String>,
    /// node 存在且主版本号 >= NODE_MIN_MAJOR
    pub node_ok: bool,
    pub node_min_major: u32,
    pub npm_path: Option<String>,
    /// dsh 已装进数据目录且入口文件存在
    pub installed: bool,
    pub installed_version: Option<String>,
    pub target_version: String,
    /// profile 的两个文件与其 node_modules 都就绪
    pub profile_ready: bool,
    pub root: String,
    pub home: String,
    pub profile_dir: String,
}

// ========== 路径 ==========

/// 所有 dsh 相关文件都在这一个目录下，卸载 = 删掉它。
pub fn dsh_root() -> AppResult<PathBuf> {
    Ok(get_storage_config()?.data_dir.join("dsh"))
}

/// 传给子进程的 $DSH_HOME（profile 与 dsh 自己的状态都落在这里）
pub fn dsh_home() -> AppResult<PathBuf> {
    Ok(dsh_root()?.join("home"))
}

pub fn profile_dir() -> AppResult<PathBuf> {
    Ok(dsh_home()?.join("profiles").join(PROFILE_NAME))
}

/// dsh 的 Node 入口。直接跑这个 js 而不是 .bin/dsh 包装脚本：
/// 包装脚本在 Windows 上是 .cmd，还要经过一层 shell，路径带空格时容易出岔子。
pub fn dsh_entry_js() -> AppResult<PathBuf> {
    Ok(dsh_root()?
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("lib")
        .join("bin.js"))
}

// ========== node / npm 探测 ==========

/// PATH 之外还要找的目录：macOS 从 Dock 启动时只继承最小 PATH，nvm 装的 node 全在
/// ~/.nvm/versions/node/*/bin 下。复用 Claude Code 工具箱里同一份实现，不再抄一遍。
#[cfg(not(target_os = "windows"))]
fn extra_bin_dirs() -> Vec<PathBuf> {
    crate::commands::toolbox::claude_code::get_extra_path_dirs()
        .into_iter()
        .map(PathBuf::from)
        .collect()
}

#[cfg(target_os = "windows")]
fn extra_bin_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        dirs.push(PathBuf::from(program_files).join("nodejs"));
    }
    if let Some(local) = dirs::data_local_dir() {
        dirs.push(local.join("Programs").join("nodejs"));
        // fnm / volta 常见落点
        dirs.push(local.join("fnm_multishells"));
    }
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join("AppData").join("Roaming").join("npm"));
    }
    dirs
}

#[cfg(target_os = "windows")]
const NODE_EXE: &str = "node.exe";
#[cfg(not(target_os = "windows"))]
const NODE_EXE: &str = "node";

/// 给子进程用的 PATH：系统 PATH + 常见安装目录，选中的 node 所在目录排最前
/// （npm 会用 PATH 里第一个 node 跑自己，顺序错了就会用回旧版本）。
fn augmented_path(node_dir: Option<&Path>) -> String {
    let sep = if cfg!(windows) { ';' } else { ':' };
    let mut parts: Vec<String> = Vec::new();
    if let Some(dir) = node_dir {
        parts.push(dir.to_string_lossy().to_string());
    }
    for p in std::env::var("PATH").unwrap_or_default().split(sep) {
        if !p.is_empty() && !parts.iter().any(|x| x == p) {
            parts.push(p.to_string());
        }
    }
    for dir in extra_bin_dirs() {
        let s = dir.to_string_lossy().to_string();
        if !parts.iter().any(|x| x == &s) {
            parts.push(s);
        }
    }
    parts.join(&sep.to_string())
}

fn parse_major(version: &str) -> Option<u32> {
    version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .next()?
        .parse()
        .ok()
}

/// 跑 `<node> -v`。探测失败（不存在/不可执行）返回 None。
async fn probe_node(exe: &Path) -> Option<(String, u32)> {
    let mut cmd = Command::new(exe);
    cmd.arg("-v").env("PATH", augmented_path(None));
    crate::process_guard::configure(&mut cmd);
    let out = cmd.output().await.ok()?;
    if !out.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let major = parse_major(&version)?;
    Some((version, major))
}

struct NodeInfo {
    path: PathBuf,
    version: String,
    major: u32,
}

/// 找一个可用的 node：优先满足最低版本的；都不满足时**仍然返回**找到的那个，
/// 好让界面能说清「你有 v20，但需要 v22」，而不是笼统的「未找到 Node」。
async fn find_node() -> Option<NodeInfo> {
    let mut candidates: Vec<PathBuf> = vec![PathBuf::from(NODE_EXE)];
    for dir in extra_bin_dirs() {
        candidates.push(dir.join(NODE_EXE));
    }

    let mut fallback: Option<NodeInfo> = None;
    for path in candidates {
        let Some((version, major)) = probe_node(&path).await else {
            continue;
        };
        let info = NodeInfo {
            path,
            version,
            major,
        };
        if info.major >= NODE_MIN_MAJOR {
            return Some(info);
        }
        if fallback.is_none() {
            fallback = Some(info);
        }
    }
    fallback
}

#[cfg(target_os = "windows")]
const NPM_EXE: &str = "npm.cmd";
#[cfg(not(target_os = "windows"))]
const NPM_EXE: &str = "npm";

/// npm 优先取选中 node 的同目录（nvm/官方包都是这个布局），保证 npm 与 node 版本配套；
/// 否则退回 PATH 上的 npm。
fn npm_for(node: Option<&NodeInfo>) -> Option<PathBuf> {
    if let Some(dir) = node.and_then(|n| n.path.parent()) {
        let sibling = dir.join(NPM_EXE);
        if sibling.exists() {
            return Some(sibling);
        }
    }
    // 裸名字交给 PATH 解析；能不能跑起来在真正执行时才知道
    Some(PathBuf::from(NPM_EXE))
}

// ========== 命令 ==========

#[tauri::command]
#[specta::specta]
pub async fn dsh_env_status() -> AppResult<DshEnvStatus> {
    let root = dsh_root()?;
    let home = dsh_home()?;
    let profile = profile_dir()?;
    let node = find_node().await;

    let entry = dsh_entry_js()?;
    let installed = entry.exists();
    let installed_version = installed_dsh_version(&root);
    let profile_ready = profile.join("package.json").exists()
        && profile.join("cordis.patch.yml").exists()
        && profile
            .join("node_modules")
            .join("@deepseek-ai")
            .join("dsh-sdk-jsonrpc-server")
            .exists();

    Ok(DshEnvStatus {
        node_path: node.as_ref().map(|n| n.path.to_string_lossy().to_string()),
        node_version: node.as_ref().map(|n| n.version.clone()),
        node_ok: node.as_ref().is_some_and(|n| n.major >= NODE_MIN_MAJOR),
        node_min_major: NODE_MIN_MAJOR,
        npm_path: npm_for(node.as_ref()).map(|p| p.to_string_lossy().to_string()),
        installed,
        installed_version,
        target_version: DSH_VERSION.to_string(),
        profile_ready,
        root: root.to_string_lossy().to_string(),
        home: home.to_string_lossy().to_string(),
        profile_dir: profile.to_string_lossy().to_string(),
    })
}

/// 读已装 dsh 的 package.json 版本号；读不出来就当没装明白，返回 None。
fn installed_dsh_version(root: &Path) -> Option<String> {
    let pkg = root
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("package.json");
    let text = std::fs::read_to_string(pkg).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value
        .get("version")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// 安装/重装 dsh 与 profile。全过程日志按行发 `dsh-install-log` 事件。
#[tauri::command]
#[specta::specta]
pub async fn dsh_install(app: AppHandle) -> AppResult<DshEnvStatus> {
    let node = find_node()
        .await
        .ok_or_else(|| AppError::Other("未找到 Node.js，请先安装 Node 22 或更高版本".into()))?;
    if node.major < NODE_MIN_MAJOR {
        return Err(AppError::Other(format!(
            "Node 版本过低：{}（dsh 需要 v{} 及以上）",
            node.version, NODE_MIN_MAJOR
        )));
    }
    let npm = npm_for(Some(&node))
        .ok_or_else(|| AppError::Other("未找到 npm，请确认 Node 安装完整".into()))?;

    let root = dsh_root()?;
    let profile = profile_dir()?;
    std::fs::create_dir_all(&root)?;
    std::fs::create_dir_all(&profile)?;

    // npm 需要一个 package.json 才把这里当成安装根；没有它会一路往上找，
    // 最坏情况把包装到用户家目录去。
    write_atomic(
        root.join("package.json"),
        r#"{
  "name": "codeshelf-dsh-root",
  "private": true
}
"#,
    )?;

    log_line(&app, format!("安装 @deepseek-ai/dsh@{DSH_VERSION} …"));
    run_npm(
        &app,
        &npm,
        &node,
        &root,
        &[
            "install",
            &format!("@deepseek-ai/dsh@{DSH_VERSION}"),
            "--no-fund",
            "--no-audit",
        ],
    )
    .await?;

    log_line(&app, "写入 profile …".to_string());
    write_atomic(profile.join("package.json"), profile_package_json())?;
    write_atomic(profile.join("cordis.patch.yml"), PROFILE_PATCH)?;

    // --legacy-peer-deps：只装 profile 自己声明的两个插件包。默认行为会把 peer
    // （dsh-agent / dsh-llm / dsh-session …）再装一份到 profile 里，与 dsh 本体的副本
    // 重复，白白多出二十几个包。实测只装这两个就能正常加载。
    log_line(&app, "安装 profile 插件 …".to_string());
    run_npm(
        &app,
        &npm,
        &node,
        &profile,
        &["install", "--legacy-peer-deps", "--no-fund", "--no-audit"],
    )
    .await?;

    log_line(&app, "完成".to_string());
    dsh_env_status().await
}

/// 卸载：只删我们自己那一个目录。
#[tauri::command]
#[specta::specta]
pub async fn dsh_uninstall() -> AppResult<DshEnvStatus> {
    let root = dsh_root()?;
    if root.exists() {
        std::fs::remove_dir_all(&root)?;
    }
    dsh_env_status().await
}

fn log_line(app: &AppHandle, line: String) {
    let _ = app.emit(INSTALL_LOG_EVENT, line);
}

/// 跑一条 npm 命令，stdout/stderr 都按行转发给前端。
/// npm 把进度和警告写在 stderr，安装失败时那里才有原因，所以两条流都要收。
async fn run_npm(
    app: &AppHandle,
    npm: &Path,
    node: &NodeInfo,
    cwd: &Path,
    args: &[&str],
) -> AppResult<()> {
    let mut cmd = Command::new(npm);
    cmd.args(args)
        .current_dir(cwd)
        .env("PATH", augmented_path(node.path.parent()))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::process_guard::configure(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| {
        AppError::Other(format!("启动 npm 失败（{}）: {}", npm.to_string_lossy(), e))
    })?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let app_out = app.clone();
    let out_task = tokio::spawn(async move {
        let Some(stdout) = stdout else { return };
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            log_line(&app_out, line);
        }
    });
    let app_err = app.clone();
    let err_task = tokio::spawn(async move {
        let Some(stderr) = stderr else {
            return String::new();
        };
        let mut lines = BufReader::new(stderr).lines();
        let mut tail = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            log_line(&app_err, line.clone());
            tail.push_str(&line);
            tail.push('\n');
        }
        tail
    });

    let status = child.wait().await?;
    let _ = out_task.await;
    let stderr_tail = err_task.await.unwrap_or_default();
    if !status.success() {
        return Err(AppError::Other(format!(
            "npm {} 失败（退出码 {}）：{}",
            args.join(" "),
            status.code().unwrap_or(-1),
            stderr_tail.lines().rev().take(5).collect::<Vec<_>>().join(" / ")
        )));
    }
    Ok(())
}

// ========== profile 内容 ==========

fn profile_package_json() -> String {
    format!(
        r#"{{
  "name": "dsh-profile-{PROFILE_NAME}",
  "private": true,
  "dependencies": {{
    "@deepseek-ai/dsh-sdk-jsonrpc-server": "{DSH_VERSION}",
    "@deepseek-ai/dsh-sdk-protocol": "{DSH_VERSION}"
  }},
  "dsh": {{
    "profile": {{
      "bundles": ["@deepseek-ai/dsh-base"]
    }}
  }}
}}
"#
    )
}

/// profile 的 patch 层。三处改动都是**必须的**，改动前先看注释：
///
/// - hmr 关掉：dsh-base 默认挂 HMR，它要求 node 带 `--expose-internals`，
///   我们直接跑 bin.js 没有这个参数，不关就是启动即失败。
/// - approval 改成 never：JSON-RPC 协议里服务端**不会**向客户端发请求（官方文档明写
///   「server→client requests are dead capability」），所以没有任何通道能把审批问题
///   递给用户。保持默认的 `ask` 会让 agent 停在等审批上，表现为对话卡死。
/// - presets 三个都改成 never：permission-presets 会校验「组合出来的 sandbox+approval
///   必须命中某个预设」，只改 approval 而不同步改预设表会直接报
///   `composed sandbox and approval defaults match no preset` 起不来。
///
/// 写入的沙箱模式仍是 workspace-write（由 DSH_PERMISSION_MODE 决定，默认值即此），
/// 也就是文件写入被限制在会话工作目录内。
const PROFILE_PATCH: &str = r#"# CodeShelf 托管的 dsh profile 补丁层。由应用生成，手改会在下次安装时被覆盖。
- id: hmr
  disabled: true

- id: approval
  config:
    policy: never

- id: permission
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: never
      workspace-write:
        sandbox: workspace-write
        approval: never
      danger-full-access:
        sandbox: danger-full-access
        approval: never

- insert:
    - id: jsonrpc
      name: '@deepseek-ai/dsh-sdk-jsonrpc-server'
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_node_major() {
        assert_eq!(parse_major("v22.22.0"), Some(22));
        assert_eq!(parse_major("20.20.0"), Some(20));
        assert_eq!(parse_major(""), None);
        assert_eq!(parse_major("vX.Y.Z"), None);
    }

    /// profile 的两个文件是「实测能启动」的那一份，跑偏了 dsh 会在启动阶段直接失败。
    /// 这里锁住关键行，避免以后顺手改坏。
    #[test]
    fn profile_files_keep_required_bits() {
        let pkg = profile_package_json();
        assert!(pkg.contains("@deepseek-ai/dsh-base"), "必须基于 dsh-base 组合");
        assert!(pkg.contains("dsh-sdk-jsonrpc-server"));
        assert!(pkg.contains(DSH_VERSION), "插件版本要与 dsh 主体同版本");

        assert!(PROFILE_PATCH.contains("id: hmr"));
        assert!(PROFILE_PATCH.contains("disabled: true"));
        assert!(PROFILE_PATCH.contains("policy: never"));
        // 预设表要与 approval 同步，否则 permission-presets 校验不过
        assert_eq!(PROFILE_PATCH.matches("approval: never").count(), 3);
        assert!(PROFILE_PATCH.contains("@deepseek-ai/dsh-sdk-jsonrpc-server"));
    }
}
