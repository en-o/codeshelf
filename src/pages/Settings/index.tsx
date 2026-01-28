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
          <div className="flex items-center ml-4 border-l border-[var(--border)] pl-3 gap-1 h-6">
            <button
              onClick={() => getCurrentWindow()?.minimize()}
              className="w-7 h-7 flex items-center justify-center hover:bg-[rgba(0,0,0,0.05)] rounded-md transition-colors text-[var(--text-light)] hover:text-[var(--text)]"
              title="最小化"
            >
              <Minus size={14} />
            </button>
            <button
              onClick={() => getCurrentWindow()?.close()}
              className="w-7 h-7 flex items-center justify-center hover:bg-red-500 hover:text-white rounded-md transition-colors text-[var(--text-light)]"
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
                      ? "ring-2 ring-[var(--primary)] bg-[var(--primary-light)]"
                      : "hover:border-[var(--primary)]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div
                        className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
                          isActive
                            ? "bg-[var(--primary)] text-white"
                            : "bg-[var(--bg-light)] text-[var(--primary)]"
                        }`}
                      >
                        <Icon className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-[var(--text)]">
                          {card.title}
                        </h3>
                        <p className="text-sm text-[var(--text-light)] mt-0.5">
                          {card.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-sm font-medium px-3 py-1 rounded-full ${
                          isActive
                            ? "bg-[var(--primary)] text-white"
                            : "bg-[var(--bg-light)] text-[var(--text-light)]"
                        }`}
                      >
                        {card.value}
                      </span>
                      <ChevronRight
                        className={`w-5 h-5 text-[var(--text-light)] transition-transform duration-200 ${
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
