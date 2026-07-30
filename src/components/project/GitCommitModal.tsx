import { useState, useEffect } from "react";
import { X, GitCommit, CloudUpload, FileText, Plus, Minus, Circle, CheckSquare, Square, Loader2 } from "lucide-react";
import { showToast } from "@/components/ui";
import type { GitStatus, RemoteInfo } from "@/types";
import { getGitStatus, getRemotes, gitAdd, gitUnstage, gitCommit, gitPush } from "@/services/git";

/**
 * 同一个文件可以**同时**有已暂存和未暂存的改动（先 `git add` 再继续改），
 * 所以状态不能是互斥枚举。
 *
 * 原来用 `Map.set(path, {type})` 去重，unstaged 那一轮会把 staged 覆盖掉；
 * 于是「取消暂存未选中文件」那步按 `type === "staged"` 过滤时漏掉它，
 * 用户取消勾选后它的暂存内容仍留在 index 里，`git commit -m`（无 pathspec）
 * 照样把这份没选中的改动提交上去。
 */
interface FileItem {
  path: string;
  /** index 里有改动（`git add` 过） */
  staged: boolean;
  /** 工作区里有未暂存的改动 */
  unstaged: boolean;
  /** 未跟踪的新文件 */
  untracked: boolean;
}

interface GitCommitModalProps {
  projectPath: string;
  currentRemote?: string | null;
  currentBranch?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export function GitCommitModal({ projectPath, currentRemote, currentBranch, onClose, onSuccess }: GitCommitModalProps) {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);

  // 所有文件列表（统一管理）
  const [allFiles, setAllFiles] = useState<FileItem[]>([]);
  // Selected files for staging
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  // Commit message
  const [message, setMessage] = useState("");
  // Selected remote for push
  const [selectedRemote, setSelectedRemote] = useState<string>("");
  // 提交后是否推送。默认**关闭**：推送是对外、不可逆的动作，
  // 默认勾选会让一次误提交立刻扩散到远程。要推的人自己勾。
  const [pushAfterCommit, setPushAfterCommit] = useState(false);

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

      // 使用传入的当前远程仓库，如果没有则使用第一个
      if (remoteList.length > 0) {
        setSelectedRemote(currentRemote || remoteList[0].name);
      }

      // 合并三个来源，同一路径**叠加**标志而不是互相覆盖
      const fileMap = new Map<string, FileItem>();
      const mark = (file: string, key: "staged" | "unstaged" | "untracked") => {
        const entry = fileMap.get(file) ?? {
          path: file,
          staged: false,
          unstaged: false,
          untracked: false,
        };
        entry[key] = true;
        fileMap.set(file, entry);
      };
      for (const file of status.staged) mark(file, "staged");
      for (const file of status.unstaged) mark(file, "unstaged");
      for (const file of status.untracked) mark(file, "untracked");

      const files = Array.from(fileMap.values());
      setAllFiles(files);
      // 默认全选
      setSelectedFiles(new Set(files.map(f => f.path)));
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
    setSelectedFiles(new Set(allFiles.map(f => f.path)));
  }

  function deselectAll() {
    setSelectedFiles(new Set());
  }

  async function handleCommit() {
    if (!gitStatus || !message.trim()) {
      showToast("error", "提交失败", "请输入提交信息");
      return;
    }

    if (selectedFiles.size === 0) {
      showToast("error", "提交失败", "请选择要提交的文件");
      return;
    }

    try {
      setCommitting(true);

      // 获取所有选中的文件路径
      const selectedFilePaths = allFiles
        .filter(f => selectedFiles.has(f.path))
        .map(f => f.path);

      // 未选中但 index 里有内容的文件，必须先 reset 出去。
      // 判据是 `f.staged` 这个独立标志，不是被覆盖过的类型枚举。
      // `git reset HEAD -- <file>` 只动 index，改动仍留在工作区，不会丢。
      const filesToUnstage = allFiles
        .filter(f => !selectedFiles.has(f.path) && f.staged)
        .map(f => f.path);

      // 取消暂存未选中的文件
      if (filesToUnstage.length > 0) {
        try {
          await gitUnstage(projectPath, filesToUnstage);
        } catch (error) {
          console.error("Failed to unstage files:", error);
          showToast("error", "取消暂存失败", String(error));
          await loadGitInfo();
          return;
        }
      }

      // 暂存所有选中的文件（确保暂存区与用户选择一致）
      if (selectedFilePaths.length > 0) {
        try {
          await gitAdd(projectPath, selectedFilePaths);
        } catch (error) {
          console.error("Failed to stage files:", error);
          showToast("error", "暂存文件失败", String(error));
          await loadGitInfo();
          return;
        }
      }

      // 提交前以 Git index 为准复核一次：`git commit -m` 不带 pathspec，
      // 提交的是 index 的**全部**内容，界面上的勾选不构成任何约束。
      // 上面 unstage/add 少动一个文件，多出来的改动就会被一起提交（还可能立刻推上远程）。
      try {
        const verify = await getGitStatus(projectPath);
        const selected = new Set(selectedFilePaths);
        const inIndex = new Set(verify.staged);
        const unexpected = [...inIndex].filter((f) => !selected.has(f));
        const missing = [...selected].filter((f) => !inIndex.has(f));
        if (unexpected.length > 0 || missing.length > 0) {
          const detail = [
            unexpected.length ? `多出：${unexpected.join("、")}` : "",
            missing.length ? `缺少：${missing.join("、")}` : "",
          ]
            .filter(Boolean)
            .join("；");
          showToast("error", "暂存区与所选文件不一致，已取消提交", detail);
          await loadGitInfo();
          return;
        }
      } catch (error) {
        console.error("Failed to verify index:", error);
        showToast("error", "无法校验暂存区，已取消提交", String(error));
        return;
      }

      // Commit
      try {
        await gitCommit(projectPath, message.trim());
        showToast("success", "提交成功", "代码已提交到本地仓库");
      } catch (error) {
        console.error("Failed to commit:", error);
        showToast("error", "提交失败", String(error));
        return;
      }

      // Push if enabled
      const branchToPush = gitStatus.branch || currentBranch;
      if (pushAfterCommit && selectedRemote && branchToPush) {
        setPushing(true);
        try {
          await gitPush(projectPath, selectedRemote, branchToPush);
          showToast("success", "推送成功", `已推送到 ${selectedRemote}/${branchToPush}`);
        } catch (error) {
          console.error("Failed to push:", error);
          showToast("error", "推送失败", String(error));
        }
      }

      onSuccess?.();
      onClose();
    } finally {
      setCommitting(false);
      setPushing(false);
    }
  }

  async function handlePushOnly() {
    if (!selectedRemote) return;

    const branchToPush = gitStatus?.branch || currentBranch;
    if (!branchToPush) return;

    try {
      setPushing(true);
      await gitPush(projectPath, selectedRemote, branchToPush);
      showToast("success", "推送成功", `已推送到 ${selectedRemote}/${branchToPush}`);
      onSuccess?.();
      onClose();
    } catch (error) {
      console.error("Failed to push:", error);
      showToast("error", "推送失败", String(error));
    } finally {
      setPushing(false);
    }
  }

  const hasChanges = allFiles.length > 0;

  function getFileTypeLabel(file: FileItem) {
    if (file.untracked) return { text: "新文件", color: "text-blue-600 bg-blue-50" };
    // 双重状态要如实显示：勾选它会把工作区剩下的改动一起暂存进来，
    // 取消勾选则连已暂存的部分也会被 reset 出 index（改动仍留在工作区）。
    if (file.staged && file.unstaged) {
      return { text: "已暂存+已修改", color: "text-purple-600 bg-purple-50" };
    }
    if (file.staged) return { text: "已暂存", color: "text-green-600 bg-green-50" };
    return { text: "已修改", color: "text-orange-600 bg-orange-50" };
  }

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
                  {/* 统一显示所有文件 */}
                  {allFiles.map((file) => {
                    const label = getFileTypeLabel(file);
                    return (
                      <div
                        key={file.path}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0 cursor-pointer"
                        onClick={() => toggleFile(file.path)}
                      >
                        {selectedFiles.has(file.path) ? (
                          <CheckSquare size={16} className="text-blue-600" />
                        ) : (
                          <Square size={16} className="text-gray-400" />
                        )}
                        {file.untracked ? (
                          <Plus size={14} className="text-green-600" />
                        ) : (
                          <Minus size={14} className="text-orange-500" />
                        )}
                        <span className="text-sm text-gray-700 font-mono truncate flex-1">{file.path}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${label.color}`}>{label.text}</span>
                      </div>
                    );
                  })}
                </div>

                <p className="text-xs text-gray-500 mt-2">
                  已选择 {selectedFiles.size} 个文件
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
                        {remote.name} ({gitStatus?.branch || currentBranch})
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
