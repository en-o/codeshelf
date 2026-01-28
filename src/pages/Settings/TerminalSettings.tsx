import { useState } from "react";
import { FolderOpen, AlertCircle, Check, Monitor, Command, Apple, Settings } from "lucide-react";
import { useAppStore, TerminalConfig } from "@/stores/appStore";
import { open } from "@tauri-apps/plugin-dialog";

interface TerminalSettingsProps {
  onClose?: () => void;
}

export function TerminalSettings({ onClose }: TerminalSettingsProps) {
  const { terminalConfig, setTerminalConfig } = useAppStore();
  const [customPath, setCustomPath] = useState(terminalConfig.customPath || "");

  async function handleBrowsePath() {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "选择终端可执行文件",
      });

      if (selected) {
        setCustomPath(selected as string);
      }
    } catch (error) {
      console.error("Failed to select file:", error);
    }
  }

  function handleTypeChange(type: TerminalConfig["type"]) {
    setTerminalConfig({ type, customPath: type === "custom" ? customPath : undefined });
  }

  function handleSaveCustomPath() {
    if (customPath.trim()) {
      setTerminalConfig({ type: "custom", customPath: customPath.trim() });
    }
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
            选择您偏好的终端程序，用于在项目目录中打开命令行。
          </div>
        </div>
      </div>

      {/* 终端类型选择 */}
      <div className="space-y-4 max-h-64 overflow-y-auto pr-1">
        {terminalOptions.map((group) => (
          <div key={group.group} className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {group.group}
            </p>
            <div className="space-y-2">
              {group.options.map((option) => {
                const isSelected = option.value === terminalConfig.type;
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    onClick={() => handleTypeChange(option.value)}
                    className={`w-full flex items-center gap-3 p-3 border rounded-lg transition-all text-left ${
                      isSelected
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-blue-500/50 hover:bg-gray-50"
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isSelected ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-400"
                      }`}
                    >
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-sm font-medium ${
                          isSelected ? "text-blue-500" : "text-gray-900"
                        }`}
                      >
                        {option.label}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{option.description}</div>
                    </div>
                    {isSelected && <Check size={16} className="text-blue-500 flex-shrink-0" />}
                  </button>
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
              onClick={handleBrowsePath}
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
