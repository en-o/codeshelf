import { useState, type RefObject } from "react";
import { Settings } from "lucide-react";
import { MacWindowControls } from "@/components/layout/MacWindowControls";
import type { Project } from "@/types";
import type { ChatSession } from "@/types";
import type { ToolSchema } from "@/services/chat";
import type { ModelOption } from "../utils/chatHelpers";
import { sessionTokens } from "../utils/tokens";
import { SessionToolsMenu } from "./SessionToolsMenu";

interface ChatHeaderProps {
  onToggleSidebar: () => void;
  activeSession: ChatSession | null;
  modelOptions: ModelOption[];
  defaultKey: string | null;
  effectiveKey: string | null;
  streaming: boolean;
  loading: boolean;
  toolsEnabled: boolean;
  toolSchemas: ToolSchema[];
  projects: Project[];
  globalMemory: string;
  modelSelectRef: RefObject<HTMLSelectElement | null>;
  onSelectModel: (key: string) => void;
  onOpenModelManager: () => void;
  onSetToolsEnabled: (enabled: boolean) => void;
  onPersistSession: (s: ChatSession) => Promise<ChatSession>;
  onPickAllowedCwd: () => Promise<void>;
  onCompact: () => Promise<void>;
  onOpenMemory: (draft: string) => void;
  onOpenSkills: () => void;
  onOpenTaskPanel: () => void;
  onOpenConfig: () => void;
}

export function ChatHeader({
  onToggleSidebar,
  activeSession,
  modelOptions,
  defaultKey,
  effectiveKey,
  streaming,
  loading,
  toolsEnabled,
  toolSchemas,
  projects,
  globalMemory,
  modelSelectRef,
  onSelectModel,
  onOpenModelManager,
  onSetToolsEnabled,
  onPersistSession,
  onPickAllowedCwd,
  onCompact,
  onOpenMemory,
  onOpenSkills,
  onOpenTaskPanel,
  onOpenConfig,
}: ChatHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="re-header sticky top-0 z-20" data-tauri-drag-region>
      <span className="toggle" onClick={onToggleSidebar}>☰</span>

      <div className="flex-1 flex items-center gap-3" data-tauri-drag-region>
        <span className="text-lg font-semibold ml-2">💬 对话</span>
        {activeSession && (
          <span className="text-[11px] text-gray-400" title="估算 tokens（char/4 近似）">
            ~{sessionTokens(activeSession.messages).toLocaleString()} tokens
          </span>
        )}
        {modelOptions.length > 0 && (
          <select
            ref={modelSelectRef}
            className="px-2 py-1 text-xs border border-gray-200 rounded-lg bg-white text-gray-700 max-w-[240px]"
            value={effectiveKey ?? ""}
            onChange={(e) => onSelectModel(e.target.value)}
            disabled={streaming}
          >
            {modelOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.providerName} / {opt.model.model}
                {opt.key === defaultKey ? "（默认）" : ""}
              </option>
            ))}
          </select>
        )}
        <button
          className="px-2 py-1 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
          onClick={onOpenModelManager}
          title="管理模型"
        >
          模型…
        </button>
        {activeSession && (
          <>
            <span
              className="text-[11px] text-gray-400 truncate max-w-[220px]"
              title={activeSession.allowedCwd || "未选目录"}
            >
              {activeSession.allowedCwd ? `📁 ${activeSession.allowedCwd.split("/").pop()}` : "未选目录（普通对话）"}
            </span>
            {toolsEnabled && (
              <span className="text-[11px] text-blue-600" title="本地沙箱工具已启用">🛠 本地</span>
            )}
            {activeSession.useMcpGatewayTools !== false && (
              <span className="text-[11px] text-emerald-600" title="MCP gateway 工具：启动后自动可调">🌐 MCP</span>
            )}
            <div className="relative">
              <button
                className="px-2 py-1 text-xs border border-gray-200 rounded-lg flex items-center gap-1 text-gray-600 hover:bg-gray-50"
                onClick={() => setMenuOpen((v) => !v)}
                title="会话工具"
              >
                <Settings size={12} /> 会话
              </button>
              {menuOpen && (
                <SessionToolsMenu
                  session={activeSession}
                  streaming={streaming}
                  loading={loading}
                  toolsEnabled={toolsEnabled}
                  toolSchemas={toolSchemas}
                  projects={projects}
                  globalMemory={globalMemory}
                  onSetToolsEnabled={onSetToolsEnabled}
                  onPersistSession={onPersistSession}
                  onPickAllowedCwd={onPickAllowedCwd}
                  onCompact={onCompact}
                  onOpenMemory={onOpenMemory}
                  onOpenSkills={onOpenSkills}
                  onOpenTaskPanel={onOpenTaskPanel}
                  onOpenConfig={onOpenConfig}
                  onClose={() => setMenuOpen(false)}
                />
              )}
            </div>
          </>
        )}
      </div>

      <div className="re-actions flex items-center">
        <MacWindowControls />
      </div>
    </header>
  );
}
