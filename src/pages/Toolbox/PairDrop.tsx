import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  Send,
  Paperclip,
  Radio,
  QrCode,
  Smartphone,
  Monitor,
  Globe,
  Power,
  ChevronLeft,
  Save,
  Copy,
  FolderOpen,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { ToolPanelHeader } from "./index";
import { Button, showToast } from "@/components/ui";
import { LoadingSpinner, ErrorBoundary } from "@/components/common";
import {
  pairdropStart,
  pairdropStop,
  pairdropStatus,
  pairdropDiscovered,
  pairdropSaveFile,
  pairdropDownloadSave,
  formatBytes,
} from "@/services/toolbox";
import { openInExplorer } from "@/services/db";
import type {
  PairDropDiscoveredDevice,
  PairDropServiceStatus,
} from "@/types/toolbox";
import {
  usePairDropClient,
  type HistoricalPeer,
  type Peer,
} from "./pairdrop/usePairDropClient";
import { UrlsModal } from "./pairdrop/UrlsModal";

interface PairDropProps {
  onBack: () => void;
}

/** 跨设备传输默认端口（与后端 DEFAULT_PORT 保持一致）；加入对方桌面端时未填端口用它兜底 */
const DEFAULT_PAIRDROP_PORT = 8421;
const REMOTE_TARGETS_STORAGE_KEY = "pairdrop:remote-targets";
const PEER_ALIASES_STORAGE_KEY = "pairdrop:peer-aliases";
const LOCAL_ROOM_ID = "local";

interface RemoteTarget {
  host: string;
  port: number;
  deviceId?: string;
  displayName?: string;
}

type ContextMenuState =
  | { kind: "local"; x: number; y: number }
  | { kind: "remote"; x: number; y: number; target: RemoteTarget }
  | { kind: "peer"; x: number; y: number; peer: HistoricalPeer };

/** 解析"加入其他桌面端"输入：支持 "192.168.1.5"、"192.168.1.5:8421"、"http://192.168.1.5:8421" */
function parseJoinTarget(v: string): RemoteTarget | null {
  // 去掉协议头和路径/末尾斜杠
  const s = v.trim().replace(/^[a-zA-Z][\w+.-]*:\/\//, "").replace(/\/.*$/, "");
  if (!s) return null;
  const idx = s.lastIndexOf(":");
  const host = idx > 0 ? s.slice(0, idx) : s;
  const port = idx > 0 ? parseInt(s.slice(idx + 1), 10) : DEFAULT_PAIRDROP_PORT;
  // host 只允许 IPv4 / 主机名字符（含空格/非法字符一律拒，避免拼出非法 ws:// 导致崩溃）
  if (!host || !/^[a-zA-Z0-9.\-]+$/.test(host)) return null;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port };
}

function remoteRoomId(target: RemoteTarget): string {
  if (target.deviceId) return `device:${target.deviceId}`;
  return `remote:${target.host}:${target.port}`;
}

function remoteLabel(target: RemoteTarget): string {
  if (target.displayName) return target.displayName;
  return `${target.host}:${target.port}`;
}

function loadRemoteTargets(): RemoteTarget[] {
  try {
    const raw = localStorage.getItem(REMOTE_TARGETS_STORAGE_KEY);
    if (!raw) return [];
    const values = JSON.parse(raw) as Array<{
      host?: string;
      port?: number;
      deviceId?: string;
      displayName?: string;
    }>;
    if (!Array.isArray(values)) return [];
    return values.filter(
      (value): value is RemoteTarget =>
        !!value.host &&
        Number.isInteger(value.port) &&
        value.port! > 0 &&
        value.port! <= 65535
    );
  } catch {
    return [];
  }
}

function saveRemoteTargets(targets: RemoteTarget[]) {
  localStorage.setItem(REMOTE_TARGETS_STORAGE_KEY, JSON.stringify(targets));
}

function loadPeerAliases(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PEER_ALIASES_STORAGE_KEY);
    if (!raw) return {};
    const aliases = JSON.parse(raw) as Record<string, string>;
    return aliases && typeof aliases === "object" ? aliases : {};
  } catch {
    return {};
  }
}

function savePeerAliases(aliases: Record<string, string>) {
  localStorage.setItem(PEER_ALIASES_STORAGE_KEY, JSON.stringify(aliases));
}

function targetFromDiscovery(device: PairDropDiscoveredDevice): RemoteTarget {
  return {
    host: device.host,
    port: device.port,
    deviceId: device.deviceId,
    displayName: device.displayName,
  };
}

function isSameRemoteTarget(a: RemoteTarget, b: RemoteTarget): boolean {
  if (a.deviceId && b.deviceId) return a.deviceId === b.deviceId;
  return a.host === b.host && a.port === b.port;
}

export function PairDrop({ onBack }: PairDropProps) {
  const [serviceStatus, setServiceStatus] = useState<PairDropServiceStatus | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [showUrls, setShowUrls] = useState(false);

  const refresh = async () => {
    try {
      const s = await pairdropStatus();
      setServiceStatus(s);
    } catch (e) {
      console.error("pairdrop status failed", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      // 进入工具时如果未启动则自动启动；如果已启动则保持
      try {
        const s = await pairdropStatus();
        if (!s.running) {
          const started = await pairdropStart();
          setServiceStatus(started);
        } else {
          setServiceStatus(s);
        }
      } catch (e) {
        showToast("error", e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 周期刷新 peer 计数（WebSocket 已经实时更新 peers，这里主要刷新 urls/state）
  useEffect(() => {
    if (!serviceStatus?.running) return;
    const t = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    return () => clearInterval(t);
  }, [serviceStatus?.running]);

  const handleToggle = async () => {
    if (!serviceStatus) return;
    setLoading(true);
    try {
      if (serviceStatus.running) {
        await pairdropStop();
        showToast("info", "服务已停止");
      } else {
        await pairdropStart();
        showToast("success", "服务已启动");
      }
      await refresh();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-white dark:bg-gray-900">
      <ToolPanelHeader
        title="跨设备传输"
        icon={Radio}
        onBack={onBack}
        beta
        actions={
          <div className="flex items-center gap-2">
            {serviceStatus?.running && (
              <Button
                onClick={() => setShowUrls(true)}
                variant="secondary"
                size="sm"
              >
                <QrCode size={14} className="mr-1.5" />
                扫码加入
              </Button>
            )}
            <Button
              onClick={handleToggle}
              variant={serviceStatus?.running ? "secondary" : "primary"}
              size="sm"
              disabled={loading}
            >
              <Power size={14} className="mr-1.5" />
              {serviceStatus?.running ? "停止服务" : "启动服务"}
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-hidden min-h-0">
        {loading && !serviceStatus ? (
          <div className="flex items-center justify-center h-full">
            <LoadingSpinner size={32} label="正在启动服务..." />
          </div>
        ) : !serviceStatus?.running ? (
          <ServiceOffline onToggle={handleToggle} loading={loading} />
        ) : (
          <ErrorBoundary label="跨设备传输页面出错（可点重试恢复）">
            <ChatWorkspace
              port={serviceStatus.port}
              onShowUrls={() => setShowUrls(true)}
            />
          </ErrorBoundary>
        )}
      </div>

      {showUrls && serviceStatus && (
        <UrlsModal
          urls={serviceStatus.urls}
          onClose={() => setShowUrls(false)}
          onToast={(m, t) => showToast((t || "info") as any, m)}
        />
      )}
    </div>
  );
}

function ServiceOffline({
  onToggle,
  loading,
}: {
  onToggle: () => void;
  loading: boolean;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-6">
      <Radio size={56} className="text-gray-300 dark:text-gray-600 mb-4" />
      <h3 className="text-base font-semibold mb-1">跨设备传输未启动</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md leading-relaxed mb-6">
        启动后会在本机开启一个局域网服务，其他设备扫码或访问地址即可加入，
        实现一对一文字 / 文件互发。聊天历史仅保存在本机，文件内容只在内存中转，不上云。
      </p>
      <Button onClick={onToggle} variant="primary" disabled={loading}>
        <Power size={14} className="mr-1.5" />
        启动服务
      </Button>
    </div>
  );
}

function ChatWorkspace({
  port,
  onShowUrls,
}: {
  port: number;
  onShowUrls: () => void;
}) {
  const [remoteTargets, setRemoteTargets] = useState<RemoteTarget[]>(
    loadRemoteTargets
  );
  const [activeRoomId, setActiveRoomId] = useState(LOCAL_ROOM_ID);
  const [disabledRooms, setDisabledRooms] = useState<Record<string, boolean>>({});
  const [discoveredDevices, setDiscoveredDevices] = useState<
    PairDropDiscoveredDevice[]
  >([]);
  const [joinInput, setJoinInput] = useState("");
  const [peerAliases, setPeerAliases] = useState<Record<string, string>>(
    loadPeerAliases
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const activeRemoteTarget = remoteTargets.find(
    (target) => remoteRoomId(target) === activeRoomId
  ) || null;
  const localClient = usePairDropClient({
    host: "127.0.0.1",
    port,
    enabled: !disabledRooms[LOCAL_ROOM_ID],
    historyKey: LOCAL_ROOM_ID,
  });
  const remoteClient = usePairDropClient({
    host: activeRemoteTarget?.host ?? "127.0.0.1",
    port: activeRemoteTarget?.port ?? null,
    enabled: !!activeRemoteTarget && !disabledRooms[activeRoomId],
    historyKey: activeRemoteTarget ? remoteRoomId(activeRemoteTarget) : "remote:none",
  });
  const client = activeRemoteTarget ? remoteClient : localClient;
  const currentRoomId = activeRemoteTarget
    ? remoteRoomId(activeRemoteTarget)
    : LOCAL_ROOM_ID;
  const currentRoomDisabled = !!disabledRooms[currentRoomId];
  const currentRoomIsRemote = !!activeRemoteTarget;
  const localRoomDisabled = !!disabledRooms[LOCAL_ROOM_ID];
  const [draft, setDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const refreshDiscovered = async () => {
      try {
        const devices = await pairdropDiscovered();
        if (cancelled) return;
        setDiscoveredDevices(devices);
        if (devices.length === 0) return;
        setRemoteTargets((prev) => {
          let changed = false;
          const next = [...prev];
          for (const device of devices) {
            const target = targetFromDiscovery(device);
            const index = next.findIndex((item) => isSameRemoteTarget(item, target));
            const previous = index >= 0 ? next[index] : null;
            const merged = {
              ...previous,
              ...target,
              displayName: previous?.displayName || target.displayName,
            };
            if (
              !previous ||
              previous.deviceId !== target.deviceId ||
              previous.displayName !== merged.displayName ||
              previous.host !== target.host ||
              previous.port !== target.port
            ) {
              changed = true;
            }
            if (index >= 0) {
              next[index] = merged;
            } else {
              next.unshift(target);
            }
          }
          if (!changed) return prev;
          const saved = next.slice(0, 16);
          saveRemoteTargets(saved);
          return saved;
        });
      } catch (error) {
        console.warn("读取跨设备发现列表失败", error);
      }
    };
    refreshDiscovered();
    const timer = window.setInterval(() => { if (!document.hidden) refreshDiscovered(); }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const handleJoin = () => {
    const target = parseJoinTarget(joinInput);
    if (!target) {
      showToast("error", "地址格式不对，示例：192.168.1.5:8421");
      return;
    }
    const roomId = remoteRoomId(target);
    setRemoteTargets((prev) => {
      const next = [
        target,
        ...prev.filter((item) => !isSameRemoteTarget(item, target)),
      ].slice(0, 8);
      saveRemoteTargets(next);
      return next;
    });
    setDisabledRooms((prev) => ({ ...prev, [roomId]: false }));
    setActiveRoomId(roomId);
    setJoinInput("");
  };

  const updateRemoteTarget = (
    target: RemoteTarget,
    updater: (current: RemoteTarget) => RemoteTarget
  ) => {
    setRemoteTargets((prev) => {
      const next = prev.map((item) => {
        if (!isSameRemoteTarget(item, target)) return item;
        return updater(item);
      });
      saveRemoteTargets(next);
      return next;
    });
  };

  const handleRenameRemote = (target: RemoteTarget) => {
    const name = window.prompt("重命名这个连接", remoteLabel(target));
    if (name === null) return;
    const displayName = name.trim();
    if (!displayName) return;
    updateRemoteTarget(target, (current) => ({ ...current, displayName }));
  };

  const handleEditRemoteAddress = (target: RemoteTarget) => {
    const value = window.prompt(
      "修改连接地址",
      `${target.host}:${target.port}`
    );
    if (value === null) return;
    const parsed = parseJoinTarget(value);
    if (!parsed) {
      showToast("error", "地址格式不对，示例：192.168.1.5:8421");
      return;
    }
    const oldRoomId = remoteRoomId(target);
    const nextTarget: RemoteTarget = {
      ...target,
      host: parsed.host,
      port: parsed.port,
      deviceId: target.deviceId,
    };
    updateRemoteTarget(target, () => nextTarget);
    if (activeRoomId === oldRoomId) {
      setActiveRoomId(remoteRoomId(nextTarget));
    }
    setDisabledRooms((prev) => {
      const next = { ...prev };
      if (oldRoomId !== remoteRoomId(nextTarget)) {
        delete next[oldRoomId];
      }
      next[remoteRoomId(nextTarget)] = false;
      return next;
    });
  };

  const handleRenamePeer = (peer: HistoricalPeer) => {
    const name = window.prompt("重命名这个设备", peerAliases[peer.peerId] || peer.displayName);
    if (name === null) return;
    const displayName = name.trim();
    setPeerAliases((prev) => {
      const next = { ...prev };
      if (displayName) next[peer.peerId] = displayName;
      else delete next[peer.peerId];
      savePeerAliases(next);
      return next;
    });
  };

  const handleRenameLocal = () => {
    const name = window.prompt("重命名本机", localClient.selfName || "");
    if (name === null) return;
    const displayName = name.trim();
    if (displayName) localClient.updateSelfName(displayName);
  };

  const handleOpenContextMenu = (menu: ContextMenuState) => {
    setContextMenu(menu);
  };

  const handleSelectRoom = (roomId: string) => {
    setDraft("");
    setActiveRoomId(roomId);
  };

  const handleBackToLocal = () => {
    setDraft("");
    setActiveRoomId(LOCAL_ROOM_ID);
    setShowSidebarOnMobile(true);
  };

  const handleToggleCurrentRoom = () => {
    setDisabledRooms((prev) => ({
      ...prev,
      [currentRoomId]: !prev[currentRoomId],
    }));
  };

  const handleToggleLocalRoom = () => {
    setDisabledRooms((prev) => ({
      ...prev,
      [LOCAL_ROOM_ID]: !prev[LOCAL_ROOM_ID],
    }));
  };

  const handleReconnectCurrentRoom = () => {
    setDisabledRooms((prev) => ({ ...prev, [currentRoomId]: true }));
    window.setTimeout(() => {
      setDisabledRooms((prev) => ({ ...prev, [currentRoomId]: false }));
    }, 50);
  };

  const handleForgetRemote = (target: RemoteTarget) => {
    const roomId = remoteRoomId(target);
    setRemoteTargets((prev) => {
      const next = prev.filter((item) => remoteRoomId(item) !== roomId);
      saveRemoteTargets(next);
      return next;
    });
    setDisabledRooms((prev) => {
      const next = { ...prev };
      delete next[roomId];
      return next;
    });
    if (activeRoomId === roomId) {
      setActiveRoomId(LOCAL_ROOM_ID);
    }
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [contextMenu]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [showSidebarOnMobile, setShowSidebarOnMobile] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const onlinePeers = client.peers.filter((p) => !p.isSelf);
  const onlinePeerIds = new Set(onlinePeers.map((p) => p.peerId));
  const rawPeers: HistoricalPeer[] = [
    ...onlinePeers.map((peer) => ({
      ...peer,
      lastSeenAt:
        client.knownPeers.find((known) => known.peerId === peer.peerId)
          ?.lastSeenAt ||
        Date.now(),
    })),
    ...client.knownPeers.filter((peer) => !onlinePeerIds.has(peer.peerId)),
  ];
  const peers: HistoricalPeer[] = rawPeers.map((peer) => ({
    ...peer,
    displayName: peerAliases[peer.peerId] || peer.displayName,
  }));
  const selectedPeer = peers.find((p) => p.peerId === client.selected) || null;
  const selectedPeerOnline =
    !currentRoomDisabled && !!selectedPeer && onlinePeerIds.has(selectedPeer.peerId);
  const messages = client.selected ? client.conversations.get(client.selected) || [] : [];
  const discoveredRoomIds = new Set(
    discoveredDevices.map((device) => remoteRoomId(targetFromDiscovery(device)))
  );
  const visibleRemoteTargets = [...remoteTargets].sort(
    (a, b) =>
      Number(discoveredRoomIds.has(remoteRoomId(b))) -
      Number(discoveredRoomIds.has(remoteRoomId(a)))
  );
  const hasListItems = peers.length > 0 || visibleRemoteTargets.length > 0;

  useEffect(() => {
    if (currentRoomDisabled || client.selected) return;
    const firstOnline = onlinePeers.find((peer) => !peer.isSelf);
    if (firstOnline) {
      client.selectPeer(firstOnline.peerId);
      setShowSidebarOnMobile(false);
    }
  }, [currentRoomId, currentRoomDisabled, client.selected, onlinePeers, client]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, client.selected]);

  useEffect(() => {
    if (selectedPeer) setShowSidebarOnMobile(false);
  }, [selectedPeer?.peerId]);

  const handleSendText = () => {
    if (!client.selected || !selectedPeerOnline || !draft.trim()) return;
    client.sendText(client.selected, draft);
    setDraft("");
  };

  const handleSelectFile = () => fileInputRef.current?.click();

  const handleFilesChosen = async (files: FileList | null) => {
    if (!files || !client.selected || !selectedPeerOnline) return;
    for (const file of Array.from(files)) {
      try {
        await client.sendFile(client.selected, file);
      } catch (e) {
        showToast("error", "发送 " + file.name + " 失败: " + (e instanceof Error ? e.message : String(e)));
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragOver(false);
    if (!client.selected) {
      showToast("error", "请先选择一个设备");
      return;
    }
    const files = e.dataTransfer.files;
    if (files.length) await handleFilesChosen(files);
  };

  // 只在拖入「文件」时显示遮罩 — dragenter / dragleave 计数避免子元素冒泡导致闪烁
  const isFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types || []).includes("Files");
  const handleDragEnter = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    dragCounterRef.current += 1;
    setDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setDragOver(false);
  };

  const handleSaveFile = async (token: string, suggestedName: string, messageId: string) => {
    if (!token) return;
    try {
      const path = await saveDialog({
        title: "保存到本地",
        defaultPath: suggestedName,
      });
      if (!path) return;
      // 加入了对方桌面端时，文件缓存在对方服务上，走后端 HTTP 拉取写盘（无 fs scope 限制）；
      // 连本机自身服务时直接从本机内存缓存写盘。
      const bytes =
        currentRoomIsRemote && client.apiBase
          ? await pairdropDownloadSave(
              `${client.apiBase}/api/file/${encodeURIComponent(token)}`,
              path
            )
          : await pairdropSaveFile(token, path);
      showToast("success", `已保存 ${formatBytes(bytes)} → ${path}`);
      client.markFileSaved(messageId, path);
    } catch (e) {
      showToast("error", "保存失败: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleCopySavedPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      showToast("success", "已复制存储地址");
    } catch (e) {
      showToast("error", "复制失败: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleCopyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("success", "已复制");
    } catch (e) {
      showToast("error", "复制失败: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleOpenSavedPath = async (path: string) => {
    try {
      await openInExplorer(path);
    } catch (e) {
      showToast("error", "打开失败: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div
      className="flex h-full min-h-0 overflow-hidden relative"
      onDragOver={(e) => {
        if (isFileDrag(e)) e.preventDefault();
      }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="absolute inset-0 z-30 bg-blue-500/15 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <div className="bg-white dark:bg-gray-800 border-2 border-dashed border-blue-500 rounded-2xl px-10 py-8 text-blue-500 text-base font-medium flex flex-col items-center gap-2 shadow-xl">
            <Paperclip size={32} />
            {client.selected
              ? `松开发送给 ${selectedPeer?.displayName || "..."}`
              : "请先在左侧选择一个设备"}
          </div>
        </div>
      )}
      {/* Sidebar */}
      <aside
        className={`w-64 min-w-[220px] h-full flex-shrink-0 overflow-hidden bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col ${
          !showSidebarOnMobile ? "max-md:hidden" : ""
        }`}
      >
        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg bg-gray-50 dark:bg-gray-900">
            <Avatar
              label={avatarLabel(localClient.selfName || "?")}
              color={avatarColor(localClient.selfId || "self")}
              size={32}
            />
            <div className="flex-1 min-w-0">
              {editingName ? (
                <input
                  className="w-full text-sm font-medium bg-transparent border-none outline-none p-0 text-gray-900 dark:text-gray-100"
                  value={nameDraft}
                  autoFocus
                  maxLength={32}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => {
                    if (nameDraft.trim()) localClient.updateSelfName(nameDraft);
                    setEditingName(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (nameDraft.trim()) localClient.updateSelfName(nameDraft);
                      setEditingName(false);
                    } else if (e.key === "Escape") {
                      setEditingName(false);
                    }
                  }}
                />
              ) : (
                <button
                  className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate block max-w-full text-left hover:text-blue-500 transition-colors"
                  onClick={() => {
                    setNameDraft(localClient.selfName);
                    setEditingName(true);
                  }}
                  title="点击修改名称"
                >
                  {localClient.selfName || "（未命名）"}
                </button>
              )}
              <div className="flex items-center gap-1 text-[11px] mt-0.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    localClient.status === "online"
                      ? "bg-green-500"
                      : localClient.status === "connecting"
                      ? "bg-orange-500"
                      : "bg-red-500"
                  }`}
                />
                <span className="text-gray-500 dark:text-gray-400">
                  {localClient.status === "online"
                    ? "在线"
                    : localClient.status === "connecting"
                    ? "连接中…"
                    : "已断开"}
                </span>
              </div>
            </div>
            <button
              onClick={handleToggleLocalRoom}
              className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center text-gray-500 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title={localRoomDisabled ? "重新连接本机入口" : "断开本机入口"}
            >
              {localRoomDisabled ? <Wifi size={15} /> : <WifiOff size={15} />}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <LocalScopeItem
            active={currentRoomId === LOCAL_ROOM_ID}
            online={!disabledRooms[LOCAL_ROOM_ID] && localClient.status === "online"}
            onClick={handleBackToLocal}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleOpenContextMenu({
                kind: "local",
                x: event.clientX,
                y: event.clientY,
              });
            }}
          />
          {!hasListItems ? (
            <div className="p-8 text-center text-gray-400">
              <div className="text-3xl mb-2">👥</div>
              <p className="text-sm leading-relaxed">
                {currentRoomIsRemote ? "远端房间暂无在线设备" : "等待其他设备连接…"}
                <br />
                <span className="text-xs">
                  {currentRoomIsRemote
                    ? "可切回本机房间，或确认远端地址和防火墙"
                    : "点击右上「扫码加入」分享地址"}
                </span>
              </p>
            </div>
          ) : (
            <>
              {peers.map((peer) => (
                <PeerItem
                  key={peer.peerId}
                  peer={peer}
                  active={peer.peerId === client.selected}
                  online={onlinePeerIds.has(peer.peerId)}
                  unread={client.unread.get(peer.peerId) || 0}
                  onClick={() => {
                    client.selectPeer(peer.peerId);
                    setShowSidebarOnMobile(false);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleOpenContextMenu({
                      kind: "peer",
                      x: event.clientX,
                      y: event.clientY,
                      peer,
                    });
                  }}
                />
              ))}
              {visibleRemoteTargets.map((target) => {
                const roomId = remoteRoomId(target);
                return (
                  <RemoteTargetItem
                    key={roomId}
                    target={target}
                    active={roomId === currentRoomId}
                    online={discoveredRoomIds.has(roomId)}
                    disabled={!!disabledRooms[roomId]}
                    onClick={() => {
                      handleSelectRoom(roomId);
                      setShowSidebarOnMobile(false);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleOpenContextMenu({
                        kind: "remote",
                        x: event.clientX,
                        y: event.clientY,
                        target,
                      });
                    }}
                    onForget={() => handleForgetRemote(target)}
                  />
                );
              })}
            </>
          )}
        </div>

        <div className="p-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
          <div className="flex gap-1.5" title="当两台电脑都装了本软件时，在一台填入另一台的局域网地址即可直接互连，无需浏览器">
            <input
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleJoin();
              }}
              placeholder="加入桌面端：192.168.1.5:8421"
              className="flex-1 min-w-0 px-2 py-1.5 text-[11px] bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md outline-none focus:border-blue-500 dark:text-gray-100"
            />
            <button
              onClick={handleJoin}
              className="shrink-0 px-2.5 py-1.5 text-[11px] bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors"
            >
              加入
            </button>
          </div>
          <button
            onClick={onShowUrls}
            className="w-full px-3 py-2 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center justify-center gap-1.5 text-gray-700 dark:text-gray-300"
          >
            <QrCode size={12} />
            分享接入地址
          </button>
        </div>
      </aside>

      {/* Main */}
      <main
        className={`flex-1 h-full min-h-0 overflow-hidden flex flex-col bg-gray-50 dark:bg-gray-900 min-w-0 ${
          showSidebarOnMobile ? "max-md:hidden" : ""
        }`}
      >
        {selectedPeer ? (
          <>
            <header className="px-5 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3 min-h-[56px] flex-shrink-0">
              <button
                className="md:hidden p-1 text-gray-500 hover:text-gray-700"
                onClick={() => setShowSidebarOnMobile(true)}
              >
                <ChevronLeft size={18} />
              </button>
              <Avatar
                label={avatarLabel(selectedPeer.displayName)}
                color={avatarColor(selectedPeer.peerId)}
                size={32}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                  {selectedPeer.displayName}
                </div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <DeviceIcon type={selectedPeer.deviceType} />
                  {deviceLabel(selectedPeer.deviceType)} ·{" "}
                  {selectedPeerOnline ? "在线" : "离线历史"}
                </div>
              </div>
              {activeRemoteTarget ? (
                <div className="hidden sm:flex items-center gap-2">
                  <span className="max-w-[180px] truncate text-[11px] text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded-md">
                    {remoteLabel(activeRemoteTarget)}
                  </span>
                  <button
                    onClick={handleBackToLocal}
                    className="px-2 py-1 text-xs rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    返回本机
                  </button>
                  <button
                    onClick={
                      currentRoomDisabled || remoteClient.status === "offline"
                        ? handleReconnectCurrentRoom
                        : handleToggleCurrentRoom
                    }
                    className="w-7 h-7 rounded-md flex items-center justify-center text-gray-500 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title={
                      currentRoomDisabled || remoteClient.status === "offline"
                        ? "重试当前地址"
                        : "断开当前地址"
                    }
                  >
                    {currentRoomDisabled || remoteClient.status === "offline" ? (
                      <Wifi size={14} />
                    ) : (
                      <WifiOff size={14} />
                    )}
                  </button>
                </div>
              ) : null}
            </header>

            <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {messages.length === 0 ? (
                <div className="text-center text-xs text-gray-400 py-12">
                  还没有聊天记录，发送一条消息开始吧
                </div>
              ) : (
                messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    isSelf={m.from === client.selfId}
                    onSave={handleSaveFile}
                    onCopyPath={handleCopySavedPath}
                    onOpenPath={handleOpenSavedPath}
                    onCopyText={handleCopyText}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-3 flex-shrink-0">
              {!selectedPeerOnline && (
                <div className="mb-2 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                  <WifiOff size={13} />
                  设备当前离线，历史记录仍可查看，重新连接后可继续发送。
                </div>
              )}
              <div className="flex items-end gap-2">
                <button
                  onClick={handleSelectFile}
                  disabled={!selectedPeerOnline}
                  className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center text-gray-500 hover:text-blue-500 transition-colors flex-shrink-0"
                  title="发送文件"
                >
                  <Paperclip size={16} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFilesChosen(e.target.files)}
                />
                <textarea
                  className="flex-1 min-h-9 max-h-32 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg outline-none focus:border-blue-500 dark:text-gray-100 resize-none"
                  rows={1}
                  disabled={!selectedPeerOnline}
                  placeholder={
                    selectedPeerOnline
                      ? "输入消息，Enter 发送，Shift+Enter 换行"
                      : "设备离线，暂时无法发送"
                  }
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendText();
                    }
                  }}
                />
                <Button
                  onClick={handleSendText}
                  variant="primary"
                  size="sm"
                  disabled={!selectedPeerOnline || !draft.trim()}
                >
                  <Send size={14} className="mr-1" />
                  发送
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-gray-400 p-8 text-center">
            <div className="text-5xl mb-4 opacity-60">💬</div>
            <h4 className="text-base font-medium text-gray-600 dark:text-gray-300 mb-2">
              {activeRemoteTarget
                ? currentRoomDisabled
                  ? "已断开"
                  : remoteClient.status === "connecting"
                  ? "正在连接"
                  : remoteClient.status === "offline"
                  ? "连接不上这个地址"
                  : "正在进入局域网圈"
                : peers.length === 0
                ? "等待设备加入"
                : "选择一个设备开始聊天"}
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm leading-relaxed">
              {activeRemoteTarget
                ? remoteClient.status === "offline" && !currentRoomDisabled
                  ? `${remoteLabel(activeRemoteTarget)} 暂时不可达，请确认对方服务还在运行，或点本机返回。`
                  : "发现到的桌面端会自动连接，连上后会直接显示可聊天的设备。"
                : peers.length === 0
                ? "点击「扫码加入」按钮分享地址，让其他设备通过浏览器加入到这个传输房间。"
                : "在左侧设备列表中选择一个对象，即可发送文字或拖拽 / 选择文件发送。"}
            </p>
            {activeRemoteTarget ? (
              <div className="mt-4 flex items-center gap-2">
                <Button
                  onClick={
                    currentRoomDisabled || remoteClient.status === "offline"
                      ? handleReconnectCurrentRoom
                      : handleToggleCurrentRoom
                  }
                  variant="secondary"
                  size="sm"
                >
                  {currentRoomDisabled || remoteClient.status === "offline" ? (
                    <Wifi size={14} className="mr-1.5" />
                  ) : (
                    <WifiOff size={14} className="mr-1.5" />
                  )}
                  {currentRoomDisabled || remoteClient.status === "offline"
                    ? "重试"
                    : "断开"}
                </Button>
                <Button
                  onClick={handleBackToLocal}
                  variant="secondary"
                  size="sm"
                >
                  <ChevronLeft size={14} className="mr-1.5" />
                  本机
                </Button>
                {remoteClient.status === "offline" ? (
                  <Button
                    onClick={() => handleForgetRemote(activeRemoteTarget)}
                    variant="secondary"
                    size="sm"
                  >
                    <X size={14} className="mr-1.5" />
                    移除
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </main>

      {contextMenu ? (
        <PairDropContextMenu
          menu={contextMenu}
          activeRoomId={activeRoomId}
          disabledRooms={disabledRooms}
          onClose={() => setContextMenu(null)}
          onRenameLocal={handleRenameLocal}
          onBackToLocal={handleBackToLocal}
          onToggleLocal={handleToggleLocalRoom}
          onSelectRemote={(target) => {
            const roomId = remoteRoomId(target);
            setDisabledRooms((prev) => ({ ...prev, [roomId]: false }));
            handleSelectRoom(roomId);
            setShowSidebarOnMobile(false);
          }}
          onReconnectRemote={(target) => {
            const roomId = remoteRoomId(target);
            setActiveRoomId(roomId);
            setDisabledRooms((prev) => ({ ...prev, [roomId]: true }));
            window.setTimeout(() => {
              setDisabledRooms((prev) => ({ ...prev, [roomId]: false }));
            }, 50);
          }}
          onDisconnectRemote={(target) => {
            const roomId = remoteRoomId(target);
            setDisabledRooms((prev) => ({ ...prev, [roomId]: true }));
          }}
          onRenameRemote={handleRenameRemote}
          onEditRemoteAddress={handleEditRemoteAddress}
          onForgetRemote={handleForgetRemote}
          onRenamePeer={handleRenamePeer}
        />
      ) : null}
    </div>
  );
}

function PairDropContextMenu({
  menu,
  activeRoomId,
  disabledRooms,
  onClose,
  onRenameLocal,
  onBackToLocal,
  onToggleLocal,
  onSelectRemote,
  onReconnectRemote,
  onDisconnectRemote,
  onRenameRemote,
  onEditRemoteAddress,
  onForgetRemote,
  onRenamePeer,
}: {
  menu: ContextMenuState;
  activeRoomId: string;
  disabledRooms: Record<string, boolean>;
  onClose: () => void;
  onRenameLocal: () => void;
  onBackToLocal: () => void;
  onToggleLocal: () => void;
  onSelectRemote: (target: RemoteTarget) => void;
  onReconnectRemote: (target: RemoteTarget) => void;
  onDisconnectRemote: (target: RemoteTarget) => void;
  onRenameRemote: (target: RemoteTarget) => void;
  onEditRemoteAddress: (target: RemoteTarget) => void;
  onForgetRemote: (target: RemoteTarget) => void;
  onRenamePeer: (peer: HistoricalPeer) => void;
}) {
  const x = Math.min(menu.x, window.innerWidth - 180);
  const y = Math.min(menu.y, window.innerHeight - 260);
  const run = (action: () => void) => {
    action();
    onClose();
  };
  const itemClass =
    "w-full px-3 py-2 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700";

  return (
    <div
      className="fixed z-50 min-w-[168px] overflow-hidden rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1"
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {menu.kind === "local" ? (
        <>
          <button className={itemClass} onClick={() => run(onBackToLocal)}>
            切回本机
          </button>
          <button className={itemClass} onClick={() => run(onRenameLocal)}>
            重命名本机
          </button>
          <button className={itemClass} onClick={() => run(onToggleLocal)}>
            {disabledRooms[LOCAL_ROOM_ID] ? "重新连接本机" : "断开本机"}
          </button>
        </>
      ) : null}
      {menu.kind === "remote" ? (
        <>
          <button
            className={itemClass}
            onClick={() => run(() => onSelectRemote(menu.target))}
          >
            进入连接
          </button>
          <button
            className={itemClass}
            onClick={() => run(() => onReconnectRemote(menu.target))}
          >
            重试连接
          </button>
          <button
            className={itemClass}
            onClick={() => run(() => onDisconnectRemote(menu.target))}
          >
            断开连接
          </button>
          <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
          <button
            className={itemClass}
            onClick={() => run(() => onRenameRemote(menu.target))}
          >
            重命名
          </button>
          <button
            className={itemClass}
            onClick={() => run(() => onEditRemoteAddress(menu.target))}
          >
            修改地址
          </button>
          <button
            className={`${itemClass} text-red-600 dark:text-red-400`}
            onClick={() => run(() => onForgetRemote(menu.target))}
          >
            移除
          </button>
          {activeRoomId === remoteRoomId(menu.target) ? (
            <div className="px-3 py-1.5 text-[10px] text-gray-400">
              当前连接
            </div>
          ) : null}
        </>
      ) : null}
      {menu.kind === "peer" ? (
        <>
          <button
            className={itemClass}
            onClick={() => run(() => onRenamePeer(menu.peer))}
          >
            重命名
          </button>
        </>
      ) : null}
    </div>
  );
}

function LocalScopeItem({
  active,
  online,
  onClick,
  onContextMenu,
}: {
  active: boolean;
  online: boolean;
  onClick: () => void;
  onContextMenu: (event: MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left relative ${
        active ? "bg-blue-50 dark:bg-blue-900/30" : ""
      }`}
    >
      {active && (
        <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-500" />
      )}
      <Avatar label="本" color="#2563eb" size={32} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
          本机
        </div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
          <Monitor size={10} />
          局域网入口 · {online ? "在线" : "已断开"}
        </div>
      </div>
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${
          online ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"
        }`}
      />
    </button>
  );
}

function RemoteTargetItem({
  target,
  active,
  online,
  disabled,
  onClick,
  onContextMenu,
  onForget,
}: {
  target: RemoteTarget;
  active: boolean;
  online: boolean;
  disabled: boolean;
  onClick: () => void;
  onContextMenu: (event: MouseEvent) => void;
  onForget: () => void;
}) {
  return (
    <div className="group relative">
      <button
        onClick={onClick}
        onContextMenu={onContextMenu}
        className={`w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left ${
          active ? "bg-blue-50 dark:bg-blue-900/30" : ""
        }`}
      >
        {active && (
          <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-500" />
        )}
        <Avatar
          label={avatarLabel(remoteLabel(target))}
          color={avatarColor(target.deviceId || `${target.host}:${target.port}`)}
          size={32}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {remoteLabel(target)}
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <Monitor size={10} />
            桌面端 · {disabled ? "已断开" : online ? "已发现" : "历史"}
          </div>
        </div>
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            disabled
              ? "bg-gray-300 dark:bg-gray-600"
              : online
              ? "bg-green-500"
              : "bg-gray-300 dark:bg-gray-600"
          }`}
        />
      </button>
      <button
        onClick={onForget}
        className="absolute right-7 top-1/2 -translate-y-1/2 hidden group-hover:flex w-6 h-6 items-center justify-center rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
        title="移除"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function PeerItem({
  peer,
  active,
  online,
  unread,
  onClick,
  onContextMenu,
}: {
  peer: Peer & { lastSeenAt?: number };
  active: boolean;
  online: boolean;
  unread: number;
  onClick: () => void;
  onContextMenu: (event: MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left relative ${
        active ? "bg-blue-50 dark:bg-blue-900/30" : ""
      }`}
    >
      {active && (
        <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-500" />
      )}
      <Avatar
        label={avatarLabel(peer.displayName)}
        color={avatarColor(peer.peerId)}
        size={32}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
          {peer.displayName}
        </div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
          <DeviceIcon type={peer.deviceType} />
          {deviceLabel(peer.deviceType)} · {online ? "在线" : "历史"}
        </div>
      </div>
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${
          online ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"
        }`}
        title={online ? "在线" : "离线"}
      />
      {unread > 0 && (
        <span className="bg-red-500 text-white text-[10px] font-semibold rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center">
          {unread}
        </span>
      )}
    </button>
  );
}

function MessageBubble({
  message,
  isSelf,
  onSave,
  onCopyPath,
  onOpenPath,
  onCopyText,
}: {
  message: any;
  isSelf: boolean;
  onSave?: (token: string, suggestedName: string, messageId: string) => void;
  onCopyPath?: (path: string) => void;
  onOpenPath?: (path: string) => void;
  onCopyText?: (text: string) => void;
}) {
  const time = useMemo(() => {
    const d = new Date(message.ts);
    const clock = `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}`;
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    return isToday
      ? clock
      : `${String(d.getMonth() + 1).padStart(2, "0")}-${String(
          d.getDate()
        ).padStart(2, "0")} ${clock}`;
  }, [message.ts]);

  if (message.kind === "text") {
    return (
      <div
        className={`flex ${isSelf ? "justify-end" : "justify-start"} max-w-[75%] ${
          isSelf ? "ml-auto" : ""
        }`}
      >
        <div className="min-w-0 max-w-full group">
          <div
            className={`px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
              isSelf
                ? "bg-blue-500 text-white rounded-br-md"
                : "bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-bl-md"
            }`}
          >
            {message.text}
          </div>
          <div
            className={`flex items-center gap-2 mt-1 ${
              isSelf ? "justify-start" : "justify-end"
            }`}
          >
            <button
              onClick={() => onCopyText?.(message.text)}
              className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-blue-500"
              title="复制文本"
            >
              <Copy size={11} />
              复制
            </button>
            <span className="text-[10px] text-gray-400">{time}</span>
          </div>
        </div>
      </div>
    );
  }

  // file
  const ext = (message.name.split(".").pop() || "").toUpperCase().slice(0, 4);
  const uploading =
    isSelf &&
    typeof message.uploadProgress === "number" &&
    message.uploadProgress < 100;
  return (
    <div
      className={`flex ${isSelf ? "justify-end" : "justify-start"} max-w-[75%] ${
        isSelf ? "ml-auto" : ""
      }`}
    >
      <div className="min-w-0 max-w-full">
        <div
          className={`px-3 py-2 rounded-2xl text-sm ${
            isSelf
              ? "bg-blue-500 text-white rounded-br-md"
              : "bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-bl-md"
          }`}
        >
          <div className="flex items-center gap-3 min-w-[200px]">
            <div
              className={`w-9 h-9 rounded-md flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                isSelf
                  ? "bg-white/25 text-white"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
              }`}
            >
              {ext || "FILE"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-xs break-all">
                {message.name}
              </div>
              <div className="text-[10px] opacity-80 mt-0.5">
                {formatBytes(message.size)}
                {uploading ? <> · 上传 {message.uploadProgress}%</> : null}
              </div>
            </div>
          </div>
          {uploading ? (
            <div
              className={`mt-2 h-1 rounded-full overflow-hidden ${
                isSelf ? "bg-white/30" : "bg-gray-200 dark:bg-gray-700"
              }`}
            >
              <div
                className={`h-full transition-all duration-150 ${
                  isSelf ? "bg-white/90" : "bg-blue-500"
                }`}
                style={{ width: `${message.uploadProgress}%` }}
              />
            </div>
          ) : null}
          {!isSelf && message.token ? (
            message.savedPath ? (
              <div className="mt-2 space-y-1.5">
                <div
                  className="text-[10px] opacity-80 break-all"
                  title={message.savedPath}
                >
                  已保存到 {message.savedPath}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => onCopyPath?.(message.savedPath)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-100 rounded transition-colors"
                  >
                    <Copy size={11} />
                    复制路径
                  </button>
                  <button
                    onClick={() => onOpenPath?.(message.savedPath)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-100 rounded transition-colors"
                  >
                    <FolderOpen size={11} />
                    打开位置
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() =>
                  onSave?.(message.token, message.name, message.id)
                }
                className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 text-[11px] bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
              >
                <Save size={11} />
                保存到本地
              </button>
            )
          ) : null}
          {isSelf && !uploading && message.token ? (
            <div className="mt-2 text-[10px] opacity-80">已发送</div>
          ) : null}
        </div>
        <div
          className={`text-[10px] text-gray-400 mt-1 ${
            isSelf ? "text-left" : "text-right"
          }`}
        >
          {time}
        </div>
      </div>
    </div>
  );
}

function Avatar({
  label,
  color,
  size,
}: {
  label: string;
  color: string;
  size: number;
}) {
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-semibold text-xs flex-shrink-0"
      style={{ width: size, height: size, background: color }}
    >
      {label}
    </div>
  );
}

function DeviceIcon({ type }: { type: string }) {
  if (type === "mobile") return <Smartphone size={10} />;
  if (type === "desktop") return <Monitor size={10} />;
  return <Globe size={10} />;
}
function deviceLabel(t: string) {
  if (t === "desktop") return "桌面端";
  if (t === "mobile") return "手机";
  return "浏览器";
}
function avatarLabel(name: string): string {
  if (!name) return "?";
  const ascii = name.match(/[A-Za-z0-9]/);
  if (ascii) return ascii[0].toUpperCase();
  return name.trim().charAt(0) || "?";
}
function avatarColor(id: string): string {
  if (!id) return "#9ca3af";
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffffff;
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 55%)`;
}
