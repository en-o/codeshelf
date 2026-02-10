import { ReactNode, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { useAppStore } from "@/stores/appStore";
import { getVersion } from "@tauri-apps/api/app";
import { useState } from "react";

interface MainLayoutProps {
  children: (currentPage: string) => ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const { theme, sidebarCollapsed, currentPage, setCurrentPage } = useAppStore();
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
    <div className="flex w-full h-screen overflow-hidden bg-gray-50 text-gray-900">
      <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} />

      <div className={`re-main-wrap ${sidebarCollapsed ? 'expanded' : ''}`}>
        <main className="flex-1 min-h-0 overflow-auto silent-scroll">
          {children(currentPage)}
        </main>

        <footer className="re-footer">
          <p>
            <span className="font-semibold text-gray-700">CodeShelf v{appVersion}</span> | 代码书架 - 本地项目管理工具 | <span className="opacity-80">by tan</span> | 基于 Tauri + React + TypeScript
          </p>
        </footer>
      </div>
    </div>
  );
}
