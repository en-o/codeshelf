import { useState, useEffect } from "react";
import {
  Search,
  Activity,
  Download,
  Server,
  Terminal,
  ChevronLeft,
  Radio,
  Keyboard,
  ClipboardList,
  Box,
  Network,
  FileText,
  Send,
  Globe,
} from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { MacWindowControls } from "@/components/layout/MacWindowControls";
import type { ToolType } from "@/types/toolbox";

// 子页面组件
import { FileDownloader } from "./FileDownloader";
import { LocalService } from "./LocalService";
import { SystemMonitor } from "./SystemMonitor";
import { ClaudeCodeManager } from "./ClaudeCodeManager";
import NetcatTool from "./netcat";
import { ShortcutsMemo } from "./ShortcutsMemo";
import { ClipboardManager } from "./ClipboardManager";
import { DockerImageTool } from "./DockerImageTool";
import { SshTunnel } from "./SshTunnel";
import { ReverseTunnel } from "./ReverseTunnel";
import { ResumeGenerator } from "./ResumeGenerator";
import { PairDrop } from "./PairDrop";

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
    id: "docker" as ToolType,
    name: "Docker 镜像",
    description: "发现和编辑 Dockerfile，生成模板，构建、运行、推送和删除镜像",
    icon: Box,
    color: "bg-sky-500",
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
  {
    id: "shortcuts" as ToolType,
    name: "快捷键备忘",
    description: "预置 Mac/Windows 常用快捷键，支持自定义编辑、搜索、导入导出",
    icon: Keyboard,
    color: "bg-amber-500",
  },
  {
    id: "clipboard" as ToolType,
    name: "剪贴板历史",
    description: "自动记录复制内容，支持搜索、置顶、持久化存储，快捷键快速呼出",
    icon: ClipboardList,
    color: "bg-teal-500",
  },
  {
    id: "resume" as ToolType,
    name: "简历生成",
    description: "基于 LangChain Deep Agents 分析项目代码，生成项目背景知识和 STAR 简历经历",
    icon: FileText,
    color: "bg-indigo-500",
    beta: true,
  },
  {
    id: "sshTunnel" as ToolType,
    name: "SSH 隧道",
    description: "通过 SSH 将远程内网端口映射到本地，例如远程 Redis/MySQL/管理面板",
    icon: Network,
    color: "bg-emerald-500",
    beta: true,
  },
  {
    id: "reverseTunnel" as ToolType,
    name: "内网穿透",
    description: "通过 SSH 反向隧道把本地服务映射到你的 VPS 公网端口，用于 webhook 等外网回调调试",
    icon: Globe,
    color: "bg-orange-500",
    beta: true,
  },
  {
    id: "pairdrop" as ToolType,
    name: "跨设备传输",
    description: "局域网内一对一收发文字和文件，浏览器扫码即用，所有数据内存中转",
    icon: Send,
    color: "bg-pink-500",
    beta: true,
  },
];

export function ToolboxPage() {
  const { sidebarCollapsed, setSidebarCollapsed } = useSettingsStore();
  const {
    toolboxDockerProjectName,
    toolboxDockerProjectPath,
    toolboxNavigateTarget,
    clearToolboxDockerProject,
    clearToolboxNavigateTarget,
  } = useUiStore();
  const [activeTool, setActiveTool] = useState<ToolType | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // 响应外部导航请求（如全局快捷键）
  useEffect(() => {
    if (toolboxNavigateTarget) {
      setActiveTool(toolboxNavigateTarget);
      clearToolboxNavigateTarget();
    }
  }, [toolboxNavigateTarget]);

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
      case "docker":
        return (
          <DockerImageTool
            onBack={() => setActiveTool(null)}
            initialProjectPath={toolboxDockerProjectPath || undefined}
            initialProjectName={toolboxDockerProjectName || undefined}
            onInitialProjectConsumed={clearToolboxDockerProject}
          />
        );
      case "claude":
        return <ClaudeCodeManager onBack={() => setActiveTool(null)} />;
      case "netcat":
        return <NetcatToolPanel onBack={() => setActiveTool(null)} />;
      case "shortcuts":
        return <ShortcutsMemo onBack={() => setActiveTool(null)} />;
      case "clipboard":
        return <ClipboardManager onBack={() => setActiveTool(null)} />;
      case "resume":
        return <ResumeGenerator onBack={() => setActiveTool(null)} />;
      case "sshTunnel":
        return <SshTunnel onBack={() => setActiveTool(null)} />;
      case "reverseTunnel":
        return <ReverseTunnel onBack={() => setActiveTool(null)} />;
      case "pairdrop":
        return <PairDrop onBack={() => setActiveTool(null)} />;
      default:
        return null;
    }
  };

  // 如果有选中的工具，显示工具面板
  if (activeTool) {
    // 统一铺不透明底：主窗口是 transparent（做圆角用），工具页某些状态（加载间隙、
    // 空列表、重连抖动、渲染兜底）内容区为空时会透出桌面（"变透明"）。这里兜一层
    // opaque 背景覆盖所有工具，避免逐个工具漏铺底色。
    return (
      <div className="h-full min-h-0 bg-white dark:bg-gray-900">
        {renderToolPanel()}
      </div>
    );
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
          <MacWindowControls />
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
  beta,
}: {
  title: string;
  icon: React.ElementType;
  onBack: () => void;
  actions?: React.ReactNode;
  beta?: boolean;
}) {
  const { sidebarCollapsed, setSidebarCollapsed } = useSettingsStore();

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
        <span className="text-lg font-semibold">
          {title}
          {beta && (
            <sup className="ml-1 text-[10px] font-medium text-orange-500 dark:text-orange-400">
              Beta
            </sup>
          )}
        </span>
      </div>

      <div className="flex-1" data-tauri-drag-region />

      {/* 操作按钮 */}
      <div className="re-actions flex items-center gap-2">
        {actions}

        {/* 窗口控制 */}
        <MacWindowControls />
      </div>
    </header>
  );
}

// Netcat 工具面板
function NetcatToolPanel({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <ToolPanelHeader title="Netcat" icon={Radio} onBack={onBack} beta />
      <div className="flex-1 overflow-hidden">
        <NetcatTool />
      </div>
    </div>
  );
}
