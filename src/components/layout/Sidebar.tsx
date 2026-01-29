import { useState } from "react";
import {
  BookOpen,
  LayoutDashboard,
  Settings,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { AnimatedLogo } from "@/components/ui/AnimatedLogo";

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
  const [showLogoPopup, setShowLogoPopup] = useState(false);

  return (
    <aside
      className={`re-nav ${sidebarCollapsed ? "collapsed" : ""}`}
    >
      <div
        className="re-logo select-none relative"
        onMouseEnter={() => setShowLogoPopup(true)}
        onMouseLeave={() => setShowLogoPopup(false)}
      >
        <AnimatedLogo size={30} /> CodeShelf

        {/* 悬浮展开的大图标 */}
        {showLogoPopup && (
          <div
            className="absolute left-full top-0 ml-4 z-50 p-4 rounded-xl
                       bg-[#020408]/95 backdrop-blur-xl border border-[#00f5ff]/30
                       shadow-[0_0_40px_rgba(0,245,255,0.2)]
                       animate-in fade-in slide-in-from-left-2 duration-300"
            style={{
              background: `
                radial-gradient(circle at 30% 30%, rgba(0, 245, 255, 0.1) 0%, transparent 50%),
                radial-gradient(circle at 70% 70%, rgba(188, 19, 254, 0.1) 0%, transparent 50%),
                rgba(2, 4, 8, 0.95)
              `
            }}
          >
            {/* 扫描线效果 */}
            <div
              className="absolute top-0 left-0 right-0 h-[2px] overflow-hidden"
              style={{
                background: "linear-gradient(90deg, transparent, #00f5ff, transparent)",
                animation: "scanline 3s linear infinite",
              }}
            />

            <div className="text-center">
              <AnimatedLogo size={200} theme="dark" />
              <div className="mt-3 space-y-1">
                <div
                  className="text-lg font-bold tracking-[4px] uppercase"
                  style={{
                    background: "linear-gradient(90deg, #00f5ff, #bc13fe, #00f5ff)",
                    backgroundSize: "200% auto",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    animation: "hologramShift 3s linear infinite",
                  }}
                >
                  CODESHELF
                </div>
                <div className="text-[#bc13fe] text-xs tracking-[2px] opacity-80">
                  /// GIT_SHELF_MANAGER
                </div>
              </div>
            </div>
          </div>
        )}
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

      {/* 动画关键帧 */}
      <style>{`
        @keyframes scanline {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes hologramShift {
          0% { background-position: 0% center; }
          100% { background-position: 200% center; }
        }
      `}</style>
    </aside>
  );
}
