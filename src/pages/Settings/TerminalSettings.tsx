import { useState } from "react";
import { FolderOpen, AlertCircle } from "lucide-react";
import { useAppStore, TerminalConfig } from "@/stores/appStore";
import { open } from "@tauri-apps/plugin-dialog";

export function TerminalSettings() {
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

  return (
    <section className="re-card">
      <h2 className="text-[17px] font-semibold mb-6">终端设置</h2>

      {/* 说明文档 */}
      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900">
            <p className="font-semibold mb-2">配置说明</p>
            <ul className="space-y-1 text-xs">
              <li>• <strong>Windows 默认:</strong> 优先使用 Windows Terminal，如不可用则使用 PowerShell</li>
              <li>• <strong>Windows PowerShell:</strong> 使用 PowerShell 终端</li>
              <li>• <strong>Windows CMD:</strong> 使用传统命令提示符</li>
              <li>• <strong>macOS 默认:</strong> 使用系统自带的 Terminal.app</li>
              <li>• <strong>macOS iTerm:</strong> 使用 iTerm2 终端（需已安装）</li>
              <li>• <strong>自定义:</strong> 指定自定义终端程序的路径</li>
            </ul>
          </div>
        </div>
      </div>

      {/* 终端类型选择 */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700 mb-3">
          选择终端类型
        </label>

        {/* Windows 选项 */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Windows</p>
          <TerminalOption
            value="default"
            label="默认 (Windows Terminal / PowerShell)"
            description="自动选择最佳终端"
            currentValue={terminalConfig.type}
            onChange={handleTypeChange}
          />
          <TerminalOption
            value="powershell"
            label="PowerShell"
            description="Windows PowerShell 终端"
            currentValue={terminalConfig.type}
            onChange={handleTypeChange}
          />
          <TerminalOption
            value="cmd"
            label="CMD"
            description="传统命令提示符"
            currentValue={terminalConfig.type}
            onChange={handleTypeChange}
          />
        </div>

        {/* macOS 选项 */}
        <div className="space-y-2 pt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">macOS</p>
          <TerminalOption
            value="terminal"
            label="Terminal"
            description="系统自带终端"
            currentValue={terminalConfig.type}
            onChange={handleTypeChange}
          />
          <TerminalOption
            value="iterm"
            label="iTerm2"
            description="需要已安装 iTerm2"
            currentValue={terminalConfig.type}
            onChange={handleTypeChange}
          />
        </div>

        {/* 自定义选项 */}
        <div className="space-y-2 pt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">自定义</p>
          <TerminalOption
            value="custom"
            label="自定义终端"
            description="使用自定义终端程序"
            currentValue={terminalConfig.type}
            onChange={handleTypeChange}
          />
        </div>

        {/* 自定义路径输入 */}
        {terminalConfig.type === "custom" && (
          <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              终端可执行文件路径
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                placeholder="选择或输入终端可执行文件路径"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
              <button
                onClick={handleBrowsePath}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                <FolderOpen size={16} />
                浏览
              </button>
            </div>
            <button
              onClick={handleSaveCustomPath}
              disabled={!customPath.trim()}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
            >
              保存路径
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

interface TerminalOptionProps {
  value: TerminalConfig["type"];
  label: string;
  description: string;
  currentValue: TerminalConfig["type"];
  onChange: (value: TerminalConfig["type"]) => void;
}

function TerminalOption({ value, label, description, currentValue, onChange }: TerminalOptionProps) {
  const isSelected = value === currentValue;

  return (
    <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-blue-300 cursor-pointer transition-colors">
      <input
        type="radio"
        name="terminal"
        value={value}
        checked={isSelected}
        onChange={() => onChange(value)}
        className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-gray-300"
      />
      <div className="flex-1">
        <div className="text-sm font-semibold text-gray-900">{label}</div>
        <div className="text-xs text-gray-500 mt-0.5">{description}</div>
      </div>
    </label>
  );
}
