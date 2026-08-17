import { listen } from "@tauri-apps/api/event";
import {
  commands,
  type DshEngineConfig,
  type DshEngineStatus,
  type DshEnvStatus,
  type DshWebStatus,
  type NodeCandidate,
} from "@/bindings";

export type { DshEngineConfig, DshEngineStatus, DshEnvStatus, DshWebStatus, NodeCandidate };

// ========== 事件 ==========

/**
 * dsh 的会话日志事件。这里只声明我们真正会渲染的那些字段 ——
 * dsh 的事件表还在扩张（0.1.0-rc，官方明说会变），把整张表抄进来只会更快过期。
 * 没列出的 type 一律忽略即可，不影响对话。
 */
export interface DshSessionEvent {
  type: string;
  seq: number;
  time: number;
  data: Record<string, unknown>;
}

/** 流式增量块（assistant/chunk 的 data.chunk） */
export interface DshStreamChunk {
  type: "block-start" | "text-delta" | "reasoning-delta" | "tool-call-delta" | "block-end" | "usage" | "finish";
  text?: string;
  delta?: string;
  reason?: { kind: string; error?: { message?: string; code?: string } };
  [key: string]: unknown;
}

export interface DshNotification {
  method: "session.event" | "session.status" | "subagent.started" | "subagent.finished";
  params: Record<string, unknown>;
  /**
   * 发起该会话的调用方 id（CodeShelf 的会话 id），由 Rust 侧回填。
   * dsh 自己的 sessionId 每次启动引擎都会换，别拿它做匹配。
   */
  sessionKey: string | null;
}

export interface DshEngineExit {
  pid: number;
  code: number | null;
  stderr: string;
}

/** 订阅引擎事件；返回取消函数。注意 listen 本身是异步的，调用方要先 await 再发消息。 */
export function listenDshEvents(handler: (n: DshNotification) => void) {
  return listen<DshNotification>("dsh-event", (e) => handler(e.payload));
}

/** 引擎进程退出（正常关闭或崩溃） */
export function listenDshExit(handler: (e: DshEngineExit) => void) {
  return listen<DshEngineExit>("dsh-engine-exit", (e) => handler(e.payload));
}

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

export const dshEngineStatus = () => unwrap(commands.dshEngineStatus());
export const dshEngineStart = (config: DshEngineConfig) => unwrap(commands.dshEngineStart(config));
export const dshEngineStop = () => unwrap(commands.dshEngineStop());
/** 返回入队回执 messageId；回答走事件流 */
export const dshEnginePrompt = (sessionKey: string, text: string) =>
  unwrap(commands.dshEnginePrompt(sessionKey, text));

// ========== 官方 Web 界面 ==========

export const dshWebStatus = () => unwrap(commands.dshWebStatus());
/** 启动（或复用）dsh web 并在应用内窗口打开；首次使用要初始化 profile，可能几十秒 */
export const dshWebOpen = (cwd: string | null) => unwrap(commands.dshWebOpen(cwd));
export const dshWebStop = () => unwrap(commands.dshWebStop());

/** dsh web 的启动日志 */
export function listenDshWebLog(handler: (line: string) => void) {
  return listen<string>("dsh-web-log", (e) => handler(e.payload));
}
