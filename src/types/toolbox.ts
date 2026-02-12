// 工具箱类型定义

// ============== 端口扫描 ==============

export interface ScanConfig {
  target: string;
  ports?: number[];
  portStart?: number;
  portEnd?: number;
  timeoutMs?: number;
  concurrency?: number;
}

export interface ScanResult {
  ip: string;
  port: number;
  status: "open" | "closed" | "filtered";
  service?: string;
}

export interface ScanProgress {
  scanned: number;
  total: number;
  openPorts: ScanResult[];
}

// ============== 文件下载 ==============

export interface DownloadConfig {
  url: string;
  saveDir?: string;
  fileName?: string;
  maxRetries?: number;
}

export interface DownloadTask {
  id: string;
  url: string;
  savePath: string;
  fileName: string;
  totalSize: number;
  downloadedSize: number;
  status: "pending" | "downloading" | "paused" | "completed" | "failed" | "cancelled";
  speed: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DownloadProgress {
  id: string;
  downloaded: number;
  total: number;
  speed: number;
  status: string;
}

// ============== 进程管理 ==============

export interface ProcessInfo {
  pid: number;
  name: string;
  port?: number;
  protocol?: "tcp" | "udp";
  localAddr?: string;
  remoteAddr?: string;
  status: string;
  memory: number;
  cpu: number;
  workingDir?: string;
  cmd?: string;
}

export interface ProcessFilter {
  port?: number;
  name?: string;
  pid?: number;
}

export interface SystemStats {
  totalMemory: number;
  usedMemory: number;
  totalSwap: number;
  usedSwap: number;
  cpuCount: number;
  processCount: number;
}

export interface PortOccupation {
  port: number;
  protocol: string;
  pid: number;
  processName: string;
  localAddr: string;
  state: string;
}

// ============== 端口转发 ==============

export interface ForwardRule {
  id: string;
  name: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  status: "running" | "stopped";
  connections: number;
  bytesIn: number;
  bytesOut: number;
  createdAt: string;
}

export interface ForwardRuleInput {
  name: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
}

export interface ForwardStats {
  ruleId: string;
  connections: number;
  bytesIn: number;
  bytesOut: number;
}

// ============== 静态服务 ==============

export interface ProxyConfig {
  prefix: string;
  target: string;
}

export interface ServerConfig {
  id: string;
  name: string;
  port: number;
  rootDir: string;
  cors: boolean;
  gzip: boolean;
  cacheControl?: string;
  /** URL 访问前缀，如 "/project" 或 "/" 表示无前缀 */
  urlPrefix: string;
  /** 多个代理规则 */
  proxies: ProxyConfig[];
  status: "running" | "stopped";
  createdAt: string;
}

export interface ServerConfigInput {
  name: string;
  port: number;
  rootDir: string;
  cors?: boolean;
  gzip?: boolean;
  cacheControl?: string;
  /** URL 访问前缀，如 "/project" 或 "/" 表示无前缀 */
  urlPrefix?: string;
  /** 多个代理规则 */
  proxies?: ProxyConfig[];
}

// ============== Claude Code 配置 ==============

export type EnvType = "host" | "wsl";

export interface ClaudeCodeInfo {
  envType: EnvType;
  envName: string;
  installed: boolean;
  version?: string;
  path?: string;
  configDir?: string;
  configFiles: ConfigFileInfo[];
}

export interface ConfigFileInfo {
  name: string;
  path: string;
  exists: boolean;
  size: number;
  modified?: string;
  description: string;
}

export interface QuickConfigOption {
  id: string;
  name: string;
  description: string;
  category: string;
  configKey: string;
  configValue: unknown;
}

export interface ConfigProfile {
  id: string;
  name: string;
  description?: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ============== 工具箱页面状态 ==============

export type ToolType = "monitor" | "downloader" | "server" | "claude";

export interface ToolInfo {
  id: ToolType;
  name: string;
  description: string;
  icon: string;
}
