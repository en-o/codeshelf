import { useState, useEffect } from "react";
import { Download, X, RefreshCw, CheckCircle, ExternalLink, AlertCircle, FileText } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import {
  silentCheckForUpdates,
  downloadUpdate,
  installUpdate,
  getArchStatus,
  openCorrectArchDownload,
  openReleaseDownload,
  type UpdateInfo,
  type ArchStatus,
} from "@/services/updater";
import { showToast } from "@/components/ui/Toast";
import { ArchMismatchDialog, type ArchMismatchChoice } from "@/components/ui/ArchMismatchDialog";
import { useSettingsStore } from "@/stores/settingsStore";

const RELEASES_URL = "https://github.com/en-o/codeshelf/releases/latest";
const DEFAULT_RELEASE_NOTE = "修复了一些问题";

type UpdateState = "idle" | "checking" | "available" | "downloading" | "ready" | "error" | "manual";

function getReleaseNotes(info: UpdateInfo | null): string {
  if (!info?.body || !info.body.trim()) return DEFAULT_RELEASE_NOTE;
  return info.body.trim();
}

export function UpdateNotification() {
  const [state, setState] = useState<UpdateState>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  /** 架构不匹配时阻塞自动下载，等用户确认 */
  const [archMismatch, setArchMismatch] = useState<ArchStatus | null>(null);
  const autoUpdate = useSettingsStore((state) => state.autoUpdate);

  // 启动时静默检查更新（仅在自动更新开启时）
  useEffect(() => {
    if (!autoUpdate) return;

    async function checkUpdate() {
      setState("checking");
      const info = await silentCheckForUpdates();

      if (info?.available) {
        setUpdateInfo(info);
        const notes = getReleaseNotes(info);
        // 记录到通知中心（含更新说明）
        showToast(
          "info",
          `发现新版本${info.version ? ` v${info.version}` : ''}`,
          notes,
        );
        // 预览版到此为止：只提示，不下载不安装，升级由用户手动覆盖安装
        if (info.isPreview) {
          setState("manual");
          setShowNotes(true);
          return;
        }
        setState("available");
        // 下载前先检测架构 —— 不匹配则弹窗拦截，等用户手动确认
        let arch: ArchStatus | null = null;
        try {
          arch = await getArchStatus();
        } catch (err) {
          console.warn("架构检测失败，按同架构走默认更新流程", err);
        }
        if (arch?.mismatch) {
          setArchMismatch(arch);
          // 故意不调 startDownload —— 必须等 ArchMismatchDialog 的 onConfirm
          return;
        }
        startDownload(info);
      } else {
        setState("idle");
      }
    }

    // 延迟 2 秒后检查，避免影响启动体验
    const timer = setTimeout(checkUpdate, 2000);
    return () => clearTimeout(timer);
  }, []);

  /** 用户在 ArchMismatchDialog 上点了"确认"后才会触发 */
  function handleArchConfirm(choice: ArchMismatchChoice) {
    const arch = archMismatch;
    const info = updateInfo;
    setArchMismatch(null);
    if (!arch || !info) return;
    if (choice === "same") {
      // 继续当前架构的自动更新
      startDownload(info);
    } else {
      // 浏览器打开匹配宿主架构的 dmg 直链
      if (!info.version) {
        showToast("warning", "未拿到新版本号", "请前往 GitHub Releases 手动下载");
        open(RELEASES_URL);
        setDismissed(true);
        return;
      }
      openCorrectArchDownload(info.version, arch.hostArch)
        .then(() => {
          showToast(
            "info",
            "已在浏览器打开下载",
            "下载完成后双击 dmg，将 CodeShelf 拖入 Applications 替换原 app 即可。数据不会丢失。",
          );
        })
        .catch((err) => {
          console.error("打开下载失败", err);
          showToast("error", "打开下载失败", "请手动前往 GitHub Releases");
          open(RELEASES_URL);
        });
      // 用户走了手动通道，关掉通知卡片
      setDismissed(true);
    }
  }

  /** 用户取消 / 关闭弹窗：什么也不做，更新流程中止 */
  function handleArchCancel() {
    setArchMismatch(null);
    setState("idle");
  }

  async function startDownload(info: UpdateInfo) {
    setState("downloading");
    setProgress(0);
    try {
      await downloadUpdate((downloaded, total) => {
        setProgress(Math.round((downloaded / total) * 100));
      });
      setState("ready");
      setShowNotes(true);
      const notes = getReleaseNotes(info);
      showToast(
        "success",
        `${info.version ? `v${info.version} ` : ''}更新已就绪`,
        notes,
      );
    } catch (error) {
      console.error("Download failed:", error);
      setState("error");
      // 记录下载失败
      showToast("error", "更新下载失败", "请手动前往下载页面获取新版本");
    }
  }

  async function handleInstall() {
    try {
      await installUpdate();
    } catch (error) {
      console.error("Install failed:", error);
      setState("error");
      // 记录安装失败
      showToast("error", "更新安装失败", "请手动前往下载页面获取新版本");
    }
  }

  async function handleOpenReleases() {
    await open(RELEASES_URL);
  }

  function handleDismiss() {
    setDismissed(true);
  }

  // 架构不匹配的弹窗优先；此时不渲染常规通知卡（避免它显示"正在后台下载"误导）
  if (archMismatch) {
    return (
      <ArchMismatchDialog
        open
        arch={archMismatch}
        version={updateInfo?.version}
        onCancel={handleArchCancel}
        onConfirm={handleArchConfirm}
      />
    );
  }

  // 不显示通知的情况
  if (dismissed || state === "idle" || state === "checking") {
    return null;
  }

  const releaseNotes = getReleaseNotes(updateInfo);

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-sm animate-slide-up">
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
        {/* 下载进度条 */}
        {state === "downloading" && (
          <div className="h-1 bg-gray-100">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        <div className="p-4">
          <div className="flex items-start gap-3">
            {/* 图标 */}
            <div className="flex-shrink-0">
              {state === "downloading" ? (
                <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
              ) : state === "ready" ? (
                <CheckCircle className="w-5 h-5 text-green-500" />
              ) : state === "error" ? (
                <AlertCircle className="w-5 h-5 text-orange-500" />
              ) : (
                <Download className="w-5 h-5 text-blue-500" />
              )}
            </div>

            {/* 内容 */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {state === "downloading"
                  ? "正在下载更新..."
                  : state === "ready"
                  ? "更新已就绪"
                  : state === "error"
                  ? "自动更新失败"
                  : `发现新版本${updateInfo?.version ? ` v${updateInfo.version}` : ''}`}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {state === "downloading"
                  ? `${progress}%`
                  : state === "ready"
                  ? "点击安装并重启应用"
                  : state === "error"
                  ? "请手动前往下载页面获取新版本"
                  : "正在后台下载..."}
              </p>
            </div>

            {/* 关闭按钮 */}
            <button
              onClick={handleDismiss}
              className="flex-shrink-0 p-1 rounded hover:bg-gray-100 transition-colors"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          {/* 更新说明 */}
          <div className="mt-3 border-t border-gray-100 pt-3">
            <button
              onClick={() => setShowNotes(!showNotes)}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors w-full"
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="font-medium">更新说明</span>
              <svg
                className={`w-3 h-3 ml-auto transition-transform ${showNotes ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showNotes && (
              <div className="mt-2 text-xs text-gray-600 whitespace-pre-wrap max-h-40 overflow-y-auto bg-gray-50 rounded-md p-2.5 leading-relaxed">
                {releaseNotes}
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          {state === "ready" && (
            <button
              onClick={handleInstall}
              className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 transition-colors"
            >
              <Download className="w-4 h-4" />
              立即安装并重启
            </button>
          )}

          {state === "manual" && (
            <button
              onClick={() => {
                openReleaseDownload(updateInfo?.version);
                setDismissed(true);
              }}
              className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              去下载{updateInfo?.version ? ` v${updateInfo.version}` : ""}
            </button>
          )}

          {state === "error" && (
            <button
              onClick={handleOpenReleases}
              className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              前往下载页面
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
