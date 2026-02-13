// Netcat 协议测试工具

import { useState, useEffect, useRef, useCallback } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  Plus,
  Play,
  Square,
  Trash2,
  Send,
  Eraser,
  Users,
  ArrowUpRight,
  ArrowDownLeft,
  Wifi,
  WifiOff,
  Radio,
  Server,
  Monitor,
  X,
  ChevronUp,
} from "lucide-react";
import {
  netcatCreateSession,
  netcatStartSession,
  netcatStopSession,
  netcatRemoveSession,
  netcatSendMessage,
  netcatGetSessions,
  netcatGetMessages,
  netcatGetClients,
  netcatClearMessages,
  netcatDisconnectClient,
  formatBytes,
} from "@/services/toolbox";
import type {
  Protocol,
  SessionMode,
  DataFormat,
  NetcatSession,
  NetcatMessage,
  ConnectedClient,
  NetcatEvent,
} from "@/types/toolbox";

// 状态配置
const statusConfig: Record<string, { color: string; bg: string; icon: typeof Wifi }> = {
  connecting: { color: "text-yellow-500", bg: "bg-yellow-500/10", icon: Radio },
  connected: { color: "text-green-500", bg: "bg-green-500/10", icon: Wifi },
  listening: { color: "text-blue-500", bg: "bg-blue-500/10", icon: Server },
  disconnected: { color: "text-gray-400", bg: "bg-gray-500/10", icon: WifiOff },
  error: { color: "text-red-500", bg: "bg-red-500/10", icon: WifiOff },
};

const statusText: Record<string, string> = {
  connecting: "连接中",
  connected: "已连接",
  listening: "监听中",
  disconnected: "未连接",
  error: "错误",
};

export default function NetcatTool() {
  const [sessions, setSessions] = useState<NetcatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<NetcatMessage[]>([]);
  const [clients, setClients] = useState<ConnectedClient[]>([]);

  // 新建会话表单
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProtocol, setNewProtocol] = useState<Protocol>("tcp");
  const [newMode, setNewMode] = useState<SessionMode>("client");
  const [newHost, setNewHost] = useState("127.0.0.1");
  const [newPort, setNewPort] = useState("8080");
  const [newName, setNewName] = useState("");

  // 发送消息
  const [sendData, setSendData] = useState("");
  const [sendFormat, setSendFormat] = useState<DataFormat>("text");
  const [targetClient, setTargetClient] = useState<string>("");
  const [broadcast, setBroadcast] = useState(false);
  const [showFormatDropdown, setShowFormatDropdown] = useState(false);

  // 自动滚动
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);

  const loadSessions = useCallback(async () => {
    try {
      const list = await netcatGetSessions();
      setSessions(list);
    } catch (err) {
      console.error("加载会话列表失败:", err);
    }
  }, []);

  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      const msgs = await netcatGetMessages(sessionId, 200);
      setMessages(msgs.reverse());
    } catch (err) {
      console.error("加载消息失败:", err);
    }
  }, []);

  const loadClients = useCallback(async (sessionId: string) => {
    try {
      const list = await netcatGetClients(sessionId);
      setClients(list);
    } catch (err) {
      console.error("加载客户端失败:", err);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (selectedSessionId) {
      loadMessages(selectedSessionId);
      if (selectedSession?.mode === "server") {
        loadClients(selectedSessionId);
      }
    } else {
      setMessages([]);
      setClients([]);
    }
  }, [selectedSessionId, selectedSession?.mode, loadMessages, loadClients]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setupListener = async () => {
      unlisten = await listen<NetcatEvent>("netcat-event", (event) => {
        const data = event.payload;

        switch (data.type) {
          case "statusChanged":
            setSessions((prev) =>
              prev.map((s) =>
                s.id === data.sessionId
                  ? { ...s, status: data.status, errorMessage: data.error }
                  : s
              )
            );
            break;

          case "messageReceived":
            if (data.sessionId === selectedSessionId) {
              setMessages((prev) => [...prev, data.message]);
            }
            setSessions((prev) =>
              prev.map((s) =>
                s.id === data.sessionId
                  ? {
                      ...s,
                      bytesReceived: s.bytesReceived + data.message.size,
                      messageCount: s.messageCount + 1,
                    }
                  : s
              )
            );
            break;

          case "clientConnected":
            if (data.sessionId === selectedSessionId) {
              setClients((prev) => [...prev, data.client]);
            }
            setSessions((prev) =>
              prev.map((s) =>
                s.id === data.sessionId ? { ...s, clientCount: s.clientCount + 1 } : s
              )
            );
            break;

          case "clientDisconnected":
            if (data.sessionId === selectedSessionId) {
              setClients((prev) => prev.filter((c) => c.id !== data.clientId));
            }
            setSessions((prev) =>
              prev.map((s) =>
                s.id === data.sessionId ? { ...s, clientCount: Math.max(0, s.clientCount - 1) } : s
              )
            );
            break;
        }
      });
    };

    setupListener();
    return () => { unlisten?.(); };
  }, [selectedSessionId]);

  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, autoScroll]);

  const handleCreateSession = async () => {
    try {
      const session = await netcatCreateSession({
        protocol: newProtocol,
        mode: newMode,
        host: newHost,
        port: parseInt(newPort, 10),
        name: newName || undefined,
      });
      setSessions((prev) => [...prev, session]);
      setSelectedSessionId(session.id);
      setShowCreateForm(false);
      setNewName("");
    } catch (err) {
      console.error("创建会话失败:", err);
      alert(`创建会话失败: ${err}`);
    }
  };

  const handleStartSession = async (sessionId: string) => {
    try {
      await netcatStartSession(sessionId);
    } catch (err) {
      console.error("启动会话失败:", err);
      alert(`启动会话失败: ${err}`);
    }
  };

  const handleStopSession = async (sessionId: string) => {
    try {
      await netcatStopSession(sessionId);
    } catch (err) {
      console.error("停止会话失败:", err);
    }
  };

  const handleRemoveSession = async (sessionId: string) => {
    try {
      await netcatRemoveSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (selectedSessionId === sessionId) {
        setSelectedSessionId(null);
      }
    } catch (err) {
      console.error("删除会话失败:", err);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedSessionId || !sendData.trim()) return;

    try {
      const msg = await netcatSendMessage({
        sessionId: selectedSessionId,
        data: sendData,
        format: sendFormat,
        targetClient: targetClient || undefined,
        broadcast: broadcast || undefined,
      });
      setMessages((prev) => [...prev, msg]);
      setSendData("");
    } catch (err) {
      console.error("发送消息失败:", err);
      alert(`发送消息失败: ${err}`);
    }
  };

  const handleClearMessages = async () => {
    if (!selectedSessionId) return;
    try {
      await netcatClearMessages(selectedSessionId);
      setMessages([]);
    } catch (err) {
      console.error("清空消息失败:", err);
    }
  };

  const handleDisconnectClient = async (clientId: string) => {
    if (!selectedSessionId) return;
    try {
      await netcatDisconnectClient(selectedSessionId, clientId);
    } catch (err) {
      console.error("断开客户端失败:", err);
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <div className="h-full flex bg-gray-50 dark:bg-gray-900">
      {/* 左侧会话列表 */}
      <div className="w-72 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-gray-900 dark:text-white">会话列表</h3>
            <button
              onClick={() => setShowCreateForm(true)}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus size={14} />
              新建
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {sessions.length} 个会话
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Radio size={32} className="mb-2 opacity-50" />
              <p className="text-sm">暂无会话</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => {
                const config = statusConfig[session.status] || statusConfig.disconnected;
                const StatusIcon = config.icon;
                return (
                  <div
                    key={session.id}
                    className={`p-3 rounded-lg cursor-pointer transition-all ${
                      selectedSessionId === session.id
                        ? "bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800"
                        : "bg-gray-50 dark:bg-gray-700/50 border border-transparent hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                    onClick={() => setSelectedSessionId(session.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${config.bg}`}>
                        <StatusIcon size={16} className={config.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm text-gray-900 dark:text-white truncate">
                            {session.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span className={`px-1.5 py-0.5 rounded ${config.bg} ${config.color}`}>
                            {statusText[session.status]}
                          </span>
                          <span>{session.protocol.toUpperCase()}</span>
                          <span>{session.mode === "server" ? "服务器" : "客户端"}</span>
                        </div>
                        <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          {session.host}:{session.port}
                        </div>
                        {session.mode === "server" && session.clientCount > 0 && (
                          <div className="flex items-center gap-1 text-xs text-blue-500 mt-1">
                            <Users size={12} />
                            {session.clientCount} 个客户端
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 右侧内容区 */}
      <div className="flex-1 flex flex-col">
        {showCreateForm ? (
          /* 创建会话表单 */
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">新建会话</h3>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                >
                  <X size={20} className="text-gray-500" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    会话名称
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="可选，留空自动生成"
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      协议
                    </label>
                    <select
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      value={newProtocol}
                      onChange={(e) => setNewProtocol(e.target.value as Protocol)}
                    >
                      <option value="tcp">TCP</option>
                      <option value="udp">UDP</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      模式
                    </label>
                    <select
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      value={newMode}
                      onChange={(e) => setNewMode(e.target.value as SessionMode)}
                    >
                      <option value="client">客户端</option>
                      <option value="server">服务器</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      {newMode === "server" ? "绑定地址" : "目标地址"}
                    </label>
                    <input
                      type="text"
                      value={newHost}
                      onChange={(e) => setNewHost(e.target.value)}
                      placeholder="127.0.0.1"
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      端口
                    </label>
                    <input
                      type="number"
                      value={newPort}
                      onChange={(e) => setNewPort(e.target.value)}
                      placeholder="8080"
                      className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleCreateSession}
                    className="flex-1 px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors"
                  >
                    创建会话
                  </button>
                  <button
                    onClick={() => setShowCreateForm(false)}
                    className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : selectedSession ? (
          /* 会话详情 */
          <>
            {/* 工具栏 */}
            <div className="px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${statusConfig[selectedSession.status]?.bg}`}>
                    {(() => {
                      const Icon = statusConfig[selectedSession.status]?.icon || WifiOff;
                      return <Icon size={18} className={statusConfig[selectedSession.status]?.color} />;
                    })()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {selectedSession.name}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusConfig[selectedSession.status]?.bg} ${statusConfig[selectedSession.status]?.color}`}>
                        {statusText[selectedSession.status]}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {selectedSession.protocol.toUpperCase()} · {selectedSession.host}:{selectedSession.port}
                      {selectedSession.errorMessage && (
                        <span className="text-red-500 ml-2">· {selectedSession.errorMessage}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {selectedSession.status === "disconnected" || selectedSession.status === "error" ? (
                    <button
                      onClick={() => handleStartSession(selectedSession.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      <Play size={14} />
                      {selectedSession.mode === "server" ? "启动" : "连接"}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleStopSession(selectedSession.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-500 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      <Square size={14} />
                      停止
                    </button>
                  )}

                  <button
                    onClick={handleClearMessages}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors"
                  >
                    <Eraser size={14} />
                    清空
                  </button>

                  <button
                    onClick={() => handleRemoveSession(selectedSession.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 text-sm font-medium rounded-lg transition-colors"
                  >
                    <Trash2 size={14} />
                    删除
                  </button>
                </div>
              </div>
            </div>

            {/* 统计栏 */}
            <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 flex items-center gap-6 text-sm">
              <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                <ArrowUpRight size={14} className="text-green-500" />
                发送: <span className="font-medium text-gray-900 dark:text-white">{formatBytes(selectedSession.bytesSent)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                <ArrowDownLeft size={14} className="text-blue-500" />
                接收: <span className="font-medium text-gray-900 dark:text-white">{formatBytes(selectedSession.bytesReceived)}</span>
              </div>
              <div className="text-gray-600 dark:text-gray-400">
                消息: <span className="font-medium text-gray-900 dark:text-white">{selectedSession.messageCount}</span>
              </div>
              <label className="flex items-center gap-1.5 ml-auto text-gray-600 dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="rounded"
                />
                自动滚动
              </label>
            </div>

            {/* 服务器模式客户端列表 */}
            {selectedSession.mode === "server" && clients.length > 0 && (
              <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-900/30">
                <div className="flex items-center gap-2 text-sm">
                  <Users size={14} className="text-blue-500" />
                  <span className="text-blue-700 dark:text-blue-300 font-medium">
                    已连接客户端 ({clients.length})
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {clients.map((client) => (
                    <div
                      key={client.id}
                      className="flex items-center gap-2 px-2 py-1 bg-white dark:bg-gray-800 rounded-lg text-sm border border-blue-200 dark:border-blue-800"
                    >
                      <Monitor size={12} className="text-blue-500" />
                      <span className="text-gray-700 dark:text-gray-300">{client.addr}</span>
                      <button
                        onClick={() => handleDisconnectClient(client.id)}
                        className="p-0.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-red-500"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 消息列表 */}
            <div className="flex-1 overflow-y-auto p-4 bg-gray-900 font-mono text-sm">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                  <Radio size={32} className="mb-2 opacity-50" />
                  <p>暂无消息</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`mb-1 flex items-start gap-2 ${
                      msg.direction === "sent" ? "text-green-400" : "text-cyan-400"
                    }`}
                  >
                    <span className="text-gray-500 shrink-0">[{formatTime(msg.timestamp)}]</span>
                    <span className="shrink-0">
                      {msg.direction === "sent" ? (
                        <ArrowUpRight size={14} className="text-green-500" />
                      ) : (
                        <ArrowDownLeft size={14} className="text-cyan-500" />
                      )}
                    </span>
                    {msg.clientAddr && (
                      <span className="text-gray-400 shrink-0">[{msg.clientAddr}]</span>
                    )}
                    <span className="whitespace-pre-wrap break-all">{msg.data}</span>
                    <span className="text-gray-600 shrink-0">({msg.size}B)</span>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 发送区域 */}
            <div className="p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
              {selectedSession.mode === "server" && clients.length > 0 && (
                <div className="flex items-center gap-3 mb-3">
                  <select
                    className="px-3 py-1.5 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    value={targetClient}
                    onChange={(e) => setTargetClient(e.target.value)}
                    disabled={broadcast}
                  >
                    <option value="">选择客户端...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.addr}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={broadcast}
                      onChange={(e) => setBroadcast(e.target.checked)}
                      className="rounded"
                    />
                    广播到所有客户端
                  </label>
                </div>
              )}

              <div className="flex gap-3">
                {/* 自定义向上展开的下拉框 */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowFormatDropdown(!showFormatDropdown)}
                    className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none min-w-[90px] justify-between"
                  >
                    <span>{sendFormat === "text" ? "文本" : sendFormat === "hex" ? "HEX" : "Base64"}</span>
                    <ChevronUp size={14} className={`transition-transform ${showFormatDropdown ? "" : "rotate-180"}`} />
                  </button>
                  {showFormatDropdown && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowFormatDropdown(false)}
                      />
                      <div className="absolute bottom-full left-0 mb-1 w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-20 overflow-hidden">
                        {[
                          { value: "text" as DataFormat, label: "文本" },
                          { value: "hex" as DataFormat, label: "HEX" },
                          { value: "base64" as DataFormat, label: "Base64" },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              setSendFormat(opt.value);
                              setShowFormatDropdown(false);
                            }}
                            className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-600 ${
                              sendFormat === opt.value ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" : ""
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <input
                  type="text"
                  className="flex-1 px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  value={sendData}
                  onChange={(e) => setSendData(e.target.value)}
                  placeholder={
                    sendFormat === "hex"
                      ? "48 65 6C 6C 6F 或 48656C6C6F"
                      : sendFormat === "base64"
                      ? "Base64 编码内容"
                      : "输入要发送的内容..."
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={
                    !sendData.trim() ||
                    (selectedSession.status !== "connected" && selectedSession.status !== "listening")
                  }
                  className="flex items-center gap-2 px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
                >
                  <Send size={16} />
                  发送
                </button>
              </div>
            </div>
          </>
        ) : (
          /* 空状态 */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center">
                <Radio size={32} className="text-cyan-500" />
              </div>
              <p className="text-gray-500 dark:text-gray-400 mb-4">选择或创建一个会话开始测试</p>
              <button
                onClick={() => setShowCreateForm(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors"
              >
                <Plus size={18} />
                新建会话
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
