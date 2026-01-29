import { useState } from "react";
import { X, Globe, Loader2, CheckCircle } from "lucide-react";
import { showToast } from "@/components/ui";
import { addRemote, verifyRemoteUrl } from "@/services/git";

interface AddRemoteModalProps {
  projectPath: string;
  onClose: () => void;
  onSuccess?: (remoteName?: string) => void;
}

export function AddRemoteModal({ projectPath, onClose, onSuccess }: AddRemoteModalProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);

  async function handleVerify() {
    if (!url.trim()) {
      showToast("error", "验证失败", "请输入远程仓库地址");
      return;
    }

    try {
      setVerifying(true);
      setVerified(false);
      await verifyRemoteUrl(url.trim());
      setVerified(true);
      showToast("success", "验证成功", "远程仓库地址有效");
    } catch (error) {
      console.error("Failed to verify remote:", error);
      showToast("error", "验证失败", String(error));
      setVerified(false);
    } finally {
      setVerifying(false);
    }
  }

  async function handleSubmit() {
    if (!name.trim()) {
      showToast("error", "验证失败", "请输入远程仓库名称");
      return;
    }
    if (!url.trim()) {
      showToast("error", "验证失败", "请输入远程仓库地址");
      return;
    }
    if (!verified) {
      showToast("error", "验证失败", "请先验证远程仓库地址");
      return;
    }

    try {
      setLoading(true);
      await addRemote(projectPath, name.trim(), url.trim());
      showToast("success", "添加成功", `远程仓库 ${name} 已添加`);
      onSuccess?.(name.trim());
      onClose();
    } catch (error) {
      console.error("Failed to add remote:", error);
      showToast("error", "添加失败", String(error));
    } finally {
      setLoading(false);
    }
  }

  // URL 改变时重置验证状态
  function handleUrlChange(newUrl: string) {
    setUrl(newUrl);
    setVerified(false);
  }

  return (
    <div className="modal-overlay animate-fade-in" onClick={(e) => e.stopPropagation()}>
      <div className="modal-content animate-scale-in max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="flex items-center gap-sm">
            <Globe size={20} className="text-blue-600" />
            <div>
              <h3 className="modal-title">添加远程仓库</h3>
              <p className="modal-subtitle">配置远程 Git 仓库地址</p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close-btn">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body space-y-md">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              远程仓库名称
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如: backup, upstream, gitee"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              建议使用有意义的名称，如 backup、gitee、gitlab 等
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              仓库地址 (URL)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={url}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="https://github.com/username/repo.git"
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
              />
              <button
                type="button"
                onClick={handleVerify}
                disabled={verifying || !url.trim()}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                {verifying ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : verified ? (
                  <CheckCircle size={14} className="text-green-500" />
                ) : null}
                {verifying ? "验证中..." : verified ? "已验证" : "验证"}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              支持 HTTPS 或 SSH 格式，添加前需验证地址有效性
            </p>
          </div>

          {/* Quick templates */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              快速填充
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setUrl("https://github.com/用户名/仓库名.git")}
                className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                GitHub
              </button>
              <button
                type="button"
                onClick={() => setUrl("https://gitee.com/用户名/仓库名.git")}
                className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Gitee
              </button>
              <button
                type="button"
                onClick={() => setUrl("https://gitlab.com/用户名/仓库名.git")}
                className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                GitLab
              </button>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="modal-btn modal-btn-secondary">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !name.trim() || !url.trim() || !verified}
            className="modal-btn modal-btn-primary"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin mr-2" />
                添加中...
              </>
            ) : (
              "添加"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
