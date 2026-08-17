import { useCallback, useEffect, useRef, useState } from "react";
import { showToast } from "@/components/ui";
import { saveChatSession } from "@/services/chat";
import {
  dshEnginePrompt,
  dshEngineStart,
  dshEngineStop,
  listenDshEvents,
  listenDshExit,
  type DshNotification,
} from "@/services/dsh";
import type { ChatMessage, ChatSession } from "@/types";
import { makeMessage } from "../Chat/utils/chatHelpers";
import type { ModelOption } from "../Chat/utils/chatHelpers";

/**
 * dsh 页的会话驱动。与 Chat 的 useChatRunner 是两回事：
 * 那边自己跑 agent 循环（组消息 → 收 tool_calls → 执行工具 → 再来一轮），
 * 这边只负责**投消息 + 把事件流翻译成消息**，循环在 dsh 进程里跑。
 *
 * 事件词表见 docs/specs/20260815-01-dsh引擎接入.md。未识别的事件一律忽略：
 * dsh 还在 rc 阶段会加事件，忽略比猜着渲染安全。
 */

interface DshRunnerDeps {
  selected: ModelOption | null;
  /** dsh 那边的模型路由名，见 dshRouteFor */
  providerRoute: string;
  activeSessionRef: React.MutableRefObject<ChatSession | null>;
  setActiveSession: React.Dispatch<React.SetStateAction<ChatSession | null>>;
  syncSummary: (s: ChatSession) => void;
}

type Blocks = Array<Record<string, unknown>>;

/** 取内容块里的正文（text 块）；工具结果里可能再套一层，故递归。 */
function blocksText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return (blocks as Blocks)
    .map((b) => {
      if (b?.type === "text" && typeof b.text === "string") return b.text;
      if (b?.type === "tool-result") return blocksText(b.content);
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** 思考内容单独放（reasoning 块），与正文分开渲染 */
function blocksReasoning(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return (blocks as Blocks)
    .filter((b) => b?.type === "reasoning" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

function errorText(reason: unknown): string {
  const r = reason as { kind?: string; error?: { message?: string; code?: string } } | undefined;
  if (!r || r.kind !== "error") return "";
  const message = r.error?.message ?? "未知错误";
  return r.error?.code ? `${message}（${r.error.code}）` : message;
}

export function useDshRunner(deps: DshRunnerDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const [running, setRunning] = useState(false);
  /** 当前这一轮所属的会话 id；事件按它过滤，切走的会话不再改 UI */
  const targetRef = useRef<string | null>(null);
  /** 本轮的会话快照。不依赖 activeSessionRef —— 用户可能中途切走 */
  const workingRef = useRef<ChatSession | null>(null);
  /** 本轮结束时 resolve，让调用方的 loading 状态能跟着结束 */
  const doneRef = useRef<(() => void) | null>(null);
  /** 正在累积的 assistant 消息（每个 step 一条） */
  const draftRef = useRef<{ id: string; text: string; thinking: string } | null>(null);
  const listenerReadyRef = useRef<Promise<void> | null>(null);

  const applyMessages = useCallback((messages: ChatMessage[]) => {
    const session = workingRef.current;
    if (!session) return;
    const next = { ...session, messages };
    workingRef.current = next;
    const { setActiveSession } = depsRef.current;
    setActiveSession((prev) => (prev && prev.id === next.id ? { ...prev, messages } : prev));
  }, []);

  const persist = useCallback(async () => {
    const session = workingRef.current;
    if (!session) return;
    try {
      const saved = await saveChatSession(session);
      workingRef.current = saved;
      const { activeSessionRef, setActiveSession, syncSummary } = depsRef.current;
      if (activeSessionRef.current?.id === saved.id) setActiveSession(saved);
      syncSummary(saved);
    } catch {
      /* 保存失败不影响这一轮继续跑，下一次定稿还会再存 */
    }
  }, []);

  const finish = useCallback(() => {
    targetRef.current = null;
    draftRef.current = null;
    setRunning(false);
    const done = doneRef.current;
    doneRef.current = null;
    done?.();
  }, []);

  /** 拿到（或新建）本 step 的 assistant 消息，返回其在数组里的下标 */
  const ensureDraft = useCallback(() => {
    const session = workingRef.current;
    if (!session) return null;
    if (draftRef.current) {
      const idx = session.messages.findIndex((m) => m.id === draftRef.current!.id);
      if (idx >= 0) return idx;
    }
    const msg = makeMessage("assistant", "");
    draftRef.current = { id: msg.id, text: "", thinking: "" };
    applyMessages([...session.messages, msg]);
    return workingRef.current!.messages.length - 1;
  }, [applyMessages]);

  const handleNotification = useCallback(
    (n: DshNotification) => {
      if (!targetRef.current || n.sessionKey !== targetRef.current) return;
      const session = workingRef.current;
      if (!session) return;

      if (n.method === "session.status") {
        if ((n.params as { status?: string }).status === "idle") {
          persist().then(finish);
        }
        return;
      }
      if (n.method !== "session.event") return;

      const event = (n.params as { event?: { type?: string; data?: Record<string, unknown> } }).event;
      if (!event?.type) return;
      const data = event.data ?? {};

      switch (event.type) {
        case "assistant/chunk": {
          const chunk = data.chunk as { type?: string; text?: string } | undefined;
          if (!chunk) return;
          if (chunk.type !== "text-delta" && chunk.type !== "reasoning-delta") return;
          const idx = ensureDraft();
          if (idx === null) return;
          const draft = draftRef.current!;
          if (chunk.type === "text-delta") draft.text += chunk.text ?? "";
          else draft.thinking += chunk.text ?? "";
          const messages = [...workingRef.current!.messages];
          messages[idx] = {
            ...messages[idx],
            content: draft.text,
            thinkingContent: draft.thinking || undefined,
          };
          applyMessages(messages);
          return;
        }
        case "assistant/message": {
          // 定稿：以组装好的消息为准（流式增量可能因重试而重复）
          const message = data.message as { content?: unknown } | undefined;
          const idx = ensureDraft();
          if (idx === null) return;
          const usage = data.usage as { outputTokens?: number } | undefined;
          const text = blocksText(message?.content);
          const thinking = blocksReasoning(message?.content);
          const messages = [...workingRef.current!.messages];
          messages[idx] = {
            ...messages[idx],
            content: text || messages[idx].content,
            thinkingContent: thinking || messages[idx].thinkingContent,
            tokens: usage?.outputTokens,
          };
          applyMessages(messages);
          // 本 step 结束，下一个 step 另起一条
          draftRef.current = null;
          persist();
          return;
        }
        case "tool/call": {
          const idx = ensureDraft();
          if (idx === null) return;
          const messages = [...workingRef.current!.messages];
          const current = messages[idx];
          messages[idx] = {
            ...current,
            toolPending: true,
            toolCalls: [
              ...(current.toolCalls ?? []),
              {
                id: String(data.callId ?? ""),
                name: String(data.name ?? ""),
                arguments: String(data.arguments ?? ""),
              },
            ],
          };
          applyMessages(messages);
          // 工具调用之后模型还会继续说话，但那属于下一个 step 的消息
          draftRef.current = null;
          return;
        }
        case "tool/result": {
          const message = data.message as
            | { content?: unknown; source?: { callId?: string } }
            | undefined;
          const block = Array.isArray(message?.content)
            ? (message?.content?.[0] as { toolCallId?: string; isError?: boolean } | undefined)
            : undefined;
          const toolMessage = makeMessage("tool", blocksText(message?.content) || "（无输出）", {
            toolCallId: block?.toolCallId ?? message?.source?.callId,
            toolName: undefined,
            error: block?.isError === true ? true : undefined,
          });
          const messages = workingRef.current!.messages.map((m) =>
            m.toolPending ? { ...m, toolPending: undefined } : m,
          );
          applyMessages([...messages, toolMessage]);
          persist();
          return;
        }
        case "turn/end": {
          const text = errorText(data.reason);
          if (!text) return;
          const errMsg = makeMessage("assistant", `dsh 引擎报错：${text}`, { error: true });
          applyMessages([...workingRef.current!.messages, errMsg]);
          draftRef.current = null;
          showToast("error", "dsh 执行失败", text);
          return;
        }
        default:
          return;
      }
    },
    [applyMessages, ensureDraft, finish, persist],
  );

  // 监听器挂载时注册一次。与 useChatStream 同样的理由：注册是异步的，
  // 必须能在投消息之前 await 它就位，否则秒回的事件会丢在注册之前。
  useEffect(() => {
    let unlistenEvents: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    let cancelled = false;
    listenerReadyRef.current = Promise.all([
      listenDshEvents(handleNotification),
      listenDshExit((e) => {
        if (!targetRef.current) return;
        const detail = e.stderr.trim().split("\n").slice(-3).join(" / ");
        showToast("error", "dsh 引擎已退出", detail || `退出码 ${e.code ?? "未知"}`);
        persist().then(finish);
      }),
    ]).then(([offEvents, offExit]) => {
      if (cancelled) {
        offEvents();
        offExit();
        return;
      }
      unlistenEvents = offEvents;
      unlistenExit = offExit;
    });
    return () => {
      cancelled = true;
      unlistenEvents?.();
      unlistenExit?.();
      listenerReadyRef.current = null;
    };
  }, [handleNotification, persist, finish]);

  /**
   * 投递会话里最后一条用户消息给 dsh，等这一轮跑到 idle 为止。
   * 与 useChatRunner.runChatRequest 同签名，页面按会话引擎二选一。
   */
  const runDshRequest = useCallback(
    async (session: ChatSession) => {
      const { selected, providerRoute } = depsRef.current;
      if (!selected) return;
      if (!session.allowedCwd) {
        showToast("warning", "dsh 会话需要先选工作目录", "在会话设置里选一个项目目录");
        return;
      }
      const lastUser = [...session.messages].reverse().find((m) => m.role === "user");
      if (!lastUser?.content.trim()) return;

      setRunning(true);
      workingRef.current = session;
      targetRef.current = session.id;
      draftRef.current = null;

      try {
        await dshEngineStart({
          cwd: session.allowedCwd,
          model: selected.model.model,
          baseUrl: selected.baseUrl,
          apiKey: selected.apiKey ?? null,
          provider: providerRoute,
        });
        await listenerReadyRef.current;
        const done = new Promise<void>((resolve) => {
          doneRef.current = resolve;
        });
        await dshEnginePrompt(session.id, lastUser.content);
        await done;
      } catch (e) {
        // Tauri 抛回来的是纯字符串，不是 Error 实例
        const text = typeof e === "string" && e ? e : e instanceof Error ? e.message : "dsh 调用失败";
        showToast("error", "dsh 调用失败", text);
        finish();
      }
    },
    [finish],
  );

  /** 停止 = 关掉引擎进程：协议里没有取消方法，这是上游给的唯一手段 */
  const stopDsh = useCallback(async () => {
    try {
      await dshEngineStop();
    } catch {
      /* 进程可能已经没了 */
    }
    await persist();
    finish();
  }, [finish, persist]);

  return { runDshRequest, stopDsh, dshRunning: running };
}
