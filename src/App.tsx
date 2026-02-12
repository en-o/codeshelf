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

// 后端返回的迁移结果类型
interface MigrationResult {
  success: boolean;
  migrated_items: string[];
  errors: string[];
  warnings: string[];
}

// 从 localStorage 迁移旧数据
async function migrateFromLocalStorage() {
  const oldData = localStorage.getItem("codeshelf-storage");
  if (!oldData) return;

  try {
    const data = JSON.parse(oldData);
    console.log("发现 localStorage 旧数据，开始迁移...");

    // 迁移应用设置
    if (data.theme || data.viewMode || data.sidebarCollapsed || data.scanDepth) {
      await invoke("save_app_settings", {
        input: {
          theme: data.theme,
          view_mode: data.viewMode,
          sidebar_collapsed: data.sidebarCollapsed,
          scan_depth: data.scanDepth,
        }
      });
    }

    // 迁移标签
    if (data.labels?.length) {
      await invoke("save_labels", { labels: data.labels });
    }

    // 迁移分类
    if (data.categories?.length) {
      await invoke("save_categories", { categories: data.categories });
    }

    // 迁移最近查看项目
    if (data.recentDetailProjectIds?.length) {
      await invoke("save_ui_state", {
        input: { recent_detail_project_ids: data.recentDetailProjectIds }
      });
    }

    // 迁移通知
    if (data.notifications?.length) {
      for (const n of data.notifications) {
        await invoke("add_notification", {
          input: {
            notification_type: n.type || "info",
            title: n.title || "",
            message: n.message || "",
          }
        });
      }
    }

    // 清除旧数据
    localStorage.removeItem("codeshelf-storage");
    console.log("已从 localStorage 迁移数据到后端");
  } catch (err) {
    console.error("迁移 localStorage 数据失败:", err);
  }

  // 迁移 Claude Code 快捷配置
  const oldClaudeConfigs = localStorage.getItem("claude-code-quick-configs");
  if (oldClaudeConfigs) {
    try {
      const configs = JSON.parse(oldClaudeConfigs);
      await invoke("save_quick_configs", { configs });
      localStorage.removeItem("claude-code-quick-configs");
      console.log("已迁移 Claude Code 快捷配置");
    } catch (err) {
      console.error("迁移 Claude 快捷配置失败:", err);
    }
  }
}

// 初始化应用：从后端加载所有数据
async function initializeApp() {
  const { setInitialized, addNotification } = useAppStore.getState();

  // 由于 store 中的 setter 会触发后端保存，我们需要直接使用 set
  const storeSet = useAppStore.setState;

  try {
    // 检查后端迁移结果
    const migrationResult = await invoke<MigrationResult | null>("get_migration_result");
    if (migrationResult) {
      // 显示迁移成功信息
      if (migrationResult.migrated_items.length > 0) {
        console.log("数据迁移完成:", migrationResult.migrated_items);
      }

      // 显示迁移警告
      for (const warning of migrationResult.warnings) {
        console.warn("数据迁移警告:", warning);
      }

      // 显示迁移错误（关键错误，需要用户处理）
      if (!migrationResult.success && migrationResult.errors.length > 0) {
        console.error("数据迁移失败:", migrationResult.errors);
        // 延迟添加通知，等待 store 初始化完成
        setTimeout(() => {
          addNotification({
            type: "error",
            title: "数据迁移失败",
            message: `部分旧数据迁移失败，请手动处理：\n${migrationResult.errors.join("\n")}\n\n旧数据位置：%APPDATA%/codeshelf 或 ~/.local/share/codeshelf`,
          });
        }, 500);
      }
    }

    // 先尝试迁移 localStorage 旧数据
    await migrateFromLocalStorage();

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

    // 使用 storeSet 直接设置状态，避免触发后端保存
    storeSet({
      theme: (settings.theme || "light") as Theme,
      viewMode: (settings.view_mode || "grid") as "grid" | "list",
      sidebarCollapsed: settings.sidebar_collapsed || false,
      scanDepth: settings.scan_depth || 3,
      labels: labels?.length > 0 ? labels : ["Java", "Python", "JavaScript", "TypeScript", "React", "Vue", "Node.js", "Go", "Rust", "Spring Boot"],
      categories: categories || [],
      editors: editors || [],
      terminalConfig,
      projects: projects || [],
      recentDetailProjectIds: uiState.recent_detail_project_ids || [],
      notifications: notificationsFormatted,
      initialized: true,
    });

    console.log("应用初始化完成，已从后端加载所有数据");
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
