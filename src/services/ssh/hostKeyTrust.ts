import { commands } from "@/bindings";
import { confirmDialog } from "@/components/common/useConfirm";

/** 后端在「主机密钥未记录」时会把这个标记塞进错误串（见 ssh_hostkey.rs）。 */
const HOSTKEY_MARKER = "HOSTKEY_NOT_TRUSTED";

/** Tauri 的错误是纯字符串，不是 Error 实例。 */
function errText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * 启动隧道；首次连接遇到未记录的主机密钥时，展示指纹让用户确认。
 *
 * 正向隧道和反向隧道共用这一处 —— 两边各写一份的话，迟早有一边忘了加。
 *
 * 关键点：
 * - 只有「未记录」才给确认机会。密钥**变更**在后端直接拒绝，界面上没有"继续"按钮：
 *   那是主动攻击的信号，要用户自己去 known_hosts 里清。
 * - 信任时把用户看到的指纹回传给后端核对，避免"展示 A 的指纹、信任了 B 的密钥"。
 */
export async function startWithHostKeyTrust(
  host: string,
  port: number,
  start: () => Promise<unknown>,
): Promise<void> {
  try {
    await start();
    return;
  } catch (e) {
    if (!errText(e).includes(HOSTKEY_MARKER)) throw e;

    const probe = await commands.sshProbeHostKey(host, port);
    if (probe.status === "error") throw probe.error;
    const info = probe.data;

    if (info.status === "changed") {
      throw `${host}:${port} 的主机密钥已变更（当前 ${info.fingerprint}）。` +
        `这可能是中间人攻击。确认服务端确实换过密钥后，执行 ssh-keygen -R "[${host}]:${port}" 再重试。`;
    }

    const ok = await confirmDialog({
      title: `首次连接 ${host}:${port}`,
      variant: "danger",
      confirmLabel: "指纹无误，信任并连接",
      cancelLabel: "取消",
      description: `该主机不在 ~/.ssh/known_hosts 中。请先登录云厂商控制台或服务器本地终端（不要通过当前这条待确认的 SSH 连接），执行：\n\nssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub\n\n将命令输出中的 SHA256 指纹与下方指纹逐字核对：\n\n算法：${info.algorithm}\n指纹：${info.fingerprint}\n\n如果服务器使用的不是 ED25519 主机密钥，请把命令中的文件名换成对应算法，例如 ssh_host_rsa_key.pub。`,
      notice: "指纹不符说明连接可能被劫持，此时继续会把密码和隧道流量交给攻击者。",
    });
    if (!ok) throw e;

    const trusted = await commands.sshTrustHostKey(host, port, info.fingerprint);
    if (trusted.status === "error") throw trusted.error;

    await start();
  }
}
