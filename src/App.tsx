import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { MainLayout } from "@/components/layout";
import { ShelfPage } from "@/pages/Shelf";
import { DashboardPage } from "@/pages/Dashboard";
import { SettingsPage } from "@/pages/Settings";
import { ToolboxPage } from "@/pages/Toolbox";
import { ToastContainer, UpdateNotification } from "@/components/ui";
import { useAppStore } from "@/stores/appStore";
import type { Project, Notification } from "@/types";
import type { EditorConfig, TerminalConfig, Theme } from "@/stores/appStore";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

// 后端返回的应用设置类型
interface AppSettings {
  theme: string;
  view_mode: string;
  sidebar_collapsed: boolean;
  scan_depth: number;
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
  const { setInitialized } = useAppStore.getState();
  const storeSet = useAppStore.setState;

  try {
    // 并行加载所有数据
    const [settings, labels, categories, editors, terminal, projects, uiState, notifications] = await Promise.all([
      invoke<AppSettings>("get_app_settings"),
      invoke<string[]>("get_labels"),
      invoke<string[]>("get_categories"),
      invoke<EditorConfig[]>("get_editors"),
      invoke<TerminalConfigBackend>("get_terminal_config"),
      invoke<Project[]>("get_projects"),
      invoke<UiState>("get_ui_state"),
      invoke<NotificationBackend[]>("get_notifications"),
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

    // 直接设置状态，使用后端返回的数据（后端会处理默认值）
    storeSet({
      theme: (settings.theme || "light") as Theme,
      viewMode: (settings.view_mode || "grid") as "grid" | "list",
      sidebarCollapsed: settings.sidebar_collapsed || false,
      scanDepth: settings.scan_depth || 3,
      labels: labels || [],
      categories: categories || [],
      editors: editors || [],
      terminalConfig,
      projects: projects || [],
      recentDetailProjectIds: uiState.recent_detail_project_ids || [],
      notifications: notificationsFormatted,
      initialized: true,
    });

    console.log("应用初始化完成，已从 data 目录加载数据");
  } catch (err) {
    console.error("初始化应用失败:", err);
    setInitialized(true); // 即使失败也标记为已初始化，使用默认值
  }
}

function AppContent() {
  const initialized = useAppStore((state) => state.initialized);

  useEffect(() => {
    initializeApp();
  }, []);

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
      <MainLayout>
        {(currentPage) => {
          switch (currentPage) {
            case "shelf":
              return <ShelfPage />;
            case "dashboard":
              return <DashboardPage />;
            case "toolbox":
              return <ToolboxPage />;
            case "settings":
              return <SettingsPage />;
            default:
              return <ShelfPage />;
          }
        }}
      </MainLayout>
      <ToastContainer />
      <UpdateNotification />
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
