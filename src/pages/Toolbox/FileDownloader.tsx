import { useState, useEffect } from "react";
import {
  Download,
  Plus,
  Pause,
  Play,
  X,
  FolderOpen,
  Trash2,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { ToolPanelHeader } from "./index";
import { Input, Button } from "@/components/ui";
import {
  startDownload,
  pauseDownload,
  resumeDownload,
  cancelDownload,
  getDownloadTasks,
  clearCompletedDownloads,
  openDownloadFolder,
  removeDownloadTask,
  formatBytes,
  formatSpeed,
} from "@/services/toolbox";
import type { DownloadTask } from "@/types/toolbox";

interface FileDownloaderProps {
  onBack: () => void;
}

export function FileDownloader({ onBack }: FileDownloaderProps) {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [saveDir, setSaveDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{taskId: string; fileName: string} | null>(null);

  // 加载下载任务
  useEffect(() => {
    loadTasks();
    // 定时刷新任务状态
    const interval = setInterval(loadTasks, 1000);
    return () => clearInterval(interval);
  }, []);

  async function loadTasks() {
    try {
      const data = await getDownloadTasks();
      setTasks(data);
    } catch (error) {
      console.error("加载下载任务失败:", error);
    } finally {
      setLoading(false);
    }
  }

  // 选择下载目录
  async function handleSelectDir() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择下载目录",
      });
      if (selected) {
        setSaveDir(selected as string);
      }
    } catch (error) {
      console.error("选择目录失败:", error);
    }
  }

  // 添加下载任务
  async function handleAdd() {
    if (!newUrl.trim()) return;

    try {
      await startDownload({
        url: newUrl.trim(),
        saveDir: saveDir || undefined,
      });
      setNewUrl("");
      setSaveDir("");
      setShowAddDialog(false);
      loadTasks();
    } catch (error) {
      console.error("添加下载任务失败:", error);
      alert(`添加下载任务失败: ${error}`);
    }
  }

  // 暂停下载
  async function handlePause(taskId: string) {
    try {
      await pauseDownload(taskId);
      loadTasks();
    } catch (error) {
      console.error("暂停下载失败:", error);
    }
  }

  // 恢复下载
  async function handleResume(taskId: string) {
    try {
      await resumeDownload(taskId);
      loadTasks();
    } catch (error) {
      console.error("恢复下载失败:", error);
    }
  }

  // 取消下载
  async function handleCancel(taskId: string) {
    try {
      await cancelDownload(taskId);
      loadTasks();
    } catch (error) {
      console.error("取消下载失败:", error);
    }
  }

  // 打开文件夹
  async function handleOpenFolder(taskId: string) {
    try {
      await openDownloadFolder(taskId);
    } catch (error) {
      console.error("打开文件夹失败:", error);
    }
  }

  // 删除下载任务
  async function handleDelete(taskId: string, deleteFile: boolean) {
    try {
      await removeDownloadTask(taskId, deleteFile);
      setShowDeleteConfirm(null);
      loadTasks();
    } catch (error) {
      console.error("删除下载任务失败:", error);
    }
  }

  // 清除已完成任务
  async function handleClearCompleted() {
    try {
      await clearCompletedDownloads();
      loadTasks();
    } catch (error) {
      console.error("清除已完成任务失败:", error);
    }
  }

  // 获取进度百分比
  function getProgress(task: DownloadTask): number {
    if (task.totalSize === 0) {
      // 未知大小时，如果正在下载显示一个动态值，否则显示100%（已完成）
      if (task.status === "completed") return 100;
      if (task.status === "downloading") return -1; // -1 表示不确定进度
      return 0;
    }
    return Math.round((task.downloadedSize / task.totalSize) * 100);
  }

  // 获取状态图标
  function getStatusIcon(status: string) {
    switch (status) {
      case "downloading":
        return <Loader2 size={16} className="animate-spin text-blue-500" />;
      case "completed":
        return <CheckCircle size={16} className="text-green-500" />;
      case "failed":
        return <AlertCircle size={16} className="text-red-500" />;
      case "paused":
        return <Pause size={16} className="text-yellow-500" />;
      default:
        return <Clock size={16} className="text-gray-400" />;
    }
  }

  // 获取状态文本
  function getStatusText(status: string) {
    switch (status) {
      case "pending":
        return "等待中";
      case "downloading":
        return "下载中";
      case "paused":
        return "已暂停";
      case "completed":
        return "已完成";
      case "failed":
        return "失败";
      case "cancelled":
        return "已取消";
      default:
        return status;
    }
  }

  const completedCount = tasks.filter((t) => t.status === "completed" || t.status === "failed").length;

  return (
    <div className="flex flex-col min-h-full">
      <ToolPanelHeader
        title="文件下载"
        icon={Download}
        onBack={onBack}
        actions={
          <>
            {completedCount > 0 && (
              <button
                onClick={handleClearCompleted}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <Trash2 size={14} />
                <span>清除已完成</span>
              </button>
            )}
            <button
              onClick={() => setShowAddDialog(true)}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus size={14} />
              <span>新建下载</span>
            </button>
          </>
        }
      />

      <div className="flex-1 p-6">
        <div className="max-w-4xl mx-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Loader2 size={32} className="animate-spin mb-4" />
              <p>加载中...</p>
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Download size={48} className="mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2 text-gray-700 dark:text-gray-300">
                暂无下载任务
              </p>
              <p className="text-sm mb-4">点击"新建下载"添加下载任务</p>
              <Button onClick={() => setShowAddDialog(true)} variant="primary">
                <Plus size={16} className="mr-2" />
                新建下载
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="re-card p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 mt-1">
                      {getStatusIcon(task.status)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="font-medium text-gray-900 dark:text-white truncate">
                          {task.fileName}
                        </h4>
                        <span className="text-sm text-gray-500 ml-2">
                          {getStatusText(task.status)}
                        </span>
                      </div>

                      {/* 保存路径 */}
                      <div className="text-xs text-gray-400 mb-2 truncate" title={task.savePath}>
                        {task.savePath}
                      </div>

                      {/* 进度条 */}
                      <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden mb-2">
                        {getProgress(task) === -1 ? (
                          // 不确定进度时显示动画条纹
                          <div className="h-full w-full bg-gradient-to-r from-blue-500 via-blue-400 to-blue-500 bg-[length:200%_100%] animate-[shimmer_1.5s_infinite]" />
                        ) : (
                          <div
                            className={`h-full transition-all duration-300 ${
                              task.status === "completed"
                                ? "bg-green-500"
                                : task.status === "failed"
                                ? "bg-red-500"
                                : "bg-blue-500"
                            }`}
                            style={{ width: `${Math.max(0, getProgress(task))}%` }}
                          />
                        )}
                      </div>

                      <div className="flex items-center justify-between text-sm text-gray-500">
                        <span>
                          {formatBytes(task.downloadedSize)}
                          {task.totalSize > 0 && ` / ${formatBytes(task.totalSize)}`}
                          {task.status === "downloading" && task.speed > 0 && (
                            <span className="ml-2 text-blue-500">
                              {formatSpeed(task.speed)}
                            </span>
                          )}
                        </span>
                        <span>
                          {getProgress(task) === -1 ? "下载中..." : `${Math.max(0, getProgress(task))}%`}
                        </span>
                      </div>

                      {task.error && (
                        <p className="text-sm text-red-500 mt-1">{task.error}</p>
                      )}
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-1">
                      {task.status === "downloading" && (
                        <button
                          onClick={() => handlePause(task.id)}
                          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                          title="暂停"
                        >
                          <Pause size={16} />
                        </button>
                      )}
                      {task.status === "paused" && (
                        <button
                          onClick={() => handleResume(task.id)}
                          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-green-500"
                          title="继续"
                        >
                          <Play size={16} />
                        </button>
                      )}
                      {task.status === "completed" && (
                        <button
                          onClick={() => handleOpenFolder(task.id)}
                          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-blue-500"
                          title="打开文件夹"
                        >
                          <FolderOpen size={16} />
                        </button>
                      )}
                      {task.status === "downloading" || task.status === "paused" ? (
                        <button
                          onClick={() => handleCancel(task.id)}
                          className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors text-red-500"
                          title="取消"
                        >
                          <X size={16} />
                        </button>
                      ) : (
                        <button
                          onClick={() => setShowDeleteConfirm({ taskId: task.id, fileName: task.fileName })}
                          className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors text-red-500"
                          title="删除"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 新建下载对话框 */}
      {showAddDialog && (
        <div className="fixed inset-0 top-8 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              新建下载
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">
                  下载链接
                </label>
                <Input
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="输入文件下载链接..."
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">
                  保存目录 <span className="text-gray-400 font-normal">(可选，默认为系统下载目录)</span>
                </label>
                <div className="flex gap-2">
                  <Input
                    value={saveDir}
                    onChange={(e) => setSaveDir(e.target.value)}
                    placeholder="选择或输入保存目录..."
                    className="flex-1"
                  />
                  <Button onClick={handleSelectDir} variant="secondary">
                    <FolderOpen size={16} />
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button
                onClick={() => {
                  setShowAddDialog(false);
                  setNewUrl("");
                  setSaveDir("");
                }}
                variant="secondary"
              >
                取消
              </Button>
              <Button onClick={handleAdd} variant="primary" disabled={!newUrl.trim()}>
                开始下载
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认对话框 */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 top-8 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              删除下载
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              确定要删除 <span className="font-medium">"{showDeleteConfirm.fileName}"</span> 吗？
            </p>
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => handleDelete(showDeleteConfirm.taskId, false)}
                variant="secondary"
                className="w-full"
              >
                仅删除记录
              </Button>
              <Button
                onClick={() => handleDelete(showDeleteConfirm.taskId, true)}
                variant="danger"
                className="w-full"
              >
                删除记录和文件
              </Button>
              <Button
                onClick={() => setShowDeleteConfirm(null)}
                variant="secondary"
                className="w-full"
              >
                取消
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
