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
  ChevronDown,
  Loader2,
  Timer,
  Pause,
  Settings2,
} from "lucide-react";
import {
  netcatInit,
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
  netcatUpdateAutoSend,
  netcatFetchHttp,
  formatBytes,
} from "@/services/toolbox";
import type {
  Protocol,
  SessionMode,
  DataFormat,
  AutoSendMode,
  AutoSendConfig,
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

// 默认自动发送配置
const defaultAutoSendConfig: AutoSendConfig = {
  enabled: false,
  intervalMs: 1000,
  mode: "fixed",
  fixedData: "",
  csvData: "",
  template: "",
  httpUrl: "",
  httpMethod: "GET",
  httpHeaders: "",
  httpBody: "",
  httpJsonPath: "",
};

export default function NetcatTool() {
  const [sessions, setSessions] = useState<NetcatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<NetcatMessage[]>([]);
  const [clients, setClients] = useState<ConnectedClient[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // 用 ref 追踪当前状态，避免闭包问题
  const selectedSessionIdRef = useRef<string | null>(null);
  const sessionsRef = useRef<NetcatSession[]>([]);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

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
  const [showClientDropdown, setShowClientDropdown] = useState(false);

  // 自动发送 - 每个会话独立的自动发送状态
  const [showAutoSendPanel, setShowAutoSendPanel] = useState(false);
  const [autoSendCount, setAutoSendCount] = useState<Record<string, number>>({});
  const csvIndexesRef = useRef<Record<string, number>>({});
  const autoSendTimersRef = useRef<Record<string, NodeJS.Timeout>>({});

  // 自动滚动
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);

  // 刷新会话状态（不重新加载消息）
  const refreshSessions = useCallback(async () => {
    try {
      const list = await netcatGetSessions();
      // 只更新会话元数据，保留当前消息状态
      setSessions(list);
    } catch (err) {
      console.error("刷新会话失败:", err);
    }
  }, []);

  // 初始化并加载会话
  useEffect(() => {
    const init = async () => {
      try {
        await netcatInit();
        await refreshSessions();
        setInitialized(true);
      } catch (err) {
        console.error("初始化 Netcat 失败:", err);
        setInitialized(true);
      }
    };
    init();

    // 定期刷新会话状态（每2秒），但不刷新消息
    const refreshInterval = setInterval(refreshSessions, 2000);

    return () => {
      clearInterval(refreshInterval);
      Object.values(autoSendTimersRef.current).forEach(clearInterval);
    };
  }, [refreshSessions]);

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

  // 只在切换会话时加载消息（使用 ref 跟踪上一个会话ID）
  const prevSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedSessionId && selectedSessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = selectedSessionId;
      loadMessages(selectedSessionId);
      const session = sessions.find(s => s.id === selectedSessionId);
      if (session?.mode === "server") {
        loadClients(selectedSessionId);
      }
    } else if (!selectedSessionId) {
      prevSessionIdRef.current = null;
      setMessages([]);
      setClients([]);
    }
  }, [selectedSessionId, sessions, loadMessages, loadClients]);

  // 事件监听
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setupListener = async () => {
      console.log("Netcat: 设置事件监听器");
      unlisten = await listen<NetcatEvent>("netcat-event", (event) => {
        const data = event.payload;
        // 使用 ref 获取当前选中的会话ID，避免闭包过期问题
        const currentSessionId = selectedSessionIdRef.current;

        console.log("Netcat 收到事件:", data.type, "sessionId:", data.sessionId, "当前选中:", currentSessionId);

        switch (data.type) {
          case "statusChanged":
            console.log("状态变更:", data.status);
            setSessions((prev) =>
              prev.map((s) =>
                s.id === data.sessionId
                  ? { ...s, status: data.status, errorMessage: data.error }
                  : s
              )
            );
            break;

          case "messageReceived":
            console.log("收到消息:", data.message.data?.substring(0, 50), "匹配当前会话:", data.sessionId === currentSessionId);
            if (data.sessionId === currentSessionId) {
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
            console.log("客户端连接:", data.client.addr);
            if (data.sessionId === currentSessionId) {
              setClients((prev) => [...prev, data.client]);
            }
            setSessions((prev) =>
              prev.map((s) =>
                s.id === data.sessionId ? { ...s, clientCount: s.clientCount + 1 } : s
              )
            );
            break;

          case "clientDisconnected":
            console.log("客户端断开:", data.clientId);
            if (data.sessionId === currentSessionId) {
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
      console.log("Netcat: 事件监听器已设置");
    };

    setupListener();
    return () => {
      console.log("Netcat: 清理事件监听器");
      unlisten?.();
    };
  }, []); // 使用空依赖数组，因为使用了 ref 来获取当前 session

  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, autoScroll]);

  // 生成模板数据
  const generateTemplateData = (template: string): string => {
    return template.replace(/\{\{(\w+)(?::([^}]+))?\}\}/g, (_, type, param) => {
      switch (type) {
        case "random": {
          const [min, max] = (param || "1-100").split("-").map(Number);
          return String(Math.floor(Math.random() * (max - min + 1)) + min);
        }
        case "uuid":
          return crypto.randomUUID();
        case "timestamp":
          return String(Date.now());
        case "datetime":
          return new Date().toISOString();
        case "date":
          return new Date().toISOString().split("T")[0];
        case "time":
          return new Date().toLocaleTimeString();
        case "float": {
          const [fmin, fmax] = (param || "0-1").split("-").map(Number);
          return (Math.random() * (fmax - fmin) + fmin).toFixed(2);
        }
        case "choice": {
          const choices = (param || "a,b,c").split(",");
          return choices[Math.floor(Math.random() * choices.length)];
        }
        case "seq": {
          // 序列号，每次递增
          return String(Date.now() % 10000);
        }
        default:
          return `{{${type}}}`;
      }
    });
  };

  // 获取下一条自动发送数据
  const getNextAutoSendData = async (sessionId: string, config: AutoSendConfig): Promise<string | null> => {
    console.log("获取自动发送数据, 模式:", config.mode);
    switch (config.mode) {
      case "fixed":
        console.log("固定模式, 数据:", config.fixedData?.substring(0, 50));
        return config.fixedData || null;
      case "csv": {
        const lines = config.csvData.split("\n").filter((l) => l.trim());
        if (lines.length === 0) return null;
        // 使用 ref 来保持索引，避免闭包问题
        const currentIndex = csvIndexesRef.current[sessionId] || 0;
        const data = lines[currentIndex % lines.length];
        csvIndexesRef.current[sessionId] = currentIndex + 1;
        console.log("CSV模式, 当前行:", currentIndex, "数据:", data?.substring(0, 50));
        return data;
      }
      case "template": {
        const result = generateTemplateData(config.template);
        console.log("模板模式, 生成数据:", result?.substring(0, 50));
        return result;
      }
      case "http": {
        if (!config.httpUrl) {
          console.warn("HTTP模式但没有URL");
          return null;
        }
        try {
          console.log("HTTP模式, 请求URL:", config.httpUrl);
          // 解析 headers（JSON 格式）
          let headers: Record<string, string> | undefined;
          if (config.httpHeaders?.trim()) {
            try {
              headers = JSON.parse(config.httpHeaders);
            } catch {
              console.error("HTTP headers 解析失败，应为 JSON 格式");
            }
          }

          // 使用后端 HTTP 请求，避免 CORS 限制
          const data = await netcatFetchHttp({
            url: config.httpUrl,
            method: config.httpMethod || "GET",
            headers,
            body: config.httpBody || undefined,
            jsonPath: config.httpJsonPath || undefined,
          });
          console.log("HTTP获取成功, 数据:", data?.substring(0, 100));
          return data || null;
        } catch (err) {
          console.error("HTTP 获取失败:", err);
          return null;
        }
      }
      default:
        return null;
    }
  };

  // 发送消息
  const handleSendMessage = async (
    dataOverride?: string,
    sessionIdOverride?: string,
    options?: { forceTargetClient?: string; forceBroadcast?: boolean }
  ) => {
    const targetSessionId = sessionIdOverride || selectedSessionId;
    const dataToSend = dataOverride ?? sendData;
    if (!targetSessionId || !dataToSend.trim()) return false;

    // 获取会话信息来判断模式
    const session = sessionsRef.current.find((s) => s.id === targetSessionId);
    const isServerMode = session?.mode === "server";

    // 确定发送目标
    let finalTargetClient = options?.forceTargetClient ?? targetClient;
    let finalBroadcast = options?.forceBroadcast ?? broadcast;

    // 服务器模式下，如果没有指定目标且没有启用广播，默认启用广播
    if (isServerMode && !finalTargetClient && !finalBroadcast) {
      console.log("服务器模式自动发送，默认启用广播");
      finalBroadcast = true;
    }

    try {
      console.log("发送消息:", {
        sessionId: targetSessionId,
        data: dataToSend.substring(0, 50),
        targetClient: finalTargetClient,
        broadcast: finalBroadcast,
        isServerMode,
      });

      const msg = await netcatSendMessage({
        sessionId: targetSessionId,
        data: dataToSend,
        format: sendFormat,
        targetClient: finalTargetClient || undefined,
        broadcast: finalBroadcast || undefined,
      });

      // 使用 ref 来检查当前选中的会话，避免闭包过期问题
      if (targetSessionId === selectedSessionIdRef.current) {
        setMessages((prev) => [...prev, msg]);
      }

      if (!dataOverride) {
        setSendData("");
      }
      return true;
    } catch (err) {
      console.error("发送消息失败:", err);
      if (!dataOverride) {
        alert(`发送消息失败: ${err}`);
      }
      return false;
    }
  };

  // 管理自动发送定时器
  const startAutoSendTimer = useCallback((sessionId: string, config: AutoSendConfig) => {
    // 清除现有定时器
    if (autoSendTimersRef.current[sessionId]) {
      clearInterval(autoSendTimersRef.current[sessionId]);
    }

    console.log("启动自动发送定时器:", sessionId, "间隔:", config.intervalMs, "模式:", config.mode);

    const doAutoSend = async () => {
      // 使用 ref 获取最新的 sessions，避免闭包过期
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session || (session.status !== "connected" && session.status !== "listening")) {
        console.log("自动发送跳过: 会话状态不对", session?.status);
        return;
      }

      console.log("执行自动发送, 会话:", sessionId, "模式:", session.mode);

      const data = await getNextAutoSendData(sessionId, config);
      if (data) {
        console.log("自动发送数据:", data.substring(0, 50), "会话模式:", session.mode);
        // 自动发送时，服务器模式默认使用广播
        const success = await handleSendMessage(data, sessionId, {
          forceBroadcast: session.mode === "server" ? true : undefined,
        });
        console.log("自动发送结果:", success);
        if (success) {
          setAutoSendCount((prev) => ({
            ...prev,
            [sessionId]: (prev[sessionId] || 0) + 1,
          }));
        }
      } else {
        console.warn("自动发送: 没有获取到数据");
      }
    };

    autoSendTimersRef.current[sessionId] = setInterval(doAutoSend, config.intervalMs);
  }, []); // 移除 sessions 依赖，因为使用了 ref

  const stopAutoSendTimer = (sessionId: string) => {
    if (autoSendTimersRef.current[sessionId]) {
      clearInterval(autoSendTimersRef.current[sessionId]);
      delete autoSendTimersRef.current[sessionId];
    }
  };

  // 监听会话的自动发送状态变化
  useEffect(() => {
    sessions.forEach((session) => {
      const isConnected = session.status === "connected" || session.status === "listening";

      if (session.autoSend?.enabled && isConnected) {
        // 如果自动发送已启用且会话已连接，启动定时器
        if (!autoSendTimersRef.current[session.id]) {
          startAutoSendTimer(session.id, session.autoSend);
        }
      } else {
        // 否则停止定时器
        stopAutoSendTimer(session.id);
      }
    });
  }, [sessions, startAutoSendTimer]);

  // 切换自动发送
  const toggleAutoSend = async (enable: boolean) => {
    if (!selectedSession) return;

    const newConfig = {
      ...selectedSession.autoSend,
      enabled: enable,
    };

    // 更新本地状态
    setSessions((prev) =>
      prev.map((s) =>
        s.id === selectedSession.id ? { ...s, autoSend: newConfig } : s
      )
    );

    // 重置计数
    if (enable) {
      setAutoSendCount((prev) => ({ ...prev, [selectedSession.id]: 0 }));
      csvIndexesRef.current[selectedSession.id] = 0;
    }

    // 保存到后端
    try {
      await netcatUpdateAutoSend(selectedSession.id, newConfig);
    } catch (err) {
      console.error("保存自动发送配置失败:", err);
    }
  };

  // 更新自动发送配置
  const updateAutoSendConfig = async (updates: Partial<AutoSendConfig>) => {
    if (!selectedSession) return;

    const newConfig = {
      ...(selectedSession.autoSend || defaultAutoSendConfig),
      ...updates,
    };

    // 更新本地状态
    setSessions((prev) =>
      prev.map((s) =>
        s.id === selectedSession.id ? { ...s, autoSend: newConfig } : s
      )
    );

    // 如果定时器正在运行，更新定时器
    if (newConfig.enabled && autoSendTimersRef.current[selectedSession.id]) {
      stopAutoSendTimer(selectedSession.id);
      startAutoSendTimer(selectedSession.id, newConfig);
    }

    // 保存到后端
    try {
      await netcatUpdateAutoSend(selectedSession.id, newConfig);
    } catch (err) {
      console.error("保存自动发送配置失败:", err);
    }
  };

  const handleCreateSession = async () => {
    setLoading("create");
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
    } finally {
      setLoading(null);
    }
  };

  const handleStartSession = async (sessionId: string) => {
    setLoading("start");
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, status: "connecting" as const } : s
      )
    );
    try {
      await netcatStartSession(sessionId);
    } catch (err) {
      console.error("启动会话失败:", err);
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, status: "error" as const, errorMessage: String(err) } : s
        )
      );
      alert(`启动会话失败: ${err}`);
    } finally {
      setLoading(null);
    }
  };

  const handleStopSession = async (sessionId: string) => {
    setLoading("stop");

    // 先停止自动发送定时器
    stopAutoSendTimer(sessionId);

    // 更新本地状态 - 禁用自动发送并设置为已断开
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              status: "disconnected" as const,
              autoSend: s.autoSend ? { ...s.autoSend, enabled: false } : s.autoSend,
            }
          : s
      )
    );

    try {
      await netcatStopSession(sessionId);

      // 如果有自动发送配置，保存禁用状态
      const session = sessions.find((s) => s.id === sessionId);
      if (session?.autoSend?.enabled) {
        await netcatUpdateAutoSend(sessionId, { ...session.autoSend, enabled: false });
      }
    } catch (err) {
      console.error("停止会话失败:", err);
      alert(`停止会话失败: ${err}`);
    } finally {
      setLoading(null);
    }
  };

  const handleRemoveSession = async (sessionId: string) => {
    setLoading("delete");
    stopAutoSendTimer(sessionId);
    try {
      await netcatRemoveSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (selectedSessionId === sessionId) {
        setSelectedSessionId(null);
      }
    } catch (err) {
      console.error("删除会话失败:", err);
      alert(`删除会话失败: ${err}`);
    } finally {
      setLoading(null);
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

  const currentAutoSend = selectedSession?.autoSend || defaultAutoSendConfig;
  const currentAutoSendCount = selectedSessionId ? autoSendCount[selectedSessionId] || 0 : 0;

  if (!initialized) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="flex items-center gap-3 text-gray-500">
          <Loader2 className="animate-spin" size={24} />
          <span>加载中...</span>
        </div>
      </div>
    );
  }

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
                const hasAutoSend = session.autoSend?.enabled;
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
                          {hasAutoSend && (
                            <Timer size={12} className="text-orange-500 shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span className={`px-1.5 py-0.5 rounded ${config.bg} ${config.color}`}>
                            {statusText[session.status]}
                          </span>
                          <span>{session.protocol.toUpperCase()}</span>
                        </div>
                        <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          {session.host}:{session.port}
                        </div>
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
                      {currentAutoSend.enabled && (
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400">
                          <Loader2 size={10} className="animate-spin" />
                          自动发送中
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {selectedSession.protocol.toUpperCase()} · {selectedSession.host}:{selectedSession.port}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {selectedSession.status === "disconnected" || selectedSession.status === "error" ? (
                    <button
                      onClick={() => handleStartSession(selectedSession.id)}
                      disabled={loading === "start"}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 disabled:bg-green-400 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      {loading === "start" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                      {selectedSession.mode === "server" ? "启动" : "连接"}
                    </button>
                  ) : selectedSession.status === "connecting" ? (
                    <button disabled className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500 text-white text-sm font-medium rounded-lg">
                      <Loader2 size={14} className="animate-spin" />
                      连接中...
                    </button>
                  ) : (
                    <button
                      onClick={() => handleStopSession(selectedSession.id)}
                      disabled={loading === "stop"}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-500 hover:bg-gray-600 disabled:bg-gray-400 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      {loading === "stop" ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
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
                    disabled={loading === "delete"}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-50 text-red-600 dark:text-red-400 text-sm font-medium rounded-lg transition-colors"
                  >
                    {loading === "delete" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
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
                    <span className={`shrink-0 flex items-center gap-0.5 ${
                      msg.direction === "sent" ? "text-green-500" : "text-cyan-500"
                    }`}>
                      {msg.direction === "sent" ? (
                        <>
                          <ArrowUpRight size={14} />
                          <span className="text-xs">发</span>
                        </>
                      ) : msg.direction === "received" ? (
                        <>
                          <ArrowDownLeft size={14} />
                          <span className="text-xs">收</span>
                        </>
                      ) : (
                        <span className="text-xs text-red-500">[{msg.direction}]</span>
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
            <div className="p-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
              {/* 自动发送配置面板 - 更紧凑 */}
              {showAutoSendPanel && (
                <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-sm text-gray-900 dark:text-white flex items-center gap-2">
                      <Settings2 size={14} />
                      自动发送
                    </h4>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">
                        已发送: <span className="font-medium">{currentAutoSendCount}</span>
                      </span>
                      <button
                        onClick={() => setShowAutoSendPanel(false)}
                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                      >
                        <ChevronDown size={14} className="text-gray-500" />
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-3 mb-2">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">模式</label>
                      <select
                        className="w-full px-2 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm"
                        value={currentAutoSend.mode}
                        onChange={(e) => updateAutoSendConfig({ mode: e.target.value as AutoSendMode })}
                        disabled={currentAutoSend.enabled}
                      >
                        <option value="fixed">固定内容</option>
                        <option value="csv">CSV/多行</option>
                        <option value="template">模板生成</option>
                        <option value="http">HTTP 获取</option>
                      </select>
                    </div>
                    <div className="w-28">
                      <label className="block text-xs text-gray-500 mb-1">间隔 (ms)</label>
                      <input
                        type="number"
                        className="w-full px-2 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm"
                        value={currentAutoSend.intervalMs}
                        onChange={(e) => updateAutoSendConfig({ intervalMs: Math.max(100, parseInt(e.target.value) || 1000) })}
                        disabled={currentAutoSend.enabled}
                        min={100}
                        step={100}
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        onClick={() => toggleAutoSend(!currentAutoSend.enabled)}
                        disabled={selectedSession.status !== "connected" && selectedSession.status !== "listening"}
                        className={`flex items-center gap-1.5 px-3 py-1 text-sm font-medium rounded transition-colors ${
                          currentAutoSend.enabled
                            ? "bg-red-500 hover:bg-red-600 text-white"
                            : "bg-green-500 hover:bg-green-600 text-white"
                        } disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed`}
                      >
                        {currentAutoSend.enabled ? <><Pause size={12} /> 停止</> : <><Play size={12} /> 启动</>}
                      </button>
                    </div>
                  </div>

                  {/* 模式特定配置 - 单行或紧凑显示 */}
                  <div className="text-xs">
                    {currentAutoSend.mode === "fixed" && (
                      <textarea
                        className="w-full px-2 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm font-mono h-16 resize-none"
                        value={currentAutoSend.fixedData}
                        onChange={(e) => updateAutoSendConfig({ fixedData: e.target.value })}
                        placeholder="输入固定发送内容..."
                        disabled={currentAutoSend.enabled}
                      />
                    )}
                    {currentAutoSend.mode === "csv" && (
                      <textarea
                        className="w-full px-2 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm font-mono h-16 resize-none"
                        value={currentAutoSend.csvData}
                        onChange={(e) => updateAutoSendConfig({ csvData: e.target.value })}
                        placeholder="每行一条数据，循环发送"
                        disabled={currentAutoSend.enabled}
                      />
                    )}
                    {currentAutoSend.mode === "template" && (
                      <div>
                        <div className="text-gray-400 mb-1">
                          变量: {`{{random:1-100}}`} {`{{uuid}}`} {`{{timestamp}}`} {`{{float:0-1}}`} {`{{choice:a,b,c}}`}
                        </div>
                        <textarea
                          className="w-full px-2 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm font-mono h-16 resize-none"
                          value={currentAutoSend.template}
                          onChange={(e) => updateAutoSendConfig({ template: e.target.value })}
                          placeholder='{"id":"{{uuid}}","value":{{random:1-100}}}'
                          disabled={currentAutoSend.enabled}
                        />
                      </div>
                    )}
                    {currentAutoSend.mode === "http" && (
                      <div className="space-y-1">
                        <div className="flex gap-2">
                          <select
                            className="w-20 px-2 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm"
                            value={currentAutoSend.httpMethod || "GET"}
                            onChange={(e) => updateAutoSendConfig({ httpMethod: e.target.value })}
                            disabled={currentAutoSend.enabled}
                          >
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                            <option value="DELETE">DELETE</option>
                          </select>
                          <input
                            type="text"
                            className="flex-1 px-2 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm"
                            value={currentAutoSend.httpUrl}
                            onChange={(e) => updateAutoSendConfig({ httpUrl: e.target.value })}
                            placeholder="HTTP URL"
                            disabled={currentAutoSend.enabled}
                          />
                        </div>
                        <input
                          type="text"
                          className="w-full px-2 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm"
                          value={currentAutoSend.httpHeaders || ""}
                          onChange={(e) => updateAutoSendConfig({ httpHeaders: e.target.value })}
                          placeholder='Headers (JSON): {"Authorization": "Bearer xxx"}'
                          disabled={currentAutoSend.enabled}
                        />
                        {(currentAutoSend.httpMethod === "POST" || currentAutoSend.httpMethod === "PUT") && (
                          <input
                            type="text"
                            className="w-full px-2 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm"
                            value={currentAutoSend.httpBody || ""}
                            onChange={(e) => updateAutoSendConfig({ httpBody: e.target.value })}
                            placeholder="Request Body"
                            disabled={currentAutoSend.enabled}
                          />
                        )}
                        <input
                          type="text"
                          className="w-full px-2 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm"
                          value={currentAutoSend.httpJsonPath || ""}
                          onChange={(e) => updateAutoSendConfig({ httpJsonPath: e.target.value })}
                          placeholder="JSON 路径 (如: data.items[0].value 或 data.name,data.id)"
                          disabled={currentAutoSend.enabled}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selectedSession.mode === "server" && clients.length > 0 && (
                <div className="flex items-center gap-3 mb-2">
                  {/* 客户端选择下拉框 */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => !broadcast && setShowClientDropdown(!showClientDropdown)}
                      disabled={broadcast}
                      className={`flex items-center gap-2 px-2 py-1.5 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm min-w-[140px] justify-between ${
                        broadcast ? "opacity-50 cursor-not-allowed" : ""
                      }`}
                    >
                      <span className="truncate text-xs">
                        {targetClient
                          ? clients.find((c) => c.id === targetClient)?.addr || "选择客户端"
                          : "选择客户端"}
                      </span>
                      <ChevronUp size={12} className={`shrink-0 transition-transform ${showClientDropdown ? "" : "rotate-180"}`} />
                    </button>
                    {showClientDropdown && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowClientDropdown(false)} />
                        <div className="absolute bottom-full left-0 mb-1 w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded shadow-lg z-20 overflow-hidden max-h-40 overflow-y-auto">
                          {clients.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                setTargetClient(c.id);
                                setShowClientDropdown(false);
                              }}
                              className={`w-full px-2 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-600 ${
                                targetClient === c.id ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600" : ""
                              }`}
                            >
                              {c.addr}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={broadcast}
                      onChange={(e) => setBroadcast(e.target.checked)}
                      className="rounded"
                    />
                    广播
                  </label>
                </div>
              )}

              <div className="flex gap-2">
                {/* 格式下拉框 */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowFormatDropdown(!showFormatDropdown)}
                    className="flex items-center gap-1 px-2 py-1.5 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm min-w-[70px] justify-between"
                  >
                    <span className="text-xs">{sendFormat === "text" ? "文本" : sendFormat === "hex" ? "HEX" : "B64"}</span>
                    <ChevronUp size={12} className={`transition-transform ${showFormatDropdown ? "" : "rotate-180"}`} />
                  </button>
                  {showFormatDropdown && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowFormatDropdown(false)} />
                      <div className="absolute bottom-full left-0 mb-1 w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded shadow-lg z-20 overflow-hidden">
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
                            className={`w-full px-2 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-600 ${
                              sendFormat === opt.value ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600" : ""
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
                  className="flex-1 px-3 py-1.5 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                  value={sendData}
                  onChange={(e) => setSendData(e.target.value)}
                  placeholder={
                    sendFormat === "hex" ? "48 65 6C 6C 6F" : sendFormat === "base64" ? "Base64" : "输入内容..."
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />
                <button
                  onClick={() => handleSendMessage()}
                  disabled={
                    !sendData.trim() ||
                    (selectedSession.status !== "connected" && selectedSession.status !== "listening")
                  }
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white text-sm font-medium rounded transition-colors disabled:cursor-not-allowed"
                >
                  <Send size={14} />
                  发送
                </button>
                <button
                  onClick={() => setShowAutoSendPanel(!showAutoSendPanel)}
                  className={`flex items-center gap-1 px-2 py-1.5 border rounded text-sm transition-colors ${
                    showAutoSendPanel || currentAutoSend.enabled
                      ? "bg-orange-50 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700 text-orange-600"
                      : "bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-600 hover:bg-gray-100"
                  }`}
                  title="自动发送"
                >
                  {currentAutoSend.enabled ? <Loader2 size={14} className="animate-spin" /> : <Timer size={14} />}
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
