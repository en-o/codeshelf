import { useState, useEffect } from "react";
import type { Project, GitStatus } from "@/types";
import { getGitStatus, getRemotes } from "@/services/git";
import { openInEditor, openInTerminal, toggleFavorite, removeProject, deleteProjectDirectory } from "@/services/db";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";

interface ProjectCardProps {
  project: Project;
  onUpdate?: (project: Project) => void;
  onShowDetail?: (project: Project) => void;
  onDelete?: (projectId: string) => void;
}

export function ProjectCard({ project, onUpdate, onShowDetail, onDelete }: Omit<ProjectCardProps, "viewMode">) {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [remoteType, setRemoteType] = useState<"github" | "gitee" | "gitlab" | "other" | "none">("none");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    loadGitInfo();
  }, [project.path]);

  async function loadGitInfo() {
    try {
      const [status, remotes] = await Promise.all([
        getGitStatus(project.path),
        getRemotes(project.path),
      ]);
      setGitStatus(status);

      // Determine remote type
      if (remotes.length > 0) {
        const url = remotes[0].url.toLowerCase();
        if (url.includes("github.com")) {
          setRemoteType("github");
        } else if (url.includes("gitee.com")) {
          setRemoteType("gitee");
        } else if (url.includes("gitlab")) {
          setRemoteType("gitlab");
        } else {
          setRemoteType("other");
        }
      } else {
        setRemoteType("none");
      }
    } catch (error) {
      console.error("Failed to load git info:", error);
    } finally {
    }
  }

  async function handleToggleFavorite(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const updated = await toggleFavorite(project.id);
      onUpdate?.(updated);
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
    }
  }

  async function handleOpenEditor(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await openInEditor(project.path);
    } catch (error) {
      console.error("Failed to open in editor:", error);
    }
  }

  async function handleOpenTerminal(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await openInTerminal(project.path);
    } catch (error) {
      console.error("Failed to open terminal:", error);
    }
  }

  async function handleDelete(deleteDirectory: boolean) {
    try {
      if (deleteDirectory) {
        await deleteProjectDirectory(project.id);
      } else {
        await removeProject(project.id);
      }
      onDelete?.(project.id);
      setShowDeleteDialog(false);
    } catch (error) {
      console.error("Failed to delete project:", error);
      alert("删除失败：" + error);
    }
  }

  function getRemoteLabel() {
    switch (remoteType) {
      case "github":
        return "☆GitHub";
      case "gitee":
        return "@Gitee";
      case "gitlab":
        return "🦊GitLab";
      case "other":
        return "🌐Other";
      default:
        return "📦Local";
    }
  }

  // exact 1:1 reproduction from example.html CSS
  return (
    <>
      <div
        onClick={() => onShowDetail?.(project)}
        className="re-card"
      >
        <div className="re-card-header">
          <h4>{project.name}</h4>
          <span
            className="re-star"
            title={project.isFavorite ? "取消收藏" : "收藏"}
            onClick={handleToggleFavorite}
          >
            {project.isFavorite ? "★" : "☆"}
          </span>
        </div>

        <div className="re-card-meta">
          {getRemoteLabel()} {gitStatus?.branch ? `· ${gitStatus.branch}` : ""}
        </div>

        <div className="re-card-cat">
          分类：{project.tags.length > 0 ? project.tags.join(", ") : "未分类"}
        </div>

        {project.labels && project.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 px-4 pb-2">
            {project.labels.map((label) => (
              <span
                key={label}
                className="inline-flex items-center px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs font-medium"
              >
                {label}
              </span>
            ))}
          </div>
        )}

        <div className="re-card-path">
          {project.path}
        </div>

        <div className="re-card-footer">
          <span className="re-status">
            {gitStatus?.isClean === false ? "有修改" : "无修改"}
          </span>

          <div className="re-card-actions">
            <button
              className="re-icon-btn"
              title="编辑器"
              onClick={handleOpenEditor}
            >
              📝
            </button>
            <button
              className="re-icon-btn"
              title="终端"
              onClick={handleOpenTerminal}
            >
              💻
            </button>
            <button
              className="re-icon-btn"
              title="删除"
              onClick={(e) => {
                e.stopPropagation();
                setShowDeleteDialog(true);
              }}
            >
              🗑️
            </button>
          </div>
        </div>
      </div>

      {showDeleteDialog && (
        <DeleteConfirmDialog
          projectName={project.name}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteDialog(false)}
        />
      )}
    </>
  );
}
