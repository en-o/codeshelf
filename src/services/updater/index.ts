import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { resolveResource } from "@tauri-apps/api/path";
import { exists } from "@tauri-apps/plugin-fs";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { open as openUrl } from "@tauri-apps/plugin-shell";

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  version?: string;
  date?: string;
  body?: string;
  isPortable?: boolean;
  /** 当前是预览版（只在预览线内更新，界面据此显示渠道提示） */
  isPreview?: boolean;
}

export type ReleaseChannel = "stable" | "preview";

/**
 * 渠道由版本号本身决定：带 semver 预发布后缀（`0.2.0-1`）是预览版，纯 `x.y.z` 是正式版。
 *
 * 后缀只允许纯数字 —— MSI 的 ProductVersion 不接受 `-beta.1` 这类标识符，
 * 用它会让 Windows 出包直接失败（发版脚本里的版本号正则同样只放行 `-<数字>`）。
 */
export function isPreviewVersion(version: string): boolean {
  return version.includes("-");
}

let cachedChannel: ReleaseChannel | null = null;

export async function getReleaseChannel(): Promise<ReleaseChannel> {
  if (cachedChannel) return cachedChannel;
  cachedChannel = isPreviewVersion(await getVersion()) ? "preview" : "stable";
  return cachedChannel;
}

/**
 * 取远端更新的**唯一入口**：只接受与自己同渠道的版本，跨渠道一律当作"没有更新"。
 *
 * 正式版与预览版是两条基线，可以互相下载覆盖安装，但更新功能里谁都不该看到对方 ——
 * 第一道拦截在编译期（预览版包内置的 endpoint 指向预览专属清单，见
 * `src-tauri/tauri.preview.conf.json`），这里是第二道：万一清单配错 / 端点被顶掉，
 * 也不会把预览版推给正式版用户，反之亦然。
 *
 * 检查 / 下载 / 下载并安装三条路径都各自调过 `check()`，守卫放在这一层，
 * 就不用在每个入口各加一处、也不会漏掉以后新增的路径。
 */
async function checkUpstream(): Promise<Update | null> {
  const update = await check();
  if (!update) return null;
  const channel = await getReleaseChannel();
  const upstream: ReleaseChannel = isPreviewVersion(update.version) ? "preview" : "stable";
  if (upstream !== channel) {
    console.warn(
      `忽略跨渠道更新：本机是 ${channel}，远端清单给的是 ${upstream}（v${update.version}）`,
    );
    return null;
  }
  return update;
}

// 缓存已检查的更新对象，以及已完成下载、可安装的更新对象
let cachedUpdate: Update | null = null;
let downloadedUpdate: Update | null = null;

/**
 * 全局 single-flight：下载 / 安装同一时间只允许一个在跑。
 *
 * 启动通知弹窗和设置页各自维护自己的 `downloading` 状态，却共享这个模块级的
 * `cachedUpdate` / `downloadedUpdate`。两边同时点「下载」会并发调用
 * `update.download()`：进度回调互相打架，`downloadedUpdate` 被写两次，
 * 更糟的是两个下载可能写同一个临时文件。
 *
 * 用 Promise 而不是 boolean：后来者**复用**同一次下载并等它完成，
 * 而不是直接失败 —— 用户在两个入口点了同一件事，期望是"它开始下载了"。
 */
let inFlightDownload: Promise<void> | null = null;
let inFlightInstall: Promise<void> | null = null;
let isPortableVersion: boolean | null = null;

// 检查是否为便携版
export async function checkIsPortable(): Promise<boolean> {
  if (isPortableVersion !== null) {
    return isPortableVersion;
  }
  try {
    // 检查 .portable 标记文件
    const portablePath = await resolveResource(".portable");
    isPortableVersion = await exists(portablePath);
  } catch {
    // 尝试检查可执行文件同目录下的 .portable 文件
    try {
      isPortableVersion = await exists(".portable");
    } catch {
      isPortableVersion = false;
    }
  }
  return isPortableVersion;
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  // 便携版跳过更新检查
  const portable = await checkIsPortable();
  if (portable) {
    return {
      available: false,
      currentVersion: "",
      isPortable: true,
    };
  }

  // 预览版走自己的更新源（预览端点），检查逻辑与正式版一致，
  // 只是 isPreview 会传给界面提示"你在预览线上"。
  const isPreview = (await getReleaseChannel()) === "preview";

  try {
    const update = await checkUpstream();
    cachedUpdate = update;
    if (!update || downloadedUpdate?.version !== update.version) {
      downloadedUpdate = null;
    }

    if (update) {
      return {
        available: true,
        currentVersion: update.currentVersion,
        version: update.version,
        date: update.date,
        body: update.body,
        isPreview,
      };
    }

    return {
      available: false,
      currentVersion: "",
      isPreview,
    };
  } catch (error) {
    console.error("Failed to check for updates:", error);
    throw error;
  }
}

// 静默检查更新（不抛出错误）
export async function silentCheckForUpdates(): Promise<UpdateInfo | null> {
  try {
    return await checkForUpdates();
  } catch (error) {
    console.error("Silent update check failed:", error);
    return null;
  }
}

// 仅下载更新（不安装）
export async function downloadUpdate(
  onProgress?: (progress: number, total: number) => void
): Promise<void> {
  // 已有下载在跑就复用它，不再起第二个
  if (inFlightDownload) return inFlightDownload;
  inFlightDownload = doDownloadUpdate(onProgress).finally(() => {
    inFlightDownload = null;
  });
  return inFlightDownload;
}

async function doDownloadUpdate(
  onProgress?: (progress: number, total: number) => void
): Promise<void> {
  if (!cachedUpdate) {
    const update = await checkUpstream();
    if (!update) {
      throw new Error("No update available");
    }
    cachedUpdate = update;
    downloadedUpdate = null;
  }

  const update = cachedUpdate;
  let downloaded = 0;
  let contentLength = 0;

  await update.download((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength || 0;
        console.log(`Started downloading ${contentLength} bytes`);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        if (onProgress && contentLength > 0) {
          onProgress(downloaded, contentLength);
        }
        console.log(`Downloaded ${downloaded} of ${contentLength}`);
        break;
      case "Finished":
        console.log("Download finished");
        break;
    }
  });
  downloadedUpdate = update;
}

// 安装已下载的更新并重启
export async function installUpdate(): Promise<void> {
  // 安装同样只允许一个：重复调用会触发两次安装器 + 两次 relaunch
  if (inFlightInstall) return inFlightInstall;
  inFlightInstall = doInstallUpdate().finally(() => {
    inFlightInstall = null;
  });
  return inFlightInstall;
}

async function doInstallUpdate(): Promise<void> {
  if (!downloadedUpdate) {
    throw new Error("No update downloaded");
  }
  await downloadedUpdate.install();
  downloadedUpdate = null;
  await relaunch();
}

/** 供界面禁用按钮：当前是否有下载或安装在进行中 */
export function isUpdateBusy(): boolean {
  return inFlightDownload !== null || inFlightInstall !== null;
}

// 下载并安装更新（保留原有功能）
export async function downloadAndInstallUpdate(
  onProgress?: (progress: number, total: number) => void
): Promise<void> {
  // 与 downloadUpdate 共用同一把锁：两个入口打的是同一个更新
  if (inFlightDownload) return inFlightDownload;
  inFlightDownload = doDownloadAndInstall(onProgress).finally(() => {
    inFlightDownload = null;
  });
  return inFlightDownload;
}

async function doDownloadAndInstall(
  onProgress?: (progress: number, total: number) => void
): Promise<void> {
  let update = cachedUpdate;
  if (!update) {
    update = await checkUpstream();
    if (!update) {
      throw new Error("No update available");
    }
    cachedUpdate = update;
  }

  let downloaded = 0;
  let contentLength = 0;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength || 0;
        console.log(`Started downloading ${contentLength} bytes`);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        if (onProgress && contentLength > 0) {
          onProgress(downloaded, contentLength);
        }
        console.log(`Downloaded ${downloaded} of ${contentLength}`);
        break;
      case "Finished":
        console.log("Download finished");
        break;
    }
  });
  downloadedUpdate = null;
  await relaunch();
}

// ========== 架构检测（处理 Intel 二进制装在 Apple Silicon 上的更新错配） ==========

export interface ArchStatus {
  /** 当前 app 二进制的编译架构 "x86_64" / "aarch64" / ... */
  binaryArch: string;
  /** 宿主机的真实物理架构（Rosetta 下 binary=x86_64 但 host=aarch64） */
  hostArch: string;
  os: string;
  /** 是否运行在 Rosetta 翻译层下（macOS 专有） */
  isRosetta: boolean;
  /** binaryArch !== hostArch 即视为不匹配 */
  mismatch: boolean;
}

let cachedArchStatus: ArchStatus | null = null;

export async function getArchStatus(): Promise<ArchStatus> {
  if (cachedArchStatus) return cachedArchStatus;
  const status = await invoke<ArchStatus>("get_arch_status");
  cachedArchStatus = status;
  return status;
}

/**
 * 已知 release 资产的命名规则（来自 tauri-action 默认）：
 *   macOS aarch64: CodeShelf_<v>_aarch64.dmg
 *   macOS x86_64 : CodeShelf_<v>_x64.dmg
 * 拼好 release 页 + 推荐 dmg 链接，用浏览器打开。
 *
 * 走浏览器而不是内置自动更新器的原因：
 * Tauri plugin-updater 按二进制架构匹配 latest.json 中的 platforms key，
 * 永远拿不到对方架构的链接；只能让浏览器接管下载。
 */
export function buildCorrectArchDmgUrl(version: string, targetArch: string): string {
  // version 形如 "0.1.26"；release tag 当前是 "vX.Y.Z"（参见 release.yml）
  const tag = version.startsWith("v") ? version : `v${version}`;
  const archSuffix = targetArch === "aarch64" ? "aarch64" : "x64";
  return `https://github.com/en-o/codeshelf/releases/download/${tag}/CodeShelf_${version.replace(
    /^v/,
    "",
  )}_${archSuffix}.dmg`;
}

/**
 * 兜底页用**这个版本自己的 tag 页**，不是 `releases/latest`：
 * latest 永远指向正式版，预览版用户点进去会被带到另一条基线上。
 */
function releasePageUrl(version: string): string {
  const tag = version.startsWith("v") ? version : `v${version}`;
  return `https://github.com/en-o/codeshelf/releases/tag/${tag}`;
}

/**
 * 用浏览器打开匹配宿主架构的 dmg 直链；同时打开 release 页作为兜底
 * （命名规则万一变了用户能自己找到对的 asset）。
 */
export async function openCorrectArchDownload(version: string, hostArch: string): Promise<void> {
  try {
    const dmgUrl = buildCorrectArchDmgUrl(version, hostArch);
    await openUrl(dmgUrl);
  } catch (err) {
    console.warn("打开直链失败，回退到 release 页", err);
    await openUrl(releasePageUrl(version));
  }
}

/**
 * 手动下载入口：有版本号就开这个版本的 tag 页，没有就退回 releases/latest。
 */
export async function openReleaseDownload(version?: string): Promise<void> {
  const url = version
    ? releasePageUrl(version)
    : "https://github.com/en-o/codeshelf/releases/latest";
  await openUrl(url);
}
