// PairDrop 纯逻辑：常量、类型、地址解析、localStorage 持久化、头像/设备展示的纯函数。
// 无 React、无副作用（localStorage 除外），可独立测试。
import type { PairDropDiscoveredDevice } from "@/types/toolbox";
import type { HistoricalPeer } from "./usePairDropClient";

/** 跨设备传输默认端口（与后端 DEFAULT_PORT 保持一致）；加入对方桌面端时未填端口用它兜底 */
export const DEFAULT_PAIRDROP_PORT = 8421;
export const REMOTE_TARGETS_STORAGE_KEY = "pairdrop:remote-targets";
export const PEER_ALIASES_STORAGE_KEY = "pairdrop:peer-aliases";
export const LOCAL_ROOM_ID = "local";

export interface RemoteTarget {
  host: string;
  port: number;
  deviceId?: string;
  displayName?: string;
}

export type ContextMenuState =
  | { kind: "local"; x: number; y: number }
  | { kind: "remote"; x: number; y: number; target: RemoteTarget }
  | { kind: "peer"; x: number; y: number; peer: HistoricalPeer };

/** 解析"加入其他桌面端"输入：支持 "192.168.1.5"、"192.168.1.5:8421"、"http://192.168.1.5:8421" */
export function parseJoinTarget(v: string): RemoteTarget | null {
  // 去掉协议头和路径/末尾斜杠
  const s = v.trim().replace(/^[a-zA-Z][\w+.-]*:\/\//, "").replace(/\/.*$/, "");
  if (!s) return null;
  const idx = s.lastIndexOf(":");
  const host = idx > 0 ? s.slice(0, idx) : s;
  const port = idx > 0 ? parseInt(s.slice(idx + 1), 10) : DEFAULT_PAIRDROP_PORT;
  // host 只允许 IPv4 / 主机名字符（含空格/非法字符一律拒，避免拼出非法 ws:// 导致崩溃）
  if (!host || !/^[a-zA-Z0-9.\-]+$/.test(host)) return null;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port };
}

export function remoteRoomId(target: RemoteTarget): string {
  if (target.deviceId) return `device:${target.deviceId}`;
  return `remote:${target.host}:${target.port}`;
}

export function remoteLabel(target: RemoteTarget): string {
  if (target.displayName) return target.displayName;
  return `${target.host}:${target.port}`;
}

export function loadRemoteTargets(): RemoteTarget[] {
  try {
    const raw = localStorage.getItem(REMOTE_TARGETS_STORAGE_KEY);
    if (!raw) return [];
    const values = JSON.parse(raw) as Array<{
      host?: string;
      port?: number;
      deviceId?: string;
      displayName?: string;
    }>;
    if (!Array.isArray(values)) return [];
    return values.filter(
      (value): value is RemoteTarget =>
        !!value.host &&
        Number.isInteger(value.port) &&
        value.port! > 0 &&
        value.port! <= 65535
    );
  } catch {
    return [];
  }
}

export function saveRemoteTargets(targets: RemoteTarget[]) {
  localStorage.setItem(REMOTE_TARGETS_STORAGE_KEY, JSON.stringify(targets));
}

export function loadPeerAliases(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PEER_ALIASES_STORAGE_KEY);
    if (!raw) return {};
    const aliases = JSON.parse(raw) as Record<string, string>;
    return aliases && typeof aliases === "object" ? aliases : {};
  } catch {
    return {};
  }
}

export function savePeerAliases(aliases: Record<string, string>) {
  localStorage.setItem(PEER_ALIASES_STORAGE_KEY, JSON.stringify(aliases));
}

export function targetFromDiscovery(device: PairDropDiscoveredDevice): RemoteTarget {
  return {
    host: device.host,
    port: device.port,
    deviceId: device.deviceId,
    displayName: device.displayName,
  };
}

export function isSameRemoteTarget(a: RemoteTarget, b: RemoteTarget): boolean {
  if (a.deviceId && b.deviceId) return a.deviceId === b.deviceId;
  return a.host === b.host && a.port === b.port;
}

export function deviceLabel(t: string) {
  if (t === "desktop") return "桌面端";
  if (t === "mobile") return "手机";
  return "浏览器";
}

export function avatarLabel(name: string): string {
  if (!name) return "?";
  const ascii = name.match(/[A-Za-z0-9]/);
  if (ascii) return ascii[0].toUpperCase();
  return name.trim().charAt(0) || "?";
}

export function avatarColor(id: string): string {
  if (!id) return "#9ca3af";
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffffff;
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 55%)`;
}
