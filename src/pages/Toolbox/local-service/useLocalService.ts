import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  addForwardRule,
  createServer,
  generateNginxConfig,
  getForwardRules,
  getServers,
  removeForwardRule,
  removeServer,
  startForwarding,
  startServer,
  stopForwarding,
  stopServer,
  updateForwardRule,
  updateServer,
} from "@/services/toolbox";
import type {
  AuthRuleInput,
  ForwardRule,
  ForwardRuleInput,
  ProxyConfig,
  ServerConfig,
  ServerConfigInput,
} from "@/types/toolbox";
import { NGINX_MANUAL_TEMPLATE } from "./nginxSnippets";
import type { DeleteConfirmState, NginxPreviewState, ServiceType, TabType } from "./types";
import { getForwardUrl, getServerUrl, nginxFileName } from "./utils";

export function useLocalService() {
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const [servers, setServers] = useState<ServerConfig[]>([]);
  const [forwardRules, setForwardRules] = useState<ForwardRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [serviceType, setServiceType] = useState<ServiceType>("web");

  const [editingServer, setEditingServer] = useState<ServerConfig | null>(null);
  const [formName, setFormName] = useState("");
  const [formPort, setFormPort] = useState("8080");
  const [formRootDir, setFormRootDir] = useState("");
  const [formUrlPrefix, setFormUrlPrefix] = useState("");
  const [formIndexPage, setFormIndexPage] = useState("");
  const [formCors, setFormCors] = useState(true);
  const [formGzip, setFormGzip] = useState(true);
  const [formProxies, setFormProxies] = useState<ProxyConfig[]>([]);
  // 访问控制规则。编辑已有规则时 password 留空 = 不改密码（后端按 id 找回哈希），
  // 所以这里存的是 AuthRuleInput 而不是 AuthRule —— 明文密码前端根本拿不到。
  const [formAuthRules, setFormAuthRules] = useState<AuthRuleInput[]>([]);
  // 默认只监听 127.0.0.1；勾选后才绑 0.0.0.0（静态服务与端口转发共用这一个状态位）
  const [formExposeLan, setFormExposeLan] = useState(false);

  const [editingRule, setEditingRule] = useState<ForwardRule | null>(null);
  const [formLocalPort, setFormLocalPort] = useState("");
  const [formRemoteHost, setFormRemoteHost] = useState("");
  const [formRemotePort, setFormRemotePort] = useState("");
  const [formDocPath, setFormDocPath] = useState("");

  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [nginxPreview, setNginxPreview] = useState<NginxPreviewState | null>(null);

  useEffect(() => {
    loadAll();
    const interval = setInterval(() => { if (!document.hidden) loadAll(); }, 2000);
    return () => clearInterval(interval);
  }, []);

  async function loadAll() {
    try {
      const [serversData, rulesData] = await Promise.all([getServers(), getForwardRules()]);
      setServers(serversData);
      setForwardRules(rulesData);
    } catch (error) {
      console.error("加载服务列表失败:", error);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setFormName("");
    setFormPort("8080");
    setFormRootDir("");
    setFormUrlPrefix("");
    setFormIndexPage("");
    setFormCors(true);
    setFormGzip(true);
    setFormProxies([]);
    setFormAuthRules([]);
    setFormExposeLan(false);
    setFormLocalPort("");
    setFormRemoteHost("");
    setFormRemotePort("");
    setFormDocPath("");
    setEditingServer(null);
    setEditingRule(null);
  }

  function openCreateDialog() {
    resetForm();
    setServiceType("web");
    setShowAddDialog(true);
  }

  function closeFormDialog() {
    setShowAddDialog(false);
    resetForm();
  }

  async function handleSelectDir() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择静态文件目录",
      });
      if (selected) {
        setFormRootDir(selected as string);
        const parts = (selected as string).replace(/\\/g, "/").split("/").filter(Boolean);
        const dirName = parts[parts.length - 1];
        if (dirName && !formUrlPrefix) {
          setFormUrlPrefix(`/${dirName}`);
        }
      }
    } catch (error) {
      console.error("选择目录失败:", error);
    }
  }

  function addProxyRule() {
    setFormProxies([...formProxies, { prefix: "/api", target: "" }]);
  }

  function updateProxyRule(index: number, field: "prefix" | "target", value: string) {
    const next = [...formProxies];
    next[index][field] = value;
    setFormProxies(next);
  }

  function removeProxyRule(index: number) {
    setFormProxies(formProxies.filter((_, i) => i !== index));
  }

  function addAuthRule() {
    setFormAuthRules([
      ...formAuthRules,
      { id: null, path: "/", matchKind: "prefix", label: "", password: "", enabled: true },
    ]);
  }

  function updateAuthRule(index: number, patch: Partial<AuthRuleInput>) {
    setFormAuthRules(formAuthRules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  }

  function removeAuthRule(index: number) {
    setFormAuthRules(formAuthRules.filter((_, i) => i !== index));
  }

  function openEditServerDialog(server: ServerConfig) {
    setServiceType("web");
    setEditingServer(server);
    setFormName(server.name);
    setFormPort(server.port.toString());
    setFormRootDir(server.rootDir);
    setFormUrlPrefix(server.urlPrefix || "/");
    setFormIndexPage(server.indexPage || "");
    setFormCors(server.cors);
    setFormGzip(server.gzip);
    setFormProxies(server.proxies || []);
    // 只回填非密码字段：后端只给哈希，password 留空表示「沿用原密码」
    setFormAuthRules(
      (server.authRules || []).map((rule) => ({
        id: rule.id,
        path: rule.path,
        matchKind: rule.matchKind,
        label: rule.label ?? "",
        password: "",
        enabled: rule.enabled !== false,
      }))
    );
    setFormExposeLan(server.exposeLan === true);
    setShowAddDialog(true);
  }

  function openEditRuleDialog(rule: ForwardRule) {
    setServiceType("forward");
    setEditingRule(rule);
    setFormName(rule.name);
    setFormLocalPort(rule.localPort.toString());
    setFormRemoteHost(rule.remoteHost);
    setFormRemotePort(rule.remotePort.toString());
    setFormDocPath(rule.docPath || "");
    setFormExposeLan(rule.exposeLan === true);
    setShowAddDialog(true);
  }

  async function handleSubmit() {
    if (serviceType === "web") {
      await handleSubmitServer();
    } else {
      await handleSubmitForward();
    }
  }

  async function handleSubmitServer() {
    const port = parseInt(formPort);
    if (!formName.trim() || isNaN(port) || !formRootDir.trim()) {
      alert("请填写完整的配置信息");
      return;
    }

    const validProxies = formProxies.filter((p) => p.prefix.trim() && p.target.trim());

    // 新建的规则必须当场设密码：没有 id 就没有可沿用的旧哈希，
    // 放过去只会存下一条永远进不去的规则。
    const authRules = formAuthRules.filter((r) => r.path?.trim());
    const missingPassword = authRules.find((r) => !r.id && !r.password?.trim());
    if (missingPassword) {
      alert(`访问控制规则 ${missingPassword.path} 还没设密码`);
      return;
    }

    const input: ServerConfigInput = {
      name: formName.trim(),
      port,
      rootDir: formRootDir.trim(),
      cors: formCors,
      gzip: formGzip,
      urlPrefix: formUrlPrefix.trim() || "/",
      indexPage: formIndexPage.trim() || null,
      proxies: validProxies.length > 0 ? validProxies : [],
      exposeLan: formExposeLan,
      authRules: authRules.map((rule) => ({
        ...rule,
        path: rule.path.trim(),
        label: rule.label?.trim() || null,
        // 留空 = 沿用原密码，别把空串当成「设为空密码」
        password: rule.password?.trim() || null,
      })),
    };

    try {
      if (editingServer) {
        await updateServer(editingServer.id, input);
      } else {
        await createServer(input);
      }
      closeFormDialog();
      loadAll();
    } catch (error) {
      console.error("保存服务失败:", error);
      alert(`保存服务失败: ${error}`);
    }
  }

  async function handleSubmitForward() {
    const localPort = parseInt(formLocalPort);
    const remotePort = parseInt(formRemotePort);
    if (!formName.trim() || isNaN(localPort) || !formRemoteHost.trim() || isNaN(remotePort)) {
      alert("请填写完整的配置信息");
      return;
    }

    const input: ForwardRuleInput = {
      name: formName.trim(),
      localPort,
      remoteHost: formRemoteHost.trim(),
      remotePort,
      docPath: formDocPath.trim() || undefined,
      exposeLan: formExposeLan,
    };

    try {
      if (editingRule) {
        await updateForwardRule(editingRule.id, input);
      } else {
        await addForwardRule(input);
      }
      closeFormDialog();
      loadAll();
    } catch (error) {
      console.error("保存规则失败:", error);
      alert(`保存规则失败: ${error}`);
    }
  }

  function handleRemoveServer(server: ServerConfig) {
    setDeleteConfirm({ type: "server", id: server.id, name: server.name });
  }

  function handleRemoveRule(rule: ForwardRule) {
    setDeleteConfirm({ type: "forward", id: rule.id, name: rule.name });
  }

  async function confirmRemove() {
    if (!deleteConfirm) return;
    try {
      if (deleteConfirm.type === "server") {
        await removeServer(deleteConfirm.id);
      } else {
        await removeForwardRule(deleteConfirm.id);
      }
      loadAll();
    } catch (error) {
      console.error("删除失败:", error);
    } finally {
      setDeleteConfirm(null);
    }
  }

  async function handleStartServer(serverId: string) {
    try {
      const url = await startServer(serverId);
      loadAll();
      window.open(url, "_blank");
    } catch (error) {
      console.error("启动服务失败:", error);
      alert(`启动服务失败: ${error}`);
    }
  }

  async function handleStopServer(serverId: string) {
    try {
      await stopServer(serverId);
      loadAll();
    } catch (error) {
      console.error("停止服务失败:", error);
    }
  }

  async function handleStartForward(ruleId: string) {
    try {
      await startForwarding(ruleId);
      loadAll();
    } catch (error) {
      console.error("启动转发失败:", error);
      alert(`启动转发失败: ${error}`);
    }
  }

  async function handleStopForward(ruleId: string) {
    try {
      await stopForwarding(ruleId);
      loadAll();
    } catch (error) {
      console.error("停止转发失败:", error);
    }
  }

  async function handleOpenBrowser(server: ServerConfig) {
    const url = getServerUrl(server);
    try {
      await shellOpen(url);
    } catch (error) {
      console.error("打开浏览器失败:", error);
      window.open(url, "_blank");
    }
  }

  async function handleOpenForwardBrowser(rule: ForwardRule) {
    const url = getForwardUrl(rule);
    try {
      await shellOpen(url);
    } catch (error) {
      console.error("打开浏览器失败:", error);
      window.open(url, "_blank");
    }
  }

  async function handleCopyUrl(server: ServerConfig) {
    try {
      await navigator.clipboard.writeText(getServerUrl(server));
      setCopiedId(server.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error("复制失败:", error);
    }
  }

  async function handleCopyForwardUrl(rule: ForwardRule) {
    try {
      await navigator.clipboard.writeText(getForwardUrl(rule));
      setCopiedId(rule.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error("复制失败:", error);
    }
  }

  async function handleGenerateNginx(server: ServerConfig) {
    try {
      const content = await generateNginxConfig(server.id);
      setNginxPreview({
        server,
        title: "Nginx 配置",
        subtitle: `${server.name} · :${server.port} · ${server.urlPrefix}`,
        content,
      });
    } catch (error) {
      console.error("生成 Nginx 配置失败:", error);
      alert(`生成 Nginx 配置失败: ${error}`);
    }
  }

  function handleOpenNginxManual() {
    setNginxPreview({
      title: "nginx 配置手册",
      subtitle: "常用配置片段 · 可插入、复制、编辑和保存",
      fileName: "nginx-manual.conf",
      content: NGINX_MANUAL_TEMPLATE,
    });
  }

  async function handleCopyNginxConfig() {
    if (!nginxPreview) return;
    try {
      await navigator.clipboard.writeText(nginxPreview.content);
      setCopiedId(`nginx-${nginxPreview.server?.id ?? "manual"}`);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error("复制 Nginx 配置失败:", error);
    }
  }

  async function handleCopyNginxSnippet(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(`nginx-snippet-${code}`);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error("复制 Nginx 片段失败:", error);
    }
  }

  async function handleSaveNginxConfig() {
    if (!nginxPreview) return;
    try {
      const path = await save({
        title: "保存 Nginx 配置",
        defaultPath: nginxPreview.fileName ?? (nginxPreview.server ? nginxFileName(nginxPreview.server) : "nginx.conf"),
        filters: [{ name: "Nginx Config", extensions: ["conf"] }],
      });
      if (!path) return;
      await writeTextFile(path, nginxPreview.content);
    } catch (error) {
      console.error("保存 Nginx 配置失败:", error);
      alert(`保存 Nginx 配置失败: ${error}`);
    }
  }

  const filteredServers = activeTab === "forward" ? [] : servers;
  const filteredRules = activeTab === "web" ? [] : forwardRules;

  return {
    activeTab,
    setActiveTab,
    servers,
    forwardRules,
    loading,
    filteredServers,
    filteredRules,
    copiedId,
    showAddDialog,
    nginxPreview,
    deleteConfirm,
    loadAll,
    openCreateDialog,
    handleOpenNginxManual,
    serviceListCallbacks: {
      getServerUrl,
      getForwardUrl,
      onOpenServer: handleOpenBrowser,
      onOpenForward: handleOpenForwardBrowser,
      onCopyServerUrl: handleCopyUrl,
      onCopyForwardUrl: handleCopyForwardUrl,
      onGenerateNginx: handleGenerateNginx,
      onStartServer: handleStartServer,
      onStopServer: handleStopServer,
      onEditServer: openEditServerDialog,
      onRemoveServer: handleRemoveServer,
      onStartForward: handleStartForward,
      onStopForward: handleStopForward,
      onEditForward: openEditRuleDialog,
      onRemoveForward: handleRemoveRule,
    },
    serviceFormProps: {
      serviceType,
      editingServer,
      editingRule,
      formName,
      formPort,
      formRootDir,
      formUrlPrefix,
      formIndexPage,
      formCors,
      formGzip,
      formProxies,
      formAuthRules,
      formLocalPort,
      formRemoteHost,
      formRemotePort,
      formDocPath,
      onServiceTypeChange: setServiceType,
      onFormNameChange: setFormName,
      onFormPortChange: setFormPort,
      onFormRootDirChange: setFormRootDir,
      onFormUrlPrefixChange: setFormUrlPrefix,
      onFormIndexPageChange: setFormIndexPage,
      onFormCorsChange: setFormCors,
      onFormGzipChange: setFormGzip,
      onFormLocalPortChange: setFormLocalPort,
      onFormRemoteHostChange: setFormRemoteHost,
      onFormRemotePortChange: setFormRemotePort,
      onFormDocPathChange: setFormDocPath,
      formExposeLan,
      onFormExposeLanChange: setFormExposeLan,
      onSelectDir: handleSelectDir,
      onAddProxy: addProxyRule,
      onUpdateProxy: updateProxyRule,
      onRemoveProxy: removeProxyRule,
      onAddAuthRule: addAuthRule,
      onUpdateAuthRule: updateAuthRule,
      onRemoveAuthRule: removeAuthRule,
      onCancel: closeFormDialog,
      onSubmit: handleSubmit,
    },
    nginxDialogProps: nginxPreview ? {
      preview: nginxPreview,
      copiedId,
      onChange: setNginxPreview,
      onClose: () => setNginxPreview(null),
      onCopyConfig: handleCopyNginxConfig,
      onSaveConfig: handleSaveNginxConfig,
      onCopySnippet: handleCopyNginxSnippet,
    } : null,
    deleteDialogProps: deleteConfirm ? {
      confirm: deleteConfirm,
      onCancel: () => setDeleteConfirm(null),
      onConfirm: confirmRemove,
    } : null,
  };
}
