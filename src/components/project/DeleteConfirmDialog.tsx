import { useState } from "react";
import { AlertTriangle, Trash2, FolderMinus } from "lucide-react";

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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
        {/* Header */}
        <div className="px-8 py-6 border-b border-gray-200">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900">
              确认删除项目
            </h3>
          </div>
          <p className="text-sm text-gray-500 mt-3">
            确定要删除项目 <span className="font-semibold text-gray-900">"{projectName}"</span> 吗？
          </p>
        </div>

        {/* Options */}
        <div className="px-8 py-6 space-y-3">
          {/* Option 1: Remove from list only */}
          <button
            onClick={() => setDeleteDirectory(false)}
            className={`w-full text-left p-5 rounded-xl border-2 transition-all ${
              !deleteDirectory
                ? "border-blue-500/50 bg-blue-50"
                : "border-gray-200 hover:border-blue-500/30 hover:bg-gray-100"
            }`}
          >
            <div className="flex items-start gap-4">
              <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
                !deleteDirectory ? "bg-blue-500/10" : "bg-gray-100"
              }`}>
                <FolderMinus className={`w-5 h-5 ${
                  !deleteDirectory ? "text-blue-500" : "text-gray-400"
                }`} />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-gray-900 mb-1">
                  仅移除项目
                </div>
                <div className="text-sm text-gray-500">
                  从管理列表中移除，不删除实际文件
                </div>
              </div>
              <div className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                !deleteDirectory
                  ? "border-blue-500 bg-blue-500"
                  : "border-gray-300"
              }`}>
                {!deleteDirectory && (
                  <div className="w-2 h-2 rounded-full bg-white" />
                )}
              </div>
            </div>
          </button>

          {/* Option 2: Delete directory */}
          <button
            onClick={() => setDeleteDirectory(true)}
            className={`w-full text-left p-5 rounded-xl border-2 transition-all ${
              deleteDirectory
                ? "border-red-500 bg-red-500/5"
                : "border-gray-200 hover:border-red-500/50 hover:bg-gray-100"
            }`}
          >
            <div className="flex items-start gap-4">
              <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
                deleteDirectory ? "bg-red-500/10" : "bg-gray-100"
              }`}>
                <Trash2 className={`w-5 h-5 ${
                  deleteDirectory ? "text-red-600" : "text-gray-400"
                }`} />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-gray-900 mb-1">
                  删除项目和文件
                </div>
                <div className={`text-sm ${
                  deleteDirectory ? "text-red-600 font-medium" : "text-gray-500"
                }`}>
                  {deleteDirectory ? (
                    <>⚠️ 将永久删除项目文件夹及所有内容，不可恢复！</>
                  ) : (
                    <>永久删除项目目录及其所有内容</>
                  )}
                </div>
              </div>
              <div className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                deleteDirectory
                  ? "border-red-500 bg-red-500"
                  : "border-gray-300"
              }`}>
                {deleteDirectory && (
                  <div className="w-2 h-2 rounded-full bg-white" />
                )}
              </div>
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-8 py-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 rounded-lg border border-gray-200 text-gray-900 hover:bg-white transition-colors font-medium"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(deleteDirectory)}
            className={`px-5 py-2.5 rounded-lg text-white transition-colors font-medium ${
              deleteDirectory
                ? "bg-red-600 hover:bg-red-700"
                : "bg-blue-500 hover:bg-blue-600"
            }`}
          >
            {deleteDirectory ? "确认删除" : "确认移除"}
          </button>
        </div>
      </div>
    </div>
  );
}
