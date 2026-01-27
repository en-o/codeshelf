import { useState, useEffect } from "react";
import {
  Star,
  GitBranch,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  Terminal,
  MoreVertical,
} from "lucide-react";
import type { Project, GitStatus } from "@/types";
import { getGitStatus } from "@/services/git";
import { openInEditor, openInTerminal, toggleFavorite } from "@/services/db";

interface ProjectCardProps {
  project: Project;
  viewMode: "grid" | "list";
  onUpdate?: (project: Project) => void;
}

export function ProjectCard({ project, viewMode, onUpdate }: ProjectCardProps) {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadGitStatus();
  }, [project.path]);

  async function loadGitStatus() {
    try {
      setLoading(true);
      const status = await getGitStatus(project.path);
      setGitStatus(status);
    } catch (error) {
      console.error("Failed to load git status:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleFavorite() {
    try {
      const updated = await toggleFavorite(project.id);
      onUpdate?.(updated);
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
    }
  }

  async function handleOpenEditor() {
    try {
      await openInEditor(project.path);
    } catch (error) {
      console.error("Failed to open in editor:", error);
    }
  }

  async function handleOpenTerminal() {
    try {
      await openInTerminal(project.path);
    } catch (error) {
      console.error("Failed to open terminal:", error);
    }
  }

  if (viewMode === "list") {
    return (
      <div className="flex items-center gap-4 p-4 bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-700 transition-colors">
        <button
          onClick={handleToggleFavorite}
          className={`p-1 rounded ${
            project.isFavorite
              ? "text-yellow-400"
              : "text-gray-600 hover:text-gray-400"
          }`}
        >
          <Star className="w-5 h-5" fill={project.isFavorite ? "currentColor" : "none"} />
        </button>

        <div className="flex-1 min-w-0">
          <h3 className="text-white font-medium truncate">{project.name}</h3>
          <p className="text-gray-500 text-sm truncate">{project.path}</p>
        </div>

        {gitStatus && (
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1 text-gray-400">
              <GitBranch className="w-4 h-4" />
              <span>{gitStatus.branch}</span>
            </div>
            {gitStatus.ahead > 0 && (
              <div className="flex items-center gap-1 text-green-400">
                <ArrowUp className="w-4 h-4" />
                <span>{gitStatus.ahead}</span>
              </div>
            )}
            {gitStatus.behind > 0 && (
              <div className="flex items-center gap-1 text-orange-400">
                <ArrowDown className="w-4 h-4" />
                <span>{gitStatus.behind}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenEditor}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
            title="在编辑器中打开"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          <button
            onClick={handleOpenTerminal}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
            title="打开终端"
          >
            <Terminal className="w-4 h-4" />
          </button>
          <button className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors">
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // Grid view
  return (
    <div className="flex flex-col p-4 bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-700 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-white font-medium truncate flex-1">{project.name}</h3>
        <button
          onClick={handleToggleFavorite}
          className={`p-1 rounded ${
            project.isFavorite
              ? "text-yellow-400"
              : "text-gray-600 hover:text-gray-400"
          }`}
        >
          <Star className="w-4 h-4" fill={project.isFavorite ? "currentColor" : "none"} />
        </button>
      </div>

      <p className="text-gray-500 text-sm truncate mb-4">{project.path}</p>

      {loading ? (
        <div className="h-6 bg-gray-800 rounded animate-pulse" />
      ) : (
        gitStatus && (
          <div className="flex items-center gap-3 text-sm mb-4">
            <div className="flex items-center gap-1 text-gray-400">
              <GitBranch className="w-4 h-4" />
              <span className="truncate max-w-[100px]">{gitStatus.branch}</span>
            </div>
            {gitStatus.ahead > 0 && (
              <div className="flex items-center gap-1 text-green-400">
                <ArrowUp className="w-3 h-3" />
                <span>{gitStatus.ahead}</span>
              </div>
            )}
            {gitStatus.behind > 0 && (
              <div className="flex items-center gap-1 text-orange-400">
                <ArrowDown className="w-3 h-3" />
                <span>{gitStatus.behind}</span>
              </div>
            )}
            {!gitStatus.isClean && (
              <span className="text-yellow-400 text-xs">有修改</span>
            )}
          </div>
        )
      )}

      {project.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-4">
          {project.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-xs bg-gray-800 text-gray-400 rounded"
            >
              {tag}
            </span>
          ))}
          {project.tags.length > 3 && (
            <span className="px-2 py-0.5 text-xs text-gray-500">
              +{project.tags.length - 3}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 mt-auto pt-3 border-t border-gray-800">
        <button
          onClick={handleOpenEditor}
          className="flex-1 flex items-center justify-center gap-2 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          <span>编辑器</span>
        </button>
        <button
          onClick={handleOpenTerminal}
          className="flex-1 flex items-center justify-center gap-2 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
        >
          <Terminal className="w-4 h-4" />
          <span>终端</span>
        </button>
      </div>
    </div>
  );
}
