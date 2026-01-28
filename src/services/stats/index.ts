import { invoke } from "@tauri-apps/api/core";
import type { DashboardStats, DailyActivity, CommitInfo } from "@/types";

export interface ProjectInfo {
  name: string;
  path: string;
}

export interface RecentCommit extends CommitInfo {
  projectName: string;
  projectPath: string;
}

export interface CachedDashboardData {
  stats: DashboardStats;
  heatmapData: DailyActivity[];
  recentCommits: RecentCommit[];
}

// Transform snake_case from Rust to camelCase for TypeScript
function transformStats(data: any): CachedDashboardData {
  return {
    stats: {
      totalProjects: data.stats.total_projects,
      todayCommits: data.stats.today_commits,
      weekCommits: data.stats.week_commits,
      unpushedCommits: data.stats.unpushed_commits,
      unmergedBranches: data.stats.unmerged_branches,
    },
    heatmapData: data.heatmap_data.map((item: any) => ({
      date: item.date,
      count: item.count,
    })),
    recentCommits: data.recent_commits.map((commit: any) => ({
      hash: commit.hash,
      shortHash: commit.short_hash,
      message: commit.message,
      author: commit.author,
      email: commit.email,
      date: commit.date,
      projectName: commit.project_name,
      projectPath: commit.project_path,
    })),
  };
}

/**
 * Refresh dashboard stats by analyzing all projects
 * This is the slow operation - call after adding projects or git operations
 */
export async function refreshDashboardStats(projects: ProjectInfo[]): Promise<CachedDashboardData> {
  const data = await invoke("refresh_dashboard_stats", { projects });
  return transformStats(data);
}

/**
 * Get cached dashboard stats (fast - no git operations)
 * Use this for initial page load
 */
export async function getDashboardStats(): Promise<CachedDashboardData> {
  const data = await invoke("get_dashboard_stats");
  return transformStats(data);
}

/**
 * Refresh stats for a single project (after git operations)
 */
export async function refreshProjectStats(
  project: ProjectInfo,
  allProjects: ProjectInfo[]
): Promise<CachedDashboardData> {
  const data = await invoke("refresh_project_stats", { project, allProjects });
  return transformStats(data);
}
