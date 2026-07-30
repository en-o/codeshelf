import { useEffect, useMemo, useState } from "react";
import { Library, ListPlus } from "lucide-react";
import { useAiProvidersStore } from "@/stores/aiProvidersStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { showToast } from "@/components/ui";
import { MacWindowControls } from "@/components/layout/MacWindowControls";
import type {
  AiModelConfig,
  AiProviderConfig,
  ApiChatSession,
  ApiChatSessionSummary,
  ApiEndpoint,
  ApiGroup,
  ChatMessage,
} from "@/types";
import {
  createApiChatSession,
  deleteApiChatSession,
  getApiChatSession,
  listApiChatSessions,
  listApiEndpoints,
  listApiGroups,
  renameApiChatSession,
  saveApiChatSession,
} from "@/services/api_chat";
import { useMcpEndpointLookup } from "@/hooks/useMcpEndpointLookup";
import { MessageList } from "@/pages/Chat/components/MessageList";
import { RenameDialog } from "@/pages/Chat/components/RenameDialog";
import { ApiSessionSidebar } from "./components/ApiSessionSidebar";
import { LibraryManagerDialog } from "./components/LibraryManagerDialog";
import { EndpointPickerDialog } from "./components/EndpointPickerDialog";
import { useApiChatOrchestration } from "./hooks/useApiChatOrchestration";
import { errMsg } from "@/utils/errMsg";

interface ModelOption {
  providerId: string;
  providerName: string;
  modelId: string;
  model: AiModelConfig;
  baseUrl: string;
  apiKey?: string;
  key: string;
}

function buildModelOptions(providers: AiProviderConfig[]): ModelOption[] {
  const options: ModelOption[] = [];
  for (const p of providers) {
    if (!p.enabled) continue;
    for (const m of p.models) {
      if (!m.enabled) continue;
      options.push({
        providerId: p.id,
        providerName: p.name,
        modelId: m.id,
        model: m,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        key: `${p.id}:${m.id}`,
      });
    }
  }
  options.sort((a, b) => {
    const aProvider = providers.find((p) => p.id === a.providerId);
    const bProvider = providers.find((p) => p.id === b.providerId);
    const aIsDefaultProvider = aProvider?.isDefaultProvider ? 1 : 0;
    const bIsDefaultProvider = bProvider?.isDefaultProvider ? 1 : 0;
    if (aIsDefaultProvider !== bIsDefaultProvider) return bIsDefaultProvider - aIsDefaultProvider;
    const aIsDefault = a.model.isDefault ? 1 : 0;
    const bIsDefault = b.model.isDefault ? 1 : 0;
    return bIsDefault - aIsDefault;
  });
  return options;
}

function getDefaultOptionKey(providers: AiProviderConfig[]): string | null {
  const defaultProvider =
    providers.filter((p) => p.enabled).find((p) => p.isDefaultProvider) ??
    providers.filter((p) => p.enabled)[0];
  if (!defaultProvider) return null;
  const defaultModel =
    defaultProvider.models.filter((m) => m.enabled).find((m) => m.isDefault) ??
    defaultProvider.models.filter((m) => m.enabled)[0];
  if (!defaultModel) return null;
  return `${defaultProvider.id}:${defaultModel.id}`;
}

function summarizeTitle(messages: ChatMessage[]): string | null {
  const firstUser = messages.find((m) => m.role === "user" && m.content.trim());
  if (!firstUser) return null;
  const trimmed = firstUser.content.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 20) + (trimmed.length > 20 ? "..." : "");
}

export function ApiChatPage() {
  const { aiProviders, ensureAiDefaultProvider } = useAiProvidersStore();
  const { sidebarCollapsed, setSidebarCollapsed } = useSettingsStore();
  const setCurrentPage = useUiStore((s) => s.setCurrentPage);

  const [sessions, setSessions] = useState<ApiChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ApiChatSession | null>(null);
  const [input, setInput] = useState("");
  const [listLoading, setListLoading] = useState(false);
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ApiChatSessionSummary | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState<"create" | "edit" | null>(null);
  const [groups, setGroups] = useState<ApiGroup[]>([]);
  const [endpoints, setEndpoints] = useState<ApiEndpoint[]>([]);
  const [sidebarListCollapsed, setSidebarListCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("apiChat.sessionListCollapsed") === "1";
    } catch {
      return false;
    }
  });

  const endpointLookup = useMcpEndpointLookup(endpoints);

  const { streaming, thinkingBuffer, send, regenerate, retryUser, retryFromError, stop } = useApiChatOrchestration();

  const normalized = useMemo(() => ensureAiDefaultProvider(aiProviders), [aiProviders, ensureAiDefaultProvider]);
  const modelOptions = useMemo(() => buildModelOptions(normalized), [normalized]);
  const defaultKey = useMemo(() => getDefaultOptionKey(normalized), [normalized]);
  const effectiveKey = modelOptions.find((o) => o.key === selectedModelKey) ? selectedModelKey : defaultKey;
  const selected = modelOptions.find((o) => o.key === effectiveKey) ?? null;
  const isConfigured = Boolean(selected);

  async function reloadLibrary() {
    try {
      const [g, e] = await Promise.all([listApiGroups(), listApiEndpoints()]);
      setGroups(g);
      setEndpoints(e);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    reloadLibrary();
  }, []);

  useEffect(() => {
    async function load() {
      setListLoading(true);
      try {
        const list = await listApiChatSessions();
        setSessions(list);
        if (list.length > 0) {
          setActiveSessionId((prev) => prev ?? list[0].id);
        }
      } catch (e) {
        showToast("error", errMsg(e, "加载会话失败"));
      } finally {
        setListLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    async function load() {
      if (!activeSessionId) {
        setActiveSession(null);
        return;
      }
      try {
        const s = await getApiChatSession(activeSessionId);
        setActiveSession(s);
      } catch (e) {
        // 会话读不出来是真故障（文件损坏 / 库打不开），不能只是静默清空 ——
        // 用户看到的是"会话内容凭空消失"，却不知道为什么。
        setActiveSession(null);
        showToast("error", "打开会话失败", errMsg(e, "无法读取该会话"));
      }
    }
    load();
  }, [activeSessionId]);

  function syncSummary(session: ApiChatSession) {
    setSessions((prev) => {
      const summary: ApiChatSessionSummary = {
        id: session.id,
        title: session.title,
        providerId: session.providerId,
        modelId: session.modelId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
        endpointCount: session.selectedEndpointIds.length,
        pinned: session.pinned,
      };
      const exists = prev.find((s) => s.id === session.id);
      if (exists) return prev.map((s) => (s.id === session.id ? summary : s));
      return [summary, ...prev];
    });
  }

  function handleSession(next: ApiChatSession) {
    setActiveSession(next);
    syncSummary(next);
  }

  async function doCreateWithEndpoints(endpointIds: string[]) {
    if (!selected) {
      showToast("warning", "请先配置模型");
      setCurrentPage("aiProviders");
      return;
    }
    try {
      const s = await createApiChatSession({
        title: "新接口对话",
        providerId: selected.providerId,
        modelId: selected.modelId,
        selectedEndpointIds: endpointIds,
      });
      setSessions((prev) => [
        {
          id: s.id,
          title: s.title,
          providerId: s.providerId,
          modelId: s.modelId,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          messageCount: s.messages.length,
          endpointCount: s.selectedEndpointIds.length,
          pinned: s.pinned,
        },
        ...prev,
      ]);
      setActiveSession(s);
      setActiveSessionId(s.id);
      setInput("");
      setPickerOpen(null);
    } catch (err) {
      showToast("error", errMsg(err, "创建失败"));
    }
  }

  async function handleUpdateBoundEndpoints(endpointIds: string[]) {
    if (!activeSession) return;
    try {
      const next: ApiChatSession = { ...activeSession, selectedEndpointIds: endpointIds };
      const saved = await saveApiChatSession(next);
      handleSession(saved);
      setPickerOpen(null);
      showToast("success", "已更新接口绑定");
    } catch (err) {
      showToast("error", errMsg(err, "更新失败"));
    }
  }

  async function handleSelectSession(id: string) {
    if (id === activeSessionId) return;
    // 切会话前先取消在途请求：否则旧流会继续往新会话里写 delta，
    // 落盘的也是被污染的那一份。
    if (streaming) await stop().catch(() => {});
    setActiveSessionId(id);
    setInput("");
  }

  async function handleDeleteSession(target: ApiChatSessionSummary) {
    if (!confirm(`删除会话「${target.title}」？`)) return;
    try {
      await deleteApiChatSession(target.id);
      setSessions((prev) => prev.filter((s) => s.id !== target.id));
      if (activeSessionId === target.id) {
        const remaining = sessions.filter((s) => s.id !== target.id);
        const next = remaining[0]?.id ?? null;
        setActiveSessionId(next);
        if (!next) setActiveSession(null);
      }
    } catch (e) {
      showToast("error", errMsg(e, "删除失败"));
    }
  }

  async function confirmRename(title: string) {
    if (!renameTarget) return;
    try {
      const updated = await renameApiChatSession(renameTarget.id, title);
      syncSummary(updated);
      if (activeSession?.id === updated.id) setActiveSession(updated);
      setRenameTarget(null);
    } catch (e) {
      showToast("error", errMsg(e, "重命名失败"));
    }
  }

  async function handleTogglePin(target: ApiChatSessionSummary) {
    try {
      const full =
        activeSession?.id === target.id ? activeSession : await getApiChatSession(target.id);
      const next: ApiChatSession = { ...full, pinned: !full.pinned };
      const saved = await saveApiChatSession(next);
      handleSession(saved);
    } catch (e) {
      showToast("error", errMsg(e, "操作失败"));
    }
  }

  async function handleSend() {
    if (!activeSession || !selected || streaming) return;
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");
    await send(
      {
        session: activeSession,
        llm: {
          providerId: selected.providerId,
          model: selected.model.model,
          baseUrl: selected.baseUrl,
          apiKey: selected.apiKey,
          thinking: selected.model.thinking,
          stream: selected.model.stream !== false,
        },
        onSession: handleSession,
        onError: (msg) => showToast("error", msg),
      },
      text,
    );

    // 如果还是默认标题，取用户首条为标题
    const cur = activeSession;
    if (cur && (cur.title === "新接口对话" || !cur.title.trim())) {
      const generated = summarizeTitle([...cur.messages, { id: "", role: "user", content: text, createdAt: "" }]);
      if (generated) {
        try {
          const renamed = await renameApiChatSession(cur.id, generated);
          syncSummary(renamed);
        } catch {
          /* ignore */
        }
      }
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <header className="re-header sticky top-0 z-20" data-tauri-drag-region>
        <span className="toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
          ☰
        </span>

        <div className="flex-1 flex items-center gap-3" data-tauri-drag-region>
          <span className="text-lg font-semibold ml-2">🧪 接口对话</span>
          {modelOptions.length > 0 && (
            <select
              className="px-2 py-1 text-xs border border-gray-200 rounded-lg bg-white text-gray-700 max-w-[240px]"
              value={effectiveKey ?? ""}
              onChange={(e) => setSelectedModelKey(e.target.value)}
              disabled={streaming}
            >
              {modelOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.providerName} / {opt.model.model}
                  {opt.key === defaultKey ? "（默认）" : ""}
                </option>
              ))}
            </select>
          )}
          <button
            className="px-2 py-1 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 flex items-center gap-1"
            onClick={() => setLibraryOpen(true)}
            title="管理接口库（分组 / 接口 / 鉴权）"
          >
            <Library size={12} /> 接口库
          </button>
          {activeSession && (
            <button
              className="px-2 py-1 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 flex items-center gap-1"
              onClick={() => setPickerOpen("edit")}
              title="修改当前会话绑定的接口"
            >
              <ListPlus size={12} /> 已绑 {activeSession.selectedEndpointIds.length} 个接口
            </button>
          )}
        </div>

        <div className="re-actions flex items-center">
          <MacWindowControls />
        </div>
      </header>

      <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
        <ApiSessionSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          loading={listLoading}
          collapsed={sidebarListCollapsed}
          onToggleCollapsed={() => {
            setSidebarListCollapsed((prev) => {
              const next = !prev;
              try {
                localStorage.setItem("apiChat.sessionListCollapsed", next ? "1" : "0");
              } catch {
                /* ignore */
              }
              return next;
            });
          }}
          onCreate={() => {
            if (!isConfigured) {
              showToast("warning", "请先配置模型");
              setCurrentPage("aiProviders");
              return;
            }
            setPickerOpen("create");
          }}
          onSelect={handleSelectSession}
          onRename={(s) => setRenameTarget(s)}
          onDelete={handleDeleteSession}
          onTogglePin={handleTogglePin}
          onEditEndpoints={(s) => {
            setActiveSessionId(s.id);
            setPickerOpen("edit");
          }}
        />

        <main className="flex-1 p-5 space-y-4 min-h-0 min-w-0 overflow-hidden">
          {!isConfigured && (
            <div className="re-card p-5 space-y-3">
              <div className="text-sm text-gray-700">尚未配置可用的 AI 供应商</div>
              <button
                className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded-lg"
                onClick={() => setCurrentPage("aiProviders")}
              >
                去配置
              </button>
            </div>
          )}

          {isConfigured && !activeSession && (
            <div className="re-card p-5 space-y-2 text-gray-500 text-sm">请选择或新建一个接口对话</div>
          )}

          {isConfigured && activeSession && (
            <div className="flex flex-col h-full min-w-0">
              {activeSession.selectedEndpointIds.length === 0 && (
                <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                  当前会话未绑定任何接口。模型无法调用 API，请先通过右上角"已绑 N 个接口"按钮选择。
                </div>
              )}
              <MessageList
                messages={activeSession.messages}
                streaming={streaming}
                thinkingBuffer={thinkingBuffer}
                endpointLookup={endpointLookup}
                onCopy={(m) => {
                  navigator.clipboard.writeText(m.content).then(
                    () => showToast("success", "已复制"),
                    () => showToast("error", "复制失败"),
                  );
                }}
                onEditUser={() => {
                  showToast("info", "接口对话暂不支持消息编辑");
                }}
                onRegenerateAssistant={async (m) => {
                  if (!selected) return;
                  const args = {
                    session: activeSession,
                    llm: {
                      providerId: selected.providerId,
                      model: selected.model.model,
                      baseUrl: selected.baseUrl,
                      apiKey: selected.apiKey,
                      thinking: selected.model.thinking,
                      stream: selected.model.stream !== false,
                    },
                    onSession: handleSession,
                    onError: (msg: string) => showToast("error", msg),
                  };
                  if (m.error) {
                    await retryFromError(args);
                  } else {
                    await regenerate(args, m.id);
                  }
                }}
                onRetryUser={async (m) => {
                  if (!selected) return;
                  await retryUser(
                    {
                      session: activeSession,
                      llm: {
                        providerId: selected.providerId,
                        model: selected.model.model,
                        baseUrl: selected.baseUrl,
                        apiKey: selected.apiKey,
                        thinking: selected.model.thinking,
                        stream: selected.model.stream !== false,
                      },
                      onSession: handleSession,
                      onError: (msg) => showToast("error", msg),
                    },
                    m.id,
                  );
                }}
                onDelete={async (m) => {
                  const next: ApiChatSession = {
                    ...activeSession,
                    messages: activeSession.messages.filter((x) => x.id !== m.id),
                  };
                  try {
                    const saved = await saveApiChatSession(next);
                    handleSession(saved);
                  } catch (e) {
                    showToast("error", errMsg(e, "删除失败"));
                  }
                }}
              />

              <div className="mt-3 border border-gray-200 rounded-lg p-2 bg-white">
                <textarea
                  className="w-full resize-none outline-none text-sm"
                  rows={3}
                  placeholder="用自然语言描述：帮我查 id 为 42 的用户…（模型会自动挑选已绑定的接口调用）"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  disabled={streaming}
                />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-400">Enter 发送 · Shift+Enter 换行</span>
                  {streaming ? (
                    <button
                      className="px-3 py-1 text-xs bg-red-500 text-white rounded-lg"
                      onClick={stop}
                    >
                      停止
                    </button>
                  ) : (
                    <button
                      className="px-3 py-1 text-xs bg-blue-500 text-white rounded-lg disabled:opacity-60"
                      onClick={handleSend}
                      disabled={!input.trim()}
                    >
                      发送
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <LibraryManagerDialog
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onChanged={reloadLibrary}
      />

      <EndpointPickerDialog
        open={pickerOpen !== null}
        groups={groups}
        endpoints={endpoints}
        initialSelected={pickerOpen === "edit" ? activeSession?.selectedEndpointIds ?? [] : []}
        onCancel={() => setPickerOpen(null)}
        onConfirm={(ids) => {
          if (pickerOpen === "create") {
            doCreateWithEndpoints(ids);
          } else if (pickerOpen === "edit") {
            handleUpdateBoundEndpoints(ids);
          }
        }}
      />

      <RenameDialog
        open={Boolean(renameTarget)}
        initialValue={renameTarget?.title ?? ""}
        onCancel={() => setRenameTarget(null)}
        onConfirm={confirmRename}
      />
    </div>
  );
}
