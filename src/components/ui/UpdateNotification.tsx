import { useState, useEffect } from "react";
import { Download, X, RefreshCw, CheckCircle, ExternalLink, AlertCircle } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import {
  silentCheckForUpdates,
  downloadUpdate,
  installUpdate,
  type UpdateInfo,
} from "@/services/updater";

const RELEASES_URL = "https://github.com/en-o/codeshelf/releases/latest";

type UpdateState = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

export function UpdateNotification() {
  const [state, setState] = useState<UpdateState>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // 启动时静默检查更新
  useEffect(() => {
    async function checkUpdate() {
      setState("checking");
      const info = await silentCheckForUpdates();

      if (info?.available) {
        setUpdateInfo(info);
        setState("available");
        // 自动开始下载
        startDownload();
      } else {
        setState("idle");
      }
    }

    // 延迟 2 秒后检查，避免影响启动体验
    const timer = setTimeout(checkUpdate, 2000);
    return () => clearTimeout(timer);
  }, []);

  async function startDownload() {
    setState("downloading");
    setProgress(0);
    try {
      await downloadUpdate((downloaded, total) => {
        setProgress(Math.round((downloaded / total) * 100));
      });
      setState("ready");
    } catch (error) {
      console.error("Download failed:", error);
      setState("error");
    }
  }

  async function handleInstall() {
    try {
      await installUpdate();
    } catch (error) {
      console.error("Install failed:", error);
      setState("error");
    }
  }

  async function handleOpenReleases() {
    await open(RELEASES_URL);
  }

  function handleDismiss() {
    setDismissed(true);
  }

  // 不显示通知的情况
  if (dismissed || state === "idle" || state === "checking") {
    return null;
  }

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
                  : `发现新版本 v${updateInfo?.version}`}
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
