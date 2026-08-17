import { chatStream, saveCompaction, type ChatStreamMessage } from "@/services/chat";
import type { ChatMessage, ChatSession } from "@/types";
import { listen } from "@tauri-apps/api/event";

const SUMMARY_PROMPT = `请对以下对话进行结构化压缩，保留：
1. 用户的目标/约束
2. 关键的技术决策与原因
3. 已经完成的步骤与仍未完成的事项
4. 涉及到的文件路径、函数名、变量名

输出纯 markdown 摘要，不要加多余寒暄。摘要将作为后续对话的上下文。`;

export interface CompactResult {
  /** 新的压缩版本号（如 "v3"），已落盘到 <sessionId>/compactions/<version>.md */
  version: string;
  /** 摘要原文，便于前端立即展示，无需再读盘 */
  summary: string;
  /** 本次摘要覆盖的早期消息条数 */
  sourceMessageCount: number;
  /** 保留的尾部消息条数 */
  tailKept: number;
}

/**
 * 调 LLM 把早期消息压成摘要，落盘为新版本 md，返回版本号。
 * 不会改动 session.messages —— 调用方负责把 currentCompactionVersion 写入 session 并持久化。
 */
export async function compactMessages(params: {
  session: ChatSession;
  providerId: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  /** 供应商协议；缺省 OpenAI 兼容。不传的话 Claude 会收到 OpenAI 格式的请求直接报错 */
  protocol?: "anthropic";
  /** 保留多少条尾部消息原样不压缩 */
  keep?: number;
}): Promise<CompactResult> {
  const keep = params.keep ?? 4;
  const original = params.session.messages;
  if (original.length <= keep) {
    throw new Error(`消息数 ≤ ${keep}，无需压缩`);
  }
  const toCompact = original.slice(0, original.length - keep);
  const tail = original.slice(original.length - keep);

  const transcript = toCompact
    .map((m: ChatMessage) => {
      const who =
        m.role === "user"
          ? "用户"
          : m.role === "assistant"
            ? "助手"
            : m.role === "tool"
              ? `工具(${m.toolName})`
              : "系统";
      return `## ${who}\n${m.content}`;
    })
    .join("\n\n");

  const messages: ChatStreamMessage[] = [
    { role: "system", content: SUMMARY_PROMPT },
    { role: "user", content: transcript },
  ];

  const requestId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  let summary = "";
  let error: string | null = null;

  const unlisten = await listen<{ requestId: string; delta?: string; done: boolean; error?: string }>(
    "chat-stream",
    (event) => {
      if (event.payload.requestId !== requestId) return;
      if (event.payload.error) error = event.payload.error;
      if (event.payload.delta) summary += event.payload.delta;
    },
  );

  const donePromise = new Promise<void>((resolve) => {
    const unlistenDone = listen<{ requestId: string; done: boolean; error?: string }>(
      "chat-stream",
      (event) => {
        if (event.payload.requestId !== requestId) return;
        if (event.payload.done || event.payload.error) {
          resolve();
          unlistenDone.then((fn) => fn()).catch(() => {});
        }
      },
    );
  });

  await chatStream({
    requestId,
    providerId: params.providerId,
    model: params.model,
    baseUrl: params.baseUrl,
    apiKey: params.apiKey,
    protocol: params.protocol,
    stream: true,
    messages,
  });

  await donePromise;
  unlisten();
  if (error) throw new Error(error);
  const summaryTrim = summary.trim();
  if (!summaryTrim) throw new Error("摘要为空");

  const meta = await saveCompaction({
    sessionId: params.session.id,
    content: summaryTrim,
    sourceMessageCount: toCompact.length,
    tailKept: tail.length,
    model: params.model,
  });

  return {
    version: meta.version,
    summary: summaryTrim,
    sourceMessageCount: meta.sourceMessageCount,
    tailKept: meta.tailKept,
  };
}
