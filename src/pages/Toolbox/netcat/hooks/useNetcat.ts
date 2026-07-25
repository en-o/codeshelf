// Netcat 核心状态管理 Hook
// 修复了发送消息时闭包过期的问题：所有在 setInterval/useCallback 中引用的值都通过 useRef 获取最新值

import { useState, useEffect, useRef, useCallback } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
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
} from "@/services/toolbox";
import { defaultAutoSendConfig } from "../constants";
import type {
  Protocol,
  SessionMode,
  DataFormat,
  AutoSendConfig,
  NetcatSession,
  NetcatMessage,
  ConnectedClient,
  NetcatEvent,
} from "@/types/toolbox";

export function useNetcat() {
  // ==================== 核心状态 ====================
  const [sessions, setSessions] = useState<NetcatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<NetcatMessage[]>([]);
  const [clients, setClients] = useState<ConnectedClient[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // ==================== Refs（避免闭包过期） ====================
  const selectedSessionIdRef = useRef<string | null>(null);
  const sessionsRef = useRef<NetcatSession[]>([]);
  const clientsRef = useRef<ConnectedClient[]>([]);
  const clientsBySessionRef = useRef<Record<string, ConnectedClient[]>>({});

  useEffect(() => { selectedSessionIdRef.current = selectedSessionId; }, [selectedSessionId]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { clientsRef.current = clients; }, [clients]);

  // ==================== 创建会话表单状态 ====================
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProtocol, setNewProtocol] = useState<Protocol>("tcp");
  const [newMode, setNewMode] = useState<SessionMode>("client");
  const [newHost, setNewHost] = useState("127.0.0.1");
  const [newPort, setNewPort] = useState("8080");
  const [newName, setNewName] = useState("");

  // ==================== 发送消息状态 ====================
  const [sendData, setSendData] = useState("");
  const [sendFormat, setSendFormat] = useState<DataFormat>("text");
  const [targetClient, setTargetClient] = useState<string>("");
  const [broadcast, setBroadcast] = useState(false);

  // 用 ref 跟踪发送相关状态，避免闭包过期
  const sendFormatRef = useRef(sendFormat);
  const targetClientRef = useRef(targetClient);
  const broadcastRef = useRef(broadcast);
  const sendDataRef = useRef(sendData);
  const targetClientBySessionRef = useRef<Record<string, string>>({});
  const broadcastBySessionRef = useRef<Record<string, boolean>>({});

  useEffect(() => { sendFormatRef.current = sendFormat; }, [sendFormat]);
  useEffect(() => { targetClientRef.current = targetClient; }, [targetClient]);
  useEffect(() => { broadcastRef.current = broadcast; }, [broadcast]);
  useEffect(() => { sendDataRef.current = sendData; }, [sendData]);

  useEffect(() => {
    if (!targetClient) return;
    if (clients.length === 0) return;

    const sessionId = selectedSessionIdRef.current;
    const session = sessionsRef.current.find((s) => s.id === sessionId);
    if (session?.mode !== "server") return;

    const targetStillConnected = clients.some(
      (client) => client.id === targetClient || client.addr === targetClient
    );
    if (!targetStillConnected) {
      targetClientRef.current = "";
      if (sessionId) {
        targetClientBySessionRef.current[sessionId] = "";
      }
      setTargetClient("");
    }
  }, [clients, targetClient]);

  const handleTargetClientChange = useCallback((clientId: string) => {
    const sessionId = selectedSessionIdRef.current;
    if (sessionId) {
      targetClientBySessionRef.current[sessionId] = clientId;
      broadcastBySessionRef.current[sessionId] = false;
    }
    targetClientRef.current = clientId;
    broadcastRef.current = false;
    setTargetClient(clientId);
    setBroadcast(false);
  }, []);

  const handleBroadcastChange = useCallback((enabled: boolean) => {
    const sessionId = selectedSessionIdRef.current;
    if (sessionId) {
      broadcastBySessionRef.current[sessionId] = enabled;
      if (enabled) {
        targetClientBySessionRef.current[sessionId] = "";
      }
    }
    broadcastRef.current = enabled;
    setBroadcast(enabled);
    if (enabled) {
      targetClientRef.current = "";
      setTargetClient("");
    }
  }, []);

  // ==================== 自动发送状态 ====================
  const [showAutoSendPanel, setShowAutoSendPanel] = useState(false);
  const [autoSendCount, setAutoSendCount] = useState<Record<string, number>>({});
  const csvIndexesRef = useRef<Record<string, number>>({});
  const autoSendTimersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // ==================== 自动滚动 ====================
  const [autoScroll, setAutoScroll] = useState(true);

  // ==================== 派生状态 ====================
  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const currentAutoSend = selectedSession?.autoSend || defaultAutoSendConfig;
  const currentAutoSendCount = selectedSessionId ? autoSendCount[selectedSessionId] || 0 : 0;

  // ==================== 数据加载 ====================

  const refreshSessions = useCallback(async () => {
    try {
      const list = await netcatGetSessions();
      setSessions(list);
    } catch (err) {
      console.error("刷新会话失败:", err);
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
      clientsBySessionRef.current[sessionId] = list;
      setClients(list);
    } catch (err) {
      console.error("加载客户端失败:", err);
    }
  }, []);

  // ==================== 初始化 ====================

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

    const refreshInterval = setInterval(() => { if (!document.hidden) refreshSessions(); }, 2000);

    return () => {
      clearInterval(refreshInterval);
      Object.values(autoSendTimersRef.current).forEach(clearInterval);
    };
  }, [refreshSessions]);

  // ==================== 会话切换加载消息 ====================

  const prevSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedSessionId && selectedSessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = selectedSessionId;
      loadMessages(selectedSessionId);
      const session = sessions.find(s => s.id === selectedSessionId);
      if (session?.mode === "server") {
        const restoredTarget = targetClientBySessionRef.current[selectedSessionId] || "";
        const restoredBroadcast = broadcastBySessionRef.current[selectedSessionId] || false;
        targetClientRef.current = restoredTarget;
        broadcastRef.current = restoredBroadcast;
        setTargetClient(restoredTarget);
        setBroadcast(restoredBroadcast);
        setClients([]);
        loadClients(selectedSessionId);
      } else {
        targetClientRef.current = "";
        broadcastRef.current = false;
        setTargetClient("");
        setBroadcast(false);
        setClients([]);
      }
    } else if (!selectedSessionId) {
      prevSessionIdRef.current = null;
      targetClientRef.current = "";
      broadcastRef.current = false;
      setTargetClient("");
      setBroadcast(false);
      setMessages([]);
      setClients([]);
    }
  }, [selectedSessionId, sessions, loadMessages, loadClients]);

  // ==================== 事件监听 ====================

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let isMounted = true;

    const setupListener = async () => {
      const unlistenFn = await listen<NetcatEvent>("netcat-event", (event) => {
        if (!isMounted) return;

        const data = event.payload;
        const currentSessionId = selectedSessionIdRef.current;

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
            clientsBySessionRef.current[data.sessionId] = [
              ...(clientsBySessionRef.current[data.sessionId] || []).filter((c) => c.id !== data.client.id),
              data.client,
            ];
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
            clientsBySessionRef.current[data.sessionId] = (
              clientsBySessionRef.current[data.sessionId] || []
            ).filter((c) => c.id !== data.clientId);
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

      if (isMounted) {
        unlisten = unlistenFn;
      } else {
        unlistenFn();
      }
    };

    setupListener();
    return () => {
      isMounted = false;
      unlisten?.();
    };
  }, []);

  // ==================== 模板数据生成 ====================

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
          return String(Date.now() % 10000);
        }
        default:
          return `{{${type}}}`;
      }
    });
  };

  // ==================== 获取自动发送数据 ====================

  const getNextAutoSendData = useCallback(async (sessionId: string, config: AutoSendConfig): Promise<string | null> => {
    switch (config.mode) {
      case "fixed":
        return config.fixedData || null;
      case "csv": {
        const lines = config.csvData.split("\n").filter((l) => l.trim());
        if (lines.length === 0) return null;
        const currentIndex = csvIndexesRef.current[sessionId] || 0;
        const data = lines[currentIndex % lines.length];
        csvIndexesRef.current[sessionId] = currentIndex + 1;
        return data;
      }
      case "template": {
        return generateTemplateData(config.template);
      }
      case "http": {
        if (!config.httpUrl) return null;
        try {
          let headers: Record<string, string> | undefined;
          if (config.httpHeaders?.trim()) {
            try {
              headers = JSON.parse(config.httpHeaders);
            } catch {
              console.error("HTTP headers 解析失败，应为 JSON 格式");
            }
          }
          const data = await netcatFetchHttp({
            url: config.httpUrl,
            method: config.httpMethod || "GET",
            headers,
            body: config.httpBody || undefined,
            jsonPath: config.httpJsonPath || undefined,
          });
          return data || null;
        } catch (err) {
          console.error("HTTP 获取失败:", err);
          return null;
        }
      }
      default:
        return null;
    }
  }, []);

  // ==================== 发送消息（修复闭包过期） ====================

  /**
   * 发送消息核心函数
   * 关键修复：使用 useRef 获取最新的 sendFormat / targetClient / broadcast，
   * 避免在 setInterval（自动发送）中捕获到过期的闭包值。
   */
  const handleSendMessage = useCallback(async (
    dataOverride?: string,
    sessionIdOverride?: string,
    options?: { forceTargetClient?: string; forceBroadcast?: boolean; forceFormat?: DataFormat }
  ): Promise<boolean> => {
    const targetSessionId = sessionIdOverride || selectedSessionIdRef.current;
    const dataToSend = dataOverride ?? sendDataRef.current;
    if (!targetSessionId || !dataToSend.trim()) return false;

    const session = sessionsRef.current.find((s) => s.id === targetSessionId);
    const isServerMode = session?.mode === "server";

    // 使用 ref 获取最新值，options 中的强制值优先
    let finalTargetClient = options?.forceTargetClient ?? targetClientRef.current;
    let finalBroadcast = options?.forceBroadcast ?? broadcastRef.current;
    const format = options?.forceFormat ?? sendFormatRef.current;

    if (isServerMode && finalTargetClient) {
      const sessionClients = clientsBySessionRef.current[targetSessionId] || clientsRef.current;
      if (sessionClients.length > 0) {
        const matchedClient = sessionClients.find(
          (client) => client.id === finalTargetClient || client.addr === finalTargetClient
        );
        finalTargetClient = matchedClient?.id ?? "";
      }
    }

    // 服务器模式下，如果没有指定目标且没有启用广播，默认启用广播
    if (isServerMode && !finalTargetClient && !finalBroadcast) {
      finalBroadcast = true;
    }

    try {
      // 广播模式下不传 targetClient，两者互斥，否则后端可能拒绝
      const msg = await netcatSendMessage({
        sessionId: targetSessionId,
        data: dataToSend,
        format,
        targetClient: finalBroadcast ? undefined : (finalTargetClient || undefined),
        broadcast: finalBroadcast || undefined,
      });

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
  }, []); // 空依赖，全部通过 ref 获取最新值

  // 用 ref 保存最新的 handleSendMessage，供 startAutoSendTimer 使用
  const handleSendMessageRef = useRef(handleSendMessage);
  useEffect(() => { handleSendMessageRef.current = handleSendMessage; }, [handleSendMessage]);

  const getNextAutoSendDataRef = useRef(getNextAutoSendData);
  useEffect(() => { getNextAutoSendDataRef.current = getNextAutoSendData; }, [getNextAutoSendData]);

  // ==================== 自动发送定时器 ====================

  const startAutoSendTimer = useCallback((sessionId: string, config: AutoSendConfig) => {
    // 清除现有定时器
    if (autoSendTimersRef.current[sessionId]) {
      clearInterval(autoSendTimersRef.current[sessionId]);
    }

    const doAutoSend = async () => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session || (session.status !== "connected" && session.status !== "listening")) {
        return;
      }

      const data = await getNextAutoSendDataRef.current(sessionId, config);
      if (data) {
        const isCurrentSession = selectedSessionIdRef.current === sessionId;
        const savedTargetClient = targetClientBySessionRef.current[sessionId] || "";
        const savedBroadcast = broadcastBySessionRef.current[sessionId] || false;
        const serverSendOptions = session.mode === "server" && !isCurrentSession
          ? {
              forceTargetClient: savedBroadcast ? "" : savedTargetClient,
              forceBroadcast: savedBroadcast || !savedTargetClient,
            }
          : undefined;
        const success = await handleSendMessageRef.current(
          data,
          sessionId,
          serverSendOptions
        );
        if (success) {
          setAutoSendCount((prev) => ({
            ...prev,
            [sessionId]: (prev[sessionId] || 0) + 1,
          }));
        }
      }
    };

    autoSendTimersRef.current[sessionId] = setInterval(doAutoSend, config.intervalMs);
  }, []);

  const stopAutoSendTimer = useCallback((sessionId: string) => {
    if (autoSendTimersRef.current[sessionId]) {
      clearInterval(autoSendTimersRef.current[sessionId]);
      delete autoSendTimersRef.current[sessionId];
    }
  }, []);

  // 监听会话的自动发送状态变化
  useEffect(() => {
    sessions.forEach((session) => {
      const isConnected = session.status === "connected" || session.status === "listening";

      if (session.autoSend?.enabled && isConnected) {
        if (!autoSendTimersRef.current[session.id]) {
          startAutoSendTimer(session.id, session.autoSend);
        }
      } else {
        stopAutoSendTimer(session.id);
      }
    });
  }, [sessions, startAutoSendTimer, stopAutoSendTimer]);

  // ==================== 自动发送控制 ====================

  const toggleAutoSend = async (enable: boolean) => {
    if (!selectedSession) return;

    const newConfig = {
      ...selectedSession.autoSend,
      enabled: enable,
    };

    setSessions((prev) =>
      prev.map((s) =>
        s.id === selectedSession.id ? { ...s, autoSend: newConfig } : s
      )
    );

    if (enable) {
      setAutoSendCount((prev) => ({ ...prev, [selectedSession.id]: 0 }));
      csvIndexesRef.current[selectedSession.id] = 0;
    }

    try {
      await netcatUpdateAutoSend(selectedSession.id, newConfig);
    } catch (err) {
      console.error("保存自动发送配置失败:", err);
    }
  };

  const updateAutoSendConfig = async (updates: Partial<AutoSendConfig>) => {
    if (!selectedSession) return;

    const newConfig = {
      ...(selectedSession.autoSend || defaultAutoSendConfig),
      ...updates,
    };

    setSessions((prev) =>
      prev.map((s) =>
        s.id === selectedSession.id ? { ...s, autoSend: newConfig } : s
      )
    );

    if (newConfig.enabled && autoSendTimersRef.current[selectedSession.id]) {
      stopAutoSendTimer(selectedSession.id);
      startAutoSendTimer(selectedSession.id, newConfig);
    }

    try {
      await netcatUpdateAutoSend(selectedSession.id, newConfig);
    } catch (err) {
      console.error("保存自动发送配置失败:", err);
    }
  };

  // ==================== 会话 CRUD ====================

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

    stopAutoSendTimer(sessionId);

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

  // ==================== 消息操作 ====================

  const copyAllMessages = useCallback(() => {
    if (messages.length === 0) return;
    const text = messages
      .map((msg) => {
        const time = new Date(msg.timestamp).toLocaleTimeString();
        const dir = msg.direction === "sent" ? "发送" : "接收";
        const client = msg.clientAddr ? ` [${msg.clientAddr}]` : "";
        return `[${time}] ${dir}${client}: ${msg.data}`;
      })
      .join("\n");
    navigator.clipboard.writeText(text);
  }, [messages]);

  const clearPanelMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const refreshMessages = useCallback(() => {
    if (selectedSessionId) {
      loadMessages(selectedSessionId);
      const session = sessions.find(s => s.id === selectedSessionId);
      if (session?.mode === "server") {
        loadClients(selectedSessionId);
      }
    }
  }, [selectedSessionId, sessions, loadMessages, loadClients]);

  // ==================== 返回所有状态和操作 ====================

  return {
    // 核心状态
    sessions,
    selectedSessionId,
    selectedSession,
    messages,
    clients,
    loading,
    initialized,

    // 创建会话表单
    showCreateForm,
    newProtocol,
    newMode,
    newHost,
    newPort,
    newName,
    setShowCreateForm,
    setNewProtocol,
    setNewMode,
    setNewHost,
    setNewPort,
    setNewName,

    // 发送消息
    sendData,
    sendFormat,
    targetClient,
    broadcast,
    setSendData,
    setSendFormat,
    setTargetClient: handleTargetClientChange,
    setBroadcast: handleBroadcastChange,

    // 自动发送
    showAutoSendPanel,
    setShowAutoSendPanel,
    currentAutoSend,
    currentAutoSendCount,

    // 自动滚动
    autoScroll,
    setAutoScroll,

    // 操作方法
    setSelectedSessionId,
    handleCreateSession,
    handleStartSession,
    handleStopSession,
    handleRemoveSession,
    handleClearMessages,
    handleDisconnectClient,
    handleSendMessage,
    toggleAutoSend,
    updateAutoSendConfig,
    copyAllMessages,
    clearPanelMessages,
    refreshMessages,
  };
}
