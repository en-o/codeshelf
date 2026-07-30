import { useEffect, useMemo, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  addSshTunnel,
  getSshTunnels,
  listLocalIps,
  listSshConfigHosts,
  removeSshTunnel,
  setSshTunnelGroup,
  startSshTunnel,
  stopSshTunnel,
  testSshTunnel,
  updateSshTunnel,
} from "@/services/toolbox";
import { startWithHostKeyTrust } from "@/services/ssh/hostKeyTrust";
import { DEFAULT_SSH_GROUP } from "@/types/toolbox";
import type { SshAuthMethod, SshTunnel, SshTunnelInput } from "@/types/toolbox";
import type { AuthType, DeleteConfirmState, TestState } from "./types";

const DEFAULT_PORT = "22";

export function useSshTunnel() {
  const [tunnels, setTunnels] = useState<SshTunnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editing, setEditing] = useState<SshTunnel | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);
  const [sshConfigHosts, setSshConfigHosts] = useState<string[]>([]);
  const [localIps, setLocalIps] = useState<string[]>([]);
  const [testState, setTestState] = useState<TestState | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);

  // 表单状态
  const [formName, setFormName] = useState("");
  const [formLocalPort, setFormLocalPort] = useState("");
  const [formRemoteHost, setFormRemoteHost] = useState("127.0.0.1");
  const [formRemotePort, setFormRemotePort] = useState("");
  const [formSshHost, setFormSshHost] = useState("");
  const [formSshPort, setFormSshPort] = useState(DEFAULT_PORT);
  const [formSshUser, setFormSshUser] = useState("root");
  const [formAuthType, setFormAuthType] = useState<AuthType>("key");
  const [formKeyPath, setFormKeyPath] = useState("");
  const [formPassphrase, setFormPassphrase] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formHostAlias, setFormHostAlias] = useState("");
  const [formAutoReconnect, setFormAutoReconnect] = useState(true);
  // 默认只监听 127.0.0.1；勾选后才绑 0.0.0.0
  const [formExposeLan, setFormExposeLan] = useState(false);
  const [formGroup, setFormGroup] = useState(DEFAULT_SSH_GROUP);

  useEffect(() => {
    loadAll();
    listSshConfigHosts()
      .then(setSshConfigHosts)
      .catch((err) => console.warn("读取 ~/.ssh/config 失败:", err));
    listLocalIps()
      .then(setLocalIps)
      .catch((err) => console.warn("读取本机 IP 失败:", err));
    const interval = setInterval(() => { if (!document.hidden) loadAll(); }, 2000);
    return () => clearInterval(interval);
  }, []);

  // 已有分组（去重，默认分组置顶），供表单下拉与迁移菜单使用
  const groups = useMemo(() => {
    const set = new Set<string>([DEFAULT_SSH_GROUP]);
    for (const t of tunnels) {
      set.add(t.group || DEFAULT_SSH_GROUP);
    }
    return Array.from(set);
  }, [tunnels]);

  async function loadAll() {
    try {
      const data = await getSshTunnels();
      setTunnels(data);
    } catch (err) {
      console.error("加载 SSH 隧道失败:", err);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setFormName("");
    setFormLocalPort("");
    setFormRemoteHost("127.0.0.1");
    setFormRemotePort("");
    setFormSshHost("");
    setFormSshPort(DEFAULT_PORT);
    setFormSshUser("root");
    setFormAuthType("key");
    setFormKeyPath("");
    setFormPassphrase("");
    setFormPassword("");
    setFormHostAlias("");
    setFormAutoReconnect(true);
    setFormExposeLan(false);
    setFormGroup(DEFAULT_SSH_GROUP);
    setEditing(null);
  }

  function openCreateDialog() {
    resetForm();
    setShowAddDialog(true);
  }

  function closeFormDialog() {
    setShowAddDialog(false);
    resetForm();
  }

  // 用某条隧道填充表单（编辑与「复制创建」共用）
  function fillFormFromTunnel(t: SshTunnel) {
    setFormName(t.name);
    setFormLocalPort(String(t.localPort));
    setFormRemoteHost(t.remoteHost);
    setFormRemotePort(String(t.remotePort));
    setFormSshHost(t.sshHost);
    setFormSshPort(String(t.sshPort));
    setFormSshUser(t.sshUser);
    setFormAuthType(t.auth.type);
    setFormKeyPath(t.auth.type === "key" ? t.auth.keyPath : "");
    setFormPassphrase(t.auth.type === "key" ? t.auth.passphrase || "" : "");
    setFormPassword(t.auth.type === "password" ? t.auth.password : "");
    setFormHostAlias(t.auth.type === "sshConfig" ? t.auth.hostAlias : "");
    setFormAutoReconnect(t.autoReconnect ?? true);
    setFormExposeLan(t.exposeLan === true);
    setFormGroup(t.group || DEFAULT_SSH_GROUP);
  }

  function openEditDialog(t: SshTunnel) {
    setEditing(t);
    fillFormFromTunnel(t);
    setShowAddDialog(true);
  }

  // 快捷复制创建：用现有隧道预填，但作为「新建」提交（不设 editing）
  function openDuplicateDialog(t: SshTunnel) {
    setEditing(null);
    fillFormFromTunnel(t);
    setFormName(`${t.name} 副本`);
    setShowAddDialog(true);
  }

  async function handleSelectKey() {
    try {
      const { homeDir, join } = await import("@tauri-apps/api/path");
      const home = await homeDir();
      // 跨平台拼接 — Windows: C:\Users\<user>\.ssh, macOS/Linux: ~/.ssh
      const sshDir = await join(home, ".ssh");
      const selected = await open({
        directory: false,
        multiple: false,
        title: "选择 SSH 私钥",
        defaultPath: sshDir,
      });
      if (selected) setFormKeyPath(selected as string);
    } catch (err) {
      console.error("选择私钥失败:", err);
    }
  }

  function buildAuth(): SshAuthMethod | null {
    if (formAuthType === "key") {
      if (!formKeyPath.trim()) {
        alert("请选择私钥文件");
        return null;
      }
      return {
        type: "key",
        keyPath: formKeyPath.trim(),
        passphrase: formPassphrase || undefined,
      };
    }
    if (formAuthType === "password") {
      if (!formPassword) {
        alert("请输入密码");
        return null;
      }
      return { type: "password", password: formPassword };
    }
    if (!formHostAlias.trim()) {
      alert("请选择或输入 SSH config Host 别名");
      return null;
    }
    return { type: "sshConfig", hostAlias: formHostAlias.trim() };
  }

  async function handleSubmit() {
    const localPort = parseInt(formLocalPort);
    const remotePort = parseInt(formRemotePort);
    const sshPort = parseInt(formSshPort);
    if (!formName.trim() || Number.isNaN(localPort) || Number.isNaN(remotePort)) {
      alert("请填写完整：名称 / 本地端口 / 远程端口");
      return;
    }
    if (formAuthType !== "sshConfig") {
      if (!formSshHost.trim() || Number.isNaN(sshPort) || !formSshUser.trim()) {
        alert("请填写完整：SSH 主机 / 端口 / 用户");
        return;
      }
    }
    const auth = buildAuth();
    if (!auth) return;

    const input: SshTunnelInput = {
      name: formName.trim(),
      localPort,
      remoteHost: formRemoteHost.trim() || "127.0.0.1",
      remotePort,
      sshHost: formSshHost.trim(),
      sshPort: Number.isNaN(sshPort) ? 22 : sshPort,
      sshUser: formSshUser.trim() || undefined,
      auth,
      exposeLan: formExposeLan,
      autoReconnect: formAutoReconnect,
      group: formGroup.trim() || DEFAULT_SSH_GROUP,
    };

    try {
      if (editing) {
        await updateSshTunnel(editing.id, input);
      } else {
        await addSshTunnel(input);
      }
      closeFormDialog();
      loadAll();
    } catch (err) {
      console.error("保存 SSH 隧道失败:", err);
      alert(`保存 SSH 隧道失败: ${err}`);
    }
  }

  async function handleStart(id: string) {
    const t = tunnels.find((x) => x.id === id);
    try {
      // 首次连接时展示主机密钥指纹让用户确认；密钥变更一律拒绝（见 hostKeyTrust）
      await startWithHostKeyTrust(t?.sshHost ?? "", t?.sshPort ?? 22, () => startSshTunnel(id));
      loadAll();
    } catch (err) {
      console.error("启动隧道失败:", err);
      alert(`启动隧道失败: ${typeof err === "string" ? err : err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleStop(id: string) {
    try {
      await stopSshTunnel(id);
      loadAll();
    } catch (err) {
      console.error("停止隧道失败:", err);
    }
  }

  function handleRemove(t: SshTunnel) {
    setDeleteConfirm({ id: t.id, name: t.name });
  }

  async function confirmRemove() {
    if (!deleteConfirm) return;
    try {
      await removeSshTunnel(deleteConfirm.id);
      loadAll();
    } catch (err) {
      console.error("删除隧道失败:", err);
    } finally {
      setDeleteConfirm(null);
    }
  }

  async function handleCopyLocal(t: SshTunnel) {
    try {
      await navigator.clipboard.writeText(`127.0.0.1:${t.localPort}`);
      setCopiedId(t.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("复制失败:", err);
    }
  }

  async function handleTest(t: SshTunnel) {
    setTestState({ tunnelId: t.id, loading: true });
    try {
      const result = await testSshTunnel(t.id);
      setTestState({ tunnelId: t.id, loading: false, result });
    } catch (err) {
      setTestState({
        tunnelId: t.id,
        loading: false,
        result: {
          success: false,
          output: String(err),
          method: "tcp",
          durationMs: 0,
        },
      });
    }
  }

  function dismissTest() {
    setTestState(null);
  }

  // 迁移分组：仅改分组、不停止运行中的隧道
  async function moveToGroup(t: SshTunnel, group: string) {
    if ((t.group || DEFAULT_SSH_GROUP) === group) return;
    try {
      await setSshTunnelGroup(t.id, group);
      loadAll();
    } catch (err) {
      console.error("迁移分组失败:", err);
      alert(`迁移分组失败: ${err}`);
    }
  }

  // 导出：**一切秘密都不出去**。
  // 私钥路径换机无效，密码 / passphrase 更是账户凭据 —— 用户把 JSON 发给同事、
  // 传到网盘或贴进工单时，这些字段会一起走。导入方需要自己重新填。
  function stripForExport(auth: SshAuthMethod): SshAuthMethod {
    if (auth.type === "key") {
      return { type: "key", keyPath: "", passphrase: "" };
    }
    if (auth.type === "password") {
      return { type: "password", password: "" };
    }
    return auth;
  }

  function buildExportItem(t: SshTunnel) {
    return {
      name: t.name,
      localPort: t.localPort,
      remoteHost: t.remoteHost,
      remotePort: t.remotePort,
      sshHost: t.sshHost,
      sshPort: t.sshPort,
      sshUser: t.sshUser,
      auth: stripForExport(t.auth),
      exposeLan: t.exposeLan,
      autoReconnect: t.autoReconnect,
      group: t.group || DEFAULT_SSH_GROUP,
    };
  }

  function openExportDialog() {
    if (tunnels.length === 0) {
      alert("暂无可导出的隧道");
      return;
    }
    setShowExportDialog(true);
  }

  function closeExportDialog() {
    setShowExportDialog(false);
  }

  // 选择性导出：只导出勾选的隧道
  async function confirmExport(selectedIds: string[]) {
    const list = tunnels.filter((t) => selectedIds.includes(t.id));
    if (list.length === 0) {
      setShowExportDialog(false);
      return;
    }
    try {
      const payload = {
        type: "codeshelf-ssh-tunnels",
        version: 1,
        tunnels: list.map(buildExportItem),
      };
      const filePath = await save({
        title: "导出 SSH 隧道配置",
        defaultPath: "ssh-tunnels.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, JSON.stringify(payload, null, 2));
        setShowExportDialog(false);
      }
    } catch (err) {
      console.error("导出失败:", err);
      alert(`导出失败: ${err}`);
    }
  }

  // 把导入文件中的一条记录映射为创建输入（容错：缺字段抛错由上层逐条捕获）
  function toImportInput(item: any): SshTunnelInput {
    const localPort = Number(item?.localPort);
    const remotePort = Number(item?.remotePort);
    if (!item?.name || Number.isNaN(localPort) || Number.isNaN(remotePort)) {
      throw new Error("字段缺失（名称 / 本地端口 / 远程端口）");
    }
    const auth = item?.auth as SshAuthMethod | undefined;
    if (!auth || !auth.type) {
      throw new Error("缺少认证信息");
    }
    return {
      name: String(item.name),
      localPort,
      remoteHost:
        typeof item.remoteHost === "string" && item.remoteHost ? item.remoteHost : "127.0.0.1",
      remotePort,
      sshHost: typeof item.sshHost === "string" ? item.sshHost : "",
      sshPort: item.sshPort != null ? Number(item.sshPort) : undefined,
      sshUser: typeof item.sshUser === "string" && item.sshUser ? item.sshUser : undefined,
      auth,
      exposeLan: item.exposeLan === true,
      autoReconnect: typeof item.autoReconnect === "boolean" ? item.autoReconnect : undefined,
      group: typeof item.group === "string" && item.group ? item.group : DEFAULT_SSH_GROUP,
    };
  }

  async function handleImport() {
    try {
      const filePath = await open({
        title: "导入 SSH 隧道配置",
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
        alert("导入文件中没有可用的隧道配置");
        return;
      }

      let success = 0;
      const failed: string[] = [];
      const needKey: string[] = [];
      for (const item of list) {
        const name = typeof item?.name === "string" ? item.name : "(未命名)";
        try {
          const input = toImportInput(item);
          await addSshTunnel(input);
          success += 1;
          if (input.auth.type === "key" && !input.auth.keyPath) {
            needKey.push(input.name);
          }
        } catch (err) {
          console.error("导入隧道失败:", name, err);
          failed.push(`${name}: ${err}`);
        }
      }
      loadAll();

      let msg = `导入完成：成功 ${success} 个`;
      if (failed.length > 0) {
        msg += `，失败 ${failed.length} 个\n${failed.join("\n")}`;
      }
      if (needKey.length > 0) {
        msg += `\n\n以下隧道使用私钥认证，请编辑后重新设置「私钥路径」：\n${needKey.join("、")}`;
      }
      alert(msg);
    } catch (err) {
      console.error("导入失败:", err);
      alert(`导入失败: ${err}`);
    }
  }

  return {
    tunnels,
    loading,
    showAddDialog,
    deleteConfirm,
    copiedId,
    sshConfigHosts,
    localIps,
    groups,
    testState,
    dismissTest,
    loadAll,
    openCreateDialog,
    openExportDialog,
    handleImport,
    listCallbacks: {
      onStart: handleStart,
      onStop: handleStop,
      onEdit: openEditDialog,
      onRemove: handleRemove,
      onCopyLocal: handleCopyLocal,
      onTest: handleTest,
      onDuplicate: openDuplicateDialog,
      onMoveToGroup: moveToGroup,
    },
    formProps: {
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
      onFormExposeLanChange: setFormExposeLan,
      formGroup,
      sshConfigHosts,
      localIps,
      groups,
      onFormNameChange: setFormName,
      onFormLocalPortChange: setFormLocalPort,
      onFormRemoteHostChange: setFormRemoteHost,
      onFormRemotePortChange: setFormRemotePort,
      onFormSshHostChange: setFormSshHost,
      onFormSshPortChange: setFormSshPort,
      onFormSshUserChange: setFormSshUser,
      onFormAuthTypeChange: setFormAuthType,
      onFormKeyPathChange: setFormKeyPath,
      onFormPassphraseChange: setFormPassphrase,
      onFormPasswordChange: setFormPassword,
      onFormHostAliasChange: setFormHostAlias,
      onFormAutoReconnectChange: setFormAutoReconnect,
      onFormGroupChange: setFormGroup,
      onSelectKey: handleSelectKey,
      onCancel: closeFormDialog,
      onSubmit: handleSubmit,
    },
    deleteDialogProps: deleteConfirm
      ? {
          confirm: deleteConfirm,
          onCancel: () => setDeleteConfirm(null),
          onConfirm: confirmRemove,
        }
      : null,
    exportDialogProps: showExportDialog
      ? {
          tunnels,
          onCancel: closeExportDialog,
          onConfirm: confirmExport,
        }
      : null,
  };
}
