import { ReactNode, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { useUiStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getVersion } from "@tauri-apps/api/app";
import { useState } from "react";

interface MainLayoutProps {
  children: (currentPage: string) => ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const theme = useSettingsStore((s) => s.theme);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const currentPage = useUiStore((s) => s.currentPage);
  const setCurrentPage = useUiStore((s) => s.setCurrentPage);
  const [appVersion, setAppVersion] = useState<string>("...");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("未知"));
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  // Use the 1:1 classes from index.css
  return (
    <div className="relative flex w-full h-screen overflow-hidden bg-gray-50 text-gray-900 rounded-xl">
      <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} />

      <div className={`re-main-wrap ${sidebarCollapsed ? 'expanded' : ''}`}>
        <main className="flex-1 min-h-0 overflow-auto silent-scroll">
          {children(currentPage)}
        </main>

        <footer className="re-footer">
          <p>
            <span className="font-semibold text-gray-700">CodeShelf v{appVersion}</span> | 代码书架 - 本地项目管理工具 | 基于 Tauri + React + TypeScript
          </p>
        </footer>
      </div>

      {/* 透明无边框窗口放在纯白桌面上时，系统阴影在部分机型上几乎不可见。
          用覆盖层画一圈稳定的内边框，避免被 fixed 侧栏或页面背景盖住。 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[100] rounded-xl border border-black/[0.12] dark:border-white/[0.12]"
      />
    </div>
  );
}
