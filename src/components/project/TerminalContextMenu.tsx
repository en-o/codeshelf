import { useState, useEffect, useRef } from "react";
import { Terminal } from "lucide-react";
import type { Project } from "@/types";
import type { ClaudeCodeInfo } from "@/types/toolbox";
import { useEditorsStore } from "@/stores/editorsStore";
import { openInTerminal } from "@/services/db";
import { launchClaudeInTerminal, getClaudeInstallationsCache, checkAllClaudeInstallations, saveClaudeInstallationsCache, checkCodexInstallations } from "@/services/toolbox";
import { showToast } from "@/components/ui";

interface TerminalContextMenuProps {
  project: Project;
  position: { x: number; y: number };
  onClose: () => void;
}

export function TerminalContextMenu({ project, position, onClose }: TerminalContextMenuProps) {
  const terminalConfig = useEditorsStore((s) => s.terminalConfig);
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState(position);
  const [claudeEnvs, setClaudeEnvs] = useState<ClaudeCodeInfo[]>([]);
  const [codexEnvs, setCodexEnvs] = useState<ClaudeCodeInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadClaudeEnvs();
    loadCodexEnvs();
  }, []);

  async function loadCodexEnvs() {
    try {
      const infos = await checkCodexInstallations();
      setCodexEnvs(infos.filter((e) => e.installed));
    } catch (error) {
      console.error("Failed to load Codex envs:", error);
    }
  }

  async function loadClaudeEnvs() {
    try {
      let cached = await getClaudeInstallationsCache();
      if (!cached) {
        try {
          const scanned = await checkAllClaudeInstallations();
          if (scanned && scanned.length > 0) {
            await saveClaudeInstallationsCache(scanned);
            cached = scanned;
          }
        } catch {
          // scan failure is ok
        }
      }
      setClaudeEnvs(cached?.filter((e) => e.installed && e.version) || []);
    } catch (error) {
      console.error("Failed to load Claude envs:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const x = position.x + rect.width > window.innerWidth ? window.innerWidth - rect.width - 8 : position.x;
      const y = position.y + rect.height > window.innerHeight ? window.innerHeight - rect.height - 8 : position.y;
      setAdjustedPos({ x, y });
    }
  }, [position, claudeEnvs]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleOpenTerminal() {
    try {
      const termType = terminalConfig.type === "default" ? undefined : terminalConfig.type;
      const termPath = terminalConfig.paths?.[terminalConfig.type as keyof typeof terminalConfig.paths];
      await openInTerminal(project.path, termType, terminalConfig.customPath, termPath);
      onClose();
    } catch (error) {
      console.error("Failed to open terminal:", error);
      showToast("error", "打开终端失败", String(error));
    }
  }

  async function handleLaunchCli(env: ClaudeCodeInfo, cli: "claude" | "codex") {
    const label = cli === "codex" ? "Codex" : "Claude Code";
    try {
      await launchClaudeInTerminal(
        project.path,
        terminalConfig.type,
        terminalConfig.customPath,
        terminalConfig.paths?.[terminalConfig.type],
        env.envType,
        env.envName,
        cli
      );
      showToast("success", "已启动", `${label} (${env.envName}) 已在终端中打开`);
      onClose();
    } catch (error) {
      console.error(`Failed to launch ${label}:`, error);
      showToast("error", "启动失败", String(error));
    }
  }

  return (
    <div
      ref={menuRef}
      className="editor-context-menu"
      style={{ left: adjustedPos.x, top: adjustedPos.y }}
    >
      {/* 普通终端 */}
      <div className="editor-context-menu-header">终端</div>
      <button
        className="editor-context-menu-item"
        onClick={handleOpenTerminal}
      >
        <Terminal size={14} style={{ flexShrink: 0 }} />
        <span className="editor-context-menu-item-name">打开终端</span>
      </button>

      {/* Claude Code 环境 */}
      {loading ? (
        <>
          <div className="editor-context-menu-divider" />
          <div className="editor-context-menu-empty">检测 Claude Code...</div>
        </>
      ) : claudeEnvs.length > 0 ? (
        <>
          <div className="editor-context-menu-divider" />
          <div className="editor-context-menu-header">Claude Code</div>
          {claudeEnvs.map((env, i) => (
            <button
              key={i}
              className="editor-context-menu-item"
              onClick={() => handleLaunchCli(env, "claude")}
              title={`v${env.version}`}
            >
              <span className="claude-icon-text" style={{ fontSize: 10, width: 18, height: 18, flexShrink: 0 }}>C</span>
              <span className="editor-context-menu-item-name">{env.envName}</span>
              <span className="editor-context-menu-badge-global">v{env.version}</span>
            </button>
          ))}
        </>
      ) : null}

      {/* Codex 环境 */}
      {codexEnvs.length > 0 ? (
        <>
          <div className="editor-context-menu-divider" />
          <div className="editor-context-menu-header">Codex</div>
          {codexEnvs.map((env, i) => (
            <button
              key={i}
              className="editor-context-menu-item"
              onClick={() => handleLaunchCli(env, "codex")}
              title={env.version ? `v${env.version}` : "Codex"}
            >
              <span className="claude-icon-text" style={{ fontSize: 10, width: 18, height: 18, flexShrink: 0 }}>Cx</span>
              <span className="editor-context-menu-item-name">{env.envName}</span>
              {env.version ? (
                <span className="editor-context-menu-badge-global">v{env.version}</span>
              ) : null}
            </button>
          ))}
        </>
      ) : null}
    </div>
  );
}
