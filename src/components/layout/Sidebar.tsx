import {
  BookOpen,
  LayoutDashboard,
  Settings,
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
  const { sidebarCollapsed } = useAppStore();

  return (
    <aside
      className={`re-nav ${sidebarCollapsed ? "collapsed" : ""}`}
    >
      <div className="re-logo select-none">
        <img src="/favicon.svg" alt="logo" width={30} height={30} /> CodeShelf
      </div>

      <nav className="re-menu">
        {navItems.map((item) => {
          const isActive = currentPage === item.id;
          const label = item.id === "shelf" ? "📖 书架" : item.id === "dashboard" ? "📊 统计" : "⚙️ 设置";

          return (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id)}
              className={isActive ? "active" : ""}
            >
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
