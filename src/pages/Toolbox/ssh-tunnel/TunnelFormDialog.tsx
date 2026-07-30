import { FolderOpen, KeyRound, Lock, Settings2 } from "lucide-react";
import { Button, Input } from "@/components/ui";
import type { SshTunnel } from "@/types/toolbox";
import type { AuthType } from "./types";

interface TunnelFormDialogProps {
  editing: SshTunnel | null;
  formName: string;
  formLocalPort: string;
  formRemoteHost: string;
  formRemotePort: string;
  formSshHost: string;
  formSshPort: string;
  formSshUser: string;
  formAuthType: AuthType;
  formKeyPath: string;
  formPassphrase: string;
  formPassword: string;
  formHostAlias: string;
  formAutoReconnect: boolean;
  formExposeLan: boolean;
  formGroup: string;
  sshConfigHosts: string[];
  localIps: string[];
  groups: string[];
  onFormNameChange: (v: string) => void;
  onFormLocalPortChange: (v: string) => void;
  onFormRemoteHostChange: (v: string) => void;
  onFormRemotePortChange: (v: string) => void;
  onFormSshHostChange: (v: string) => void;
  onFormSshPortChange: (v: string) => void;
  onFormSshUserChange: (v: string) => void;
  onFormAuthTypeChange: (t: AuthType) => void;
  onFormKeyPathChange: (v: string) => void;
  onFormPassphraseChange: (v: string) => void;
  onFormPasswordChange: (v: string) => void;
  onFormHostAliasChange: (v: string) => void;
  onFormAutoReconnectChange: (v: boolean) => void;
  onFormExposeLanChange: (v: boolean) => void;
  onFormGroupChange: (v: string) => void;
  onSelectKey: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}

const AUTH_OPTIONS: Array<{
  value: AuthType;
  label: string;
  icon: typeof KeyRound;
}> = [
  { value: "key", label: "私钥", icon: KeyRound },
  { value: "password", label: "密码", icon: Lock },
  { value: "sshConfig", label: "~/.ssh/config", icon: Settings2 },
];

export function TunnelFormDialog(props: TunnelFormDialogProps) {
  const {
    editing,
    formName,
    formLocalPort,
    formRemoteHost,
    formRemotePort,
    formSshHost,
    formSshPort,
    formSshUser,
    formAuthType,
    formKeyPath,
    formPassphrase,
    formPassword,
    formHostAlias,
    formAutoReconnect,
    formExposeLan,
    formGroup,
    sshConfigHosts,
    localIps,
    groups,
    onFormNameChange,
    onFormLocalPortChange,
    onFormRemoteHostChange,
    onFormRemotePortChange,
    onFormSshHostChange,
    onFormSshPortChange,
    onFormSshUserChange,
    onFormAuthTypeChange,
    onFormKeyPathChange,
    onFormPassphraseChange,
    onFormPasswordChange,
    onFormHostAliasChange,
    onFormAutoReconnectChange,
    onFormExposeLanChange,
    onFormGroupChange,
    onSelectKey,
    onCancel,
    onSubmit,
  } = props;

  const isEditing = Boolean(editing);
  const showSshTarget = formAuthType !== "sshConfig";

  return (
    <div className="fixed inset-0 top-8 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          {isEditing ? "编辑 SSH 隧道" : "创建 SSH 隧道"}
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          相当于 <code className="font-mono">ssh -N -L 本地:目标主机:远程端口 用户@SSH主机</code>
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-2">名称</label>
            <Input
              value={formName}
              onChange={(e) => onFormNameChange(e.target.value)}
              placeholder="如: 远程 Redis"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-500 mb-2">
              分组 <span className="text-gray-400 font-normal">(可输入新建，或点选已有)</span>
            </label>
            <Input
              value={formGroup}
              onChange={(e) => onFormGroupChange(e.target.value)}
              placeholder="默认分组"
              list="ssh-tunnel-groups-datalist"
            />
            <datalist id="ssh-tunnel-groups-datalist">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            {groups.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {groups.map((g) => {
                  const active = formGroup.trim() === g;
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => onFormGroupChange(g)}
                      className={`px-2.5 py-0.5 rounded-full text-xs border transition-colors ${
                        active
                          ? "bg-emerald-500 border-emerald-500 text-white"
                          : "bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-emerald-400 dark:hover:border-emerald-500"
                      }`}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 第一段：本地 / 项目连接侧 —— 你的项目和局域网设备连这里 */}
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-2">本地端口</label>
            <Input
              type="number"
              value={formLocalPort}
              onChange={(e) => onFormLocalPortChange(e.target.value)}
              placeholder="如: 16379"
            />
            <p className="text-xs text-gray-400 mt-1">
              {formExposeLan ? (
                <>
                  监听 <code className="font-mono">0.0.0.0</code>：本机用{" "}
                  <code className="font-mono">127.0.0.1:{formLocalPort || "端口"}</code> 连接；
                  同局域网其他电脑可用 <span className="font-mono">本机IP:{formLocalPort || "端口"}</span> 共享连接。
                </>
              ) : (
                <>
                  监听 <code className="font-mono">127.0.0.1</code>：仅本机可连接。
                  需要让手机 / 同事访问时，勾选下方「本地端口对局域网开放」。
                </>
              )}
            </p>
            {formExposeLan && localIps.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {localIps.map((ip) => (
                  <span
                    key={ip}
                    className="px-2 py-0.5 rounded-md text-xs font-mono bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                  >
                    {ip}:{formLocalPort || "端口"}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 第二段：SSH 服务端映射目标 —— 由服务端去连接的地址 */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-sm font-medium text-gray-500 mb-0.5">SSH 服务端映射目标</p>
            <p className="text-xs text-gray-400 mb-3">由 SSH 服务端去连接的地址与端口</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">目标主机</label>
                <Input
                  value={formRemoteHost}
                  onChange={(e) => onFormRemoteHostChange(e.target.value)}
                  placeholder="默认 127.0.0.1"
                  list="ssh-tunnel-remote-host-datalist"
                />
                <datalist id="ssh-tunnel-remote-host-datalist">
                  {["127.0.0.1", "localhost"].map((ip) => (
                    <option key={ip} value={ip} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">远程端口</label>
                <Input
                  type="number"
                  value={formRemotePort}
                  onChange={(e) => onFormRemotePortChange(e.target.value)}
                  placeholder="如: 6379"
                />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              通常 <code className="font-mono">127.0.0.1</code>（即服务器自身），也可填 SSH 服务器能访问到的其他 IP。
            </p>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <label className="block text-sm font-medium text-gray-500 mb-2">认证方式</label>
            <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit mb-4">
              {AUTH_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = formAuthType === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onFormAuthTypeChange(opt.value)}
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

            {showSshTarget && (
              <div className="space-y-3">
                <div className="grid grid-cols-[2fr_1fr] gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-2">SSH 主机</label>
                    <Input
                      value={formSshHost}
                      onChange={(e) => onFormSshHostChange(e.target.value)}
                      placeholder="如: 192.168.1.10 或 example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-2">SSH 端口</label>
                    <Input
                      type="number"
                      value={formSshPort}
                      onChange={(e) => onFormSshPortChange(e.target.value)}
                      placeholder="22"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-2">用户</label>
                  <Input
                    value={formSshUser}
                    onChange={(e) => onFormSshUserChange(e.target.value)}
                    placeholder="如: root、ubuntu"
                  />
                </div>
              </div>
            )}

            {formAuthType === "key" && (
              <div className="space-y-3 mt-3">
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-2">私钥路径</label>
                  <div className="flex gap-2">
                    <Input
                      value={formKeyPath}
                      onChange={(e) => onFormKeyPathChange(e.target.value)}
                      placeholder="如: ~/.ssh/id_rsa"
                      className="flex-1"
                    />
                    <Button onClick={onSelectKey} variant="secondary">
                      <FolderOpen size={16} />
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-2">
                    Passphrase <span className="text-gray-400 font-normal">(可选)</span>
                  </label>
                  <Input
                    type="password"
                    value={formPassphrase}
                    onChange={(e) => onFormPassphraseChange(e.target.value)}
                    placeholder="如果私钥已加密"
                  />
                </div>
              </div>
            )}

            {formAuthType === "password" && (
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-500 mb-2">密码</label>
                <Input
                  type="password"
                  value={formPassword}
                  onChange={(e) => onFormPasswordChange(e.target.value)}
                  placeholder="SSH 登录密码"
                />
              </div>
            )}

            {formAuthType === "sshConfig" && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-2">
                    Host 别名 <span className="text-gray-400 font-normal">(读取 ~/.ssh/config)</span>
                  </label>
                  <Input
                    value={formHostAlias}
                    onChange={(e) => onFormHostAliasChange(e.target.value)}
                    placeholder="如: my-server"
                    list="ssh-config-hosts-datalist"
                  />
                  <datalist id="ssh-config-hosts-datalist">
                    {sshConfigHosts.map((h) => (
                      <option key={h} value={h} />
                    ))}
                  </datalist>
                  {sshConfigHosts.length > 0 && (
                    <p className="text-xs text-gray-400 mt-1">
                      可选: {sshConfigHosts.slice(0, 8).join(", ")}
                      {sshConfigHosts.length > 8 ? " ..." : ""}
                    </p>
                  )}
                </div>
              </div>
            )}

            <p className="text-xs text-amber-500 dark:text-amber-400 mt-3">
              ⚠ 私钥 passphrase、密码在本机明文存储（导出时不会带出）；
              首次连接会展示主机密钥指纹，请核对后再信任
            </p>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={formAutoReconnect}
                onChange={(e) => onFormAutoReconnectChange(e.target.checked)}
                className="w-4 h-4 accent-emerald-500"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                断线自动重连
              </span>
              <span className="text-xs text-gray-400">网络切换 / 休眠恢复后自动重建隧道</span>
            </label>

            {/* 本地监听范围：默认只有本机能用这条隧道。
                以前一律绑 0.0.0.0 却显示 127.0.0.1，等于把远端服务转发给了整个网段。 */}
            <label className="flex items-start gap-2 cursor-pointer select-none mt-3">
              <input
                type="checkbox"
                checked={formExposeLan}
                onChange={(e) => onFormExposeLanChange(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-emerald-500"
              />
              <span>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  本地端口对局域网开放
                </span>
                <span className="block text-xs text-gray-400 mt-0.5">
                  {formExposeLan
                    ? "将监听 0.0.0.0 —— 同一网络下任何设备都能通过这条隧道访问远端服务"
                    : "当前只监听 127.0.0.1，仅本机可用（推荐）"}
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button onClick={onCancel} variant="secondary">
            取消
          </Button>
          <Button onClick={onSubmit} variant="primary">
            {isEditing ? "保存" : "创建"}
          </Button>
        </div>
      </div>
    </div>
  );
}
