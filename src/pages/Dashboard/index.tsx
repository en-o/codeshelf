import { useState, useEffect } from "react";
import {
  FolderGit2,
  GitCommit,
  GitBranch,
  ArrowUpCircle,
  Minus,
  X,
} from "lucide-react";
import { CommitHeatmap } from "@/components/ui";
import { useAppStore } from "@/stores/appStore";
import { getGitStatus, getCommitHistory } from "@/services/git";
import type { DashboardStats, DailyActivity } from "@/types";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function DashboardPage() {
  const { projects } = useAppStore();
  const [stats, setStats] = useState<DashboardStats>({
    totalProjects: 0,
    todayCommits: 0,
    weekCommits: 0,
    unpushedCommits: 0,
    unmergedBranches: 0,
  });
  const [heatmapData, setHeatmapData] = useState<DailyActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, [projects]);

  async function loadDashboardData() {
    try {
      setLoading(true);

      const totalProjects = projects.length;
      let unpushedCommits = 0;
      const commitsByDate: Record<string, number> = {};

      await Promise.all(
        projects.map(async (project) => {
          try {
            const [status, commits] = await Promise.all([
              getGitStatus(project.path),
              getCommitHistory(project.path, 365),
            ]);

            unpushedCommits += status.ahead;

            commits.forEach((commit) => {
              const date = new Date(commit.date).toISOString().split("T")[0];
              commitsByDate[date] = (commitsByDate[date] || 0) + 1;
            });
          } catch (error) {
            console.error(`Failed to load data for ${project.name}:`, error);
          }
        })
      );

      const today = new Date().toISOString().split("T")[0];
      const todayCommits = commitsByDate[today] || 0;

      let weekCommits = 0;
      for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split("T")[0];
        weekCommits += commitsByDate[dateStr] || 0;
      }

      const heatmap: DailyActivity[] = Object.entries(commitsByDate).map(
        ([date, count]) => ({
          date,
          count,
        })
      );

      setStats({
        totalProjects,
        todayCommits,
        weekCommits,
        unpushedCommits,
        unmergedBranches: 0,
      });
      setHeatmapData(heatmap);
    } catch (error) {
      console.error("Failed to load dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="re-main-wrap">
      {/* Header with Title and Integrated Window Controls */}
      <header className="re-header sticky top-0 z-20" data-tauri-drag-region>
        <div className="flex-1 flex items-center gap-3" data-tauri-drag-region>
          <span className="text-lg font-semibold ml-2">📊 数据统计</span>
        </div>

        <div className="re-actions flex items-center">
          {/* Integrated Window Controls */}
          <div className="flex items-center ml-4 border-l border-[var(--border)] pl-3 gap-1 h-6">
            <button
              onClick={() => getCurrentWindow()?.minimize()}
              className="w-7 h-7 flex items-center justify-center hover:bg-[rgba(0,0,0,0.05)] rounded-md transition-colors text-[var(--text-light)] hover:text-[var(--text)]"
              title="最小化"
            >
              <Minus size={14} />
            </button>
            <button
              onClick={() => getCurrentWindow()?.close()}
              className="w-7 h-7 flex items-center justify-center hover:bg-red-500 hover:text-white rounded-md transition-colors text-[var(--text-light)]"
              title="关闭"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </header>

      <div className="p-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-[var(--text-light)]">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--primary)] border-t-transparent mb-4" />
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
                <div className="flex flex-col items-center justify-center h-48 text-[var(--text-light)]">
                  <p>暂无提交记录</p>
                </div>
              )}
            </div>

            {/* Recent Activity */}
            <div className="re-card">
              <h2 className="text-[17px] font-semibold mb-6">最近活动</h2>
              <div className="flex flex-col items-center justify-center h-32 text-[var(--text-light)]">
                <p>功能开发中...</p>
              </div>
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
    blue: "bg-blue-50 dark:bg-blue-500/10 text-blue-500",
    green: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500",
    orange: "bg-orange-50 dark:bg-orange-500/10 text-orange-500",
    purple: "bg-purple-50 dark:bg-purple-500/10 text-purple-500",
  };

  return (
    <div className="re-card p-6">
      <div className="flex items-center gap-4">
        <div className={`p-3.5 rounded-xl ${colors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-[var(--text-light)] text-sm font-medium mb-1">{label}</p>
          <p className="text-2xl font-semibold text-[var(--text)]">{value}</p>
        </div>
      </div>
    </div>
  );
}
