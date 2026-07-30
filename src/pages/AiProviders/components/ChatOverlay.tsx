import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Trash2, X } from "lucide-react";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { showToast } from "@/components/ui";
import { useConfirm } from "@/components/common";
import {
  chatCancel,
  chatStream,
  createChatSession,
  deleteChatSession,
  getChatSession,
  listChatSessions,
  renameChatSession,
  saveChatSession,
} from "@/services/chat";
import type { AiProviderConfig, ChatSession, ChatSessionSummary } from "@/types";
import {
  buildMessage,
  buildModelOptions,
  collectFilesFromDir,
  getDefaultOptionKey,
  type AttachedFile,
} from "../utils";
import { MessageList } from "./MessageList";
import { ChatInputArea } from "./ChatInputArea";
import { SessionsSidebar } from "./SessionsSidebar";
import { RenameDialog } from "./RenameDialog";
import { FolderFilterDialog } from "./FolderFilterDialog";

interface ChatOverlayProps {
  providers: AiProviderConfig[];
  onClose: () => void;
}

export function ChatOverlay({ providers, onClose }: ChatOverlayProps) {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamRequestId, setStreamRequestId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ChatSessionSummary | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [listLoading, setListLoading] = useState(false);
  const [thinkingBuffer, setThinkingBuffer] = useState("");
  const [thinkingVisible, setThinkingVisible] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [showChatFull, setShowChatFull] = useState(true);
  const [expandedThinkingIds, setExpandedThinkingIds] = useState<Set<string>>(new Set());
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [folderFilter, setFolderFilter] = useState<{ dirPath: string; show: boolean }>({ dirPath: "", show: false });
  const [filterMode, setFilterMode] = useState<"extension" | "filename">("extension");
  const [filterValue, setFilterValue] = useState("");
  const streamBufferRef = useRef<string>("");
  const thinkingBufferRef = useRef<string>("");
  const sessionLoadSeq = useRef(0);
  const activeSessionIdRef = useRef<string | null>(null);
  const activeSessionRef = useRef<ChatSession | null>(null);
  const prevStreamingRef = useRef(false);
  const streamingRef = useRef(false);
  const streamRequestIdRef = useRef<string | null>(null);
  const listenerReadyRef = useRef<Promise<void> | null>(null);
  // single-flight：锁同步建立，连续两次点击/Enter 之间没有渲染，state 判断会双双落空
  const sendLockRef = useRef(false);

  const modelOptions = useMemo(() => buildModelOptions(providers), [providers]);
  const defaultKey = useMemo(() => getDefaultOptionKey(providers), [providers]);
  const effectiveKey = modelOptions.find((o) => o.key === selectedModelKey) ? selectedModelKey : defaultKey;
  const selected = modelOptions.find((o) => o.key === effectiveKey) ?? null;
  const isConfigured = Boolean(selected);
  const confirmDialog = useConfirm();

  useEffect(() => {
    setShowChatFull(true);
    if (activeSessionId && !streamingRef.current) {
      getChatSession(activeSessionId).then((session) => {
        setActiveSession(session);
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    async function loadSessions() {
      setListLoading(true);
      try {
        const list = await listChatSessions();
        setSessions(list);
        if (list.length > 0) {
          setActiveSessionId((prev) => (prev ? prev : list[0].id));
        }
      } catch {
        showToast("error", "加载会话失败");
      } finally {
        setListLoading(false);
      }
    }
    loadSessions();
  }, []);

  useEffect(() => {
    if (streamingRef.current) return;
    async function loadSession() {
      if (!activeSessionId) {
        setActiveSession(null);
        setSessionLoading(false);
        return;
      }
      const seq = ++sessionLoadSeq.current;
      const targetId = activeSessionId;
      activeSessionIdRef.current = targetId;
      setSessionLoading(true);
      setActiveSession((prev) => {
        if (prev && prev.id !== targetId) return null;
        return prev;
      });
      try {
        const session = await getChatSession(targetId);
        if (sessionLoadSeq.current !== seq) return;
        if (activeSessionIdRef.current !== targetId) return;
        if (streamingRef.current) return;
        setActiveSession(session);
      } catch {
        if (sessionLoadSeq.current !== seq) return;
        setActiveSession(null);
      } finally {
        if (sessionLoadSeq.current === seq) {
          setSessionLoading(false);
        }
      }
    }
    loadSession();
  }, [activeSessionId]);

  // 监听器挂载时注册一次，按 requestIdRef 过滤。
  // 原来 keyed on streamRequestId：setState 之后立刻 invoke，effect 要等下一次渲染，
  // `listen()` 本身还是异步的 —— 快速失败 / 非流式秒回会抢在监听器之前到达。
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    listenerReadyRef.current = listen<{ requestId: string; delta?: string; done: boolean; error?: string; thinkingDelta?: string }>("chat-stream", (event) => {
      if (cancelled) return;
      if (event.payload.requestId !== streamRequestIdRef.current) return;
      if (event.payload.error) {
        showToast("error", event.payload.error);
        setStreaming(false);
        streamingRef.current = false;
        setStreamRequestId(null);
        streamRequestIdRef.current = null;
        setThinkingVisible(false);
        streamBufferRef.current = "";
        return;
      }
      if (event.payload.thinkingDelta) {
        thinkingBufferRef.current += event.payload.thinkingDelta;
        setThinkingBuffer(thinkingBufferRef.current);
        setThinkingVisible(true);
      }
      if (event.payload.delta) {
        streamBufferRef.current += event.payload.delta;
        const currentContent = streamBufferRef.current;
        const currentThinking = thinkingBufferRef.current;
        setActiveSession((prev) => {
          if (!prev) return prev;
          if (prev.id !== activeSessionIdRef.current) return prev;
          const updated = { ...prev };
          const messages = [...updated.messages];
          const last = messages[messages.length - 1];
          if (last?.role === "assistant") {
            last.content = currentContent;
            last.thinkingContent = currentThinking || last.thinkingContent;
          } else {
            messages.push(buildMessage("assistant", currentContent, currentThinking));
          }
          updated.messages = messages;
          return updated;
        });
      }
      if (event.payload.done) {
        setStreaming(false);
        streamingRef.current = false;
        setStreamRequestId(null);
        streamRequestIdRef.current = null;
        setThinkingVisible(false);
        streamBufferRef.current = "";
        setExpandedThinkingIds((prev) => {
          if (!activeSessionIdRef.current) return prev;
          const next = new Set(prev);
          next.delete(activeSessionIdRef.current);
          return next;
        });
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      listenerReadyRef.current = null;
    };
  }, []);

  activeSessionRef.current = activeSession;

  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (!wasStreaming || streaming) return;
    const session = activeSessionRef.current;
    if (!session || session.messages.length === 0) return;
    saveChatSession(session)
      .then((saved) => {
        setActiveSession((prev) => {
          if (!prev || prev.id !== saved.id) return prev;
          return saved;
        });
        setSessions((prev) => prev.map((s) => (s.id === saved.id ? { ...s, updatedAt: saved.updatedAt, messageCount: saved.messages.length } : s)));
      })
      .catch(() => {});
  }, [streaming]);

  async function handleCreateSession() {
    if (!selected) return;
    try {
      const session = await createChatSession({
        title: "新会话",
        providerId: selected.providerId,
        modelId: selected.modelId,
      });
      setSessions((prev) => [
        {
          id: session.id,
          title: session.title,
          providerId: session.providerId,
          modelId: session.modelId,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messageCount: session.messages.length,
        },
        ...prev,
      ]);
      setActiveSession(session);
      setActiveSessionId(session.id);
      setInput("");
      setThinkingBuffer("");
      thinkingBufferRef.current = "";
      setThinkingVisible(false);
      setExpandedThinkingIds(new Set());
    } catch {
      showToast("error", "创建会话失败");
    }
  }

  async function handleSelectSession(sessionId: string) {
    if (sessionId === activeSessionId || sessionLoading) return;
    // 切会话前先取消在途请求：否则旧流的 delta 会继续到达，
    // loadSession 又因为 streamingRef 为 true 而跳过加载，
    // 结果是「侧栏选中 B、正文还挂着 A 的内容、streaming 卡住」。
    if (streamingRef.current && streamRequestIdRef.current) {
      await chatCancel(streamRequestIdRef.current).catch(() => {});
      streamingRef.current = false;
      setStreaming(false);
      setStreamRequestId(null);
      streamRequestIdRef.current = null;
      streamBufferRef.current = "";
      thinkingBufferRef.current = "";
    }
    setActiveSessionId(sessionId);
    setInput("");
    setThinkingBuffer("");
    thinkingBufferRef.current = "";
    setThinkingVisible(false);
    setExpandedThinkingIds(new Set());
  }

  async function handleConfirmRename() {
    if (!renameTarget) return;
    const title = renameInput.trim();
    if (!title) {
      showToast("warning", "请输入会话名称");
      return;
    }
    try {
      const updated = await renameChatSession(renameTarget.id, title);
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? { ...s, title: updated.title, updatedAt: updated.updatedAt } : s)));
      if (activeSession?.id === updated.id) {
        setActiveSession(updated);
      }
      setRenameTarget(null);
    } catch {
      showToast("error", "重命名失败");
    }
  }

  async function handleDeleteSession(target: ChatSessionSummary) {
    const ok = await confirmDialog({
      title: "确认删除会话",
      description: <>确认删除会话「<span className="font-medium text-gray-900 dark:text-white">{target.title}</span>」？</>,
      variant: "danger",
      icon: Trash2,
      confirmLabel: "删除",
    });
    if (!ok) return;
    try {
      await deleteChatSession(target.id);
      setSessions((prev) => {
        const remaining = prev.filter((s) => s.id !== target.id);
        if (activeSessionId === target.id) {
          const nextId = remaining[0]?.id ?? null;
          setActiveSessionId(nextId);
          setActiveSession(null);
          setInput("");
          setThinkingBuffer("");
          thinkingBufferRef.current = "";
          setThinkingVisible(false);
          setExpandedThinkingIds(new Set());
        }
        return remaining;
      });
    } catch {
      showToast("error", "删除失败");
    }
  }

  async function handleAttachFiles() {
    try {
      const picked = await dialogOpen({
        multiple: true,
        title: "选择要附加的文件",
        filters: [],
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      const newFiles: AttachedFile[] = [];
      for (const filePath of paths) {
        const p = typeof filePath === "string" ? filePath : (filePath as { path: string }).path;
        try {
          const content = await readTextFile(p);
          const name = p.split("/").pop() ?? p.split("\\").pop() ?? p;
          newFiles.push({ name, content, path: p, enabled: true });
        } catch {
          showToast("warning", `无法读取文件: ${p}`);
        }
      }
      if (newFiles.length > 0) {
        setAttachedFiles((prev) => {
          const next = [...prev, ...newFiles];
          showToast("success", `已附加 ${next.length} 个文件`);
          return next;
        });
      }
    } catch {
      showToast("error", "读取文件失败");
    }
  }

  async function handleAttachFolder() {
    try {
      const picked = await dialogOpen({
        directory: true,
        multiple: false,
        title: "选择要附加的文件夹",
      });
      if (!picked || typeof picked !== "string") return;
      setFolderFilter({ dirPath: picked, show: true });
      setFilterMode("extension");
      setFilterValue("");
    } catch {
      showToast("error", "选择文件夹失败");
    }
  }

  async function handleConfirmFolderFilter() {
    const { dirPath } = folderFilter;
    if (!dirPath) return;

    const extensions = filterMode === "extension" && filterValue.trim()
      ? filterValue.split(",").map((s) => s.trim().toLowerCase().replace(/^\./, "")).filter(Boolean)
      : [];
    const filenamePattern = filterMode === "filename" ? filterValue.trim() : "";

    try {
      const files = await collectFilesFromDir(dirPath, extensions, filenamePattern, filterMode);
      if (files.length === 0) {
        showToast("warning", "未找到匹配的文件");
        return;
      }
      if (files.length > 50) {
        showToast("warning", `匹配到 ${files.length} 个文件，最多附加 50 个`);
      }
      const filesToRead = files.slice(0, 50);
      const newFiles: AttachedFile[] = [];
      const largeFileCount: string[] = [];
      for (const p of filesToRead) {
        try {
          const content = await readTextFile(p);
          const name = p.split("/").pop() ?? p.split("\\").pop() ?? p;
          newFiles.push({ name, content, path: p, enabled: true });
          if (content.length > 5 * 1024 * 1024) {
            largeFileCount.push(name);
          }
        } catch {
          // skip unreadable files
        }
      }
      if (newFiles.length > 0) {
        setAttachedFiles((prev) => [...prev, ...newFiles]);
        const msgs = [`已附加 ${newFiles.length} 个文件`];
        if (largeFileCount.length > 0) {
          msgs.push(`${largeFileCount.length} 个大文件需要较长时间加载`);
        }
        showToast("success", msgs.join("\n"));
      }
    } catch {
      showToast("error", "读取文件夹失败");
    } finally {
      setFolderFilter({ dirPath: "", show: false });
    }
  }

  async function handleSend() {
    if (!activeSession || !selected || (!input.trim() && attachedFiles.filter((f) => f.enabled).length === 0) || streaming) return;
    if (sendLockRef.current) return;
    sendLockRef.current = true;
    try {
      await sendInner();
    } finally {
      sendLockRef.current = false;
    }
  }

  async function sendInner() {
    if (!activeSession || !selected) return;
    const userInput = input.trim();
    const enabledFiles = attachedFiles.filter((f) => f.enabled);

    let content = "";
    const attachmentMeta: Array<{ name: string; path: string }> = [];
    if (enabledFiles.length > 0) {
      for (const file of enabledFiles) {
        content += `[File: ${file.name}]\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
        attachmentMeta.push({ name: file.name, path: file.path });
      }
    }
    if (userInput) {
      content += enabledFiles.length > 0 ? `[User Message]\n${userInput}` : userInput;
    }

    const userMessage = buildMessage("user", content, undefined, attachmentMeta.length > 0 ? attachmentMeta : undefined);
    const nextSession: ChatSession = {
      ...activeSession,
      providerId: selected.providerId,
      modelId: selected.modelId,
      messages: [...activeSession.messages, userMessage],
    };
    setInput("");
    setActiveSession(nextSession);
    setLoading(true);

    try {
      const saved = await saveChatSession(nextSession);
      setActiveSession(saved);
      const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setStreamRequestId(requestId);
      streamRequestIdRef.current = requestId;
      setStreaming(true);
      streamingRef.current = true;
      streamBufferRef.current = "";
      thinkingBufferRef.current = "";
      setThinkingBuffer("");

      // 先确保监听器就位，再发请求
      await listenerReadyRef.current;
      await chatStream({
        requestId,
        providerId: selected.providerId,
        model: selected.model.model,
        baseUrl: selected.baseUrl,
        apiKey: selected.apiKey,
        thinking: selected.model.thinking,
        stream: selected.model.stream !== false,
        messages: saved.messages
          .filter(
            (m) =>
              m.role !== "assistant" ||
              m.content.trim() !== "" ||
              Boolean(m.thinkingContent?.trim()),
          )
          .map((m) => ({
            role: m.role,
            content: m.content,
            thinkingContent: m.thinkingContent ?? undefined,
          })),
      });
    } catch {
      showToast("error", "发送失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    if (!streamRequestId) return;
    await chatCancel(streamRequestId);
    setStreaming(false);
    streamingRef.current = false;
    setStreamRequestId(null);
    setThinkingVisible(false);
    streamBufferRef.current = "";
    thinkingBufferRef.current = "";
  }

  function handleCloseChat() {
    if (streaming && streamRequestId) {
      chatCancel(streamRequestId).catch(() => {});
      setStreaming(false);
      streamingRef.current = false;
      setStreamRequestId(null);
      setThinkingVisible(false);
      streamBufferRef.current = "";
      thinkingBufferRef.current = "";
    }
    const session = activeSessionRef.current;
    if (session && session.messages.length > 0) {
      saveChatSession(session).catch(() => {});
    }
    onClose();
  }

  function handleDeleteMessage(msgId: string) {
    if (!activeSession || streaming) return;
    const updated: ChatSession = {
      ...activeSession,
      messages: activeSession.messages.filter((m) => m.id !== msgId),
    };
    setActiveSession(updated);
    saveChatSession(updated).catch(() => {});
  }

  function handleToggleThinking(msgId: string) {
    setExpandedThinkingIds((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) {
        next.delete(msgId);
      } else {
        next.add(msgId);
      }
      return next;
    });
  }

  return (
    <>
      <div className={`fixed inset-0 z-50 ${showChatFull ? "" : "pointer-events-none"}`}>
        <div
          className={`absolute inset-0 bg-black/30 transition-opacity ${showChatFull ? "opacity-100" : "opacity-0"}`}
          onClick={handleCloseChat}
        />
        <div
          className={`absolute ${showChatFull ? "inset-4" : "bottom-20 right-6 w-[920px] h-[620px]"} bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden transition-all duration-300 ${showChatFull ? "" : "pointer-events-auto"} flex flex-col`}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
            <div className="flex items-center gap-3">
              <div>
                <div className="text-sm font-semibold">验证聊天</div>
                <div className="text-xs text-gray-500">用于快速验证供应商与模型是否可用</div>
              </div>
              {modelOptions.length > 0 && (
                <select
                  className="px-2 py-1 text-xs border border-gray-200 rounded-lg bg-white text-gray-700 max-w-[240px]"
                  value={effectiveKey ?? ""}
                  onChange={(e) => setSelectedModelKey(e.target.value)}
                  disabled={streaming}
                >
                  {modelOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.providerName} / {opt.model.model}{opt.key === defaultKey ? "（默认）" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="text-xs text-gray-500 hover:text-gray-800"
                onClick={() => setShowChatFull((prev) => !prev)}
              >
                {showChatFull ? "缩小" : "全屏"}
              </button>
              <button onClick={handleCloseChat}>
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="flex flex-row flex-1 min-h-0">
            <SessionsSidebar
              sessions={sessions}
              activeSessionId={activeSessionId}
              listLoading={listLoading}
              sessionLoading={sessionLoading}
              isConfigured={isConfigured}
              onCreate={handleCreateSession}
              onSelect={handleSelectSession}
              onRename={(session) => {
                setRenameTarget(session);
                setRenameInput(session.title);
              }}
              onDelete={handleDeleteSession}
            />

            <main className="flex-1 flex flex-col min-h-0 min-w-0">
              {!isConfigured && (
                <div className="p-6">
                  <div className="re-card p-5 space-y-3">
                    <div className="text-sm text-gray-700">尚未配置可用的 AI 供应商</div>
                    <div className="text-xs text-gray-500">请先在"AI"页面配置并启用供应商与模型。</div>
                  </div>
                </div>
              )}

              {isConfigured && !activeSession && (
                <div className="p-6 text-gray-500 text-sm">请选择或新建一个会话</div>
              )}

              {isConfigured && activeSession && (
                <div className="flex-1 flex flex-col min-h-0">
                  <MessageList
                    session={activeSession}
                    streaming={streaming}
                    thinkingVisible={thinkingVisible}
                    thinkingBuffer={thinkingBuffer}
                    expandedThinkingIds={expandedThinkingIds}
                    onToggleThinking={handleToggleThinking}
                    onDeleteMessage={handleDeleteMessage}
                  />
                  <ChatInputArea
                    input={input}
                    attachedFiles={attachedFiles}
                    streaming={streaming}
                    loading={loading}
                    onInputChange={setInput}
                    onSend={handleSend}
                    onStop={handleStop}
                    onAttachFiles={handleAttachFiles}
                    onAttachFolder={handleAttachFolder}
                    onToggleFile={(idx) =>
                      setAttachedFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, enabled: !f.enabled } : f)))
                    }
                    onRemoveFile={(idx) =>
                      setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))
                    }
                  />
                </div>
              )}
            </main>
          </div>
        </div>
      </div>

      {folderFilter.show && (
        <FolderFilterDialog
          dirPath={folderFilter.dirPath}
          mode={filterMode}
          value={filterValue}
          onModeChange={setFilterMode}
          onValueChange={setFilterValue}
          onCancel={() => setFolderFilter({ dirPath: "", show: false })}
          onConfirm={handleConfirmFolderFilter}
        />
      )}

      {renameTarget && (
        <RenameDialog
          value={renameInput}
          onChange={setRenameInput}
          onCancel={() => setRenameTarget(null)}
          onConfirm={handleConfirmRename}
        />
      )}
    </>
  );
}
