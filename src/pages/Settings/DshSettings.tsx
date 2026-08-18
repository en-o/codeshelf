import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle, Download, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { dshEnvStatus, dshInstall, dshListNodes, dshSetNode, dshUninstall, type DshEnvStatus, type NodeCandidate } from "@/services/dsh";
import { showToast } from "@/components/ui";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";
import { useAiProvidersStore } from "@/stores/aiProvidersStore";
import { DSH_DEFAULT_MODEL_KEY, toDshProviders } from "@/pages/Dsh/providers";

interface DshSettingsProps {
  onClose?: () => void;
}

/** Tauri 抛回来的是纯字符串，不是 Error 实例 */
function errText(e: unknown, fallback: string): string {
  return typeof e === "string" && e ? e : e instanceof Error ? e.message : fallback;
}

export function DshSettings({ onClose }: DshSettingsProps) {
  const { aiProviders, ensureAiDefaultProvider } = useAiProvidersStore();
  const [status, setStatus] = useState<DshEnvStatus | null>(null);
  const [nodes, setNodes] = useState<NodeCandidate[]>([]);
  const [defaultModelKey, setDefaultModelKey] = useLocalStorageState<string>(DSH_DEFAULT_MODEL_KEY, "");
  const dshProviders = useMemo(
    () => toDshProviders(ensureAiDefaultProvider(aiProviders)),
    [aiProviders, ensureAiDefaultProvider],
  );
  const [busy, setBusy] = useState<"install" | "uninstall" | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const logBoxRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    try {
      setStatus(await dshEnvStatus());
      setNodes(await dshListNodes());
    } catch (e) {
      showToast("error", errText(e, "读取 dsh 状态失败"));
    }
  }

  /** 选一个 node；"" 表示恢复自动选择 */
  async function handlePickNode(path: string) {
    try {
      setStatus(await dshSetNode(path || null));
      setNodes(await dshListNodes());
      showToast("success", path ? "已指定 Node" : "已恢复自动选择");
    } catch (e) {
      showToast("error", errText(e, "设置 Node 失败"));
    }
  }

  useEffect(() => {
    refresh();
    const un = listen<string>("dsh-install-log", (e) => {
      // 只留尾部若干行：npm 安装能刷出几千行，全存会把这个面板拖垮
      setLog((prev) => [...prev, e.payload].slice(-200));
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    logBoxRef.current?.scrollTo({ top: logBoxRef.current.scrollHeight });
  }, [log]);

  async function handleInstall() {
    setBusy("install");
    setLog([]);
    try {
      const next = await dshInstall();
      setStatus(next);
      showToast("success", "dsh 已就绪", `版本 ${next.installedVersion ?? next.targetVersion}`);
    } catch (e) {
      showToast("error", errText(e, "安装失败"));
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function handleUninstall() {
    setBusy("uninstall");
    try {
      setStatus(await dshUninstall());
      setLog([]);
      showToast("success", "已卸载 dsh");
    } catch (e) {
      showToast("error", errText(e, "卸载失败"));
    } finally {
      setBusy(null);
    }
  }

  const ready = !!status?.installed;
  /** 机器上有满足版本的 node，只是当前没选中它 */
  const hasUsableNode = nodes.some((n) => n.usable);
  const versionStale =
    !!status?.installedVersion && status.installedVersion !== status.targetVersion;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-gray-200">
        <h4 className="text-sm font-semibold text-gray-900">DeepSeek Harness（dsh）</h4>
        {onClose && (
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-blue-500 transition-colors">
            收起
          </button>
        )}
      </div>

      {/* 运行时状态 */}
      <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {ready ? (
              <CheckCircle size={16} className="text-green-500" />
            ) : (
              <AlertCircle size={16} className="text-amber-500" />
            )}
            <span className="text-sm font-medium text-gray-900">
              {ready ? `已就绪 · v${status?.installedVersion ?? status?.targetVersion}` : "未安装"}
            </span>
          </div>
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 hover:text-blue-600 transition-colors"
          >
            <RefreshCw size={14} />
            重新检测
          </button>
        </div>

        <dl className="text-xs text-gray-600 space-y-1">
          <div className="flex gap-2 items-start">
            <dt className="w-20 shrink-0 text-gray-500 pt-1">Node</dt>
            <dd className="flex-1 min-w-0 space-y-1">
              <select
                className="w-full px-2 py-1 border border-gray-200 rounded bg-white"
                value={nodes.find((n) => n.pinned)?.path ?? ""}
                onChange={(e) => handlePickNode(e.target.value)}
                disabled={busy !== null}
              >
                <option value="">
                  自动选择
                  {status?.nodeVersion ? `（当前 ${status.nodeVersion}${status.nodeSource ? ` · ${status.nodeSource}` : ""}）` : "（未找到 Node）"}
                </option>
                {nodes.map((n) => (
                  <option key={n.path} value={n.path} disabled={!n.usable}>
                    {n.version} · {n.source}
                    {n.usable ? "" : `（低于 v${status?.nodeMinMajor ?? 22}，不可用）`}
                  </option>
                ))}
              </select>
              {status?.nodePath && (
                <p className="text-[10px] text-gray-400 break-all">
                  {status.nodePinned ? "已手动指定：" : "自动选中："}
                  {status.nodePath}
                </p>
              )}
              {!status?.nodeOk && (
                <p className="text-amber-700">
                  {status?.nodeVersion
                    ? `当前 ${status.nodeVersion}，需要 v${status.nodeMinMajor} 及以上`
                    : "未找到可用的 Node"}
                </p>
              )}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-gray-500">安装目录</dt>
            <dd className="break-all text-gray-400">{status?.root ?? "-"}</dd>
          </div>
          <div className="flex gap-2 items-start">
            <dt className="w-20 shrink-0 text-gray-500 pt-1">默认模型</dt>
            <dd className="flex-1 min-w-0 space-y-1">
              <select
                className="w-full px-2 py-1 border border-gray-200 rounded bg-white"
                value={defaultModelKey}
                onChange={(e) => setDefaultModelKey(e.target.value)}
                disabled={busy !== null || dshProviders.length === 0}
              >
                <option value="">
                  {dshProviders.length === 0 ? "「模型」页里还没有启用的模型" : "自动（第一个可用模型）"}
                </option>
                {dshProviders.map((p) =>
                  p.models.map((m) => (
                    <option key={`${p.id}::${m}`} value={`${p.id}::${m}`}>
                      {p.name} · {m}
                    </option>
                  )),
                )}
              </select>
              <p className="text-[10px] text-gray-400">
                dsh 新会话默认用它；在 dsh 界面里还能临时换成「模型」页里的其它模型。
                改完要在 dsh 页点「重启」才生效。
              </p>
            </dd>
          </div>
        </dl>

        <div className="flex items-center gap-2">
          <button
            onClick={handleInstall}
            disabled={!status?.nodeOk || busy !== null}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {busy === "install" ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {busy === "install" ? "安装中..." : ready ? (versionStale ? "更新到目标版本" : "重新安装") : "一键安装"}
          </button>
          {status?.installed && (
            <button
              onClick={handleUninstall}
              disabled={busy !== null}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              <Trash2 size={16} />
              卸载
            </button>
          )}
        </div>
      </div>

      {/* Node 缺失 / 版本不足。分三种情况给不同指引，不替用户装 */}
      {!status?.nodeOk && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-start gap-2 text-xs text-amber-900">
            <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-1.5 min-w-0">
              <p className="font-medium">需要 Node.js v{status?.nodeMinMajor ?? 22} 或更高版本</p>
              <p>dsh 用到了 Node {status?.nodeMinMajor ?? 22} 才有的 API，低版本会在加载插件时直接失败。</p>

              {hasUsableNode ? (
                // 装了但没被选中：上面的下拉直接能切，不用去命令行
                <p>已经检测到可用版本，在上面的 Node 下拉里选中它即可。</p>
              ) : status?.nvmRoot ? (
                <>
                  <p>
                    检测到 nvm（{status.nvmVersions} 个已装版本，{status.nvmRoot}），
                    但没有 v{status.nodeMinMajor}+。在终端里装一个：
                  </p>
                  <code className="block bg-amber-100 rounded px-2 py-1 font-mono select-all">
                    nvm install {status.nodeMinMajor}
                  </code>
                  <p className="text-amber-700">
                    装完点「重新检测」。不用 <code>nvm use</code> —— 应用直接按路径调用，
                    不依赖你当前 shell 切到哪个版本（nvm 是 shell 函数，GUI 进程读不到）。
                  </p>
                </>
              ) : (
                <p>从 nodejs.org 装一个 v{status?.nodeMinMajor ?? 22}+，或用 nvm 装，再点「重新检测」。</p>
              )}
            </div>
          </div>
        </div>
      )}

      {versionStale && (
        <div className="p-3 bg-blue-50/60 border border-blue-200/60 rounded-lg text-xs text-blue-900">
          已装 v{status?.installedVersion}，当前应用适配的是 v{status?.targetVersion}。
          dsh 处于开发者预览期、版本之间接口会变，建议更新到目标版本。
        </div>
      )}

      {/* 安装日志 */}
      {log.length > 0 && (
        <div
          ref={logBoxRef}
          className="max-h-48 overflow-y-auto bg-gray-900 text-gray-200 rounded-lg p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap"
        >
          {log.join("\n")}
        </div>
      )}

      <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 space-y-1">
        <p>
          dsh 是 DeepSeek 官方的 agent harness。安装后到「助手 → dsh」页使用 ——
          那一页就是 dsh 自己的界面，工具调用、审批、会话都由它管；
          模型来自「模型」页里已启用的供应商，密钥由 CodeShelf 以环境变量注入，不落盘。
        </p>
        <p className="text-gray-500">
          安装内容全部落在上面的目录里，卸载即删除，不会动系统里其他 Node 包。
        </p>
      </div>
    </div>
  );
}
