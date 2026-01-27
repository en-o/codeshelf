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

  // Use the 1:1 classes from index.css
  return (
    <div className="flex w-full min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} />

      <div className="re-main-wrap">
        <main className="flex-1">
          {children(currentPage)}
        </main>
      </div>
    </div>
  );
}
