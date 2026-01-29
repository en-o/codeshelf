import { invoke } from "@tauri-apps/api/core";
import type { DashboardStats, DailyActivity, CommitInfo } from "@/types";

export interface ProjectInfo {
  id?: string;
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
 * Get cached dashboard stats (fast - no git operations)
 * Use this for initial page load
 */
export async function getDashboardStats(): Promise<CachedDashboardData> {
  const data = await invoke("get_dashboard_stats");
  return transformStats(data);
}

/**
 * Refresh dashboard stats by analyzing all projects (slow)
 * Use for manual refresh button
 */
export async function refreshDashboardStats(projects: ProjectInfo[]): Promise<CachedDashboardData> {
  const data = await invoke("refresh_dashboard_stats", { projects });
  return transformStats(data);
}

/**
 * Initialize stats cache on app startup
 * Returns cached data if valid, marks new/changed projects as dirty
 */
export async function initStatsCache(projects: ProjectInfo[]): Promise<CachedDashboardData> {
  const data = await invoke("init_stats_cache", { projects });
  return transformStats(data);
}

/**
 * Refresh only dirty (changed) projects (incremental update)
 * Use this after git operations or when dirty projects exist
 */
export async function refreshDirtyStats(projects: ProjectInfo[]): Promise<CachedDashboardData> {
  const data = await invoke("refresh_dirty_stats", { projects });
  return transformStats(data);
}

/**
 * Mark a single project as dirty (needs refresh)
 * Call this after git operations on a project
 */
export async function markProjectDirty(projectPath: string): Promise<void> {
  await invoke("mark_project_dirty", { projectPath });
}

/**
 * Mark all projects as dirty
 * Use when major changes occur
 */
export async function markAllProjectsDirty(projects: ProjectInfo[]): Promise<void> {
  await invoke("mark_all_projects_dirty", { projects });
}

/**
 * Check if there are any dirty projects that need refresh
 */
export async function hasDirtyStats(): Promise<boolean> {
  return await invoke("has_dirty_stats");
}

/**
 * Clean up stats cache for deleted projects
 */
export async function cleanupStatsCache(currentProjectPaths: string[]): Promise<void> {
  await invoke("cleanup_stats_cache", { currentProjectPaths });
}
