import { useState } from "react";
import { FolderOpen, AlertCircle, Check, Monitor, Command, Apple, Settings, Play, Loader2, X, Wrench } from "lucide-react";
import { useAppStore, TerminalConfig } from "@/stores/appStore";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

interface TerminalSettingsProps {
  onClose?: () => void;
}

interface TerminalTestResult {
  available: boolean;
  error: string | null;
  suggested_path: string | null;
}

type TerminalType = TerminalConfig["type"];

export function TerminalSettings({ onClose }: TerminalSettingsProps) {
  const { terminalConfig, setTerminalConfig } = useAppStore();
  const [customPath, setCustomPath] = useState(terminalConfig.customPath || "");
  const [testingTerminal, setTestingTerminal] = useState<TerminalType | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TerminalTestResult>>({});
  const [editingPath, setEditingPath] = useState<TerminalType | null>(null);
  const [tempPath, setTempPath] = useState("");

  async function handleBrowsePath(forType?: TerminalType) {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "选择终端可执行文件",
      });

      if (selected) {
        if (forType && forType !== "custom") {
          setTempPath(selected as string);
        } else {
          setCustomPath(selected as string);
        }
      }
    } catch (error) {
      console.error("Failed to select file:", error);
    }
  }

  function handleTypeChange(type: TerminalConfig["type"]) {
    const newConfig: TerminalConfig = {
      ...terminalConfig,
      type,
      customPath: type === "custom" ? customPath : undefined
    };
    setTerminalConfig(newConfig);
  }

  function handleSaveCustomPath() {
    if (customPath.trim()) {
      setTerminalConfig({ ...terminalConfig, type: "custom", customPath: customPath.trim() });
    }
  }

  async function handleTestTerminal(type: TerminalType) {
    if (type === "custom") return;

    setTestingTerminal(type);
    try {
      // 先检查是否有已保存的自定义路径
      const savedPath = terminalConfig.paths?.[type as keyof typeof terminalConfig.paths];
      const result = await invoke<TerminalTestResult>("test_terminal", {
        terminalType: type,
        customPath: savedPath || null
      });
      setTestResults(prev => ({ ...prev, [type]: result }));

      // 如果测试成功且有建议路径，自动保存
      if (result.available && result.suggested_path && !savedPath) {
        const newPaths = { ...terminalConfig.paths, [type]: result.suggested_path };
        setTerminalConfig({ ...terminalConfig, paths: newPaths });
      }
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        [type]: {
          available: false,
          error: `测试失败: ${error}`,
          suggested_path: null
        }
      }));
    } finally {
      setTestingTerminal(null);
    }
  }

  function handleStartEditPath(type: TerminalType) {
    setEditingPath(type);
    const savedPath = terminalConfig.paths?.[type as keyof typeof terminalConfig.paths];
    const suggestedPath = testResults[type]?.suggested_path;
    setTempPath(savedPath || suggestedPath || "");
  }

  async function handleSaveTerminalPath(type: TerminalType) {
    if (!tempPath.trim()) return;

    // 测试新路径
    setTestingTerminal(type);
    try {
      const result = await invoke<TerminalTestResult>("test_terminal", {
        terminalType: type,
        customPath: tempPath.trim()
      });

      if (result.available) {
        // 保存路径
        const newPaths = { ...terminalConfig.paths, [type]: tempPath.trim() };
        setTerminalConfig({ ...terminalConfig, paths: newPaths });
        setTestResults(prev => ({ ...prev, [type]: result }));
        setEditingPath(null);
        setTempPath("");
      } else {
        setTestResults(prev => ({
          ...prev,
          [type]: {
            available: false,
            error: result.error || "路径无效",
            suggested_path: result.suggested_path
          }
        }));
      }
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        [type]: {
          available: false,
          error: `验证失败: ${error}`,
          suggested_path: null
        }
      }));
    } finally {
      setTestingTerminal(null);
    }
  }

  function handleCancelEdit() {
    setEditingPath(null);
    setTempPath("");
  }

  const terminalOptions = [
    {
      group: "Windows",
      options: [
        { value: "default" as const, label: "系统默认", description: "Windows Terminal / PowerShell", icon: Monitor },
        { value: "powershell" as const, label: "PowerShell", description: "Windows PowerShell", icon: Command },
        { value: "cmd" as const, label: "CMD", description: "命令提示符", icon: Monitor },
      ],
    },
    {
      group: "macOS",
      options: [
        { value: "terminal" as const, label: "Terminal", description: "系统自带终端", icon: Apple },
        { value: "iterm" as const, label: "iTerm2", description: "需已安装 iTerm2", icon: Command },
      ],
    },
    {
      group: "自定义",
      options: [
        { value: "custom" as const, label: "自定义", description: "指定终端程序路径", icon: Settings },
      ],
    },
  ];

  function getTestStatusColor(type: TerminalType): string {
    const result = testResults[type];
    if (!result) return "";
    return result.available ? "text-green-500" : "text-red-500";
  }

  function getTestStatusIcon(type: TerminalType) {
    const result = testResults[type];
    if (!result) return null;
    if (result.available) {
      return <Check size={14} className="text-green-500" />;
    }
    return <X size={14} className="text-red-500" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-gray-200">
        <h4 className="text-sm font-semibold text-gray-900">选择终端类型</h4>
        {onClose && (
          <button
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-blue-500 transition-colors"
          >
            收起
          </button>
        )}
      </div>

      {/* 说明文档 */}
      <div className="p-3 bg-blue-50/50 border border-blue-200/50 rounded-lg">
        <div className="flex items-start gap-2">
          <AlertCircle size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-blue-900">
            选择您偏好的终端程序。点击"测试"按钮检查终端是否可用，如果不可用可以手动设置路径。
          </div>
        </div>
      </div>

      {/* 终端类型选择 */}
      <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
        {terminalOptions.map((group) => (
          <div key={group.group} className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {group.group}
            </p>
            <div className="space-y-2">
              {group.options.map((option) => {
                const isSelected = option.value === terminalConfig.type;
                const Icon = option.icon;
                const testResult = testResults[option.value];
                const isEditing = editingPath === option.value;
                const isTesting = testingTerminal === option.value;
                const savedPath = terminalConfig.paths?.[option.value as keyof typeof terminalConfig.paths];

                return (
                  <div key={option.value} className="space-y-2">
                    <div
                      className={`w-full flex items-center gap-3 p-3 border rounded-lg transition-all ${
                        isSelected
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:border-blue-500/50 hover:bg-gray-50"
                      }`}
                    >
                      <button
                        onClick={() => handleTypeChange(option.value)}
                        className="flex items-center gap-3 flex-1 text-left"
                      >
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            isSelected ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-400"
                          }`}
                        >
                          <Icon size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-sm font-medium ${
                                isSelected ? "text-blue-500" : "text-gray-900"
                              }`}
                            >
                              {option.label}
                            </span>
                            {getTestStatusIcon(option.value)}
                          </div>
                          <div className="text-xs text-gray-500 truncate">
                            {savedPath ? `路径: ${savedPath}` : option.description}
                          </div>
                        </div>
                        {isSelected && <Check size={16} className="text-blue-500 flex-shrink-0" />}
                      </button>

                      {/* 测试和修复按钮 */}
                      {option.value !== "custom" && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTestTerminal(option.value);
                            }}
                            disabled={isTesting}
                            className="px-2 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors flex items-center gap-1 disabled:opacity-50"
                            title="测试终端可用性"
                          >
                            {isTesting ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Play size={12} />
                            )}
                            测试
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartEditPath(option.value);
                            }}
                            className="px-2 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors flex items-center gap-1"
                            title="设置自定义路径"
                          >
                            <Wrench size={12} />
                            修复
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 测试结果显示 */}
                    {testResult && !isEditing && (
                      <div className={`ml-11 p-2 rounded-lg text-xs ${
                        testResult.available
                          ? "bg-green-50 border border-green-200 text-green-700"
                          : "bg-red-50 border border-red-200 text-red-700"
                      }`}>
                        {testResult.available ? (
                          <span>✓ 终端可用{testResult.suggested_path && `，路径: ${testResult.suggested_path}`}</span>
                        ) : (
                          <span>✗ {testResult.error}</span>
                        )}
                      </div>
                    )}

                    {/* 路径编辑区域 */}
                    {isEditing && (
                      <div className="ml-11 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                        <div className="text-xs text-amber-800 font-medium">设置 {option.label} 路径</div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={tempPath}
                            onChange={(e) => setTempPath(e.target.value)}
                            placeholder="输入终端可执行文件路径"
                            className="flex-1 px-2 py-1.5 bg-white border border-amber-300 rounded text-xs font-mono text-gray-900 placeholder-gray-400 focus:outline-none focus:border-amber-500"
                          />
                          <button
                            onClick={() => handleBrowsePath(option.value)}
                            className="px-2 py-1.5 bg-white border border-amber-300 text-amber-700 rounded text-xs hover:bg-amber-100 transition-colors flex items-center gap-1"
                          >
                            <FolderOpen size={12} />
                          </button>
                        </div>
                        {testResult?.suggested_path && (
                          <div className="text-xs text-amber-700">
                            建议路径: <code className="bg-amber-100 px-1 rounded">{testResult.suggested_path}</code>
                            <button
                              onClick={() => setTempPath(testResult.suggested_path!)}
                              className="ml-2 text-amber-600 hover:text-amber-800 underline"
                            >
                              使用此路径
                            </button>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSaveTerminalPath(option.value)}
                            disabled={!tempPath.trim() || isTesting}
                            className="flex-1 py-1.5 bg-amber-500 text-white rounded text-xs font-medium hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                          >
                            {isTesting ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Check size={12} />
                            )}
                            保存并测试
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300 transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 自定义路径输入 */}
      {terminalConfig.type === "custom" && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
          <label className="block text-xs font-medium text-gray-900">
            自定义终端路径
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder="选择或输入终端可执行文件路径"
              className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-mono text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={() => handleBrowsePath()}
              className="px-3 py-2 bg-white border border-gray-200 text-gray-900 rounded-lg text-sm hover:bg-gray-100 transition-colors flex items-center gap-1.5"
            >
              <FolderOpen size={14} />
              浏览
            </button>
          </div>
          <button
            onClick={handleSaveCustomPath}
            disabled={!customPath.trim()}
            className="w-full py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            <Check size={14} />
            保存路径
          </button>
        </div>
      )}
    </div>
  );
}
