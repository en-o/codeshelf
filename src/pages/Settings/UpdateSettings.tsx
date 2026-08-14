import { useState, useEffect } from "react";
import { Download, RefreshCw, CheckCircle, AlertCircle, Loader2, ExternalLink } from "lucide-react";
import {
  checkForUpdates,
  downloadAndInstallUpdate,
  getArchStatus,
  getReleaseChannel,
  openCorrectArchDownload,
  type UpdateInfo,
  type ArchStatus,
  type ReleaseChannel,
} from "@/services/updater";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import { useSettingsStore } from "@/stores/settingsStore";
import { ArchMismatchDialog, type ArchMismatchChoice, showToast } from "@/components/ui";

export function UpdateSettings() {
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>("...");
  const [archMismatch, setArchMismatch] = useState<ArchStatus | null>(null);
  const [channel, setChannel] = useState<ReleaseChannel>("stable");
  const autoUpdate = useSettingsStore((state) => state.autoUpdate);
  const setAutoUpdate = useSettingsStore((state) => state.setAutoUpdate);
  const isPreview = channel === "preview";

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => setCurrentVersion("未知"));
    getReleaseChannel().then(setChannel).catch(() => setChannel("stable"));
  }, []);

  async function handleCheckUpdate() {
    setChecking(true);
    setError(null);
    try {
      const info = await checkForUpdates();
      setUpdateInfo(info);
    } catch (err) {
      setError(String(err));
    } finally {
      setChecking(false);
    }
  }

  async function runSameArchDownload() {
    setDownloading(true);
    setError(null);
    setProgress(0);
    try {
      await downloadAndInstallUpdate((downloaded, total) => {
        setProgress(Math.round((downloaded / total) * 100));
      });
    } catch (err) {
      setError(String(err));
      setDownloading(false);
    }
  }

  /** 入口：点"下载并安装"。先检测架构，匹配则直接下；不匹配则弹窗等用户确认。 */
  async function handleDownloadUpdate() {
    let arch: ArchStatus | null = null;
    try {
      arch = await getArchStatus();
    } catch (err) {
      console.warn("架构检测失败，按同架构走默认更新流程", err);
    }
    if (arch?.mismatch) {
      // 阻塞 —— 弹窗交给用户选择；选择前不做任何下载
      setArchMismatch(arch);
      return;
    }
    runSameArchDownload();
  }

  function handleArchConfirm(choice: ArchMismatchChoice) {
    const arch = archMismatch;
    const info = updateInfo;
    setArchMismatch(null);
    if (!arch || !info) return;
    if (choice === "same") {
      runSameArchDownload();
    } else {
      if (!info.version) {
        showToast("warning", "未拿到新版本号", "请前往 GitHub Releases 手动下载");
        open("https://github.com/en-o/codeshelf/releases/latest");
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
        });
    }
  }

  function handleArchCancel() {
    setArchMismatch(null);
    // 不改 downloading / progress：用户取消相当于回到点击前的状态
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-gray-200">
        <h4 className="text-sm font-semibold text-gray-900">应用更新</h4>
      </div>

      {/* 当前版本 */}
      <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
              当前版本
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  isPreview ? "bg-amber-100 text-amber-700" : "bg-gray-200 text-gray-600"
                }`}
              >
                {isPreview ? "预览版" : "正式版"}
              </span>
            </p>
            <p className="text-xs text-gray-500 mt-1">v{currentVersion}</p>
          </div>
          {isPreview ? (
            <button
              onClick={() => open("https://github.com/en-o/codeshelf/releases")}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition-colors"
            >
              <ExternalLink size={16} />
              手动下载
            </button>
          ) : (
            <button
              onClick={handleCheckUpdate}
              disabled={checking || downloading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {checking ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              {checking ? "检查中..." : "检查更新"}
            </button>
          )}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center gap-2 text-red-700">
            <AlertCircle size={16} />
            <span className="text-sm">{error}</span>
          </div>
        </div>
      )}

      {/* 更新信息 */}
      {updateInfo && !error && (
        <div className={`p-4 border rounded-lg ${updateInfo.available ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
          {updateInfo.available ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-700">
                <Download size={16} />
                <span className="text-sm font-medium">发现新版本{updateInfo.version ? `：v${updateInfo.version}` : ''}</span>
              </div>
              {updateInfo.body && (
                <div className="text-xs text-gray-600 whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {updateInfo.body}
                </div>
              )}
              {downloading ? (
                <div className="space-y-2">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 text-center">{progress}% 下载中...</p>
                </div>
              ) : (
                <button
                  onClick={handleDownloadUpdate}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 transition-colors"
                >
                  <Download size={16} />
                  下载并安装更新
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-gray-700">
              <CheckCircle size={16} className="text-green-500" />
              <span className="text-sm">已是最新版本</span>
            </div>
          )}
        </div>
      )}

      {/* 预览版：不检查、不下载、不安装，只能手动下载安装包覆盖安装 */}
      {isPreview && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 space-y-1">
              <p className="text-sm font-medium">这是预览版，不参与自动更新</p>
              <p>预览版不会检查、下载或安装更新，也不会收到新版本提示。</p>
              <p>
                需要升级时请到 GitHub Releases 手动下载新版安装包，直接覆盖安装即可（数据不会丢失）。
                装上正式版（版本号形如 0.2.0，无 <code>-</code> 后缀）后会自动恢复自动更新。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 自动更新开关（预览版没有自动更新，开关不显示） */}
      {!isPreview && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">自动检查更新</p>
              <p className="text-xs text-gray-500 mt-1">
                {autoUpdate ? "启动时自动检查并下载更新" : "已关闭自动更新，你仍可手动检查更新"}
              </p>
            </div>
            <button
              onClick={() => setAutoUpdate(!autoUpdate)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                autoUpdate ? "bg-blue-500" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  autoUpdate ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
      )}

      {/* 说明 */}
      <div className="p-3 bg-blue-50/50 border border-blue-200/50 rounded-lg">
        <div className="flex items-start gap-2">
          <AlertCircle size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-blue-900">
            <p>
              {isPreview
                ? "预览版只能手动升级：下载新安装包后覆盖安装即可。"
                : "应用会自动检查 GitHub Releases 上的新版本。下载完成后将自动重启应用以完成更新。"}
            </p>
            <button
              onClick={() => open("https://github.com/en-o/codeshelf/releases")}
              className="inline-flex items-center gap-1 mt-1 text-blue-600 hover:text-blue-800 hover:underline"
            >
              <span>前往 GitHub 手动下载</span>
              <ExternalLink size={12} />
            </button>
          </div>
        </div>
      </div>

      {archMismatch && (
        <ArchMismatchDialog
          open
          arch={archMismatch}
          version={updateInfo?.version}
          onCancel={handleArchCancel}
          onConfirm={handleArchConfirm}
        />
      )}
    </div>
  );
}
