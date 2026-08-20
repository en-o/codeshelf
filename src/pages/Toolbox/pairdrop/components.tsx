// PairDrop 叶子展示组件：侧栏条目、消息气泡、头像、设备图标。
// 纯展示，状态与回调全部由 ChatWorkspace 通过 props 注入。
import { useMemo, type MouseEvent } from "react";
import {
  Monitor,
  Smartphone,
  Globe,
  Copy,
  Save,
  FolderOpen,
  X,
} from "lucide-react";
import { formatBytes } from "@/services/toolbox";
import type { Peer } from "./usePairDropClient";
import {
  type RemoteTarget,
  remoteLabel,
  avatarLabel,
  avatarColor,
  deviceLabel,
} from "./helpers";

export function Avatar({
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

export function DeviceIcon({ type }: { type: string }) {
  if (type === "mobile") return <Smartphone size={10} />;
  if (type === "desktop") return <Monitor size={10} />;
  return <Globe size={10} />;
}

export function LocalScopeItem({
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

export function RemoteTargetItem({
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

export function PeerItem({
  peer,
  active,
  online,
  unread,
  onClick,
  onContextMenu,
  onDelete,
}: {
  peer: Peer & { lastSeenAt?: number };
  active: boolean;
  online: boolean;
  unread: number;
  onClick: () => void;
  onContextMenu: (event: MouseEvent) => void;
  onDelete: () => void;
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
      <button
        onClick={onDelete}
        className="absolute right-7 top-1/2 -translate-y-1/2 hidden group-hover:flex w-6 h-6 items-center justify-center rounded-md bg-white dark:bg-gray-800 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
        title="删除会话"
      >
        <X size={13} />
      </button>
    </div>
  );
}

export function MessageBubble({
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
          {/* 领取后 token 会被清空（中转缓存已删），但已保存的真实路径要继续可见 */}
          {!isSelf && (message.savedPath || message.token || message.taken) ? (
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
            ) : message.token ? (
              <button
                onClick={() =>
                  onSave?.(message.token, message.name, message.id)
                }
                className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 text-[11px] bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
              >
                <Save size={11} />
                保存到本地
              </button>
            ) : (
              <div className="mt-2 text-[10px] opacity-70">
                已领取，中转缓存已清理
              </div>
            )
          ) : null}
          {isSelf && !uploading && (message.token || message.taken) ? (
            <div className="mt-2 space-y-1.5">
              <div className="text-[10px] opacity-80">
                {message.taken ? "对方已领取，中转缓存已清理" : "已发送"}
              </div>
              {/* 发送方指向自己的源文件，跟中转缓存的生死无关 */}
              {message.localPath ? (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => onCopyPath?.(message.localPath!)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-white/20 hover:bg-white/30 text-white rounded transition-colors"
                  >
                    <Copy size={11} />
                    复制路径
                  </button>
                  <button
                    onClick={() => onOpenPath?.(message.localPath!)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-white/20 hover:bg-white/30 text-white rounded transition-colors"
                  >
                    <FolderOpen size={11} />
                    打开位置
                  </button>
                </div>
              ) : null}
            </div>
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
