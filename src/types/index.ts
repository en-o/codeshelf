// Project types
export interface Project {
  id: string;
  name: string;
  path: string;
  isFavorite: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastOpened?: string;
}

export interface CreateProjectInput {
  name: string;
  path: string;
  tags?: string[];
}

export interface UpdateProjectInput {
  id: string;
  name?: string;
  tags?: string[];
}

// Git types
export interface GitStatus {
  branch: string;
  isClean: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  ahead: number;
  behind: number;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  email: string;
  date: string;
}

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream?: string;
}

export interface RemoteInfo {
  name: string;
  url: string;
  fetchUrl?: string;
  pushUrl?: string;
}

export interface GitRepo {
  path: string;
  name: string;
}

// View types
export type ViewMode = "grid" | "list";

// Statistics types
export interface DailyActivity {
  date: string;
  count: number;
}

export interface DashboardStats {
  totalProjects: number;
  todayCommits: number;
  weekCommits: number;
  unpushedCommits: number;
  unmergedBranches: number;
}
