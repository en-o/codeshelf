// PairDrop 客户端 hook
//
// 桌面端的 React UI 也是一个 WebSocket 客户端，复用同样的协议跟浏览器对等。
// 文件上传走 HTTP multipart POST，下载走 GET。所有数据只放内存。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface Peer {
  peerId: string;
  displayName: string;
  deviceType: string;
  userAgent: string;
  isSelf: boolean;
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
}

export function usePairDropClient({ host = "127.0.0.1", port, enabled }: UsePairDropClientArgs) {
  const [status, setStatus] = useState<ConnStatus>("offline");
  const [selfId, setSelfId] = useState<string | null>(null);
  const [selfName, setSelfName] = useState<string>("");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [conversations, setConversations] = useState<
    Map<string, ConversationMessage[]>
  >(() => new Map());
  const [unread, setUnread] = useState<Map<string, number>>(() => new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);

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

  const appendMessage = useCallback(
    (peerId: string, message: ConversationMessage) => {
      setConversations((prev) => {
        const next = new Map(prev);
        const arr = next.get(peerId) || [];
        next.set(peerId, [...arr, message]);
        return next;
      });
      if (selectedRef.current !== peerId) {
        setUnread((prev) => {
          const next = new Map(prev);
          next.set(peerId, (next.get(peerId) || 0) + 1);
          return next;
        });
      }
    },
    []
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
      setStatus("offline");
      return;
    }

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      setStatus("connecting");
      const url = `${wsBase}/ws?role=desktop`;
      const ws = new WebSocket(url);
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
    };
  }, [wsBase, enabled, appendMessage]);

  const selectPeer = useCallback((peerId: string | null) => {
    setSelected(peerId);
    if (peerId) {
      setUnread((prev) => {
        if (!prev.has(peerId)) return prev;
        const next = new Map(prev);
        next.delete(peerId);
        return next;
      });
    }
  }, []);

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
          setConversations((prev) => {
            const arr = prev.get(to);
            if (!arr) return prev;
            const updated = arr.map((m) =>
              m.kind === "file" && m.id === localId
                ? { ...m, uploadProgress: pct }
                : m
            );
            const next = new Map(prev);
            next.set(to, updated);
            return next;
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

        setConversations((prev) => {
          const arr = prev.get(to);
          if (!arr) return prev;
          const updated = arr.map((m) =>
            m.kind === "file" && m.id === localId
              ? { ...m, token: result.token, uploadProgress: 100 }
              : m
          );
          const next = new Map(prev);
          next.set(to, updated);
          return next;
        });
      } catch (err) {
        console.error("send file failed", err);
        setConversations((prev) => {
          const arr = prev.get(to);
          if (!arr) return prev;
          const updated = arr.filter(
            (m) => !(m.kind === "file" && m.id === localId)
          );
          const next = new Map(prev);
          next.set(to, updated);
          return next;
        });
        throw err;
      }
    },
    [apiBase, appendMessage, selfId, send]
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
    setConversations((prev) => {
      const next = new Map(prev);
      let touched = false;
      for (const [peerId, arr] of prev.entries()) {
        let changed = false;
        const updated = arr.map((m) => {
          if (m.kind === "file" && m.id === messageId) {
            changed = true;
            return { ...m, savedPath };
          }
          return m;
        });
        if (changed) {
          next.set(peerId, updated);
          touched = true;
        }
      }
      return touched ? next : prev;
    });
  }, []);

  return {
    status,
    selfId,
    selfName,
    peers,
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
