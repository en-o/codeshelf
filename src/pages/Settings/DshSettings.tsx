import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle, Download, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { commands, type DshEnvStatus } from "@/bindings";
import { showToast } from "@/components/ui";

interface DshSettingsProps {
  onClose?: () => void;
}

/** Tauri 抛回来的是纯字符串，不是 Error 实例 */
function errText(e: unknown, fallback: string): string {
  return typeof e === "string" && e ? e : e instanceof Error ? e.message : fallback;
}

export function DshSettings({ onClose }: DshSettingsProps) {
  const [status, setStatus] = useState<DshEnvStatus | null>(null);
  const [busy, setBusy] = useState<"install" | "uninstall" | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const logBoxRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    const res = await commands.dshEnvStatus();
    if (res.status === "ok") setStatus(res.data);
    else showToast("error", errText(res.error, "读取 dsh 状态失败"));
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
    const res = await commands.dshInstall();
    setBusy(null);
    if (res.status === "ok") {
      setStatus(res.data);
      showToast("success", "dsh 已就绪", `版本 ${res.data.installedVersion ?? res.data.targetVersion}`);
    } else {
      showToast("error", errText(res.error, "安装失败"));
      refresh();
    }
  }

  async function handleUninstall() {
    setBusy("uninstall");
    const res = await commands.dshUninstall();
    setBusy(null);
    if (res.status === "ok") {
      setStatus(res.data);
      setLog([]);
      showToast("success", "已卸载 dsh");
    } else {
      showToast("error", errText(res.error, "卸载失败"));
    }
  }

  const ready = !!status?.installed && !!status?.profileReady;
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
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-gray-500">Node</dt>
            <dd className={status?.nodeOk ? "" : "text-amber-700"}>
              {status?.nodeVersion
                ? `${status.nodeVersion}${status.nodeOk ? "" : `（需要 v${status.nodeMinMajor} 及以上）`}`
                : "未找到"}
              {status?.nodePath ? <span className="text-gray-400"> · {status.nodePath}</span> : null}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-gray-500">安装目录</dt>
            <dd className="break-all text-gray-400">{status?.root ?? "-"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-gray-500">profile</dt>
            <dd className="break-all text-gray-400">
              {status?.profileReady ? status.profileDir : "未初始化"}
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

      {/* Node 缺失 / 版本不足：给出明确指引，不替用户装 */}
      {!status?.nodeOk && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-start gap-2 text-xs text-amber-900">
            <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium">
                需要 Node.js v{status?.nodeMinMajor ?? 22} 或更高版本
              </p>
              <p>
                dsh 用到了 Node 22 才有的 API，低版本会在启动阶段直接失败。请从 nodejs.org
                安装（或 nvm 切到 22+）后点「重新检测」。
              </p>
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
          dsh 是 DeepSeek 官方的 agent harness。安装后可在会话里把它选作对话引擎，由它接管
          工具调用与任务执行；模型走会话选中的供应商配置。
        </p>
        <p className="text-gray-500">
          安装内容全部落在上面的目录里，卸载即删除，不会动系统里其他 Node 包。
        </p>
      </div>
    </div>
  );
}
