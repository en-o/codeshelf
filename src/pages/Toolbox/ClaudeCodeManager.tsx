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
  Eye,
  Lock,
  GripVertical,
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
  ".clauderc",
  "credentials.json",
  "settings.local.json",
];

// 快捷配置项定义
interface EditableConfigOption {
  id: string;
  name: string;
  description: string;
  category: string;
  configKey: string;
  valueType: "string" | "boolean" | "number" | "select";
  defaultValue: unknown;
  options?: { label: string; value: unknown }[];
  placeholder?: string;
}

// 预定义的快捷配置
const QUICK_CONFIG_OPTIONS: EditableConfigOption[] = [
  {
    id: "model",
    name: "默认模型",
    description: "设置默认使用的 Claude 模型",
    category: "模型",
    configKey: "model",
    valueType: "select",
    defaultValue: "claude-sonnet-4-20250514",
    options: [
      { label: "Claude Sonnet 4", value: "claude-sonnet-4-20250514" },
      { label: "Claude Opus 4", value: "claude-opus-4-20250514" },
      { label: "Claude 3.5 Sonnet", value: "claude-3-5-sonnet-20241022" },
      { label: "Claude 3.5 Haiku", value: "claude-3-5-haiku-20241022" },
    ],
  },
  {
    id: "smallFastModel",
    name: "快速模型",
    description: "用于简单任务的快速模型",
    category: "模型",
    configKey: "smallFastModel",
    valueType: "select",
    defaultValue: "claude-3-5-haiku-20241022",
    options: [
      { label: "Claude 3.5 Haiku", value: "claude-3-5-haiku-20241022" },
      { label: "Claude Sonnet 4", value: "claude-sonnet-4-20250514" },
    ],
  },
  {
    id: "autoApprove",
    name: "自动批准所有",
    description: "自动批准所有工具使用请求",
    category: "权限",
    configKey: "autoApproveAll",
    valueType: "boolean",
    defaultValue: false,
  },
  {
    id: "autoApproveRead",
    name: "自动批准读取",
    description: "自动批准文件读取请求",
    category: "权限",
    configKey: "autoApproveRead",
    valueType: "boolean",
    defaultValue: true,
  },
  {
    id: "autoApproveWrite",
    name: "自动批准写入",
    description: "自动批准文件写入请求",
    category: "权限",
    configKey: "autoApproveWrite",
    valueType: "boolean",
    defaultValue: false,
  },
  {
    id: "autoApproveBash",
    name: "自动批准命令",
    description: "自动批准 Bash 命令执行",
    category: "权限",
    configKey: "autoApproveBash",
    valueType: "boolean",
    defaultValue: false,
  },
  {
    id: "proxyUrl",
    name: "代理地址",
    description: "HTTP/HTTPS 代理服务器地址",
    category: "代理",
    configKey: "proxy",
    valueType: "string",
    defaultValue: "",
    placeholder: "http://127.0.0.1:7890",
  },
  {
    id: "apiBaseUrl",
    name: "API 基础地址",
    description: "自定义 Anthropic API 端点",
    category: "代理",
    configKey: "apiBaseUrl",
    valueType: "string",
    defaultValue: "",
    placeholder: "https://api.anthropic.com",
  },
  {
    id: "theme",
    name: "主题",
    description: "界面颜色主题",
    category: "界面",
    configKey: "theme",
    valueType: "select",
    defaultValue: "system",
    options: [
      { label: "跟随系统", value: "system" },
      { label: "浅色", value: "light" },
      { label: "深色", value: "dark" },
    ],
  },
  {
    id: "verbose",
    name: "详细输出",
    description: "显示更多调试信息",
    category: "界面",
    configKey: "verbose",
    valueType: "boolean",
    defaultValue: false,
  },
];

export function ClaudeCodeManager({ onBack }: ClaudeCodeManagerProps) {
  const [loading, setLoading] = useState(true);
  const [installations, setInstallations] = useState<ClaudeCodeInfo[]>([]);
  const [selectedEnv, setSelectedEnv] = useState<ClaudeCodeInfo | null>(null);

  const [selectedFile, setSelectedFile] = useState<ConfigFileInfo | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);

  const [currentSettings, setCurrentSettings] = useState("");

  const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  const [editingProfile, setEditingProfile] = useState<ConfigProfile | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [editingValues, setEditingValues] = useState<Record<string, unknown>>({});
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["模型", "代理"]));

  const [showCreateProfile, setShowCreateProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDesc, setNewProfileDesc] = useState("");
  const [newProfileSource, setNewProfileSource] = useState<"empty" | "current">("empty");
  const [savingProfile, setSavingProfile] = useState(false);

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
      setEditingProfile(null);
      return;
    }

    if (!file.exists) {
      setSelectedFile(file);
      setFileContent("文件不存在");
      return;
    }

    setLoadingFile(true);
    try {
      const content = await readClaudeConfigFile(selectedEnv.envType, selectedEnv.envName, file.path);
      setSelectedFile(file);
      setFileContent(content);
    } catch (err) {
      console.error("读取文件失败:", err);
      setFileContent(`读取失败: ${err}`);
    } finally {
      setLoadingFile(false);
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

  function startEditProfile(profile: ConfigProfile) {
    setEditingProfile(profile);
    const settings = { ...(profile.settings as Record<string, unknown>) };
    delete settings.__active;
    setEditingContent(JSON.stringify(settings, null, 2));

    const values: Record<string, unknown> = {};
    QUICK_CONFIG_OPTIONS.forEach(opt => {
      if (settings[opt.configKey] !== undefined) {
        values[opt.id] = settings[opt.configKey];
      } else {
        values[opt.id] = opt.defaultValue;
      }
    });
    setEditingValues(values);
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

      setEditingProfile(null);
      await loadAll();
    } catch (err) {
      console.error("保存档案失败:", err);
      alert(`保存配置档案失败: ${err}`);
    }
  }

  function applyQuickConfig(optionId: string, value: unknown) {
    setEditingValues(prev => ({ ...prev, [optionId]: value }));

    const opt = QUICK_CONFIG_OPTIONS.find(o => o.id === optionId);
    if (!opt) return;

    try {
      let config: Record<string, unknown> = {};
      if (editingContent.trim()) {
        config = JSON.parse(editingContent);
      }

      if (value === "" || value === opt.defaultValue) {
        delete config[opt.configKey];
      } else {
        config[opt.configKey] = value;
      }

      setEditingContent(JSON.stringify(config, null, 2));
    } catch {
      // JSON 解析失败
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
        startEditProfile(profile);
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
    if (!confirm(`确定要删除配置档案 "${profile.name}" 吗？`)) return;

    try {
      await deleteConfigProfile(profile.id);
      if (editingProfile?.id === profile.id) {
        setEditingProfile(null);
      }
      await loadAll();
    } catch (err) {
      console.error("删除档案失败:", err);
      alert(`删除配置档案失败: ${err}`);
    }
  }

  function toggleCategory(category: string) {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  }

  const groupedOptions = QUICK_CONFIG_OPTIONS.reduce((acc, opt) => {
    if (!acc[opt.category]) {
      acc[opt.category] = [];
    }
    acc[opt.category].push(opt);
    return acc;
  }, {} as Record<string, EditableConfigOption[]>);

  const isReadonlyFile = (fileName: string) => READONLY_FILES.includes(fileName);
  const isSettingsJson = selectedFile?.name === "settings.json";

  function renderConfigEditor(opt: EditableConfigOption) {
    const value = editingValues[opt.id];

    switch (opt.valueType) {
      case "boolean":
        return (
          <button
            onClick={() => applyQuickConfig(opt.id, !value)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              value
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
            }`}
          >
            {value ? "开启" : "关闭"}
          </button>
        );

      case "select":
        return (
          <select
            value={String(value)}
            onChange={(e) => applyQuickConfig(opt.id, e.target.value)}
            className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {opt.options?.map(option => (
              <option key={String(option.value)} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
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
            {/* 环境选择器 - 固定高度 */}
            <div className="re-card p-3 flex-shrink-0">
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-sm font-medium text-gray-500">环境:</span>
                {installations.map((env) => (
                  <button
                    key={`${env.envType}-${env.envName}`}
                    onClick={() => {
                      setSelectedEnv(env);
                      setSelectedFile(null);
                      setEditingProfile(null);
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
                    {env.version && <span className="text-xs text-gray-400">{env.version}</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* 主内容区 - 填充剩余空间 */}
            {selectedEnv && (
              <div className="flex-1 grid grid-cols-4 gap-4 overflow-hidden min-h-0">
                {/* 左侧：文件列表 */}
                <div className="re-card p-3 flex flex-col overflow-hidden">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2 text-sm flex-shrink-0">配置文件</h3>
                  <div className="flex-1 overflow-y-auto space-y-1">
                    {selectedEnv.configFiles.map((file) => (
                      <button
                        key={file.path}
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
                          ) : (
                            <FileText size={12} className={`flex-shrink-0 ${file.exists ? "text-blue-500" : "text-gray-400"}`} />
                          )}
                          <span className={`font-medium text-xs truncate ${file.exists ? "" : "text-gray-400"}`}>
                            {file.name}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 中间和右侧内容 */}
                {isSettingsJson ? (
                  <>
                    {/* 配置档案列表 */}
                    <div className="col-span-2 re-card p-3 flex flex-col overflow-hidden">
                      <div className="flex items-center justify-between mb-3 flex-shrink-0">
                        <h3 className="font-semibold text-gray-900 dark:text-white text-sm flex items-center gap-2">
                          <Settings size={16} />
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

                      {/* 当前配置预览 */}
                      <div className="mb-3 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg flex-shrink-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Eye size={12} className="text-gray-400" />
                          <span className="text-xs text-gray-500">当前 settings.json</span>
                        </div>
                        <pre className="text-xs font-mono text-gray-500 max-h-[60px] overflow-auto whitespace-pre-wrap break-all">
                          {currentSettings || "{}"}
                        </pre>
                      </div>

                      {/* 档案列表 */}
                      <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
                        {profiles.length === 0 ? (
                          <div className="text-center py-8 text-gray-400">
                            <Copy size={32} className="mx-auto mb-2 opacity-50" />
                            <p className="text-sm">暂无配置档案</p>
                          </div>
                        ) : (
                          profiles.map((profile) => {
                            const isActive = activeProfileId === profile.id;
                            const isEditing = editingProfile?.id === profile.id;

                            return (
                              <div
                                key={profile.id}
                                className={`p-3 rounded-xl border-2 transition-all ${
                                  isActive
                                    ? "border-green-500 bg-green-50 dark:bg-green-900/20"
                                    : isEditing
                                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                                    : "border-gray-100 dark:border-gray-800 hover:border-gray-200"
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <GripVertical size={16} className="text-gray-300 flex-shrink-0" />
                                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                    isActive ? "bg-green-500" : "bg-blue-500"
                                  }`}>
                                    <Settings size={16} className="text-white" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-gray-900 dark:text-white truncate">
                                        {profile.name}
                                      </span>
                                      {isActive && (
                                        <span className="text-xs text-green-600 bg-green-100 dark:bg-green-900/40 px-1.5 py-0.5 rounded flex-shrink-0">
                                          已启用
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-gray-500 truncate">
                                      {profile.description || "无描述"}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    {!isActive && (
                                      <button
                                        onClick={() => handleActivateProfile(profile)}
                                        className="p-1.5 hover:bg-green-100 dark:hover:bg-green-900/30 rounded text-green-600"
                                        title="启用"
                                      >
                                        <Power size={14} />
                                      </button>
                                    )}
                                    <button
                                      onClick={() => startEditProfile(profile)}
                                      className={`p-1.5 rounded ${
                                        isEditing
                                          ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600"
                                          : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
                                      }`}
                                      title="编辑"
                                    >
                                      <Edit3 size={14} />
                                    </button>
                                    {!isActive && (
                                      <button
                                        onClick={() => handleDeleteProfile(profile)}
                                        className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-500"
                                        title="删除"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* 右侧编辑区 */}
                    <div className="re-card p-3 flex flex-col overflow-hidden">
                      {editingProfile ? (
                        <>
                          <div className="flex items-center justify-between mb-2 flex-shrink-0">
                            <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate">
                              编辑: {editingProfile.name}
                            </h3>
                            <div className="flex items-center gap-1">
                              <Button onClick={() => setEditingProfile(null)} variant="secondary" className="text-xs py-1 px-2">
                                取消
                              </Button>
                              <Button onClick={saveEditingProfile} variant="primary" className="text-xs py-1 px-2">
                                <Save size={12} className="mr-1" />
                                保存
                              </Button>
                            </div>
                          </div>

                          <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
                            {/* 快捷配置 */}
                            <div className="space-y-1">
                              {Object.entries(groupedOptions).map(([category, options]) => (
                                <div key={category} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                  <button
                                    onClick={() => toggleCategory(category)}
                                    className="w-full flex items-center justify-between px-2 py-1.5 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                  >
                                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1">
                                      {category === "代理" && <Globe size={10} />}
                                      {category}
                                    </span>
                                    {expandedCategories.has(category) ? (
                                      <ChevronDown size={12} className="text-gray-400" />
                                    ) : (
                                      <ChevronRight size={12} className="text-gray-400" />
                                    )}
                                  </button>
                                  {expandedCategories.has(category) && (
                                    <div className="p-2 space-y-1.5">
                                      {options.map((opt) => (
                                        <div key={opt.id} className="flex items-center justify-between gap-2">
                                          <span className="text-xs text-gray-700 dark:text-gray-300 truncate">{opt.name}</span>
                                          <div className="flex-shrink-0">{renderConfigEditor(opt)}</div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>

                            {/* JSON 编辑 */}
                            <div>
                              <label className="text-xs font-medium text-gray-500 mb-1 block">JSON</label>
                              <textarea
                                value={editingContent}
                                onChange={(e) => setEditingContent(e.target.value)}
                                className="w-full h-[150px] p-2 font-mono text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                              />
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                          <Edit3 size={32} className="mb-2 opacity-50" />
                          <p className="text-sm">选择档案进行编辑</p>
                        </div>
                      )}
                    </div>
                  </>
                ) : selectedFile ? (
                  <div className="col-span-3 re-card p-3 flex flex-col overflow-hidden">
                    <div className="flex items-center gap-2 mb-2 flex-shrink-0">
                      <Lock size={14} className="text-gray-400" />
                      <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{selectedFile.name}</h3>
                      <span className="text-xs text-gray-400">只读</span>
                    </div>
                    {loadingFile ? (
                      <div className="flex-1 flex items-center justify-center text-gray-400">
                        <Loader2 size={24} className="animate-spin" />
                      </div>
                    ) : (
                      <pre className="flex-1 p-3 font-mono text-xs bg-gray-50 dark:bg-gray-800 rounded-lg overflow-auto text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-all">
                        {fileContent}
                      </pre>
                    )}
                  </div>
                ) : (
                  <div className="col-span-3 re-card p-3 flex flex-col items-center justify-center text-gray-400">
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
    </div>
  );
}
