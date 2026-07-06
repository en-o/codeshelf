// 内网穿透 新增/修改表单：宽双列布局，自管字段 state。
// 顶部可「从已有映射填充」快速回填（新建时）。对外只回吐 ReverseTunnelInput。

import { useState, type ReactNode } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, FolderOpen, KeyRound, Lock, Settings2 } from "lucide-react";
import { Button, Input, showToast } from "@/components/ui";
import { DEFAULT_SSH_GROUP } from "@/types/toolbox";
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

interface FormFields {
  name: string;
  localHost: string;
  localPort: string;
  sshHost: string;
  sshPort: string;
  sshUser: string;
  authType: AuthType;
  keyPath: string;
  passphrase: string;
  password: string;
  hostAlias: string;
  remotePort: string;
  exposePublic: boolean;
  domain: string;
  autoReconnect: boolean;
  group: string;
}

function fieldsFromTunnel(t: ReverseTunnelModel | null): FormFields {
  if (!t) {
    return {
      name: "",
      localHost: "127.0.0.1",
      localPort: "",
      sshHost: "",
      sshPort: "22",
      sshUser: "root",
      authType: "key",
      keyPath: "",
      passphrase: "",
      password: "",
      hostAlias: "",
      remotePort: "",
      exposePublic: false,
      domain: "",
      autoReconnect: true,
      group: DEFAULT_SSH_GROUP,
    };
  }
  return {
    name: t.name,
    localHost: t.localHost,
    localPort: String(t.localPort),
    sshHost: t.sshHost,
    sshPort: String(t.sshPort),
    sshUser: t.sshUser,
    authType: t.auth.type,
    keyPath: t.auth.type === "key" ? t.auth.keyPath : "",
    passphrase: t.auth.type === "key" ? t.auth.passphrase || "" : "",
    password: t.auth.type === "password" ? t.auth.password : "",
    hostAlias: t.auth.type === "sshConfig" ? t.auth.hostAlias : "",
    remotePort: String(t.remotePort),
    exposePublic: t.remoteBindAddr === "0.0.0.0",
    domain: t.domain || "",
    autoReconnect: t.autoReconnect ?? true,
    group: t.group || DEFAULT_SSH_GROUP,
  };
}

interface TunnelFormDialogProps {
  mode: "create" | "edit";
  /** 初始值：编辑=被编辑项；复制=源项(名称已带"副本")；空白新建=null */
  initial: ReverseTunnelModel | null;
  groups: string[];
  sshConfigHosts: string[];
  /** 供「从已有填充」下拉使用（仅新建模式展示） */
  existingTunnels: ReverseTunnelModel[];
  onSubmit: (input: ReverseTunnelInput) => void | Promise<void>;
  onCancel: () => void;
}

export function TunnelFormDialog({
  mode,
  initial,
  groups,
  sshConfigHosts,
  existingTunnels,
  onSubmit,
  onCancel,
}: TunnelFormDialogProps) {
  const [f, setF] = useState<FormFields>(() => fieldsFromTunnel(initial));
  const [submitting, setSubmitting] = useState(false);

  const update = (patch: Partial<FormFields>) => setF((prev) => ({ ...prev, ...patch }));
  const showSshTarget = f.authType !== "sshConfig";

  async function selectKey() {
    try {
      const { homeDir, join } = await import("@tauri-apps/api/path");
      const sshDir = await join(await homeDir(), ".ssh");
      const selected = await openFileDialog({
        directory: false,
        multiple: false,
        title: "选择 SSH 私钥",
        defaultPath: sshDir,
      });
      if (selected) update({ keyPath: selected as string });
    } catch (err) {
      console.error("选择私钥失败:", err);
    }
  }

  function buildAuth(): SshAuthMethod | null {
    if (f.authType === "key") {
      if (!f.keyPath.trim()) {
        showToast("error", "请选择私钥文件");
        return null;
      }
      return { type: "key", keyPath: f.keyPath.trim(), passphrase: f.passphrase || undefined };
    }
    if (f.authType === "password") {
      if (!f.password) {
        showToast("error", "请输入密码");
        return null;
      }
      return { type: "password", password: f.password };
    }
    if (!f.hostAlias.trim()) {
      showToast("error", "请选择或输入 SSH config Host 别名");
      return null;
    }
    return { type: "sshConfig", hostAlias: f.hostAlias.trim() };
  }

  async function handleSubmit() {
    const lp = parseInt(f.localPort);
    const rp = parseInt(f.remotePort);
    const sp = parseInt(f.sshPort);
    if (!f.name.trim() || Number.isNaN(lp) || Number.isNaN(rp)) {
      showToast("error", "请填写完整：名称 / 本地端口 / 公网端口");
      return;
    }
    if (f.authType !== "sshConfig" && (!f.sshHost.trim() || !f.sshUser.trim())) {
      showToast("error", "请填写完整：SSH 主机 / 用户");
      return;
    }
    const auth = buildAuth();
    if (!auth) return;

    const input: ReverseTunnelInput = {
      name: f.name.trim(),
      localHost: f.localHost.trim() || "127.0.0.1",
      localPort: lp,
      sshHost: f.sshHost.trim(),
      sshPort: Number.isNaN(sp) ? 22 : sp,
      sshUser: f.sshUser.trim() || undefined,
      auth,
      remoteBindAddr: f.exposePublic ? "0.0.0.0" : "127.0.0.1",
      remotePort: rp,
      domain: f.domain.trim() || undefined,
      autoReconnect: f.autoReconnect,
      group: f.group.trim() || DEFAULT_SSH_GROUP,
    };

    setSubmitting(true);
    try {
      await onSubmit(input);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 top-8 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
        {/* header */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-4 dark:border-gray-800">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              {mode === "edit" ? "编辑映射" : "新建映射"}
            </h3>
            <p className="mt-0.5 truncate text-xs text-gray-400">
              相当于 <code className="font-mono">ssh -N -R 绑定:公网端口:本地主机:本地端口 用户@VPS</code>
            </p>
          </div>
          {mode === "create" && existingTunnels.length > 0 && (
            <select
              className="shrink-0 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              value=""
              onChange={(e) => {
                const t = existingTunnels.find((x) => x.id === e.target.value);
                if (t) setF({ ...fieldsFromTunnel(t), name: `${t.name} 副本` });
              }}
              title="从一条已有映射快速填充所有字段"
            >
              <option value="">从已有填充…</option>
              {existingTunnels.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* body */}
        <div className="overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="名称">
              <Input value={f.name} onChange={(e) => update({ name: e.target.value })} placeholder="如: 微信回调调试" />
            </Field>
            <Field label="分组">
              <Input
                value={f.group}
                onChange={(e) => update({ group: e.target.value })}
                placeholder={DEFAULT_SSH_GROUP}
                list="reverse-groups"
              />
              <datalist id="reverse-groups">
                {groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </Field>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {/* 左列：本地服务 + 公网映射 */}
            <div className="space-y-4">
              <Box title="本地服务" desc="要暴露到公网的本地服务">
                <div className="grid grid-cols-[2fr_1fr] gap-3">
                  <Field label="本地主机">
                    <Input value={f.localHost} onChange={(e) => update({ localHost: e.target.value })} placeholder="127.0.0.1" />
                  </Field>
                  <Field label="本地端口">
                    <Input type="number" value={f.localPort} onChange={(e) => update({ localPort: e.target.value })} placeholder="8080" />
                  </Field>
                </div>
              </Box>

              <Box title="公网映射" desc="VPS 上对外暴露">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="公网端口">
                    <Input type="number" value={f.remotePort} onChange={(e) => update({ remotePort: e.target.value })} placeholder="9000" />
                  </Field>
                  <Field label="域名(可选)">
                    <Input value={f.domain} onChange={(e) => update({ domain: e.target.value })} placeholder="dev.example.com" />
                  </Field>
                </div>
                <label className="mt-3 flex cursor-pointer select-none items-start gap-2">
                  <input
                    type="checkbox"
                    checked={f.exposePublic}
                    onChange={(e) => update({ exposePublic: e.target.checked })}
                    className="mt-0.5 h-4 w-4 accent-red-500"
                  />
                  <span className="text-xs">
                    <span className="font-medium text-gray-700 dark:text-gray-300">对公网开放（绑定 0.0.0.0）</span>
                    <span className="block text-gray-400">
                      不勾则仅 VPS 本机可达（<code className="font-mono">127.0.0.1</code>，配 nginx 反代更安全）
                    </span>
                  </span>
                </label>
                {f.exposePublic && (
                  <div className="mt-2 flex gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-[11px] leading-4 text-red-600 dark:border-red-700/60 dark:bg-red-900/20 dark:text-red-300">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    <span>
                      将把本地服务暴露给整个互联网且服务自身无鉴权；VPS 需 <code className="font-mono">GatewayPorts yes</code>，仅限临时调试。
                    </span>
                  </div>
                )}
              </Box>
            </div>

            {/* 右列：SSH 服务器 */}
            <Box title="SSH 服务器（你的 VPS）" desc="公网入口，需可 SSH 登录">
              <Field label="认证方式">
                <div className="flex w-fit gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
                  {AUTH_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const active = f.authType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => update({ authType: opt.value })}
                        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          active
                            ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
                            : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                        }`}
                      >
                        <Icon size={13} />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </Field>

              {showSshTarget && (
                <>
                  <div className="grid grid-cols-[2fr_1fr] gap-3">
                    <Field label="SSH 主机">
                      <Input value={f.sshHost} onChange={(e) => update({ sshHost: e.target.value })} placeholder="vps.example.com" />
                    </Field>
                    <Field label="端口">
                      <Input type="number" value={f.sshPort} onChange={(e) => update({ sshPort: e.target.value })} placeholder="22" />
                    </Field>
                  </div>
                  <Field label="用户">
                    <Input value={f.sshUser} onChange={(e) => update({ sshUser: e.target.value })} placeholder="root、ubuntu" />
                  </Field>
                </>
              )}

              {f.authType === "key" && (
                <>
                  <Field label="私钥路径">
                    <div className="flex gap-2">
                      <Input
                        value={f.keyPath}
                        onChange={(e) => update({ keyPath: e.target.value })}
                        placeholder="~/.ssh/id_rsa"
                        className="flex-1"
                      />
                      <Button onClick={selectKey} variant="secondary">
                        <FolderOpen size={16} />
                      </Button>
                    </div>
                  </Field>
                  <Field label="Passphrase（可选）">
                    <Input
                      type="password"
                      value={f.passphrase}
                      onChange={(e) => update({ passphrase: e.target.value })}
                      placeholder="私钥已加密时填"
                    />
                  </Field>
                </>
              )}

              {f.authType === "password" && (
                <Field label="密码">
                  <Input
                    type="password"
                    value={f.password}
                    onChange={(e) => update({ password: e.target.value })}
                    placeholder="SSH 登录密码"
                  />
                </Field>
              )}

              {f.authType === "sshConfig" && (
                <Field label="Host 别名（读取 ~/.ssh/config）">
                  <Input
                    value={f.hostAlias}
                    onChange={(e) => update({ hostAlias: e.target.value })}
                    placeholder="my-vps"
                    list="reverse-ssh-hosts"
                  />
                  <datalist id="reverse-ssh-hosts">
                    {sshConfigHosts.map((h) => (
                      <option key={h} value={h} />
                    ))}
                  </datalist>
                </Field>
              )}
            </Box>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <label className="flex cursor-pointer select-none items-center gap-2">
              <input
                type="checkbox"
                checked={f.autoReconnect}
                onChange={(e) => update({ autoReconnect: e.target.checked })}
                className="h-4 w-4 accent-emerald-500"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">断线自动重连</span>
            </label>
            <span className="text-[11px] text-amber-500 dark:text-amber-400">
              ⚠ 密码 / passphrase 本地明文存储；首版未做 known_hosts 校验
            </span>
          </div>
        </div>

        {/* footer */}
        <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4 dark:border-gray-800">
          <Button onClick={onCancel} variant="secondary" disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} variant="primary" disabled={submitting}>
            {mode === "edit" ? "保存" : "创建"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-500">{label}</label>
      {children}
    </div>
  );
}

function Box({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div>
        <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{title}</p>
        {desc && <p className="text-xs text-gray-400">{desc}</p>}
      </div>
      {children}
    </div>
  );
}
