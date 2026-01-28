import { useState, useEffect } from "react";
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
} from "lucide-react";
import { CommitHeatmap } from "@/components/ui";
import { useAppStore } from "@/stores/appStore";
import { getDashboardStats, refreshDashboardStats, type RecentCommit, type CachedDashboardData } from "@/services/stats";
import type { DashboardStats, DailyActivity } from "@/types";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function DashboardPage() {
  const { projects, sidebarCollapsed, setSidebarCollapsed, statsVersion } = useAppStore();
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

  useEffect(() => {
    loadCachedStats();
  }, []);

  // When projects change, refresh stats
  useEffect(() => {
    if (projects.length > 0 && !loading) {
      handleRefreshStats();
    }
  }, [projects.length]);

  // When stats version changes (after git operations), refresh stats
  useEffect(() => {
    if (statsVersion > 0 && !loading) {
      handleRefreshStats();
    }
  }, [statsVersion]);

  // Load cached stats (fast)
  async function loadCachedStats() {
    try {
      setLoading(true);
      const cached = await getDashboardStats();

      // If cache is empty (first load), trigger a refresh
      if (cached.stats.totalProjects === 0 && projects.length > 0) {
        await handleRefreshStats();
        return;
      }

      setStats(cached.stats);
      setHeatmapData(cached.heatmapData);
      setRecentActivity(cached.recentCommits);
    } catch (error) {
      console.error("Failed to load cached stats:", error);
      // Fallback to refresh if cache load fails
      if (projects.length > 0) {
        await handleRefreshStats();
      }
    } finally {
      setLoading(false);
    }
  }

  // Refresh stats by analyzing all projects (slow)
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
      const projectInfos = projects.map(p => ({ name: p.name, path: p.path }));
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
    <div className="flex flex-col min-h-full">
      {/* Header with Title and Integrated Window Controls */}
      <header className="re-header sticky top-0 z-20" data-tauri-drag-region>
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

      <div className="p-5" style={{ marginTop: "40px" }}>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent mb-4" />
            <p>分析数据中...</p>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
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

            {/* Heatmap */}
            <div className="re-card">
              <h2 className="text-[17px] font-semibold mb-6">编码足迹</h2>
              {heatmapData.length > 0 ? (
                <CommitHeatmap data={heatmapData} />
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                  <p>暂无提交记录</p>
                </div>
              )}
            </div>

            {/* Recent Activity */}
            <div className="re-card">
              <h2 className="text-[17px] font-semibold mb-6">最近活动</h2>
              {recentActivity.length > 0 ? (
                <div className="space-y-3">
                  {recentActivity.map((activity, index) => (
                    <div
                      key={`${activity.hash}-${index}`}
                      className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      {/* Commit dot */}
                      <div className="flex-shrink-0 w-2 h-2 mt-2 rounded-full bg-blue-500"></div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {/* Commit message */}
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {activity.message}
                        </p>

                        {/* Meta info */}
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <FolderOpen size={12} />
                            <span className="truncate max-w-[120px]">{activity.projectName}</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <User size={12} />
                            <span>{activity.author}</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            <span>{formatRelativeTime(activity.date)}</span>
                          </span>
                          <span className="font-mono text-gray-400">
                            {activity.shortHash}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-32 text-gray-400">
                  <GitCommit size={32} className="mb-2 opacity-50" />
                  <p>暂无提交记录</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
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
    <div className="re-card p-6">
      <div className="flex items-center gap-4">
        <div className={`p-3.5 rounded-xl ${colors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-gray-500 text-sm font-medium mb-1">{label}</p>
          <p className="text-2xl font-semibold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}
