import { useState, useEffect } from "react";
import { useSettingsStore, Theme } from "@/stores/settingsStore";
import { useEditorsStore, TerminalConfig } from "@/stores/editorsStore";
import { useProjectsStore } from "@/stores/projectsStore";
import { Monitor, Code, Terminal, Search, ChevronRight, Tag, Download, Info, Keyboard, Link2, Server, MousePointerClick, Bot } from "lucide-react";
import { PageHeader } from "@/components/common";
import { getVersion } from "@tauri-apps/api/app";
import { EditorSettings } from "./EditorSettings";
import { TerminalSettings } from "./TerminalSettings";
import { ScanSettings } from "./ScanSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { LabelSettings } from "./LabelSettings";
import { UpdateSettings } from "./UpdateSettings";
import { AboutSettings } from "./AboutSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import { ChatBridgeSettings } from "./ChatBridgeSettings";
import { McpGatewaySettings } from "./McpGatewaySettings";
import { ShellIntegrationSettings } from "./ShellIntegrationSettings";
import { DshSettings } from "./DshSettings";

type SettingsSection = "appearance" | "editor" | "terminal" | "scan" | "labels" | "shortcuts" | "chatBridge" | "mcpGateway" | "shellIntegration" | "dsh" | "update" | "about" | null;

export function SettingsPage() {
  const theme = useSettingsStore((s) => s.theme);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const scanDepth = useSettingsStore((s) => s.scanDepth);
  const appShortcuts = useSettingsStore((s) => s.appShortcuts);
  const editors = useEditorsStore((s) => s.editors);
  const terminalConfig = useEditorsStore((s) => s.terminalConfig);
  const labels = useProjectsStore((s) => s.labels);
  const [activeSection, setActiveSection] = useState<SettingsSection>(null);
  const [appVersion, setAppVersion] = useState<string>("...");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("未知"));
  }, []);

  // 获取默认编辑器名称
  const getDefaultEditorName = () => {
    if (editors.length === 0) return "未配置（使用系统默认）";
    return editors[0].name;
  };

  // 获取主题显示名称
  const getThemeName = (t: Theme) => {
    return t === "light" ? "浅色模式" : "深色模式";
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
    {
      id: "labels" as const,
      title: "标签管理",
      description: "管理项目技术栈标签",
      icon: Tag,
      value: `${labels.length} 个标签`,
      component: LabelSettings,
    },
    {
      id: "shortcuts" as const,
      title: "快捷键",
      description: "管理应用快捷键绑定",
      icon: Keyboard,
      value: `${appShortcuts.filter((s) => s.enabled).length || 11} 个启用`,
      component: ShortcutSettings,
    },
    {
      id: "chatBridge" as const,
      title: "聊天桥接",
      description: "OpenClaw 中继，接入飞书/钉钉/企微",
      icon: Link2,
      value: "点击配置",
      component: ChatBridgeSettings,
    },
    {
      id: "mcpGateway" as const,
      title: "MCP Gateway",
      description: "将接口库暴露给 Claude/Codex/Kimi/Copilot",
      icon: Server,
      value: "外部调用",
      component: McpGatewaySettings,
    },
    {
      id: "shellIntegration" as const,
      title: "右键菜单",
      description: "在文件管理器里右键文件夹加入书架",
      icon: MousePointerClick,
      value: "快速添加",
      component: ShellIntegrationSettings,
    },
    {
      id: "dsh" as const,
      title: "dsh 引擎",
      description: "DeepSeek Harness，会话可切换的对话引擎",
      icon: Bot,
      value: "点击配置",
      component: DshSettings,
    },
    {
      id: "update" as const,
      title: "应用更新",
      description: "检查并安装新版本",
      icon: Download,
      value: `v${appVersion}`,
      component: UpdateSettings,
    },
    {
      id: "about" as const,
      title: "关于",
      description: "应用信息与系统依赖",
      icon: Info,
      value: "CodeShelf",
      component: AboutSettings,
    },
  ];

  const handleCardClick = (section: SettingsSection) => {
    setActiveSection(activeSection === section ? null : section);
  };

  return (
    <div className="flex flex-col min-h-full">
      {/* Header with Title and Integrated Window Controls */}
      <PageHeader
        title="⚙️ 设置"
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

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
