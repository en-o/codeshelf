import {
  ArrowLeftRight,
  Check,
  Copy,
  Edit2,
  ExternalLink,
  FileCode,
  Globe,
  Lock,
  Play,
  Square,
  Trash2,
} from "lucide-react";
import type { ForwardRule, ServerConfig } from "@/types/toolbox";
import { formatBytes } from "@/services/toolbox";
import type { ServiceListCallbacks } from "./types";

interface ServiceListProps {
  servers: ServerConfig[];
  rules: ForwardRule[];
  copiedId: string | null;
  callbacks: ServiceListCallbacks;
}

export function ServiceList({ servers, rules, copiedId, callbacks }: ServiceListProps) {
  return (
    <div className="space-y-4">
      {servers.map((server) => (
        <div key={`server-${server.id}`} className="re-card p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Globe size={18} className="text-blue-500" />
                <div
                  className={`w-2.5 h-2.5 rounded-full ${
                    server.status === "running" ? "bg-green-500 animate-pulse" : "bg-gray-300"
                  }`}
                />
              </div>

              <div>
                <h4 className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                  {server.name}
                  <span className="text-xs text-gray-400">Web 服务</span>
                  {(() => {
                    const locked = (server.authRules || []).filter((r) => r.enabled !== false);
                    if (locked.length === 0) return null;
                    return (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-normal bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                        title={locked.map((r) => r.path).join("\n")}
                      >
                        <Lock size={10} />
                        {locked.length === 1 ? locked[0].path : `${locked.length} 条规则`}
                      </span>
                    );
                  })()}
                </h4>
                <div className="flex items-center gap-2 mt-1">
                  {server.status === "running" ? (
                    <>
                      <button
                        onClick={() => callbacks.onOpenServer(server)}
                        className="text-sm font-mono text-blue-500 hover:text-blue-600 hover:underline"
                        title="点击在浏览器中打开"
                      >
                        {callbacks.getServerUrl(server)}
                      </button>
                      <button
                        onClick={() => callbacks.onCopyServerUrl(server)}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                        title="复制地址"
                      >
                        {copiedId === server.id ? (
                          <Check size={14} className="text-green-500" />
                        ) : (
                          <Copy size={14} className="text-gray-400" />
                        )}
                      </button>
                      <span className="text-xs text-gray-400" title="局域网内其他设备可通过本机 IP 访问">
                        (内网可访问 :{server.port})
                      </span>
                    </>
                  ) : (
                    <span className="text-sm font-mono text-gray-400">{callbacks.getServerUrl(server)}</span>
                  )}
                </div>
                <div className="text-sm text-gray-500 mt-0.5 truncate max-w-xs" title={server.rootDir}>
                  {server.rootDir}
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    目录浏览
                  </span>
                  {server.cors && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                      CORS
                    </span>
                  )}
                  {server.gzip && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      GZIP
                    </span>
                  )}
                  {server.proxies?.map((proxy, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                      title={`${proxy.prefix} → ${proxy.target}`}
                    >
                      {proxy.prefix} → {proxy.target}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => callbacks.onGenerateNginx(server)}
                className="p-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors text-indigo-500"
                title="生成 Nginx 配置"
              >
                <FileCode size={16} />
              </button>
              {server.status === "running" ? (
                <>
                  <button
                    onClick={() => callbacks.onOpenServer(server)}
                    className="p-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors text-blue-500"
                    title="在浏览器中打开"
                  >
                    <ExternalLink size={16} />
                  </button>
                  <button
                    onClick={() => callbacks.onStopServer(server.id)}
                    className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors text-red-500"
                    title="停止"
                  >
                    <Square size={16} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => callbacks.onStartServer(server.id)}
                    className="p-2 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors text-green-500"
                    title="启动"
                  >
                    <Play size={16} />
                  </button>
                  <button
                    onClick={() => callbacks.onEditServer(server)}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-500"
                    title="编辑"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => callbacks.onRemoveServer(server)}
                    className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors text-red-500"
                    title="删除"
                  >
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ))}

      {rules.map((rule) => (
        <div key={`rule-${rule.id}`} className="re-card p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <ArrowLeftRight size={18} className="text-purple-500" />
                <div
                  className={`w-2.5 h-2.5 rounded-full ${
                    rule.status === "running" ? "bg-green-500 animate-pulse" : "bg-gray-300"
                  }`}
                />
              </div>

              <div>
                <h4 className="font-medium text-gray-900 dark:text-white">
                  {rule.name}
                  <span className="ml-2 text-xs text-gray-400">端口转发</span>
                </h4>
                <div className="flex items-center gap-2 mt-1">
                  {rule.status === "running" ? (
                    <>
                      <button
                        onClick={() => callbacks.onOpenForward(rule)}
                        className="text-sm font-mono text-purple-500 hover:text-purple-600 hover:underline"
                        title="点击在浏览器中打开"
                      >
                        {callbacks.getForwardUrl(rule)}
                      </button>
                      <button
                        onClick={() => callbacks.onCopyForwardUrl(rule)}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                        title="复制地址"
                      >
                        {copiedId === rule.id ? (
                          <Check size={14} className="text-green-500" />
                        ) : (
                          <Copy size={14} className="text-gray-400" />
                        )}
                      </button>
                    </>
                  ) : (
                    <span className="text-sm font-mono text-gray-400">{callbacks.getForwardUrl(rule)}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
                  <span className="font-mono">:{rule.localPort}</span>
                  <ArrowLeftRight size={14} />
                  <span className="font-mono">
                    {rule.remoteHost}:{rule.remotePort}
                  </span>
                  {rule.docPath && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                      {rule.docPath}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6">
              {rule.status === "running" && (
                <div className="text-sm text-gray-500 space-y-0.5">
                  <div>
                    连接: <span className="font-medium">{rule.connections}</span>
                  </div>
                  <div>
                    入: <span className="font-medium">{formatBytes(rule.bytesIn)}</span>
                    {" | "}
                    出: <span className="font-medium">{formatBytes(rule.bytesOut)}</span>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-1">
                {rule.status === "running" ? (
                  <>
                    <button
                      onClick={() => callbacks.onOpenForward(rule)}
                      className="p-2 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-colors text-purple-500"
                      title="在浏览器中打开"
                    >
                      <ExternalLink size={16} />
                    </button>
                    <button
                      onClick={() => callbacks.onStopForward(rule.id)}
                      className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors text-red-500"
                      title="停止"
                    >
                      <Square size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => callbacks.onStartForward(rule.id)}
                      className="p-2 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors text-green-500"
                      title="启动"
                    >
                      <Play size={16} />
                    </button>
                    <button
                      onClick={() => callbacks.onEditForward(rule)}
                      className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-500"
                      title="编辑"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => callbacks.onRemoveForward(rule)}
                      className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors text-red-500"
                      title="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
