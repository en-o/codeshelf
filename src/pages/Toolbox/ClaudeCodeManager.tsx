import { useState, useEffect } from "react";
import {
  Terminal,
  RefreshCw,
  Loader2,
  FolderOpen,
  FileText,
  Plus,
  Save,
  AlertCircle,
  CheckCircle,
  X,
  Trash2,
  Copy,
  ChevronDown,
  ChevronRight,
  Settings,
  Globe,
  Edit3,
  Power,
  Lock,
  GripVertical,
  Info,
  Sliders,
  Check,
  BookOpen,
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
} from "lucide-react";
import { ToolPanelHeader } from "./index";
import { Button } from "@/components/ui";
import {
  checkAllClaudeInstallations,
  readClaudeConfigFile,
  writeClaudeConfigFile,
  openClaudeConfigDir,
  getConfigProfiles,
  deleteConfigProfile,
  saveConfigProfile,
} from "@/services/toolbox";
import type { ClaudeCodeInfo, ConfigFileInfo, ConfigProfile } from "@/types/toolbox";

interface ClaudeCodeManagerProps {
  onBack: () => void;
}

// 只读文件列表
const READONLY_FILES = [
  "history.jsonl",
  "stats-cache.json",
  "projects.json",
  "statsig.json",
  "credentials.json",
  "settings.local.json",
];

// 可编辑文件列表
const EDITABLE_FILES = [
  "settings.json",
  "CLAUDE.md",
  ".clauderc",
];

// 配置文件参考文档
const CONFIG_REFERENCES: Record<string, { title: string; sections: { name: string; description: string; example?: string }[] }> = {
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
interface QuickConfigOption {
  id: string;
  name: string;
  description: string;
  category: string;
  configKey: string;
  valueType: "string" | "boolean" | "number" | "select" | "model";
  defaultValue: unknown;
  options?: { label: string; value: unknown }[];
  placeholder?: string;
  allowEmpty?: boolean; // 是否允许不设置
}

// 默认快捷配置
const DEFAULT_QUICK_CONFIGS: QuickConfigOption[] = [
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
    description: "自定义归属标头文本",
    category: "环境变量",
    configKey: "env.CLAUDE_CODE_ATTRIBUTION_HEADER",
    valueType: "string",
    defaultValue: "",
    placeholder: "Generated by Claude Code",
    allowEmpty: true,
  },
  {
    id: "disableNonessentialTraffic",
    name: "禁用非必要流量",
    description: "禁用自动更新、错误报告、遥测等",
    category: "环境变量",
    configKey: "env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    valueType: "select",
    defaultValue: "",
    allowEmpty: true,
    options: [
      { label: "启用", value: "1" },
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
      { label: "禁用", value: "1" },
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
      { label: "禁用", value: "1" },
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
const QUICK_CONFIGS_STORAGE_KEY = "claude-code-quick-configs";

function loadQuickConfigs(): QuickConfigOption[] {
  try {
    const saved = localStorage.getItem(QUICK_CONFIGS_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // ignore
  }
  return DEFAULT_QUICK_CONFIGS;
}

function saveQuickConfigs(configs: QuickConfigOption[]) {
  localStorage.setItem(QUICK_CONFIGS_STORAGE_KEY, JSON.stringify(configs));
}

export function ClaudeCodeManager({ onBack }: ClaudeCodeManagerProps) {
  const [loading, setLoading] = useState(true);
  const [installations, setInstallations] = useState<ClaudeCodeInfo[]>([]);
  const [selectedEnv, setSelectedEnv] = useState<ClaudeCodeInfo | null>(null);

  const [selectedFile, setSelectedFile] = useState<ConfigFileInfo | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [editingFileContent, setEditingFileContent] = useState("");
  const [isEditingFile, setIsEditingFile] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [showConfigReference, setShowConfigReference] = useState(false);

  const [currentSettings, setCurrentSettings] = useState("");
  const [showCurrentSettings, setShowCurrentSettings] = useState(false);

  const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  // 快捷配置管理
  const [quickConfigs, setQuickConfigs] = useState<QuickConfigOption[]>(loadQuickConfigs);
  const [showQuickConfigManager, setShowQuickConfigManager] = useState(false);
  const [editingQuickConfig, setEditingQuickConfig] = useState<QuickConfigOption | null>(null);

  // 编辑档案弹框
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ConfigProfile | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [editingValues, setEditingValues] = useState<Record<string, unknown>>({});

  // 新建档案弹框
  const [showCreateProfile, setShowCreateProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDesc, setNewProfileDesc] = useState("");
  const [newProfileSource, setNewProfileSource] = useState<"empty" | "current" | "quick">("empty");
  const [savingProfile, setSavingProfile] = useState(false);

  // 删除确认弹框
  const [deleteConfirmProfile, setDeleteConfirmProfile] = useState<ConfigProfile | null>(null);

  // 快捷配置选择（编辑档案时）
  const [selectedQuickConfigId, setSelectedQuickConfigId] = useState<string | null>(null);

  // 复制提示
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (selectedEnv) {
      loadCurrentSettings();
    }
  }, [selectedEnv]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [installs, profs] = await Promise.all([
        checkAllClaudeInstallations(),
        getConfigProfiles(),
      ]);
      setInstallations(installs);
      setProfiles(profs);

      const active = profs.find(p => (p.settings as Record<string, unknown>)?.__active === true);
      setActiveProfileId(active?.id || null);

      if (installs.length > 0 && !selectedEnv) {
        setSelectedEnv(installs[0]);
      }
    } catch (err) {
      console.error("加载数据失败:", err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadCurrentSettings() {
    if (!selectedEnv) return;

    const settingsFile = selectedEnv.configFiles.find(f => f.name === "settings.json");
    if (!settingsFile?.exists) {
      setCurrentSettings("{}");
      return;
    }

    try {
      const content = await readClaudeConfigFile(
        selectedEnv.envType,
        selectedEnv.envName,
        settingsFile.path
      );
      setCurrentSettings(content);
    } catch (err) {
      console.error("加载 settings.json 失败:", err);
      setCurrentSettings("{}");
    }
  }

  async function loadFile(file: ConfigFileInfo) {
    if (!selectedEnv) return;

    if (file.name === "settings.json") {
      setSelectedFile(file);
      setIsEditingFile(false);
      return;
    }

    if (!file.exists) {
      setSelectedFile(file);
      setFileContent("文件不存在");
      setIsEditingFile(false);
      return;
    }

    setLoadingFile(true);
    try {
      const content = await readClaudeConfigFile(selectedEnv.envType, selectedEnv.envName, file.path);
      setSelectedFile(file);
      setFileContent(content);
      setEditingFileContent(content);
      setIsEditingFile(false);
    } catch (err) {
      console.error("读取文件失败:", err);
      setFileContent(`读取失败: ${err}`);
    } finally {
      setLoadingFile(false);
    }
  }

  async function handleSaveFile() {
    if (!selectedEnv || !selectedFile) return;

    setSavingFile(true);
    try {
      await writeClaudeConfigFile(
        selectedEnv.envType,
        selectedEnv.envName,
        selectedFile.path,
        editingFileContent
      );
      setFileContent(editingFileContent);
      setIsEditingFile(false);
    } catch (err) {
      console.error("保存文件失败:", err);
      alert(`保存文件失败: ${err}`);
    } finally {
      setSavingFile(false);
    }
  }

  async function handleOpenDir() {
    if (!selectedEnv?.configDir) return;
    try {
      await openClaudeConfigDir(selectedEnv.envType, selectedEnv.envName, selectedEnv.configDir);
    } catch (err) {
      console.error("打开目录失败:", err);
      alert(`打开目录失败: ${err}`);
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  }

  async function handleActivateProfile(profile: ConfigProfile) {
    if (!selectedEnv) return;

    try {
      const settings = { ...(profile.settings as Record<string, unknown>) };
      delete settings.__active;

      const settingsFile = selectedEnv.configFiles.find(f => f.name === "settings.json");
      if (!settingsFile) return;

      const content = JSON.stringify(settings, null, 2);
      await writeClaudeConfigFile(
        selectedEnv.envType,
        selectedEnv.envName,
        settingsFile.path,
        content
      );

      for (const p of profiles) {
        const pSettings = { ...(p.settings as Record<string, unknown>) };
        if (p.id === profile.id) {
          pSettings.__active = true;
        } else {
          delete pSettings.__active;
        }
        await saveConfigProfile(p.name, p.description, pSettings);
      }

      setActiveProfileId(profile.id);
      await loadCurrentSettings();
      await loadAll();
    } catch (err) {
      console.error("启用档案失败:", err);
      alert(`启用配置档案失败: ${err}`);
    }
  }

  // 获取嵌套键的值
  function getNestedValue(obj: Record<string, unknown>, keys: string[]): unknown {
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

  function openEditProfile(profile: ConfigProfile) {
    setEditingProfile(profile);
    const settings = { ...(profile.settings as Record<string, unknown>) };
    delete settings.__active;
    setEditingContent(JSON.stringify(settings, null, 2));

    // 解析配置值到编辑表单，包括嵌套键
    const values: Record<string, unknown> = {};
    quickConfigs.forEach(opt => {
      const keys = opt.configKey.split(".");
      const value = getNestedValue(settings, keys);

      if (value !== undefined) {
        values[opt.id] = value;
      } else {
        values[opt.id] = opt.defaultValue;
      }
    });
    setEditingValues(values);
    setSelectedQuickConfigId(null); // 重置选中的快捷配置
    setShowEditProfile(true);
  }

  async function saveEditingProfile() {
    if (!editingProfile) return;

    try {
      const settings = JSON.parse(editingContent);
      if (activeProfileId === editingProfile.id) {
        settings.__active = true;
      }

      await saveConfigProfile(editingProfile.name, editingProfile.description, settings);

      if (activeProfileId === editingProfile.id && selectedEnv) {
        const settingsFile = selectedEnv.configFiles.find(f => f.name === "settings.json");
        if (settingsFile) {
          const cleanSettings = { ...settings };
          delete cleanSettings.__active;
          await writeClaudeConfigFile(
            selectedEnv.envType,
            selectedEnv.envName,
            settingsFile.path,
            JSON.stringify(cleanSettings, null, 2)
          );
          await loadCurrentSettings();
        }
      }

      setShowEditProfile(false);
      setEditingProfile(null);
      await loadAll();
    } catch (err) {
      console.error("保存档案失败:", err);
      alert(`保存配置档案失败: ${err}`);
    }
  }

  function applyQuickConfig(optionId: string, value: unknown) {
    setEditingValues(prev => ({ ...prev, [optionId]: value }));

    const opt = quickConfigs.find(o => o.id === optionId);
    if (!opt) return;

    try {
      let config: Record<string, unknown> = {};
      if (editingContent.trim()) {
        config = JSON.parse(editingContent);
      }

      // 处理嵌套键，如 "env.HTTP_PROXY" 或 "sandbox.network.allowLocalBinding"
      const keys = opt.configKey.split(".");

      if (value === "" || value === undefined || value === null) {
        // 删除值
        deleteNestedKey(config, keys);
      } else {
        // 设置值
        setNestedKey(config, keys, value);
      }

      setEditingContent(JSON.stringify(config, null, 2));
    } catch {
      // JSON 解析失败
    }
  }

  // 设置嵌套键的值
  function setNestedKey(obj: Record<string, unknown>, keys: string[], value: unknown) {
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

  // 删除嵌套键，并清理空的父对象
  function deleteNestedKey(obj: Record<string, unknown>, keys: string[]) {
    if (keys.length === 1) {
      delete obj[keys[0]];
      return;
    }

    const key = keys[0];
    if (obj[key] && typeof obj[key] === "object") {
      deleteNestedKey(obj[key] as Record<string, unknown>, keys.slice(1));
      // 如果父对象为空，也删除它
      if (Object.keys(obj[key] as object).length === 0) {
        delete obj[key];
      }
    }
  }

  async function handleCreateProfile() {
    if (!newProfileName.trim()) return;

    setSavingProfile(true);
    try {
      let settings: Record<string, unknown> = {};

      if (newProfileSource === "current" && currentSettings) {
        try {
          settings = JSON.parse(currentSettings);
        } catch {
          // 解析失败使用空配置
        }
      } else if (newProfileSource === "quick") {
        // 使用快捷配置的默认值
        quickConfigs.forEach(opt => {
          if (opt.defaultValue !== "" && opt.defaultValue !== null && opt.defaultValue !== undefined) {
            settings[opt.configKey] = opt.defaultValue;
          }
        });
      }

      const profile = await saveConfigProfile(
        newProfileName.trim(),
        newProfileDesc.trim() || undefined,
        settings
      );

      setShowCreateProfile(false);
      setNewProfileName("");
      setNewProfileDesc("");
      setNewProfileSource("empty");
      await loadAll();

      if (profile) {
        openEditProfile(profile);
      }
    } catch (err) {
      console.error("创建档案失败:", err);
      alert(`创建配置档案失败: ${err}`);
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleDeleteProfile(profile: ConfigProfile) {
    if (activeProfileId === profile.id) {
      alert("无法删除当前启用的配置档案");
      return;
    }
    // 使用自定义确认弹框
    setDeleteConfirmProfile(profile);
  }

  async function confirmDeleteProfile() {
    if (!deleteConfirmProfile) return;

    try {
      await deleteConfigProfile(deleteConfirmProfile.id);
      setDeleteConfirmProfile(null);
      await loadAll();
    } catch (err) {
      console.error("删除档案失败:", err);
      alert(`删除配置档案失败: ${err}`);
    }
  }

  // 快捷配置管理
  function handleSaveQuickConfig(config: QuickConfigOption) {
    const newConfigs = editingQuickConfig
      ? quickConfigs.map(c => c.id === config.id ? config : c)
      : [...quickConfigs, { ...config, id: `custom_${Date.now()}` }];
    setQuickConfigs(newConfigs);
    saveQuickConfigs(newConfigs);
    setEditingQuickConfig(null);
  }

  function handleDeleteQuickConfig(id: string) {
    if (!confirm("确定要删除此快捷配置吗？")) return;
    const newConfigs = quickConfigs.filter(c => c.id !== id);
    setQuickConfigs(newConfigs);
    saveQuickConfigs(newConfigs);
  }

  function handleResetQuickConfigs() {
    if (!confirm("确定要重置为默认快捷配置吗？")) return;
    setQuickConfigs(DEFAULT_QUICK_CONFIGS);
    saveQuickConfigs(DEFAULT_QUICK_CONFIGS);
  }

  const groupedOptions = quickConfigs.reduce((acc, opt) => {
    if (!acc[opt.category]) {
      acc[opt.category] = [];
    }
    acc[opt.category].push(opt);
    return acc;
  }, {} as Record<string, QuickConfigOption[]>);

  const isReadonlyFile = (fileName: string) => READONLY_FILES.includes(fileName);
  const isEditableFile = (fileName: string) => EDITABLE_FILES.includes(fileName);
  const isSettingsJson = selectedFile?.name === "settings.json";
  const hasConfigReference = selectedFile?.name ? CONFIG_REFERENCES[selectedFile.name] : false;

  // 获取分类图标
  function getCategoryIcon(category: string) {
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

  function renderConfigEditor(opt: QuickConfigOption) {
    const value = editingValues[opt.id];

    switch (opt.valueType) {
      case "boolean":
        return (
          <div className="flex items-center gap-1">
            <button
              onClick={() => applyQuickConfig(opt.id, "")}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                value === "" || value === undefined
                  ? "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                  : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500"
              }`}
            >
              未设置
            </button>
            <button
              onClick={() => applyQuickConfig(opt.id, true)}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                value === true
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500"
              }`}
            >
              开启
            </button>
            <button
              onClick={() => applyQuickConfig(opt.id, false)}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                value === false
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500"
              }`}
            >
              关闭
            </button>
          </div>
        );

      case "select":
        return (
          <select
            value={String(value ?? "")}
            onChange={(e) => applyQuickConfig(opt.id, e.target.value)}
            className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {opt.allowEmpty && <option value="">未设置</option>}
            {opt.options?.map(option => (
              <option key={String(option.value)} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
        );

      case "model":
        // 模型选择：支持预设选择和自定义输入
        const isCustom = value && !opt.options?.some(o => o.value === value);
        return (
          <div className="flex flex-col gap-1 w-full">
            <select
              value={isCustom ? "__custom__" : String(value ?? "")}
              onChange={(e) => {
                if (e.target.value === "__custom__") {
                  // 保持当前值或设置为空以便输入
                  if (!isCustom) applyQuickConfig(opt.id, "");
                } else {
                  applyQuickConfig(opt.id, e.target.value);
                }
              }}
              className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">未设置</option>
              {opt.options?.map(option => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
              <option value="__custom__">自定义...</option>
            </select>
            {(isCustom || (editingValues[opt.id] === "" && document.activeElement?.closest(`[data-config-id="${opt.id}"]`))) && (
              <input
                type="text"
                value={String(value || "")}
                onChange={(e) => applyQuickConfig(opt.id, e.target.value)}
                placeholder="输入模型名称，如: claude-opus-4-5-20251101"
                className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            )}
          </div>
        );

      case "string":
      case "number":
        return (
          <input
            type={opt.valueType === "number" ? "number" : "text"}
            value={String(value || "")}
            onChange={(e) => applyQuickConfig(opt.id, opt.valueType === "number" ? Number(e.target.value) : e.target.value)}
            placeholder={opt.placeholder}
            className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        );

      default:
        return null;
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ToolPanelHeader
        title="Claude Code 配置"
        icon={Terminal}
        onBack={onBack}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowQuickConfigManager(true)}
              className="re-btn flex items-center gap-2"
              title="快捷配置管理"
            >
              <Sliders size={16} />
              <span>快捷配置</span>
            </button>
            {selectedEnv?.configDir && (
              <button
                onClick={handleOpenDir}
                className="re-btn flex items-center gap-2"
                title="打开配置目录"
              >
                <FolderOpen size={16} />
                <span>打开目录</span>
              </button>
            )}
            <button
              onClick={loadAll}
              disabled={loading}
              className="re-btn flex items-center gap-2"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              <span>刷新</span>
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-hidden p-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <Loader2 size={32} className="animate-spin mb-4" />
            <p>检测 Claude Code 安装...</p>
          </div>
        ) : error ? (
          <div className="re-card p-6 text-center">
            <AlertCircle size={48} className="mx-auto mb-4 text-red-500" />
            <p className="text-red-500 mb-4">{error}</p>
            <Button onClick={loadAll} variant="primary">重试</Button>
          </div>
        ) : (
          <div className="flex flex-col h-full gap-4 overflow-hidden">
            {/* 环境信息卡片 */}
            {selectedEnv && (
              <div className="re-card p-3 flex-shrink-0 space-y-3">
                {/* 环境选择器 */}
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-sm font-medium text-gray-500">环境:</span>
                  {installations.map((env) => (
                    <button
                      key={`${env.envType}-${env.envName}`}
                      onClick={() => {
                        setSelectedEnv(env);
                        setSelectedFile(null);
                      }}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-sm ${
                        selectedEnv?.envName === env.envName
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                          : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
                      }`}
                    >
                      <span className="font-medium">{env.envName}</span>
                      {env.installed ? (
                        <CheckCircle size={14} className="text-green-500" />
                      ) : (
                        <X size={14} className="text-red-400" />
                      )}
                    </button>
                  ))}
                </div>

                {/* 环境详情 */}
                <div className="grid grid-cols-3 gap-4 text-sm border-t border-gray-100 dark:border-gray-800 pt-3">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 flex-shrink-0">版本:</span>
                    {selectedEnv.version ? (
                      <>
                        <code className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs">{selectedEnv.version}</code>
                        <button
                          onClick={() => copyToClipboard(selectedEnv.version!, "version")}
                          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded flex-shrink-0"
                          title="复制版本"
                        >
                          {copiedText === "version" ? <Check size={12} className="text-green-500" /> : <Copy size={12} className="text-gray-400" />}
                        </button>
                      </>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 flex-shrink-0">路径:</span>
                    {selectedEnv.path ? (
                      <>
                        <code className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs truncate flex-1" title={selectedEnv.path}>
                          {selectedEnv.path}
                        </code>
                        <button
                          onClick={() => copyToClipboard(selectedEnv.path!, "path")}
                          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded flex-shrink-0"
                          title="复制路径"
                        >
                          {copiedText === "path" ? <Check size={12} className="text-green-500" /> : <Copy size={12} className="text-gray-400" />}
                        </button>
                      </>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 flex-shrink-0">配置目录:</span>
                    {selectedEnv.configDir ? (
                      <>
                        <code className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs truncate flex-1" title={selectedEnv.configDir}>
                          {selectedEnv.configDir}
                        </code>
                        <button
                          onClick={() => copyToClipboard(selectedEnv.configDir!, "configDir")}
                          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded flex-shrink-0"
                          title="复制配置目录"
                        >
                          {copiedText === "configDir" ? <Check size={12} className="text-green-500" /> : <Copy size={12} className="text-gray-400" />}
                        </button>
                      </>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 主内容区 */}
            {selectedEnv && (
              <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
                {/* 左侧：配置文件列表 - 窄列 */}
                <div className="w-40 flex-shrink-0 re-card p-3 flex flex-col overflow-hidden">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2 text-sm flex-shrink-0">配置文件</h3>
                  <div className="flex-1 overflow-y-auto space-y-1">
                    {selectedEnv.configFiles.map((file) => (
                      <div key={file.path} className="group relative">
                        <button
                          onClick={() => loadFile(file)}
                          className={`w-full text-left p-2 rounded-lg border transition-colors ${
                            selectedFile?.path === file.path
                              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                              : "border-transparent hover:bg-gray-50 dark:hover:bg-gray-800"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {isReadonlyFile(file.name) ? (
                              <Lock size={12} className="text-gray-400 flex-shrink-0" />
                            ) : isEditableFile(file.name) ? (
                              <Edit3 size={12} className="text-blue-500 flex-shrink-0" />
                            ) : (
                              <FileText size={12} className={`flex-shrink-0 ${file.exists ? "text-blue-500" : "text-gray-400"}`} />
                            )}
                            <span className={`font-medium text-xs truncate ${file.exists ? "" : "text-gray-400"}`}>
                              {file.name}
                            </span>
                          </div>
                        </button>
                        {/* 悬浮提示 */}
                        <div className="absolute left-full top-0 ml-2 z-50 hidden group-hover:block">
                          <div className="bg-gray-900 text-white text-xs rounded-lg p-2 shadow-lg max-w-[200px] whitespace-normal">
                            <div className="font-medium mb-1">{file.name}</div>
                            <div className="text-gray-300">{file.description || "配置文件"}</div>
                            {file.exists && file.size !== undefined && (
                              <div className="text-gray-400 mt-1">大小: {(file.size / 1024).toFixed(1)} KB</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 右侧内容 */}
                {isSettingsJson ? (
                  <div className="flex-1 flex flex-col gap-4 overflow-hidden min-h-0">
                    {/* 当前 settings.json 卡片 */}
                    <div className="re-card flex-shrink-0 overflow-hidden">
                      <button
                        onClick={() => setShowCurrentSettings(!showCurrentSettings)}
                        className="w-full flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Settings size={16} className="text-blue-500" />
                          <span className="font-semibold text-gray-900 dark:text-white text-sm">当前 settings.json</span>
                        </div>
                        {showCurrentSettings ? (
                          <ChevronDown size={16} className="text-gray-400" />
                        ) : (
                          <ChevronRight size={16} className="text-gray-400" />
                        )}
                      </button>
                      {showCurrentSettings && (
                        <div className="px-3 pb-3">
                          <pre className="p-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs font-mono text-gray-600 dark:text-gray-400 max-h-[200px] overflow-auto whitespace-pre-wrap break-all">
                            {currentSettings || "{}"}
                          </pre>
                        </div>
                      )}
                    </div>

                    {/* 配置档案列表 */}
                    <div className="flex-1 re-card p-3 flex flex-col overflow-hidden min-h-0">
                      <div className="flex items-center justify-between mb-3 flex-shrink-0">
                        <h3 className="font-semibold text-gray-900 dark:text-white text-sm flex items-center gap-2">
                          <Copy size={16} />
                          配置档案
                        </h3>
                        <Button
                          onClick={() => setShowCreateProfile(true)}
                          variant="primary"
                          className="flex items-center gap-1 text-xs py-1 px-2"
                        >
                          <Plus size={12} />
                          新建
                        </Button>
                      </div>

                      {/* 档案网格 */}
                      <div className="flex-1 overflow-y-auto min-h-0">
                        {profiles.length === 0 ? (
                          <div className="text-center py-8 text-gray-400">
                            <Copy size={32} className="mx-auto mb-2 opacity-50" />
                            <p className="text-sm">暂无配置档案</p>
                            <p className="text-xs mt-1">点击"新建"创建第一个配置档案</p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                            {profiles.map((profile) => {
                              const isActive = activeProfileId === profile.id;

                              return (
                                <div
                                  key={profile.id}
                                  onDoubleClick={() => openEditProfile(profile)}
                                  className={`p-3 rounded-xl border-2 transition-all cursor-pointer hover:shadow-md ${
                                    isActive
                                      ? "border-green-500 bg-green-50 dark:bg-green-900/20"
                                      : "border-gray-100 dark:border-gray-800 hover:border-gray-200"
                                  }`}
                                >
                                  <div className="flex items-start gap-3">
                                    <GripVertical size={16} className="text-gray-300 flex-shrink-0 mt-0.5 cursor-grab" />
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                      isActive ? "bg-green-500" : "bg-blue-500"
                                    }`}>
                                      <Settings size={18} className="text-white" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium text-gray-900 dark:text-white truncate text-sm">
                                          {profile.name}
                                        </span>
                                        {isActive && (
                                          <span className="text-[10px] text-green-600 bg-green-100 dark:bg-green-900/40 px-1.5 py-0.5 rounded flex-shrink-0">
                                            已启用
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-xs text-gray-500 truncate mt-0.5">
                                        {profile.description || "无描述"}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                                    {!isActive && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleActivateProfile(profile); }}
                                        className="p-1.5 hover:bg-green-100 dark:hover:bg-green-900/30 rounded text-green-600 text-xs flex items-center gap-1"
                                        title="启用"
                                      >
                                        <Power size={12} />
                                        <span>启用</span>
                                      </button>
                                    )}
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openEditProfile(profile); }}
                                      className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-500 text-xs flex items-center gap-1"
                                      title="编辑"
                                    >
                                      <Edit3 size={12} />
                                      <span>编辑</span>
                                    </button>
                                    {!isActive && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteProfile(profile); }}
                                        className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-500 text-xs flex items-center gap-1"
                                        title="删除"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : selectedFile ? (
                  <div className="flex-1 re-card p-3 flex flex-col overflow-hidden">
                    <div className="flex items-center gap-2 mb-2 flex-shrink-0">
                      {isReadonlyFile(selectedFile.name) ? (
                        <Lock size={14} className="text-gray-400" />
                      ) : (
                        <FileText size={14} className="text-blue-500" />
                      )}
                      <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{selectedFile.name}</h3>
                      {isReadonlyFile(selectedFile.name) ? (
                        <span className="text-xs text-gray-400">只读</span>
                      ) : (
                        <span className="text-xs text-blue-500">可编辑</span>
                      )}
                      <div className="flex-1" />

                      {/* 配置参考按钮 */}
                      {hasConfigReference && (
                        <button
                          onClick={() => setShowConfigReference(true)}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                        >
                          <BookOpen size={12} />
                          <span>配置参考</span>
                        </button>
                      )}

                      {/* 编辑/保存按钮 */}
                      {isEditableFile(selectedFile.name) && !isReadonlyFile(selectedFile.name) && (
                        isEditingFile ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                setEditingFileContent(fileContent);
                                setIsEditingFile(false);
                              }}
                              className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                            >
                              取消
                            </button>
                            <button
                              onClick={handleSaveFile}
                              disabled={savingFile}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-white bg-blue-500 hover:bg-blue-600 rounded disabled:opacity-50"
                            >
                              {savingFile ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                              <span>保存</span>
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setIsEditingFile(true)}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                          >
                            <Edit3 size={12} />
                            <span>编辑</span>
                          </button>
                        )
                      )}

                      <div className="group relative">
                        <Info size={14} className="text-gray-400 cursor-help" />
                        <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover:block">
                          <div className="bg-gray-900 text-white text-xs rounded-lg p-2 shadow-lg max-w-[250px] whitespace-normal">
                            {selectedFile.description || "配置文件"}
                          </div>
                        </div>
                      </div>
                    </div>
                    {loadingFile ? (
                      <div className="flex-1 flex items-center justify-center text-gray-400">
                        <Loader2 size={24} className="animate-spin" />
                      </div>
                    ) : isEditingFile ? (
                      <textarea
                        value={editingFileContent}
                        onChange={(e) => setEditingFileContent(e.target.value)}
                        className="flex-1 p-3 font-mono text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        placeholder="输入配置内容..."
                      />
                    ) : (
                      <pre className="flex-1 p-3 font-mono text-xs bg-gray-50 dark:bg-gray-800 rounded-lg overflow-auto text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-all">
                        {fileContent}
                      </pre>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 re-card p-3 flex flex-col items-center justify-center text-gray-400">
                    <FileText size={48} className="mb-4 opacity-50" />
                    <p>选择配置文件查看</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 新建档案对话框 */}
      {showCreateProfile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">新建配置档案</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">档案名称 *</label>
                <input
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="如: 开发环境"
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">描述</label>
                <input
                  type="text"
                  value={newProfileDesc}
                  onChange={(e) => setNewProfileDesc(e.target.value)}
                  placeholder="可选"
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">初始配置</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 p-2.5 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                    <input
                      type="radio"
                      checked={newProfileSource === "empty"}
                      onChange={() => setNewProfileSource("empty")}
                      className="w-4 h-4 text-blue-500"
                    />
                    <div>
                      <div className="font-medium text-sm">空白配置</div>
                      <div className="text-xs text-gray-500">从头开始</div>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 p-2.5 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                    <input
                      type="radio"
                      checked={newProfileSource === "current"}
                      onChange={() => setNewProfileSource("current")}
                      className="w-4 h-4 text-blue-500"
                    />
                    <div>
                      <div className="font-medium text-sm">复制当前配置</div>
                      <div className="text-xs text-gray-500">从 settings.json 复制</div>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 p-2.5 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                    <input
                      type="radio"
                      checked={newProfileSource === "quick"}
                      onChange={() => setNewProfileSource("quick")}
                      className="w-4 h-4 text-blue-500"
                    />
                    <div>
                      <div className="font-medium text-sm">使用快捷配置默认值</div>
                      <div className="text-xs text-gray-500">应用快捷配置中设置的默认值</div>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <p className="text-xs text-gray-400 mt-3">创建后自动进入编辑模式</p>

            <div className="flex justify-end gap-2 mt-4">
              <Button onClick={() => {
                setShowCreateProfile(false);
                setNewProfileName("");
                setNewProfileDesc("");
                setNewProfileSource("empty");
              }} variant="secondary">取消</Button>
              <Button
                onClick={handleCreateProfile}
                disabled={!newProfileName.trim() || savingProfile}
                variant="primary"
              >
                {savingProfile && <Loader2 size={14} className="animate-spin mr-1" />}
                创建
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑档案弹框 */}
      {showEditProfile && editingProfile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                编辑配置: {editingProfile.name}
              </h3>
              <button
                onClick={() => { setShowEditProfile(false); setEditingProfile(null); }}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* 快捷配置 - 下拉选择方式 */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Sliders size={14} />
                  快捷配置
                </h4>

                {/* 下拉选择器 */}
                <div className="flex items-center gap-2">
                  <select
                    value={selectedQuickConfigId || ""}
                    onChange={(e) => setSelectedQuickConfigId(e.target.value || null)}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">选择要配置的项...</option>
                    {Object.entries(groupedOptions).map(([category, options]) => (
                      <optgroup key={category} label={category}>
                        {options.map((opt) => {
                          const value = editingValues[opt.id];
                          const hasValue = value !== "" && value !== undefined && value !== null;
                          return (
                            <option key={opt.id} value={opt.id}>
                              {opt.name} {hasValue ? "✓" : ""}
                            </option>
                          );
                        })}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* 选中的配置项编辑 */}
                {selectedQuickConfigId && (() => {
                  const opt = quickConfigs.find(c => c.id === selectedQuickConfigId);
                  if (!opt) return null;
                  const CategoryIcon = getCategoryIcon(opt.category);
                  return (
                    <div className="p-4 border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="p-2 bg-blue-100 dark:bg-blue-800 rounded-lg">
                          <CategoryIcon size={16} className="text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 dark:text-white">{opt.name}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{opt.description}</div>
                          <code className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-1 rounded mt-1 inline-block">
                            {opt.configKey}
                          </code>
                        </div>
                      </div>
                      <div>{renderConfigEditor(opt)}</div>
                    </div>
                  );
                })()}

                {/* 已配置项快速预览 */}
                <div className="text-xs text-gray-500 mt-2">
                  已配置: {Object.entries(editingValues).filter(([, v]) => v !== "" && v !== undefined && v !== null).length} 项
                  {Object.entries(editingValues).filter(([, v]) => v !== "" && v !== undefined && v !== null).length > 0 && (
                    <span className="ml-2">
                      ({Object.entries(editingValues)
                        .filter(([, v]) => v !== "" && v !== undefined && v !== null)
                        .map(([id]) => quickConfigs.find(c => c.id === id)?.name)
                        .filter(Boolean)
                        .slice(0, 3)
                        .join(", ")}
                      {Object.entries(editingValues).filter(([, v]) => v !== "" && v !== undefined && v !== null).length > 3 ? "..." : ""})
                    </span>
                  )}
                </div>
              </div>

              {/* JSON 编辑 */}
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">JSON 配置</h4>
                <textarea
                  value={editingContent}
                  onChange={(e) => setEditingContent(e.target.value)}
                  className="w-full h-[200px] p-3 font-mono text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
              <Button onClick={() => { setShowEditProfile(false); setEditingProfile(null); }} variant="secondary">
                取消
              </Button>
              <Button onClick={saveEditingProfile} variant="primary">
                <Save size={14} className="mr-1" />
                保存
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 快捷配置管理弹框 */}
      {showQuickConfigManager && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Sliders size={20} />
                快捷配置管理
              </h3>
              <div className="flex items-center gap-2">
                <Button onClick={handleResetQuickConfigs} variant="secondary" className="text-xs">
                  重置默认
                </Button>
                <button
                  onClick={() => { setShowQuickConfigManager(false); setEditingQuickConfig(null); }}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {editingQuickConfig ? (
                <QuickConfigEditor
                  config={editingQuickConfig}
                  onSave={handleSaveQuickConfig}
                  onCancel={() => setEditingQuickConfig(null)}
                  isNew={!quickConfigs.find(c => c.id === editingQuickConfig.id)}
                />
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-end">
                    <Button
                      onClick={() => setEditingQuickConfig({
                        id: "",
                        name: "",
                        description: "",
                        category: "自定义",
                        configKey: "",
                        valueType: "string",
                        defaultValue: "",
                      })}
                      variant="primary"
                      className="text-sm"
                    >
                      <Plus size={14} className="mr-1" />
                      新增配置项
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {Object.entries(groupedOptions).map(([category, options]) => {
                      const CategoryIcon = getCategoryIcon(category);
                      return (
                        <div key={category} className="border border-gray-200 dark:border-gray-700 rounded-lg">
                          <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 font-medium text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
                            <CategoryIcon size={14} />
                            {category}
                          </div>
                          <div className="divide-y divide-gray-100 dark:divide-gray-800">
                            {options.map((opt) => (
                              <div key={opt.id} className="flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-800">
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm">{opt.name}</div>
                                  <div className="text-xs text-gray-500 truncate">{opt.description}</div>
                                  <div className="text-xs text-gray-400 mt-1">
                                    <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{opt.configKey}</code>
                                    <span className="mx-2">•</span>
                                    <span>默认: {String(opt.defaultValue) || "(空)"}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => setEditingQuickConfig(opt)}
                                    className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500"
                                    title="编辑"
                                  >
                                    <Edit3 size={14} />
                                  </button>
                                  {opt.id.startsWith("custom_") && (
                                    <button
                                      onClick={() => handleDeleteQuickConfig(opt.id)}
                                      className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-500"
                                      title="删除"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 配置参考弹框 */}
      {showConfigReference && selectedFile?.name && CONFIG_REFERENCES[selectedFile.name] && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <BookOpen size={20} />
                {CONFIG_REFERENCES[selectedFile.name].title}
              </h3>
              <button
                onClick={() => setShowConfigReference(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {CONFIG_REFERENCES[selectedFile.name].sections.map((section, index) => (
                <div key={index} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800">
                    <h4 className="font-medium text-gray-900 dark:text-white">{section.name}</h4>
                    <p className="text-sm text-gray-500 mt-0.5">{section.description}</p>
                  </div>
                  {section.example && (
                    <div className="p-3 border-t border-gray-200 dark:border-gray-700">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-400">示例:</span>
                        <button
                          onClick={() => copyToClipboard(section.example!, `example-${index}`)}
                          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                          title="复制示例"
                        >
                          {copiedText === `example-${index}` ? (
                            <Check size={12} className="text-green-500" />
                          ) : (
                            <Copy size={12} className="text-gray-400" />
                          )}
                        </button>
                      </div>
                      <pre className="p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {section.example}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end p-4 border-t border-gray-200 dark:border-gray-700">
              <Button onClick={() => setShowConfigReference(false)} variant="secondary">
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹框 */}
      {deleteConfirmProfile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-full">
                <Trash2 size={20} className="text-red-500" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">确认删除</h3>
            </div>

            <p className="text-gray-600 dark:text-gray-400 mb-6">
              确定要删除配置档案 <span className="font-medium text-gray-900 dark:text-white">"{deleteConfirmProfile.name}"</span> 吗？此操作无法撤销。
            </p>

            <div className="flex justify-end gap-2">
              <Button onClick={() => setDeleteConfirmProfile(null)} variant="secondary">
                取消
              </Button>
              <Button
                onClick={confirmDeleteProfile}
                className="bg-red-500 hover:bg-red-600 text-white"
              >
                <Trash2 size={14} className="mr-1" />
                删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 快捷配置编辑器组件
function QuickConfigEditor({
  config,
  onSave,
  onCancel,
  isNew,
}: {
  config: QuickConfigOption;
  onSave: (config: QuickConfigOption) => void;
  onCancel: () => void;
  isNew: boolean;
}) {
  const [form, setForm] = useState<QuickConfigOption>(config);
  const [optionsText, setOptionsText] = useState(
    config.options?.map(o => `${o.label}:${o.value}`).join("\n") || ""
  );

  function handleSave() {
    const finalConfig = { ...form };
    if ((form.valueType === "select" || form.valueType === "model") && optionsText.trim()) {
      finalConfig.options = optionsText.split("\n").filter(Boolean).map(line => {
        const [label, value] = line.split(":");
        return { label: label?.trim() || "", value: value?.trim() || label?.trim() || "" };
      });
    }
    onSave(finalConfig);
  }

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-gray-900 dark:text-white">
        {isNew ? "新增配置项" : "编辑配置项"}
      </h4>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">名称 *</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">配置键 *</label>
          <input
            type="text"
            value={form.configKey}
            onChange={(e) => setForm(f => ({ ...f, configKey: e.target.value }))}
            placeholder="如: autoApproveAll"
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-500 mb-1">描述</label>
        <input
          type="text"
          value={form.description}
          onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">分类</label>
          <input
            type="text"
            value={form.category}
            onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">值类型</label>
          <select
            value={form.valueType}
            onChange={(e) => setForm(f => ({ ...f, valueType: e.target.value as QuickConfigOption["valueType"] }))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="string">字符串</option>
            <option value="boolean">布尔值</option>
            <option value="number">数字</option>
            <option value="select">选择</option>
            <option value="model">模型（可自定义）</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-500 mb-1">默认值</label>
        {form.valueType === "boolean" ? (
          <select
            value={form.defaultValue === "" ? "" : String(form.defaultValue)}
            onChange={(e) => setForm(f => ({ ...f, defaultValue: e.target.value === "" ? "" : e.target.value === "true" }))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">未设置</option>
            <option value="true">开启 (true)</option>
            <option value="false">关闭 (false)</option>
          </select>
        ) : (
          <input
            type={form.valueType === "number" ? "number" : "text"}
            value={String(form.defaultValue ?? "")}
            onChange={(e) => setForm(f => ({ ...f, defaultValue: form.valueType === "number" ? Number(e.target.value) : e.target.value }))}
            placeholder={form.valueType === "model" ? "如: claude-opus-4-5-20251101 或留空" : ""}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}
      </div>

      {(form.valueType === "select" || form.valueType === "model") && (
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">选项（每行一个，格式: 显示名:值）</label>
          <textarea
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            placeholder={"Claude Sonnet 4:claude-sonnet-4-20250514\nClaude Opus 4:claude-opus-4-20250514"}
            rows={4}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
          />
        </div>
      )}

      {form.valueType === "string" && (
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">占位符</label>
          <input
            type="text"
            value={form.placeholder || ""}
            onChange={(e) => setForm(f => ({ ...f, placeholder: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4">
        <Button onClick={onCancel} variant="secondary">取消</Button>
        <Button onClick={handleSave} variant="primary" disabled={!form.name || !form.configKey}>
          <Save size={14} className="mr-1" />
          保存
        </Button>
      </div>
    </div>
  );
}
