import { useState, useEffect } from "react";
import { X, GitCommit, CloudUpload, FileText, Plus, Minus, Circle, CheckSquare, Square, Loader2 } from "lucide-react";
import { showToast } from "@/components/ui";
import type { GitStatus, RemoteInfo } from "@/types";
import { getGitStatus, getRemotes, gitAdd, gitCommit, gitPush } from "@/services/git";

interface GitCommitModalProps {
  projectPath: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export function GitCommitModal({ projectPath, onClose, onSuccess }: GitCommitModalProps) {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);

  // Selected files for staging
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  // Commit message
  const [message, setMessage] = useState("");
  // Selected remote for push
  const [selectedRemote, setSelectedRemote] = useState<string>("");
  // Whether to push after commit
  const [pushAfterCommit, setPushAfterCommit] = useState(true);

  useEffect(() => {
    loadGitInfo();
  }, [projectPath]);

  async function loadGitInfo() {
    try {
      setLoading(true);
      const [status, remoteList] = await Promise.all([
        getGitStatus(projectPath),
        getRemotes(projectPath),
      ]);
      setGitStatus(status);
      setRemotes(remoteList);

      // Default select first remote
      if (remoteList.length > 0) {
        setSelectedRemote(remoteList[0].name);
      }

      // Auto-select all modified files
      const allFiles = [
        ...status.unstaged,
        ...status.untracked,
      ];
      setSelectedFiles(new Set(allFiles));
    } catch (error) {
      console.error("Failed to load git info:", error);
      showToast("error", "加载失败", String(error));
    } finally {
      setLoading(false);
    }
  }

  function toggleFile(file: string) {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(file)) {
      newSelected.delete(file);
    } else {
      newSelected.add(file);
    }
    setSelectedFiles(newSelected);
  }

  function selectAll() {
    if (!gitStatus) return;
    const allFiles = [
      ...gitStatus.unstaged,
      ...gitStatus.untracked,
    ];
    setSelectedFiles(new Set(allFiles));
  }

  function deselectAll() {
    setSelectedFiles(new Set());
  }

  async function handleCommit() {
    if (!gitStatus || !message.trim()) {
      showToast("error", "提交失败", "请输入提交信息");
      return;
    }

    try {
      setCommitting(true);

      // Stage selected files
      const filesToAdd = Array.from(selectedFiles);
      if (filesToAdd.length > 0) {
        await gitAdd(projectPath, filesToAdd);
      }

      // Commit
      await gitCommit(projectPath, message.trim());
      showToast("success", "提交成功", "代码已提交到本地仓库");

      // Push if enabled
      if (pushAfterCommit && selectedRemote && gitStatus.branch) {
        setPushing(true);
        await gitPush(projectPath, selectedRemote, gitStatus.branch);
        showToast("success", "推送成功", `已推送到 ${selectedRemote}/${gitStatus.branch}`);
      }

      onSuccess?.();
      onClose();
    } catch (error) {
      console.error("Failed to commit:", error);
      showToast("error", "操作失败", String(error));
    } finally {
      setCommitting(false);
      setPushing(false);
    }
  }

  async function handlePushOnly() {
    if (!gitStatus || !selectedRemote) return;

    try {
      setPushing(true);
      await gitPush(projectPath, selectedRemote, gitStatus.branch);
      showToast("success", "推送成功", `已推送到 ${selectedRemote}/${gitStatus.branch}`);
      onSuccess?.();
      onClose();
    } catch (error) {
      console.error("Failed to push:", error);
      showToast("error", "推送失败", String(error));
    } finally {
      setPushing(false);
    }
  }

  const allFiles = gitStatus ? [...gitStatus.unstaged, ...gitStatus.untracked] : [];
  const hasChanges = allFiles.length > 0 || (gitStatus?.staged.length ?? 0) > 0;

  return (
    <div className="modal-overlay animate-fade-in">
      <div className="modal-content animate-scale-in max-w-2xl">
        <div className="modal-header">
          <div className="flex items-center gap-sm">
            <GitCommit size={20} className="text-blue-600" />
            <div>
              <h3 className="modal-title">提交代码</h3>
              <p className="modal-subtitle">暂存文件、输入提交信息并推送到远程仓库</p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close-btn">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 size={32} className="animate-spin text-blue-600" />
            </div>
          ) : !hasChanges ? (
            <div className="text-center py-12 text-gray-500">
              <Circle size={48} className="mx-auto mb-4 opacity-50" />
              <p className="font-medium">工作区干净</p>
              <p className="text-sm mt-1">没有需要提交的更改</p>
              {remotes.length > 0 && gitStatus && (
                <button
                  onClick={handlePushOnly}
                  disabled={pushing}
                  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 mx-auto"
                >
                  {pushing ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <CloudUpload size={16} />
                  )}
                  <span>推送到远程仓库</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-lg">
              {/* File List */}
              <div>
                <div className="flex items-center justify-between mb-md">
                  <h4 className="text-sm font-semibold text-gray-700">修改的文件</h4>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={selectAll}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      全选
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={deselectAll}
                      className="text-xs text-gray-500 hover:underline"
                    >
                      取消全选
                    </button>
                  </div>
                </div>

                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
                  {/* Staged files */}
                  {gitStatus?.staged.map((file) => (
                    <div
                      key={`staged-${file}`}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                    >
                      <CheckSquare size={16} className="text-green-600" />
                      <Plus size={14} className="text-green-600" />
                      <span className="text-sm text-gray-700 font-mono truncate flex-1">{file}</span>
                      <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">已暂存</span>
                    </div>
                  ))}

                  {/* Unstaged and untracked files */}
                  {allFiles.map((file) => (
                    <div
                      key={file}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0 cursor-pointer"
                      onClick={() => toggleFile(file)}
                    >
                      {selectedFiles.has(file) ? (
                        <CheckSquare size={16} className="text-blue-600" />
                      ) : (
                        <Square size={16} className="text-gray-400" />
                      )}
                      {gitStatus?.untracked.includes(file) ? (
                        <Plus size={14} className="text-green-600" />
                      ) : (
                        <Minus size={14} className="text-orange-500" />
                      )}
                      <span className="text-sm text-gray-700 font-mono truncate flex-1">{file}</span>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-gray-500 mt-2">
                  已选择 {selectedFiles.size + (gitStatus?.staged.length ?? 0)} 个文件
                </p>
              </div>

              {/* Commit Message */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-md">
                  <FileText size={14} className="inline mr-1" />
                  提交信息
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="描述这次提交的更改内容..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  rows={3}
                />
              </div>

              {/* Remote Selection & Push Option */}
              {remotes.length > 0 && (
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pushAfterCommit}
                      onChange={(e) => setPushAfterCommit(e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">提交后推送到</span>
                  </label>
                  <select
                    value={selectedRemote}
                    onChange={(e) => setSelectedRemote(e.target.value)}
                    disabled={!pushAfterCommit}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:bg-gray-100"
                  >
                    {remotes.map((remote) => (
                      <option key={remote.name} value={remote.name}>
                        {remote.name} ({gitStatus?.branch})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="modal-btn modal-btn-secondary">
            取消
          </button>
          {hasChanges && (
            <button
              onClick={handleCommit}
              disabled={committing || pushing}
              className="modal-btn modal-btn-primary"
            >
              {committing ? (
                <>
                  <Loader2 size={14} className="animate-spin mr-2" />
                  提交中...
                </>
              ) : pushing ? (
                <>
                  <Loader2 size={14} className="animate-spin mr-2" />
                  推送中...
                </>
              ) : (
                <>
                  <GitCommit size={14} className="mr-2" />
                  {pushAfterCommit ? "提交并推送" : "提交"}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
