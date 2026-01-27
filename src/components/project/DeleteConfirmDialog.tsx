import { useState } from "react";

interface DeleteConfirmDialogProps {
  projectName: string;
  onConfirm: (deleteDirectory: boolean) => void;
  onCancel: () => void;
}

export function DeleteConfirmDialog({
  projectName,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  const [deleteDirectory, setDeleteDirectory] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4 text-[var(--text)]">
            确认删除项目
          </h3>
          <p className="text-[var(--text-light)] mb-6">
            确定要删除项目 <strong className="text-[var(--text)]">{projectName}</strong> 吗？
          </p>

          <div className="mb-6 p-4 bg-[var(--bg-light)] rounded-lg border border-[var(--border)]">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteDirectory}
                onChange={(e) => setDeleteDirectory(e.target.checked)}
                className="mt-1"
              />
              <div>
                <div className="font-medium text-[var(--text)] mb-1">
                  同时删除项目目录
                </div>
                <div className="text-sm text-[var(--text-light)]">
                  {deleteDirectory ? (
                    <span className="text-red-600 dark:text-red-400">
                      ⚠️ 警告：将永久删除项目文件夹及其所有内容，此操作不可恢复！
                    </span>
                  ) : (
                    <span>
                      仅从管理列表中移除，不删除实际文件
                    </span>
                  )}
                </div>
              </div>
            </label>
          </div>

          <div className="flex gap-3 justify-end">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-light)] transition-colors"
            >
              取消
            </button>
            <button
              onClick={() => onConfirm(deleteDirectory)}
              className={`px-4 py-2 rounded-lg text-white transition-colors ${
                deleteDirectory
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-[var(--primary)] hover:bg-[var(--primary-dark)]"
              }`}
            >
              {deleteDirectory ? "删除项目和文件" : "仅移除项目"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
