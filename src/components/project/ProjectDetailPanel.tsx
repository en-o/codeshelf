import { useState, useEffect } from "react";
import { X, GitBranch, History, Code, Tag as TagIcon, RefreshCw, CloudUpload, FolderOpen, User, Clock, Edit2, FileText, Database, Loader2, GitCommit, Plus, Trash2, Check, Copy, Minus, Maximize2, Minimize2, ChevronDown, ChevronRight, ExternalLink, Files, Mail } from "lucide-react";
import { CategorySelector } from "./CategorySelector";
import { LabelSelector } from "./LabelSelector";
import { SyncRemoteModal } from "./SyncRemoteModal";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { BranchSwitchModal } from "./BranchSwitchModal";
import { GitCommitModal } from "./GitCommitModal";
import { AddRemoteModal } from "./AddRemoteModal";
import { showToast } from "@/components/ui";
import type { Project, GitStatus, CommitInfo, RemoteInfo } from "@/types";
import { getGitStatus, getCommitHistory, getRemotes, gitPull, gitPush, removeRemote } from "@/services/git";
import { openInEditor, openInExplorer, openInTerminal, updateProject, openUrl } from "@/services/db";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface ProjectDetailPanelProps {
  project: Project;
  onClose: () => void;
  onUpdate?: (project: Project) => void;
}

export function ProjectDetailPanel({ project, onClose, onUpdate }: ProjectDetailPanelProps) {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [currentRemote, setCurrentRemote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showReadme, setShowReadme] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [showAddRemoteModal, setShowAddRemoteModal] = useState(false);
  const [readmeContent, setReadmeContent] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>(project.tags);
  const [selectedLabels, setSelectedLabels] = useState<string[]>(project.labels || []);
  // 用于显示的本地项目数据（编辑后立即更新）
  const [localProject, setLocalProject] = useState<Project>(project);
  const { editors, terminalConfig, markProjectDirty } = useAppStore();

  // 提交卡片展开状态
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // 窗口最大化状态
  const [isMaximized, setIsMaximized] = useState(false);

  // 格式化相对时间
  function formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin} 分钟前`;

    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} 小时前`;

    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay} 天前`;

    const diffWeek = Math.floor(diffDay / 7);
    if (diffWeek < 4) return `${diffWeek} 周前`;

    const diffMonth = Math.floor(diffDay / 30);
    if (diffMonth < 12) return `${diffMonth} 个月前`;

    const diffYear = Math.floor(diffDay / 365);
    return `${diffYear} 年前`;
  }

  // 解析引用类型
  function getRefType(ref: string): "head" | "remote" | "tag" | "default" {
    const r = ref.trim().toLowerCase();
    if (r.includes("head") || r.includes("->")) return "head";
    if (r.includes("origin/") || r.includes("upstream/")) return "remote";
    if (r.includes("tag:")) return "tag";
    return "default";
  }

  // 清理引用显示名称
  function cleanRefName(ref: string): string {
    return ref
      .replace("HEAD -> ", "")
      .replace("tag: ", "")
      .trim();
  }

  // 复制哈希到剪贴板
  async function copyHash(hash: string) {
    await navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
    showToast("success", "已复制", "哈希值已复制到剪贴板");
  }

  // 获取远程仓库提交链接
  function getRemoteCommitUrl(hash: string): string | null {
    const remote = remotes.find(r => r.name === currentRemote);
    if (!remote) return null;

    let url = remote.url;
    // 移除 .git 后缀
    if (url.endsWith(".git")) {
      url = url.slice(0, -4);
    }

    // 解析 Git URL
    if (url.includes("github.com")) {
      const match = url.match(/github\.com[:/](.+)$/);
      if (match) return `https://github.com/${match[1]}/commit/${hash}`;
    } else if (url.includes("gitee.com")) {
      const match = url.match(/gitee\.com[:/](.+)$/);
      if (match) return `https://gitee.com/${match[1]}/commit/${hash}`;
    } else if (url.includes("gitlab")) {
      const match = url.match(/gitlab[^/]*[:/](.+)$/);
      if (match) {
        const base = url.startsWith("https://") ? url.split(/[:/]/).slice(0, 3).join("://").replace(":///", "://") : "https://gitlab.com";
        return `${base}/${match[1]}/-/commit/${hash}`;
      }
    }

    return null;
  }

  // 检查窗口最大化状态
  useEffect(() => {
    checkMaximized();
    const handleResize = () => checkMaximized();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  async function checkMaximized() {
    try {
      const appWindow = getCurrentWindow();
      const maximized = await appWindow.isMaximized();
      setIsMaximized(maximized);
    } catch (error) {
      console.error("Failed to check maximized state:", error);
    }
  }

  async function handleToggleMaximize() {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      checkMaximized();
    } catch (error) {
      console.error("Failed to toggle maximize:", error);
    }
  }

  async function handleMinimize() {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.minimize();
    } catch (error) {
      console.error("Failed to minimize:", error);
    }
  }

  // 当外部 project prop 改变时同步本地状态
  useEffect(() => {
    setLocalProject(project);
    setSelectedCategories(project.tags);
    setSelectedLabels(project.labels || []);
  }, [project.id, project.tags, project.labels]);

  useEffect(() => {
    loadProjectDetails();
  }, [project.path]);

  // 当远程列表加载完成后，设置默认当前远程
  useEffect(() => {
    if (remotes.length > 0 && !currentRemote) {
      setCurrentRemote(remotes[0].name);
    }
  }, [remotes, currentRemote]);

  // 当切换远程仓库时，重新获取提交历史
  useEffect(() => {
    if (currentRemote && gitStatus?.branch) {
      loadCommitHistory();
    }
  }, [currentRemote, gitStatus?.branch]);

  async function loadCommitHistory() {
    if (!currentRemote || !gitStatus?.branch) return;
    try {
      // 获取远程分支的提交历史
      const refName = `${currentRemote}/${gitStatus.branch}`;
      const commitHistory = await getCommitHistory(project.path, 10, refName);
      setCommits(commitHistory);
    } catch (error) {
      console.error("Failed to load commit history:", error);
      // 如果远程分支不存在，回退到本地分支的提交历史
      try {
        const localCommits = await getCommitHistory(project.path, 10);
        setCommits(localCommits);
      } catch {
        setCommits([]);
      }
    }
  }

  async function loadProjectDetails() {
    try {
      setLoading(true);
      const [status, remoteList] = await Promise.all([
        getGitStatus(project.path),
        getRemotes(project.path),
      ]);
      setGitStatus(status);
      setRemotes(remoteList);

      // 直接加载提交历史（不依赖 useEffect）
      if (currentRemote && status.branch) {
        const refName = `${currentRemote}/${status.branch}`;
        try {
          const commitHistory = await getCommitHistory(project.path, 10, refName);
          setCommits(commitHistory);
        } catch {
          // 如果远程分支不存在，回退到本地分支的提交历史
          try {
            const localCommits = await getCommitHistory(project.path, 10);
            setCommits(localCommits);
          } catch {
            setCommits([]);
          }
        }
      }
    } catch (error) {
      console.error("Failed to load project details:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handlePull() {
    if (!gitStatus || !currentRemote || pulling) return;
    try {
      setPulling(true);
      await gitPull(project.path, currentRemote, gitStatus.branch);
      await loadProjectDetails();
      markProjectDirty(project.path); // Mark for stats refresh
      showToast("success", "拉取成功", `已从 ${currentRemote}/${gitStatus.branch} 拉取最新代码`);
    } catch (error) {
      console.error("Failed to pull:", error);
      showToast("error", "拉取失败", String(error));
    } finally {
      setPulling(false);
    }
  }

  async function handlePush() {
    if (!gitStatus || !currentRemote || pushing) return;
    try {
      setPushing(true);
      await gitPush(project.path, currentRemote, gitStatus.branch);
      await loadProjectDetails();
      markProjectDirty(project.path); // Mark for stats refresh
      showToast("success", "推送成功", `已推送到 ${currentRemote}/${gitStatus.branch}`);
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

  async function handleRemoveRemote(remoteName: string) {
    if (!confirm(`确定要删除远程仓库 "${remoteName}" 吗？`)) {
      return;
    }
    try {
      await removeRemote(project.path, remoteName);
      await loadProjectDetails();
      showToast("success", "删除成功", `远程仓库 ${remoteName} 已删除`);
    } catch (error) {
      console.error("Failed to remove remote:", error);
      showToast("error", "删除失败", String(error));
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
          <button
            onClick={onClose}
            className="icon-btn"
            title="关闭面板"
          >
            <X size={16} />
          </button>
          {/* 窗口控制按钮 */}
          <div className="flex items-center ml-1 border-l border-gray-200 pl-2 gap-1">
            <button
              onClick={handleToggleMaximize}
              className="w-7 h-7 flex items-center justify-center hover:bg-gray-100 rounded-md transition-colors text-gray-400 hover:text-gray-600"
              title={isMaximized ? "还原" : "最大化"}
            >
              {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button
              onClick={handleMinimize}
              className="w-7 h-7 flex items-center justify-center hover:bg-gray-100 rounded-md transition-colors text-gray-400 hover:text-gray-600"
              title="最小化"
            >
              <Minus size={14} />
            </button>
            <button
              onClick={() => getCurrentWindow()?.close()}
              className="w-7 h-7 flex items-center justify-center hover:bg-red-500 hover:text-white rounded-md transition-colors text-gray-400"
              title="关闭窗口"
            >
              <X size={14} />
            </button>
          </div>
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
                {[...remotes]
                  .sort((a, b) => {
                    // 当前远程仓库排在第一位
                    if (a.name === currentRemote) return -1;
                    if (b.name === currentRemote) return 1;
                    return 0;
                  })
                  .map((remote) => {
                  const isCurrent = remote.name === currentRemote;
                  return (
                    <div
                      key={remote.name}
                      className={`remote-card ${!isCurrent ? 'remote-card-secondary' : ''}`}
                    >
                      <div className="flex items-center gap-sm mb-xs relative z-10">
                        <div className="remote-icon">
                          <GitBranch size={12} className={isCurrent ? "text-blue-500" : "text-gray-400"} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="remote-name">
                            {remote.name}
                            {isCurrent ? (
                              <span className="remote-badge">当前</span>
                            ) : (
                              <span className="remote-badge-secondary">备用</span>
                            )}
                          </div>
                          <div className="remote-type">{getRemoteType(remote.url)}</div>
                        </div>
                        {/* 非当前仓库可切换和删除 */}
                        {!isCurrent && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                setCurrentRemote(remote.name);
                                showToast("success", "切换成功", `已切换到远程仓库 ${remote.name}`);
                              }}
                              className="p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors"
                              title="设为当前远程仓库"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={() => handleRemoveRemote(remote.name)}
                              className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                              title="删除此远程仓库"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="remote-url relative z-10">
                        {remote.url}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-xl text-gray-400 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
                <div className="text-sm font-medium mb-3">暂无远程仓库</div>
                <button
                  onClick={() => setShowAddRemoteModal(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                  <Plus size={14} />
                  添加远程仓库
                </button>
              </div>
            )}

            {/* 同步按钮 */}
            {remotes.length > 0 && (
              <div className="flex gap-sm mt-md">
                <button
                  onClick={() => setShowAddRemoteModal(true)}
                  className="flex-1 flex items-center justify-center gap-sm px-md py-sm bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100 transition-colors text-sm font-medium border border-gray-200"
                >
                  <Plus size={14} />
                  <span>添加远程</span>
                </button>
                <button
                  onClick={() => setShowSyncModal(true)}
                  className="flex-1 sync-btn"
                >
                  <Database size={14} />
                  <span>同步远程库</span>
                </button>
              </div>
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
                  onClick={async () => {
                    try {
                      await openInExplorer(project.path);
                    } catch (error) {
                      console.error("Failed to open explorer:", error);
                      showToast("error", "打开文件夹失败", String(error));
                    }
                  }}
                  className="quick-action-btn"
                >
                  <FolderOpen size={14} />
                  <span>打开文件夹</span>
                </button>
                <button
                  onClick={async () => {
                    try {
                      const termType = terminalConfig.type === "default" ? undefined : terminalConfig.type;
                      const termPath = terminalConfig.paths?.[terminalConfig.type as keyof typeof terminalConfig.paths];
                      console.log("Opening terminal:", { path: project.path, termType, customPath: terminalConfig.customPath, termPath });
                      await openInTerminal(project.path, termType, terminalConfig.customPath, termPath);
                    } catch (error) {
                      console.error("Failed to open terminal:", error);
                      showToast("error", "打开终端失败", String(error));
                    }
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
              commits.map((commit, index) => {
                const isExpanded = expandedCommit === commit.hash;
                const remoteUrl = getRemoteCommitUrl(commit.hash);

                return (
                  <div
                    key={commit.hash}
                    className={`commit-card ${index === 0 ? 'commit-card-newest' : ''} ${isExpanded ? 'commit-card-expanded' : ''} animate-slide-up`}
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
                        {/* 头部 - 点击展开/收起 */}
                        <div
                          className="flex items-start justify-between gap-sm cursor-pointer"
                          onClick={() => setExpandedCommit(isExpanded ? null : commit.hash)}
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-sm mb-xs">
                              <button className="commit-expand-toggle">
                                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              </button>
                              <span className="commit-message line-clamp-1">
                                {commit.message}
                              </span>
                              {index === 0 && (
                                <span className="commit-badge-new">最新</span>
                              )}
                            </div>
                            <div className="flex items-center gap-md text-sm text-gray-600 ml-6">
                              <span className="commit-hash">
                                {commit.shortHash}
                              </span>
                              <span className="commit-author">
                                <User size={12} />
                                {commit.author}
                              </span>
                              <span
                                className="commit-date"
                                title={new Date(commit.date).toLocaleString("zh-CN")}
                              >
                                <Clock size={12} />
                                {formatRelativeTime(commit.date)}
                              </span>
                            </div>

                            {/* 文件变更统计 */}
                            {(commit.filesChanged !== undefined || commit.insertions !== undefined || commit.deletions !== undefined) && (
                              <div className="commit-stats ml-6">
                                {commit.filesChanged !== undefined && (
                                  <span className="commit-stat-files">
                                    <Files size={11} />
                                    {commit.filesChanged} 文件
                                  </span>
                                )}
                                {commit.insertions !== undefined && commit.insertions > 0 && (
                                  <span className="commit-stat-add">+{commit.insertions}</span>
                                )}
                                {commit.deletions !== undefined && commit.deletions > 0 && (
                                  <span className="commit-stat-del">-{commit.deletions}</span>
                                )}
                              </div>
                            )}

                            {/* 分支/标签引用 */}
                            {commit.refs && commit.refs.length > 0 && (
                              <div className="commit-refs ml-6">
                                {commit.refs.map((ref, i) => {
                                  const refType = getRefType(ref);
                                  const refClass = refType === "head" ? "ref-tag-head" :
                                                   refType === "remote" ? "ref-tag-remote" :
                                                   refType === "tag" ? "ref-tag-tag" : "";
                                  return (
                                    <span key={i} className={`ref-tag ${refClass}`}>
                                      {cleanRefName(ref)}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* 展开详情 */}
                        {isExpanded && (
                          <div className="commit-detail ml-6">
                            {/* 提交描述 */}
                            {commit.body && (
                              <div className="commit-body">{commit.body}</div>
                            )}

                            {/* 完整哈希 */}
                            <div className="commit-full-hash">
                              <span>完整哈希:</span>
                              <code>{commit.hash}</code>
                            </div>

                            {/* 作者邮箱 */}
                            <div className="commit-full-hash">
                              <Mail size={12} />
                              <span>{commit.email}</span>
                            </div>

                            {/* 快捷操作 */}
                            <div className="commit-actions">
                              <button
                                className={`commit-action-btn ${copiedHash === commit.hash ? 'commit-action-btn-success' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyHash(commit.hash);
                                }}
                              >
                                {copiedHash === commit.hash ? <Check size={12} /> : <Copy size={12} />}
                                {copiedHash === commit.hash ? "已复制" : "复制哈希"}
                              </button>
                              {remoteUrl && (
                                <button
                                  className="commit-action-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openUrl(remoteUrl);
                                  }}
                                >
                                  <ExternalLink size={12} />
                                  在远程查看
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
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
          onSuccess={loadProjectDetails}
        />
      )}
    </div>
  );
}
