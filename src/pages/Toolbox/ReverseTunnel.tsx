// 内网穿透（公网映射）—— 通过 SSH 反向隧道把本地服务暴露到你自己的 VPS 公网端口。
// 典型用途：微信/支付等回调只能填外网域名/IP 时，把本地开发服务临时映射出去调试。
//
// 独立于「SSH 隧道」工具（那个是正向 -L），本页是反向 -R。后端见 reverse_tunnel 模块。

import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  Copy,
  FolderOpen,
  Globe,
  KeyRound,
  Lock,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Square,
  Trash2,
} from "lucide-react";
import { Button, Input, showToast } from "@/components/ui";
import { LoadingSpinner } from "@/components/common";
import { ToolPanelHeader } from "./index";
import {
  addReverseTunnel,
  getReverseTunnels,
  listReverseSshConfigHosts,
  removeReverseTunnel,
  startReverseTunnel,
  stopReverseTunnel,
  updateReverseTunnel,
} from "@/services/toolbox";
import type {
  ReverseTunnel as ReverseTunnelModel,
  ReverseTunnelInput,
  SshAuthMethod,
} from "@/types/toolbox";

type AuthType = "key" | "password" | "sshConfig";

const AUTH_OPTIONS: Array<{ value: AuthType; label: string; icon: typeof KeyRound }> = [
  { value: "key", label: "私钥", icon: KeyRound },
  { value: "password", label: "密码", icon: Lock },
  { value: "sshConfig", label: "~/.ssh/config", icon: Settings2 },
];

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

export function ReverseTunnel({ onBack }: ReverseTunnelProps) {
  const [tunnels, setTunnels] = useState<ReverseTunnelModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [sshConfigHosts, setSshConfigHosts] = useState<string[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<ReverseTunnelModel | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  // 表单
  const [name, setName] = useState("");
  const [localHost, setLocalHost] = useState("127.0.0.1");
  const [localPort, setLocalPort] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [sshUser, setSshUser] = useState("root");
  const [authType, setAuthType] = useState<AuthType>("key");
  const [keyPath, setKeyPath] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [password, setPassword] = useState("");
  const [hostAlias, setHostAlias] = useState("");
  const [remotePort, setRemotePort] = useState("");
  const [exposePublic, setExposePublic] = useState(false);
  const [domain, setDomain] = useState("");
  const [autoReconnect, setAutoReconnect] = useState(true);

  useEffect(() => {
    loadAll();
    listReverseSshConfigHosts()
      .then(setSshConfigHosts)
      .catch((err) => console.warn("读取 ~/.ssh/config 失败:", err));
    const interval = setInterval(loadAll, 2000);
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

  function resetForm() {
    setName("");
    setLocalHost("127.0.0.1");
    setLocalPort("");
    setSshHost("");
    setSshPort("22");
    setSshUser("root");
    setAuthType("key");
    setKeyPath("");
    setPassphrase("");
    setPassword("");
    setHostAlias("");
    setRemotePort("");
    setExposePublic(false);
    setDomain("");
    setAutoReconnect(true);
    setEditing(null);
  }

  function openCreate() {
    resetForm();
    setShowDialog(true);
  }

  function openEdit(t: ReverseTunnelModel) {
    setEditing(t);
    setName(t.name);
    setLocalHost(t.localHost);
    setLocalPort(String(t.localPort));
    setSshHost(t.sshHost);
    setSshPort(String(t.sshPort));
    setSshUser(t.sshUser);
    setAuthType(t.auth.type);
    setKeyPath(t.auth.type === "key" ? t.auth.keyPath : "");
    setPassphrase(t.auth.type === "key" ? t.auth.passphrase || "" : "");
    setPassword(t.auth.type === "password" ? t.auth.password : "");
    setHostAlias(t.auth.type === "sshConfig" ? t.auth.hostAlias : "");
    setRemotePort(String(t.remotePort));
    setExposePublic(t.remoteBindAddr === "0.0.0.0");
    setDomain(t.domain || "");
    setAutoReconnect(t.autoReconnect ?? true);
    setShowDialog(true);
  }

  function closeDialog() {
    setShowDialog(false);
    resetForm();
  }

  async function selectKey() {
    try {
      const { homeDir, join } = await import("@tauri-apps/api/path");
      const sshDir = await join(await homeDir(), ".ssh");
      const selected = await open({
        directory: false,
        multiple: false,
        title: "选择 SSH 私钥",
        defaultPath: sshDir,
      });
      if (selected) setKeyPath(selected as string);
    } catch (err) {
      console.error("选择私钥失败:", err);
    }
  }

  function buildAuth(): SshAuthMethod | null {
    if (authType === "key") {
      if (!keyPath.trim()) {
        showToast("error", "请选择私钥文件");
        return null;
      }
      return { type: "key", keyPath: keyPath.trim(), passphrase: passphrase || undefined };
    }
    if (authType === "password") {
      if (!password) {
        showToast("error", "请输入密码");
        return null;
      }
      return { type: "password", password };
    }
    if (!hostAlias.trim()) {
      showToast("error", "请选择或输入 SSH config Host 别名");
      return null;
    }
    return { type: "sshConfig", hostAlias: hostAlias.trim() };
  }

  async function submit() {
    const lp = parseInt(localPort);
    const rp = parseInt(remotePort);
    const sp = parseInt(sshPort);
    if (!name.trim() || Number.isNaN(lp) || Number.isNaN(rp)) {
      showToast("error", "请填写完整：名称 / 本地端口 / 公网端口");
      return;
    }
    if (authType !== "sshConfig" && (!sshHost.trim() || !sshUser.trim())) {
      showToast("error", "请填写完整：SSH 主机 / 用户");
      return;
    }
    const auth = buildAuth();
    if (!auth) return;

    const input: ReverseTunnelInput = {
      name: name.trim(),
      localHost: localHost.trim() || "127.0.0.1",
      localPort: lp,
      sshHost: sshHost.trim(),
      sshPort: Number.isNaN(sp) ? 22 : sp,
      sshUser: sshUser.trim() || undefined,
      auth,
      remoteBindAddr: exposePublic ? "0.0.0.0" : "127.0.0.1",
      remotePort: rp,
      domain: domain.trim() || undefined,
      autoReconnect,
    };

    try {
      if (editing) {
        await updateReverseTunnel(editing.id, input);
      } else {
        await addReverseTunnel(input);
      }
      closeDialog();
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

  const showSshTarget = authType !== "sshConfig";

  return (
    <div className="flex flex-col min-h-full">
      <ToolPanelHeader
        title="内网穿透"
        icon={Globe}
        onBack={onBack}
        beta
        actions={
          <div className="flex items-center gap-2">
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
                <code className="font-mono">GatewayPorts yes</code>，且暴露的本地服务自身无鉴权、
                公网任何人可达——仅用于临时调试。
              </p>
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
            <div className="space-y-3">
              {tunnels.map((t) => {
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
          )}
        </div>
      </div>

      {/* 表单弹窗 */}
      {showDialog && (
        <div className="fixed inset-0 top-8 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              {editing ? "编辑映射" : "新建映射"}
            </h3>
            <p className="text-xs text-gray-400 mb-4">
              相当于 <code className="font-mono">ssh -N -R 绑定:公网端口:本地主机:本地端口 用户@VPS</code>
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">名称</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如: 微信回调调试" />
              </div>

              {/* 本地服务 */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <p className="text-sm font-medium text-gray-500 mb-0.5">本地服务</p>
                <p className="text-xs text-gray-400 mb-3">要暴露到公网的本地服务</p>
                <div className="grid grid-cols-[2fr_1fr] gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-2">本地主机</label>
                    <Input value={localHost} onChange={(e) => setLocalHost(e.target.value)} placeholder="127.0.0.1" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-2">本地端口</label>
                    <Input type="number" value={localPort} onChange={(e) => setLocalPort(e.target.value)} placeholder="如: 8080" />
                  </div>
                </div>
              </div>

              {/* SSH 服务器 (VPS) */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-0.5">SSH 服务器（你的 VPS）</p>
                  <p className="text-xs text-gray-400">公网入口，需可 SSH 登录</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-2">认证方式</label>
                  <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
                    {AUTH_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      const active = authType === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setAuthType(opt.value)}
                          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                            active
                              ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                          }`}
                        >
                          <Icon size={14} />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {showSshTarget && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-[2fr_1fr] gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-500 mb-2">SSH 主机</label>
                        <Input value={sshHost} onChange={(e) => setSshHost(e.target.value)} placeholder="如: vps.example.com" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-500 mb-2">SSH 端口</label>
                        <Input type="number" value={sshPort} onChange={(e) => setSshPort(e.target.value)} placeholder="22" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-500 mb-2">用户</label>
                      <Input value={sshUser} onChange={(e) => setSshUser(e.target.value)} placeholder="如: root、ubuntu" />
                    </div>
                  </div>
                )}

                {authType === "key" && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-500 mb-2">私钥路径</label>
                      <div className="flex gap-2">
                        <Input value={keyPath} onChange={(e) => setKeyPath(e.target.value)} placeholder="如: ~/.ssh/id_rsa" className="flex-1" />
                        <Button onClick={selectKey} variant="secondary">
                          <FolderOpen size={16} />
                        </Button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-500 mb-2">
                        Passphrase <span className="text-gray-400 font-normal">(可选)</span>
                      </label>
                      <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="如果私钥已加密" />
                    </div>
                  </div>
                )}

                {authType === "password" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-2">密码</label>
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="SSH 登录密码" />
                  </div>
                )}

                {authType === "sshConfig" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-2">
                      Host 别名 <span className="text-gray-400 font-normal">(读取 ~/.ssh/config)</span>
                    </label>
                    <Input value={hostAlias} onChange={(e) => setHostAlias(e.target.value)} placeholder="如: my-vps" list="reverse-ssh-hosts" />
                    <datalist id="reverse-ssh-hosts">
                      {sshConfigHosts.map((h) => (
                        <option key={h} value={h} />
                      ))}
                    </datalist>
                  </div>
                )}
              </div>

              {/* 公网映射 */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
                <p className="text-sm font-medium text-gray-500">公网映射</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-2">公网端口</label>
                    <Input type="number" value={remotePort} onChange={(e) => setRemotePort(e.target.value)} placeholder="如: 9000" />
                    <p className="text-xs text-gray-400 mt-1">VPS 上对外暴露的端口</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-2">
                      域名 <span className="text-gray-400 font-normal">(可选)</span>
                    </label>
                    <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="如: dev.example.com" />
                    <p className="text-xs text-gray-400 mt-1">仅用于生成公网地址</p>
                  </div>
                </div>

                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={exposePublic}
                    onChange={(e) => setExposePublic(e.target.checked)}
                    className="w-4 h-4 mt-0.5 accent-red-500"
                  />
                  <span className="text-sm">
                    <span className="font-medium text-gray-700 dark:text-gray-300">对公网开放（绑定 0.0.0.0）</span>
                    <span className="block text-xs text-gray-400 mt-0.5">
                      不勾选则仅 VPS 本机可达（<code className="font-mono">127.0.0.1</code>，配 nginx 反代更安全）
                    </span>
                  </span>
                </label>

                {exposePublic && (
                  <div className="flex gap-2 rounded-md border border-red-300 dark:border-red-700/60 bg-red-50 dark:bg-red-900/20 p-2.5 text-xs text-red-600 dark:text-red-300">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>
                      危险：将把本地服务直接暴露给整个互联网，且服务自身无鉴权。VPS 需配置{" "}
                      <code className="font-mono">GatewayPorts yes</code>。仅用于临时调试，用完请及时停止。
                    </span>
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoReconnect}
                  onChange={(e) => setAutoReconnect(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">断线自动重连</span>
              </label>

              <p className="text-xs text-amber-500 dark:text-amber-400">
                ⚠ 私钥 passphrase、密码本地明文存储；首版未做 known_hosts 校验
              </p>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button onClick={closeDialog} variant="secondary">
                取消
              </Button>
              <Button onClick={submit} variant="primary">
                {editing ? "保存" : "创建"}
              </Button>
            </div>
          </div>
        </div>
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
    </div>
  );
}
