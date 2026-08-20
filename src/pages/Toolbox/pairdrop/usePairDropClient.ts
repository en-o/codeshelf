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
      /** 中转缓存已被领取并删除。token 同时会被清空,两端都不该再指向中转副本。 */
      taken?: boolean;
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
/** 与后端 MAX_FILE_SIZE 保持一致（服务端落盘中转，超了会直接 413）。 */
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;
/** 多久没有新的进度事件就判定这次上传已经死了（服务端提前应答/对方掉线都表现为卡住不动）。 */
const UPLOAD_STALL_MS = 30_000;

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

/**
 * 只写回**自己这个 endpoint** 的那一段，而不是整份 history。
 *
 * 本地端和远端各有一个 hook 实例，各自在挂载时读了一份 history 到 state，
 * 又各自把**整份**写回同一个 localStorage key —— 后写的那个会把先写的
 * 另一端数据整个抹掉（聊天记录、已选设备都没了）。
 *
 * 改成「落盘前重新读一次，只替换 endpoints[自己的 key]」：
 * 两端互不覆盖，也不需要引入共享 store。
 */
function persistEndpoint(key: string, endpoint: EndpointHistory) {
  try {
    const current = loadHistory(); // 重新读，拿到另一端可能刚写入的内容
    current.endpoints[key] = endpoint;
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(current));
  } catch (error) {
    console.warn("保存跨设备传输历史失败", error);
  }
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
      persistEndpoint(endpointKeyRef.current, getEndpoint(history, endpointKeyRef.current));
      persistTimerRef.current = null;
    }, 120);
  }, [history]);

  useEffect(
    () => () => {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
      }
      // 卸载时把最后一次改动落盘（debounce 可能还没触发）
      persistEndpoint(
        endpointKeyRef.current,
        getEndpoint(historyRef.current, endpointKeyRef.current)
      );
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

  /**
   * 更新某个 endpoint 的历史。
   *
   * `forKey` 用于把一次长耗时操作（文件上传）**绑定**到它开始时的 endpoint：
   * 不传就用当前 endpoint。上传中途用户切了房间的话，进度回调和最终结果
   * 会落到新房间的会话里 —— 文件串房、进度条挂在错误的对话上。
   */
  const updateEndpoint = useCallback(
    (updater: (current: EndpointHistory) => EndpointHistory, forKey?: string) => {
      const key = forKey ?? endpointKeyRef.current;
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
    (peerId: string, message: ConversationMessage, forKey?: string) => {
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
      }, forKey);
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
          // 中转缓存已被一次性消费：两端同时清掉 token。
          // 留着 token 的话，发送方点"保存"只会拿到 404，接收方也可能重复下载已删除的副本。
          case "file-taken": {
            updateEndpoint((current) => {
              const next: Record<string, ConversationMessage[]> = {};
              let touched = false;
              for (const [peerId, arr] of Object.entries(current.conversations)) {
                let changed = false;
                const updated = arr.map((m) => {
                  if (m.kind === "file" && m.token && m.token === msg.token) {
                    changed = true;
                    return { ...m, token: "", taken: true };
                  }
                  return m;
                });
                next[peerId] = changed ? updated : arr;
                touched = touched || changed;
              }
              return touched ? { ...current, conversations: next } : current;
            });
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

  /** 删除某个设备的会话：历史条目 + 聊天记录一起清掉（设备仍在线的话会重新出现在列表里）。 */
  const removePeer = useCallback(
    (peerId: string) => {
      updateEndpoint((current) => {
        const peers = { ...current.peers };
        delete peers[peerId];
        const conversations = { ...current.conversations };
        delete conversations[peerId];
        return {
          ...current,
          peers,
          conversations,
          selectedPeerId:
            current.selectedPeerId === peerId ? null : current.selectedPeerId,
        };
      });
      setUnread((prev) => {
        if (!prev.has(peerId)) return prev;
        const next = new Map(prev);
        next.delete(peerId);
        return next;
      });
      setSelected((prev) => (prev === peerId ? null : prev));
      if (selectedRef.current === peerId) selectedRef.current = null;
    },
    [updateEndpoint]
  );

  const sendText = useCallback(
    (to: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // 超长文本按码点切分成多条依次发送(服务端单条上限 256KB,60000 码点 * 4 字节 < 上限);
      // 用 Array.from 按码点切,避免把 emoji 等代理对从中间截断。
      const CHUNK = 60000;
      const chars = trimmed.length > CHUNK ? Array.from(trimmed) : null;
      const parts = chars
        ? Array.from({ length: Math.ceil(chars.length / CHUNK) }, (_, i) =>
            chars.slice(i * CHUNK, (i + 1) * CHUNK).join("")
          )
        : [trimmed];
      for (const part of parts) {
        const ok = send({ type: "send-text", to, text: part });
        if (!ok) return;
        appendMessage(to, {
          kind: "text",
          id: `self-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          from: selfId || "self",
          text: part,
          ts: Date.now(),
        });
      }
    },
    [send, appendMessage, selfId]
  );

  const sendFile = useCallback(
    async (to: string, file: File) => {
      if (!apiBase) return;
      // 超限的话在这里就说清楚。以前是把整个文件推给服务端，撞上上限后连接被截断，
      // 进度条永远停在半路（见 issue #55 的 82%）。
      if (file.size > MAX_FILE_SIZE) {
        throw new Error(`文件超过 ${MAX_FILE_SIZE / 1024 / 1024 / 1024}GB 上限`);
      }
      // ponytail: 用「多久没进展」而不是总时长做超时，10GB 的慢速上传不会被误杀
      // 一次上传从开始到结束绑定同一个 endpoint 和同一个 apiBase。
      // 大文件上传可能持续很久，期间用户完全可能切到另一个房间。
      const boundKey = endpointKeyRef.current;
      const boundApiBase = apiBase;
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
      }, boundKey);

      try {
        const form = new FormData();
        // to / from 必须排在 file 之前：服务端在开始读文件内容前就要能判断这次上传是否被授权
        form.append("to", to);
        form.append("from", selfId || "");
        form.append("file", file, file.name);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${boundApiBase}/api/upload`, true);
        if (selfId) xhr.setRequestHeader("x-peer-id", selfId);
        // 服务端一旦提前应答（无权限 / 缓存已满）就不再读 body，WebView 里的表现是
        // 进度条停在半路、onload/onerror 都不来。用停滞看门狗把它变成一条明确的失败。
        let stallTimer: number | undefined;
        const armStall = () => {
          if (stallTimer) window.clearTimeout(stallTimer);
          stallTimer = window.setTimeout(() => xhr.abort(), UPLOAD_STALL_MS);
        };
        const disarmStall = () => {
          if (stallTimer) window.clearTimeout(stallTimer);
          stallTimer = undefined;
        };
        armStall();
        xhr.upload.onprogress = (e) => {
          armStall();
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
          }, boundKey);
        };
        const result = await new Promise<{ token: string }>((resolve, reject) => {
          xhr.onload = () => {
            disarmStall();
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch (e) {
                reject(e);
              }
            } else if (xhr.status === 413) {
              reject(new Error("文件超过服务端上限"));
            } else {
              // 服务端的 JSON 里有具体原因（无权限 / 缓存已满 / 并发已满），别吞掉
              let detail = "";
              try {
                detail = JSON.parse(xhr.responseText)?.error || "";
              } catch {
                /* 非 JSON 响应，按状态码报 */
              }
              reject(new Error(detail || "上传失败: HTTP " + xhr.status));
            }
          };
          xhr.onerror = () => {
            disarmStall();
            reject(new Error("网络中断,请检查端口是否仍然开放"));
          };
          xhr.onabort = () =>
            reject(
              new Error(
                `上传停滞超过 ${UPLOAD_STALL_MS / 1000} 秒已中断，通常是对方已离线或服务已停止`
              )
            );
          xhr.ontimeout = () => {
            disarmStall();
            reject(new Error("上传超时"));
          };
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
        }, boundKey);
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
        }, boundKey);
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
    removePeer,
    conversations,
    unread,
    sendText,
    sendFile,
    updateSelfName,
    markFileSaved,
    apiBase,
  };
}
