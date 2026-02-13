import { useState, useRef } from "react";
import { useAppStore } from "@/stores/appStore";
import { AlertTriangle } from "lucide-react";

interface AddCategoryDialogProps {
  onClose: () => void;
}

export function AddCategoryDialog({ onClose }: AddCategoryDialogProps) {
  const { categories, addCategory, removeCategory } = useAppStore();
  const [newCategory, setNewCategory] = useState("");
  const [error, setError] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const categoryColors = [
    { bg: "bg-indigo-100", text: "text-indigo-600" },
    { bg: "bg-emerald-100", text: "text-emerald-600" },
    { bg: "bg-purple-100", text: "text-purple-600" },
    { bg: "bg-pink-100", text: "text-pink-600" },
    { bg: "bg-cyan-100", text: "text-cyan-600" },
    { bg: "bg-amber-100", text: "text-amber-600" },
    { bg: "bg-rose-100", text: "text-rose-600" },
  ];

  function getCategoryColor(index: number) {
    return categoryColors[index % categoryColors.length];
  }

  function handleAddCategory() {
    const trimmed = newCategory.trim();
    if (!trimmed) {
      setError("分类名称不能为空");
      return;
    }
    if (categories.includes(trimmed)) {
      setError("该分类已存在");
      return;
    }
    addCategory(trimmed);
    setNewCategory("");
    setError("");
  }

  function handleKeyPress(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      handleAddCategory();
    }
  }

  function startEdit(index: number) {
    setEditingIndex(index);
    setEditValue(categories[index]);
  }

  function saveEdit(index: number) {
    const newName = editValue.trim();
    if (newName && newName !== categories[index]) {
      // Remove old and add new (simple approach)
      const oldName = categories[index];
      removeCategory(oldName);
      addCategory(newName);
    }
    setEditingIndex(null);
    setEditValue("");
  }

  function handleDelete(category: string) {
    setDeletingCategory(category);
  }

  function confirmDelete() {
    if (deletingCategory) {
      removeCategory(deletingCategory);
      setDeletingCategory(null);
    }
  }

  function cancelDelete() {
    setDeletingCategory(null);
  }

  return (
    <>
    <div className="fixed inset-0 top-8 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="category-dialog bg-white/[0.98] border border-slate-200/80 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">

        {/* 头部 */}
        <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-200">
              <i className="fa-solid fa-tags text-lg"></i>
            </div>
            <h2 className="text-xl font-bold text-slate-800">管理分类</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* 添加新分类 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">添加新分类</label>
            <div className="flex gap-3">
              <input
                type="text"
                value={newCategory}
                onChange={(e) => {
                  setNewCategory(e.target.value);
                  setError("");
                }}
                onKeyPress={handleKeyPress}
                placeholder="输入分类名称..."
                className="flex-1 px-4 py-3 bg-white border border-slate-300 rounded-xl category-input transition-all"
              />
              <button
                onClick={handleAddCategory}
                className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl shadow-lg shadow-blue-200 transition-all active:scale-95 flex items-center gap-2"
              >
                <i className="fa-solid fa-plus"></i>
              </button>
            </div>
            {error && (
              <p className="text-sm text-red-500 mt-2">{error}</p>
            )}
          </div>

          {/* 现有分类列表 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">
                现有分类 <span className="ml-1 text-slate-400 font-normal">({categories.length})</span>
              </h3>
            </div>

            <div ref={listRef} className="space-y-2 max-h-[320px] overflow-y-auto pr-1 category-scrollbar">
              {categories.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <i className="fa-solid fa-tags text-4xl mb-3 opacity-30"></i>
                  <p className="text-sm">还没有分类</p>
                  <p className="text-xs mt-1">添加分类来组织你的项目</p>
                </div>
              ) : (
                categories.map((category, index) => {
                  const color = getCategoryColor(index);
                  return (
                    <div
                      key={category}
                      draggable
                      onDragStart={() => setDraggedIndex(index)}
                      onDragEnd={() => setDraggedIndex(null)}
                      className={`category-item group bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between hover:border-blue-300 cursor-move transition-all ${
                        draggedIndex === index ? "opacity-50 bg-slate-100" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 ${color.bg} ${color.text} rounded-lg flex items-center justify-center`}>
                          <i className="fa-solid fa-folder text-sm"></i>
                        </div>
                        <div>
                          {editingIndex === index ? (
                            <input
                              type="text"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => saveEdit(index)}
                              onKeyDown={(e) => e.key === "Enter" && saveEdit(index)}
                              autoFocus
                              className="px-2 py-1 text-sm border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                            />
                          ) : (
                            <span className="font-medium text-slate-700">{category}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => startEdit(index)}
                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <i className="fa-solid fa-pen text-sm"></i>
                        </button>
                        <button
                          onClick={() => handleDelete(category)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <i className="fa-solid fa-trash text-sm"></i>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* 底部 */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-8 py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium rounded-xl shadow-lg shadow-slate-200 transition-all active:scale-95 flex items-center gap-2"
          >
            <i className="fa-solid fa-check"></i>
            完成
          </button>
        </div>
      </div>

      <style>{`
        .category-dialog {
          animation: categorySlideIn 0.3s ease-out;
        }
        @keyframes categorySlideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .category-item {
          transition: all 0.2s ease;
        }
        .category-item:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        }
        .category-input:focus {
          outline: none;
          ring: 2px;
          ring-color: rgba(59, 130, 246, 0.2);
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        .category-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .category-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .category-scrollbar::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 20px;
        }
      `}</style>
    </div>

    {/* 删除确认对话框 */}
    {deletingCategory && (
      <div className="fixed inset-0 top-8 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">确认删除分类</h3>
            </div>
          </div>
          <div className="px-6 py-4">
            <p className="text-gray-600">
              确定要删除分类 <span className="font-semibold text-gray-900">"{deletingCategory}"</span> 吗？
            </p>
            <p className="text-sm text-gray-500 mt-2">相关项目将变为未分类状态</p>
          </div>
          <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100">
            <button
              onClick={cancelDelete}
              className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-white transition-colors font-medium text-sm"
            >
              取消
            </button>
            <button
              onClick={confirmDelete}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors font-medium text-sm"
            >
              确认删除
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
