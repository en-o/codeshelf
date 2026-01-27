import {
  FolderGit2,
  GitCommit,
  GitBranch,
  ArrowUpCircle,
} from "lucide-react";

export function DashboardPage() {
  // Mock data for now
  const stats = {
    totalProjects: 0,
    todayCommits: 0,
    weekCommits: 0,
    unpushedCommits: 0,
    unmergedBranches: 0,
  };

  return (
    <div className="flex flex-col h-full p-6">
      <h1 className="text-2xl font-semibold text-white mb-6">数据统计</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
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
          icon={ArrowUpCircle}
          label="待推送"
          value={stats.unpushedCommits}
          color="orange"
        />
        <StatCard
          icon={GitBranch}
          label="未合并分支"
          value={stats.unmergedBranches}
          color="purple"
        />
      </div>

      {/* Heatmap Placeholder */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-8">
        <h2 className="text-lg font-medium text-white mb-4">编码足迹</h2>
        <div className="flex flex-col items-center justify-center h-48 text-gray-500">
          <p>热力图将在添加项目后显示</p>
        </div>
      </div>

      {/* Recent Activity Placeholder */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-lg font-medium text-white mb-4">最近活动</h2>
        <div className="flex flex-col items-center justify-center h-32 text-gray-500">
          <p>暂无活动记录</p>
        </div>
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
    blue: "bg-blue-500/10 text-blue-400",
    green: "bg-green-500/10 text-green-400",
    orange: "bg-orange-500/10 text-orange-400",
    purple: "bg-purple-500/10 text-purple-400",
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-gray-400 text-sm">{label}</p>
          <p className="text-2xl font-semibold text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}
