import { useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { showToast } from "@/components/ui";
import {
  executeTool,
  getCompaction,
  saveChatSession,
  type ChatStreamRequest,
  type ToolSchema,
} from "@/services/chat";
import { mcpClient } from "@/services/mcp/client";
import { buildMcpFunctionTools, extractApiToolMetadata } from "@/services/mcp/toolLoop";
import type { EditorConfig } from "@/stores/editorsStore";
import type { ChatMessage, ChatSession, ToolCall } from "@/types";
import { compactMessages } from "../utils/compact";
import type { ModelOption } from "../utils/chatHelpers";
import { makeMessage, summarizeTitle } from "../utils/chatHelpers";
import { buildStreamMessages } from "../utils/streamMessages";
import type { StreamCallbacks } from "./useChatStream";

const MAX_TOOL_ROUNDS = 10;
/** 自动压缩阈值：消息数超过此值且未在 streaming 时，发送前自动压缩 */
const AUTO_COMPACT_THRESHOLD = 40;
/** 自动压缩时保留尾部消息条数 */
const COMPACT_KEEP = 4;

export interface ChatRunnerDeps {
  toolSchemas: ToolSchema[];
  toolsEnabled: boolean;
  globalMemory: string;
  editors: EditorConfig[];
  selected: ModelOption | null;
  projectContextRef: MutableRefObject<string>;
  mentionContextRef: MutableRefObject<string>;
  activeSessionRef: MutableRefObject<ChatSession | null>;
  setActiveSession: Dispatch<SetStateAction<ChatSession | null>>;
  syncSummary: (s: ChatSession) => void;
  startStream: (req: Omit<ChatStreamRequest, "requestId">, cb: StreamCallbacks) => Promise<string>;
  requestApproval: (call: ToolCall) => Promise<"once" | "always" | "reject">;
}

export function useChatRunner(deps: ChatRunnerDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const autoCompactingRef = useRef(false);

  function activeTools(session: ChatSession) {
    const { toolsEnabled, toolSchemas } = depsRef.current;
    if (!toolsEnabled) return undefined;
    const enabled = session.enabledTools ?? toolSchemas.map((t) => t.name);
    const list = toolSchemas.filter((t) => enabled.includes(t.name));
    if (list.length === 0) return undefined;
    return list.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  async function activeMcpTools(session: ChatSession) {
    const { toolsEnabled } = depsRef.current;
    if (!toolsEnabled) return [];
    if (session.useMcpGatewayTools === false) return [];
    try {
      return await buildMcpFunctionTools();
    } catch {
      return [];
    }
  }

  /**
   * 自动压缩：当未压缩的消息数超过阈值时，触发一次压缩并把版本号写回 session。
   * 仅在非 streaming 场景调用；失败仅打 toast，不阻塞发送。
   */
  async function maybeAutoCompact(session: ChatSession): Promise<ChatSession> {
    const { selected, setActiveSession, syncSummary } = depsRef.current;
    if (autoCompactingRef.current) return session;
    if (!selected) return session;
    let activeRange = 0;
    if (session.currentCompactionVersion) {
      try {
        const c = await getCompaction(session.id, session.currentCompactionVersion);
        const compactedCount = c?.meta?.sourceMessageCount ?? 0;
        activeRange = Math.max(0, session.messages.length - compactedCount);
      } catch {
        activeRange = session.messages.length;
      }
    } else {
      activeRange = session.messages.length;
    }
    if (activeRange <= AUTO_COMPACT_THRESHOLD) return session;
    autoCompactingRef.current = true;
    try {
      const res = await compactMessages({
        session,
        providerId: selected.providerId,
        model: selected.model.model,
        baseUrl: selected.baseUrl,
        apiKey: selected.apiKey,
        protocol: selected.protocol,
        keep: COMPACT_KEEP,
      });
      const next: ChatSession = { ...session, currentCompactionVersion: res.version };
      const saved = await saveChatSession(next);
      setActiveSession(saved);
      syncSummary(saved);
      showToast("success", `已自动压缩到 ${res.version}（覆盖 ${res.sourceMessageCount} 条）`);
      return saved;
    } catch (err) {
      showToast("warning", `自动压缩失败：${err instanceof Error ? err.message : "未知错误"}`);
      return session;
    } finally {
      autoCompactingRef.current = false;
    }
  }

  /** 扫最近一条 user 消息是否以 `[使用 NAME 工具]` 开头，若是返回工具名 */
  function detectForcedTool(session: ChatSession): string | null {
    const last = [...session.messages].reverse().find((m) => m.role === "user");
    if (!last) return null;
    const m = last.content.match(/^\s*\[使用\s+([A-Za-z_][A-Za-z0-9_]*)\s+工具\]/);
    return m ? m[1] : null;
  }

  async function runChatRequest(session: ChatSession, round: number = 0): Promise<void> {
    const {
      selected,
      toolSchemas,
      globalMemory,
      editors,
      projectContextRef,
      mentionContextRef,
      activeSessionRef,
      setActiveSession,
      syncSummary,
      startStream,
    } = depsRef.current;
    if (!selected) return;
    if (round >= MAX_TOOL_ROUNDS) {
      showToast("warning", `已达到最大工具循环轮次（${MAX_TOOL_ROUNDS}），请检查`);
      return;
    }

    if (round === 0) {
      session = await maybeAutoCompact(session);
    }

    // 锚定当前请求所属的会话 ID。流回调期间用户可能切换会话，
    // 必须保证所有 setActiveSession / saveChatSession 都只针对这个会话。
    const targetSessionId = session.id;
    // 本地维护流过程中的最新 session 快照，避免依赖可能已切走的 activeSessionRef
    let workingSession: ChatSession = session;

    let compaction: { summary: string; sourceMessageCount: number; version: string } | undefined;
    if (session.currentCompactionVersion) {
      try {
        const c = await getCompaction(session.id, session.currentCompactionVersion);
        if (c && c.meta) {
          compaction = {
            summary: c.content,
            sourceMessageCount: c.meta.sourceMessageCount,
            version: c.version,
          };
        }
      } catch (err) {
        console.warn("加载压缩摘要失败", err);
      }
    }

    let tools: Array<{ type: "function"; function: { name: string; description?: string; parameters: object } }> | undefined =
      activeTools(session);
    const mcpTools = await activeMcpTools(session);
    if (mcpTools.length > 0) {
      tools = tools ? [...tools, ...mcpTools] : mcpTools;
    }
    let toolChoice: { type: "function"; function: { name: string } } | undefined;

    if (round === 0) {
      const forced = detectForcedTool(session);
      if (forced) {
        const schema = toolSchemas.find((t) => t.name === forced);
        if (!schema) {
          showToast("warning", `未找到工具 ${forced}，已退回普通对话`);
        } else {
          tools = [
            {
              type: "function" as const,
              function: { name: schema.name, description: schema.description, parameters: schema.parameters },
            },
          ];
          toolChoice = { type: "function", function: { name: schema.name } };
        }
      }
    }

    try {
      await startStream(
        {
          providerId: selected.providerId,
          model: selected.model.model,
          baseUrl: selected.baseUrl,
          apiKey: selected.apiKey,
          protocol: selected.protocol,
          thinking: selected.model.thinking,
          stream: selected.model.stream !== false,
          temperature: session.temperature,
          maxTokens: session.maxTokens,
          topP: session.topP,
          frequencyPenalty: session.frequencyPenalty,
          presencePenalty: session.presencePenalty,
          messages: buildStreamMessages({
            session,
            globalMemory,
            projectContext: projectContextRef.current,
            mentionContext: mentionContextRef.current,
            editors,
            selected,
            compaction,
          }),
          tools,
          toolChoice,
        },
        {
          onDelta: (full, thinking) => {
            // 基于 workingSession 计算新消息，UI 仅在当前还在该会话时同步
            const messages = [...workingSession.messages];
            const last = messages[messages.length - 1];
            if (last?.role === "assistant" && !last.toolCalls) {
              messages[messages.length - 1] = {
                ...last,
                content: full,
                thinkingContent: thinking || last.thinkingContent,
              };
            } else {
              messages.push(makeMessage("assistant", full, { thinkingContent: thinking || undefined }));
            }
            workingSession = { ...workingSession, messages };
            setActiveSession((prev) => {
              if (!prev || prev.id !== targetSessionId) return prev;
              return { ...prev, messages };
            });
          },
          onThinking: () => {},
          onToolCallDelta: () => {},
          onDone: async (finalContent, finalThinking, toolCalls, finishReason) => {
            const assistantMsg: ChatMessage = makeMessage("assistant", finalContent, {
              thinkingContent: finalThinking || undefined,
              toolCalls: toolCalls.length > 0 ? toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments })) : undefined,
            });
            const lastIdx = workingSession.messages.length - 1;
            const last = workingSession.messages[lastIdx];
            let nextMessages: ChatMessage[];
            if (last?.role === "assistant" && !last.toolCalls) {
              nextMessages = [...workingSession.messages];
              nextMessages[lastIdx] = { ...last, ...assistantMsg, id: last.id, createdAt: last.createdAt };
            } else {
              nextMessages = [...workingSession.messages, assistantMsg];
            }
            let updatedSession: ChatSession = { ...workingSession, messages: nextMessages };
            if ((updatedSession.title === "新会话" || !updatedSession.title.trim()) && updatedSession.messages.length >= 2) {
              const generated = summarizeTitle(updatedSession.messages);
              if (generated) updatedSession = { ...updatedSession, title: generated };
            }
            try {
              const saved = await saveChatSession(updatedSession);
              workingSession = saved;
              if (activeSessionRef.current?.id === targetSessionId) {
                setActiveSession(saved);
              }
              syncSummary(saved);
              updatedSession = saved;
            } catch {
              /* ignore */
            }

            if (finishReason === "tool_calls" && toolCalls.length > 0) {
              await executeAndContinue(updatedSession, toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments })), round);
            }
          },
          onError: (msg) => {
            showToast("error", msg);
          },
        },
      );
    } catch {
      showToast("error", "发送失败");
    }
  }

  async function executeAndContinue(sessionAfterAssistant: ChatSession, calls: ToolCall[], round: number) {
    const { toolSchemas, activeSessionRef, setActiveSession, syncSummary, requestApproval } = depsRef.current;
    let session = sessionAfterAssistant;
    const targetSessionId = session.id;
    let allowedTools = new Set<string>(session.allowedTools ?? []);
    const localToolNames = new Set(toolSchemas.map((t) => t.name));

    for (const call of calls) {
      const isLocalTool = localToolNames.has(call.name);

      let resultContent: string;
      let toolExtra: Partial<ChatMessage> = {
        toolCallId: call.id,
        toolName: call.name,
      };

      if (isLocalTool) {
        let approved: "once" | "always" | "reject";
        if (allowedTools.has(call.name)) {
          approved = "once";
        } else {
          approved = await requestApproval(call);
        }
        if (approved === "always") {
          allowedTools.add(call.name);
          session = { ...session, allowedTools: Array.from(allowedTools) };
          try {
            const saved = await saveChatSession(session);
            if (activeSessionRef.current?.id === targetSessionId) {
              setActiveSession(saved);
            }
            syncSummary(saved);
            session = saved;
          } catch {
            /* ignore */
          }
        }

        if (approved === "reject") {
          resultContent = "（用户拒绝执行此工具）";
        } else {
          try {
            resultContent = await executeTool({
              sessionId: session.id,
              toolName: call.name,
              argumentsJson: call.arguments || "{}",
            });
          } catch (err) {
            resultContent = `执行失败: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
      } else {
        try {
          let args: unknown = {};
          try {
            args = call.arguments ? JSON.parse(call.arguments) : {};
          } catch {
            args = {};
          }
          const mcpResult = await mcpClient.callTool(call.name, args);
          const meta = extractApiToolMetadata(mcpResult.structuredContent);
          if (meta) {
            if (meta.status !== undefined) toolExtra.toolStatus = meta.status;
            if (meta.method !== undefined) toolExtra.toolMethod = meta.method;
            if (meta.url !== undefined) toolExtra.toolUrl = meta.url;
            if (meta.elapsedMs !== undefined) toolExtra.toolElapsedMs = meta.elapsedMs;
            if (meta.totalBytes !== undefined) toolExtra.toolBodyBytes = meta.totalBytes;
            if (meta.truncated !== undefined) toolExtra.toolTruncated = meta.truncated;
            resultContent = meta.body ? `HTTP ${meta.status ?? "-"}\n\n${meta.body}` : mcpResult.content?.[0]?.text ?? "";
          } else {
            resultContent = mcpResult.content?.[0]?.text ?? (mcpResult.isError ? "MCP 工具执行错误" : "无内容");
          }
        } catch (err) {
          resultContent = `MCP 工具执行失败: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      const toolMessage: ChatMessage = makeMessage("tool", resultContent, toolExtra);
      session = { ...session, messages: [...session.messages, toolMessage] };
      try {
        const saved = await saveChatSession(session);
        if (activeSessionRef.current?.id === targetSessionId) {
          setActiveSession(saved);
        }
        syncSummary(saved);
        session = saved;
      } catch {
        /* ignore */
      }
    }

    await runChatRequest(session, round + 1);
  }

  return { runChatRequest };
}
