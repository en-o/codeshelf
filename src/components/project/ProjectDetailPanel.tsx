import { useState, useEffect, useRef } from "react";
import { X, GitBranch, RefreshCw, CloudUpload, FolderOpen, Edit2, FileText, Loader2, GitCommit, Copy, ArrowRightLeft, ArrowLeft } from "lucide-react";
import { MacWindowControls } from "@/components/layout/MacWindowControls";
import { CategorySelector } from "./CategorySelector";
import { LabelSelector } from "./LabelSelector";
import { SyncRemoteModal } from "./SyncRemoteModal";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ReadmeSection } from "./ReadmeSection";
import { BranchSwitchModal } from "./BranchSwitchModal";
import { GitCommitModal } from "./GitCommitModal";
import { AddRemoteModal } from "./AddRemoteModal";
import { EditorContextMenu } from "./EditorContextMenu";
import { TerminalContextMenu } from "./TerminalContextMenu";
import { ProjectQuickActions } from "./ProjectQuickActions";
import { useProjectGitActions } from "./useProjectGitActions";
import { CommitHistoryPanel } from "./git/CommitHistoryPanel";
import { GitSidebar } from "./git/GitSidebar";
import { showToast } from "@/components/ui";
import type { Project, GitStatus, CommitInfo, RemoteInfo } from "@/types";
import {
  getGitStatus,
  getCommitHistory,
  getRemotes,
  searchCommits,
  type ConflictFileContent,
} from "@/services/git";
import { updateProject } from "@/services/db";
import { invoke } from "@tauri-apps/api/core";
import { useUiStore } from "@/stores/uiStore";
import { useProjectsStore } from "@/stores/projectsStore";
import { useAiProvidersStore } from "@/stores/aiProvidersStore";
import { createChatSession, saveChatSession } from "@/services/chat";

/**
 * 用户显式选择的远程按项目持久化。
 *
 * 不进 Project schema：这是纯 UI 偏好，加字段要动数据迁移，
 * 而项目里已经有 localStorage 存 UI 偏好的先例（chat.sessionListCollapsed）。
 */
const PREFERRED_REMOTE_KEY = "project.preferredRemote";

function loadPreferredRemote(projectId: string): string | null {
  try {
    const raw = localStorage.getItem(PREFERRED_REMOTE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    return typeof map[projectId] === "string" ? map[projectId] : null;
  } catch {
    return null;
  }
}

function savePreferredRemote(projectId: string, remote: string) {
  try {
    const raw = localStorage.getItem(PREFERRED_REMOTE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[projectId] = remote;
    localStorage.setItem(PREFERRED_REMOTE_KEY, JSON.stringify(map));
  } catch {
    /* 隐私模式等场景写不了 localStorage，退化成不记忆即可 */
  }
}

interface ProjectDetailPanelProps {
  project: Project;
  onClose: () => void;
  onUpdate?: (project: Project) => void;
  onSwitchProject?: (project: Project) => void;
}

export function ProjectDetailPanel({ project, onClose, onUpdate, onSwitchProject }: ProjectDetailPanelProps) {
  // 每次切项目自增。所有异步 Git 结果落回 state 之前都要核对这个序号 ——
  // 否则慢仓库的响应会晚到并覆盖新项目的数据，而操作 handler 已经指向新路径了，
  // 结果就是拿旧仓库的 commit hash / 文件名去对新仓库做 discard / revert / cherry-pick。
  const loadTokenRef = useRef(0);
  const isStale = (token: number) => loadTokenRef.current !== token;

  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [currentRemote, setCurrentRemote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showReadme, setShowReadme] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [showAddRemoteModal, setShowAddRemoteModal] = useState(false);
  const [conflictPreview, setConflictPreview] = useState<ConflictFileContent | null>(null);
  const [showEditorMenu, setShowEditorMenu] = useState<{ x: number; y: number } | null>(null);
  const [showTerminalMenu, setShowTerminalMenu] = useState<{ x: number; y: number } | null>(null);
  const [readmeContent, setReadmeContent] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>(project.tags);
  const [selectedLabels, setSelectedLabels] = useState<string[]>(project.labels || []);
  const [localProject, setLocalProject] = useState<Project>(project);
  const markProjectDirty = useProjectsStore((s) => s.markProjectDirty);
  const projects = useProjectsStore((s) => s.projects);
  const recentDetailProjectIds = useProjectsStore((s) => s.recentDetailProjectIds);
  const addRecentDetailProject = useProjectsStore((s) => s.addRecentDetailProject);
  const navigateToChatSession = useUiStore((s) => s.navigateToChatSession);
  const aiProviders = useAiProvidersStore((s) => s.aiProviders);
  const ensureAiDefaultProvider = useAiProvidersStore((s) => s.ensureAiDefaultProvider);
  const setCurrentPage = useUiStore((s) => s.setCurrentPage);
  // 从 store 读取最新项目数据（编辑器/Claude 环境切换后立即刷新）
  const storeProject = projects.find((p) => p.id === project.id) || project;

  // 提交卡片展开状态
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [searchQuery, setSearchQuery] = useState("");
  const [commitView, setCommitView] = useState<"history" | "ahead" | "behind">("history");

  const {
    pulling,
    pushing,
    handlePull,
    handlePush,
    handleStageFiles,
    handleUnstageFiles,
    handleDiscardFiles,
    handleFetchRemote,
    handleCopyCommitMessage,
    handleRevertCommit,
    handleCherryPickCommit,
    handlePreviewConflict,
    handleUseConflictVersion,
    handleMarkResolved,
    handleRemoveRemote,
  } = useProjectGitActions({
    projectPath: project.path,
    gitStatus,
    currentRemote,
    refresh: loadProjectDetails,
    setConflictPreview,
  });

  // 获取最近打开的项目列表（排除当前项目）
  const recentProjects = recentDetailProjectIds
    .filter((id) => id !== project.id)
    .map((id) => projects.find((p) => p.id === id))
    .filter((p): p is Project => p !== undefined)
    .slice(0, 8);

  // 记录当前项目到最近打开历史
  useEffect(() => {
    addRecentDetailProject(project.id);
  }, [project.id, addRecentDetailProject]);

  // 复制哈希到剪贴板
  async function copyHash(hash: string) {
    await navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
    showToast("success", "已复制", "哈希值已复制到剪贴板");
  }

  // 当外部 project prop 改变时同步本地状态
  useEffect(() => {
    setLocalProject(project);
    setSelectedCategories(project.tags);
    setSelectedLabels(project.labels || []);
  }, [project.id, project.tags, project.labels]);

  useEffect(() => {
    // 立刻清空旧仓库数据：切换瞬间界面上不能还留着上一个仓库的状态和提交列表
    const token = ++loadTokenRef.current;
    setGitStatus(null);
    setCommits([]);
    setRemotes([]);
    setCurrentRemote(null);
    loadProjectDetails(token);
  }, [project.path, historyLimit]);

  // 默认远程的真相源，优先级从高到低：
  //   1. 用户为**这个项目**显式选过的（持久化，重启和切项目都不会漂）
  //   2. 当前分支的 upstream —— ahead/behind 和待推拉列表都是按它算的，
  //      默认操作目标必须与统计目标一致
  //   3. 名为 origin 的远程
  //   4. 列表第一个（后端已按名字排序，不再是 HashMap 的随机序）
  //
  // 以前直接取 remotes[0]，而后端用 HashMap.into_values() 返回，顺序不稳定：
  // 同时存在 origin / upstream / backup 时，默认推送目标每次都可能不一样。
  useEffect(() => {
    if (remotes.length === 0 || currentRemote) return;
    const names = remotes.map((r) => r.name);
    const remembered = loadPreferredRemote(project.id);
    const next =
      (remembered && names.includes(remembered) && remembered) ||
      (gitStatus?.upstreamRemote && names.includes(gitStatus.upstreamRemote)
        ? gitStatus.upstreamRemote
        : null) ||
      (names.includes("origin") ? "origin" : null) ||
      names[0];
    setCurrentRemote(next);
  }, [remotes, currentRemote, gitStatus?.upstreamRemote, project.id]);

  /** 用户显式改选远程：记住这个项目的选择 */
  function handleSelectRemote(name: string) {
    setCurrentRemote(name);
    savePreferredRemote(project.id, name);
  }

  // 当切换远程仓库时，重新获取提交历史
  useEffect(() => {
    if (commitView === "history" && currentRemote && gitStatus?.branch) {
      loadCommitHistory();
    }
  }, [currentRemote, gitStatus?.branch, historyLimit, commitView]);

  useEffect(() => {
    if (commitView !== "history") {
      return;
    }

    const query = searchQuery.trim();
    if (!query) {
      loadCommitHistory();
      return;
    }

    const token = loadTokenRef.current;
    const timer = window.setTimeout(async () => {
      try {
        setLoading(true);
        const result = await searchCommits(project.path, query, "message", 50);
        if (isStale(token)) return;
        setCommits(result);
      } catch (error) {
        console.error("Failed to search commits:", error);
        if (!isStale(token)) setCommits([]);
      } finally {
        if (!isStale(token)) setLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [project.path, searchQuery, commitView]);

  async function loadCommitHistory() {
    if (!gitStatus?.branch) return;
    const token = loadTokenRef.current;
    try {
      const commitHistory = await getCommitHistory(project.path, historyLimit);
      if (isStale(token)) return;
      setCommits(commitHistory);
    } catch (error) {
      console.error("Failed to load commit history:", error);
      try {
        const localCommits = await getCommitHistory(project.path, historyLimit);
        if (isStale(token)) return;
        setCommits(localCommits);
      } catch {
        if (!isStale(token)) setCommits([]);
      }
    }
  }

  async function loadDivergenceCommits(view: "ahead" | "behind") {
    const token = loadTokenRef.current;
    try {
      setLoading(true);
      setSearchQuery("");
      setCommitView(view);
      const range = view === "ahead" ? "@{upstream}..HEAD" : "HEAD..@{upstream}";
      const result = await getCommitHistory(project.path, historyLimit, range);
      if (isStale(token)) return;
      setCommits(result);
    } catch (error) {
      console.error("Failed to load divergence commits:", error);
      if (isStale(token)) return;
      setCommits([]);
      showToast("error", view === "ahead" ? "读取待推送提交失败" : "读取待拉取提交失败", "当前分支可能没有设置 upstream，或需要先执行 git fetch");
    } finally {
      setLoading(false);
    }
  }

  async function showRecentCommits() {
    setCommitView("history");
    await loadCommitHistory();
  }

  async function loadProjectDetails(token = loadTokenRef.current) {
    try {
      setLoading(true);
      const [status, remoteList] = await Promise.all([
        getGitStatus(project.path),
        getRemotes(project.path),
      ]);
      if (isStale(token)) return;
      setGitStatus(status);
      setRemotes(remoteList);
      if (commitView !== "history") {
        const range = commitView === "ahead" ? "@{upstream}..HEAD" : "HEAD..@{upstream}";
        try {
          const commitHistory = await getCommitHistory(project.path, historyLimit, range);
          if (isStale(token)) return;
          setCommits(commitHistory);
        } catch {
          if (!isStale(token)) setCommits([]);
        }
        return;
      }

      if (status.branch) {
        try {
          const commitHistory = await getCommitHistory(project.path, historyLimit);
          if (isStale(token)) return;
          setCommits(commitHistory);
        } catch {
          try {
            const localCommits = await getCommitHistory(project.path, historyLimit);
            if (isStale(token)) return;
            setCommits(localCommits);
          } catch {
            if (!isStale(token)) setCommits([]);
          }
        }
      }
    } catch (error) {
      console.error("Failed to load project details:", error);
    } finally {
      if (!isStale(token)) setLoading(false);
    }
  }

  async function handleOpenProjectChat() {
    const providers = ensureAiDefaultProvider(aiProviders);
    const provider = providers.find((item) => item.enabled && item.isDefaultProvider) || providers.find((item) => item.enabled);
    const model = provider?.models.find((item) => item.enabled && item.isDefault) || provider?.models.find((item) => item.enabled);

    if (!provider || !model) {
      showToast("warning", "请先配置 AI 模型", "需要可用的供应商与模型后才能创建项目会话");
      setCurrentPage("aiProviders");
      return;
    }

    try {
      const session = await createChatSession({
        title: `${project.name} 对话`,
        providerId: provider.id,
        modelId: model.id,
      });
      const saved = await saveChatSession({
        ...session,
        allowedCwd: project.path,
      });
      navigateToChatSession(saved.id);
      showToast("success", "已创建项目会话", `目录已设置为 ${project.name}`);
    } catch (error) {
      console.error("Failed to create project chat:", error);
      showToast("error", "创建项目会话失败", String(error));
    }
  }

  async function handleSaveCategories() {
    try {
      const updated = await updateProject({
        id: project.id,
        tags: selectedCategories,
        labels: selectedLabels,
      });
      // 更新本地状态以立即反映变化
      setLocalProject(updated);
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



  return (
    <div className="project-detail-panel">
      {/* Header - 完全按照 example-projectPanel.html */}
      <header className="project-detail-header" data-tauri-drag-region>
        <div className="flex items-center gap-md">
          {/* 项目图标 */}
          <div className="project-icon">
            <GitBranch className="text-white" size={20} />
          </div>

          <div className="flex flex-col gap-xs">
            <div className="flex items-center gap-md">
              {/* 项目名称 */}
              <h1 className="font-bold text-gray-900 text-base tracking-tight">{localProject.name}</h1>

              {/* 分类标签区域 - 分类和标签分开显示，限制显示数量 */}
              <div className="flex items-center gap-md flex-wrap">
                {/* 分类 - 最多显示2个 */}
                {localProject.tags.length > 0 && (
                  <div className="flex items-center gap-sm">
                    <span className="text-xs text-gray-400">分类:</span>
                    {localProject.tags.slice(0, 2).map((tag) => (
                      <span
                        key={tag}
                        className="category-tag"
                      >
                        <span className="category-tag-dot"></span>
                        <span>{tag}</span>
                      </span>
                    ))}
                    {localProject.tags.length > 2 && (
                      <span
                        className="category-tag cursor-pointer"
                        title={localProject.tags.slice(2).join(", ")}
                        onClick={() => setShowCategoryModal(true)}
                      >
                        +{localProject.tags.length - 2}
                      </span>
                    )}
                  </div>
                )}

                {/* 分隔符 */}
                {localProject.tags.length > 0 && localProject.labels && localProject.labels.length > 0 && (
                  <span className="text-gray-300">|</span>
                )}

                {/* 技术栈标签 - 最多显示3个 */}
                {localProject.labels && localProject.labels.length > 0 && (
                  <div className="flex items-center gap-sm">
                    <span className="text-xs text-gray-400">标签:</span>
                    {localProject.labels.slice(0, 3).map((label) => (
                      <span
                        key={label}
                        className="label-tag"
                      >
                        {label}
                      </span>
                    ))}
                    {localProject.labels.length > 3 && (
                      <span
                        className="label-tag cursor-pointer"
                        title={localProject.labels.slice(3).join(", ")}
                        onClick={() => setShowCategoryModal(true)}
                      >
                        +{localProject.labels.length - 3}
                      </span>
                    )}
                  </div>
                )}

                <button
                  onClick={() => setShowCategoryModal(true)}
                  className="edit-category-btn"
                >
                  <Edit2 size={10} className="opacity-70 group-hover:opacity-100" />
                  <span>{localProject.tags.length > 0 || (localProject.labels && localProject.labels.length > 0) ? "编辑" : "设置分类"}</span>
                </button>
              </div>
            </div>

            {/* 项目路径 */}
            <div className="flex items-center gap-xs">
              <p
                className="project-path cursor-pointer hover:text-blue-600 transition-colors"
                title="点击复制路径"
                onClick={() => {
                  navigator.clipboard.writeText(localProject.path);
                  showToast("success", "已复制", "路径已复制到剪贴板");
                }}
              >
                <FolderOpen size={12} className="text-gray-400" />
                {localProject.path}
                <Copy size={11} className="text-gray-400 ml-1" />
              </p>
              {/^[A-Za-z]:[\\/]/.test(localProject.path) && (
                <button
                  className="text-xs text-gray-400 hover:text-blue-600 transition-colors px-1.5 py-0.5 rounded hover:bg-blue-50 whitespace-nowrap"
                  title="复制 WSL 路径"
                  onClick={() => {
                    const wslPath = localProject.path
                      .replace(/^([A-Za-z]):/, (_m, drive: string) => `/mnt/${drive.toLowerCase()}`)
                      .replace(/\\/g, "/");
                    navigator.clipboard.writeText(wslPath);
                    showToast("success", "已复制", `WSL 路径: ${wslPath}`);
                  }}
                >
                  WSL
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 操作按钮组 */}
        <div className="flex items-center gap-sm">
          {/* 提交按钮 - 只在有未提交修改时高亮 */}
          <button
            onClick={() => setShowCommitModal(true)}
            className={`action-btn ${gitStatus && !gitStatus.isClean ? 'action-btn-warning' : 'action-btn-secondary'}`}
          >
            <GitCommit size={14} />
            <span>提交</span>
          </button>
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
          {/* 关闭详情面板 - 文字 + 左箭头，明显区别于右侧 macOS 窗口控制按钮 */}
          <button
            onClick={onClose}
            className="back-to-shelf-btn"
            title="返回项目书架（仅关闭详情面板，不关闭窗口）"
          >
            <ArrowLeft size={14} />
            <span>返回书架</span>
          </button>
          {/* 窗口控制按钮 - 与主面板保持一致 */}
          <MacWindowControls />
        </div>
      </header>

      {/* 主体内容 */}
      <div className="project-detail-content flex flex-1 pt-[4.5rem]">
        {/* Sidebar */}
        <aside className="project-detail-sidebar">
          <GitSidebar
            gitStatus={gitStatus}
            remotes={remotes}
            currentRemote={currentRemote}
            onOpenBranchModal={() => setShowBranchModal(true)}
            onAddRemote={() => setShowAddRemoteModal(true)}
            onOpenSyncModal={() => setShowSyncModal(true)}
            onSelectRemote={(remoteName) => {
              handleSelectRemote(remoteName);
              showToast("success", "切换成功", `已切换到远程仓库 ${remoteName}`);
            }}
            onRemoveRemote={handleRemoveRemote}
            onFetchRemote={handleFetchRemote}
            onStageFiles={handleStageFiles}
            onUnstageFiles={handleUnstageFiles}
            onDiscardFiles={handleDiscardFiles}
            onPreviewConflict={handlePreviewConflict}
          />

          <ProjectQuickActions
            project={project}
            storeProject={storeProject}
            onLoadReadme={loadReadme}
            onOpenProjectChat={handleOpenProjectChat}
            onShowEditorMenu={setShowEditorMenu}
            onShowTerminalMenu={setShowTerminalMenu}
          />
        </aside>

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <div className="ml-72 px-4 pt-3 pb-1 flex-shrink-0">
            <ReadmeSection
              projectPath={project.path}
              onOpenFullView={(c) => {
                setReadmeContent(c);
                setShowReadme(true);
              }}
            />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <CommitHistoryPanel
              projectPath={project.path}
              commits={commits}
              remotes={remotes}
              gitStatus={gitStatus}
              currentRemote={currentRemote}
              loading={loading}
              expandedCommit={expandedCommit}
              copiedHash={copiedHash}
              searchQuery={searchQuery}
              historyLimit={historyLimit}
              activeView={commitView}
              onRefresh={loadProjectDetails}
              onShowHistory={showRecentCommits}
              onShowAhead={() => loadDivergenceCommits("ahead")}
              onShowBehind={() => loadDivergenceCommits("behind")}
              onSearchChange={setSearchQuery}
              onLoadMore={() => setHistoryLimit((limit) => limit + 20)}
              onToggleCommit={(hash) => setExpandedCommit(expandedCommit === hash ? null : hash)}
              onCopyHash={copyHash}
              onCopyMessage={handleCopyCommitMessage}
              onRevertCommit={handleRevertCommit}
              onCherryPickCommit={handleCherryPickCommit}
            />
          </div>
        </div>
      </div>

      {/* 快速切换页脚 */}
      {recentProjects.length > 0 && onSwitchProject && (
        <footer className="panel-footer">
          <div className="panel-footer-label">
            <ArrowRightLeft size={12} />
            <span>快速切换</span>
          </div>
          <div className="panel-footer-projects">
            {recentProjects.map((p) => (
              <button
                key={p.id}
                onClick={() => onSwitchProject(p)}
                className="footer-project-btn"
                title={p.path}
              >
                <GitBranch size={12} />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        </footer>
      )}

      {conflictPreview && (
        <div className="modal-overlay animate-fade-in">
          <div className="modal-content animate-scale-in max-w-6xl">
            <div className="modal-header">
              <div>
                <h3 className="modal-title">冲突对比</h3>
                <p className="modal-subtitle">{conflictPreview.file}</p>
              </div>
              <button onClick={() => setConflictPreview(null)} className="modal-close-btn">
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="conflict-compare-grid">
                <ConflictColumn title="共同祖先" content={conflictPreview.base} />
                <ConflictColumn title="当前分支版本" content={conflictPreview.current} />
                <ConflictColumn title="传入分支版本" content={conflictPreview.incoming} />
              </div>
              <div className="conflict-worktree-panel">
                <div className="commit-files-title">当前工作区文件</div>
                <pre>{conflictPreview.worktree || "无法读取当前文件内容"}</pre>
              </div>
            </div>
            <div className="modal-footer">
              <button className="modal-btn modal-btn-secondary" onClick={() => handleUseConflictVersion(conflictPreview.file, "ours")}>
                采用当前分支版本
              </button>
              <button className="modal-btn modal-btn-secondary" onClick={() => handleUseConflictVersion(conflictPreview.file, "theirs")}>
                采用传入分支版本
              </button>
              <button className="modal-btn modal-btn-primary" onClick={() => handleMarkResolved(conflictPreview.file)}>
                已手动解决，标记完成
              </button>
            </div>
          </div>
        </div>
      )}

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
              <MarkdownRenderer content={readmeContent} basePath={project.path} />
            </div>
          </div>
        </div>
      )}

      {/* Sync Remote Modal */}
      {showSyncModal && remotes.length > 0 && currentRemote && (
        <SyncRemoteModal
          projectPath={project.path}
          remotes={remotes}
          sourceRemote={currentRemote}
          onClose={() => setShowSyncModal(false)}
          onSuccess={() => {
            loadProjectDetails();
            markProjectDirty(project.path);
          }}
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

      {/* Git Commit Modal */}
      {showCommitModal && (
        <GitCommitModal
          projectPath={project.path}
          currentRemote={currentRemote}
          currentBranch={gitStatus?.branch}
          onClose={() => setShowCommitModal(false)}
          onSuccess={() => {
            loadProjectDetails();
            markProjectDirty(project.path);
          }}
        />
      )}

      {/* Add Remote Modal */}
      {showAddRemoteModal && (
        <AddRemoteModal
          projectPath={project.path}
          onClose={() => setShowAddRemoteModal(false)}
          onSuccess={() => loadProjectDetails()}
        />
      )}

      {/* Editor Context Menu */}
      {showEditorMenu && (
        <EditorContextMenu
          project={storeProject}
          position={showEditorMenu}
          onClose={() => setShowEditorMenu(null)}
        />
      )}

      {/* Terminal Context Menu (includes Claude Code) */}
      {showTerminalMenu && (
        <TerminalContextMenu
          project={storeProject}
          position={showTerminalMenu}
          onClose={() => setShowTerminalMenu(null)}
        />
      )}
    </div>
  );
}

function ConflictColumn({ title, content }: { title: string; content?: string | null }) {
  return (
    <div className="conflict-column">
      <div className="commit-files-title">{title}</div>
      <pre>{content || "此版本不存在或无法读取"}</pre>
    </div>
  );
}
