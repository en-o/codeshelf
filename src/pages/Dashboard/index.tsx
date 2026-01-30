import { useState, useEffect, useCallback } from "react";
import {
  FolderGit2,
  GitCommit,
  ArrowUpCircle,
  Minus,
  X,
  User,
  Clock,
  FolderOpen,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import { CommitHeatmap } from "@/components/ui";
import { useAppStore } from "@/stores/appStore";
import {
  initStatsCache,
  refreshDashboardStats,
  refreshDirtyStats,
  hasDirtyStats,
  type RecentCommit,
} from "@/services/stats";
import type { DashboardStats, DailyActivity } from "@/types";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function DashboardPage() {
  const { projects, sidebarCollapsed, setSidebarCollapsed, navigateToProject } = useAppStore();
  const [stats, setStats] = useState<DashboardStats>({
    totalProjects: 0,
    todayCommits: 0,
    weekCommits: 0,
    unpushedCommits: 0,
    unmergedBranches: 0,
  });
  const [heatmapData, setHeatmapData] = useState<DailyActivity[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Get project infos for API calls
  const getProjectInfos = useCallback(() => {
    return projects.map(p => ({ id: p.id, name: p.name, path: p.path }));
  }, [projects]);

  // Initialize stats on mount
  useEffect(() => {
    initializeStats();
  }, []);

  // Check for dirty stats when projects change
  useEffect(() => {
    if (initialized && projects.length > 0) {
      checkAndRefreshDirtyStats();
    }
  }, [projects.length, initialized]);

  // Check for dirty stats when page becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && initialized) {
        checkAndRefreshDirtyStats();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [initialized]);

  // Initialize stats from cache
  async function initializeStats() {
    try {
      setLoading(true);
      const projectInfos = getProjectInfos();
      const cached = await initStatsCache(projectInfos);

      setStats(cached.stats);
      setHeatmapData(cached.heatmapData);
      setRecentActivity(cached.recentCommits);
      setInitialized(true);

      // Check if there are dirty projects that need refresh
      const hasDirty = await hasDirtyStats();
      if (hasDirty && projectInfos.length > 0) {
        // Refresh dirty stats in background
        refreshDirtyStatsBackground();
      }
    } catch (error) {
      console.error("Failed to initialize stats:", error);
      // Fallback to full refresh
      if (projects.length > 0) {
        await handleRefreshStats();
      }
    } finally {
      setLoading(false);
    }
  }

  // Check and refresh dirty stats (non-blocking)
  async function checkAndRefreshDirtyStats() {
    try {
      const hasDirty = await hasDirtyStats();
      if (hasDirty) {
        await refreshDirtyStatsBackground();
      }
    } catch (error) {
      console.error("Failed to check dirty stats:", error);
    }
  }

  // Refresh only dirty projects (background, non-blocking)
  async function refreshDirtyStatsBackground() {
    try {
      const projectInfos = getProjectInfos();
      if (projectInfos.length === 0) return;

      const data = await refreshDirtyStats(projectInfos);
      setStats(data.stats);
      setHeatmapData(data.heatmapData);
      setRecentActivity(data.recentCommits);
    } catch (error) {
      console.error("Failed to refresh dirty stats:", error);
    }
  }

  // Full refresh (manual button click)
  async function handleRefreshStats() {
    if (projects.length === 0) {
      setStats({
        totalProjects: 0,
        todayCommits: 0,
        weekCommits: 0,
        unpushedCommits: 0,
        unmergedBranches: 0,
      });
      setHeatmapData([]);
      setRecentActivity([]);
      return;
    }

    try {
      setRefreshing(true);
      const projectInfos = getProjectInfos();
      const data = await refreshDashboardStats(projectInfos);

      setStats(data.stats);
      setHeatmapData(data.heatmapData);
      setRecentActivity(data.recentCommits);
    } catch (error) {
      console.error("Failed to refresh dashboard stats:", error);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }

  function formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return "刚刚";
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    if (diffDays < 7) return `${diffDays} 天前`;
    return date.toLocaleDateString("zh-CN");
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header with Title and Integrated Window Controls */}
      <header className="re-header flex-shrink-0" data-tauri-drag-region>
        <span
          className="toggle"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          ☰
        </span>

        <div className="flex-1 flex items-center gap-3" data-tauri-drag-region>
          <span className="text-lg font-semibold ml-2">📊 数据统计</span>
        </div>

        <div className="re-actions flex items-center">
          {/* Refresh Button */}
          <button
            onClick={handleRefreshStats}
            disabled={refreshing || loading}
            className={`re-btn flex items-center gap-2 ${refreshing ? 'opacity-70' : ''}`}
            title="刷新统计数据"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            <span>{refreshing ? '刷新中...' : '刷新'}</span>
          </button>

          {/* Integrated Window Controls */}
          <div className="flex items-center ml-4 border-l border-gray-200 pl-3 gap-1 h-6">
            <button
              onClick={() => getCurrentWindow()?.minimize()}
              className="w-7 h-7 flex items-center justify-center hover:bg-gray-100 rounded-md transition-colors text-gray-400 hover:text-gray-600"
              title="最小化"
            >
              <Minus size={14} />
            </button>
            <button
              onClick={() => getCurrentWindow()?.close()}
              className="w-7 h-7 flex items-center justify-center hover:bg-red-500 hover:text-white rounded-md transition-colors text-gray-400"
              title="关闭"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent mb-4" />
          <p>分析数据中...</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0 pt-[13px]">
          {/* 固定区域：统计卡片 + 编码足迹 */}
          <div className="flex-shrink-0 px-5 pt-1 pb-2">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <StatCard
                icon={FolderGit2}
                label="总项目数"
                value={stats.totalProjects}
                color="blue"
              />
              <StatCard
                icon={GitCommit}
                label="今日提交"
                value={stats.todayCommits}
                color="green"
              />
              <StatCard
                icon={GitCommit}
                label="本周提交"
                value={stats.weekCommits}
                color="purple"
              />
              <StatCard
                icon={ArrowUpCircle}
                label="待推送"
                value={stats.unpushedCommits}
                color="orange"
              />
            </div>

            {/* Heatmap - 编码足迹 */}
            <div className="re-card py-3">
              <h2 className="text-[15px] font-semibold mb-3">编码足迹</h2>
              {heatmapData.length > 0 ? (
                <CommitHeatmap data={heatmapData} />
              ) : (
                <div className="flex flex-col items-center justify-center h-24 text-gray-400">
                  <p>暂无提交记录</p>
                </div>
              )}
            </div>
          </div>

          {/* 滚动区域：最近活动 */}
          <div className="flex-1 min-h-0 px-5 pb-3">
            <div className="re-card h-full flex flex-col">
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <h2 className="text-[15px] font-semibold">最近活动</h2>
                <span className="text-xs text-gray-400">共 {recentActivity.length} 条最近活动</span>
              </div>
              {recentActivity.length > 0 ? (
                <div className="flex-1 overflow-y-auto min-h-0 -mx-3 px-3">
                  <div className="space-y-1">
                    {recentActivity.map((activity, index) => (
                      <div
                        key={`${activity.hash}-${index}`}
                        className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer group"
                        onClick={() => navigateToProject(activity.projectPath)}
                        title="点击查看项目详情"
                      >
                        {/* Commit dot */}
                        <div className="flex-shrink-0 w-2 h-2 mt-1.5 rounded-full bg-blue-500"></div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          {/* Commit message */}
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {activity.message}
                          </p>

                          {/* Meta info */}
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <FolderOpen size={11} />
                              <span className="truncate max-w-[100px]">{activity.projectName}</span>
                            </span>
                            <span className="flex items-center gap-1">
                              <User size={11} />
                              <span>{activity.author}</span>
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock size={11} />
                              <span>{formatRelativeTime(activity.date)}</span>
                            </span>
                            <span className="font-mono text-gray-400 text-[11px]">
                              {activity.shortHash}
                            </span>
                          </div>
                        </div>

                        {/* Arrow indicator */}
                        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400">
                          <ChevronRight size={14} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                  <GitCommit size={28} className="mb-2 opacity-50" />
                  <p className="text-sm">暂无提交记录</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: "blue" | "green" | "orange" | "purple";
}

function StatCard({ icon: Icon, label, value, color }: StatCardProps) {
  const colors = {
    blue: "bg-blue-50 text-blue-500",
    green: "bg-emerald-50 text-emerald-500",
    orange: "bg-orange-50 text-orange-500",
    purple: "bg-purple-50 text-purple-500",
  };

  return (
    <div className="re-card p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2.5 rounded-lg ${colors[color]}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <p className="text-gray-500 text-xs font-medium mb-0.5">{label}</p>
          <p className="text-xl font-semibold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}
