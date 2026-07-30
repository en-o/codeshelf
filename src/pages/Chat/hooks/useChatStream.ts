import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { chatCancel, chatStream, type ChatStreamRequest } from "@/services/chat";

export interface ToolCallAccumulated {
  id: string;
  name: string;
  arguments: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StreamCallbacks {
  onDelta: (delta: string, thinkingSoFar: string) => void;
  onThinking: (delta: string) => void;
  /** 每次收到一个 tool_call_delta 就回调，附带当前累积的全部 tool_calls 快照 */
  onToolCallDelta?: (calls: ToolCallAccumulated[]) => void;
  /** 流结束；若因 tool_calls 结束则 finishReason="tool_calls" 且 toolCalls 非空 */
  onDone: (
    finalContent: string,
    finalThinking: string,
    toolCalls: ToolCallAccumulated[],
    finishReason?: string,
    usage?: TokenUsage,
  ) => void;
  onError: (message: string) => void;
}

interface ToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  argumentsDelta?: string;
}

interface StreamEvent {
  requestId: string;
  delta?: string;
  done: boolean;
  error?: string;
  thinkingDelta?: string;
  toolCallDelta?: ToolCallDelta;
  finishReason?: string;
  usage?: TokenUsage;
}

export function useChatStream() {
  const [streaming, setStreaming] = useState(false);
  const [thinkingBuffer, setThinkingBuffer] = useState("");
  const callbacksRef = useRef<StreamCallbacks | null>(null);
  const streamBufferRef = useRef("");
  const thinkingBufferRef = useRef("");
  const toolCallsRef = useRef<ToolCallAccumulated[]>([]);
  const requestIdRef = useRef<string | null>(null);
  const streamingRef = useRef(false);

  // 监听器**挂载时注册一次**，按 requestIdRef 过滤，而不是每次请求重建。
  //
  // 原来的写法是 `useEffect(..., [requestId])`：start() 里 setRequestId 之后立刻
  // invoke 后端，而 effect 要等下一次渲染、`listen()` 本身还是异步的。
  // 后端快速失败、非流式快速响应、本地模型秒回都可能抢在监听器注册之前到达，
  // 结果是内容丢失、streaming 卡在 true、工具循环的 Promise 永不 resolve。
  //
  // `listenerReady` 让 start() 能在 invoke 之前等监听器真正就位。
  const listenerReadyRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    listenerReadyRef.current = listen<StreamEvent>("chat-stream", (event) => {
      if (cancelled) return;
      const payload = event.payload;
      // 用 ref 而不是闭包里的 state：取消/切换后旧请求的事件必须被丢弃
      if (payload.requestId !== requestIdRef.current) return;
      const cbs = callbacksRef.current;
      if (payload.error) {
        cbs?.onError(payload.error);
        setStreaming(false);
        streamingRef.current = false;
        requestIdRef.current = null;
        return;
      }
      if (payload.thinkingDelta) {
        thinkingBufferRef.current += payload.thinkingDelta;
        setThinkingBuffer(thinkingBufferRef.current);
        cbs?.onThinking(payload.thinkingDelta);
      }
      if (payload.delta) {
        streamBufferRef.current += payload.delta;
        cbs?.onDelta(streamBufferRef.current, thinkingBufferRef.current);
      }
      if (payload.toolCallDelta) {
        const { index, id, name, argumentsDelta } = payload.toolCallDelta;
        const calls = toolCallsRef.current;
        while (calls.length <= index) calls.push({ id: "", name: "", arguments: "" });
        const entry = calls[index];
        if (id) entry.id = id;
        if (name) entry.name = name;
        if (argumentsDelta) entry.arguments += argumentsDelta;
        cbs?.onToolCallDelta?.(calls.slice());
      }
      if (payload.done) {
        const finalContent = streamBufferRef.current;
        const finalThinking = thinkingBufferRef.current;
        const finalCalls = toolCallsRef.current.filter((c) => c.id || c.name);
        const usage = payload.usage;
        setStreaming(false);
        streamingRef.current = false;
        requestIdRef.current = null;
        cbs?.onDone(finalContent, finalThinking, finalCalls, payload.finishReason, usage);
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      listenerReadyRef.current = null;
    };
  }, []);

  const start = useCallback(async (request: Omit<ChatStreamRequest, "requestId">, callbacks: StreamCallbacks) => {
    // single-flight：锁**同步**建立。streamingRef 是 ref 不是 state，
    // 连续两次点击之间没有渲染，state 版本的判断会双双读到 false。
    if (streamingRef.current) {
      throw "上一条消息还在生成中";
    }
    streamingRef.current = true;

    const id =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    callbacksRef.current = callbacks;
    streamBufferRef.current = "";
    thinkingBufferRef.current = "";
    toolCallsRef.current = [];
    setThinkingBuffer("");
    setStreaming(true);
    requestIdRef.current = id;
    try {
      // 先确保监听器就位，再发请求 —— 否则快速失败/快速响应会先到
      await listenerReadyRef.current;
      await chatStream({ ...request, requestId: id });
    } catch (err) {
      setStreaming(false);
      streamingRef.current = false;
      requestIdRef.current = null;
      throw err;
    }
    return id;
  }, []);

  const stop = useCallback(async () => {
    const id = requestIdRef.current;
    if (!id) return;
    await chatCancel(id);
    setStreaming(false);
    streamingRef.current = false;
    requestIdRef.current = null;
    streamBufferRef.current = "";
    thinkingBufferRef.current = "";
    toolCallsRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      if (streamingRef.current && requestIdRef.current) {
        chatCancel(requestIdRef.current).catch(() => {});
      }
    };
  }, []);

  return { streaming, thinkingBuffer, start, stop };
}
