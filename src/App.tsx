import { useEffect, useState, lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MainLayout } from "@/components/layout";
import { ToastContainer, UpdateNotification, ShortcutQuickLookup, ClipboardQuickAccess, AppContextMenu, showToast } from "@/components/ui";
import { ConfirmHost } from "@/components/common/useConfirm";
import { StartupErrorScreen } from "@/components/common/StartupErrorScreen";
import { commands, type ExternalAddEvent, type StartupStatus } from "@/bindings";

// 页面按需加载：各 page 拆成独立 chunk，避免初始 index.js 突破 1MB。
// 各 page 模块都是 named export，所以用 .then 包一层成 default。
const ShelfPage = lazy(() => import("@/pages/Shelf").then((m) => ({ default: m.ShelfPage })));
const DashboardPage = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.DashboardPage })));
const SettingsPage = lazy(() => import("@/pages/Settings").then((m) => ({ default: m.SettingsPage })));
const ToolboxPage = lazy(() => import("@/pages/Toolbox").then((m) => ({ default: m.ToolboxPage })));
const AiProvidersPage = lazy(() => import("@/pages/AiProviders").then((m) => ({ default: m.AiProvidersPage })));
const ChatPage = lazy(() => import("@/pages/Chat").then((m) => ({ default: m.ChatPage })));
const WorkflowsPage = lazy(() => import("@/pages/Workflows").then((m) => ({ default: m.WorkflowsPage })));
const DshPage = lazy(() => import("@/pages/Dsh").then((m) => ({ default: m.DshPage })));
const ApiChatPage = lazy(() => import("@/pages/ApiChat").then((m) => ({ default: m.ApiChatPage })));
import { useAiProvidersStore } from "@/stores/aiProvidersStore";
import { useEditorsStore, type EditorConfig, type TerminalConfig } from "@/stores/editorsStore";
import { useNotificationsStore } from "@/stores/notificationsStore";
import { useProjectsStore } from "@/stores/projectsStore";
import { useResumeStore } from "@/stores/resumeStore";
import { useSettingsStore, type Theme } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { useAppShortcuts } from "@/hooks/useAppShortcuts";
import type { Project, Notification, AppShortcutBinding, AiProviderConfig } from "@/types";
import type { ToolType } from "@/types/toolbox";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  );
}

// 后端返回的应用设置类型
interface AppSettings {
  theme: string;
  view_mode: string;
  sidebar_collapsed: boolean;
  scan_depth: number;
  auto_update: boolean;
  chat_history_dir?: string;
  show_dock_icon?: boolean;
}

// 后端返回的 UI 状态类型
interface UiState {
  recent_detail_project_ids: string[];
}

// 后端返回的终端配置类型
interface TerminalConfigBackend {
  terminal_type: string;
  custom_path?: string;
  terminal_path?: string;
  /** 每种终端各自的路径（新字段）；老配置只有单值 terminal_path */
  terminal_paths?: Record<string, string>;
}

// 后端返回的通知类型
interface NotificationBackend {
  id: string;
  notification_type: string;
  title: string;
  message: string;
  created_at: string;
}

// 初始化应用：从后端 data 目录加载所有数据
async function initializeApp() {
  const setInitialized = useUiStore.getState().setInitialized;

  // 各数据域**独立**成败。原来十二项共用一个 `Promise.all`：任何一项失败
  // （比如某个可选配置文件损坏）都会让其余全部成功的结果被一起丢弃，
  // 然后以空 store 标记初始化完成 —— 用户看到的就是「数据全没了」。
  const failed: string[] = [];
  async function load<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
    try {
      const v = await fn();
      return v ?? fallback;
    } catch (err) {
      console.error(`加载${label}失败:`, err);
      failed.push(label);
      return fallback;
    }
  }

  try {
    // 并行加载，但逐项容错
    const [settings, labels, categories, editors, terminal, projects, uiState, notifications, appShortcuts, aiProviders, sensitiveFilePatterns, savedResumes] = await Promise.all([
      load("应用设置", {} as AppSettings, () => invoke<AppSettings>("get_app_settings")),
      load("标签", [] as string[], () => invoke<string[]>("get_labels")),
      load("分类", [] as string[], () => invoke<string[]>("get_categories")),
      load("编辑器配置", [] as EditorConfig[], () => invoke<EditorConfig[]>("get_editors")),
      load("终端配置", {} as TerminalConfigBackend, () => invoke<TerminalConfigBackend>("get_terminal_config")),
      load("项目列表", [] as Project[], () => invoke<Project[]>("get_projects")),
      load("界面状态", {} as UiState, () => invoke<UiState>("get_ui_state")),
      load("通知", [] as NotificationBackend[], () => invoke<NotificationBackend[]>("get_notifications")),
      load("快捷键", [] as AppShortcutBinding[], () => invoke<AppShortcutBinding[]>("get_app_shortcuts")),
      load("AI 供应商", [] as AiProviderConfig[], () => invoke<AiProviderConfig[]>("get_ai_providers")),
      load("敏感文件规则", [] as string[], () => invoke<string[]>("get_sensitive_file_patterns")),
      load("简历数据", [] as unknown[], () => invoke<unknown[]>("get_resumes")),
    ]);

    // 转换终端配置格式
    const terminalConfig: TerminalConfig = {
      type: (terminal.terminal_type || "default") as TerminalConfig["type"],
      customPath: terminal.custom_path,
      // 优先用后端的完整 map；老配置只有单值 terminal_path 时退回到它
      paths:
        terminal.terminal_paths && Object.keys(terminal.terminal_paths).length > 0
          ? (terminal.terminal_paths as TerminalConfig["paths"])
          : terminal.terminal_path
            ? ({ [terminal.terminal_type]: terminal.terminal_path } as TerminalConfig["paths"])
            : undefined,
    };

    // 转换通知格式
    const notificationsFormatted: Notification[] = notifications.map(n => ({
      id: n.id,
      type: n.notification_type as Notification["type"],
      title: n.title,
      message: n.message,
      createdAt: n.created_at,
    }));

    const normalizedAiProviders = useAiProvidersStore.getState().ensureAiDefaultProvider(aiProviders || []);

    useSettingsStore.setState({
      theme: (settings.theme || "light") as Theme,
      viewMode: (settings.view_mode || "grid") as "grid" | "list",
      sidebarCollapsed: settings.sidebar_collapsed || false,
      scanDepth: settings.scan_depth || 3,
      autoUpdate: settings.auto_update !== false,
      chatHistoryDir: settings.chat_history_dir,
      showDockIcon: settings.show_dock_icon === true,
      appShortcuts: appShortcuts || [],
      sensitiveFilePatterns: sensitiveFilePatterns || [],
    });
    useProjectsStore.setState({
      labels: labels || [],
      categories: categories || [],
      projects: projects || [],
      recentDetailProjectIds: uiState.recent_detail_project_ids || [],
    });
    useEditorsStore.setState({
      editors: editors || [],
      terminalConfig,
    });
    useNotificationsStore.setState({ notifications: notificationsFormatted });
    useAiProvidersStore.setState({ aiProviders: normalizedAiProviders });
    useResumeStore.getState().setSavedResumes(savedResumes || []);
    useUiStore.setState({ initialized: true });

    // 有域加载失败时必须说出来。静默用默认值启动，用户会以为数据真的没了，
    // 进而做出「重新添加项目」这类会覆盖掉原数据的动作。
    if (failed.length > 0) {
      showToast(
        "warning",
        "部分数据加载失败",
        `${failed.join("、")}已暂用默认值。请勿在此状态下修改这些设置，否则可能覆盖原数据；重启应用可重试。`,
      );
    }
  } catch (err) {
    // load() 已经吞掉了各域的错误，走到这里说明是后续赋值逻辑本身出了问题
    console.error("初始化应用失败:", err);
    setInitialized(true);
    showToast("error", "初始化失败", err instanceof Error ? err.message : String(err));
  }
}

function AppContent() {
  const initialized = useUiStore((state) => state.initialized);
  const popupAutoHideWindow = useUiStore((s) => s.popupAutoHideWindow);
  const [startupError, setStartupError] = useState<StartupStatus | null>(null);

  // 先问后端启动是否失败，再决定要不要加载数据。
  // 数据目录不可写 / 库打不开 / 迁移失败时继续加载，等于用空状态覆盖用户数据。
  useEffect(() => {
    (async () => {
      const res = await commands.getStartupStatus().catch(() => null);
      if (res && res.status === "ok" && res.data.fatalError) {
        setStartupError(res.data);
        return;
      }
      initializeApp();
    })();
  }, []);

  useAppShortcuts();

  // 监听托盘菜单工具箱导航事件
  useEffect(() => {
    const unlisten = listen<string>("navigate-to-tool", (event) => {
      useUiStore.getState().navigateToTool(event.payload as ToolType);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // 应用外部请求添加项目：只把路径带到原有添加弹窗，不绕过分类、标签等表单。
  // Windows 右键菜单 / 命令行 / macOS Finder 服务与 Dock 拖放共用此流程。
  useEffect(() => {
    function applyRequest(path: string) {
      const ui = useUiStore.getState();
      ui.setCurrentPage("shelf");
      ui.enqueueExternalAddProjectPath(path);
    }

    const requested = listen<string>(
      "project-add-requested",
      (event) => applyRequest(event.payload)
    );
    const failed = listen<string>("project-add-failed", (event) => {
      showToast("error", "添加项目失败", event.payload);
    });

    // 冷启动补齐：后端在 setup 阶段就可能收到外部路径，那时 listener 还没注册，
    // 请求直接掉地上会表现为“右键菜单点了没反应”。
    // 后端在「前端就绪」之前只入队不发事件，这里注册完再一次性取走。
    Promise.all([requested, failed])
      .then(() => invoke<ExternalAddEvent[]>("take_pending_external_projects"))
      .then((pending) => {
        for (const evt of pending) {
          if (evt.kind === "requested") applyRequest(evt.payload);
          else showToast("error", "添加项目失败", evt.payload);
        }
      })
      .catch((err) => console.error("读取冷启动待处理项目失败:", err));

    return () => {
      requested.then((fn) => fn());
      failed.then((fn) => fn());
    };
  }, []);

  if (startupError) {
    return <StartupErrorScreen status={startupError} />;
  }

  if (!initialized) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">正在加载...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: popupAutoHideWindow ? 'none' : undefined }}>
        <MainLayout>
          {(currentPage) => (
            <Suspense fallback={<PageFallback />}>
              {(() => {
                switch (currentPage) {
                  case "shelf":
                    return <ShelfPage />;
                  case "dashboard":
                    return <DashboardPage />;
                  case "toolbox":
                    return <ToolboxPage />;
                  case "settings":
                    return <SettingsPage />;
                  case "aiProviders":
                    return <AiProvidersPage />;
                  case "chat":
                    return <ChatPage />;
                  case "dsh":
                    return <DshPage />;
                  case "workflows":
                    return <WorkflowsPage />;
                  case "apiChat":
                    return <ApiChatPage />;
                  default:
                    return <ShelfPage />;
                }
              })()}
            </Suspense>
          )}
        </MainLayout>
      </div>
      <ToastContainer />
      <UpdateNotification />
      <ShortcutQuickLookup />
      <ClipboardQuickAccess />
      <AppContextMenu />
      <ConfirmHost />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
