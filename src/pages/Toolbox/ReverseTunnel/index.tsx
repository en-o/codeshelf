// 内网穿透（公网映射）—— 通过 SSH 反向隧道把本地服务暴露到你自己的 VPS 公网端口。
// 典型用途：微信/支付等回调只能填外网域名/IP 时，把本地开发服务临时映射出去调试。
//
// 独立于「SSH 隧道」工具（那个是正向 -L），本页是反向 -R。后端见 reverse_tunnel 模块。

import { useEffect, useMemo, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  AlertTriangle,
  BookOpen,
  Copy,
  CopyPlus,
  FileDown,
  FileUp,
  Globe,
  Layers,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import { Button, showToast } from "@/components/ui";
import { LoadingSpinner } from "@/components/common";
import { ToolPanelHeader } from "../index";
import { ReverseTunnelHelpDialog } from "./ReverseTunnelHelp";
import { ReverseTunnelExportDialog } from "./ReverseTunnelExportDialog";
import { TunnelFormDialog } from "./TunnelFormDialog";
import {
  addReverseTunnel,
  getReverseTunnels,
  listReverseSshConfigHosts,
  removeReverseTunnel,
  setReverseTunnelGroup,
  startReverseTunnel,
  stopReverseTunnel,
  updateReverseTunnel,
} from "@/services/toolbox";
import { DEFAULT_SSH_GROUP } from "@/types/toolbox";
import type {
  ReverseTunnel as ReverseTunnelModel,
  ReverseTunnelInput,
  SshAuthMethod,
} from "@/types/toolbox";

/** 公网访问地址：优先域名，否则 SSH 主机；端口即 VPS 上暴露的端口 */
function publicUrl(t: ReverseTunnelModel): string {
  const host = (t.domain && t.domain.trim()) || t.sshHost || "your-vps";
  return `http://${host}:${t.remotePort}`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

interface ReverseTunnelProps {
  onBack: () => void;
}

/** 表单弹窗状态：null=关闭；否则区分新建/编辑及其初始值（复制=create + 预填源项） */
type FormState = { mode: "create" | "edit"; initial: ReverseTunnelModel | null };

export function ReverseTunnel({ onBack }: ReverseTunnelProps) {
  const [tunnels, setTunnels] = useState<ReverseTunnelModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [sshConfigHosts, setSshConfigHosts] = useState<string[]>([]);
  const [formState, setFormState] = useState<FormState | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [groupMenuFor, setGroupMenuFor] = useState<string | null>(null);

  // 已有分组（去重，默认分组置顶），供表单下拉与迁移菜单使用
  const groups = useMemo(() => {
    const set = new Set<string>([DEFAULT_SSH_GROUP]);
    for (const t of tunnels) set.add(t.group || DEFAULT_SSH_GROUP);
    return Array.from(set);
  }, [tunnels]);

  // 按分组聚合列表（默认分组置顶，其余按名）
  const grouped = useMemo(() => {
    const map = new Map<string, ReverseTunnelModel[]>();
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

  useEffect(() => {
    loadAll();
    listReverseSshConfigHosts()
      .then(setSshConfigHosts)
      .catch((err) => console.warn("读取 ~/.ssh/config 失败:", err));
    const interval = setInterval(() => { if (!document.hidden) loadAll(); }, 2000);
    return () => clearInterval(interval);
  }, []);

  async function loadAll() {
    try {
      setTunnels(await getReverseTunnels());
    } catch (err) {
      console.error("加载内网穿透失败:", err);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setFormState({ mode: "create", initial: null });
  }

  function openEdit(t: ReverseTunnelModel) {
    setFormState({ mode: "edit", initial: t });
  }

  // 快捷创建：基于已有映射预填，名称加「副本」，以新建模式打开
  function openDuplicate(t: ReverseTunnelModel) {
    setFormState({ mode: "create", initial: { ...t, name: `${t.name} 副本` } });
  }

  function closeDialog() {
    setFormState(null);
  }

  async function handleFormSubmit(input: ReverseTunnelInput) {
    try {
      if (formState?.mode === "edit" && formState.initial) {
        await updateReverseTunnel(formState.initial.id, input);
      } else {
        await addReverseTunnel(input);
      }
      setFormState(null);
      loadAll();
    } catch (err) {
      showToast("error", `保存失败: ${err}`);
    }
  }

  async function handleStart(id: string) {
    try {
      await startReverseTunnel(id);
      loadAll();
    } catch (err) {
      showToast("error", `启动失败: ${err}`);
    }
  }

  async function handleStop(id: string) {
    try {
      await stopReverseTunnel(id);
      loadAll();
    } catch (err) {
      showToast("error", `停止失败: ${err}`);
    }
  }

  async function confirmRemove() {
    if (!deleteConfirm) return;
    try {
      await removeReverseTunnel(deleteConfirm.id);
      loadAll();
    } catch (err) {
      showToast("error", `删除失败: ${err}`);
    } finally {
      setDeleteConfirm(null);
    }
  }

  async function copyUrl(t: ReverseTunnelModel) {
    try {
      await navigator.clipboard.writeText(publicUrl(t));
      showToast("success", "公网地址已复制");
    } catch {
      /* ignore */
    }
  }

  // 迁移分组：仅改分组、不停止运行中的隧道
  async function moveToGroup(t: ReverseTunnelModel, target: string) {
    setGroupMenuFor(null);
    const g = target.trim();
    if (!g || (t.group || DEFAULT_SSH_GROUP) === g) return;
    try {
      await setReverseTunnelGroup(t.id, g);
      loadAll();
    } catch (err) {
      showToast("error", `迁移分组失败: ${err}`);
    }
  }

  // 导出：去掉私钥文件路径（本机路径换机无效），密码 / passphrase 保留
  function stripForExport(auth: SshAuthMethod): SshAuthMethod {
    if (auth.type === "key") {
      return { type: "key", keyPath: "", passphrase: auth.passphrase };
    }
    return auth;
  }

  function buildExportItem(t: ReverseTunnelModel) {
    return {
      name: t.name,
      localHost: t.localHost,
      localPort: t.localPort,
      sshHost: t.sshHost,
      sshPort: t.sshPort,
      sshUser: t.sshUser,
      auth: stripForExport(t.auth),
      remoteBindAddr: t.remoteBindAddr,
      remotePort: t.remotePort,
      domain: t.domain ?? undefined,
      autoReconnect: t.autoReconnect,
      group: t.group || DEFAULT_SSH_GROUP,
    };
  }

  function openExport() {
    if (tunnels.length === 0) {
      showToast("warning", "暂无可导出的映射");
      return;
    }
    setShowExportDialog(true);
  }

  async function confirmExport(selectedIds: string[]) {
    const list = tunnels.filter((t) => selectedIds.includes(t.id));
    if (list.length === 0) {
      setShowExportDialog(false);
      return;
    }
    try {
      const payload = {
        type: "codeshelf-reverse-tunnels",
        version: 1,
        tunnels: list.map(buildExportItem),
      };
      const filePath = await save({
        title: "导出内网穿透配置",
        defaultPath: "reverse-tunnels.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, JSON.stringify(payload, null, 2));
        setShowExportDialog(false);
      }
    } catch (err) {
      showToast("error", `导出失败: ${err}`);
    }
  }

  // 把导入文件中的一条记录映射为创建输入（缺字段抛错，由上层逐条捕获）
  function toImportInput(item: any): ReverseTunnelInput {
    const lp = Number(item?.localPort);
    const rp = Number(item?.remotePort);
    if (!item?.name || Number.isNaN(lp) || Number.isNaN(rp)) {
      throw new Error("字段缺失（名称 / 本地端口 / 公网端口）");
    }
    const auth = item?.auth as SshAuthMethod | undefined;
    if (!auth || !auth.type) throw new Error("缺少认证信息");
    return {
      name: String(item.name),
      localHost: typeof item.localHost === "string" && item.localHost ? item.localHost : "127.0.0.1",
      localPort: lp,
      sshHost: typeof item.sshHost === "string" ? item.sshHost : "",
      sshPort: item.sshPort != null ? Number(item.sshPort) : undefined,
      sshUser: typeof item.sshUser === "string" && item.sshUser ? item.sshUser : undefined,
      auth,
      remoteBindAddr: typeof item.remoteBindAddr === "string" ? item.remoteBindAddr : undefined,
      remotePort: rp,
      domain: typeof item.domain === "string" && item.domain ? item.domain : undefined,
      autoReconnect: typeof item.autoReconnect === "boolean" ? item.autoReconnect : undefined,
      group: typeof item.group === "string" && item.group ? item.group : DEFAULT_SSH_GROUP,
    };
  }

  async function handleImport() {
    try {
      const filePath = await open({
        title: "导入内网穿透配置",
        multiple: false,
        directory: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath) return;
      const content = await readTextFile(filePath as string);
      const parsed = JSON.parse(content);
      const list: any[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.tunnels)
          ? parsed.tunnels
          : [];
      if (list.length === 0) {
        showToast("warning", "导入文件中没有可用的映射配置");
        return;
      }
      let success = 0;
      const failed: string[] = [];
      const needKey: string[] = [];
      for (const item of list) {
        const nm = typeof item?.name === "string" ? item.name : "(未命名)";
        try {
          const input = toImportInput(item);
          await addReverseTunnel(input);
          success += 1;
          if (input.auth.type === "key" && !input.auth.keyPath) needKey.push(input.name);
        } catch (err) {
          failed.push(`${nm}: ${err}`);
        }
      }
      loadAll();
      let msg = `导入完成：成功 ${success} 个`;
      if (failed.length > 0) msg += `，失败 ${failed.length} 个`;
      if (needKey.length > 0) msg += `；私钥认证的需重新设置私钥路径：${needKey.join("、")}`;
      showToast(failed.length > 0 ? "warning" : "success", msg);
    } catch (err) {
      showToast("error", `导入失败: ${err}`);
    }
  }

  return (
    <div className="flex flex-col min-h-full">
      <ToolPanelHeader
        title="内网穿透"
        icon={Globe}
        onBack={onBack}
        beta
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={() => setShowHelp(true)} variant="secondary" size="sm">
              <BookOpen size={16} className="mr-2" />
              使用说明
            </Button>
            <Button onClick={handleImport} variant="secondary" size="sm">
              <FileUp size={16} className="mr-2" />
              导入
            </Button>
            <Button onClick={openExport} variant="secondary" size="sm">
              <FileDown size={16} className="mr-2" />
              导出
            </Button>
            <Button onClick={loadAll} disabled={loading} variant="secondary" size="sm">
              <RefreshCw size={16} className={loading ? "animate-spin mr-2" : "mr-2"} />
              刷新
            </Button>
            <Button onClick={openCreate} variant="primary" size="sm">
              <Plus size={16} className="mr-2" />
              新建映射
            </Button>
          </div>
        }
      />

      <div className="flex-1 p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* 安全须知横幅 */}
          <div className="flex gap-2 rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium">此功能会把本地服务暴露到公网，请谨慎使用</p>
              <p>
                需要你<b>自己的 VPS</b>（带公网 IP / 域名、可 SSH 登录）。默认只在 VPS 本机可达
                （<code className="font-mono">127.0.0.1</code>，建议配 nginx 反代 + HTTPS）；
                勾选「对公网开放」会绑定 <code className="font-mono">0.0.0.0</code>，此时 VPS 需开启{" "}
                <code className="font-mono">GatewayPorts</code>，且暴露的本地服务自身无鉴权、
                公网任何人可达——仅用于临时调试。
              </p>
              <button
                type="button"
                onClick={() => setShowHelp(true)}
                className="inline-flex items-center gap-1 font-medium text-amber-800 underline decoration-dotted underline-offset-2 hover:text-amber-900 dark:text-amber-200"
              >
                <BookOpen size={13} /> 查看完整使用说明（服务器 / nginx / 鉴权配置）
              </button>
            </div>
          </div>

          {loading && tunnels.length === 0 ? (
            <LoadingSpinner size={32} label="加载中..." className="py-20" />
          ) : tunnels.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Globe size={48} className="mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2 text-gray-700 dark:text-gray-300">暂无映射</p>
              <p className="text-sm mb-4 text-center max-w-md">
                通过 SSH 反向隧道，把本地端口临时映射到你的 VPS 公网端口
                （如微信回调需要外网域名时）
              </p>
              <Button onClick={openCreate} variant="primary">
                <Plus size={16} className="mr-2" />
                新建映射
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map((grp) => (
                <div key={grp.name}>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <Layers size={13} className="text-gray-400" />
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                      {grp.name}
                    </span>
                    <span className="text-xs text-gray-400">{grp.items.length}</span>
                  </div>
                  <div className="space-y-3">
                    {grp.items.map((t) => {
                      const running = t.status === "running";
                      const reconnecting = t.status === "reconnecting";
                      return (
                  <div
                    key={t.id}
                    className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block w-2 h-2 rounded-full ${
                              running
                                ? "bg-emerald-500"
                                : reconnecting
                                  ? "bg-amber-500 animate-pulse"
                                  : "bg-gray-300 dark:bg-gray-600"
                            }`}
                          />
                          <h4 className="font-semibold text-gray-900 dark:text-white truncate">
                            {t.name}
                          </h4>
                          <span className="text-xs text-gray-400">
                            {running ? "运行中" : reconnecting ? "重连中" : "已停止"}
                          </span>
                          {t.remoteBindAddr === "0.0.0.0" && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300">
                              公网开放
                            </span>
                          )}
                        </div>

                        <p className="text-sm text-gray-500 mt-1.5 font-mono truncate">
                          {t.localHost}:{t.localPort}
                          <span className="mx-2 text-gray-400">←</span>
                          {t.remoteBindAddr}:{t.remotePort} @ {t.sshHost}
                        </p>

                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span className="text-xs text-gray-400">公网:</span>
                          <code className="text-xs font-mono text-blue-600 dark:text-blue-400 truncate">
                            {publicUrl(t)}
                          </code>
                          <button
                            onClick={() => copyUrl(t)}
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            title="复制公网地址（用于 webhook 回调）"
                          >
                            <Copy size={13} />
                          </button>
                        </div>

                        {(running || reconnecting) && (
                          <p className="text-xs text-gray-400 mt-1.5">
                            连接 {t.connections} · ↓{fmtBytes(t.bytesIn)} · ↑{fmtBytes(t.bytesOut)}
                            {t.reconnects > 0 ? ` · 重连 ${t.reconnects}` : ""}
                          </p>
                        )}
                        {t.lastError && (
                          <p className="text-xs text-red-500 mt-1 truncate" title={t.lastError}>
                            {t.lastError}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {running || reconnecting ? (
                          <Button onClick={() => handleStop(t.id)} variant="secondary" size="sm">
                            <Square size={14} className="mr-1" />
                            停止
                          </Button>
                        ) : (
                          <Button onClick={() => handleStart(t.id)} variant="primary" size="sm">
                            <Play size={14} className="mr-1" />
                            启动
                          </Button>
                        )}
                        <div className="relative">
                          <button
                            onClick={() => setGroupMenuFor(groupMenuFor === t.id ? null : t.id)}
                            className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                            title="移动分组"
                          >
                            <Layers size={15} />
                          </button>
                          {groupMenuFor === t.id && (
                            <>
                              <button
                                className="fixed inset-0 z-10 cursor-default"
                                onClick={() => setGroupMenuFor(null)}
                                aria-hidden
                              />
                              <div className="absolute right-0 top-full mt-1 z-20 w-40 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1">
                                <div className="px-3 py-1 text-[10px] text-gray-400">移动到分组</div>
                                {groups.map((g) => (
                                  <button
                                    key={g}
                                    onClick={() => moveToGroup(t, g)}
                                    className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 ${
                                      (t.group || DEFAULT_SSH_GROUP) === g
                                        ? "text-emerald-600 font-medium"
                                        : "text-gray-700 dark:text-gray-200"
                                    }`}
                                  >
                                    {g}
                                  </button>
                                ))}
                                <button
                                  onClick={() => {
                                    const g = window.prompt("新建分组名称");
                                    if (g && g.trim()) moveToGroup(t, g.trim());
                                    else setGroupMenuFor(null);
                                  }}
                                  className="block w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 border-t border-gray-100 dark:border-gray-700 mt-1"
                                >
                                  ＋ 新建分组…
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                        <button
                          onClick={() => openDuplicate(t)}
                          className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                          title="复制为新映射"
                        >
                          <CopyPlus size={15} />
                        </button>
                        <button
                          onClick={() => openEdit(t)}
                          className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                          title="编辑"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm({ id: t.id, name: t.name })}
                          className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                          title="删除"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 新增/修改表单弹窗 */}
      {formState && (
        <TunnelFormDialog
          mode={formState.mode}
          initial={formState.initial}
          groups={groups}
          sshConfigHosts={sshConfigHosts}
          existingTunnels={tunnels}
          onSubmit={handleFormSubmit}
          onCancel={closeDialog}
        />
      )}

      {/* 删除确认 */}
      {deleteConfirm && (
        <div className="fixed inset-0 top-8 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">删除映射</h3>
            <p className="text-sm text-gray-500 mb-6">
              确定删除「{deleteConfirm.name}」吗？运行中的隧道会先停止。
            </p>
            <div className="flex justify-end gap-3">
              <Button onClick={() => setDeleteConfirm(null)} variant="secondary">
                取消
              </Button>
              <Button onClick={confirmRemove} variant="danger">
                删除
              </Button>
            </div>
          </div>
        </div>
      )}

      {showExportDialog && (
        <ReverseTunnelExportDialog
          tunnels={tunnels}
          onCancel={() => setShowExportDialog(false)}
          onConfirm={confirmExport}
        />
      )}

      <ReverseTunnelHelpDialog open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}
