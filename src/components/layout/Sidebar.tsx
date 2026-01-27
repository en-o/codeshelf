import {
  BookOpen,
  LayoutDashboard,
  Settings,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";

interface SidebarProps {
  currentPage: string;
  onPageChange: (page: string) => void;
}

const navItems = [
  { id: "shelf", label: "项目书架", icon: BookOpen },
  { id: "dashboard", label: "数据统计", icon: LayoutDashboard },
  { id: "settings", label: "设置", icon: Settings },
];

export function Sidebar({ currentPage, onPageChange }: SidebarProps) {
  const { sidebarCollapsed, setSidebarCollapsed } = useAppStore();

  return (
    <aside
      className={`flex flex-col bg-[var(--color-bg-primary)] border-r border-[var(--color-border)] transition-all duration-300 ${
        sidebarCollapsed ? "w-16" : "w-56"
      }`}
    >
      {/* Logo */}
      <div className="flex items-center justify-center h-14 px-4 border-b border-[var(--color-border)]">
        {sidebarCollapsed ? (
          <img src="/favicon.svg" alt="CodeShelf" className="w-7 h-7" />
        ) : (
          <div className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="CodeShelf" className="w-7 h-7" />
            <span className="text-base font-bold text-[var(--color-text-primary)] tracking-tight">
              CodeShelf
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 mb-1 text-sm font-medium rounded-lg transition-all ${
                isActive
                  ? "bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/30"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
              }`}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <Icon className={`w-4.5 h-4.5 flex-shrink-0 ${isActive ? "text-white" : ""}`} />
              {!sidebarCollapsed && (
                <span className="truncate">{item.label}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Collapse Toggle */}
      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className="flex items-center justify-center h-12 border-t border-[var(--color-border)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
        title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
      >
        {sidebarCollapsed ? (
          <ChevronRight className="w-4.5 h-4.5" />
        ) : (
          <div className="flex items-center gap-2">
            <ChevronLeft className="w-4 h-4" />
            <span className="text-xs">收起</span>
          </div>
        )}
      </button>
    </aside>
  );
}
