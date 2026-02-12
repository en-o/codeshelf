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
} from "@/types/toolbox";

// ============== 端口扫描服务 ==============

export async function scanPorts(config: ScanConfig): Promise<ScanResult[]> {
  // 转换为 snake_case
  const rustConfig = {
    target: config.target,
    ports: config.ports,
    port_start: config.portStart,
    port_end: config.portEnd,
    timeout_ms: config.timeoutMs,
    concurrency: config.concurrency,
  };
  return invoke("scan_ports", { config: rustConfig });
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
  const rustConfig = {
    url: config.url,
    save_dir: config.saveDir,
    file_name: config.fileName,
    max_retries: config.maxRetries,
  };
  return invoke("start_download", { config: rustConfig });
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
  const tasks: any[] = await invoke("get_download_tasks");
  return tasks.map(transformDownloadTask);
}

export async function getDownloadTask(
  taskId: string
): Promise<DownloadTask | null> {
  const task: any = await invoke("get_download_task", { taskId });
  return task ? transformDownloadTask(task) : null;
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

function transformDownloadTask(task: any): DownloadTask {
  return {
    id: task.id,
    url: task.url,
    savePath: task.save_path,
    fileName: task.file_name,
    totalSize: task.total_size,
    downloadedSize: task.downloaded_size,
    status: task.status,
    speed: task.speed,
    error: task.error,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };
}

// ============== 进程管理服务 ==============

export async function getProcesses(
  filter?: ProcessFilter
): Promise<ProcessInfo[]> {
  const processes: any[] = await invoke("get_processes", { filter });
  return processes.map(transformProcessInfo);
}

export async function getPortProcesses(port: number): Promise<ProcessInfo[]> {
  const processes: any[] = await invoke("get_port_processes", { port });
  return processes.map(transformProcessInfo);
}

export async function killProcess(
  pid: number,
  force?: boolean
): Promise<void> {
  return invoke("kill_process", { pid, force });
}

export async function getSystemStats(): Promise<SystemStats> {
  const stats: any = await invoke("get_system_stats");
  return {
    totalMemory: stats.total_memory,
    usedMemory: stats.used_memory,
    totalSwap: stats.total_swap,
    usedSwap: stats.used_swap,
    cpuCount: stats.cpu_count,
    processCount: stats.process_count,
  };
}

export async function getLocalPortOccupation(): Promise<PortOccupation[]> {
  const data: any[] = await invoke("get_local_port_occupation");
  return data.map((item) => ({
    port: item.port,
    protocol: item.protocol,
    pid: item.pid,
    processName: item.process_name,
    localAddr: item.local_addr,
    state: item.state,
  }));
}

function transformProcessInfo(proc: any): ProcessInfo {
  return {
    pid: proc.pid,
    name: proc.name,
    port: proc.port,
    protocol: proc.protocol,
    localAddr: proc.local_addr,
    remoteAddr: proc.remote_addr,
    status: proc.status,
    memory: proc.memory,
    cpu: proc.cpu,
    workingDir: proc.working_dir,
    cmd: proc.cmd,
  };
}

// ============== 端口转发服务 ==============

export async function addForwardRule(
  input: ForwardRuleInput
): Promise<ForwardRule> {
  const rustInput = {
    name: input.name,
    local_port: input.localPort,
    remote_host: input.remoteHost,
    remote_port: input.remotePort,
  };
  const rule: any = await invoke("add_forward_rule", { input: rustInput });
  return transformForwardRule(rule);
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
  const rules: any[] = await invoke("get_forward_rules");
  return rules.map(transformForwardRule);
}

export async function getForwardRule(
  ruleId: string
): Promise<ForwardRule | null> {
  const rule: any = await invoke("get_forward_rule", { ruleId });
  return rule ? transformForwardRule(rule) : null;
}

export async function getForwardStats(ruleId: string): Promise<ForwardStats> {
  const stats: any = await invoke("get_forward_stats", { ruleId });
  return {
    ruleId: stats.rule_id,
    connections: stats.connections,
    bytesIn: stats.bytes_in,
    bytesOut: stats.bytes_out,
  };
}

export async function updateForwardRule(
  ruleId: string,
  input: ForwardRuleInput
): Promise<ForwardRule> {
  const rustInput = {
    name: input.name,
    local_port: input.localPort,
    remote_host: input.remoteHost,
    remote_port: input.remotePort,
  };
  const rule: any = await invoke("update_forward_rule", {
    ruleId,
    input: rustInput,
  });
  return transformForwardRule(rule);
}

function transformForwardRule(rule: any): ForwardRule {
  return {
    id: rule.id,
    name: rule.name,
    localPort: rule.local_port,
    remoteHost: rule.remote_host,
    remotePort: rule.remote_port,
    status: rule.status,
    connections: rule.connections,
    bytesIn: rule.bytes_in,
    bytesOut: rule.bytes_out,
    createdAt: rule.created_at,
  };
}

// ============== 静态服务 ==============

export async function createServer(
  input: ServerConfigInput
): Promise<ServerConfig> {
  const rustInput = {
    name: input.name,
    port: input.port,
    root_dir: input.rootDir,
    cors: input.cors,
    gzip: input.gzip,
    cache_control: input.cacheControl,
    proxies: input.proxies,
  };
  const server: any = await invoke("create_server", { input: rustInput });
  return transformServerConfig(server);
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
  const servers: any[] = await invoke("get_servers");
  return servers.map(transformServerConfig);
}

export async function getServer(serverId: string): Promise<ServerConfig | null> {
  const server: any = await invoke("get_server", { serverId });
  return server ? transformServerConfig(server) : null;
}

export async function updateServer(
  serverId: string,
  input: ServerConfigInput
): Promise<ServerConfig> {
  const rustInput = {
    name: input.name,
    port: input.port,
    root_dir: input.rootDir,
    cors: input.cors,
    gzip: input.gzip,
    cache_control: input.cacheControl,
    proxies: input.proxies,
  };
  const server: any = await invoke("update_server", {
    serverId,
    input: rustInput,
  });
  return transformServerConfig(server);
}

function transformServerConfig(server: any): ServerConfig {
  return {
    id: server.id,
    name: server.name,
    port: server.port,
    rootDir: server.root_dir,
    cors: server.cors,
    gzip: server.gzip,
    cacheControl: server.cache_control,
    proxies: server.proxies || [],
    status: server.status,
    createdAt: server.created_at,
  };
}

// ============== Claude Code 配置服务 ==============

import type { ClaudeCodeInfo, EnvType, QuickConfigOption, ConfigProfile } from "@/types/toolbox";

export async function checkAllClaudeInstallations(): Promise<ClaudeCodeInfo[]> {
  const infos: any[] = await invoke("check_all_claude_installations");
  return infos.map((info: any) => ({
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

export async function getConfigProfiles(): Promise<ConfigProfile[]> {
  const profiles: any[] = await invoke("get_config_profiles");
  return profiles.map((p: any) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    settings: p.settings,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  }));
}

export async function saveConfigProfile(name: string, description: string | undefined, settings: Record<string, unknown>): Promise<ConfigProfile> {
  const profile: any = await invoke("save_config_profile", { name, description, settings });
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    settings: profile.settings,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

export async function deleteConfigProfile(profileId: string): Promise<void> {
  return invoke("delete_config_profile", { profileId });
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
