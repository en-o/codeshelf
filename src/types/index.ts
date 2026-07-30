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
  editorId?: string;
  claudeEnvName?: string;
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
  conflicted: string[];
  ahead: number;
  behind: number;
  /**
   * ahead/behind 是相对 `@{upstream}` 算的，这里说明 upstream 究竟是谁。
   * 界面必须用它作为默认的 push/pull 目标，否则「统计的目标」和「操作的目标」
   * 可以指向不同仓库。未设置 upstream 时为 null，此时 ahead/behind 均为 0。
   */
  upstreamRemote: string | null;
  upstreamBranch: string | null;
}

/** 单个分支的同步结果 */
export interface SyncBranchResult {
  branch: string;
  ok: boolean;
  isDefault: boolean;
  error: string | null;
}

/** 同步整体结果：区分全成功与部分失败，0 成功时后端直接返回错误 */
export interface SyncResult {
  targetRemote: string;
  succeeded: number;
  failed: number;
  branches: SyncBranchResult[];
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

export interface AiModelConfig {
  id: string;
  model: string;
  enabled: boolean;
  isDefault: boolean;
  thinking: boolean;
  stream: boolean;
  vision?: boolean;
}

export interface AiProviderConfig {
  id: string;
  name: string;
  providerType: "preset" | "custom";
  presetKey?: "bailian" | "deepseek" | "openai" | "ollama" | "moonshot";
  baseUrl: string;
  apiKey?: string;
  enabled: boolean;
  isDefaultProvider: boolean;
  models: AiModelConfig[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ChatAttachment =
  | { kind: "image"; dataUrl: string; name?: string }
  | { kind: "file"; path: string; name: string }
  | { kind: "text"; name: string; content: string };

export interface ChatMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  tokens?: number;
  thinking?: boolean;
  thinkingContent?: string;
  attachments?: ChatAttachment[];
  edited?: boolean;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  toolStatus?: number;
  toolMethod?: string;
  toolUrl?: string;
  toolElapsedMs?: number;
  toolBodyBytes?: number;
  toolTruncated?: boolean;
  /** 内联可重试错误气泡标记（assistant 角色 + error=true） */
  error?: boolean;
  /** 工具调用进行中占位（"调用中…"），执行完成后清除 */
  toolPending?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  providerId: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  pinned?: boolean;
  allowedTools?: string[];
  enabledTools?: string[];
  allowedCwd?: string;
  /** 是否在本会话里启用 MCP gateway 工具（接口工具）。缺省 true。仅当 MCP gateway 已启动时实际生效 */
  useMcpGatewayTools?: boolean;
  /** 当前生效的上下文压缩版本号（如 "v2"）；缺省表示从未压缩 */
  currentCompactionVersion?: string;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  providerId: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  pinned?: boolean;
}

// ============== 应用快捷键 ==============

export interface AppShortcutBinding {
  id: string;
  label: string;
  description: string;
  keys: string;
  defaultKeys: string;
  enabled: boolean;
  global: boolean;
}

// ============== ApiChat：通用 API 对话 ==============

export type SessionInject =
  | { type: "cookie" }
  | { type: "header"; name: string; format: string };

export type ApiAuthConfig =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "apiKey"; header: string; value: string }
  | {
      type: "session";
      loginUrl: string;
      loginMethod: string;
      credentialsJson: string;
      tokenJsonPath?: string;
      injectAs: SessionInject;
    };

export interface ApiGroup {
  id: string;
  name: string;
  description?: string;
  baseUrl: string;
  auth: ApiAuthConfig;
  createdAt: string;
  updatedAt: string;
}

export interface ApiEndpoint {
  id: string;
  name: string;
  description?: string;
  groupId?: string;
  method: string;
  url: string;
  headers: [string, string][];
  authOverride?: ApiAuthConfig;
  paramsSchema: Record<string, unknown>;
  responseTrimBytes?: number;
  /** 单接口请求超时（毫秒），缺省 30000 */
  timeoutMs?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiChatSession {
  id: string;
  title: string;
  providerId: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  selectedEndpointIds: string[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  pinned?: boolean;
}

export interface ApiChatSessionSummary {
  id: string;
  title: string;
  providerId: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  endpointCount: number;
  pinned?: boolean;
}
