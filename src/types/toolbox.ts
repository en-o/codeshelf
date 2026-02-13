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
  /** 文档路径，如 "doc.html" 或 "swagger-ui.html" */
  docPath?: string;
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
  /** 文档路径，如 "doc.html" 或 "swagger-ui.html" */
  docPath?: string;
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
  /** 首页文件，如 "index.html"、"index" 等 */
  indexPage?: string;
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
  cacheControl?: string | null;
  /** URL 访问前缀，如 "/project" 或 "/" 表示无前缀 */
  urlPrefix?: string;
  /** 首页文件，如 "index.html"、"index" 等，null 表示清空 */
  indexPage?: string | null;
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

export type ToolType = "monitor" | "downloader" | "server" | "claude" | "netcat";

export interface ToolInfo {
  id: ToolType;
  name: string;
  description: string;
  icon: string;
}

// ============== Netcat 协议测试 ==============

export type Protocol = "tcp" | "udp";
export type SessionMode = "client" | "server";
export type DataFormat = "text" | "hex" | "base64";
export type SessionStatus = "connecting" | "connected" | "listening" | "disconnected" | "error";
export type MessageDirection = "sent" | "received";
export type AutoSendMode = "fixed" | "csv" | "template" | "http";

export interface AutoSendConfig {
  enabled: boolean;
  intervalMs: number;
  mode: AutoSendMode;
  fixedData: string;
  csvData: string;
  template: string;
  httpUrl: string;
  /** HTTP 请求方法 */
  httpMethod: string;
  /** HTTP 请求头（JSON 格式，如 {"Authorization": "Bearer xxx"}） */
  httpHeaders: string;
  /** HTTP 请求体 */
  httpBody: string;
  /** HTTP JSON 路径，用于提取 JSON 响应中的特定字段 */
  httpJsonPath: string;
}

export interface NetcatSessionInput {
  protocol: Protocol;
  mode: SessionMode;
  host: string;
  port: number;
  name?: string;
  autoReconnect?: boolean;
  timeoutMs?: number;
}

export interface NetcatSession {
  id: string;
  name: string;
  protocol: Protocol;
  mode: SessionMode;
  host: string;
  port: number;
  status: SessionStatus;
  autoReconnect: boolean;
  timeoutMs: number;
  createdAt: number;
  connectedAt?: number;
  lastActivity?: number;
  bytesSent: number;
  bytesReceived: number;
  messageCount: number;
  errorMessage?: string;
  clientCount: number;
  /** 自动发送配置 */
  autoSend: AutoSendConfig;
}

export interface SendMessageInput {
  sessionId: string;
  data: string;
  format: DataFormat;
  targetClient?: string;
  broadcast?: boolean;
}

export interface NetcatMessage {
  id: string;
  sessionId: string;
  direction: MessageDirection;
  data: string;
  format: DataFormat;
  size: number;
  timestamp: number;
  clientId?: string;
  clientAddr?: string;
}

export interface ConnectedClient {
  id: string;
  addr: string;
  connectedAt: number;
  lastActivity: number;
  bytesSent: number;
  bytesReceived: number;
}

export type NetcatEvent =
  | { type: "statusChanged"; sessionId: string; status: SessionStatus; error?: string }
  | { type: "messageReceived"; sessionId: string; message: NetcatMessage }
  | { type: "clientConnected"; sessionId: string; client: ConnectedClient }
  | { type: "clientDisconnected"; sessionId: string; clientId: string };
