// Claude Code 配置常量

import {
  Globe,
  Shield,
  Box,
  Clock,
  Download,
  Server,
  LogIn,
  Users,
  Zap,
  Tag,
  Variable,
  Palette,
  Settings,
} from "lucide-react";

// 只读文件列表
export const READONLY_FILES = [
  "history.jsonl",
  "stats-cache.json",
  "projects.json",
  "statsig.json",
  "credentials.json",
  "settings.local.json",
];

// 可编辑文件列表
export const EDITABLE_FILES = [
  "settings.json",
  "CLAUDE.md",
  ".clauderc",
];

// 配置文件参考文档
export const CONFIG_REFERENCES: Record<string, { title: string; sections: { name: string; description: string; example?: string }[] }> = {
  "CLAUDE.md": {
    title: "CLAUDE.md 配置参考",
    sections: [
      { name: "项目说明", description: "描述项目的基本信息、技术栈、架构等", example: "# 项目名称\n\n这是一个使用 React + TypeScript 的前端项目。" },
      { name: "代码规范", description: "定义代码风格、命名规范、文件组织等", example: "## 代码规范\n\n- 使用 camelCase 命名变量\n- 组件使用 PascalCase" },
      { name: "常用命令", description: "列出项目常用的开发、构建、测试命令", example: "## 常用命令\n\n- `npm run dev` - 启动开发服务器\n- `npm run build` - 构建生产版本" },
      { name: "注意事项", description: "AI 在处理代码时需要注意的特殊规则", example: "## 注意事项\n\n- 不要修改 config/ 目录下的文件\n- 所有 API 请求都需要错误处理" },
    ],
  },
  ".clauderc": {
    title: ".clauderc 配置参考",
    sections: [
      { name: "allowedTools", description: "允许 Claude 使用的工具列表", example: '{\n  "allowedTools": ["Read", "Write", "Bash"]\n}' },
      { name: "disallowedTools", description: "禁止 Claude 使用的工具列表", example: '{\n  "disallowedTools": ["WebSearch"]\n}' },
      { name: "permissions", description: "权限配置，控制文件访问范围", example: '{\n  "permissions": {\n    "allow": ["src/**"],\n    "deny": ["secrets/**"]\n  }\n}' },
    ],
  },
  "settings.json": {
    title: "settings.json 配置参考",
    sections: [
      { name: "model", description: "覆盖 Claude Code 使用的默认模型", example: '"model": "claude-sonnet-4-5-20250929"' },
      { name: "theme", description: "界面颜色主题", example: '"theme": "dark"  // system | light | dark' },
      { name: "language", description: "配置 Claude 的首选响应语言", example: '"language": "chinese"' },
      { name: "permissions", description: "权限规则配置", example: '{\n  "permissions": {\n    "allow": ["Bash(npm run *)", "Read(~/.zshrc)"],\n    "deny": ["Read(./.env)", "Read(./secrets/**)"],\n    "defaultMode": "acceptEdits"\n  }\n}' },
      { name: "env", description: "为每个会话设置环境变量（包括代理）", example: '{\n  "env": {\n    "HTTP_PROXY": "http://127.0.0.1:7890",\n    "HTTPS_PROXY": "http://127.0.0.1:7890",\n    "NO_PROXY": "localhost,127.0.0.1"\n  }\n}' },
      { name: "hooks", description: "配置自定义命令在生命周期事件处运行", example: '{\n  "hooks": {\n    "PreToolUse": [{\n      "matcher": "Edit",\n      "hooks": [{ "type": "command", "command": "echo Editing..." }]\n    }]\n  }\n}' },
      { name: "sandbox", description: "沙箱配置，隔离 bash 命令", example: '{\n  "sandbox": {\n    "enabled": true,\n    "network": {\n      "allowedDomains": ["github.com", "*.npmjs.org"]\n    }\n  }\n}' },
    ],
  },
};

// 快捷配置项定义
export interface QuickConfigOption {
  id: string;
  name: string;
  description: string;
  category: string;
  configKey: string;
  valueType: "string" | "boolean" | "number" | "select" | "model";
  defaultValue: unknown;
  options?: { label: string; value: unknown }[];
  placeholder?: string;
  allowEmpty?: boolean;
}

// 默认快捷配置
export const DEFAULT_QUICK_CONFIGS: QuickConfigOption[] = [
  // ============== 模型配置 ==============
  {
    id: "model",
    name: "默认模型",
    description: "覆盖 Claude Code 使用的默认模型",
    category: "模型",
    configKey: "model",
    valueType: "model",
    defaultValue: "",
    allowEmpty: true,
    options: [
      { label: "Claude Opus 4.5", value: "claude-opus-4-5-20251101" },
      { label: "Claude Sonnet 4.5", value: "claude-sonnet-4-5-20250929" },
      { label: "Claude Opus 4", value: "claude-opus-4-20250514" },
      { label: "Claude Sonnet 4", value: "claude-sonnet-4-20250514" },
      { label: "Claude 3.5 Sonnet", value: "claude-3-5-sonnet-20241022" },
      { label: "Claude 3.5 Haiku", value: "claude-3-5-haiku-20241022" },
      { label: "Claude 3 Opus", value: "claude-3-opus-20240229" },
    ],
  },

  // ============== 界面配置 ==============
  {
    id: "theme",
    name: "主题",
    description: "界面颜色主题",
    category: "界面",
    configKey: "theme",
    valueType: "select",
    defaultValue: "",
    allowEmpty: true,
    options: [
      { label: "跟随系统", value: "system" },
      { label: "浅色", value: "light" },
      { label: "深色", value: "dark" },
    ],
  },
  {
    id: "language",
    name: "响应语言",
    description: "配置 Claude 的首选响应语言",
    category: "界面",
    configKey: "language",
    valueType: "string",
    defaultValue: "",
    placeholder: "如: chinese, japanese, english",
    allowEmpty: true,
  },
  {
    id: "outputStyle",
    name: "输出样式",
    description: "配置输出样式以调整系统提示",
    category: "界面",
    configKey: "outputStyle",
    valueType: "string",
    defaultValue: "",
    placeholder: "如: Explanatory, Concise",
    allowEmpty: true,
  },
  {
    id: "showTurnDuration",
    name: "显示轮次时长",
    description: "在响应后显示轮次持续时间消息",
    category: "界面",
    configKey: "showTurnDuration",
    valueType: "boolean",
    defaultValue: "",
    allowEmpty: true,
  },
  {
    id: "spinnerTipsEnabled",
    name: "微调器提示",
    description: "在 Claude 工作时在微调器中显示提示",
    category: "界面",
    configKey: "spinnerTipsEnabled",
    valueType: "boolean",
    defaultValue: "",
    allowEmpty: true,
  },
  {
    id: "terminalProgressBarEnabled",
    name: "终端进度条",
    description: "启用终端进度条（Windows Terminal 和 iTerm2）",
    category: "界面",
    configKey: "terminalProgressBarEnabled",
    valueType: "boolean",
    defaultValue: "",
    allowEmpty: true,
  },
  {
    id: "prefersReducedMotion",
    name: "减少动画",
    description: "减少或禁用 UI 动画以实现可访问性",
    category: "界面",
    configKey: "prefersReducedMotion",
    valueType: "boolean",
    defaultValue: "",
    allowEmpty: true,
  },

  // ============== 代理配置 ==============
  {
    id: "httpProxy",
    name: "HTTP 代理",
    description: "HTTP 代理服务器地址",
    category: "代理",
    configKey: "env.HTTP_PROXY",
    valueType: "string",
    defaultValue: "",
    placeholder: "http://127.0.0.1:7890",
    allowEmpty: true,
  },
  {
    id: "httpsProxy",
    name: "HTTPS 代理",
    description: "HTTPS 代理服务器地址",
    category: "代理",
    configKey: "env.HTTPS_PROXY",
    valueType: "string",
    defaultValue: "",
    placeholder: "http://127.0.0.1:7890",
    allowEmpty: true,
  },
  {
    id: "noProxy",
    name: "不代理地址",
    description: "绕过代理的域和 IP 列表",
    category: "代理",
    configKey: "env.NO_PROXY",
    valueType: "string",
    defaultValue: "",
    placeholder: "localhost,127.0.0.1",
    allowEmpty: true,
  },

  // ============== 权限配置 ==============
  {
    id: "permissionDefaultMode",
    name: "默认权限模式",
    description: "打开 Claude Code 时的默认权限模式",
    category: "权限",
    configKey: "permissions.defaultMode",
    valueType: "select",
    defaultValue: "",
    allowEmpty: true,
    options: [
      { label: "接受编辑", value: "acceptEdits" },
      { label: "计划模式", value: "plan" },
      { label: "绕过权限", value: "bypassPermissions" },
    ],
  },
  {
    id: "disableBypassPermissionsMode",
    name: "禁用绕过权限",
    description: "设置为 disable 以防止激活 bypassPermissions 模式",
    category: "权限",
    configKey: "permissions.disableBypassPermissionsMode",
    valueType: "select",
    defaultValue: "",
    allowEmpty: true,
    options: [
      { label: "禁用", value: "disable" },
    ],
  },

  // ============== 沙箱配置 ==============
  {
    id: "sandboxEnabled",
    name: "启用沙箱",
    description: "启用 bash 沙箱（macOS、Linux 和 WSL2）",
    category: "沙箱",
    configKey: "sandbox.enabled",
    valueType: "boolean",
    defaultValue: "",
    allowEmpty: true,
  },
  {
    id: "autoAllowBashIfSandboxed",
    name: "沙箱自动批准",
    description: "沙箱化时自动批准 bash 命令",
    category: "沙箱",
    configKey: "sandbox.autoAllowBashIfSandboxed",
    valueType: "boolean",
    defaultValue: "",
    allowEmpty: true,
  },
  {
    id: "allowUnsandboxedCommands",
    name: "允许非沙箱命令",
    description: "允许命令通过 dangerouslyDisableSandbox 在沙箱外运行",
    category: "沙箱",
    configKey: "sandbox.allowUnsandboxedCommands",
    valueType: "boolean",
    defaultValue: "",
    allowEmpty: true,
  },
  {
    id: "sandboxAllowLocalBinding",
    name: "允许本地绑定",
    description: "允许绑定到 localhost 端口（仅 macOS）",
    category: "沙箱",
    configKey: "sandbox.network.allowLocalBinding",
    valueType: "boolean",
    defaultValue: "",
    allowEmpty: true,
  },
  {
    id: "sandboxAllowAllUnixSockets",
    name: "允许所有 Unix 套接字",
    description: "允许沙箱中的所有 Unix 套接字连接",
    category: "沙箱",
    configKey: "sandbox.network.allowAllUnixSockets",
    valueType: "boolean",
    defaultValue: "",
    allowEmpty: true,
  },

  // ============== 会话配置 ==============
  {
    id: "cleanupPeriodDays",
    name: "会话清理周期",
    description: "非活动时间超过此天数的会话在启动时被删除（默认30天，0为立即删除）",
    category: "会话",
    configKey: "cleanupPeriodDays",
    valueType: "number",
    defaultValue: "",
    placeholder: "30",
    allowEmpty: true,
  },
  {
    id: "plansDirectory",
    name: "计划文件目录",
    description: "自定义计划文件的存储位置（相对于项目根目录）",
    category: "会话",
    configKey: "plansDirectory",
    valueType: "string",
    defaultValue: "",
    placeholder: "./plans",
    allowEmpty: true,
  },
  {
    id: "alwaysThinkingEnabled",
    name: "始终启用思考",
    description: "为所有会话默认启用扩展思考",
    category: "会话",
    configKey: "alwaysThinkingEnabled",
    valueType: "boolean",
    defaultValue: "",
    allowEmpty: true,
  },

  // ============== 更新配置 ==============
  {
    id: "autoUpdatesChannel",
    name: "自动更新渠道",
    description: "遵循更新的发布渠道",
    category: "更新",
    configKey: "autoUpdatesChannel",
    valueType: "select",
    defaultValue: "",
    allowEmpty: true,
    options: [
      { label: "最新版 (latest)", value: "latest" },
      { label: "稳定版 (stable)", value: "stable" },
    ],
  },

  // ============== MCP 配置 ==============
  {
    id: "enableAllProjectMcpServers",
    name: "启用所有项目 MCP",
    description: "自动批准项目 .mcp.json 文件中定义的所有 MCP servers",
    category: "MCP",
    configKey: "enableAllProjectMcpServers",
    valueType: "boolean",
    defaultValue: "",
    allowEmpty: true,
  },

  // ============== 登录配置 ==============
  {
    id: "forceLoginMethod",
    name: "强制登录方式",
    description: "限制登录方式",
    category: "登录",
    configKey: "forceLoginMethod",
    valueType: "select",
    defaultValue: "",
    allowEmpty: true,
    options: [
      { label: "Claude.ai 账户", value: "claudeai" },
      { label: "Claude Console (API)", value: "console" },
    ],
  },

  // ============== Agent Teams ==============
  {
    id: "teammateMode",
    name: "队友模式",
    description: "Agent team 队友的显示方式",
    category: "Agent Teams",
    configKey: "teammateMode",
    valueType: "select",
    defaultValue: "",
    allowEmpty: true,
    options: [
      { label: "自动 (auto)", value: "auto" },
      { label: "进程内 (in-process)", value: "in-process" },
      { label: "tmux", value: "tmux" },
    ],
  },

  // ============== Hooks 配置 ==============
  {
    id: "disableAllHooks",
    name: "禁用所有 Hooks",
    description: "禁用所有 hooks",
    category: "Hooks",
    configKey: "disableAllHooks",
    valueType: "boolean",
    defaultValue: "",
    allowEmpty: true,
  },

  // ============== 归属配置 ==============
  {
    id: "attributionCommit",
    name: "提交归属",
    description: "git 提交的归属信息（空字符串隐藏归属）",
    category: "归属",
    configKey: "attribution.commit",
    valueType: "string",
    defaultValue: "",
    placeholder: "🤖 Generated with Claude Code",
    allowEmpty: true,
  },
  {
    id: "attributionPr",
    name: "PR 归属",
    description: "拉取请求描述的归属信息（空字符串隐藏归属）",
    category: "归属",
    configKey: "attribution.pr",
    valueType: "string",
    defaultValue: "",
    placeholder: "🤖 Generated with Claude Code",
    allowEmpty: true,
  },

  // ============== 环境变量 ==============
  {
    id: "attributionHeader",
    name: "归属标头",
    description: "自定义归属标头文本，设置为 0 可禁用",
    category: "环境变量",
    configKey: "env.CLAUDE_CODE_ATTRIBUTION_HEADER",
    valueType: "string",
    defaultValue: "0",
    placeholder: "Generated by Claude Code 或 0 禁用",
    allowEmpty: true,
  },
  {
    id: "disableNonessentialTraffic",
    name: "禁用非必要流量",
    description: "禁用自动更新、错误报告、遥测等（设为 1 启用）",
    category: "环境变量",
    configKey: "env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    valueType: "select",
    defaultValue: "1",
    allowEmpty: true,
    options: [
      { label: "启用 (1)", value: "1" },
      { label: "禁用 (0)", value: "0" },
    ],
  },
  {
    id: "disableTelemetry",
    name: "禁用遥测",
    description: "选择退出 Statsig 遥测",
    category: "环境变量",
    configKey: "env.DISABLE_TELEMETRY",
    valueType: "select",
    defaultValue: "",
    allowEmpty: true,
    options: [
      { label: "禁用 (1)", value: "1" },
    ],
  },
  {
    id: "disableAutoUpdater",
    name: "禁用自动更新",
    description: "禁用自动更新检查",
    category: "环境变量",
    configKey: "env.DISABLE_AUTOUPDATER",
    valueType: "select",
    defaultValue: "",
    allowEmpty: true,
    options: [
      { label: "禁用 (1)", value: "1" },
    ],
  },
  {
    id: "maxThinkingTokens",
    name: "最大思考令牌",
    description: "覆盖扩展思考令牌预算（0 禁用思考）",
    category: "环境变量",
    configKey: "env.MAX_THINKING_TOKENS",
    valueType: "number",
    defaultValue: "",
    placeholder: "31999",
    allowEmpty: true,
  },
];

// 本地存储 key
export const QUICK_CONFIGS_STORAGE_KEY = "claude-code-quick-configs";

// 获取分类图标
export function getCategoryIcon(category: string) {
  switch (category) {
    case "模型": return Palette;
    case "界面": return Palette;
    case "代理": return Globe;
    case "权限": return Shield;
    case "沙箱": return Box;
    case "会话": return Clock;
    case "更新": return Download;
    case "MCP": return Server;
    case "登录": return LogIn;
    case "Agent Teams": return Users;
    case "Hooks": return Zap;
    case "归属": return Tag;
    case "环境变量": return Variable;
    default: return Settings;
  }
}

// 加载快捷配置
export function loadQuickConfigs(): QuickConfigOption[] {
  try {
    const saved = localStorage.getItem(QUICK_CONFIGS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // 合并默认配置，确保新增的配置项也能显示
      const savedIds = new Set(parsed.map((c: QuickConfigOption) => c.id));
      const merged = [...parsed];
      // 添加默认配置中存在但本地存储中不存在的配置
      DEFAULT_QUICK_CONFIGS.forEach(defaultConfig => {
        if (!savedIds.has(defaultConfig.id)) {
          merged.push(defaultConfig);
        }
      });
      return merged;
    }
  } catch {
    // ignore
  }
  return DEFAULT_QUICK_CONFIGS;
}

// 保存快捷配置
export function saveQuickConfigs(configs: QuickConfigOption[]) {
  localStorage.setItem(QUICK_CONFIGS_STORAGE_KEY, JSON.stringify(configs));
}

// 嵌套键操作工具函数
export function getNestedValue(obj: Record<string, unknown>, keys: string[]): unknown {
  let current: unknown = obj;
  for (const key of keys) {
    if (current && typeof current === "object" && key in (current as object)) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

export function setNestedKey(obj: Record<string, unknown>, keys: string[], value: unknown) {
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

export function deleteNestedKey(obj: Record<string, unknown>, keys: string[]) {
  if (keys.length === 1) {
    delete obj[keys[0]];
    return;
  }

  const key = keys[0];
  if (obj[key] && typeof obj[key] === "object") {
    deleteNestedKey(obj[key] as Record<string, unknown>, keys.slice(1));
    if (Object.keys(obj[key] as object).length === 0) {
      delete obj[key];
    }
  }
}
