// Project types
export interface Project {
  id: string;
  name: string;
  path: string;
  isFavorite: boolean;
  tags: string[]; // Categories for organization (工作、个人、学习等)
  labels: string[]; // Tech stack labels (Java, Vue, 小程序等)
  createdAt: string;
  updatedAt: string;
  lastOpened?: string;
  remoteUrl?: string;
  remoteType?: "github" | "gitee" | "gitlab" | "other" | "none";
}

export interface CreateProjectInput {
  name: string;
  path: string;
  tags?: string[];
  labels?: string[];
}

export interface UpdateProjectInput {
  id: string;
  name?: string;
  tags?: string[];
  labels?: string[];
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
  hash: string;           // 完整哈希值
  shortHash: string;      // 短哈希值（通常前7位）
  message: string;        // 提交标题（第一行）
  author: string;         // 作者名称
  email: string;          // 作者邮箱
  date: string;           // 提交日期（ISO 8601格式）

  // 扩展字段 - 提供更丰富的信息
  body?: string;          // 完整提交信息（包含多行描述）
  filesChanged?: number;  // 修改的文件数量
  insertions?: number;    // 新增的行数
  deletions?: number;     // 删除的行数
  refs?: string[];        // 分支/标签引用（如 HEAD -> main, origin/main）
  parentHashes?: string[]; // 父提交的哈希值（用于merge提交）
}

export interface CommitFileChange {
  insertions: number;
  deletions: number;
  filename: string;
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

// Notification types
export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  createdAt: string;
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
