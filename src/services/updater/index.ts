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
  /** 预览版：会检查并提示新版本，但不下载、不安装，只能手动下载安装包覆盖安装 */
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
 * 自动更新（下载 + 安装）的**唯一守卫**。预览版在这里断流。
 *
 * 三条自动路径（downloadUpdate / installUpdate / downloadAndInstallUpdate）都经过它，
 * 就不用在每个入口各加一处、也不会漏掉以后新增的路径。
 *
 * **检查不在此列**：预览版仍然要能感知到「正式版出了新版本」并提示用户，
 * 只是升级动作得用户自己去下载安装包覆盖装。
 */
async function ensureAutoUpdatable(): Promise<void> {
  if ((await getReleaseChannel()) === "preview") {
    throw new Error("预览版不支持自动更新，请手动下载安装包覆盖安装");
  }
}

/** 该版本对应的 GitHub Release 页；预览版的「去下载」按钮指向它 */
export function releasePageUrl(version?: string): string {
  if (!version) return "https://github.com/en-o/codeshelf/releases/latest";
  const tag = version.startsWith("v") ? version : `v${version}`;
  return `https://github.com/en-o/codeshelf/releases/tag/${tag}`;
}

/** 打开某个版本的下载页（预览版手动升级用） */
export async function openReleaseDownload(version?: string): Promise<void> {
  await openUrl(releasePageUrl(version));
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

  // 预览版**照常检查**：用户要能知道正式版出了新版本，只是升级得自己下载安装包。
  // 标记 isPreview 让界面把「下载并安装」换成「去下载」。
  const preview = (await getReleaseChannel()) === "preview";

  try {
    const update = await check();
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
        isPreview: preview,
      };
    }

    return {
      available: false,
      currentVersion: await getVersion(),
      isPreview: preview,
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
  await ensureAutoUpdatable();
  if (!cachedUpdate) {
    const update = await check();
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
  await ensureAutoUpdatable();
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
  await ensureAutoUpdatable();
  let update = cachedUpdate;
  if (!update) {
    update = await check();
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

const RELEASES_PAGE = "https://github.com/en-o/codeshelf/releases/latest";

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
    await openUrl(RELEASES_PAGE);
  }
}
