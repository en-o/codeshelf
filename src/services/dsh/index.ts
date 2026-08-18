import { listen } from "@tauri-apps/api/event";
import {
  commands,
  type DshEnvStatus,
  type DshLaunchConfig,
  type DshProviderSpec,
  type DshWebStatus,
  type NodeCandidate,
} from "@/bindings";

export type { DshEnvStatus, DshLaunchConfig, DshProviderSpec, DshWebStatus, NodeCandidate };

// ========== 事件 ==========

/** 安装过程的日志行 */
export function listenDshInstallLog(handler: (line: string) => void) {
  return listen<string>("dsh-install-log", (e) => handler(e.payload));
}

// ========== 命令 ==========

/** bindings 的 Result 包装展开成「成功返回值 / 抛字符串」，与其它 service 的调用习惯一致 */
async function unwrap<T>(p: Promise<{ status: "ok"; data: T } | { status: "error"; error: string }>): Promise<T> {
  const res = await p;
  if (res.status === "ok") return res.data;
  throw res.error;
}

export const dshEnvStatus = () => unwrap(commands.dshEnvStatus());
/** 列出检测到的所有 node（含版本不够的），用于让用户在 nvm 的多个版本里挑 */
export const dshListNodes = () => unwrap(commands.dshListNodes());
/** 指定用哪个 node；传 null 恢复自动选择 */
export const dshSetNode = (path: string | null) => unwrap(commands.dshSetNode(path));
export const dshInstall = () => unwrap(commands.dshInstall());
export const dshUninstall = () => unwrap(commands.dshUninstall());

// ========== 官方 Web 界面 ==========

export const dshWebStatus = () => unwrap(commands.dshWebStatus());
/**
 * 启动（或复用）dsh，返回它的地址（前端 iframe 内嵌）。
 * 配置里带着「模型」页的全部供应商，dsh 那边因此直接用上你自己的模型。
 * 首次启动要初始化它的 web profile，可能几十秒。
 */
export const dshWebOpen = (config: DshLaunchConfig) => unwrap(commands.dshWebOpen(config));
export const dshWebStop = () => unwrap(commands.dshWebStop());

/** dsh web 的启动日志 */
export function listenDshWebLog(handler: (line: string) => void) {
  return listen<string>("dsh-web-log", (e) => handler(e.payload));
}
