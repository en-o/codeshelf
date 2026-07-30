import { useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  CopyPlus,
  Edit2,
  Folder,
  FolderInput,
  KeyRound,
  Lock,
  Network,
  Play,
  PlugZap,
  RefreshCw,
  Settings2,
  Square,
  Trash2,
} from "lucide-react";
import type { SshTunnel } from "@/types/toolbox";
import { DEFAULT_SSH_GROUP } from "@/types/toolbox";
import { formatBytes } from "@/services/toolbox";
import type { TunnelListCallbacks } from "./types";

interface TunnelListProps {
  tunnels: SshTunnel[];
  copiedId: string | null;
  groups: string[];
  callbacks: TunnelListCallbacks;
}

function authBadge(t: SshTunnel) {
  if (t.auth.type === "key") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
        <KeyRound size={11} />
        密钥
      </span>
    );
  }
  if (t.auth.type === "password") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        <Lock size={11} />
        密码
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">
      <Settings2 size={11} />
      ssh_config: {t.auth.hostAlias}
    </span>
  );
}

/** 私钥认证但缺少私钥路径（多见于导入后）——提醒用户重新设置 */
function needsKeyPath(t: SshTunnel) {
  return t.auth.type === "key" && !t.auth.keyPath;
}

export function TunnelList({ tunnels, copiedId, groups, callbacks }: TunnelListProps) {
  // 折叠态按「组名」记录、迁移菜单按「隧道 id」记录——2 秒轮询替换 tunnels 数组时不会被重置
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // 按分组聚合并稳定排序（默认分组置顶，其余按名），避免轮询导致分组区块抖动
  const orderedGroups = useMemo(() => {
    const map = new Map<string, SshTunnel[]>();
    for (const t of tunnels) {
      const g = t.group || DEFAULT_SSH_GROUP;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(t);
    }
    const names = Array.from(map.keys()).sort((a, b) => {
      if (a === DEFAULT_SSH_GROUP) return -1;
      if (b === DEFAULT_SSH_GROUP) return 1;
      return a.localeCompare(b);
    });
    return names.map((name) => ({ name, items: map.get(name)! }));
  }, [tunnels]);

  if (tunnels.length === 0) {
    return null;
  }

  function renderCard(t: SshTunnel) {
    const isActive = t.status === "running" || t.status === "reconnecting";
    const reconnecting = t.status === "reconnecting";
    const currentGroup = t.group || DEFAULT_SSH_GROUP;
    const otherGroups = groups.filter((g) => g !== currentGroup);
    return (
      <div key={t.id} className="re-card p-5 hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex items-center gap-2">
              <Network size={18} className="text-emerald-500" />
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  t.status === "running"
                    ? "bg-green-500 animate-pulse"
                    : reconnecting
                      ? "bg-amber-500 animate-pulse"
                      : "bg-gray-300"
                }`}
              />
            </div>

            <div className="min-w-0">
              <h4 className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                <span>{t.name}</span>
                <span className="text-xs text-gray-400">SSH 隧道</span>
              </h4>

              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`text-sm font-mono ${
                    t.status === "running"
                      ? "text-emerald-500"
                      : reconnecting
                        ? "text-amber-500"
                        : "text-gray-400"
                  }`}
                >
                  {t.exposeLan ? "0.0.0.0" : "127.0.0.1"}:{t.localPort}
                </span>
                <button
                  onClick={() => callbacks.onCopyLocal(t)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                  title="复制本地地址"
                >
                  {copiedId === t.id ? (
                    <Check size={14} className="text-green-500" />
                  ) : (
                    <Copy size={14} className="text-gray-400" />
                  )}
                </button>
              </div>

              <div className="flex items-center gap-2 mt-1 text-sm text-gray-500 flex-wrap">
                <span className="font-mono">
                  {t.sshUser ? `${t.sshUser}@` : ""}
                  {t.sshHost}:{t.sshPort}
                </span>
                <span className="text-gray-400">→</span>
                <span className="font-mono">
                  {t.remoteHost}:{t.remotePort}
                </span>
                {authBadge(t)}
                {needsKeyPath(t) && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    title="导入的私钥隧道缺少私钥路径，请编辑后重新设置"
                  >
                    <KeyRound size={11} />
                    需设置私钥
                  </span>
                )}
                {reconnecting && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    <RefreshCw size={11} className="animate-spin" />
                    重连中…
                  </span>
                )}
                {t.autoReconnect && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                    title="断线后自动重连"
                  >
                    <RefreshCw size={11} />
                    自动重连{t.reconnects > 0 ? ` ·${t.reconnects}` : ""}
                  </span>
                )}
              </div>

              {t.lastError && (
                <div className="flex items-start gap-1 mt-2 text-xs text-red-500">
                  <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
                  <span className="line-clamp-2">{t.lastError}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-6 flex-shrink-0">
            {t.status === "running" && (
              <div className="text-sm text-gray-500 space-y-0.5">
                <div>
                  连接: <span className="font-medium">{t.connections}</span>
                </div>
                <div>
                  入: <span className="font-medium">{formatBytes(t.bytesIn)}</span>
                  {" | "}
                  出: <span className="font-medium">{formatBytes(t.bytesOut)}</span>
                </div>
              </div>
            )}

            {reconnecting && <div className="text-sm text-amber-500">重连中…</div>}

            <div className="flex items-center gap-1">
              {isActive ? (
                <>
                  <button
                    onClick={() => callbacks.onTest(t)}
                    className="p-2 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors text-emerald-500"
                    title="测试连通性"
                  >
                    <PlugZap size={16} />
                  </button>
                  <button
                    onClick={() => callbacks.onStop(t.id)}
                    className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors text-red-500"
                    title="停止"
                  >
                    <Square size={16} />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => callbacks.onStart(t.id)}
                  className="p-2 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors text-green-500"
                  title="启动"
                >
                  <Play size={16} />
                </button>
              )}

              {/* 迁移分组（不停止运行中的隧道） */}
              <div className="relative">
                <button
                  onClick={() => setOpenMenuId(openMenuId === t.id ? null : t.id)}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-500"
                  title="移动到分组"
                >
                  <FolderInput size={16} />
                </button>
                {openMenuId === t.id && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpenMenuId(null)} />
                    <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] max-h-60 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1">
                      <div className="px-3 py-1.5 text-xs text-gray-400">移动到分组</div>
                      {otherGroups.length === 0 ? (
                        <div className="px-3 py-1.5 text-xs text-gray-400">
                          暂无其它分组
                          <br />
                          可在「编辑」中新建
                        </div>
                      ) : (
                        otherGroups.map((g) => (
                          <button
                            key={g}
                            onClick={() => {
                              callbacks.onMoveToGroup(t, g);
                              setOpenMenuId(null);
                            }}
                            className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 truncate"
                          >
                            {g}
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* 复制为新建 */}
              <button
                onClick={() => callbacks.onDuplicate(t)}
                className="p-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors text-blue-500"
                title="复制为新建"
              >
                <CopyPlus size={16} />
              </button>

              {!isActive && (
                <>
                  <button
                    onClick={() => callbacks.onEdit(t)}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-500"
                    title="编辑"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => callbacks.onRemove(t)}
                    className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors text-red-500"
                    title="删除"
                  >
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {orderedGroups.map(({ name, items }) => {
        const isCollapsed = collapsed[name];
        return (
          <div key={name} className="space-y-3">
            <button
              onClick={() => setCollapsed((prev) => ({ ...prev, [name]: !prev[name] }))}
              className="flex items-center gap-2 w-full text-left px-1 py-1 hover:opacity-80 transition-opacity"
            >
              {isCollapsed ? (
                <ChevronRight size={16} className="text-gray-400" />
              ) : (
                <ChevronDown size={16} className="text-gray-400" />
              )}
              <Folder size={15} className="text-gray-400" />
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{name}</span>
              <span className="text-xs text-gray-400">{items.length}</span>
            </button>
            {!isCollapsed && <div className="space-y-4">{items.map((t) => renderCard(t))}</div>}
          </div>
        );
      })}
    </div>
  );
}
