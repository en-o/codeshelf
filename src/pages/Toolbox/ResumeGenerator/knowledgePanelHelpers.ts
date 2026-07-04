// KnowledgePanel 的纯逻辑 helper 与共享类型（从 KnowledgePanel.tsx 抽出，无 JSX）。
// 被主面板与运行过程可视化组件共享。

import type {
  AgentEvent,
  AgentRunRecord,
  ArtifactRef,
} from "@/services/resume/knowledgeStore";

export type KnowledgeView = "background" | "runs";
export type RunDetailView = "overview" | "trace";
export type RunEventFilter = "all" | "model" | "tool" | "error";

export interface EventTokenSummary {
  input?: number;
  output?: number;
  total?: number;
  cacheRead?: number;
  reasoning?: number;
}

export interface TodoItemView {
  content?: string;
  status?: string;
}

export interface ToolCallView {
  id?: string;
  name: string;
  argsPreview?: string;
  todos: TodoItemView[];
}

export interface ToolAggregateItem {
  name: string;
  description: string;
  count: number;
  lastPreview?: string;
}

export function summarizeRun(run: AgentRunRecord | null) {
  const events = run?.events ?? [];
  const tokenTotals = events.reduce(
    (acc, event) => {
      const tokens = getEventTokens(event);
      acc.input += tokens.input ?? 0;
      acc.output += tokens.output ?? 0;
      acc.total += tokens.total ?? 0;
      acc.cacheRead += tokens.cacheRead ?? 0;
      acc.reasoning += tokens.reasoning ?? 0;
      return acc;
    },
    { input: 0, output: 0, total: 0, cacheRead: 0, reasoning: 0 },
  );
  return {
    model: events.filter((event) => event.type === "model_call").length,
    tool: events.filter((event) => event.type === "tool_call" || event.type === "finalize").length,
    blocked: events.filter((event) => event.blocked || event.status === "blocked").length,
    error: events.filter((event) => event.type === "error" || event.status === "error").length,
    inputTokens: tokenTotals.input,
    outputTokens: tokenTotals.output,
    totalTokens: tokenTotals.total,
    cacheReadTokens: tokenTotals.cacheRead,
    reasoningTokens: tokenTotals.reasoning,
  };
}

export function eventMatchesFilter(event: AgentEvent, filter: RunEventFilter): boolean {
  if (filter === "all") return true;
  if (filter === "model") return event.type === "model_call";
  if (filter === "tool") return event.type === "tool_call" || event.type === "finalize";
  return event.type === "error" || event.status === "error";
}

export function findRunArtifact(run: AgentRunRecord, kind: string): ArtifactRef | undefined {
  for (const event of run.events) {
    const artifact = event.artifacts?.find((item) => item.kind === kind);
    if (artifact) return artifact;
  }
  return undefined;
}

export function buildToolAggregate(run: AgentRunRecord): ToolAggregateItem[] {
  const descriptions = new Map<string, string>();
  for (const tool of getRuntimeToolDefinitions(run)) {
    descriptions.set(tool.name, tool.description);
  }
  const byName = new Map<string, ToolAggregateItem>();
  for (const event of run.events) {
    if (event.type !== "tool_call" && event.type !== "finalize") continue;
    const name = event.toolName ?? event.title ?? event.id;
    const current = byName.get(name) ?? {
      name,
      description: descriptions.get(name) ?? "",
      count: 0,
      lastPreview: undefined,
    };
    current.count += 1;
    current.lastPreview = getToolEventPreview(event) || current.lastPreview;
    byName.set(name, current);
  }
  return [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function getRuntimeToolDefinitions(run: AgentRunRecord): Array<{ name: string; description: string }> {
  const contextEvent = run.events.find((event) => event.title === "agent_context");
  const tools = contextEvent?.data?.tools;
  if (!Array.isArray(tools)) return [];
  const result: Array<{ name: string; description: string }> = [];
  for (const item of tools) {
    const object = asRecord(item);
    const name = getString(object?.name);
    if (!name) continue;
    result.push({
      name,
      description: getString(object?.description),
    });
  }
  return result;
}

export function getToolEventPreview(event: AgentEvent): string {
  const data = event.data ?? {};
  const input = asRecord(data.input);
  return getString(input?.argsPreview) || getString(data.outputPreview);
}

export function getEventTokens(event: AgentEvent): EventTokenSummary {
  const data = event.data ?? {};
  const tokens = asRecord(data.tokens);
  const usage = asRecord(data.usage);
  return {
    input: getNumber(tokens?.input) ?? getNumber(usage?.input_tokens) ?? getNumber(usage?.prompt_tokens) ?? getNumber(usage?.promptTokens),
    output: getNumber(tokens?.output) ?? getNumber(usage?.output_tokens) ?? getNumber(usage?.completion_tokens) ?? getNumber(usage?.completionTokens),
    total: getNumber(tokens?.total) ?? getNumber(usage?.total_tokens) ?? getNumber(usage?.totalTokens),
    cacheRead: getNumber(tokens?.cacheRead)
      ?? getNumber(asRecord(usage?.input_token_details)?.cache_read)
      ?? getNumber(asRecord(usage?.prompt_tokens_details)?.cached_tokens)
      ?? getNumber(usage?.prompt_cache_hit_tokens),
    reasoning: getNumber(tokens?.reasoning)
      ?? getNumber(asRecord(usage?.output_token_details)?.reasoning)
      ?? getNumber(asRecord(usage?.completion_tokens_details)?.reasoning_tokens),
  };
}

export function getToolCalls(value: unknown): ToolCallView[] {
  if (!Array.isArray(value)) return [];
  const result: ToolCallView[] = [];
  for (const item of value) {
    const object = asRecord(item);
    if (!object) continue;
    const name = getString(object.name);
    if (!name) continue;
    result.push({
      id: getString(object.id) || undefined,
      name,
      argsPreview: getString(object.argsPreview) || undefined,
      todos: getTodos(object.todos),
    });
  }
  return result;
}

export function getTodos(value: unknown): TodoItemView[] {
  if (!Array.isArray(value)) return [];
  const result: TodoItemView[] = [];
  for (const item of value) {
    const object = asRecord(item);
    if (!object) continue;
    result.push({
      content: getString(object.content) || undefined,
      status: getString(object.status) || undefined,
    });
  }
  return result;
}

export function formatArtifactContent(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

export function formatRuntimePromptFromRawJson(content: string): string {
  const parsed = JSON.parse(content);
  const messages = getPath(parsed, ["request", "messages"]) ?? getPath(parsed, ["messages"]);
  if (!messages) throw new Error("artifact 中没有 request.messages");
  return formatRuntimePromptMessages(messages);
}

export function formatRuntimePromptMessages(messages: unknown): string {
  const groups = Array.isArray(messages) ? messages : [messages];
  const sections: string[] = [];
  let index = 0;
  for (const group of groups) {
    const items = Array.isArray(group) ? group : [group];
    for (const item of items) {
      index += 1;
      const object = asRecord(item);
      const kwargs = asRecord(object?.kwargs);
      const type = getString(kwargs?.type) || getString(object?.type) || `message_${index}`;
      const content = firstText(
        messageContentToText(kwargs?.content),
        messageContentToText(getPath(kwargs, ["lc_kwargs", "content"])),
        messageContentToText(object?.content),
      );
      sections.push([`## ${index}. ${type}`, "", content || JSON.stringify(item, null, 2)].join("\n"));
    }
  }
  return sections.join("\n\n---\n\n");
}

export function messageContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      const object = asRecord(item);
      return getString(object?.text);
    })
    .filter(Boolean)
    .join("\n");
}

export function firstText(...values: string[]): string {
  return values.find((value) => value.trim()) ?? "";
}

export function getPath(value: unknown, path: Array<string | number>): unknown {
  let current = value;
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[key];
      continue;
    }
    const object = asRecord(current);
    if (!object) return undefined;
    current = object[key];
  }
  return current;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return `${minutes}m ${rest}s`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

export function eventTypeLabel(event: AgentEvent): string {
  if (event.type === "model_call") return "MODEL";
  if (event.type === "tool_call") return "TOOL";
  if (event.type === "finalize") return "FINAL";
  if (event.type === "system") return "SYSTEM";
  return event.type.toUpperCase();
}

export function todoStatusClass(status?: string): string {
  if (status === "completed") return "bg-green-50 text-green-700";
  if (status === "in_progress") return "bg-blue-50 text-blue-700";
  return "bg-gray-100 text-gray-600";
}

export function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function orderedEvents(events: AgentEvent[]): AgentEvent[] {
  return [...events].sort((a, b) => {
    const aTime = Date.parse(a.startedAt ?? a.at);
    const bTime = Date.parse(b.startedAt ?? b.at);
    if (Number.isNaN(aTime) || Number.isNaN(bTime) || aTime === bTime) return 0;
    return aTime - bTime;
  });
}

export function statusClass(status: string): string {
  switch (status) {
    case "success":
      return "bg-green-50 text-green-700";
    case "error":
      return "bg-red-50 text-red-700";
    case "blocked":
      return "bg-amber-50 text-amber-700";
    case "running":
      return "bg-blue-50 text-blue-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

export function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
