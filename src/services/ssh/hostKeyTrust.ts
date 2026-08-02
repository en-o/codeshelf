import { commands } from "@/bindings";
import { confirmDialog } from "@/components/common/useConfirm";
import { MarkdownContent } from "@/components/common/MarkdownContent";
import { createElement } from "react";

/** 后端在「主机密钥未记录」时会把这个标记塞进错误串（见 ssh_hostkey.rs）。 */
const HOSTKEY_MARKER = "HOSTKEY_NOT_TRUSTED";

/** Tauri 的错误是纯字符串，不是 Error 实例。 */
function errText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** 把 SSH 协商算法映射到 OpenSSH 服务端默认的主机公钥文件名。 */
function hostKeyFileName(algorithm: string): string {
  const normalized = algorithm.toLowerCase();
  if (normalized.includes("ed25519")) return "ssh_host_ed25519_key.pub";
  if (normalized.includes("ecdsa")) return "ssh_host_ecdsa_key.pub";
  if (normalized.includes("rsa")) return "ssh_host_rsa_key.pub";
  if (normalized.includes("dsa") || normalized.includes("dss")) return "ssh_host_dsa_key.pub";
  return "ssh_host_ed25519_key.pub";
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

    const keyFile = hostKeyFileName(info.algorithm);
    const linuxCommand = `ssh-keygen -lf /etc/ssh/${keyFile} -E sha256`;
    const windowsCommand = `ssh-keygen -lf "$env:ProgramData\\ssh\\${keyFile}" -E sha256`;
    const instructions = `
这是首次连接，应用尚未记录该服务器。

### 当前服务器信息

- **算法：** \`${info.algorithm}\`
- **待核对指纹：** \`${info.fingerprint}\`

### 核对步骤（可选但建议）

1. 从云厂商网页控制台、VNC 或服务器本地终端登录服务器。不要使用当前这条尚未确认的 SSH 连接。
2. 根据服务器系统执行命令：

   **Linux**

   \`\`\`bash
   ${linuxCommand}
   \`\`\`

   **Windows OpenSSH Server（PowerShell）**

   \`\`\`powershell
   ${windowsCommand}
   \`\`\`

3. 找到命令输出中的 \`SHA256:...\`，与上面的“待核对指纹”完整比较。
4. 完全一致时点击 **信任并连接**；不一致时点击 **取消** 并检查服务器地址。

> 暂时无法核对时也可以直接信任。应用会记录本次密钥，以后自动校验。
`.trim();

    const ok = await confirmDialog({
      title: `发现新的 SSH 主机 ${host}:${port}`,
      variant: "warning",
      confirmLabel: "信任并连接",
      cancelLabel: "取消",
      description: createElement(MarkdownContent, { content: instructions }),
      notice: "密码或私钥验证的是你的身份；主机指纹识别的是服务器。已保存的指纹如果以后发生变化，应用仍会阻止连接并提醒你。",
      size: "lg",
    });
    if (!ok) throw e;

    const trusted = await commands.sshTrustHostKey(host, port, info.fingerprint);
    if (trusted.status === "error") throw trusted.error;

    await start();
  }
}
