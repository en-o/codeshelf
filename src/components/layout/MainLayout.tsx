import { ReactNode, useState, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { useAppStore } from "@/stores/appStore";

interface MainLayoutProps {
  children: (currentPage: string) => ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const [currentPage, setCurrentPage] = useState("shelf");
  const { theme } = useAppStore();

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  const { sidebarCollapsed } = useAppStore();

  // Use the 1:1 classes from index.css
  return (
    <div className="flex w-full min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} />

      <div className={`re-main-wrap ${sidebarCollapsed ? 'expanded' : ''}`}>
        <main className="flex-1">
          {children(currentPage)}
        </main>

        <footer className="re-footer">
          <p>
            <span className="v">CodeShelf v0.1.0</span> | 代码书架 - 本地项目管理工具 | <span style={{ opacity: 0.8 }}>by tan</span> | 基于 Tauri + React + TypeScript
          </p>
        </footer>
      </div>
    </div>
  );
}
