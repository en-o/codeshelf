import { useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Trash2 } from "lucide-react";
import { useAiProvidersStore } from "@/stores/aiProvidersStore";
import { useUiStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProjectsStore } from "@/stores/projectsStore";
import { useEditorsStore } from "@/stores/editorsStore";
import { showToast } from "@/components/ui";
import { useConfirm } from "@/components/common";
import {
  createChatSession,
  deleteChatSession,
  getChatSession,
  getGlobalMemory,
  listChatSessions,
  listTools,
  renameChatSession,
  saveChatSession,
} from "@/services/chat";
import type { ToolSchema } from "@/services/chat";
import { useMcpEndpointLookup } from "@/hooks/useMcpEndpointLookup";
import type { ChatAttachment, ChatMessage, ChatSession, ChatSessionSummary, ToolCall } from "@/types";

import { SessionSidebar } from "./components/SessionSidebar";
import { MessageList } from "./components/MessageList";
import { ChatInput } from "./components/ChatInput";
import type { SessionConfigValues } from "./components/SessionConfigPanel";
import type { PendingApproval } from "./components/ToolApprovalDialog";
import { ChatHeader } from "./components/ChatHeader";
import { ChatDialogsHost } from "./components/ChatDialogsHost";
import { AttachmentsPreview } from "./components/AttachmentsPreview";
import { useChatStream } from "./hooks/useChatStream";
import { useProjectContext } from "./hooks/useProjectContext";
import { useChatRunner } from "./hooks/useChatRunner";
import { exportSessionAsJson, exportSessionAsMarkdown, importSessionFromJson } from "./utils/exportSession";
import { compactMessages } from "./utils/compact";
import { type SlashCommandId } from "./utils/slashCommands";
import { resolveMentions, resolveUrls } from "./utils/resolveContext";
import {
  buildModelOptions,
  formatMentionPath,
  getDefaultOptionKey,
  makeMessage,
  newId,
} from "./utils/chatHelpers";

export function ChatPage() {
  const { aiProviders, ensureAiDefaultProvider, saveAiProviders } = useAiProvidersStore();
  const { setCurrentPage, chatNavigateSessionId, clearChatNavigateSession } = useUiStore();
  const { sidebarCollapsed, setSidebarCollapsed } = useSettingsStore();
  const projects = useProjectsStore((s) => s.projects);
  const editors = useEditorsStore((s) => s.editors);

  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ChatSessionSummary | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [configFocus, setConfigFocus] = useState<"system" | "params" | undefined>(undefined);

  const [toolsEnabled, setToolsEnabled] = useState(false);
  const [toolSchemas, setToolSchemas] = useState<ToolSchema[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const [globalMemory, setGlobalMemory] = useState<string>("");
  const [memoryEditorOpen, setMemoryEditorOpen] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [modelManagerOpen, setModelManagerOpen] = useState(false);
  const [modelManagerInitialProviderId, setModelManagerInitialProviderId] = useState<string>("");
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [sessionListCollapsed, setSessionListCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("chat.sessionListCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const approvalResolverRef = useRef<((d: "once" | "always" | "reject") => void) | null>(null);

  useEffect(() => {
    listTools().then(setToolSchemas).catch(() => {});
    getGlobalMemory().then(setGlobalMemory).catch(() => {});
  }, []);

  const activeSessionRef = useRef<ChatSession | null>(null);
  activeSessionRef.current = activeSession;
  const modelSelectRef = useRef<HTMLSelectElement>(null);
  const mentionContextRef = useRef<string>("");
  // single-flight：所有"会发起一次请求"的入口共用这一把**同步**锁。
  //
  // 只看 `streaming`/`loading` 这两个 state 不够：handleSend 在 setLoading(true) 之前
  // 先 await 了 URL 抓取（可能几秒），这段时间里两次点击 / 两次 Enter 会双双通过判断，
  // 然后覆盖同一份 requestId、buffer 和 callbacks，并且重复计费。
  // ref 在同一个事件循环里就能看见写入，没有渲染间隙。
  const sendLockRef = useRef(false);

  /** 入口统一包一层：锁在**任何 await 之前**同步建立，finally 里释放。 */
  async function withSendLock(fn: () => Promise<void>): Promise<void> {
    if (sendLockRef.current) return;
    sendLockRef.current = true;
    try {
      await fn();
    } finally {
      sendLockRef.current = false;
    }
  }

  const { streaming, thinkingBuffer, start: startStream, stop: stopStream } = useChatStream();

  const endpointLookup = useMcpEndpointLookup();
  const confirmDialog = useConfirm();

  const normalized = useMemo(() => ensureAiDefaultProvider(aiProviders), [aiProviders, ensureAiDefaultProvider]);
  const modelOptions = useMemo(() => buildModelOptions(normalized), [normalized]);
  const defaultKey = useMemo(() => getDefaultOptionKey(normalized), [normalized]);

  const effectiveKey = modelOptions.find((o) => o.key === selectedModelKey) ? selectedModelKey : defaultKey;
  const selected = modelOptions.find((o) => o.key === effectiveKey) ?? null;
  const isConfigured = Boolean(selected);

  const userHistory = useMemo(() => {
    if (!activeSession) return [];
    return activeSession.messages
      .filter((m) => m.role === "user" && m.content.trim())
      .map((m) => m.content)
      .reverse();
  }, [activeSession]);

  const projectContextRef = useProjectContext(activeSession?.id, activeSession?.allowedCwd);

  function syncSummary(session: ChatSession) {
    setSessions((prev) => {
      const exists = prev.find((s) => s.id === session.id);
      const summary: ChatSessionSummary = {
        id: session.id,
        title: session.title,
        providerId: session.providerId,
        modelId: session.modelId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
        pinned: session.pinned,
      };
      if (exists) return prev.map((s) => (s.id === session.id ? summary : s));
      return [summary, ...prev];
    });
  }

  async function persistSession(session: ChatSession): Promise<ChatSession> {
    const saved = await saveChatSession(session);
    setActiveSession(saved);
    syncSummary(saved);
    return saved;
  }

  function requestApproval(call: ToolCall): Promise<"once" | "always" | "reject"> {
    return new Promise((resolve) => {
      approvalResolverRef.current = resolve;
      setPendingApproval({ id: call.id, name: call.name, argumentsJson: call.arguments });
    });
  }

  function handleApprovalDecision(decision: "once" | "always" | "reject") {
    const fn = approvalResolverRef.current;
    approvalResolverRef.current = null;
    setPendingApproval(null);
    fn?.(decision);
  }

  const { runChatRequest } = useChatRunner({
    toolSchemas,
    toolsEnabled,
    globalMemory,
    editors,
    selected,
    projectContextRef,
    mentionContextRef,
    activeSessionRef,
    setActiveSession,
    syncSummary,
    startStream,
    requestApproval,
  });

  // 加载会话列表
  useEffect(() => {
    async function load() {
      setListLoading(true);
      try {
        const list = await listChatSessions();
        setSessions(list);
        if (list.length > 0) {
          setActiveSessionId((prev) => prev ?? list[0].id);
        }
      } catch {
        showToast("error", "加载会话失败");
      } finally {
        setListLoading(false);
      }
    }
    load();
  }, []);

  // 加载选中会话
  useEffect(() => {
    async function load() {
      if (!activeSessionId) {
        setActiveSession(null);
        return;
      }
      setSessionLoading(true);
      try {
        const session = await getChatSession(activeSessionId);
        setActiveSession(session);
      } catch {
        setActiveSession(null);
      } finally {
        setSessionLoading(false);
      }
    }
    load();
  }, [activeSessionId]);

  useEffect(() => {
    if (!chatNavigateSessionId) return;
    setActiveSessionId(chatNavigateSessionId);
    setInput("");
    clearChatNavigateSession();
  }, [chatNavigateSessionId, clearChatNavigateSession]);

  // 组件卸载时保存当前会话
  useEffect(() => {
    return () => {
      const session = activeSessionRef.current;
      if (session && session.messages.length > 0) {
        saveChatSession(session).catch(() => {});
      }
    };
  }, []);

  async function handleCreateSession() {
    if (!selected) {
      showToast("warning", "请先在 AI 页面配置可用的供应商与模型");
      setCurrentPage("aiProviders");
      return;
    }
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
          pinned: session.pinned,
        },
        ...prev,
      ]);
      setActiveSession(session);
      setActiveSessionId(session.id);
      setInput("");
    } catch {
      showToast("error", "创建会话失败");
    }
  }

  async function handleSelectSession(id: string) {
    if (id === activeSessionId || sessionLoading) return;
    setActiveSessionId(id);
    setInput("");
  }

  async function handleRenameSession(session: ChatSessionSummary) {
    setRenameTarget(session);
  }

  async function confirmRename(title: string) {
    if (!renameTarget) return;
    try {
      const updated = await renameChatSession(renameTarget.id, title);
      syncSummary(updated);
      if (activeSession?.id === updated.id) setActiveSession(updated);
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
      setSessions((prev) => prev.filter((s) => s.id !== target.id));
      if (activeSessionId === target.id) {
        const remaining = sessions.filter((s) => s.id !== target.id);
        const nextId = remaining[0]?.id ?? null;
        setActiveSessionId(nextId);
        if (!nextId) setActiveSession(null);
      }
    } catch {
      showToast("error", "删除失败");
    }
  }

  async function handleTogglePin(target: ChatSessionSummary) {
    try {
      const isActive = activeSession?.id === target.id;
      const full = isActive && activeSession ? activeSession : await getChatSession(target.id);
      const next: ChatSession = { ...full, pinned: !full.pinned };
      const saved = await saveChatSession(next);
      // 置顶别人的会话**不能**改当前会话：persistSession 会 setActiveSession(saved)，
      // 而 activeSessionId 还指着原来那条 —— 侧栏高亮、正文内容和发送目标就此分家。
      if (isActive) setActiveSession(saved);
      syncSummary(saved);
    } catch {
      showToast("error", "操作失败");
    }
  }

  async function handleExport(target: ChatSessionSummary) {
    try {
      const full = activeSession?.id === target.id ? activeSession : await getChatSession(target.id);
      const ok = await exportSessionAsMarkdown(full);
      if (ok) showToast("success", "已导出为 Markdown");
    } catch {
      showToast("error", "导出失败");
    }
  }

  async function handleImport() {
    try {
      const parsed = await importSessionFromJson();
      if (!parsed) return;

      // 导出文件里带着原会话 ID，而 saveChatSession 是按 ID upsert（后端会先删干净
      // 现有 messages/tools 再写入）。导出后继续聊天、再导入这个旧文件，
      // 新增的消息会被无声抹掉还提示「导入成功」。
      // 所以：**默认一律分配新 ID**，同一个文件导入两次得到两个独立会话。
      const existing = sessions.find((s) => s.id === parsed.id);
      let replace = false;

      if (existing) {
        replace = await confirmDialog({
          title: "检测到同 ID 会话",
          variant: "danger",
          confirmLabel: "替换现有会话",
          cancelLabel: "新建副本",
          description: (
            <div className="space-y-2 text-sm">
              <p>导入文件与现有会话使用同一个 ID，请选择处理方式：</p>
              <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-1 font-mono text-xs">
                <span />
                <span className="font-semibold">现有</span>
                <span className="font-semibold">导入文件</span>
                <span className="text-gray-500">标题</span>
                <span className="truncate">{existing.title}</span>
                <span className="truncate">{parsed.title}</span>
                <span className="text-gray-500">消息数</span>
                <span>{existing.messageCount}</span>
                <span>{parsed.messages.length}</span>
                <span className="text-gray-500">更新时间</span>
                <span>{existing.updatedAt}</span>
                <span>{parsed.updatedAt ?? "—"}</span>
              </div>
            </div>
          ),
        });
      }

      if (replace) {
        const confirmed = await confirmDialog({
          title: "确认替换？",
          variant: "danger",
          confirmLabel: "确认替换",
          cancelLabel: "取消导入",
          description: `现有的 ${existing?.messageCount ?? 0} 条消息将被导入文件的 ${parsed.messages.length} 条覆盖。`,
          notice: "替换前会自动把现有会话另存为一条独立会话，可随时翻回。",
        });
        // 取消 = 什么都没写，数据库与导入前完全一致
        if (!confirmed) return;

        // 覆盖前先原样另存一份。不引入新的备份文件格式 ——
        // 复用 saveChatSession 存成普通会话就够了，用户在侧栏直接能看到。
        const current = await getChatSession(parsed.id);
        const backup = await saveChatSession({
          ...current,
          id: newId(),
          title: `${current.title}（替换前备份）`,
          pinned: false,
        });
        syncSummary(backup);

        const saved = await saveChatSession(parsed);
        syncSummary(saved);
        setActiveSessionId(saved.id);
        showToast("success", "已替换", `原会话已备份为「${backup.title}」`);
        return;
      }

      const copy = await saveChatSession({ ...parsed, id: newId() });
      syncSummary(copy);
      setActiveSessionId(copy.id);
      showToast("success", "导入成功", existing ? "已作为独立会话导入，未改动现有会话" : undefined);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "导入失败");
    }
  }

  async function handleSend() {
    if (!activeSession || !selected || streaming) return;
    if (!input.trim() && pendingAttachments.length === 0) return;
    await withSendLock(async () => {
      const content = input.trim();
      const [mentions, urls] = await Promise.all([
        resolveMentions(content, activeSession.allowedCwd),
        resolveUrls(content, activeSession.id),
      ]);
      mentionContextRef.current = [mentions, urls].filter((s) => s.trim()).join("\n\n---\n\n");
      const userMessage = makeMessage("user", content, {
        attachments: pendingAttachments.length ? pendingAttachments : undefined,
      });
      const nextSession: ChatSession = {
        ...activeSession,
        providerId: selected.providerId,
        modelId: selected.modelId,
        messages: [...activeSession.messages, userMessage],
      };
      setInput("");
      setPendingAttachments([]);
      setLoading(true);
      try {
        const saved = await persistSession(nextSession);
        await runChatRequest(saved);
      } finally {
        setLoading(false);
      }
    });
  }

  async function handleStop() {
    await stopStream();
    const session = activeSessionRef.current;
    if (session && session.messages.length > 0) {
      try {
        const saved = await saveChatSession(session);
        setActiveSession(saved);
        syncSummary(saved);
      } catch {
        /* ignore */
      }
    }
  }

  async function handleDeleteMessage(msg: ChatMessage) {
    if (!activeSession || streaming) return;
    const updated: ChatSession = {
      ...activeSession,
      messages: activeSession.messages.filter((m) => m.id !== msg.id),
    };
    await persistSession(updated);
  }

  async function handlePickAllowedCwd() {
    if (!activeSession) return;
    try {
      const picked = await openDialog({ directory: true, multiple: false, title: "选择允许工具操作的目录" });
      if (!picked || Array.isArray(picked)) return;
      const nextSession: ChatSession = { ...activeSession, allowedCwd: picked as string };
      await persistSession(nextSession);
      showToast("success", "已设置目录");
    } catch {
      showToast("error", "设置失败");
    }
  }

  function handleCopyMessage(msg: ChatMessage) {
    try {
      navigator.clipboard.writeText(msg.content);
      showToast("success", "已复制");
    } catch {
      showToast("error", "复制失败");
    }
  }

  async function handleEditUserMessage(msg: ChatMessage, newContent: string) {
    if (!activeSession || !selected || streaming) return;
    const idx = activeSession.messages.findIndex((m) => m.id === msg.id);
    if (idx < 0) return;
    await withSendLock(async () => {
      const appended = makeMessage("user", newContent, {
        attachments: msg.attachments,
      });
      const nextSession: ChatSession = {
        ...activeSession,
        messages: [...activeSession.messages, appended],
      };
      const saved = await persistSession(nextSession);
      await runChatRequest(saved);
    });
  }

  async function handleRegenerateAssistant(msg: ChatMessage) {
    if (!activeSession || !selected || streaming) return;
    const idx = activeSession.messages.findIndex((m) => m.id === msg.id);
    if (idx < 0) return;
    const prevUser = [...activeSession.messages.slice(0, idx)].reverse().find((m) => m.role === "user");
    if (!prevUser) return;
    await withSendLock(async () => {
      const appended = makeMessage("user", prevUser.content, {
        attachments: prevUser.attachments,
      });
      const nextSession: ChatSession = {
        ...activeSession,
        messages: [...activeSession.messages, appended],
      };
      const saved = await persistSession(nextSession);
      await runChatRequest(saved);
    });
  }

  async function handleRetryUserMessage(msg: ChatMessage) {
    if (!activeSession || !selected || streaming) return;
    if (msg.role !== "user") return;
    const idx = activeSession.messages.findIndex((m) => m.id === msg.id);
    if (idx < 0) return;
    await withSendLock(async () => {
      const appended = makeMessage("user", msg.content, {
        attachments: msg.attachments,
      });
      const nextSession: ChatSession = {
        ...activeSession,
        messages: [...activeSession.messages, appended],
      };
      const saved = await persistSession(nextSession);
      await runChatRequest(saved);
    });
  }

  async function handleClearMessages() {
    if (!activeSession) return;
    const cleared: ChatSession = { ...activeSession, messages: [] };
    await persistSession(cleared);
    showToast("success", "已清空当前会话");
  }

  async function handleCompact() {
    if (!activeSession || !selected || streaming) return;
    if (activeSession.messages.length < 6) {
      showToast("warning", "消息太少，无需压缩");
      return;
    }
    setLoading(true);
    try {
      const res = await compactMessages({
        session: activeSession,
        providerId: selected.providerId,
        model: selected.model.model,
        baseUrl: selected.baseUrl,
        apiKey: selected.apiKey,
        protocol: selected.protocol,
      });
      const next: ChatSession = { ...activeSession, currentCompactionVersion: res.version };
      await persistSession(next);
      showToast("success", `已压缩到 ${res.version}（覆盖 ${res.sourceMessageCount} 条早期消息）`);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "压缩失败");
    } finally {
      setLoading(false);
    }
  }

  function handleSaveConfig(values: SessionConfigValues) {
    if (!activeSession) return;
    const nextSession: ChatSession = {
      ...activeSession,
      systemPrompt: values.systemPrompt.trim() || undefined,
      temperature: values.temperature ?? undefined,
      maxTokens: values.maxTokens ?? undefined,
      topP: values.topP ?? undefined,
      frequencyPenalty: values.frequencyPenalty ?? undefined,
      presencePenalty: values.presencePenalty ?? undefined,
    };
    persistSession(nextSession)
      .then(() => {
        setConfigOpen(false);
        showToast("success", "设置已保存");
      })
      .catch(() => showToast("error", "保存失败"));
  }

  async function handleSlashCommand(id: SlashCommandId) {
    switch (id) {
      case "clear":
        await handleClearMessages();
        break;
      case "new":
        await handleCreateSession();
        break;
      case "export": {
        const s = activeSessionRef.current;
        if (!s) return;
        try {
          if (await exportSessionAsMarkdown(s)) showToast("success", "已导出为 Markdown");
        } catch {
          showToast("error", "导出失败");
        }
        break;
      }
      case "exportJson": {
        const s = activeSessionRef.current;
        if (!s) return;
        try {
          if (await exportSessionAsJson(s)) showToast("success", "已导出为 JSON");
        } catch {
          showToast("error", "导出失败");
        }
        break;
      }
      case "import":
        await handleImport();
        break;
      case "system":
        setConfigFocus("system");
        setConfigOpen(true);
        break;
      case "config":
        setConfigFocus("params");
        setConfigOpen(true);
        break;
      case "model":
        modelSelectRef.current?.focus();
        break;
      case "regenerate": {
        const session = activeSessionRef.current;
        if (!session) return;
        const last = [...session.messages].reverse().find((m) => m.role === "assistant");
        if (!last) {
          showToast("warning", "没有可重新生成的消息");
          return;
        }
        await handleRegenerateAssistant(last);
        break;
      }
      case "compact":
        await handleCompact();
        break;
      case "skills":
        setSkillsOpen(true);
        break;
      case "tool":
        setToolPickerOpen(true);
        break;
      case "help":
        showToast(
          "info",
          "/clear 清空 · /new 新会话 · /export 导出 md · /system 系统提示 · /config 参数 · /regen 重生成 · /tool 选工具",
        );
        break;
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <ChatHeader
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeSession={activeSession}
        modelOptions={modelOptions}
        defaultKey={defaultKey}
        effectiveKey={effectiveKey}
        streaming={streaming}
        loading={loading}
        toolsEnabled={toolsEnabled}
        toolSchemas={toolSchemas}
        projects={projects}
        globalMemory={globalMemory}
        modelSelectRef={modelSelectRef}
        onSelectModel={setSelectedModelKey}
        onOpenModelManager={() => {
          setModelManagerInitialProviderId(normalized.filter((p) => p.enabled)[0]?.id ?? "");
          setModelManagerOpen(true);
        }}
        onSetToolsEnabled={setToolsEnabled}
        onPersistSession={persistSession}
        onPickAllowedCwd={handlePickAllowedCwd}
        onCompact={handleCompact}
        onOpenMemory={(draft) => { setMemoryDraft(draft); setMemoryEditorOpen(true); }}
        onOpenSkills={() => setSkillsOpen(true)}
        onOpenTaskPanel={() => setTaskPanelOpen((v) => !v)}
        onOpenConfig={() => { setConfigFocus(undefined); setConfigOpen(true); }}
      />

      <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
        <SessionSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          isSwitching={sessionLoading}
          isConfigured={isConfigured}
          loading={listLoading}
          collapsed={sessionListCollapsed}
          onToggleCollapsed={() => {
            setSessionListCollapsed((prev) => {
              const next = !prev;
              try {
                localStorage.setItem("chat.sessionListCollapsed", next ? "1" : "0");
              } catch {
                /* ignore */
              }
              return next;
            });
          }}
          onCreate={handleCreateSession}
          onImport={handleImport}
          onSelect={handleSelectSession}
          onRename={handleRenameSession}
          onDelete={handleDeleteSession}
          onTogglePin={handleTogglePin}
          onExport={handleExport}
        />

        <main className="flex-1 p-5 space-y-4 min-h-0 min-w-0 overflow-hidden">
          {!isConfigured && (
            <div className="re-card p-5 space-y-3">
              <div className="text-sm text-gray-700">尚未配置可用的 AI 供应商</div>
              <div className="text-xs text-gray-500">请先在"AI"页面配置并启用供应商与模型。</div>
              <button
                className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded-lg"
                onClick={() => setCurrentPage("aiProviders")}
              >
                去配置
              </button>
            </div>
          )}

          {isConfigured && !activeSession && (
            <div className="re-card p-5 space-y-2 text-gray-500 text-sm">请选择或新建一个会话</div>
          )}

          {isConfigured && activeSession && (
            <div className="flex flex-col h-full min-w-0">
              {activeSession.systemPrompt && (
                <div className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-3 truncate">
                  <span className="font-semibold text-gray-600">System:</span> {activeSession.systemPrompt}
                </div>
              )}
              <MessageList
                messages={activeSession.messages}
                streaming={streaming}
                thinkingBuffer={thinkingBuffer}
                onCopy={handleCopyMessage}
                onEditUser={handleEditUserMessage}
                onRegenerateAssistant={handleRegenerateAssistant}
                onRetryUser={handleRetryUserMessage}
                onDelete={handleDeleteMessage}
                endpointLookup={endpointLookup}
              />
              <ChatInput
                value={input}
                onChange={setInput}
                onSend={handleSend}
                onStop={handleStop}
                onSlashCommand={handleSlashCommand}
                streaming={streaming}
                disabled={loading}
                userHistory={userHistory}
                mentionRoot={activeSession.allowedCwd ?? null}
                onImagePaste={(dataUrl) =>
                  setPendingAttachments((prev) => [...prev, { kind: "image", dataUrl }])
                }
                onFilesDropped={(files) => {
                  setPendingAttachments((prev) => {
                    const next = [...prev];
                    for (const f of files) {
                      if (f.kind === "image" && f.dataUrl) {
                        next.push({ kind: "image", dataUrl: f.dataUrl, name: f.name });
                      } else if (f.kind === "text" && typeof f.content === "string") {
                        next.push({ kind: "text", name: f.name, content: f.content });
                      }
                    }
                    return next;
                  });
                }}
                attachmentsSlot={
                  <AttachmentsPreview
                    attachments={pendingAttachments}
                    onRemove={(idx) => setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))}
                  />
                }
              />
            </div>
          )}
        </main>
      </div>

      <ChatDialogsHost
        renameOpen={Boolean(renameTarget)}
        renameInitial={renameTarget?.title ?? ""}
        onRenameCancel={() => setRenameTarget(null)}
        onRenameConfirm={confirmRename}
        configOpen={configOpen}
        configFocus={configFocus}
        activeSession={activeSession}
        onConfigClose={() => setConfigOpen(false)}
        onConfigSave={handleSaveConfig}
        pendingApproval={pendingApproval}
        onApprovalDecide={handleApprovalDecision}
        taskPanelOpen={taskPanelOpen}
        onTaskPanelClose={() => setTaskPanelOpen(false)}
        skillsOpen={skillsOpen}
        onSkillsClose={() => setSkillsOpen(false)}
        onSkillsSelect={(rendered) => setInput((prev) => (prev.trim() ? `${prev}\n\n${rendered}` : rendered))}
        toolPickerOpen={toolPickerOpen}
        toolSchemas={toolSchemas}
        onToolPickerClose={() => setToolPickerOpen(false)}
        onToolPickerInsertHint={(hint) => setInput((prev) => (prev.trim() ? `${prev}\n\n${hint}` : hint))}
        onToolPickerExecuted={async (toolName, argumentsJson, result) => {
          const session = activeSessionRef.current;
          if (!session) return;
          const callId = typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const assistantMsg = makeMessage("assistant", "", {
            toolCalls: [{ id: callId, name: toolName, arguments: argumentsJson }],
          });
          const toolMsg = makeMessage("tool", result, {
            toolCallId: callId,
            toolName,
          });
          const next: ChatSession = {
            ...session,
            messages: [...session.messages, assistantMsg, toolMsg],
          };
          try {
            await persistSession(next);
          } catch {
            showToast("error", "保存消息失败");
          }
        }}
        mentionOpen={mentionOpen}
        onMentionClose={() => setMentionOpen(false)}
        onMentionPick={(paths) => {
          const snippet = paths.map(formatMentionPath).join(" ");
          setInput((prev) => (prev.trim() ? `${prev} ${snippet}` : snippet));
        }}
        modelManagerOpen={modelManagerOpen}
        modelManagerInitialProviderId={modelManagerInitialProviderId}
        aiProviders={aiProviders}
        normalized={normalized}
        saveAiProviders={saveAiProviders}
        onModelManagerClose={() => setModelManagerOpen(false)}
        onGoToProviders={() => setCurrentPage("aiProviders")}
        memoryEditorOpen={memoryEditorOpen}
        memoryDraft={memoryDraft}
        onMemoryDraftChange={setMemoryDraft}
        onMemoryClose={() => setMemoryEditorOpen(false)}
        onMemorySaved={(saved) => {
          setGlobalMemory(saved);
          setMemoryEditorOpen(false);
        }}
      />
    </div>
  );
}
