// Claude Code 工具箱：核心入口
//
// 子模块划分：
// - detect:       安装检测与版本扫描（host / WSL）
// - launch:       在终端中启动 claude
// - config_io:    配置文件读写、目录扫描、WSL UNC 处理
// - quick_config: 快捷配置选项与持久化
// - profiles:     配置档案（CRUD）
// - cache:        安装缓存与启动目录列表
//
// 本文件保留：跨模块共享的工具函数、类型，以及子模块声明与命令再导出。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

mod cache;
mod config_io;
mod detect;
mod launch;
mod profiles;
mod quick_config;

pub use cache::*;
pub use config_io::*;
pub use detect::*;
pub use launch::*;
pub use profiles::*;
pub use quick_config::*;

/// Windows 隐藏窗口标志
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 创建隐藏窗口的 Command（Windows 专用）
#[cfg(target_os = "windows")]
pub(super) fn new_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// 创建 Command（非 Windows）
#[cfg(not(target_os = "windows"))]
pub(super) fn new_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.env("PATH", get_augmented_path());
    cmd
}

/// 获取增强的 PATH（macOS/Linux）
/// macOS GUI 应用从 Finder/Dock 启动时只继承最小系统 PATH，
/// 需要手动补充常见安装目录
#[cfg(not(target_os = "windows"))]
pub(super) fn get_augmented_path() -> String {
    let current_path = std::env::var("PATH").unwrap_or_default();
    let extra = get_extra_path_dirs();

    let mut parts: Vec<&str> = current_path.split(':').collect();
    for dir in &extra {
        if !parts.contains(&dir.as_str()) {
            parts.push(dir.as_str());
        }
    }

    parts.join(":")
}

/// 获取需要额外添加到 PATH 的目录列表（不包含现有 PATH）
///
/// `pub(crate)`：dsh 引擎（commands/dsh）找 node/npm 时用的是同一套目录，
/// 与其抄第二份 nvm 扫描逻辑，不如共用这一份。
#[cfg(not(target_os = "windows"))]
pub(crate) fn get_extra_path_dirs() -> Vec<String> {
    let current_path = std::env::var("PATH").unwrap_or_default();
    let current_parts: Vec<&str> = current_path.split(':').collect();
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
    let home_str = home.to_string_lossy();

    let extra_dirs = [
        "/usr/local/bin".to_string(),
        "/opt/homebrew/bin".to_string(),
        format!("{}/.local/bin", home_str),
        format!("{}/.cargo/bin", home_str),
    ];

    // 收集所有 nvm 版本目录。
    //
    // `NVM_DIR` **被设成空串**是常见状态（某些 shell 初始化顺序下就是空的），
    // 而 `env::var` 对空串返回 `Ok("")` —— 直接 unwrap_or_else 会拿到空路径，
    // 拼出相对路径 "versions/node"，read_dir 必然失败，于是一个 nvm 版本都扫不到。
    // 实测就是它让「装了 node 22 却报只有 20」。空串一律当未设置。
    let nvm_dir_env = std::env::var("NVM_DIR")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("{}/.nvm", home_str));
    let mut nvm_bins: Vec<String> = Vec::new();
    let nvm_versions = PathBuf::from(&nvm_dir_env).join("versions/node");
    if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
        for entry in entries.flatten() {
            let bin = entry.path().join("bin");
            if bin.is_dir() {
                nvm_bins.push(bin.to_string_lossy().to_string());
            }
        }
    }

    extra_dirs
        .iter()
        .chain(nvm_bins.iter())
        .filter(|d| !current_parts.contains(&d.as_str()))
        .cloned()
        .collect()
}

/// 清理 WSL 命令输出中的特殊字符（\r, \0 等）
#[cfg(target_os = "windows")]
pub(super) fn clean_wsl_output(output: &[u8]) -> String {
    String::from_utf8_lossy(output)
        .trim()
        .replace('\r', "")
        .replace('\0', "")
}

/// 非 Windows 的 stub —— detect.rs 在 cfg 之外引用了该符号
#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
pub(super) fn clean_wsl_output(output: &[u8]) -> String {
    String::from_utf8_lossy(output).trim().to_string()
}

/// 获取主机配置目录
pub(super) fn get_host_config_dir() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        return home.join(".claude");
    }
    PathBuf::from(".claude")
}

// ============== 共享类型 ==============

/// 环境类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type)]
pub enum EnvType {
    #[serde(rename = "host")]
    Host,
    #[serde(rename = "wsl")]
    Wsl,
}

/// Claude Code 安装信息
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
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
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ConfigFileInfo {
    pub name: String,
    pub path: String,
    pub exists: bool,
    pub size: u64,
    pub modified: Option<String>,
    pub description: String,
}

/// 快捷配置选项
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct QuickConfigOption {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub config_key: String,
    pub config_value: serde_json::Value,
}

/// 保存的配置档案
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ConfigProfile {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub settings: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}
