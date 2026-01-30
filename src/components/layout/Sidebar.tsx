import { useState, useEffect } from "react";
import {
  BookOpen,
  LayoutDashboard,
  Settings,
  Clock,
  FolderGit2,
} from "lucide-react";
import { useAppStore, type PageType } from "@/stores/appStore";
import { AnimatedLogo } from "@/components/ui/AnimatedLogo";
import { NotificationPanel } from "@/components/ui/NotificationPanel";
import { getDashboardStats } from "@/services/stats";
import type { Project } from "@/types";

interface SidebarProps {
  currentPage: PageType;
  onPageChange: (page: PageType) => void;
}

const navItems: { id: PageType; label: string; icon: typeof BookOpen }[] = [
  { id: "shelf", label: "项目书架", icon: BookOpen },
  { id: "dashboard", label: "数据统计", icon: LayoutDashboard },
  { id: "settings", label: "设置", icon: Settings },
];

export function Sidebar({ currentPage, onPageChange }: SidebarProps) {
  const { sidebarCollapsed, projects, setSelectedProjectId, setCurrentPage } = useAppStore();
  const [showLogoPopup, setShowLogoPopup] = useState(false);
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);

  // 获取最近活跃的项目
  useEffect(() => {
    async function loadRecentProjects() {
      try {
        // 从统计数据获取最近提交记录
        const { recentCommits } = await getDashboardStats();

        // 根据提交记录按项目去重，取最近4-5个项目
        const recentProjectPaths = new Set<string>();
        const recentFromCommits: Project[] = [];

        for (const commit of recentCommits) {
          if (recentProjectPaths.has(commit.projectPath)) continue;

          const project = projects.find(p => p.path === commit.projectPath);
          if (project) {
            recentProjectPaths.add(commit.projectPath);
            recentFromCommits.push(project);
          }

          if (recentFromCommits.length >= 5) break;
        }

        // 如果从提交记录获取的不足5个，用 lastOpened 补充
        if (recentFromCommits.length < 5) {
          const remainingCount = 5 - recentFromCommits.length;
          const projectsByLastOpened = [...projects]
            .filter(p => p.lastOpened && !recentProjectPaths.has(p.path))
            .sort((a, b) => {
              const aDate = new Date(a.lastOpened || 0).getTime();
              const bDate = new Date(b.lastOpened || 0).getTime();
              return bDate - aDate;
            })
            .slice(0, remainingCount);

          recentFromCommits.push(...projectsByLastOpened);
        }

        setRecentProjects(recentFromCommits);
      } catch (error) {
        console.error("Failed to load recent projects:", error);
        // 降级：使用 lastOpened 排序
        const projectsByLastOpened = [...projects]
          .filter(p => p.lastOpened)
          .sort((a, b) => {
            const aDate = new Date(a.lastOpened || 0).getTime();
            const bDate = new Date(b.lastOpened || 0).getTime();
            return bDate - aDate;
          })
          .slice(0, 5);
        setRecentProjects(projectsByLastOpened);
      }
    }

    if (projects.length > 0) {
      loadRecentProjects();
    }
  }, [projects]);

  // 点击快捷项目，跳转到书架页并打开详情
  function handleQuickAccess(project: Project) {
    setSelectedProjectId(project.id);
    setCurrentPage("shelf");
    onPageChange("shelf");
  }

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

      {/* 快捷访问菜单 */}
      {!sidebarCollapsed && recentProjects.length > 0 && (
        <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            <Clock size={12} />
            <span>最近活跃</span>
          </div>
          <div className="mt-1 space-y-0.5">
            {recentProjects.map((project) => (
              <button
                key={project.id}
                onClick={() => handleQuickAccess(project)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 dark:hover:text-blue-400 rounded-md transition-colors truncate"
                title={`${project.name}\n${project.path}`}
              >
                <FolderGit2 size={14} className="flex-shrink-0 opacity-60" />
                <span className="truncate">{project.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 折叠模式下的快捷访问 */}
      {sidebarCollapsed && recentProjects.length > 0 && (
        <div className="px-1 py-2 border-t border-gray-200 dark:border-gray-700">
          {recentProjects.slice(0, 3).map((project) => (
            <button
              key={project.id}
              onClick={() => handleQuickAccess(project)}
              className="w-full flex items-center justify-center p-1.5 text-gray-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 rounded-md transition-colors"
              title={project.name}
            >
              <FolderGit2 size={16} />
            </button>
          ))}
        </div>
      )}

      {/* 通知面板 */}
      <div className="mt-auto px-3 py-2 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-center">
          <NotificationPanel />
        </div>
      </div>

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
