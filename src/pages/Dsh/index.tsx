import { useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { ExternalLink, FolderOpen, Loader2, RefreshCw, Square } from "lucide-react";
import { PageHeader } from "@/components/common";
import { showToast } from "@/components/ui";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";
import { useAiProvidersStore } from "@/stores/aiProvidersStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import {
  dshEnvStatus,
  dshWebOpen,
  dshWebStop,
  listenDshWebLog,
  type DshEnvStatus,
} from "@/services/dsh";
import { DSH_DEFAULT_MODEL_KEY, toDshProviders } from "./providers";

/** 工作目录记在本地：dsh 自己也有工作区管理，这里只决定它的启动目录 */
const CWD_KEY = "dsh.cwd";

/**
 * dsh 页：整页就是内嵌的 dsh 官方界面。
 *
 * 不再自绘会话界面 —— 那与「对话」页功能重合，而官方界面里的审批、plan、
 * 工作区管理是我们没有的。CodeShelf 只负责三件事：装运行时、把「模型」页里的
 * 供应商映射成它的模型路由、把它嵌进来。
 */
export function DshPage() {
  const { aiProviders, ensureAiDefaultProvider } = useAiProvidersStore();
  const { sidebarCollapsed, setSidebarCollapsed } = useSettingsStore();
  const setCurrentPage = useUiStore((s) => s.setCurrentPage);

  const [env, setEnv] = useState<DshEnvStatus | null>(null);
  const [webUrl, setWebUrl] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [log, setLog] = useState("");
  const [cwd, setCwd] = useLocalStorageState<string>(CWD_KEY, "");
  const [defaultModelKey] = useLocalStorageState<string>(DSH_DEFAULT_MODEL_KEY, "");
  /** 已经自动起过一次就不再重试，免得启动失败后每次渲染都重来 */
  const autoStartedRef = useRef(false);

  const normalized = useMemo(() => ensureAiDefaultProvider(aiProviders), [aiProviders, ensureAiDefaultProvider]);
  const dshProviders = useMemo(() => toDshProviders(normalized), [normalized]);

  /** 默认模型：设置页选的那个；没选就用第一个可用供应商的第一个模型 */
  const defaultChoice = useMemo(() => {
    const [providerId, model] = defaultModelKey.split("::");
    const picked = dshProviders.find((p) => p.id === providerId && p.models.includes(model));
    if (picked) return { providerId, model };
    const first = dshProviders[0];
    return first ? { providerId: first.id, model: first.models[0] } : null;
  }, [defaultModelKey, dshProviders]);

  const ready = !!env?.installed && !!env?.nodeOk;

  useEffect(() => {
    dshEnvStatus().then(setEnv).catch(() => setEnv(null));
    const un = listenDshWebLog(setLog);
    return () => {
      un.then((f) => f());
    };
  }, []);

  async function start() {
    if (!defaultChoice) {
      showToast("warning", "还没有可用的模型", "先到「模型」页配置供应商与模型");
      return;
    }
    setStarting(true);
    setLog("");
    try {
      const status = await dshWebOpen({
        cwd,
        providerId: defaultChoice.providerId,
        model: defaultChoice.model,
        providers: dshProviders,
      });
      setWebUrl(status.url);
    } catch (e) {
      // Tauri 抛回来的是纯字符串，不是 Error 实例
      const text = typeof e === "string" && e ? e : e instanceof Error ? e.message : "启动失败";
      showToast("error", "dsh 启动失败", text);
    } finally {
      setStarting(false);
    }
  }

  // 就绪就自动起，省一次点击；失败后不自动重试
  useEffect(() => {
    if (!ready || webUrl || starting || autoStartedRef.current) return;
    autoStartedRef.current = true;
    start();
  }, [ready, webUrl, starting, defaultChoice]);

  /** 换工作目录/换模型都要重开服务：这些值只在启动那一刻读进去 */
  async function restart() {
    await dshWebStop().catch(() => {});
    setWebUrl(null);
    autoStartedRef.current = false;
    await start();
  }

  async function handlePickCwd() {
    const picked = await openDialog({ directory: true, multiple: false, title: "选择 dsh 的工作目录" });
    if (!picked || Array.isArray(picked)) return;
    setCwd(picked as string);
    if (webUrl) await restart();
  }

  const cwdName = cwd ? cwd.split("/").filter(Boolean).pop() : null;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <PageHeader
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
        title={
          <span className="flex items-center gap-3 min-w-0">
            🤖 dsh
            {/* 说明放标题旁边而不是底部整条：底部那条太占版面，
                这里一行带过，完整内容挂 title 上 */}
            <span
              className="text-[11px] font-normal text-gray-400 truncate hidden lg:inline"
              title={
                `模型来自「模型」页里已启用的供应商，默认那个在 设置 → dsh 引擎 里选；` +
                `密钥由 CodeShelf 以环境变量注入，在 dsh 里显示为「由启动环境提供」；` +
                `会话与工作区由 dsh 自己管理。` +
                (webUrl ? `\n${webUrl}` : "")
              }
            >
              模型来自「模型」页 · 密钥由 CodeShelf 注入 · 会话由 dsh 管理
            </span>
          </span>
        }
      >
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`px-2 py-0.5 rounded-full ${
              !ready
                ? "bg-amber-100 text-amber-700"
                : webUrl
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-600"
            }`}
            title={env?.root}
          >
            {!ready ? "未安装" : webUrl ? "运行中" : "已就绪"}
          </span>
          <button
            className="px-2 py-1 border border-gray-200 rounded-lg flex items-center gap-1 text-gray-600 hover:bg-gray-50"
            onClick={handlePickCwd}
            title={cwd || "未选工作目录（默认用户主目录）"}
          >
            <FolderOpen size={12} />
            {cwdName ?? "工作目录"}
          </button>
          {webUrl && (
            <>
              <button
                className="px-2 py-1 border border-gray-200 rounded-lg flex items-center gap-1 text-gray-600 hover:bg-gray-50"
                onClick={restart}
                title="按当前工作目录与模型设置重开服务"
              >
                <RefreshCw size={12} /> 重启
              </button>
              <button
                className="px-2 py-1 border border-gray-200 rounded-lg flex items-center gap-1 text-gray-600 hover:bg-gray-50"
                onClick={() => openUrl(webUrl)}
                title="内嵌显示不出来时的兜底：用系统浏览器打开同一个地址"
              >
                <ExternalLink size={12} /> 浏览器打开
              </button>
              <button
                className="px-2 py-1 border border-gray-200 rounded-lg flex items-center gap-1 text-gray-600 hover:bg-gray-50"
                onClick={async () => {
                  await dshWebStop().catch(() => {});
                  setWebUrl(null);
                  autoStartedRef.current = true;
                }}
                title="关掉 dsh 的服务进程"
              >
                <Square size={12} /> 停止
              </button>
            </>
          )}
        </div>
      </PageHeader>

      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
        {!ready ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="re-card p-5 space-y-3 max-w-md">
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
          </div>
        ) : webUrl ? (
          <iframe
            src={webUrl}
            title="dsh"
            className="flex-1 w-full border-0"
            // 不加 sandbox：这是本机 127.0.0.1 上我们自己拉起的进程，
            // 它要用剪贴板、下载、弹窗，限死了功能会缺一半
          />
        ) : (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="re-card p-5 space-y-2 text-sm text-gray-600 max-w-md">
              <div className="flex items-center gap-2">
                {starting ? <Loader2 size={16} className="animate-spin text-blue-500" /> : null}
                {starting ? "正在启动 dsh…" : "服务已停止"}
              </div>
              <p className="text-xs text-gray-500">
                首次启动会现场初始化 dsh 的 web profile，可能要几十秒。
              </p>
              {log && <p className="text-[11px] text-gray-400 font-mono break-all">{log}</p>}
              {!starting && (
                <button className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded-lg" onClick={start}>
                  重新启动
                </button>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
