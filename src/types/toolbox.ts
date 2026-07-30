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
  /** 对局域网开放（绑 0.0.0.0）。默认 false = 只绑 127.0.0.1 */
  exposeLan?: boolean;
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
  /** 对局域网开放（绑 0.0.0.0）。默认 false = 只绑 127.0.0.1 */
  exposeLan?: boolean;
}

export interface ForwardStats {
  ruleId: string;
  connections: number;
  bytesIn: number;
  bytesOut: number;
}

// ============== SSH 隧道 ==============

/** SSH 隧道默认分组名（旧数据兼容） */
export const DEFAULT_SSH_GROUP = "默认分组";

export type SshAuthMethod =
  | { type: "key"; keyPath: string; passphrase?: string }
  | { type: "password"; password: string }
  | { type: "sshConfig"; hostAlias: string };

export interface SshTunnel {
  id: string;
  name: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  auth: SshAuthMethod;
  /** 对局域网开放（绑 0.0.0.0）。默认 false = 只绑 127.0.0.1 */
  exposeLan?: boolean;
  status: "running" | "stopped" | "reconnecting";
  connections: number;
  bytesIn: number;
  bytesOut: number;
  lastError?: string | null;
  /** 断线后自动重连（网络切换/休眠恢复） */
  autoReconnect: boolean;
  /** 累计自动重连成功次数 */
  reconnects: number;
  /** 所属分组；旧数据无此字段时为「默认分组」 */
  group: string;
  createdAt: string;
}

export interface SshTunnelInput {
  name: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  sshHost: string;
  sshPort?: number;
  sshUser?: string;
  auth: SshAuthMethod;
  /** 对局域网开放（绑 0.0.0.0）。默认 false = 只绑 127.0.0.1 */
  exposeLan?: boolean;
  autoReconnect?: boolean;
  /** 所属分组；为空时落入「默认分组」 */
  group?: string;
}

export interface SshTunnelStats {
  tunnelId: string;
  connections: number;
  bytesIn: number;
  bytesOut: number;
}

// ============== 内网穿透（反向 SSH 隧道）==============

export interface ReverseTunnel {
  id: string;
  name: string;
  /** 要暴露的本地服务主机，默认 127.0.0.1 */
  localHost: string;
  /** 要暴露的本地服务端口 */
  localPort: number;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  auth: SshAuthMethod;
  /** VPS 监听地址：127.0.0.1=仅本机(配 nginx 反代)；0.0.0.0=对公网开放(需 GatewayPorts yes) */
  remoteBindAddr: string;
  /** VPS 上对外暴露的端口 */
  remotePort: number;
  /** 可选域名，仅用于展示与拼接公网 URL */
  domain?: string | null;
  status: "running" | "stopped" | "reconnecting";
  connections: number;
  bytesIn: number;
  bytesOut: number;
  lastError?: string | null;
  autoReconnect: boolean;
  reconnects: number;
  group: string;
  createdAt: string;
}

export interface ReverseTunnelInput {
  name: string;
  localHost?: string;
  localPort: number;
  sshHost: string;
  sshPort?: number;
  sshUser?: string;
  auth: SshAuthMethod;
  remoteBindAddr?: string;
  remotePort: number;
  domain?: string;
  autoReconnect?: boolean;
  group?: string;
}

export interface ReverseTunnelStats {
  tunnelId: string;
  connections: number;
  bytesIn: number;
  bytesOut: number;
}

export interface TestPortResult {
  success: boolean;
  /** 命令输出（stdout/stderr 拼接） */
  output: string;
  /** 检测方式："nc" / "Test-NetConnection" / "tcp" */
  method: string;
  durationMs: number;
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
  /** 对局域网开放（绑 0.0.0.0）。默认 false = 只绑 127.0.0.1 */
  exposeLan?: boolean;
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
  /** 对局域网开放（绑 0.0.0.0）。默认 false = 只绑 127.0.0.1 */
  exposeLan?: boolean;
}

// ============== Docker 镜像 ==============

export interface DockerStatus {
  available: boolean;
  version?: string;
  error?: string;
}

export interface DockerCommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  command: string;
}

export interface DockerImageInfo {
  id: string;
  repository: string;
  tag: string;
  size: string;
  createdSince: string;
}

export interface DockerContainerInfo {
  id: string;
  image: string;
  names: string;
  status: string;
  /** docker ps 的 State：running / exited / paused / created / restarting / dead / removing / unknown */
  state: string;
  ports: string;
  composeProject?: string;
  composeService?: string;
  composeWorkingDir?: string;
  composeConfigFiles: string[];
}

export interface DockerBuildInput {
  projectPath: string;
  dockerfilePath: string;
  imageName: string;
  tag?: string;
  noCache?: boolean;
}

export interface DockerRunInput {
  image: string;
  containerName?: string;
  ports?: string[];
  env?: string[];
  volumes?: string[];
  network?: string;
  restart?: string;
  user?: string;
  workdir?: string;
  command?: string;
  privileged?: boolean;
  readOnly?: boolean;
  extraArgs?: string[];
}

export interface DockerAiGenerateInput {
  projectPath: string;
  dockerfilePath?: string;
  imageName?: string;
  providerId?: string;
  modelId?: string;
}

export interface DockerAiGenerateOutput {
  content: string;
  providerName: string;
  modelName: string;
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

export type ToolType = "monitor" | "downloader" | "server" | "docker" | "claude" | "netcat" | "shortcuts" | "clipboard" | "resume" | "sshTunnel" | "reverseTunnel" | "pairdrop";

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
  /** 本地地址（客户端模式连接后的 IP:PORT） */
  localAddr?: string;
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

// ============== 快捷键备忘 ==============

export interface ShortcutEntry {
  id: string;
  category: string;
  description: string;
  keys: string;
  platform: string;
  isDefault: boolean;
  isModified: boolean;
  originalKeys?: string;
}

export interface ShortcutInput {
  category?: string;
  description?: string;
  keys?: string;
  platform?: string;
}

// ============== 剪贴板历史 ==============

export interface ClipboardEntry {
  id: string;
  content: string;
  contentPreview: string;
  timestamp: number;
  pinned: boolean;
  charCount: number;
  note?: string;
}

export interface ClipboardSettings {
  enabled: boolean;
  maxItems: number;
  monitorIntervalMs: number;
}

// ============== Nginx 配置生成 ==============

export interface NginxConfigOptions {
  serviceName: string;
  listenPort: number;
  rootDir: string;
  indexPage?: string;
  cors?: boolean;
  gzip?: boolean;
  urlPrefix?: string;
  proxies?: Array<{ prefix: string; target: string }>;
  accessLog?: boolean;
  errorLog?: boolean;
}

// ============== 跨设备传输（PairDrop） ==============

export interface PairDropNetworkUrl {
  interface: string;
  ip: string;
  url: string;
}

export interface PairDropServiceStatus {
  running: boolean;
  port: number;
  urls: PairDropNetworkUrl[];
  peerCount: number;
}

export interface PairDropPeerInfo {
  peerId: string;
  displayName: string;
  /** "desktop" | "mobile" | "browser" */
  deviceType: string;
  userAgent: string;
  isSelf: boolean;
}

export interface PairDropDiscoveredDevice {
  deviceId: string;
  displayName: string;
  host: string;
  port: number;
  url: string;
  lastSeenAt: number;
}
