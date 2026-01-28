import { useState, useEffect } from "react";
import { X, GitBranch, History, Code, Tag as TagIcon, RefreshCw, CloudUpload, FolderOpen, User, Clock, Edit2, FileText, Database, Loader2 } from "lucide-react";
import { CategorySelector } from "./CategorySelector";
import { LabelSelector } from "./LabelSelector";
import { SyncRemoteModal } from "./SyncRemoteModal";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { BranchSwitchModal } from "./BranchSwitchModal";
import { showToast } from "@/components/ui";
import type { Project, GitStatus, CommitInfo, RemoteInfo } from "@/types";
import { getGitStatus, getCommitHistory, getRemotes, gitPull, gitPush } from "@/services/git";
import { openInEditor, openInTerminal, updateProject } from "@/services/db";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";

interface ProjectDetailPanelProps {
  project: Project;
  onClose: () => void;
  onUpdate?: (project: Project) => void;
}

export function ProjectDetailPanel({ project, onClose, onUpdate }: ProjectDetailPanelProps) {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showReadme, setShowReadme] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [readmeContent, setReadmeContent] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>(project.tags);
  const [selectedLabels, setSelectedLabels] = useState<string[]>(project.labels || []);
  const { editors, terminalConfig } = useAppStore();

  useEffect(() => {
    loadProjectDetails();
  }, [project.path]);

  async function loadProjectDetails() {
    try {
      setLoading(true);
      const [status, commitHistory, remoteList] = await Promise.all([
        getGitStatus(project.path),
        getCommitHistory(project.path, 10),
        getRemotes(project.path),
      ]);
      setGitStatus(status);
      setCommits(commitHistory);
      setRemotes(remoteList);
    } catch (error) {
      console.error("Failed to load project details:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handlePull() {
    if (!gitStatus || remotes.length === 0 || pulling) return;
    try {
      setPulling(true);
      await gitPull(project.path, remotes[0].name, gitStatus.branch);
      await loadProjectDetails();
      showToast("success", "拉取成功", `已从 ${remotes[0].name}/${gitStatus.branch} 拉取最新代码`);
    } catch (error) {
      console.error("Failed to pull:", error);
      showToast("error", "拉取失败", String(error));
    } finally {
      setPulling(false);
    }
  }

  async function handlePush() {
    if (!gitStatus || remotes.length === 0 || pushing) return;
    try {
      setPushing(true);
      await gitPush(project.path, remotes[0].name, gitStatus.branch);
      await loadProjectDetails();
      showToast("success", "推送成功", `已推送到 ${remotes[0].name}/${gitStatus.branch}`);
    } catch (error) {
      console.error("Failed to push:", error);
      showToast("error", "推送失败", String(error));
    } finally {
      setPushing(false);
    }
  }

  async function handleSaveCategories() {
    try {
      const updated = await updateProject({
        id: project.id,
        tags: selectedCategories,
        labels: selectedLabels,
      });
      onUpdate?.(updated);
      setShowCategoryModal(false);
      showToast("success", "保存成功", "项目分类和标签已更新");
    } catch (error) {
      console.error("Failed to update categories:", error);
      showToast("error", "保存失败", String(error));
    }
  }

  async function loadReadme() {
    try {
      const content = await invoke<string>("read_readme", { path: project.path });
      setReadmeContent(content);
      setShowReadme(true);
    } catch (error) {
      console.error("Failed to load README:", error);
      setReadmeContent("未找到 README.md 文件");
      setShowReadme(true);
    }
  }

  const getRemoteType = (url: string) => {
    if (url.includes("github.com")) return "GitHub";
    if (url.includes("gitee.com")) return "Gitee";
    if (url.includes("gitlab")) return "GitLab";
    return "Git";
  };

  return (
    <div className="project-detail-panel">
      {/* Header - 完全按照 example-projectPanel.html */}
      <header className="project-detail-header">
        <div className="flex items-center gap-md">
          {/* 项目图标 */}
          <div className="project-icon">
            <GitBranch className="text-white" size={20} />
          </div>
          
          <div className="flex flex-col gap-xs">
            <div className="flex items-center gap-md">
              {/* 项目名称 */}
              <h1 className="font-bold text-gray-900 text-base tracking-tight">{project.name}</h1>

              {/* 分类标签区域 */}
              <div className="flex items-center gap-sm flex-wrap">
                {project.tags.map((tag) => (
                  <span
                    key={tag}
                    className="category-tag"
                  >
                    <span className="category-tag-dot"></span>
                    <span>{tag}</span>
                  </span>
                ))}
                <button
                  onClick={() => setShowCategoryModal(true)}
                  className="edit-category-btn"
                >
                  <Edit2 size={10} className="opacity-70 group-hover:opacity-100" />
                  <span>{project.tags.length > 0 ? "编辑分类" : "设置分类"}</span>
                </button>
              </div>
            </div>
            
            {/* 项目路径 */}
            <p className="project-path">
              <FolderOpen size={12} className="text-gray-400" />
              {project.path}
            </p>
          </div>
        </div>

        {/* 操作按钮组 */}
        <div className="flex items-center gap-sm">
          <button
            onClick={handlePull}
            disabled={pulling || pushing}
            className={`action-btn action-btn-secondary ${pulling ? 'opacity-70' : ''}`}
          >
            {pulling ? (
              <Loader2 size={14} className="text-gray-600 animate-spin" />
            ) : (
              <RefreshCw size={14} className="text-gray-600" />
            )}
            <span>{pulling ? '拉取中...' : '拉取'}</span>
          </button>
          <button
            onClick={handlePush}
            disabled={pulling || pushing}
            className={`action-btn action-btn-primary ${pushing ? 'opacity-70' : ''}`}
          >
            {pushing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CloudUpload size={14} />
            )}
            <span>{pushing ? '推送中...' : '推送'}</span>
          </button>
          <div className="divider-vertical"></div>
          <button
            onClick={onClose}
            className="icon-btn"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* 主体内容 */}
      <div className="flex flex-1 pt-[4.5rem]">
        {/* Sidebar - 完全按照 example-projectPanel.html */}
        <aside className="project-detail-sidebar">
          {/* 分支状态卡片 */}
          <div className="sidebar-section">
            <div className="section-header">
              <span className="section-title">当前分支</span>
              <span className={`status-badge ${gitStatus?.isClean ? 'status-badge-success' : 'status-badge-warning'}`}>
                {gitStatus?.isClean ? "已同步" : "有修改"}
              </span>
            </div>

            <div className="branch-card">
              <div className="flex items-center gap-sm mb-xs">
                <GitBranch size={16} className="text-blue-600" />
                <span className="branch-name">{gitStatus?.branch || "master"}</span>
              </div>
              <div className="branch-meta">
                <div className="branch-indicator"></div>
                <span className="branch-changes">
                  {gitStatus?.isClean 
                    ? "0 个修改" 
                    : `${(gitStatus?.unstaged.length || 0) + (gitStatus?.untracked.length || 0)} 个修改`
                  }
                </span>
              </div>
            </div>

            <button
              onClick={() => setShowBranchModal(true)}
              className="branch-switch-btn"
            >
              <span>+</span>
              <span>切换或创建分支</span>
            </button>
          </div>

          {/* 远程仓库信息 */}
          <div className="sidebar-section sidebar-section-flex">
            <div className="section-header">
              <span className="section-title">远程仓库</span>
            </div>

            {remotes.length > 0 ? (
              <div className="space-y-md">
                {remotes.map((remote, index) => (
                  <div
                    key={remote.name}
                    className={`remote-card ${index > 0 ? 'remote-card-secondary' : ''}`}
                  >
                    <div className="flex items-center gap-sm mb-xs relative z-10">
                      <div className="remote-icon">
                        <GitBranch size={12} className={index === 0 ? "text-blue-500" : "text-gray-400"} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="remote-name">
                          {remote.name}
                          {index === 0 ? (
                            <span className="remote-badge">当前</span>
                          ) : (
                            <span className="remote-badge-secondary">备用</span>
                          )}
                        </div>
                        <div className="remote-type">{getRemoteType(remote.url)}</div>
                      </div>
                    </div>
                    <div className="remote-url relative z-10">
                      {remote.url}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-xl text-gray-400 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
                <div className="text-sm font-medium">暂无远程仓库</div>
              </div>
            )}

            {/* 同步按钮 */}
            {remotes.length > 0 && (
              <button
                onClick={() => setShowSyncModal(true)}
                className="sync-btn mt-md"
              >
                <Database size={14} />
                <span>同步到其他远程库</span>
              </button>
            )}

            {/* 快捷操作 */}
            <div className="mt-lg">
              <div className="quick-actions-title">快捷操作</div>
              <div className="space-y-xs">
                <button
                  onClick={loadReadme}
                  className="quick-action-btn"
                >
                  <FileText size={14} />
                  <span>查看 README</span>
                </button>
                <button
                  onClick={() => {
                    const editorPath = editors.length > 0 ? editors[0].path : undefined;
                    openInEditor(project.path, editorPath);
                  }}
                  className="quick-action-btn"
                >
                  <Code size={14} />
                  <span>在编辑器中打开</span>
                </button>
                <button
                  onClick={() => {
                    const termType = terminalConfig.type === "default" ? undefined : terminalConfig.type;
                    openInTerminal(project.path, termType, terminalConfig.customPath);
                  }}
                  className="quick-action-btn"
                >
                  <TagIcon size={14} />
                  <span>打开终端</span>
                </button>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content - 完全按照示例 */}
        <main className="project-detail-main">
          {/* 提交历史头部 */}
          <div className="commits-header">
            <div className="commits-title">
              <History size={16} className="text-gray-500" />
              <span className="commits-title-text">最近提交</span>
              <span className="commits-count">{commits.length}</span>
            </div>
            <button
              onClick={loadProjectDetails}
              className="icon-btn"
              title="刷新"
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {/* 提交列表 */}
          <div className="commits-list">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="loading-spinner"></div>
              </div>
            ) : commits.length === 0 ? (
              <div className="empty-state">
                <History size={48} className="empty-state-icon" />
                <p className="empty-state-text">暂无提交记录</p>
              </div>
            ) : (
              commits.map((commit, index) => (
                <div
                  key={commit.hash}
                  className={`commit-card ${index === 0 ? 'commit-card-newest' : ''} animate-slide-up`}
                  style={{ animationDelay: `${index * 0.05}s` }}
                >
                  <div className="flex items-start gap-md">
                    {/* 提交时间线 */}
                    <div className="flex flex-col items-center self-stretch pt-xs">
                      <div className={`commit-dot ${index === 0 ? 'commit-dot' : ''}`}></div>
                      {index !== commits.length - 1 && <div className="commit-line"></div>}
                    </div>
                    
                    {/* 提交内容 */}
                    <div className="flex-1 min-w-0 pb-xs">
                      <div className="flex items-start justify-between gap-sm">
                        <div className="flex-1">
                          <div className="flex items-center gap-sm mb-xs">
                            <span className="commit-message line-clamp-1">
                              {commit.message}
                            </span>
                            {index === 0 && (
                              <span className="commit-badge-new">最新</span>
                            )}
                          </div>
                          <div className="flex items-center gap-md text-sm text-gray-600">
                            <span className="commit-hash">
                              {commit.shortHash}
                            </span>
                            <span className="commit-author">
                              <User size={12} />
                              {commit.author}
                            </span>
                            <span className="commit-date">
                              <Clock size={12} />
                              {new Date(commit.date).toLocaleDateString("zh-CN")}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </main>
      </div>

      {/* Category Modal */}
      {showCategoryModal && (
        <div className="modal-overlay animate-fade-in">
          <div className="modal-content animate-scale-in max-w-2xl">
            <div className="modal-header">
              <div>
                <h3 className="modal-title">项目分类与标签</h3>
                <p className="modal-subtitle">为项目设置分类和技术栈标签</p>
              </div>
              <button
                onClick={() => setShowCategoryModal(false)}
                className="modal-close-btn"
              >
                <X size={16} />
              </button>
            </div>

            <div className="modal-body space-y-lg">
              <CategorySelector selectedCategories={selectedCategories} onChange={setSelectedCategories} multiple={true} />
              <div className="border-t border-gray-200 pt-lg">
                <LabelSelector selectedLabels={selectedLabels} onChange={setSelectedLabels} multiple={true} />
              </div>
            </div>

            <div className="modal-footer">
              <button
                onClick={() => setShowCategoryModal(false)}
                className="modal-btn modal-btn-secondary"
              >
                取消
              </button>
              <button
                onClick={handleSaveCategories}
                className="modal-btn modal-btn-primary"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* README Modal */}
      {showReadme && (
        <div className="modal-overlay animate-fade-in">
          <div className="modal-content animate-scale-in max-w-4xl">
            <div className="modal-header">
              <div className="flex items-center gap-sm">
                <FileText size={20} className="text-blue-600" />
                <h3 className="modal-title">README.md</h3>
              </div>
              <button
                onClick={() => setShowReadme(false)}
                className="modal-close-btn"
              >
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              <MarkdownRenderer content={readmeContent} />
            </div>
          </div>
        </div>
      )}

      {/* Sync Remote Modal */}
      {showSyncModal && remotes.length > 0 && (
        <SyncRemoteModal
          projectPath={project.path}
          remotes={remotes}
          sourceRemote={remotes[0].name}
          onClose={() => setShowSyncModal(false)}
          onSuccess={loadProjectDetails}
        />
      )}

      {/* Branch Switch Modal */}
      {showBranchModal && gitStatus && (
        <BranchSwitchModal
          projectPath={project.path}
          currentBranch={gitStatus.branch}
          onClose={() => setShowBranchModal(false)}
          onBranchChange={loadProjectDetails}
        />
      )}
    </div>
  );
}
