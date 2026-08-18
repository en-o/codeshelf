import { useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { ExternalLink, FolderOpen, Loader2, PanelsTopLeft, Square, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/common";
import { useConfirm } from "@/components/common";
import { showToast } from "@/components/ui";
import { useAiProvidersStore } from "@/stores/aiProvidersStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import {
  createChatSession,
  deleteChatSession,
  getChatSession,
  listChatSessions,
  renameChatSession,
  saveChatSession,
} from "@/services/chat";
import {
  dshEngineStatus,
  dshEnvStatus,
  dshWebOpen,
  dshWebStop,
  listenDshWebLog,
  type DshEnvStatus,
} from "@/services/dsh";
import type { AiProviderConfig, ChatMessage, ChatSession, ChatSessionSummary } from "@/types";
import type { DshProviderSpec } from "@/services/dsh";

import { SessionSidebar } from "../Chat/components/SessionSidebar";
import { MessageList } from "../Chat/components/MessageList";
import { ChatInput } from "../Chat/components/ChatInput";
import { RenameDialog } from "../Chat/components/RenameDialog";
import { useDshRunner } from "./useDshRunner";
import { exportSessionAsMarkdown } from "../Chat/utils/exportSession";
import { buildModelOptions, getDefaultOptionKey, makeMessage } from "../Chat/utils/chatHelpers";

/**
 * 供应商 → dsh 侧的模型路由。
 *
 * dsh 的 profile 里声明了四条：deepseek-official（它自带的 DeepSeek 适配器）、
 * openai / anthropic（pi-ai 自带目录，端点与模型清单都有默认值）、
 * codeshelf（手工声明的 OpenAI 兼容路由，端点和型号由应用注入）。
 *
 * 认不出来的一律走 codeshelf —— 兼容端点是最常见的情况，
 * 而错进 deepseek-official 会用 DeepSeek 专用适配器去打别人的接口。
 */
/**
 * CodeShelf 的供应商 → dsh 的模型路由。
 *
 * 每个启用的供应商各生成一条，带自己的端点、密钥引用和模型清单 ——
 * 这样 dsh（包括它自己的界面）里的模型下拉，就等于「模型」页里配的那些，
 * 且选哪个用哪个的凭据。全量传是必须的：只传选中那个的话，
 * 在 dsh 界面里换个模型就会拿错家的地址去打。
 */
function toDshProviders(providers: AiProviderConfig[]): DshProviderSpec[] {
  return providers
    .filter((p) => p.enabled)
    .map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey ?? null,
      // Claude 是自己的协议，其余按 OpenAI 兼容
      api:
        p.presetKey === "anthropic" || /(^|\.)anthropic\.com/i.test(p.baseUrl)
          ? "anthropic-messages"
          : "openai-completions",
      models: p.models.filter((m) => m.enabled).map((m) => m.model),
    }))
    .filter((p) => p.models.length > 0);
}

/**
 * dsh 页：DeepSeek Harness 自己的一块地方。
 *
 * 会话存储与「对话」页共用一套（chat_sessions），靠 `engine` 字段分流 ——
 * 两边各列各的，互不串台，也不用为 dsh 另起一套会话表 / 导入导出 / 搜索。
 * 消息列表、输入框、会话侧栏都直接复用 Chat 的组件。
 */
export function DshPage() {
  const { aiProviders, ensureAiDefaultProvider } = useAiProvidersStore();
  const { sidebarCollapsed, setSidebarCollapsed } = useSettingsStore();
  const setCurrentPage = useUiStore((s) => s.setCurrentPage);
  const confirmDialog = useConfirm();

  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [input, setInput] = useState("");
  const [selectedModelKey, setSelectedModelKey] = useState<string>("");
  const [env, setEnv] = useState<DshEnvStatus | null>(null);
  const [enginePid, setEnginePid] = useState<number | null>(null);
  const [renameTarget, setRenameTarget] = useState<ChatSessionSummary | null>(null);
  const [webOpening, setWebOpening] = useState(false);
  /** "native" = CodeShelf 自己的会话界面；"official" = 内嵌 dsh 官方界面 */
  const [view, setView] = useState<"native" | "official">("native");
  const [webUrl, setWebUrl] = useState<string | null>(null);
  const [webLog, setWebLog] = useState<string>("");

  const activeSessionRef = useRef<ChatSession | null>(null);
  activeSessionRef.current = activeSession;
  /** 发送锁同步建立：state 要等下一次渲染，连点两次会双双通过判断 */
  const sendLockRef = useRef(false);

  const normalized = useMemo(() => ensureAiDefaultProvider(aiProviders), [aiProviders, ensureAiDefaultProvider]);
  const modelOptions = useMemo(() => buildModelOptions(normalized), [normalized]);
  const defaultKey = useMemo(() => getDefaultOptionKey(normalized), [normalized]);
  const effectiveKey = modelOptions.find((o) => o.key === selectedModelKey) ? selectedModelKey : defaultKey;
  const selected = modelOptions.find((o) => o.key === effectiveKey) ?? null;

  function syncSummary(session: ChatSession) {
    setSessions((prev) => {
      const summary: ChatSessionSummary = {
        id: session.id,
        title: session.title,
        providerId: session.providerId,
        modelId: session.modelId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
        pinned: session.pinned,
        engine: session.engine,
      };
      const exists = prev.find((s) => s.id === session.id);
      if (exists) return prev.map((s) => (s.id === session.id ? summary : s));
      return [summary, ...prev];
    });
  }

  const dshProviders = useMemo(() => toDshProviders(normalized), [normalized]);

  const { runDshRequest, stopDsh, dshRunning } = useDshRunner({
    selected,
    dshProviders,
    activeSessionRef,
    setActiveSession,
    syncSummary,
  });

  const ready = !!env?.installed && !!env?.profileReady && !!env?.nodeOk;

  useEffect(() => {
    dshEnvStatus().then(setEnv).catch(() => setEnv(null));
    dshEngineStatus()
      .then((s) => setEnginePid(s.running ? s.pid : null))
      .catch(() => setEnginePid(null));
  }, []);

  useEffect(() => {
    const un = listenDshWebLog((line) => {
      // 只留最后一行：这里是给「启动中」当进度提示用的，不做完整日志面板
      setWebLog(line);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // 引擎状态只在运行态变化时对一次，避免常驻轮询空转 IPC
  useEffect(() => {
    dshEngineStatus()
      .then((s) => setEnginePid(s.running ? s.pid : null))
      .catch(() => setEnginePid(null));
  }, [dshRunning]);

  useEffect(() => {
    async function load() {
      setListLoading(true);
      try {
        const all = await listChatSessions();
        const mine = all.filter((s) => s.engine === "dsh");
        setSessions(mine);
        setActiveSessionId((prev) => prev ?? mine[0]?.id ?? null);
      } catch {
        showToast("error", "加载 dsh 会话失败");
      } finally {
        setListLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (!activeSessionId) {
      setActiveSession(null);
      return;
    }
    let cancelled = false;
    setSessionLoading(true);
    getChatSession(activeSessionId)
      .then((s) => {
        if (!cancelled) setActiveSession(s);
      })
      .catch(() => {
        if (!cancelled) showToast("error", "加载会话失败");
      })
      .finally(() => {
        if (!cancelled) setSessionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  async function persistSession(session: ChatSession): Promise<ChatSession> {
    const saved = await saveChatSession(session);
    setActiveSession(saved);
    syncSummary(saved);
    return saved;
  }

  async function handleCreateSession() {
    if (!selected) {
      showToast("warning", "请先在「模型」页配置可用的供应商与模型");
      setCurrentPage("aiProviders");
      return;
    }
    try {
      const session = await createChatSession({
        title: "新会话",
        providerId: selected.providerId,
        modelId: selected.modelId,
        // 一次调用就落库带 engine：分两步写会在中途失败时留下一条串到「对话」页的会话
        engine: "dsh",
      });
      syncSummary(session);
      setActiveSessionId(session.id);
      setActiveSession(session);
    } catch {
      showToast("error", "创建会话失败");
    }
  }

  async function handlePickCwd() {
    if (!activeSession) return;
    const picked = await openDialog({ directory: true, multiple: false, title: "选择 dsh 的工作目录" });
    if (!picked || Array.isArray(picked)) return;
    await persistSession({ ...activeSession, allowedCwd: picked as string });
    showToast("success", "已设置工作目录");
  }

  async function handleSend() {
    if (!activeSession || !selected || dshRunning) return;
    if (!input.trim()) return;
    if (sendLockRef.current) return;
    sendLockRef.current = true;
    try {
      const content = input.trim();
      const next: ChatSession = {
        ...activeSession,
        providerId: selected.providerId,
        modelId: selected.modelId,
        messages: [...activeSession.messages, makeMessage("user", content)],
      };
      setInput("");
      const saved = await persistSession(next);
      await runDshRequest(saved);
    } finally {
      sendLockRef.current = false;
    }
  }

  async function handleRetryUser(msg: ChatMessage) {
    if (!activeSession || dshRunning) return;
    const next: ChatSession = {
      ...activeSession,
      messages: [...activeSession.messages, makeMessage("user", msg.content)],
    };
    const saved = await persistSession(next);
    await runDshRequest(saved);
  }

  async function handleDeleteMessage(msg: ChatMessage) {
    if (!activeSession || dshRunning) return;
    await persistSession({
      ...activeSession,
      messages: activeSession.messages.filter((m) => m.id !== msg.id),
    });
  }

  async function handleDeleteSession(target: ChatSessionSummary) {
    const ok = await confirmDialog({
      title: "确认删除会话",
      description: <>确认删除会话「<span className="font-medium text-gray-900">{target.title}</span>」？</>,
      variant: "danger",
      icon: Trash2,
      confirmLabel: "删除",
    });
    if (!ok) return;
    try {
      await deleteChatSession(target.id);
      const remaining = sessions.filter((s) => s.id !== target.id);
      setSessions(remaining);
      if (activeSessionId === target.id) setActiveSessionId(remaining[0]?.id ?? null);
    } catch {
      showToast("error", "删除失败");
    }
  }

  async function confirmRename(title: string) {
    if (!renameTarget) return;
    try {
      const updated = await renameChatSession(renameTarget.id, title);
      syncSummary(updated);
      if (activeSession?.id === updated.id) setActiveSession(updated);
    } catch {
      showToast("error", "重命名失败");
    } finally {
      setRenameTarget(null);
    }
  }

  async function handleTogglePin(target: ChatSessionSummary) {
    try {
      const isActive = activeSession?.id === target.id;
      const full = isActive && activeSession ? activeSession : await getChatSession(target.id);
      const saved = await saveChatSession({ ...full, pinned: !full.pinned });
      // 只有置顶的是当前会话时才动 activeSession，否则侧栏高亮和正文会指向两条会话
      if (isActive) setActiveSession(saved);
      syncSummary(saved);
    } catch {
      showToast("error", "操作失败");
    }
  }

  async function handleExport(target: ChatSessionSummary) {
    try {
      const full = activeSession?.id === target.id ? activeSession : await getChatSession(target.id);
      if (await exportSessionAsMarkdown(full)) showToast("success", "已导出为 Markdown");
    } catch {
      showToast("error", "导出失败");
    }
  }

  /**
   * 切到官方界面：起 dsh web 并把地址塞给 iframe。
   * 传的是与引擎同一份供应商配置 —— 官方界面里用的就是这里选的模型，
   * 不用再去它自己的设置里填一遍 DeepSeek 的 key。
   */
  async function handleOpenOfficialUi() {
    if (!selected) {
      showToast("warning", "请先在「模型」页配置可用的供应商与模型");
      return;
    }
    setView("official");
    if (webUrl) return;
    setWebOpening(true);
    setWebLog("");
    try {
      const status = await dshWebOpen({
        cwd: activeSession?.allowedCwd ?? "",
        providerId: selected.providerId,
        model: selected.model.model,
        providers: dshProviders,
      });
      setWebUrl(status.url);
    } catch (e) {
      const text = typeof e === "string" && e ? e : e instanceof Error ? e.message : "启动失败";
      showToast("error", "官方界面启动失败", text);
      setView("native");
    } finally {
      setWebOpening(false);
    }
  }

  async function handleStopWeb() {
    await dshWebStop().catch(() => {});
    setWebUrl(null);
    setView("native");
  }

  const workspaceName = activeSession?.allowedCwd?.split("/").pop();

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <PageHeader
        title="🤖 dsh"
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
      >
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`px-2 py-0.5 rounded-full ${
              !ready
                ? "bg-amber-100 text-amber-700"
                : enginePid
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-600"
            }`}
            title={env?.root}
          >
            {!ready ? "未安装" : enginePid ? `运行中 · pid ${enginePid}` : "已就绪"}
          </span>
          <select
            className="px-2 py-1 border border-gray-200 rounded-lg bg-white"
            value={effectiveKey ?? ""}
            onChange={(e) => setSelectedModelKey(e.target.value)}
            disabled={dshRunning}
          >
            {modelOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.providerName} · {o.model.model}
              </option>
            ))}
          </select>
          {activeSession && (
            <button
              className="px-2 py-1 border border-gray-200 rounded-lg flex items-center gap-1 text-gray-600 hover:bg-gray-50"
              onClick={handlePickCwd}
              disabled={dshRunning}
              title={activeSession.allowedCwd || "未选工作目录"}
            >
              <FolderOpen size={12} />
              {workspaceName ?? "选工作目录"}
            </button>
          )}
          {dshRunning && (
            <button
              className="px-2 py-1 border border-amber-300 text-amber-700 rounded-lg flex items-center gap-1 hover:bg-amber-50"
              onClick={stopDsh}
              title="dsh 没有中途取消，停止即关闭引擎进程"
            >
              <Square size={12} /> 停止
            </button>
          )}
          {ready && (
            <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
              <button
                className={`px-2 py-1 flex items-center gap-1 ${
                  view === "native" ? "bg-blue-500 text-white" : "text-gray-600 hover:bg-gray-50"
                }`}
                onClick={() => setView("native")}
                title="CodeShelf 的会话界面：历史存在这里，可搜索导出"
              >
                <PanelsTopLeft size={12} /> 本地
              </button>
              <button
                className={`px-2 py-1 flex items-center gap-1 disabled:opacity-50 ${
                  view === "official" ? "bg-blue-500 text-white" : "text-gray-600 hover:bg-gray-50"
                }`}
                onClick={handleOpenOfficialUi}
                disabled={webOpening}
                title="dsh 官方界面（审批、plan、工作区管理都在那边）；会话存在 dsh 自己那里"
              >
                {webOpening ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
                {webOpening ? "启动中…" : "官方"}
              </button>
            </div>
          )}
          {view === "official" && webUrl && (
            <>
              <button
                className="px-2 py-1 border border-gray-200 rounded-lg flex items-center gap-1 text-gray-600 hover:bg-gray-50"
                onClick={() => openUrl(webUrl)}
                title="内嵌显示不出来时的兜底：用系统浏览器打开同一个地址"
              >
                <ExternalLink size={12} /> 浏览器打开
              </button>
              <button
                className="px-2 py-1 border border-gray-200 rounded-lg flex items-center gap-1 text-gray-600 hover:bg-gray-50"
                onClick={handleStopWeb}
                title="关掉官方界面的服务进程"
              >
                <Square size={12} /> 关闭服务
              </button>
            </>
          )}
        </div>
      </PageHeader>

      {/* 官方界面：整块内嵌，不再另开窗口。会话列表由它自己管，所以不显示本地侧栏。 */}
      {view === "official" ? (
        <div className="flex-1 min-h-0 min-w-0 flex flex-col">
          {webUrl ? (
            <iframe
              src={webUrl}
              title="dsh 官方界面"
              className="flex-1 w-full border-0"
              // 官方界面是本机 127.0.0.1 上我们自己拉起的进程，不加 sandbox：
              // 它要用到剪贴板、下载、弹窗，限死了功能会缺一半
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="re-card p-5 space-y-2 text-sm text-gray-600 max-w-md">
                <div className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin text-blue-500" />
                  正在启动 dsh 官方界面…
                </div>
                <p className="text-xs text-gray-500">
                  首次使用它会现场初始化 web profile，可能要几十秒。
                </p>
                {webLog && (
                  <p className="text-[11px] text-gray-400 font-mono break-all">{webLog}</p>
                )}
              </div>
            </div>
          )}
          <p className="px-5 py-2 text-[11px] text-gray-400 border-t border-gray-100">
            官方界面用的模型是「{selected?.providerName} · {selected?.model.model}」——
            由 CodeShelf 注入，密钥在它那边显示为「由启动环境提供」。会话存在 dsh 自己那里，不进本地会话列表。
            {webUrl ? `（${webUrl}，显示不出来就点上面的「浏览器打开」）` : ""}
          </p>
        </div>
      ) : (
      <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
        <SessionSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          isSwitching={sessionLoading}
          isConfigured={modelOptions.length > 0}
          loading={listLoading}
          collapsed={listCollapsed}
          onToggleCollapsed={() => setListCollapsed((v) => !v)}
          onCreate={handleCreateSession}
          onImport={handleCreateSession}
          onSelect={(id) => {
            if (id !== activeSessionId) {
              setActiveSessionId(id);
              setInput("");
            }
          }}
          onRename={setRenameTarget}
          onDelete={handleDeleteSession}
          onTogglePin={handleTogglePin}
          onExport={handleExport}
        />

        <main className="flex-1 p-5 space-y-4 min-h-0 min-w-0 overflow-hidden">
          {!ready && (
            <div className="re-card p-5 space-y-3">
              <div className="text-sm text-gray-700">dsh 运行时尚未就绪</div>
              <div className="text-xs text-gray-500">
                {env && !env.nodeOk
                  ? `需要 Node v${env.nodeMinMajor} 及以上（当前 ${env.nodeVersion ?? "未找到"}）`
                  : "到 设置 → dsh 引擎 里一键安装后即可使用"}
              </div>
              <button
                className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded-lg"
                onClick={() => setCurrentPage("settings")}
              >
                去设置
              </button>
            </div>
          )}

          {ready && !activeSession && (
            <div className="re-card p-5 text-gray-500 text-sm">请选择或新建一个 dsh 会话</div>
          )}

          {ready && activeSession && (
            <div className="flex flex-col h-full min-w-0">
              {!activeSession.allowedCwd && (
                <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                  还没选工作目录。dsh 的文件读写与命令都在这个目录里进行，选了才能开始对话。
                </div>
              )}
              <MessageList
                messages={activeSession.messages}
                streaming={dshRunning}
                thinkingBuffer=""
                onCopy={(m) => {
                  navigator.clipboard.writeText(m.content);
                  showToast("success", "已复制");
                }}
                onEditUser={(_, content) => handleRetryUser({ ...makeMessage("user", content) })}
                onRegenerateAssistant={() => showToast("info", "dsh 会话请直接再发一条消息")}
                onRetryUser={handleRetryUser}
                onDelete={handleDeleteMessage}
              />
              <ChatInput
                value={input}
                onChange={setInput}
                onSend={handleSend}
                onStop={stopDsh}
                onSlashCommand={() => showToast("info", "dsh 会话暂不支持斜杠命令")}
                streaming={dshRunning}
                disabled={!activeSession.allowedCwd}
                userHistory={activeSession.messages
                  .filter((m) => m.role === "user" && m.content.trim())
                  .map((m) => m.content)
                  .reverse()}
                mentionRoot={activeSession.allowedCwd ?? null}
              />
              <p className="text-[11px] text-gray-400 mt-2">
                工具调用与审批由 dsh 自己管（沙箱限制在工作目录内）；停止等于关闭引擎，重开是新的上下文。
              </p>
            </div>
          )}
        </main>
      </div>
      )}

      {renameTarget && (
        <RenameDialog
          open
          initialValue={renameTarget.title}
          onCancel={() => setRenameTarget(null)}
          onConfirm={confirmRename}
        />
      )}
    </div>
  );
}
