import { useState, useEffect } from "react";
import { X, GitBranch, GitCommit, ExternalLink, Terminal, Github, Globe, AlertCircle, CheckCircle, Tag, Edit2, Code } from "lucide-react";
import { Button } from "@/components/ui";
import { CategorySelector } from "./CategorySelector";
import { LabelSelector } from "./LabelSelector";
import type { Project, GitStatus, CommitInfo, RemoteInfo } from "@/types";
import { getGitStatus, getCommitHistory, getRemotes } from "@/services/git";
import { openInEditor, openInTerminal, updateProject } from "@/services/db";
import { useAppStore } from "@/stores/appStore";

interface ProjectDetailDialogProps {
  project: Project;
  onClose: () => void;
  onUpdate?: (project: Project) => void;
}

export function ProjectDetailDialog({ project, onClose, onUpdate }: ProjectDetailDialogProps) {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCategories, setEditingCategories] = useState(false);
  const [editingLabels, setEditingLabels] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(project.tags);
  const [selectedLabels, setSelectedLabels] = useState<string[]>(project.labels || []);
  const { terminalConfig, editors } = useAppStore();

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

  async function handleOpenEditor() {
    try {
      const editorPath = editors.length > 0 ? editors[0].path : undefined;
      await openInEditor(project.path, editorPath);
    } catch (error) {
      console.error("Failed to open in editor:", error);
    }
  }

  async function handleOpenTerminal() {
    try {
      const termType = terminalConfig.type === "default" ? undefined : terminalConfig.type;
      const termPath = terminalConfig.paths?.[terminalConfig.type as keyof typeof terminalConfig.paths];
      await openInTerminal(project.path, termType, terminalConfig.customPath, termPath);
    } catch (error) {
      console.error("Failed to open terminal:", error);
    }
  }

  async function handleSaveCategories() {
    try {
      const updated = await updateProject({
        id: project.id,
        tags: selectedCategories,
      });
      onUpdate?.(updated);
      setEditingCategories(false);
    } catch (error) {
      console.error("Failed to update categories:", error);
    }
  }

  async function handleSaveLabels() {
    try {
      const updated = await updateProject({
        id: project.id,
        labels: selectedLabels,
      });
      onUpdate?.(updated);
      setEditingLabels(false);
    } catch (error) {
      console.error("Failed to update labels:", error);
    }
  }

  return (
    <div className="fixed inset-0 top-8 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-8 py-6 border-b border-gray-200">
          <div className="flex-1 min-w-0 pr-4">
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">
              {project.name}
            </h2>
            <p className="text-sm text-gray-500 truncate font-mono">
              {project.path}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-8 py-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Categories Section */}
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Tag className="w-5 h-5 text-gray-400" />
                    项目分类
                  </h3>
                  {!editingCategories && (
                    <button
                      onClick={() => setEditingCategories(true)}
                      className="text-sm text-blue-500 hover:underline font-medium flex items-center gap-1"
                    >
                      <Edit2 size={14} />
                      编辑
                    </button>
                  )}
                </div>

                {editingCategories ? (
                  <div className="space-y-4">
                    <CategorySelector
                      selectedCategories={selectedCategories}
                      onChange={setSelectedCategories}
                      multiple={true}
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => {
                          setSelectedCategories(project.tags);
                          setEditingCategories(false);
                        }}
                        className="px-4 py-2 border border-gray-200 text-gray-900 rounded-lg hover:bg-gray-100 transition-colors text-sm font-medium"
                      >
                        取消
                      </button>
                      <button
                        onClick={handleSaveCategories}
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {project.tags.length === 0 ? (
                      <span className="text-sm text-gray-500">未设置分类</span>
                    ) : (
                      project.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium"
                        >
                          <Tag size={14} />
                          {tag}
                        </span>
                      ))
                    )}
                  </div>
                )}
              </section>

              {/* Labels Section */}
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Code className="w-5 h-5 text-gray-400" />
                    技术栈标签
                  </h3>
                  {!editingLabels && (
                    <button
                      onClick={() => setEditingLabels(true)}
                      className="text-sm text-blue-500 hover:underline font-medium flex items-center gap-1"
                    >
                      <Edit2 size={14} />
                      编辑
                    </button>
                  )}
                </div>

                {editingLabels ? (
                  <div className="space-y-4">
                    <LabelSelector
                      selectedLabels={selectedLabels}
                      onChange={setSelectedLabels}
                      multiple={true}
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => {
                          setSelectedLabels(project.labels || []);
                          setEditingLabels(false);
                        }}
                        className="px-4 py-2 border border-gray-200 text-gray-900 rounded-lg hover:bg-gray-100 transition-colors text-sm font-medium"
                      >
                        取消
                      </button>
                      <button
                        onClick={handleSaveLabels}
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {(!project.labels || project.labels.length === 0) ? (
                      <span className="text-sm text-gray-500">未设置技术栈标签</span>
                    ) : (
                      project.labels.map((label) => (
                        <span
                          key={label}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium"
                        >
                          {label}
                        </span>
                      ))
                    )}
                  </div>
                )}
              </section>

              {/* Git Status Cards */}
              {gitStatus && (
                <div className="grid grid-cols-2 gap-4">
                  {/* Branch Card */}
                  <div className="bg-gray-50 rounded-xl p-5 border border-gray-200 hover:shadow-sm transition-shadow">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                        <GitBranch className="w-5 h-5 text-blue-500" />
                      </div>
                      <span className="text-sm font-medium text-gray-500">当前分支</span>
                    </div>
                    <p className="text-xl font-semibold text-gray-900 truncate">
                      {gitStatus.branch}
                    </p>
                  </div>

                  {/* Status Card */}
                  <div className="bg-gray-50 rounded-xl p-5 border border-gray-200 hover:shadow-sm transition-shadow">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        gitStatus.isClean ? "bg-green-500/10" : "bg-orange-500/10"
                      }`}>
                        {gitStatus.isClean ? (
                          <CheckCircle className="w-5 h-5 text-green-600" />
                        ) : (
                          <AlertCircle className="w-5 h-5 text-orange-600" />
                        )}
                      </div>
                      <span className="text-sm font-medium text-gray-500">工作区状态</span>
                    </div>
                    <p className={`text-xl font-semibold ${
                      gitStatus.isClean ? "text-green-600" : "text-orange-600"
                    }`}>
                      {gitStatus.isClean ? "干净" : `${gitStatus.unstaged.length + gitStatus.untracked.length} 个修改`}
                    </p>
                  </div>
                </div>
              )}

              {/* Remotes */}
              {remotes.length > 0 && (
                <section>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Globe className="w-5 h-5 text-gray-400" />
                    远程仓库
                  </h3>
                  <div className="space-y-3">
                    {remotes.map((remote) => (
                      <div
                        key={remote.name}
                        className="bg-gray-50 rounded-xl p-5 border border-gray-200 hover:shadow-sm transition-shadow"
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center">
                            {remote.url.includes("github.com") ? (
                              <Github className="w-4 h-4 text-gray-400" />
                            ) : (
                              <Globe className="w-4 h-4 text-gray-400" />
                            )}
                          </div>
                          <span className="font-semibold text-gray-900">
                            {remote.name}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 break-all font-mono ml-11">
                          {remote.url}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Recent Commits */}
              {commits.length > 0 && (
                <section>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <GitCommit className="w-5 h-5 text-gray-400" />
                    最近提交
                  </h3>
                  <div className="space-y-2">
                    {commits.map((commit, index) => (
                      <div
                        key={commit.hash}
                        className="bg-gray-50 rounded-xl p-4 border border-gray-200 hover:shadow-sm transition-shadow"
                      >
                        <div className="flex items-start gap-3">
                          {/* Commit Number */}
                          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-white flex items-center justify-center text-xs font-semibold text-gray-400">
                            {index + 1}
                          </div>

                          <div className="flex-1 min-w-0">
                            {/* Commit Message */}
                            <p className="text-sm font-medium text-gray-900 mb-2 leading-relaxed">
                              {commit.message}
                            </p>

                            {/* Commit Meta */}
                            <div className="flex items-center gap-3 text-xs text-gray-500">
                              <code className="px-2 py-0.5 bg-white rounded font-mono">
                                {commit.shortHash}
                              </code>
                              <span>·</span>
                              <span>{commit.author}</span>
                              <span>·</span>
                              <span>{new Date(commit.date).toLocaleDateString("zh-CN")}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-8 py-6 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={handleOpenEditor}>
              <ExternalLink className="w-4 h-4 mr-2" />
              编辑器
            </Button>
            <Button variant="secondary" onClick={handleOpenTerminal}>
              <Terminal className="w-4 h-4 mr-2" />
              终端
            </Button>
          </div>
          <Button onClick={onClose}>关闭</Button>
        </div>
      </div>
    </div>
  );
}
