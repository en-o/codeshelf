import { useState, useEffect } from "react";
import { X, GitBranch, History, Code, Tag as TagIcon, RefreshCw, CloudUpload, FolderOpen, User, Clock, Edit2, FileText } from "lucide-react";
import { CategorySelector } from "./CategorySelector";
import { LabelSelector } from "./LabelSelector";
import type { Project, GitStatus, CommitInfo, RemoteInfo } from "@/types";
import { getGitStatus, getCommitHistory, getRemotes, gitPull, gitPush } from "@/services/git";
import { openInEditor, openInTerminal, updateProject } from "@/services/db";
import { invoke } from "@tauri-apps/api/core";

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
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showReadme, setShowReadme] = useState(false);
  const [readmeContent, setReadmeContent] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>(project.tags);
  const [selectedLabels, setSelectedLabels] = useState<string[]>(project.labels || []);

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
    if (!gitStatus || remotes.length === 0) return;
    try {
      await gitPull(project.path, remotes[0].name, gitStatus.branch);
      await loadProjectDetails();
    } catch (error) {
      console.error("Failed to pull:", error);
    }
  }

  async function handlePush() {
    if (!gitStatus || remotes.length === 0) return;
    try {
      await gitPush(project.path, remotes[0].name, gitStatus.branch);
      await loadProjectDetails();
    } catch (error) {
      console.error("Failed to push:", error);
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
    } catch (error) {
      console.error("Failed to update categories:", error);
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
    <div className="fixed inset-0 bg-gray-50 z-50 flex flex-col">
      {/* Header - 完全按照 example-projectPanel.html */}
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
            <GitBranch className="text-white" size={20} />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="font-bold text-gray-900 text-base tracking-tight">{project.name}</h1>

              {/* Category Tags */}
              <div className="flex items-center gap-2 flex-wrap">
                {project.tags.map((tag) => (
                  <span
                    key={tag}
                    className="category-tag px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200 flex items-center gap-1.5"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                    <span>{tag}</span>
                  </span>
                ))}
                <button
                  onClick={() => setShowCategoryModal(true)}
                  className="group flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-blue-600 hover:bg-blue-50 border border-transparent hover:border-blue-200 transition-all"
                >
                  <Edit2 size={10} className="opacity-70 group-hover:opacity-100" />
                  <span>{project.tags.length > 0 ? "编辑分类" : "设置分类"}</span>
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 flex items-center gap-1.5 font-mono">
              <FolderOpen size={12} className="text-gray-400" />
              {project.path}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handlePull}
            className="px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs flex items-center gap-2 transition-colors border border-gray-300"
          >
            <RefreshCw size={14} className="text-gray-600" />
            <span>拉取</span>
          </button>
          <button
            onClick={handlePush}
            className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs flex items-center gap-2 transition-colors shadow-md shadow-blue-500/20"
          >
            <CloudUpload size={14} />
            <span>推送</span>
          </button>
          <div className="w-px h-6 bg-gray-300 mx-1"></div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-md hover:bg-gray-100 flex items-center justify-center text-gray-500 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="flex h-[calc(100vh-64px)]">
        {/* Sidebar - 完全按照 example-projectPanel.html */}
        <aside className="w-72 bg-white border-r border-gray-200 flex flex-col">
          {/* Branch Status - 完全按照示例 */}
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">当前分支</span>
              <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] border border-green-200 font-medium">
                {gitStatus?.isClean ? "已同步" : "有修改"}
              </span>
            </div>

            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 branch-active shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <GitBranch size={16} className="text-blue-600" />
                <span className="font-semibold text-gray-900">{gitStatus?.branch || "master"}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                <span className="font-medium text-orange-600">
                  {gitStatus?.isClean ? "0 个修改" : `${(gitStatus?.unstaged.length || 0) + (gitStatus?.untracked.length || 0)} 个修改`}
                </span>
              </div>
            </div>
          </div>

          {/* Remote Info - 完全按照示例，注意这里有 overflow-y-auto */}
          <div className="p-4 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">远程仓库</span>
            </div>

            {remotes.length > 0 ? (
              <div className="space-y-3">
                {remotes.map((remote) => (
                  <div
                    key={remote.name}
                    className="bg-white rounded-lg p-3 mb-3 border border-blue-200 bg-blue-50/30 shadow-sm relative overflow-hidden"
                  >
                    <div className="absolute top-0 right-0 w-16 h-16 bg-blue-100 rounded-full -mr-8 -mt-8 opacity-50"></div>
                    <div className="flex items-center gap-2 mb-2 relative z-10">
                      <div className="w-6 h-6 rounded-full bg-red-50 flex items-center justify-center border border-red-100">
                        <GitBranch size={12} className="text-red-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-900 flex items-center gap-1">
                          {remote.name}
                          <span className="px-1.5 py-0 rounded bg-blue-100 text-blue-700 text-[9px] font-medium">当前</span>
                        </div>
                        <div className="text-[10px] text-gray-500 truncate">{getRemoteType(remote.url)}</div>
                      </div>
                    </div>
                    <div className="text-[11px] text-gray-600 truncate font-mono bg-white/80 px-2 py-1.5 rounded border border-blue-100 relative z-10">
                      {remote.url}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
                <div className="text-xs font-medium">暂无远程仓库</div>
              </div>
            )}

            {/* Quick Actions - 完全按照示例 */}
            <div className="space-y-1 mt-4">
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 px-1">快捷操作</div>
              <button
                onClick={loadReadme}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-100 text-gray-700 text-xs flex items-center gap-2 transition-colors group"
              >
                <FileText size={14} className="text-gray-400 group-hover:text-blue-600 transition-colors" />
                查看 README
              </button>
              <button
                onClick={() => openInEditor(project.path)}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-100 text-gray-700 text-xs flex items-center gap-2 transition-colors group"
              >
                <Code size={14} className="text-gray-400 group-hover:text-blue-600 transition-colors" />
                在编辑器中打开
              </button>
              <button
                onClick={() => openInTerminal(project.path)}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-100 text-gray-700 text-xs flex items-center gap-2 transition-colors group"
              >
                <TagIcon size={14} className="text-gray-400 group-hover:text-blue-600 transition-colors" />
                打开终端
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content - 完全按照示例 */}
        <main className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
          {/* Commits Header - 完全按照示例 */}
          <div className="h-12 border-b border-gray-200 flex items-center justify-between px-4 bg-white">
            <div className="flex items-center gap-2">
              <History size={16} className="text-gray-500" />
              <span className="font-semibold text-sm text-gray-900">最近提交</span>
              <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
                {commits.length}
              </span>
            </div>
            <button
              onClick={loadProjectDetails}
              className="w-8 h-8 rounded-md hover:bg-gray-100 flex items-center justify-center text-gray-500 transition-colors"
              title="刷新"
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {/* Commits List - 完全按照示例 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent"></div>
              </div>
            ) : commits.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <History size={48} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">暂无提交记录</p>
              </div>
            ) : (
              commits.map((commit, index) => (
                <div
                  key={commit.hash}
                  className="hover-card bg-white rounded-xl p-4 border border-gray-200 hover:border-blue-300 cursor-pointer group"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center self-stretch pt-1">
                      <div
                        className={`w-3 h-3 rounded-full ${
                          index === 0 ? "bg-blue-600 ring-4 ring-blue-100" : "bg-gray-300"
                        } z-10`}
                      ></div>
                      {index !== commits.length - 1 && <div className="w-0.5 flex-1 bg-gray-200 mt-1"></div>}
                    </div>
                    <div className="flex-1 min-w-0 pb-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="font-bold text-sm text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-1">
                              {commit.message}
                            </span>
                            {index === 0 && (
                              <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold border border-blue-200">
                                最新
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-600">
                            <span className="font-mono text-gray-500 bg-gray-100 px-2 py-1 rounded-md border border-gray-200">
                              {commit.short_hash}
                            </span>
                            <span className="flex items-center gap-1 text-gray-500">
                              <User size={12} className="text-gray-400" />
                              {commit.author}
                            </span>
                            <span className="flex items-center gap-1 text-gray-400">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h3 className="text-lg font-bold text-gray-900">项目分类与标签</h3>
                <p className="text-xs text-gray-500 mt-0.5">为项目设置分类和技术栈标签</p>
              </div>
              <button
                onClick={() => setShowCategoryModal(false)}
                className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-all"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              <CategorySelector selectedCategories={selectedCategories} onChange={setSelectedCategories} multiple={true} />
              <div className="border-t border-gray-100 pt-6">
                <LabelSelector selectedLabels={selectedLabels} onChange={setSelectedLabels} multiple={true} />
              </div>
            </div>

            <div className="p-5 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex items-center justify-end gap-2">
              <button
                onClick={() => setShowCategoryModal(false)}
                className="px-4 py-2 rounded-lg text-gray-600 text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveCategories}
                className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium shadow-md shadow-blue-500/20 transition-all"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* README Modal */}
      {showReadme && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <FileText size={20} className="text-blue-600" />
                <h3 className="text-lg font-bold text-gray-900">README.md</h3>
              </div>
              <button
                onClick={() => setShowReadme(false)}
                className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-all"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono leading-relaxed">{readmeContent}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
