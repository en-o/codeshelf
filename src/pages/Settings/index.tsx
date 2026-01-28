import { useState } from "react";
import { useAppStore, Theme, TerminalConfig } from "@/stores/appStore";
import { Minus, X, Monitor, Code, Terminal, Search, ChevronRight } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { EditorSettings } from "./EditorSettings";
import { TerminalSettings } from "./TerminalSettings";
import { ScanSettings } from "./ScanSettings";
import { AppearanceSettings } from "./AppearanceSettings";

type SettingsSection = "appearance" | "editor" | "terminal" | "scan" | null;

export function SettingsPage() {
  const { theme, sidebarCollapsed, setSidebarCollapsed, editors, terminalConfig, scanDepth } = useAppStore();
  const [activeSection, setActiveSection] = useState<SettingsSection>(null);

  // 获取默认编辑器名称
  const getDefaultEditorName = () => {
    if (editors.length === 0) return "未配置（使用系统默认）";
    return editors[0].name;
  };

  // 获取终端类型显示名称
  const getTerminalTypeName = (type: TerminalConfig["type"]) => {
    const names: Record<string, string> = {
      default: "系统默认",
      powershell: "PowerShell",
      cmd: "CMD",
      terminal: "Terminal.app",
      iterm: "iTerm2",
      custom: "自定义终端",
    };
    return names[type] || type;
  };

  // 获取主题显示名称
  const getThemeName = (t: Theme) => {
    return t === "light" ? "浅色模式" : "深色模式";
  };

  const settingsCards = [
    {
      id: "appearance" as const,
      title: "外观",
      description: "主题、界面样式",
      icon: Monitor,
      value: getThemeName(theme),
      component: AppearanceSettings,
    },
    {
      id: "editor" as const,
      title: "编辑器",
      description: "配置代码编辑器",
      icon: Code,
      value: getDefaultEditorName(),
      component: EditorSettings,
    },
    {
      id: "terminal" as const,
      title: "终端",
      description: "配置命令行终端",
      icon: Terminal,
      value: getTerminalTypeName(terminalConfig.type),
      component: TerminalSettings,
    },
    {
      id: "scan" as const,
      title: "扫描设置",
      description: "项目扫描深度配置",
      icon: Search,
      value: `${scanDepth} 层`,
      component: ScanSettings,
    },
  ];

  const handleCardClick = (section: SettingsSection) => {
    setActiveSection(activeSection === section ? null : section);
  };

  return (
    <div className="flex flex-col min-h-full">
      {/* Header with Title and Integrated Window Controls */}
      <header className="re-header sticky top-0 z-20" data-tauri-drag-region>
        <span
          className="toggle"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          ☰
        </span>

        <div className="flex-1 flex items-center gap-3" data-tauri-drag-region>
          <span className="text-lg font-semibold ml-2">⚙️ 设置</span>
        </div>

        <div className="re-actions flex items-center">
          <div className="flex items-center ml-4 border-l border-gray-200 pl-3 gap-1 h-6">
            <button
              onClick={() => getCurrentWindow()?.minimize()}
              className="w-7 h-7 flex items-center justify-center hover:bg-gray-100 rounded-md transition-colors text-gray-400 hover:text-gray-600"
              title="最小化"
            >
              <Minus size={14} />
            </button>
            <button
              onClick={() => getCurrentWindow()?.close()}
              className="w-7 h-7 flex items-center justify-center hover:bg-red-500 hover:text-white rounded-md transition-colors text-gray-400"
              title="关闭"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </header>

      <div className="p-5" style={{ marginTop: "40px" }}>
        {/* Settings Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {settingsCards.map((card) => {
            const Icon = card.icon;
            const isActive = activeSection === card.id;
            const Component = card.component;

            return (
              <div key={card.id} className="flex flex-col gap-3">
                {/* Card Button */}
                <button
                  onClick={() => handleCardClick(card.id)}
                  className={`re-card p-5 text-left transition-all duration-200 hover:shadow-md ${
                    isActive
                      ? "ring-2 ring-blue-500 bg-blue-50"
                      : "hover:border-blue-500"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div
                        className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
                          isActive
                            ? "bg-blue-500 text-white"
                            : "bg-gray-100 text-blue-500"
                        }`}
                      >
                        <Icon className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-gray-900">
                          {card.title}
                        </h3>
                        <p className="text-sm text-gray-500 mt-0.5">
                          {card.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-sm font-medium px-3 py-1 rounded-full ${
                          isActive
                            ? "bg-blue-500 text-white"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {card.value}
                      </span>
                      <ChevronRight
                        className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
                          isActive ? "rotate-90" : ""
                        }`}
                      />
                    </div>
                  </div>
                </button>

                {/* Expanded Settings Panel */}
                {isActive && (
                  <div className="re-card p-5 animate-in slide-in-from-top-2 duration-200">
                    <Component onClose={() => setActiveSection(null)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Re-export for backward compatibility
export { EditorSettings, TerminalSettings };
