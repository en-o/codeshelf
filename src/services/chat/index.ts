import { invoke } from "@tauri-apps/api/core";
import type { ChatEngine, ChatSession, ChatSessionSummary } from "@/types";

export type ChatMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }
    >;

export interface ChatStreamMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: ChatMessageContent;
  thinkingContent?: string;
  toolCalls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  toolCallId?: string;
  name?: string;
}

export interface ChatStreamRequest {
  requestId: string;
  providerId: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  thinking?: boolean;
  stream?: boolean;
  messages: ChatStreamMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  tools?: Array<{ type: "function"; function: { name: string; description?: string; parameters: object } }>;
  toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
}

export interface CreateChatSessionInput {
  title?: string;
  providerId: string;
  modelId: string;
  /** "dsh" 由 dsh 页创建时传入；缺省 builtin */
  engine?: ChatEngine;
}

export async function getChatHistoryDir(): Promise<string> {
  return invoke("get_chat_history_dir");
}

export async function migrateChatHistoryDir(newDir: string): Promise<string> {
  return invoke("migrate_chat_history_dir", { newDir });
}

export async function listChatSessions(): Promise<ChatSessionSummary[]> {
  return invoke("list_chat_sessions");
}

export async function getChatSession(sessionId: string): Promise<ChatSession> {
  return invoke("get_chat_session", { sessionId });
}

export async function createChatSession(input: CreateChatSessionInput): Promise<ChatSession> {
  return invoke("create_chat_session", { input });
}

export async function saveChatSession(session: ChatSession): Promise<ChatSession> {
  return invoke("save_chat_session", { session });
}

export async function renameChatSession(sessionId: string, title: string): Promise<ChatSession> {
  return invoke("rename_chat_session", { sessionId, title });
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  return invoke("delete_chat_session", { sessionId });
}

// ========== 上下文压缩 ==========

export interface CompactionMeta {
  version: string;
  createdAt: string;
  sourceMessageCount: number;
  tailKept: number;
  charCount: number;
  model?: string;
}

export interface CompactionIndex {
  current?: string;
  versions: CompactionMeta[];
}

export interface CompactionContent {
  version: string;
  content: string;
  meta?: CompactionMeta;
}

export async function saveCompaction(input: {
  sessionId: string;
  content: string;
  sourceMessageCount: number;
  tailKept: number;
  model?: string;
}): Promise<CompactionMeta> {
  return invoke("save_compaction", { input });
}

export async function listCompactions(sessionId: string): Promise<CompactionIndex> {
  return invoke("list_compactions", { sessionId });
}

export async function getCompaction(
  sessionId: string,
  version?: string,
): Promise<CompactionContent | null> {
  return invoke("get_compaction", { sessionId, version });
}

export async function chatStream(request: ChatStreamRequest): Promise<void> {
  return invoke("chat_stream", { request });
}

export async function chatCancel(requestId: string): Promise<void> {
  return invoke("chat_cancel", { requestId });
}

// ========== Tools ==========

export interface ToolSchema {
  name: string;
  description: string;
  parameters: object;
  /** 是否需要会话指定 allowedCwd 才能使用（写/执行类） */
  requiresCwd: boolean;
}

export async function listTools(): Promise<ToolSchema[]> {
  return invoke("chat_list_tools");
}

export async function executeTool(params: {
  sessionId: string;
  toolName: string;
  argumentsJson: string;
}): Promise<string> {
  return invoke("chat_execute_tool", params);
}

// ========== Tasks (Plan/Todo per session) ==========

export interface ChatTask {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed";
  createdAt: string;
  updatedAt: string;
}

export async function listChatTasks(sessionId: string): Promise<ChatTask[]> {
  return invoke("list_chat_tasks", { sessionId });
}

export async function deleteChatTask(sessionId: string, taskId: string): Promise<void> {
  return invoke("delete_chat_task", { sessionId, taskId });
}

export async function updateChatTask(params: {
  sessionId: string;
  taskId: string;
  status?: ChatTask["status"];
  subject?: string;
  description?: string;
}): Promise<ChatTask> {
  return invoke("update_chat_task", params);
}

export async function createChatTask(params: {
  sessionId: string;
  subject: string;
  description: string;
  activeForm?: string;
}): Promise<ChatTask> {
  return invoke("create_chat_task", params);
}

// ========== Memory ==========

export async function getGlobalMemory(): Promise<string> {
  return invoke("get_global_memory");
}

export async function saveGlobalMemory(content: string): Promise<void> {
  return invoke("save_global_memory", { content });
}

// ========== Skills ==========

export interface Skill {
  name: string;
  description: string;
  argsHint?: string;
  body: string;
}

export async function listSkills(): Promise<Skill[]> {
  return invoke("list_skills");
}

export async function saveSkill(skill: Skill): Promise<void> {
  return invoke("save_skill", { skill });
}

export async function deleteSkill(name: string): Promise<void> {
  return invoke("delete_skill", { name });
}

// ========== @ mention ==========

export interface MentionFileEntry {
  path: string;
  isDir: boolean;
}

export async function listDirEntries(root: string, max?: number): Promise<MentionFileEntry[]> {
  return invoke("list_dir_entries", { root, max });
}

export async function readMentionFile(root: string, relPath: string): Promise<string> {
  return invoke("read_mention_file", { root, relPath });
}
