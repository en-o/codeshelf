import { useRef, useState } from "react";
import { useChatStream } from "@/pages/Chat/hooks/useChatStream";
import type { ChatStreamMessage } from "@/services/chat";
import { saveApiChatSession } from "@/services/api_chat";
import {
  buildDirectTools,
  buildMcpFunctionTools,
  dispatchViaMcp,
  extractApiToolMetadata,
  runToolLoop,
  type FunctionTool,
  type ToolCallSummary,
  type ToolDispatchResult,
} from "@/services/mcp/toolLoop";
import { mcpClient } from "@/services/mcp/client";
import { showToast } from "@/components/ui";
import type { ApiChatSession, ChatMessage } from "@/types";

interface LlmContext {
  providerId: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  thinking?: boolean;
  stream?: boolean;
}

interface RunArgs {
  session: ApiChatSession;
  llm: LlmContext;
  onSession: (s: ApiChatSession) => void;
  onError: (msg: string) => void;
}

function makeMessage(role: ChatMessage["role"], content: string, extra?: Partial<ChatMessage>): ChatMessage {
  return {
    id:
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

function toStreamMessages(session: ApiChatSession): ChatStreamMessage[] {
  const out: ChatStreamMessage[] = [];
  if (session.systemPrompt?.trim()) {
    out.push({ role: "system", content: session.systemPrompt.trim() });
  }
  for (const m of session.messages) {
    if (m.role === "assistant") {
      const hasToolCalls = (m.toolCalls?.length ?? 0) > 0;
      const hasThinking = Boolean(m.thinkingContent?.trim());
      if (!hasToolCalls && !hasThinking && (!m.content || !m.content.trim())) continue;
      out.push({
        role: "assistant",
        content: m.content ?? "",
        thinkingContent: m.thinkingContent ?? undefined,
        toolCalls: hasToolCalls
          ? m.toolCalls!.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.arguments || "{}" },
            }))
          : undefined,
      });
    } else if (m.role === "tool") {
      out.push({
        role: "tool",
        content: m.content,
        toolCallId: m.toolCallId,
        name: m.toolName,
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

export function useApiChatOrchestration() {
  const { streaming, thinkingBuffer, start, stop } = useChatStream();
  const [loading, setLoading] = useState(false);
  // single-flight：send / regenerate / retryUser / retryFromError 共用这一把**同步**锁。
  // `loading` 是 state，setLoading 之后到重新渲染之间还能再进来一次；
  // 而 send 在 setLoading 之前就要 await persist，窗口足够两次 Enter 双双通过。
  const runLockRef = useRef(false);
  const currentSessionRef = useRef<ApiChatSession | null>(null);
  const onSessionRef = useRef<((s: ApiChatSession) => void) | null>(null);
  const onErrorRef = useRef<((msg: string) => void) | null>(null);

  async function persist(session: ApiChatSession): Promise<ApiChatSession> {
    const saved = await saveApiChatSession(session);
    currentSessionRef.current = saved;
    onSessionRef.current?.(saved);
    return saved;
  }

  async function runLoop(session: ApiChatSession, llm: LlmContext): Promise<void> {
    const hasEndpoints = session.selectedEndpointIds.length > 0;
    const gatewayUp = hasEndpoints ? await mcpClient.isAvailable() : false;
    const useDirect = hasEndpoints && !gatewayUp;

    // 网关不可用时构建直连工具 + 派发器（兜底，不再硬性失败整轮）
    let direct: {
      tools: FunctionTool[];
      dispatch: (call: ToolCallSummary) => Promise<ToolDispatchResult>;
    } | null = null;
    if (useDirect) {
      try {
        direct = await buildDirectTools(session.selectedEndpointIds);
        showToast("info", "MCP Gateway 未启动，已切换为直连后端执行接口");
      } catch (err) {
        onErrorRef.current?.(err instanceof Error ? err.message : String(err));
      }
    }

    try {
      await runToolLoop({
        startStream: start,
        provider: {
          providerId: llm.providerId,
          model: llm.model,
          baseUrl: llm.baseUrl,
          apiKey: llm.apiKey,
          thinking: llm.thinking,
        },
        generation: {
          temperature: session.temperature,
          maxTokens: session.maxTokens,
          topP: session.topP,
          frequencyPenalty: session.frequencyPenalty,
          presencePenalty: session.presencePenalty,
        },
        initialMessages: toStreamMessages(session),
        toolsBuilder: () => {
          if (!hasEndpoints) return Promise.resolve([]);
          if (useDirect) return Promise.resolve(direct?.tools ?? []);
          return buildMcpFunctionTools({ endpointIds: session.selectedEndpointIds });
        },
        dispatch: useDirect && direct ? direct.dispatch : dispatchViaMcp,
        onAssistantDelta: (full, thinking) => {
          const cur = currentSessionRef.current;
          if (!cur) return;
          const messages = [...cur.messages];
          const last = messages[messages.length - 1];
          if (last?.role === "assistant" && !last.toolCalls && !last.error) {
            messages[messages.length - 1] = {
              ...last,
              content: full,
              thinkingContent: thinking || last.thinkingContent,
            };
          } else {
            messages.push(makeMessage("assistant", full, { thinkingContent: thinking || undefined }));
          }
          const next = { ...cur, messages };
          currentSessionRef.current = next;
          onSessionRef.current?.(next);
        },
        onAssistantFinal: async ({ content, thinking, toolCalls, usage }) => {
          const cur = currentSessionRef.current;
          if (!cur) return;
          const assistantMsg = makeMessage("assistant", content, {
            thinkingContent: thinking || undefined,
            tokens: usage?.completionTokens,
            toolCalls:
              toolCalls.length > 0
                ? toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments }))
                : undefined,
          });
          const lastIdx = cur.messages.length - 1;
          const last = cur.messages[lastIdx];
          let nextMessages: ChatMessage[];
          if (last?.role === "assistant" && !last.toolCalls && !last.error) {
            nextMessages = [...cur.messages];
            nextMessages[lastIdx] = { ...last, ...assistantMsg, id: last.id, createdAt: last.createdAt };
          } else {
            nextMessages = [...cur.messages, assistantMsg];
          }
          const updated: ApiChatSession = { ...cur, messages: nextMessages };
          try {
            await persist(updated);
          } catch {
            /* ignore */
          }
        },
        onToolStart: ({ call }) => {
          const cur = currentSessionRef.current;
          if (!cur) return;
          const pending = makeMessage("tool", "调用中…", {
            toolPending: true,
            toolCallId: call.id,
            toolName: call.name,
          });
          const next = { ...cur, messages: [...cur.messages, pending] };
          currentSessionRef.current = next;
          onSessionRef.current?.(next);
        },
        onToolExecuted: async ({ call, result }) => {
          const cur = currentSessionRef.current;
          if (!cur) return;
          const extra: Partial<ChatMessage> = {
            toolCallId: call.id,
            toolName: call.name,
            toolPending: false,
          };
          const meta = extractApiToolMetadata(result.structuredContent);
          if (meta) {
            if (meta.status !== undefined) extra.toolStatus = meta.status;
            if (meta.method !== undefined) extra.toolMethod = meta.method;
            if (meta.url !== undefined) extra.toolUrl = meta.url;
            if (meta.elapsedMs !== undefined) extra.toolElapsedMs = meta.elapsedMs;
            if (meta.totalBytes !== undefined) extra.toolBodyBytes = meta.totalBytes;
            if (meta.truncated !== undefined) extra.toolTruncated = meta.truncated;
          }
          const content = meta?.body
            ? `HTTP ${meta.status ?? "-"}\n\n${meta.body}`
            : result.content;
          // 更新对应的"调用中"占位消息；找不到则追加（容错）
          const idx = cur.messages.findIndex(
            (m) => m.role === "tool" && m.toolCallId === call.id && m.toolPending,
          );
          let nextMessages: ChatMessage[];
          if (idx >= 0) {
            nextMessages = [...cur.messages];
            nextMessages[idx] = { ...nextMessages[idx], ...extra, content };
          } else {
            nextMessages = [...cur.messages, makeMessage("tool", content, extra)];
          }
          const updated: ApiChatSession = { ...cur, messages: nextMessages };
          try {
            await persist(updated);
          } catch {
            /* ignore */
          }
        },
        onRetry: ({ attempt }) =>
          showToast("info", `请求失败，正在重试（第 ${attempt} 次）`),
        onError: (msg) => {
          onErrorRef.current?.(msg);
          // 追加一条内联可重试错误气泡（assistant + error），供 UI 一键重试
          const cur = currentSessionRef.current;
          if (!cur) return;
          const last = cur.messages[cur.messages.length - 1];
          if (last?.role === "assistant" && last.error) return;
          const errMsg = makeMessage("assistant", msg, { error: true });
          const next = { ...cur, messages: [...cur.messages, errMsg] };
          currentSessionRef.current = next;
          onSessionRef.current?.(next);
          persist(next).catch(() => {});
        },
      });
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err.message : String(err));
    }
  }

  /** 入口统一包一层：锁在任何 await 之前同步建立。 */
  async function withRunLock(fn: () => Promise<void>): Promise<void> {
    if (runLockRef.current) return;
    runLockRef.current = true;
    try {
      await fn();
    } finally {
      runLockRef.current = false;
    }
  }

  async function send(args: RunArgs, userText: string): Promise<void> {
    await withRunLock(() => sendInner(args, userText));
  }

  async function sendInner(args: RunArgs, userText: string): Promise<void> {
    const { session, llm, onSession, onError } = args;
    currentSessionRef.current = session;
    onSessionRef.current = onSession;
    onErrorRef.current = onError;

    const userMessage = makeMessage("user", userText);
    const next: ApiChatSession = {
      ...session,
      providerId: llm.providerId,
      messages: [...session.messages, userMessage],
    };
    setLoading(true);
    try {
      const saved = await persist(next);
      await runLoop(saved, llm);
    } finally {
      setLoading(false);
    }
  }

  async function regenerate(args: RunArgs, targetMessageId: string): Promise<void> {
    const idx = args.session.messages.findIndex((m) => m.id === targetMessageId);
    if (idx < 0) return;
    const prevUser = [...args.session.messages.slice(0, idx)].reverse().find((m) => m.role === "user");
    if (!prevUser) return;
    await send(args, prevUser.content);
  }

  async function retryUser(args: RunArgs, targetMessageId: string): Promise<void> {
    const idx = args.session.messages.findIndex((m) => m.id === targetMessageId);
    if (idx < 0) return;
    const target = args.session.messages[idx];
    if (target.role !== "user") return;
    await send(args, target.content);
  }

  /** 错误气泡"重试"：丢弃最后一条 user 之后的所有消息（错误气泡 / 半截 assistant / tool），从该 user 重跑（不重复追加 user） */
  async function retryFromError(args: RunArgs): Promise<void> {
    await withRunLock(() => retryFromErrorInner(args));
  }

  async function retryFromErrorInner(args: RunArgs): Promise<void> {
    const { session, llm, onSession, onError } = args;
    currentSessionRef.current = session;
    onSessionRef.current = onSession;
    onErrorRef.current = onError;
    let lastUserIdx = -1;
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) return;
    const trimmed = session.messages.slice(0, lastUserIdx + 1);
    setLoading(true);
    try {
      const saved = await persist({ ...session, messages: trimmed });
      await runLoop(saved, llm);
    } finally {
      setLoading(false);
    }
  }

  async function stopAll() {
    await stop();
  }

  return { streaming, thinkingBuffer, loading, send, regenerate, retryUser, retryFromError, stop: stopAll };
}
