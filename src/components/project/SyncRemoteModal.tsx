import { useState, useEffect } from "react";
import { X, Database, Plus, Minus, AlertCircle } from "lucide-react";
import type { RemoteInfo } from "@/types";
import { addRemote, syncToRemote } from "@/services/git";

interface SyncRemoteModalProps {
  projectPath: string;
  remotes: RemoteInfo[];
  sourceRemote: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function SyncRemoteModal({
  projectPath,
  remotes,
  sourceRemote,
  onClose,
  onSuccess,
}: SyncRemoteModalProps) {
  const [selectedRemote, setSelectedRemote] = useState<string | null>(null);
  const [syncAllBranches, setSyncAllBranches] = useState(true);
  const [showAddRemote, setShowAddRemote] = useState(false);
  const [newRemoteName, setNewRemoteName] = useState("");
  const [newRemoteUrl, setNewRemoteUrl] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const otherRemotes = remotes.filter((r) => r.name !== sourceRemote);

  useEffect(() => {
    if (otherRemotes.length > 0 && !selectedRemote) {
      setSelectedRemote(otherRemotes[0].name);
    }
  }, [otherRemotes, selectedRemote]);

  async function handleAddRemote() {
    if (!newRemoteName.trim() || !newRemoteUrl.trim()) {
      setError("请输入远程库名称和地址");
      return;
    }

    try {
      await addRemote(projectPath, newRemoteName.trim(), newRemoteUrl.trim());
      setShowAddRemote(false);
      setNewRemoteName("");
      setNewRemoteUrl("");
      setError(null);
      // Refresh remotes list
      onSuccess();
    } catch (err) {
      setError("添加远程库失败：" + err);
    }
  }

  async function handleSync() {
    if (!selectedRemote) {
      setError("请选择目标远程库");
      return;
    }

    try {
      setSyncing(true);
      setError(null);
      setSyncResult(null);

      const result = await syncToRemote(
        projectPath,
        sourceRemote,
        selectedRemote,
        syncAllBranches,
        false
      );

      setSyncResult(result);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 2000);
    } catch (err) {
      setError("同步失败：" + err);
    } finally {
      setSyncing(false);
    }
  }

  function getRemoteType(url: string) {
    if (url.includes("github.com")) return "GitHub";
    if (url.includes("gitee.com")) return "Gitee";
    if (url.includes("gitlab")) return "GitLab";
    return "Git";
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header bg-gray-50/50 rounded-t-2xl">
          <div>
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Database className="text-blue-600" size={20} />
              同步到远程库
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              将 {sourceRemote} 的分支同步到目标远程库
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body max-h-[60vh]">
          {/* Source Remote */}
          <div className="mb-6 p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <Database size={20} className="text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900">源远程库</div>
              <div className="text-xs text-gray-600 truncate">
                {sourceRemote} ({remotes.find((r) => r.name === sourceRemote)?.url})
              </div>
            </div>
            <div className="px-2 py-1 rounded-lg bg-blue-100 text-blue-700 text-xs font-medium">
              所有分支
            </div>
          </div>

          {/* Target Remote Selection */}
          <div className="mb-4">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 block">
              选择目标远程库
            </label>

            {otherRemotes.length === 0 ? (
              <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
                <Database size={48} className="mx-auto mb-2 opacity-30" />
                <div className="text-xs font-medium">暂无其他远程库</div>
                <div className="text-[10px] mt-1 opacity-70">
                  请添加新的远程库进行同步
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {otherRemotes.map((remote) => (
                  <label
                    key={remote.name}
                    className="relative block cursor-pointer group"
                  >
                    <input
                      type="radio"
                      name="targetRemote"
                      value={remote.name}
                      checked={selectedRemote === remote.name}
                      onChange={() => setSelectedRemote(remote.name)}
                      className="peer sr-only"
                    />
                    <div className="p-4 rounded-xl border-2 border-gray-200 hover:border-blue-300 peer-checked:border-blue-500 peer-checked:bg-blue-50 transition-all">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                            <Database size={20} className="text-gray-600" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-gray-900 peer-checked:text-blue-700">
                              {remote.name}
                            </div>
                            <div className="text-xs text-gray-500 truncate font-mono max-w-[280px]">
                              {remote.url}
                            </div>
                            <div className="text-[10px] text-gray-400 mt-0.5">
                              {getRemoteType(remote.url)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {/* Add Remote Section */}
            <div className="border-t border-gray-200 pt-4 mt-4">
              <button
                onClick={() => setShowAddRemote(!showAddRemote)}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 mb-3 transition-colors"
              >
                {showAddRemote ? (
                  <>
                    <Minus size={14} />
                    <span>收起添加表单</span>
                  </>
                ) : (
                  <>
                    <Plus size={14} />
                    <span>添加新的远程库</span>
                  </>
                )}
              </button>

              {showAddRemote && (
                <div className="space-y-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      远程库名称
                    </label>
                    <input
                      type="text"
                      value={newRemoteName}
                      onChange={(e) => setNewRemoteName(e.target.value)}
                      placeholder="例如：github、backup"
                      className="input-base"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      远程库地址 (URL)
                    </label>
                    <input
                      type="text"
                      value={newRemoteUrl}
                      onChange={(e) => setNewRemoteUrl(e.target.value)}
                      placeholder="https://github.com/username/repo.git"
                      className="input-base font-mono text-xs"
                    />
                  </div>
                  <button
                    onClick={handleAddRemote}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    确认添加
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Sync Options */}
          <div className="border-t border-gray-200 pt-4">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 block">
              同步选项
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors group">
                <input
                  type="radio"
                  name="syncOption"
                  checked={syncAllBranches}
                  onChange={() => setSyncAllBranches(true)}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-900 group-hover:text-blue-700">
                    同步所有分支
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    推送所有本地分支到目标远程库
                  </div>
                </div>
              </label>
              <label className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors group">
                <input
                  type="radio"
                  name="syncOption"
                  checked={!syncAllBranches}
                  onChange={() => setSyncAllBranches(false)}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-900 group-hover:text-blue-700">
                    仅同步当前分支
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    仅推送当前分支
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
              <AlertCircle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-red-700">{error}</div>
            </div>
          )}

          {/* Success Message */}
          {syncResult && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="text-xs text-green-700 whitespace-pre-wrap">
                {syncResult}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <AlertCircle size={14} />
            <span>此操作会强制更新目标远程库的分支</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-100 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSync}
              disabled={!selectedRemote || syncing}
              className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium flex items-center gap-2 transition-all shadow-md shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncing ? (
                <>
                  <div className="loading-spinner w-4 h-4 border-white border-t-transparent" />
                  同步中...
                </>
              ) : (
                <>
                  <Database size={16} />
                  开始同步
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
