//! Tool schema 定义 + 全量工具清单（含平台感知的描述）。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolSchema {
    pub name: String,
    pub description: String,
    pub parameters: Value,
    pub requires_cwd: bool,
}

pub fn all_tools() -> Vec<ToolSchema> {
    // 当前 OS 提示，让 LLM 选用正确的 shell 命令与路径风格
    let os_label = if cfg!(target_os = "windows") {
        "Windows"
    } else if cfg!(target_os = "macos") {
        "macOS"
    } else {
        "Linux/Unix"
    };
    let bash_extra = if cfg!(target_os = "windows") {
        "。当前系统：Windows，底层用 cmd /C 执行，请使用 dir / type / findstr / del / copy 等 Windows 命令，禁用 ls / cat / grep / rm 等 Unix 命令"
    } else {
        "。当前系统：Unix-like（macOS/Linux），底层用 /bin/sh -c"
    };
    let bash_desc = format!(
        "在 allowedCwd 中执行 shell 命令，返回 stdout/stderr 合并截断结果{}",
        bash_extra
    );
    let path_style_hint = if cfg!(target_os = "windows") {
        "Windows 路径如 C:\\\\Users\\\\name\\\\Documents 或 C:/Users/name/Documents"
    } else {
        "Unix 路径如 /Users/name 或 /home/name"
    };
    let editor_examples = if cfg!(target_os = "windows") {
        "可执行路径如 C:\\\\Program Files\\\\Microsoft VS Code\\\\Code.exe 或 cursor.exe"
    } else if cfg!(target_os = "macos") {
        "可执行路径如 /usr/local/bin/cursor 或 macOS 应用包路径如 /Applications/Sublime Text.app"
    } else {
        "可执行路径如 /usr/bin/code 或 /usr/bin/cursor"
    };
    let editor_desc = format!(
        "在代码编辑器中打开指定文件或目录，默认 VS Code。editor 可传 {}",
        editor_examples,
    );
    let _ = (os_label, path_style_hint); // 备用：以后若想在 Read/Write 描述里也注入路径风格提示
    vec![
        ToolSchema {
            name: "Read".into(),
            description: "读取文件内容，返回带行号的文本。path 必须在会话 allowedCwd 下。".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "绝对路径或相对 allowedCwd"},
                    "offset": {"type": "integer", "description": "起始行号（1 基）"},
                    "limit": {"type": "integer", "description": "读取行数，缺省 2000"}
                },
                "required": ["path"]
            }),
            requires_cwd: true,
        },
        ToolSchema {
            name: "Write".into(),
            description: "写入/覆盖文件，content 是完整文件内容".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"}
                },
                "required": ["path", "content"]
            }),
            requires_cwd: true,
        },
        ToolSchema {
            name: "Edit".into(),
            description: "将 path 中的 oldString 替换为 newString。oldString 必须在文件中唯一出现。".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "oldString": {"type": "string"},
                    "newString": {"type": "string"}
                },
                "required": ["path", "oldString", "newString"]
            }),
            requires_cwd: true,
        },
        ToolSchema {
            name: "Glob".into(),
            description: "glob 模式匹配文件，相对 allowedCwd".into(),
            parameters: json!({
                "type": "object",
                "properties": {"pattern": {"type": "string"}},
                "required": ["pattern"]
            }),
            requires_cwd: true,
        },
        ToolSchema {
            name: "Grep".into(),
            description: "在 allowedCwd 下按正则搜索（逐行），glob 可选限制文件".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "pattern": {"type": "string"},
                    "glob": {"type": "string", "description": "文件过滤，如 **/*.ts"}
                },
                "required": ["pattern"]
            }),
            requires_cwd: true,
        },
        ToolSchema {
            name: "Bash".into(),
            description: bash_desc,
            parameters: json!({
                "type": "object",
                "properties": {
                    "command": {"type": "string"},
                    "timeout": {"type": "integer", "description": "超时毫秒，缺省 60000"}
                },
                "required": ["command"]
            }),
            requires_cwd: true,
        },
        ToolSchema {
            name: "TaskCreate".into(),
            description: "在本会话任务面板新增一条任务".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "subject": {"type": "string"},
                    "description": {"type": "string"},
                    "activeForm": {"type": "string"}
                },
                "required": ["subject", "description"]
            }),
            requires_cwd: false,
        },
        ToolSchema {
            name: "TaskUpdate".into(),
            description: "更新任务状态或字段".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "taskId": {"type": "string"},
                    "status": {"type": "string", "enum": ["pending", "in_progress", "completed"]},
                    "subject": {"type": "string"},
                    "description": {"type": "string"}
                },
                "required": ["taskId"]
            }),
            requires_cwd: false,
        },
        ToolSchema {
            name: "TaskList".into(),
            description: "列出本会话所有任务".into(),
            parameters: json!({"type": "object", "properties": {}}),
            requires_cwd: false,
        },
        ToolSchema {
            name: "WebFetch".into(),
            description: "获取任意公开 HTTP(S) URL 的内容。自动识别 HTML / JSON / 纯文本并做对应处理：HTML 剥标签保留正文；JSON 美化输出；纯文本原样；二进制（图片/PDF/压缩包等）只返回大小与类型摘要。支持可选 headers（如 Accept / Authorization），默认超时 20s，响应上限 2MB。".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "必填，http(s):// 开头的完整 URL"},
                    "max_bytes": {"type": "integer", "description": "最大返回字节数，默认 500000，上限 2000000"},
                    "headers": {
                        "type": "object",
                        "description": "可选请求头，键值均为字符串。常用：Accept、Authorization、User-Agent",
                        "additionalProperties": {"type": "string"}
                    }
                },
                "required": ["url"]
            }),
            requires_cwd: false,
        },
        ToolSchema {
            name: "OpenPath".into(),
            description: "在系统文件管理器（macOS Finder / Windows Explorer / Linux xdg-open）中打开指定路径。可打开文件或目录。".into(),
            parameters: json!({
                "type": "object",
                "properties": {"path": {"type": "string", "description": "绝对路径"}},
                "required": ["path"]
            }),
            requires_cwd: false,
        },
        ToolSchema {
            name: "OpenInEditor".into(),
            description: editor_desc,
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "绝对路径"},
                    "editor": {"type": "string", "description": "可选，编辑器路径。不填使用 VS Code"}
                },
                "required": ["path"]
            }),
            requires_cwd: false,
        },
        ToolSchema {
            name: "OpenTerminal".into(),
            description: "在指定目录打开终端。macOS 默认 Terminal.app，Windows 可选 powershell/cmd/wt，Linux 用默认 X 终端。".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "要切换到的目录绝对路径"},
                    "terminal": {"type": "string", "description": "可选，终端类型：default/iterm/powershell/cmd/wt"}
                },
                "required": ["path"]
            }),
            requires_cwd: false,
        },
        ToolSchema {
            name: "OpenUrl".into(),
            description: "在默认浏览器中打开 URL。".into(),
            parameters: json!({
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"]
            }),
            requires_cwd: false,
        },
        ToolSchema {
            name: "CopyFile".into(),
            description: "复制文件或目录（目录递归）。源和目标都必须在会话工作目录内。若目标已存在，默认拒绝；overwrite=true 才覆盖。".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "src": {"type": "string", "description": "源路径（绝对，须在会话工作目录内）"},
                    "dst": {"type": "string", "description": "目标路径（绝对，须在会话工作目录内）"},
                    "overwrite": {"type": "boolean", "description": "默认 false"}
                },
                "required": ["src", "dst"]
            }),
            requires_cwd: false,
        },
        ToolSchema {
            name: "MoveFile".into(),
            description: "移动/重命名文件或目录。源和目标都必须在会话工作目录内。同盘用 rename，跨盘自动 copy+delete。".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "src": {"type": "string"},
                    "dst": {"type": "string"},
                    "overwrite": {"type": "boolean", "description": "默认 false"}
                },
                "required": ["src", "dst"]
            }),
            requires_cwd: false,
        },
        ToolSchema {
            name: "DeleteFile".into(),
            description: "⚠️ 危险：删除会话工作目录内的文件或目录（目录需 recursive=true）。无法恢复，调用前务必与用户确认。".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "recursive": {"type": "boolean", "description": "删除目录时必须为 true"}
                },
                "required": ["path"]
            }),
            requires_cwd: false,
        },
        ToolSchema {
            name: "CreateWorkflow".into(),
            description: "创建一个定时工作流。nodes 支持 web_fetch / llm / webhook 三类节点；cron 为 5 段表达式（分 时 日 月 周）。创建后立即生效。".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "cron": {"type": "string", "description": "5 段 cron，如 '0 9 * * *' 每天 9 点"},
                    "enabled": {"type": "boolean", "description": "默认 true"},
                    "nodes": {
                        "type": "array",
                        "description": "节点数组，每个 {id, nodeType, config, dependsOn[]}",
                        "items": {"type": "object"}
                    }
                },
                "required": ["name", "cron", "nodes"]
            }),
            requires_cwd: false,
        },
        ToolSchema {
            name: "RunWorkflowNow".into(),
            description: "立即触发一次指定 id 的工作流，忽略 cron 时间。".into(),
            parameters: json!({
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"]
            }),
            requires_cwd: false,
        },
        ToolSchema {
            name: "ListWorkflows".into(),
            description: "列出所有已保存的工作流（含最近一次运行状态）。".into(),
            parameters: json!({"type": "object", "properties": {}}),
            requires_cwd: false,
        },
    ]
}
