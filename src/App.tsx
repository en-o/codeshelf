import { useEffect, useState, lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MainLayout } from "@/components/layout";
import { ToastContainer, UpdateNotification, ShortcutQuickLookup, ClipboardQuickAccess, AppContextMenu, showToast } from "@/components/ui";
import { ConfirmHost } from "@/components/common/useConfirm";
import { StartupErrorScreen } from "@/components/common/StartupErrorScreen";
import { commands, type StartupStatus } from "@/bindings";

// 页面按需加载：各 page 拆成独立 chunk，避免初始 index.js 突破 1MB。
// 各 page 模块都是 named export，所以用 .then 包一层成 default。
const ShelfPage = lazy(() => import("@/pages/Shelf").then((m) => ({ default: m.ShelfPage })));
const DashboardPage = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.DashboardPage })));
const SettingsPage = lazy(() => import("@/pages/Settings").then((m) => ({ default: m.SettingsPage })));
const ToolboxPage = lazy(() => import("@/pages/Toolbox").then((m) => ({ default: m.ToolboxPage })));
const AiProvidersPage = lazy(() => import("@/pages/AiProviders").then((m) => ({ default: m.AiProvidersPage })));
const ChatPage = lazy(() => import("@/pages/Chat").then((m) => ({ default: m.ChatPage })));
const WorkflowsPage = lazy(() => import("@/pages/Workflows").then((m) => ({ default: m.WorkflowsPage })));
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

  try {
    // 并行加载所有数据
    const [settings, labels, categories, editors, terminal, projects, uiState, notifications, appShortcuts, aiProviders, sensitiveFilePatterns, savedResumes] = await Promise.all([
      invoke<AppSettings>("get_app_settings"),
      invoke<string[]>("get_labels"),
      invoke<string[]>("get_categories"),
      invoke<EditorConfig[]>("get_editors"),
      invoke<TerminalConfigBackend>("get_terminal_config"),
      invoke<Project[]>("get_projects"),
      invoke<UiState>("get_ui_state"),
      invoke<NotificationBackend[]>("get_notifications"),
      invoke<AppShortcutBinding[]>("get_app_shortcuts"),
      invoke<AiProviderConfig[]>("get_ai_providers"),
      invoke<string[]>("get_sensitive_file_patterns"),
      invoke<unknown[]>("get_resumes"),
    ]);

    // 转换终端配置格式
    const terminalConfig: TerminalConfig = {
      type: (terminal.terminal_type || "default") as TerminalConfig["type"],
      customPath: terminal.custom_path,
      paths: terminal.terminal_path ? {
        [terminal.terminal_type]: terminal.terminal_path
      } : undefined,
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
  } catch (err) {
    console.error("初始化应用失败:", err);
    setInitialized(true); // 即使失败也标记为已初始化，使用默认值
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

  // 应用外部添加项目：Windows 右键菜单 / 命令行 / macOS「打开方式」与 Dock 拖放。
  // 已在书架里的不报错，直接定位过去（后端 created=false）。
  useEffect(() => {
    const added = listen<{ project: Project; created: boolean }>(
      "project-added-externally",
      (event) => {
        const { project, created } = event.payload;
        const store = useProjectsStore.getState();
        if (created) {
          store.addProject(project);
          store.markProjectDirty(project.path);
        }
        store.setSelectedProjectId(project.id);
        useUiStore.getState().setCurrentPage("shelf");
        showToast(
          created ? "success" : "info",
          created ? "已添加到书架" : "该项目已在书架中",
          project.name
        );
      }
    );
    const failed = listen<string>("project-add-failed", (event) => {
      showToast("error", "添加项目失败", event.payload);
    });
    return () => {
      added.then((fn) => fn());
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
