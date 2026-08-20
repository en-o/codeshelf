// 工具箱服务层 - 封装所有 Tauri 命令

import { invoke } from "@tauri-apps/api/core";
import type {
  ScanConfig,
  ScanResult,
  DownloadConfig,
  DownloadTask,
  ProcessInfo,
  ProcessFilter,
  SystemStats,
  PortOccupation,
  ForwardRule,
  ForwardRuleInput,
  ForwardStats,
  ServerConfig,
  ServerConfigInput,
  DockerStatus,
  DockerCommandResult,
  DockerImageInfo,
  DockerContainerInfo,
  DockerBuildInput,
  DockerRunInput,
  DockerAiGenerateInput,
  DockerAiGenerateOutput,
  SshTunnel,
  SshTunnelInput,
  SshTunnelStats,
  ReverseTunnel,
  ReverseTunnelInput,
  ReverseTunnelStats,
  TestPortResult,
} from "@/types/toolbox";

// ============== 端口扫描服务 ==============

export async function scanPorts(config: ScanConfig): Promise<ScanResult[]> {
  // 后端已配置 rename_all = "camelCase"，直接发送
  return invoke("scan_ports", { config });
}

export async function stopScan(): Promise<void> {
  return invoke("stop_scan");
}

export async function getCommonPorts(): Promise<number[]> {
  return invoke("get_common_ports");
}

export async function checkPort(
  target: string,
  port: number,
  timeoutMs?: number
): Promise<ScanResult> {
  return invoke("check_port", { target, port, timeoutMs });
}

export async function scanLocalDevPorts(): Promise<ScanResult[]> {
  return invoke("scan_local_dev_ports");
}

// ============== 文件下载服务 ==============

export async function startDownload(config: DownloadConfig): Promise<string> {
  // 后端已配置 rename_all = "camelCase"，直接发送
  return invoke("start_download", { config });
}

export async function pauseDownload(taskId: string): Promise<void> {
  return invoke("pause_download", { taskId });
}

export async function resumeDownload(taskId: string): Promise<void> {
  return invoke("resume_download", { taskId });
}

export async function cancelDownload(taskId: string): Promise<void> {
  return invoke("cancel_download", { taskId });
}

export async function getDownloadTasks(): Promise<DownloadTask[]> {
  return invoke("get_download_tasks");
}

export async function getDownloadTask(
  taskId: string
): Promise<DownloadTask | null> {
  return invoke("get_download_task", { taskId });
}

export async function clearCompletedDownloads(): Promise<number> {
  return invoke("clear_completed_downloads");
}

export async function openDownloadFolder(taskId: string): Promise<void> {
  return invoke("open_download_folder", { taskId });
}

export async function removeDownloadTask(taskId: string, deleteFile?: boolean): Promise<void> {
  return invoke("remove_download_task", { taskId, deleteFile });
}

// ============== 进程管理服务 ==============

export async function getProcesses(
  filter?: ProcessFilter
): Promise<ProcessInfo[]> {
  return invoke("get_processes", { filter });
}

export async function getPortProcesses(port: number): Promise<ProcessInfo[]> {
  return invoke("get_port_processes", { port });
}

export async function killProcess(
  pid: number,
  force?: boolean
): Promise<void> {
  return invoke("kill_process", { pid, force });
}

export async function getSystemStats(): Promise<SystemStats> {
  return invoke("get_system_stats");
}

export async function getLocalPortOccupation(): Promise<PortOccupation[]> {
  return invoke("get_local_port_occupation");
}

// ============== 端口转发服务 ==============

export async function addForwardRule(
  input: ForwardRuleInput
): Promise<ForwardRule> {
  // 直接发送 camelCase，后端已配置 rename_all = "camelCase"
  return invoke("add_forward_rule", { input });
}

export async function removeForwardRule(ruleId: string): Promise<void> {
  return invoke("remove_forward_rule", { ruleId });
}

export async function startForwarding(ruleId: string): Promise<void> {
  return invoke("start_forwarding", { ruleId });
}

export async function stopForwarding(ruleId: string): Promise<void> {
  return invoke("stop_forwarding", { ruleId });
}

export async function getForwardRules(): Promise<ForwardRule[]> {
  return invoke("get_forward_rules");
}

export async function getForwardRule(
  ruleId: string
): Promise<ForwardRule | null> {
  return invoke("get_forward_rule", { ruleId });
}

export async function getForwardStats(ruleId: string): Promise<ForwardStats> {
  return invoke("get_forward_stats", { ruleId });
}

export async function updateForwardRule(
  ruleId: string,
  input: ForwardRuleInput
): Promise<ForwardRule> {
  // 直接发送 camelCase，后端已配置 rename_all = "camelCase"
  return invoke("update_forward_rule", { ruleId, input });
}

// ============== SSH 隧道服务 ==============

export async function addSshTunnel(input: SshTunnelInput): Promise<SshTunnel> {
  return invoke("add_ssh_tunnel", { input });
}

export async function updateSshTunnel(
  tunnelId: string,
  input: SshTunnelInput
): Promise<SshTunnel> {
  return invoke("update_ssh_tunnel", { tunnelId, input });
}

export async function removeSshTunnel(tunnelId: string): Promise<void> {
  return invoke("remove_ssh_tunnel", { tunnelId });
}

export async function startSshTunnel(tunnelId: string): Promise<void> {
  return invoke("start_ssh_tunnel", { tunnelId });
}

export async function stopSshTunnel(tunnelId: string): Promise<void> {
  return invoke("stop_ssh_tunnel", { tunnelId });
}

export async function getSshTunnels(): Promise<SshTunnel[]> {
  return invoke("get_ssh_tunnels");
}

export async function getSshTunnel(tunnelId: string): Promise<SshTunnel | null> {
  return invoke("get_ssh_tunnel", { tunnelId });
}

export async function getSshTunnelStats(tunnelId: string): Promise<SshTunnelStats> {
  return invoke("get_ssh_tunnel_stats", { tunnelId });
}

export async function listSshConfigHosts(): Promise<string[]> {
  return invoke("list_ssh_config_hosts");
}

export async function listLocalIps(): Promise<string[]> {
  return invoke("list_local_ips");
}

export async function setSshTunnelGroup(
  tunnelId: string,
  group: string
): Promise<SshTunnel> {
  return invoke("set_ssh_tunnel_group", { tunnelId, group });
}

export async function testSshTunnel(tunnelId: string): Promise<TestPortResult> {
  return invoke("test_ssh_tunnel", { tunnelId });
}

export async function testLocalPort(port: number): Promise<TestPortResult> {
  return invoke("test_local_port", { port });
}

// ============== 内网穿透（反向 SSH 隧道）==============

export async function addReverseTunnel(
  input: ReverseTunnelInput
): Promise<ReverseTunnel> {
  return invoke("add_reverse_tunnel", { input });
}

export async function updateReverseTunnel(
  tunnelId: string,
  input: ReverseTunnelInput
): Promise<ReverseTunnel> {
  return invoke("update_reverse_tunnel", { tunnelId, input });
}

export async function removeReverseTunnel(tunnelId: string): Promise<void> {
  return invoke("remove_reverse_tunnel", { tunnelId });
}

export async function startReverseTunnel(tunnelId: string): Promise<void> {
  return invoke("start_reverse_tunnel", { tunnelId });
}

export async function stopReverseTunnel(tunnelId: string): Promise<void> {
  return invoke("stop_reverse_tunnel", { tunnelId });
}

export async function getReverseTunnels(): Promise<ReverseTunnel[]> {
  return invoke("get_reverse_tunnels");
}

export async function getReverseTunnel(
  tunnelId: string
): Promise<ReverseTunnel | null> {
  return invoke("get_reverse_tunnel", { tunnelId });
}

export async function getReverseTunnelStats(
  tunnelId: string
): Promise<ReverseTunnelStats> {
  return invoke("get_reverse_tunnel_stats", { tunnelId });
}

export async function listReverseSshConfigHosts(): Promise<string[]> {
  return invoke("list_reverse_ssh_config_hosts");
}

export async function setReverseTunnelGroup(
  tunnelId: string,
  group: string
): Promise<ReverseTunnel> {
  return invoke("set_reverse_tunnel_group", { tunnelId, group });
}

// ============== 静态服务 ==============

export async function createServer(
  input: ServerConfigInput
): Promise<ServerConfig> {
  // 直接发送 camelCase，后端已配置 rename_all = "camelCase"
  return invoke("create_server", { input });
}

export async function startServer(serverId: string): Promise<string> {
  return invoke("start_server", { serverId });
}

export async function stopServer(serverId: string): Promise<void> {
  return invoke("stop_server", { serverId });
}

export async function removeServer(serverId: string): Promise<void> {
  return invoke("remove_server", { serverId });
}

export async function getServers(): Promise<ServerConfig[]> {
  return invoke("get_servers");
}

export async function getServer(serverId: string): Promise<ServerConfig | null> {
  return invoke("get_server", { serverId });
}

export async function updateServer(
  serverId: string,
  input: ServerConfigInput
): Promise<ServerConfig> {
  // 直接发送 camelCase，后端已配置 rename_all = "camelCase"
  return invoke("update_server", { serverId, input });
}

export async function generateNginxConfig(serverId: string): Promise<string> {
  return invoke("generate_nginx_config", { serverId });
}

// ============== Docker 镜像服务 ==============

export async function dockerCheckAvailable(): Promise<DockerStatus> {
  return invoke("docker_check_available");
}

export async function dockerFindDockerfiles(projectPath: string): Promise<string[]> {
  return invoke("docker_find_dockerfiles", { projectPath });
}

export async function dockerReadDockerfile(projectPath: string, dockerfilePath: string): Promise<string> {
  return invoke("docker_read_dockerfile", { projectPath, dockerfilePath });
}

export async function dockerWriteDockerfile(
  projectPath: string,
  dockerfilePath: string,
  content: string,
): Promise<void> {
  return invoke("docker_write_dockerfile", { projectPath, dockerfilePath, content });
}

export async function dockerGenerateDockerfileTemplate(
  projectPath: string,
  template?: string,
): Promise<string> {
  return invoke("docker_generate_dockerfile_template", { projectPath, template });
}

export async function dockerGenerateDockerfileAi(
  input: DockerAiGenerateInput,
): Promise<DockerAiGenerateOutput> {
  return invoke("docker_generate_dockerfile_ai", { input });
}

export async function dockerBuildImage(input: DockerBuildInput): Promise<DockerCommandResult> {
  return invoke("docker_build_image", { input });
}

export async function dockerListImages(): Promise<DockerImageInfo[]> {
  return invoke("docker_list_images");
}

export async function dockerRemoveImage(image: string, force?: boolean): Promise<DockerCommandResult> {
  return invoke("docker_remove_image", { image, force });
}

export async function dockerRunImage(input: DockerRunInput): Promise<DockerCommandResult> {
  return invoke("docker_run_image", { input });
}

export async function dockerListContainers(): Promise<DockerContainerInfo[]> {
  return invoke("docker_list_containers");
}

export async function dockerInspectContainerYaml(container: string): Promise<string> {
  return invoke("docker_inspect_container_yaml", { container });
}

export async function dockerStopContainer(container: string): Promise<DockerCommandResult> {
  return invoke("docker_stop_container", { container });
}

export async function dockerStartContainer(container: string): Promise<DockerCommandResult> {
  return invoke("docker_start_container", { container });
}

export async function dockerRestartContainer(container: string): Promise<DockerCommandResult> {
  return invoke("docker_restart_container", { container });
}

export async function dockerRemoveContainer(container: string, force?: boolean): Promise<DockerCommandResult> {
  return invoke("docker_remove_container", { container, force });
}

export async function dockerPushImage(image: string): Promise<DockerCommandResult> {
  return invoke("docker_push_image", { image });
}

// ============== Claude Code 配置服务 ==============

import type { ClaudeCodeInfo, EnvType, QuickConfigOption, ConfigProfile, ConfigFileInfo } from "@/types/toolbox";

function mapClaudeInfo(info: any): ClaudeCodeInfo {
  return {
    envType: info.env_type as EnvType,
    envName: info.env_name,
    installed: info.installed,
    version: info.version,
    path: info.path,
    configDir: info.config_dir,
    configFiles: (info.config_files || []).map((f: any) => ({
      name: f.name,
      path: f.path,
      exists: f.exists,
      size: f.size,
      modified: f.modified,
      description: f.description,
    })),
  };
}

export async function checkAllClaudeInstallations(): Promise<ClaudeCodeInfo[]> {
  const infos: any[] = await invoke("check_all_claude_installations");
  return infos.map(mapClaudeInfo);
}

export async function checkCodexInstallations(): Promise<ClaudeCodeInfo[]> {
  const infos: any[] = await invoke("check_codex_installations");
  return infos.map(mapClaudeInfo);
}

export async function checkClaudeByPath(claudePath: string): Promise<ClaudeCodeInfo> {
  const info: any = await invoke("check_claude_by_path", { claudePath });
  return {
    envType: info.env_type as EnvType,
    envName: info.env_name,
    installed: info.installed,
    version: info.version,
    path: info.path,
    configDir: info.config_dir,
    configFiles: (info.config_files || []).map((f: any) => ({
      name: f.name,
      path: f.path,
      exists: f.exists,
      size: f.size,
      modified: f.modified,
      description: f.description,
    })),
  };
}

export async function readClaudeConfigFile(envType: EnvType, envName: string, path: string): Promise<string> {
  return invoke("read_claude_config_file", { envType, envName, path });
}

export async function writeClaudeConfigFile(envType: EnvType, envName: string, path: string, content: string): Promise<void> {
  return invoke("write_claude_config_file", { envType, envName, path, content });
}

export async function openClaudeConfigDir(envType: EnvType, envName: string, configDir: string): Promise<void> {
  return invoke("open_claude_config_dir", { envType, envName, configDir });
}

export async function getQuickConfigOptions(): Promise<QuickConfigOption[]> {
  const options: any[] = await invoke("get_quick_config_options");
  return options.map((opt: any) => ({
    id: opt.id,
    name: opt.name,
    description: opt.description,
    category: opt.category,
    configKey: opt.config_key,
    configValue: opt.config_value,
  }));
}

export async function applyQuickConfig(envType: EnvType, envName: string, configPath: string, options: string[]): Promise<void> {
  return invoke("apply_quick_config", { envType, envName, configPath, options });
}

export async function getConfigProfiles(envType: EnvType, envName: string): Promise<ConfigProfile[]> {
  const profiles: any[] = await invoke("get_config_profiles", { envType, envName });
  return profiles.map((p: any) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    settings: p.settings,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  }));
}

export async function saveConfigProfile(envType: EnvType, envName: string, name: string, description: string | undefined, settings: Record<string, unknown>): Promise<ConfigProfile> {
  const profile: any = await invoke("save_config_profile", { envType, envName, name, description, settings });
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    settings: profile.settings,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

export async function deleteConfigProfile(envType: EnvType, envName: string, profileId: string): Promise<void> {
  return invoke("delete_config_profile", { envType, envName, profileId });
}

export async function applyConfigProfile(envType: EnvType, envName: string, configPath: string, profileId: string): Promise<void> {
  return invoke("apply_config_profile", { envType, envName, configPath, profileId });
}

export async function createProfileFromCurrent(envType: EnvType, envName: string, configPath: string, profileName: string, description?: string): Promise<ConfigProfile> {
  const profile: any = await invoke("create_profile_from_current", { envType, envName, configPath, profileName, description });
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    settings: profile.settings,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

export async function scanClaudeConfigDir(envType: EnvType, envName: string, configDir: string): Promise<ConfigFileInfo[]> {
  const files: any[] = await invoke("scan_claude_config_dir", { envType, envName, configDir });
  return files.map((f: any) => ({
    name: f.name,
    path: f.path,
    exists: f.exists,
    size: f.size,
    modified: f.modified,
    description: f.description,
  }));
}

export async function getWslConfigDir(distro: string): Promise<{ linuxPath: string; uncPath: string }> {
  const result: any = await invoke("get_wsl_config_dir", { distro });
  return {
    linuxPath: result.linux_path,
    uncPath: result.unc_path,
  };
}

// Claude 安装信息缓存
export async function getClaudeInstallationsCache(): Promise<ClaudeCodeInfo[] | null> {
  const result: any = await invoke("get_claude_installations_cache");
  if (!result) return null;
  return result.map((info: any) => ({
    envType: info.env_type as EnvType,
    envName: info.env_name,
    installed: info.installed,
    version: info.version,
    path: info.path,
    configDir: info.config_dir,
    configFiles: (info.config_files || []).map((f: any) => ({
      name: f.name,
      path: f.path,
      exists: f.exists,
      size: f.size,
      modified: f.modified,
      description: f.description,
    })),
  }));
}

export async function saveClaudeInstallationsCache(installs: ClaudeCodeInfo[]): Promise<void> {
  // 转换为后端格式
  const data = installs.map(info => ({
    env_type: info.envType,
    env_name: info.envName,
    installed: info.installed,
    version: info.version,
    path: info.path,
    config_dir: info.configDir,
    config_files: info.configFiles.map(f => ({
      name: f.name,
      path: f.path,
      exists: f.exists,
      size: f.size,
      modified: f.modified,
      description: f.description,
    })),
  }));
  return invoke("save_claude_installations_cache", { installs: data });
}

export async function clearClaudeInstallationsCache(): Promise<void> {
  return invoke("clear_claude_installations_cache");
}

// Claude 启动目录管理
export async function launchClaudeInTerminal(
  workDir?: string,
  terminalType?: string,
  customPath?: string,
  terminalPath?: string,
  envType?: string,
  envName?: string,
  cli?: string
): Promise<void> {
  return invoke("launch_claude_in_terminal", {
    workDir,
    terminalType,
    customPath,
    terminalPath,
    envType,
    envName,
    cli,
  });
}

export async function getClaudeLaunchDirs(): Promise<string[]> {
  return invoke("get_claude_launch_dirs");
}

export async function saveClaudeLaunchDirs(dirs: string[]): Promise<void> {
  return invoke("save_claude_launch_dirs", { dirs });
}

// Claude 推荐模板管理
export async function getRecommendedTemplate(): Promise<string | null> {
  return invoke("get_recommended_template");
}

export async function saveRecommendedTemplate(content: string): Promise<void> {
  return invoke("save_recommended_template", { content });
}

export async function resetRecommendedTemplate(): Promise<void> {
  return invoke("reset_recommended_template");
}

// Claude 配置模板目录（远程拉取 + 本地缓存回退，由后端完成）
// 内置兜底：即使后端 invoke 抛错，前端也永远拿到一份非空目录
const BUILTIN_CLAUDE_TEMPLATES: Record<string, unknown> = {
  codex: {
    alwaysThinkingEnabled: true,
    enabledPlugins: {
      "claude-mem@thedotmack": true,
      "planning-with-files@planning-with-files": true,
    },
    env: {
      ANTHROPIC_AUTH_TOKEN: "sk-",
      ANTHROPIC_BASE_URL: "https://a-ocnfniawgw.cn-shanghai.fcapp.run/v1",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "gpt-5.5",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "gpt-5.5",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "gpt-5.5",
      ANTHROPIC_MODEL: "gpt-5.5",
      ANTHROPIC_REASONING_MODEL: "gpt-5.5",
      CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    },
    model: "opus[1m]",
  },
  claude: {
    effortLevel: "medium",
    env: {
      ANTHROPIC_AUTH_TOKEN: "sk-",
      ANTHROPIC_BASE_URL: "https://a-ocnfniawgw.cn-shanghai.fcapp.run",
      CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_AUTOUPDATER: "1",
      DISABLE_ERROR_REPORTING: "1",
      DISABLE_TELEMETRY: "1",
    },
    model: "opus[1m]",
    permissions: { defaultMode: "bypassPermissions" },
  },
};

/**
 * 获取 Claude 配置模板目录（形如 { codex: {...}, claude: {...}, ... }）。
 * 后端已负责"远程 → 本地缓存 → 内置默认"的回退，永不报错；
 * 这里再兜一层：万一 invoke 本身异常，也返回前端内置默认，保证 UI 永远有内容。
 */
export async function getClaudeConfigTemplates(): Promise<Record<string, unknown>> {
  try {
    const raw = await invoke<string>("get_claude_config_templates");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (e) {
    console.error("读取 Claude 配置模板目录失败:", e);
  }
  return { ...BUILTIN_CLAUDE_TEMPLATES };
}

// ============== Netcat 协议测试服务 ==============

import type {
  NetcatSessionInput,
  NetcatSession,
  SendMessageInput,
  NetcatMessage,
  ConnectedClient,
  AutoSendConfig,
} from "@/types/toolbox";

export async function netcatInit(): Promise<void> {
  return invoke("netcat_init");
}

export async function netcatCreateSession(input: NetcatSessionInput): Promise<NetcatSession> {
  return invoke("netcat_create_session", { input });
}

export async function netcatStartSession(sessionId: string): Promise<void> {
  return invoke("netcat_start_session", { sessionId });
}

export async function netcatStopSession(sessionId: string): Promise<void> {
  return invoke("netcat_stop_session", { sessionId });
}

export async function netcatRemoveSession(sessionId: string): Promise<void> {
  return invoke("netcat_remove_session", { sessionId });
}

export async function netcatSendMessage(input: SendMessageInput): Promise<NetcatMessage> {
  return invoke("netcat_send_message", { input });
}

export async function netcatGetSessions(): Promise<NetcatSession[]> {
  return invoke("netcat_get_sessions");
}

export async function netcatGetSession(sessionId: string): Promise<NetcatSession> {
  return invoke("netcat_get_session", { sessionId });
}

export async function netcatGetMessages(
  sessionId: string,
  limit?: number,
  offset?: number
): Promise<NetcatMessage[]> {
  return invoke("netcat_get_messages", { sessionId, limit, offset });
}

export async function netcatGetClients(sessionId: string): Promise<ConnectedClient[]> {
  return invoke("netcat_get_clients", { sessionId });
}

export async function netcatClearMessages(sessionId: string): Promise<void> {
  return invoke("netcat_clear_messages", { sessionId });
}

export async function netcatDisconnectClient(sessionId: string, clientId: string): Promise<void> {
  return invoke("netcat_disconnect_client", { sessionId, clientId });
}

export async function netcatUpdateAutoSend(sessionId: string, config: AutoSendConfig): Promise<void> {
  return invoke("netcat_update_auto_send", { sessionId, config });
}

export interface HttpFetchConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  jsonPath?: string;
}

export async function netcatFetchHttp(config: HttpFetchConfig): Promise<string> {
  return invoke("netcat_fetch_http", { config });
}

// ============== 快捷键备忘服务 ==============

import type { ShortcutEntry, ShortcutInput } from "@/types/toolbox";

export async function getShortcuts(): Promise<ShortcutEntry[]> {
  return invoke("get_shortcuts");
}

export async function saveShortcuts(shortcuts: ShortcutEntry[]): Promise<void> {
  return invoke("save_shortcuts", { shortcuts });
}

export async function addShortcut(input: ShortcutInput): Promise<ShortcutEntry> {
  return invoke("add_shortcut", { input });
}

export async function updateShortcut(id: string, input: ShortcutInput): Promise<ShortcutEntry> {
  return invoke("update_shortcut", { id, input });
}

export async function deleteShortcut(id: string): Promise<void> {
  return invoke("delete_shortcut", { id });
}

export async function resetShortcuts(): Promise<ShortcutEntry[]> {
  return invoke("reset_shortcuts");
}

export async function getCurrentPlatform(): Promise<string> {
  return invoke("get_current_platform");
}

// ============== 剪贴板历史服务 ==============

import type { ClipboardEntry, ClipboardSettings } from "@/types/toolbox";

export async function getClipboardHistory(): Promise<ClipboardEntry[]> {
  return invoke("get_clipboard_history");
}

export async function addClipboardEntry(content: string): Promise<ClipboardEntry> {
  return invoke("add_clipboard_entry", { content });
}

export async function deleteClipboardEntry(id: string): Promise<void> {
  return invoke("delete_clipboard_entry", { id });
}

export async function togglePinClipboardEntry(id: string): Promise<ClipboardEntry> {
  return invoke("toggle_pin_clipboard_entry", { id });
}

export async function clearClipboardHistory(): Promise<void> {
  return invoke("clear_clipboard_history");
}

export async function getClipboardSettings(): Promise<ClipboardSettings> {
  return invoke("get_clipboard_settings");
}

export async function saveClipboardSettings(settings: ClipboardSettings): Promise<void> {
  return invoke("save_clipboard_settings", { settings });
}

export async function writeToClipboard(content: string): Promise<void> {
  return invoke("write_to_clipboard", { content });
}

export async function updateClipboardNote(id: string, note: string): Promise<ClipboardEntry> {
  return invoke("update_clipboard_note", { id, note });
}

// ============== 跨设备传输（PairDrop） ==============

import type {
  PairDropServiceStatus,
  PairDropPeerInfo,
  PairDropDiscoveredDevice,
} from "@/types/toolbox";

export async function pairdropStart(port?: number): Promise<PairDropServiceStatus> {
  return invoke("pairdrop_start", { port });
}

export async function pairdropStop(): Promise<void> {
  return invoke("pairdrop_stop");
}

export async function pairdropStatus(): Promise<PairDropServiceStatus> {
  return invoke("pairdrop_status");
}

export async function pairdropPeers(): Promise<PairDropPeerInfo[]> {
  return invoke("pairdrop_peers");
}

export async function pairdropDiscovered(): Promise<PairDropDiscoveredDevice[]> {
  return invoke("pairdrop_discovered");
}

/** 把缓存中的接收文件直接写到本地，token 一次性消费。返回写入字节数。 */
export async function pairdropSaveFile(token: string, savePath: string): Promise<number> {
  return invoke("pairdrop_save_file", { token, savePath });
}

/** 从"加入的对方桌面端"按 URL 下载文件写盘（无 fs scope 限制，与本机保存一致） */
export async function pairdropDownloadSave(url: string, savePath: string): Promise<number> {
  return invoke("pairdrop_download_save", { url, savePath });
}

/**
 * 从本地真实路径上传（走系统文件对话框选出来的文件）。
 * 后端边读边发，进度通过 `pairdrop:upload-progress` 事件回来（携带 uploadId）。
 */
export async function pairdropUploadPath(args: {
  apiBase: string;
  from: string;
  to: string;
  path: string;
  uploadId: string;
}): Promise<{ token: string; name: string; size: number }> {
  return invoke("pairdrop_upload_path", args);
}

// ============== 工具函数 ==============

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function formatSpeed(bytesPerSecond: number): string {
  return formatBytes(bytesPerSecond) + "/s";
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}
