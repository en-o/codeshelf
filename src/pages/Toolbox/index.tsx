import { useState } from "react";
import {
  Search,
  Activity,
  Download,
  Server,
  Terminal,
  Minus,
  X,
  ChevronLeft,
  Radio,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "@/stores/appStore";
import type { ToolType } from "@/types/toolbox";

// 子页面组件
import { FileDownloader } from "./FileDownloader";
import { LocalService } from "./LocalService";
import { SystemMonitor } from "./SystemMonitor";
import { ClaudeCodeManager } from "./ClaudeCodeManager";
import NetcatTool from "./NetcatTool";

const tools = [
  {
    id: "monitor" as ToolType,
    name: "系统监控",
    description: "端口扫描、本地端口占用查看、进程管理和系统资源监控",
    icon: Activity,
    color: "bg-blue-500",
  },
  {
    id: "downloader" as ToolType,
    name: "文件下载",
    description: "下载远程文件，支持断点续传、重试机制和下载队列管理",
    icon: Download,
    color: "bg-green-500",
  },
  {
    id: "server" as ToolType,
    name: "本地服务",
    description: "统一管理 Web 静态服务和端口转发，支持 CORS、gzip 和多代理规则",
    icon: Server,
    color: "bg-orange-500",
  },
  {
    id: "claude" as ToolType,
    name: "Claude Code",
    description: "管理 Claude Code 配置文件，检查安装状态，编辑全局设置",
    icon: Terminal,
    color: "bg-purple-500",
  },
  {
    id: "netcat" as ToolType,
    name: "Netcat",
    description: "TCP/UDP 协议测试工具，支持客户端和服务器模式，用于调试物联网设备",
    icon: Radio,
    color: "bg-cyan-500",
    beta: true,
  },
];

export function ToolboxPage() {
  const { sidebarCollapsed, setSidebarCollapsed } = useAppStore();
  const [activeTool, setActiveTool] = useState<ToolType | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // 过滤工具
  const filteredTools = tools.filter(
    (tool) =>
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 渲染工具详情页
  const renderToolPanel = () => {
    switch (activeTool) {
      case "monitor":
        return <SystemMonitor onBack={() => setActiveTool(null)} />;
      case "downloader":
        return <FileDownloader onBack={() => setActiveTool(null)} />;
      case "server":
        return <LocalService onBack={() => setActiveTool(null)} />;
      case "claude":
        return <ClaudeCodeManager onBack={() => setActiveTool(null)} />;
      case "netcat":
        return <NetcatToolPanel onBack={() => setActiveTool(null)} />;
      default:
        return null;
    }
  };

  // 如果有选中的工具，显示工具面板
  if (activeTool) {
    return renderToolPanel();
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* 页面头部 */}
      <header className="re-header sticky top-0 z-20" data-tauri-drag-region>
        <span
          className="toggle"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          ☰
        </span>

        <div
          className="flex items-center gap-2 mr-4"
          data-tauri-drag-region
        >
          <span className="text-lg font-semibold ml-2">🧰 工具箱</span>
        </div>

        {/* 搜索框 */}
        <div className="re-search-center" data-tauri-drag-region>
          <div className="re-search-box">
            <input
              type="text"
              placeholder="搜索工具..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button>
              <Search size={16} />
            </button>
          </div>
        </div>

        {/* 窗口控制 */}
        <div className="re-actions flex items-center gap-2">
          <div className="flex items-center ml-2 border-l border-gray-200 dark:border-gray-700 pl-3 gap-1 h-6">
            <button
              onClick={() => getCurrentWindow()?.minimize()}
              className="w-7 h-7 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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

      {/* 主内容区域 */}
      <div className="flex-1 p-6">
        {filteredTools.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Search size={48} className="mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2 text-gray-700 dark:text-gray-300">
              未找到匹配的工具
            </p>
            <p className="text-sm">尝试使用其他关键词搜索</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTools.map((tool) => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  onClick={() => setActiveTool(tool.id)}
                  className="re-card p-5 text-left hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 group"
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={`${tool.color} w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform`}
                    >
                      <Icon size={24} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 dark:text-white mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {tool.name}
                        {tool.beta && (
                          <sup className="ml-1 text-[10px] font-medium text-orange-500 dark:text-orange-400">
                            Beta
                          </sup>
                        )}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                        {tool.description}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// 通用的工具面板头部组件
export function ToolPanelHeader({
  title,
  icon: Icon,
  onBack,
  actions,
}: {
  title: string;
  icon: React.ElementType;
  onBack: () => void;
  actions?: React.ReactNode;
}) {
  const { sidebarCollapsed, setSidebarCollapsed } = useAppStore();

  return (
    <header className="re-header sticky top-0 z-20" data-tauri-drag-region>
      <span
        className="toggle"
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
      >
        ☰
      </span>

      <div className="flex items-center gap-2 mr-4" data-tauri-drag-region>
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-gray-500 hover:text-blue-600 transition-colors"
        >
          <ChevronLeft size={20} />
        </button>
        <Icon size={20} className="text-blue-500" />
        <span className="text-lg font-semibold">{title}</span>
      </div>

      <div className="flex-1" data-tauri-drag-region />

      {/* 操作按钮 */}
      <div className="re-actions flex items-center gap-2">
        {actions}

        {/* 窗口控制 */}
        <div className="flex items-center ml-2 border-l border-gray-200 dark:border-gray-700 pl-3 gap-1 h-6">
          <button
            onClick={() => getCurrentWindow()?.minimize()}
            className="w-7 h-7 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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
  );
}

// Netcat 工具面板
function NetcatToolPanel({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <ToolPanelHeader title="协议测试" icon={Radio} onBack={onBack} />
      <div className="flex-1 overflow-hidden">
        <NetcatTool />
      </div>
    </div>
  );
}
