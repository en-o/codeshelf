// PairDrop 客户端 hook
//
// 桌面端的 React UI 也是一个 WebSocket 客户端，复用同样的协议跟浏览器对等。
// 文件上传走 HTTP multipart POST，下载走 GET。聊天元数据保存在本机 localStorage。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface Peer {
  peerId: string;
  displayName: string;
  deviceType: string;
  userAgent: string;
  isSelf: boolean;
}

export interface HistoricalPeer extends Peer {
  lastSeenAt: number;
}

export type ConversationMessage =
  | {
      kind: "text";
      id: string;
      from: string;
      text: string;
      ts: number;
    }
  | {
      kind: "file";
      id: string;
      from: string;
      token: string;
      name: string;
      size: number;
      mime?: string | null;
      ts: number;
      // 上传 / 下载进度（仅本地发送时使用）
      uploadProgress?: number;
      // 接收方保存到本地后的路径,设了之后按钮就不再可用
      savedPath?: string;
    };

export type ConnStatus = "offline" | "connecting" | "online";

interface UsePairDropClientArgs {
  /** 目标服务主机。默认连本机自身的服务；填局域网 IP 可"加入"另一台桌面端。 */
  host?: string;
  port: number | null;
  enabled: boolean;
  /** 历史记录分组键。本机服务使用固定键，避免服务端口变化时丢失历史。 */
  historyKey?: string;
}

interface EndpointHistory {
  peers: Record<string, HistoricalPeer>;
  conversations: Record<string, ConversationMessage[]>;
  selectedPeerId?: string | null;
}

interface PairDropHistory {
  version: 1;
  endpoints: Record<string, EndpointHistory>;
}

const HISTORY_STORAGE_KEY = "pairdrop:history:v1";
const DEVICE_ID_STORAGE_KEY = "pairdrop:device-id";
const MAX_MESSAGES_PER_PEER = 300;

function emptyHistory(): PairDropHistory {
  return { version: 1, endpoints: {} };
}

function loadHistory(): PairDropHistory {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return emptyHistory();
    const parsed = JSON.parse(raw) as PairDropHistory;
    if (parsed?.version !== 1 || !parsed.endpoints) return emptyHistory();
    return parsed;
  } catch (error) {
    console.warn("读取跨设备传输历史失败", error);
    return emptyHistory();
  }
}

function getDeviceId(): string {
  const saved = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (saved) return saved;
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `desktop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
  return id;
}

function getEndpoint(history: PairDropHistory, key: string): EndpointHistory {
  return history.endpoints[key] || { peers: {}, conversations: {} };
}

export function usePairDropClient({
  host = "127.0.0.1",
  port,
  enabled,
  historyKey,
}: UsePairDropClientArgs) {
  const [status, setStatus] = useState<ConnStatus>("offline");
  const [selfId, setSelfId] = useState<string | null>(null);
  const [selfName, setSelfName] = useState<string>("");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [history, setHistory] = useState<PairDropHistory>(loadHistory);
  const [unread, setUnread] = useState<Map<string, number>>(() => new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const historyRef = useRef(history);
  const persistTimerRef = useRef<number | null>(null);
  const endpointKey = historyKey || `${host}:${port || 0}`;
  const endpointKeyRef = useRef(endpointKey);

  useEffect(() => {
    endpointKeyRef.current = endpointKey;
    const endpoint = getEndpoint(history, endpointKey);
    setSelected(endpoint.selectedPeerId || null);
    selectedRef.current = endpoint.selectedPeerId || null;
    setUnread(new Map());
  }, [endpointKey]);

  useEffect(() => {
    historyRef.current = history;
    if (persistTimerRef.current) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
      } catch (error) {
        console.warn("保存跨设备传输历史失败", error);
      }
      persistTimerRef.current = null;
    }, 120);
  }, [history]);

  useEffect(
    () => () => {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
      }
      try {
        localStorage.setItem(
          HISTORY_STORAGE_KEY,
          JSON.stringify(historyRef.current)
        );
      } catch (error) {
        console.warn("保存跨设备传输历史失败", error);
      }
    },
    []
  );

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const wsBase = useMemo(() => {
    if (!port) return null;
    return `ws://${host}:${port}`;
  }, [host, port]);

  const apiBase = useMemo(() => {
    if (!port) return null;
    return `http://${host}:${port}`;
  }, [host, port]);
  const send = useCallback((msg: any) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  const updateEndpoint = useCallback(
    (updater: (current: EndpointHistory) => EndpointHistory) => {
      const key = endpointKeyRef.current;
      setHistory((prev) => ({
        ...prev,
        endpoints: {
          ...prev.endpoints,
          [key]: updater(getEndpoint(prev, key)),
        },
      }));
    },
    []
  );

  const appendMessage = useCallback(
    (peerId: string, message: ConversationMessage) => {
      updateEndpoint((current) => {
        const messages = [
          ...(current.conversations[peerId] || []),
          message,
        ].slice(-MAX_MESSAGES_PER_PEER);
        return {
          ...current,
          conversations: {
            ...current.conversations,
            [peerId]: messages,
          },
        };
      });
      if (selectedRef.current !== peerId) {
        setUnread((prev) => {
          const next = new Map(prev);
          next.set(peerId, (next.get(peerId) || 0) + 1);
          return next;
        });
      }
    },
    [updateEndpoint]
  );

  // 建立连接 + 自动重连
  useEffect(() => {
    if (!enabled || !wsBase) {
      // 主动断开
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null;
        ws.close();
        wsRef.current = null;
      }
      setPeers([]);
      setStatus("offline");
      return;
    }

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      setStatus("connecting");
      const query = new URLSearchParams({
        role: "desktop",
        clientId: getDeviceId(),
      });
      const url = `${wsBase}/ws?${query.toString()}`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        // 非法地址等会让 new WebSocket 同步抛错——捕获后转离线 + 重连，
        // 避免异常冒泡出 effect 导致整页崩溃（transparent 窗口下表现为"变透明"）。
        console.error("PairDrop: 无法建立连接", url, e);
        setStatus("offline");
        if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
        reconnectTimer.current = window.setTimeout(connect, 1500);
        return;
      }
      wsRef.current = ws;
      ws.addEventListener("open", () => {
        if (cancelled) return;
        setStatus("online");
        const savedName = localStorage.getItem("pairdrop:name");
        if (savedName) {
          ws.send(JSON.stringify({ type: "set-name", name: savedName }));
        }
      });
      ws.addEventListener("close", () => {
        if (cancelled) return;
        setStatus("offline");
        setPeers([]);
        wsRef.current = null;
        if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
        reconnectTimer.current = window.setTimeout(connect, 1500);
      });
      ws.addEventListener("error", () => {
        // 不做处理，close 会接管
      });
      ws.addEventListener("message", (e) => {
        if (typeof e.data !== "string") return;
        let msg: any;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        switch (msg.type) {
          case "welcome":
            setSelfId(msg.peerId);
            setSelfName(msg.displayName);
            break;
          case "peers":
            setPeers(msg.peers || []);
            updateEndpoint((current) => {
              const nextPeers = { ...current.peers };
              const now = Date.now();
              for (const peer of (msg.peers || []) as Peer[]) {
                if (peer.isSelf) continue;
                nextPeers[peer.peerId] = { ...peer, lastSeenAt: now };
              }
              return { ...current, peers: nextPeers };
            });
            break;
          case "text": {
            const m: ConversationMessage = {
              kind: "text",
              id: `${msg.from}-${msg.ts}-${Math.random().toString(36).slice(2, 6)}`,
              from: msg.from,
              text: msg.text,
              ts: msg.ts,
            };
            appendMessage(msg.from, m);
            break;
          }
          case "file": {
            const m: ConversationMessage = {
              kind: "file",
              id: `${msg.from}-${msg.ts}-${Math.random().toString(36).slice(2, 6)}`,
              from: msg.from,
              token: msg.token,
              name: msg.name,
              size: msg.size,
              mime: msg.mime,
              ts: msg.ts,
            };
            appendMessage(msg.from, m);
            break;
          }
          case "error":
            console.error("PairDrop error:", msg.message);
            break;
        }
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) {
        window.clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null;
        ws.close();
        wsRef.current = null;
      }
      setPeers([]);
    };
  }, [wsBase, enabled, appendMessage, updateEndpoint]);

  const selectPeer = useCallback((peerId: string | null) => {
    setSelected(peerId);
    selectedRef.current = peerId;
    updateEndpoint((current) => ({ ...current, selectedPeerId: peerId }));
    if (peerId) {
      setUnread((prev) => {
        if (!prev.has(peerId)) return prev;
        const next = new Map(prev);
        next.delete(peerId);
        return next;
      });
    }
  }, [updateEndpoint]);

  const sendText = useCallback(
    (to: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const ok = send({ type: "send-text", to, text: trimmed });
      if (!ok) return;
      const id = `self-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      appendMessage(to, {
        kind: "text",
        id,
        from: selfId || "self",
        text: trimmed,
        ts: Date.now(),
      });
    },
    [send, appendMessage, selfId]
  );

  const sendFile = useCallback(
    async (to: string, file: File) => {
      if (!apiBase) return;
      const localId = `self-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      appendMessage(to, {
        kind: "file",
        id: localId,
        from: selfId || "self",
        token: "",
        name: file.name,
        size: file.size,
        mime: file.type || null,
        ts: Date.now(),
        uploadProgress: 0,
      });

      try {
        const form = new FormData();
        form.append("to", to);
        form.append("file", file, file.name);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${apiBase}/api/upload`, true);
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const pct = Math.round((e.loaded / e.total) * 100);
          updateEndpoint((current) => {
            const arr = current.conversations[to];
            if (!arr) return current;
            return {
              ...current,
              conversations: {
                ...current.conversations,
                [to]: arr.map((m) =>
                  m.kind === "file" && m.id === localId
                    ? { ...m, uploadProgress: pct }
                    : m
                ),
              },
            };
          });
        };
        const result = await new Promise<{ token: string }>((resolve, reject) => {
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch (e) {
                reject(e);
              }
            } else if (xhr.status === 413) {
              reject(new Error("文件超过服务端上限"));
            } else {
              reject(new Error("上传失败: HTTP " + xhr.status));
            }
          };
          xhr.onerror = () => reject(new Error("网络中断,请检查端口是否仍然开放"));
          xhr.ontimeout = () => reject(new Error("上传超时"));
          xhr.send(form);
        });

        send({
          type: "notify-file",
          to,
          token: result.token,
          name: file.name,
          size: file.size,
          mime: file.type || null,
        });

        updateEndpoint((current) => {
          const arr = current.conversations[to];
          if (!arr) return current;
          return {
            ...current,
            conversations: {
              ...current.conversations,
              [to]: arr.map((m) =>
                m.kind === "file" && m.id === localId
                  ? { ...m, token: result.token, uploadProgress: 100 }
                  : m
              ),
            },
          };
        });
      } catch (err) {
        console.error("send file failed", err);
        updateEndpoint((current) => {
          const arr = current.conversations[to];
          if (!arr) return current;
          return {
            ...current,
            conversations: {
              ...current.conversations,
              [to]: arr.filter(
                (m) => !(m.kind === "file" && m.id === localId)
              ),
            },
          };
        });
        throw err;
      }
    },
    [apiBase, appendMessage, selfId, send, updateEndpoint]
  );

  const updateSelfName = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      localStorage.setItem("pairdrop:name", trimmed);
      send({ type: "set-name", name: trimmed });
      setSelfName(trimmed);
    },
    [send]
  );

  const markFileSaved = useCallback((messageId: string, savedPath: string) => {
    updateEndpoint((current) => {
      const next = { ...current.conversations };
      let touched = false;
      for (const [peerId, arr] of Object.entries(current.conversations)) {
        let changed = false;
        const updated = arr.map((m) => {
          if (m.kind === "file" && m.id === messageId) {
            changed = true;
            return { ...m, savedPath };
          }
          return m;
        });
        if (changed) {
          next[peerId] = updated;
          touched = true;
        }
      }
      return touched ? { ...current, conversations: next } : current;
    });
  }, [updateEndpoint]);

  const endpoint = getEndpoint(history, endpointKey);
  const conversations = useMemo(
    () => new Map(Object.entries(endpoint.conversations)),
    [endpoint.conversations]
  );
  const knownPeers = useMemo(
    () =>
      Object.values(endpoint.peers).sort((a, b) => b.lastSeenAt - a.lastSeenAt),
    [endpoint.peers]
  );

  return {
    status,
    selfId,
    selfName,
    peers,
    knownPeers,
    selected,
    selectPeer,
    conversations,
    unread,
    sendText,
    sendFile,
    updateSelfName,
    markFileSaved,
    apiBase,
  };
}
