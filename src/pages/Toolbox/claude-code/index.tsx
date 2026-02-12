// Claude Code 配置管理器 - 主组件

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
  Edit3,
  Power,
  GripVertical,
  Info,
  Sliders,
  Check,
  BookOpen,
  Lock,
  HelpCircle,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { ToolPanelHeader } from "../index";
import { Button } from "@/components/ui";
import {
  checkAllClaudeInstallations,
  checkClaudeByPath,
  readClaudeConfigFile,
  writeClaudeConfigFile,
  openClaudeConfigDir,
  getConfigProfiles,
  deleteConfigProfile,
  saveConfigProfile,
} from "@/services/toolbox";
import type { ClaudeCodeInfo, ConfigFileInfo, ConfigProfile } from "@/types/toolbox";
import {
  READONLY_FILES,
  EDITABLE_FILES,
  CONFIG_REFERENCES,
  type QuickConfigOption,
  loadQuickConfigs,
} from "./constants";
import { ProfileEditor } from "./ProfileEditor";
import { QuickConfigManager } from "./QuickConfigManager";

interface ClaudeCodeManagerProps {
  onBack: () => void;
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

  // 快捷配置
  const [quickConfigs, setQuickConfigs] = useState<QuickConfigOption[]>(loadQuickConfigs);
  const [showQuickConfigManager, setShowQuickConfigManager] = useState(false);

  // 编辑档案
  const [editingProfile, setEditingProfile] = useState<ConfigProfile | null>(null);

  // 新建档案
  const [showCreateProfile, setShowCreateProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDesc, setNewProfileDesc] = useState("");
  const [newProfileSource, setNewProfileSource] = useState<"empty" | "current" | "quick">("empty");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNameError, setProfileNameError] = useState<string | null>(null);

  // 删除确认
  const [deleteConfirmProfile, setDeleteConfirmProfile] = useState<ConfigProfile | null>(null);

  // 复制提示
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  // 帮助弹框
  const [showFindClaudeHelp, setShowFindClaudeHelp] = useState(false);

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

  // 手动选择 Claude 路径
  async function handleSelectClaudePath() {
    if (!selectedEnv) return;

    try {
      const selected = await open({
        title: "选择 Claude 可执行文件",
        multiple: false,
      });

      if (selected && typeof selected === "string") {
        const info = await checkClaudeByPath(selected);
        if (info.installed) {
          // 更新当前环境的路径信息
          setInstallations(prev => prev.map(env =>
            env.envName === selectedEnv.envName
              ? { ...env, ...info, envName: env.envName, envType: env.envType }
              : env
          ));
          setSelectedEnv(prev => prev ? { ...prev, ...info, envName: prev.envName, envType: prev.envType } : null);
        } else {
          alert("无法识别该路径为有效的 Claude Code 安装");
        }
      }
    } catch (err) {
      console.error("选择路径失败:", err);
      alert(`选择路径失败: ${err}`);
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

  async function handleSaveProfile(content: string) {
    if (!editingProfile) return;

    try {
      const settings = JSON.parse(content);
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

  async function handleCreateProfile() {
    if (!newProfileName.trim()) return;

    // 检查重名
    const trimmedName = newProfileName.trim();
    if (profiles.find(p => p.name === trimmedName)) {
      setProfileNameError("配置档案名称已存在，请使用其他名称");
      return;
    }

    setProfileNameError(null);
    setSavingProfile(true);
    try {
      let settings: Record<string, unknown> = {};

      if (newProfileSource === "current" && currentSettings) {
        try {
          settings = JSON.parse(currentSettings);
        } catch {
          // ignore
        }
      } else if (newProfileSource === "quick") {
        quickConfigs.forEach(opt => {
          if (opt.defaultValue !== "" && opt.defaultValue !== null && opt.defaultValue !== undefined) {
            settings[opt.configKey] = opt.defaultValue;
          }
        });
      }

      const profile = await saveConfigProfile(trimmedName, newProfileDesc.trim() || undefined, settings);

      setShowCreateProfile(false);
      setNewProfileName("");
      setNewProfileDesc("");
      setNewProfileSource("empty");
      setProfileNameError(null);
      await loadAll();

      if (profile) {
        setEditingProfile(profile);
      }
    } catch (err) {
      console.error("创建档案失败:", err);
      alert(`创建配置档案失败: ${err}`);
    } finally {
      setSavingProfile(false);
    }
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

  const isReadonlyFile = (fileName: string) => READONLY_FILES.includes(fileName);
  const isEditableFile = (fileName: string) => EDITABLE_FILES.includes(fileName);
  const isSettingsJson = selectedFile?.name === "settings.json";
  const hasConfigReference = selectedFile?.name ? CONFIG_REFERENCES[selectedFile.name] : false;

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
                      <>
                        <span className="text-gray-300">未检测到</span>
                        <button
                          onClick={handleSelectClaudePath}
                          className="text-xs text-blue-500 hover:underline"
                        >
                          手动选择
                        </button>
                        <button
                          onClick={() => setShowFindClaudeHelp(true)}
                          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                          title="如何查找 Claude"
                        >
                          <HelpCircle size={14} className="text-gray-400" />
                        </button>
                      </>
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
                {/* 左侧：配置文件列表 */}
                <div className="w-40 flex-shrink-0 re-card p-3 flex flex-col">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2 text-sm flex-shrink-0">配置文件</h3>
                  <div className="flex-1 overflow-y-auto space-y-1">
                    {selectedEnv.configFiles.map((file) => (
                      <div key={file.path} className="group relative">
                        <button
                          onClick={() => loadFile(file)}
                          title={`${file.name}\n${file.description || "配置文件"}${file.exists && file.size !== undefined ? `\n大小: ${(file.size / 1024).toFixed(1)} KB` : ""}`}
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
                                  onDoubleClick={() => setEditingProfile(profile)}
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
                                      onClick={(e) => { e.stopPropagation(); setEditingProfile(profile); }}
                                      className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-500 text-xs flex items-center gap-1"
                                      title="编辑"
                                    >
                                      <Edit3 size={12} />
                                      <span>编辑</span>
                                    </button>
                                    {!isActive && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setDeleteConfirmProfile(profile);
                                        }}
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

                      {hasConfigReference && (
                        <button
                          onClick={() => setShowConfigReference(true)}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                        >
                          <BookOpen size={12} />
                          <span>配置参考</span>
                        </button>
                      )}

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
                        <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover:block pointer-events-none">
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
                  onChange={(e) => {
                    setNewProfileName(e.target.value);
                    setProfileNameError(null);
                  }}
                  placeholder="如: 开发环境"
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    profileNameError ? "border-red-500" : "border-gray-200 dark:border-gray-700"
                  }`}
                />
                {profileNameError && (
                  <p className="text-xs text-red-500 mt-1">{profileNameError}</p>
                )}
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
                setProfileNameError(null);
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
      {editingProfile && (
        <ProfileEditor
          profile={editingProfile}
          quickConfigs={quickConfigs}
          isActive={activeProfileId === editingProfile.id}
          onSave={handleSaveProfile}
          onClose={() => setEditingProfile(null)}
        />
      )}

      {/* 快捷配置管理弹框 */}
      {showQuickConfigManager && (
        <QuickConfigManager
          quickConfigs={quickConfigs}
          onConfigsChange={setQuickConfigs}
          onClose={() => setShowQuickConfigManager(false)}
        />
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

      {/* 查找 Claude 帮助弹框 */}
      {showFindClaudeHelp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <HelpCircle size={20} className="text-blue-500" />
                如何查找 Claude Code
              </h3>
              <button
                onClick={() => setShowFindClaudeHelp(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Windows */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/20 flex items-center gap-2">
                  <span className="text-lg">🪟</span>
                  <h4 className="font-medium text-gray-900 dark:text-white">Windows</h4>
                </div>
                <div className="p-3 space-y-2 text-sm">
                  <p className="text-gray-600 dark:text-gray-400">在命令提示符或 PowerShell 中运行：</p>
                  <code className="block p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono">
                    where claude
                  </code>
                  <p className="text-gray-500 text-xs mt-2">
                    常见路径：
                    <br />• <code className="text-xs">C:\Users\用户名\AppData\Roaming\npm\claude</code>
                    <br />• <code className="text-xs">C:\Program Files\nodejs\claude</code>
                    <br />• <code className="text-xs">~\AppData\Local\nvm\v版本号\claude</code>（使用 nvm）
                  </p>
                </div>
              </div>

              {/* WSL */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-orange-50 dark:bg-orange-900/20 flex items-center gap-2">
                  <span className="text-lg">🐧</span>
                  <h4 className="font-medium text-gray-900 dark:text-white">WSL (Windows Subsystem for Linux)</h4>
                </div>
                <div className="p-3 space-y-2 text-sm">
                  <p className="text-gray-600 dark:text-gray-400">在 WSL 终端中运行：</p>
                  <code className="block p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono">
                    which claude
                  </code>
                  <p className="text-gray-500 text-xs mt-2">
                    常见路径：
                    <br />• <code className="text-xs">/usr/bin/claude</code>
                    <br />• <code className="text-xs">/usr/local/bin/claude</code>
                    <br />• <code className="text-xs">~/.nvm/versions/node/v版本号/bin/claude</code>（使用 nvm）
                    <br />• <code className="text-xs">~/.local/bin/claude</code>
                  </p>
                  <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded text-xs text-yellow-700 dark:text-yellow-400">
                    <strong>提示：</strong>选择 WSL 路径时，请通过文件选择器导航到
                    <code className="mx-1">\\wsl.localhost\发行版名称\...</code>
                  </div>
                </div>
              </div>

              {/* macOS */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 flex items-center gap-2">
                  <span className="text-lg">🍎</span>
                  <h4 className="font-medium text-gray-900 dark:text-white">macOS</h4>
                </div>
                <div className="p-3 space-y-2 text-sm">
                  <p className="text-gray-600 dark:text-gray-400">在终端中运行：</p>
                  <code className="block p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono">
                    which claude
                  </code>
                  <p className="text-gray-500 text-xs mt-2">
                    常见路径：
                    <br />• <code className="text-xs">/usr/local/bin/claude</code>
                    <br />• <code className="text-xs">/opt/homebrew/bin/claude</code>（Homebrew）
                    <br />• <code className="text-xs">~/.nvm/versions/node/v版本号/bin/claude</code>（使用 nvm）
                  </p>
                </div>
              </div>

              {/* Linux */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-green-50 dark:bg-green-900/20 flex items-center gap-2">
                  <span className="text-lg">🐧</span>
                  <h4 className="font-medium text-gray-900 dark:text-white">Linux</h4>
                </div>
                <div className="p-3 space-y-2 text-sm">
                  <p className="text-gray-600 dark:text-gray-400">在终端中运行：</p>
                  <code className="block p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono">
                    which claude
                  </code>
                  <p className="text-gray-500 text-xs mt-2">
                    常见路径：
                    <br />• <code className="text-xs">/usr/bin/claude</code>
                    <br />• <code className="text-xs">/usr/local/bin/claude</code>
                    <br />• <code className="text-xs">~/.nvm/versions/node/v版本号/bin/claude</code>（使用 nvm）
                    <br />• <code className="text-xs">~/.local/bin/claude</code>
                  </p>
                </div>
              </div>

              {/* 安装说明 */}
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm">
                <p className="font-medium text-blue-700 dark:text-blue-400 mb-1">还没有安装 Claude Code？</p>
                <p className="text-blue-600 dark:text-blue-300 text-xs">
                  运行以下命令安装：
                </p>
                <code className="block p-2 mt-1 bg-white dark:bg-gray-800 rounded text-xs font-mono text-gray-700 dark:text-gray-300">
                  npm install -g @anthropic-ai/claude-code
                </code>
              </div>
            </div>

            <div className="flex justify-end p-4 border-t border-gray-200 dark:border-gray-700">
              <Button onClick={() => setShowFindClaudeHelp(false)} variant="secondary">
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
