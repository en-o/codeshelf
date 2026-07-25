import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Link2, CheckCircle2, XCircle, ArrowDown, ArrowUp, AlertTriangle } from "lucide-react";
import { useAiProvidersStore } from "@/stores/aiProvidersStore";
import { showToast } from "@/components/ui";

interface AppSettings {
  chat_bridge_enabled?: boolean;
  openclaw_relay_endpoint?: string | null;
  bridge_provider_id?: string | null;
  bridge_model_id?: string | null;
  bridge_client_id?: string | null;
}

interface BridgeEvent {
  kind: "inbound" | "outbound" | "error";
  id?: string;
  content?: string;
  message?: string;
}

export function ChatBridgeSettings() {
  const { aiProviders } = useAiProvidersStore();
  const [enabled, setEnabled] = useState(false);
  const [relay, setRelay] = useState("");
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [clientId, setClientId] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [events, setEvents] = useState<BridgeEvent[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const s = await invoke<AppSettings>("get_app_settings");
        setEnabled(!!s.chat_bridge_enabled);
        setRelay(s.openclaw_relay_endpoint ?? "");
        setProviderId(s.bridge_provider_id ?? "");
        setModelId(s.bridge_model_id ?? "");
        setClientId(s.bridge_client_id ?? "");
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    listen<BridgeEvent>("chat-bridge-event", (e) => {
      setEvents((prev) => [e.payload, ...prev].slice(0, 30));
    }).then((u) => { unlisten = u; });
    return () => { if (unlisten) unlisten(); };
  }, []);

  async function save(patch: Partial<AppSettings>) {
    try {
      await invoke("save_app_settings", { input: patch });
    } catch (e) {
      // Tauri invoke 的后端错误是纯字符串，不是 Error 实例
      showToast("error", typeof e === "string" && e ? e : e instanceof Error ? e.message : "保存失败");
    }
  }

  async function handleTest() {
    if (!relay.trim()) { showToast("warning", "先填中继地址"); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const msg = await invoke<string>("chat_bridge_test", { relay: relay.trim() });
      setTestResult(msg);
    } catch (e) {
      setTestResult(e instanceof Error ? e.message : "连通测试失败");
    } finally {
      setTesting(false);
    }
  }

  const enabledProviders = aiProviders.filter((p) => p.enabled);
  const currentProvider = enabledProviders.find((p) => p.id === providerId);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Link2 size={18} /> 聊天软件桥接
        </h3>
        <p className="text-xs text-gray-500 mt-1">
          参考 OpenClaw 模式：外部聊天平台（飞书/钉钉/企微）→ 中继服务 → CodeShelf → 用本地 LLM 回复 → 中继回发给聊天平台。<br />
          需要中继服务实现：<code className="font-mono bg-gray-100 px-1">GET /pending?clientId=</code>、<code className="font-mono bg-gray-100 px-1">POST /reply</code>、<code className="font-mono bg-gray-100 px-1">GET /health</code>。
        </p>
      </div>

      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          onChange={async (e) => {
            const v = e.target.checked;
            setEnabled(v);
            await save({ chat_bridge_enabled: v });
            showToast("info", v ? "桥接已启用（每 10s 拉取一次）" : "桥接已禁用");
          }}
        />
        <span className="text-sm">启用聊天软件桥接</span>
      </label>

      <div className="space-y-3">
        <label className="block text-xs text-gray-700">
          OpenClaw 中继地址
          <div className="flex gap-2 mt-1">
            <input
              className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm font-mono"
              placeholder="https://relay.example.com"
              value={relay}
              onChange={(e) => setRelay(e.target.value)}
              onBlur={() => save({ openclaw_relay_endpoint: relay.trim() })}
            />
            <button
              className="px-3 py-1.5 text-xs border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-60"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? "连通中…" : "测试连通"}
            </button>
          </div>
          {testResult && (
            <div className="mt-2 text-[11px] text-gray-600 flex items-start gap-1">
              {testResult.startsWith("HTTP 2")
                ? <CheckCircle2 size={12} className="text-emerald-500 mt-0.5" />
                : <XCircle size={12} className="text-red-500 mt-0.5" />}
              <span className="font-mono break-all">{testResult}</span>
            </div>
          )}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-gray-700">
            回复用 Provider
            <select
              className="mt-1 w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
              value={providerId}
              onChange={(e) => {
                const v = e.target.value;
                setProviderId(v);
                setModelId("");
                save({ bridge_provider_id: v, bridge_model_id: "" });
              }}
            >
              <option value="">选择供应商</option>
              {enabledProviders.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

          <label className="block text-xs text-gray-700">
            回复用 Model
            <select
              className="mt-1 w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
              value={modelId}
              onChange={(e) => {
                const v = e.target.value;
                setModelId(v);
                save({ bridge_model_id: v });
              }}
            >
              <option value="">选择模型</option>
              {currentProvider?.models.filter((m) => m.enabled).map((m) => (
                <option key={m.id} value={m.id}>{m.model}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-xs text-gray-700">
          客户端标识（clientId，用于中继区分哪台设备）
          <input
            className="mt-1 w-full border border-gray-200 rounded px-2 py-1.5 text-sm font-mono"
            placeholder="codeshelf-默认"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            onBlur={() => save({ bridge_client_id: clientId.trim() })}
          />
        </label>

        {enabled && (!relay.trim() || !providerId || !modelId) && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 flex items-start gap-2">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            桥接已启用，但缺少必要配置（中继地址/provider/model）。填齐后每 10s 自动拉取 pending。
          </div>
        )}
      </div>

      <div>
        <div className="text-xs text-gray-600 font-semibold mb-2">最近桥接事件</div>
        {events.length === 0 && <div className="text-xs text-gray-400">暂无事件</div>}
        <div className="space-y-1 max-h-[260px] overflow-auto">
          {events.map((e, idx) => (
            <div key={idx} className="text-[11px] border border-gray-200 rounded px-2 py-1 flex items-start gap-2">
              {e.kind === "inbound" && <ArrowDown size={12} className="text-blue-500 mt-0.5 flex-shrink-0" />}
              {e.kind === "outbound" && <ArrowUp size={12} className="text-emerald-500 mt-0.5 flex-shrink-0" />}
              {e.kind === "error" && <XCircle size={12} className="text-red-500 mt-0.5 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                {e.id && <div className="text-gray-400 font-mono text-[10px]">{e.id}</div>}
                <div className="break-words whitespace-pre-wrap">{e.content ?? e.message ?? ""}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
