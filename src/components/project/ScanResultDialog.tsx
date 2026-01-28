import { useState, useMemo, useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import type { GitRepo } from "@/types";

interface ScanResultDialogProps {
  repos: GitRepo[];
  onConfirm: (selectedPaths: string[], categories: string[], labels: string[]) => void;
  onCancel: () => void;
}

interface CategoryInfo {
  name: string;
  icon: string;
  color: string;
  bg: string;
  text: string;
  border: string;
}

interface HistoryItem {
  category: string;
  name: string;
  count: number;
}

export function ScanResultDialog({ repos, onConfirm, onCancel }: ScanResultDialogProps) {
  const { categories: storeCategories, addCategory: addCategoryToStore } = useAppStore();
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [assignedCategories, setAssignedCategories] = useState<Record<string, string>>({});
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showingAll, setShowingAll] = useState(true);
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showRenameInput, setShowRenameInput] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  // 预设颜色方案
  const colorSchemes = [
    { icon: "💼", color: "orange", bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
    { icon: "🎯", color: "emerald", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
    { icon: "🌟", color: "purple", bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
    { icon: "📦", color: "amber", bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
    { icon: "🚀", color: "blue", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
    { icon: "💡", color: "cyan", bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-200" },
    { icon: "🔧", color: "gray", bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200" },
  ];

  // 从 store 分类生成带样式的分类信息
  const [categories, setCategories] = useState<Record<string, CategoryInfo>>({});

  // 初始化分类样式
  useEffect(() => {
    const newCategories: Record<string, CategoryInfo> = {};
    storeCategories.forEach((catName, index) => {
      const scheme = colorSchemes[index % colorSchemes.length];
      newCategories[catName] = {
        name: catName,
        ...scheme,
      };
    });
    setCategories(newCategories);
  }, [storeCategories]);

  // 检测共同前缀
  const commonPrefix = useMemo(() => {
    if (selectedPaths.size < 2) return null;
    const names = Array.from(selectedPaths).map(path => {
      const repo = repos.find(r => r.path === path);
      return repo?.name || "";
    });

    let prefix = names[0];
    for (let i = 1; i < names.length; i++) {
      while (!names[i].startsWith(prefix) && prefix.length > 0) {
        prefix = prefix.slice(0, -1);
      }
      if (prefix.length === 0) break;
    }
    prefix = prefix.replace(/[-_]+$/, "");
    if (prefix.length >= 2 && !names.every(n => n === prefix)) {
      return prefix;
    }
    return null;
  }, [selectedPaths, repos]);

  const filteredRepos = useMemo(() => {
    return showingAll ? repos : repos.filter(r => !assignedCategories[r.path]);
  }, [repos, showingAll, assignedCategories]);

  const unclassifiedCount = repos.filter(r => !assignedCategories[r.path]).length;
  const assignedCount = repos.length - unclassifiedCount;

  function toggleSelection(path: string) {
    const newSelected = new Set(selectedPaths);
    if (newSelected.has(path)) {
      newSelected.delete(path);
    } else {
      newSelected.add(path);
    }
    setSelectedPaths(newSelected);
  }

  function toggleSelectAll() {
    const unassignedPaths = repos.filter(r => !assignedCategories[r.path]).map(r => r.path);
    if (selectedPaths.size === unassignedPaths.length) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(unassignedPaths));
    }
  }

  function handleSelectCategory(catId: string) {
    setSelectedCategory(selectedCategory === catId ? null : catId);
  }

  function applyCategory() {
    if (!selectedCategory || selectedPaths.size === 0) return;
    const catInfo = categories[selectedCategory];
    const paths = Array.from(selectedPaths);

    const newAssigned = { ...assignedCategories };
    paths.forEach(path => {
      newAssigned[path] = selectedCategory;
    });
    setAssignedCategories(newAssigned);

    setHistory([...history, {
      category: selectedCategory,
      name: catInfo.name,
      count: paths.length,
    }]);

    setSelectedPaths(new Set());
    setSelectedCategory(null);
  }

  function createNewCategory() {
    setShowNewCategoryInput(true);
  }

  function confirmNewCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    // 添加到 store
    if (!storeCategories.includes(name)) {
      addCategoryToStore(name);
    }
    // 添加到本地显示状态（带样式）
    const schemeIndex = Object.keys(categories).length % colorSchemes.length;
    setCategories({
      ...categories,
      [name]: {
        name,
        icon: "📦",
        color: "amber",
        bg: "bg-amber-50",
        text: "text-amber-700",
        border: "border-amber-200",
      },
    });
    setNewCategoryName("");
    setShowNewCategoryInput(false);
    setSelectedCategory(name);
  }

  function acceptRecommend() {
    if (!commonPrefix) return;
    // 添加到 store
    if (!storeCategories.includes(commonPrefix)) {
      addCategoryToStore(commonPrefix);
    }
    // 添加到本地显示状态
    setCategories({
      ...categories,
      [commonPrefix]: {
        name: commonPrefix,
        icon: "📦",
        color: "amber",
        bg: "bg-amber-50",
        text: "text-amber-700",
        border: "border-amber-200",
      },
    });
    setSelectedCategory(commonPrefix);
  }

  function showRename() {
    setRenameValue(commonPrefix || "");
    setShowRenameInput(true);
  }

  function confirmRename() {
    const name = renameValue.trim();
    if (!name) return;
    // 添加到 store
    if (!storeCategories.includes(name)) {
      addCategoryToStore(name);
    }
    // 添加到本地显示状态
    setCategories({
      ...categories,
      [name]: {
        name,
        icon: "📦",
        color: "amber",
        bg: "bg-amber-50",
        text: "text-amber-700",
        border: "border-amber-200",
      },
    });
    setSelectedCategory(name);
    setShowRenameInput(false);
  }

  function dismissRecommend() {
    setShowRenameInput(false);
  }

  function undoHistory(index: number) {
    const item = history[index];
    const newAssigned = { ...assignedCategories };
    Object.keys(newAssigned).forEach(path => {
      if (newAssigned[path] === item.category) {
        delete newAssigned[path];
      }
    });
    setAssignedCategories(newAssigned);
    setHistory(history.filter((_, i) => i !== index));
  }

  function resetAll() {
    setAssignedCategories({});
    setSelectedPaths(new Set());
    setSelectedCategory(null);
    setHistory([]);
  }

  function finishImport() {
    if (assignedCount === 0) return;
    const assignedPaths = Object.keys(assignedCategories);
    const categoryNames = assignedPaths.map(path => categories[assignedCategories[path]]?.name || "");
    onConfirm(assignedPaths, categoryNames, []);
  }

  const previewNames = Array.from(selectedPaths).slice(0, 2).map(path => {
    const repo = repos.find(r => r.path === path);
    return repo?.name || "";
  }).join("、");

  const canApply = selectedPaths.size > 0 && selectedCategory !== null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="scan-dialog bg-gray-50 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* 头部 */}
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
              <i className="fa-solid fa-chart-simple text-xl"></i>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">发现 Git 项目</h1>
              <div className="flex items-center gap-3 text-sm text-gray-500 mt-0.5">
                <span>扫描到 <strong className="text-gray-900">{repos.length}</strong> 个仓库</span>
                <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                <span className="text-orange-600 font-medium"><strong>{unclassifiedCount}</strong> 个待分类</span>
              </div>
            </div>
          </div>
          <button onClick={onCancel} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </header>

        {/* 主内容 - 可滚动区域 */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* 左侧：项目列表 */}
            <div className="lg:col-span-8">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col" style={{ maxHeight: "calc(90vh - 220px)" }}>
                {/* 工具栏 */}
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="scan-checkbox"
                        checked={selectedPaths.size === repos.filter(r => !assignedCategories[r.path]).length && selectedPaths.size > 0}
                        onChange={toggleSelectAll}
                      />
                      <span className="text-sm font-medium text-gray-700">全选</span>
                    </label>
                    <div className="h-4 w-px bg-gray-300"></div>
                    <span className="text-sm text-gray-500">
                      已选 <span className="font-bold text-blue-600">{selectedPaths.size}</span> 项
                    </span>
                  </div>
                  <button
                    onClick={() => setShowingAll(!showingAll)}
                    className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                      !showingAll ? "bg-gray-100 text-gray-600" : "bg-orange-50 text-orange-600 hover:bg-orange-100"
                    }`}
                  >
                    {showingAll ? "仅看未分类" : "显示全部"}
                  </button>
                </div>

                {/* 表头 */}
                <div className="grid grid-cols-12 gap-4 px-5 py-2 bg-gray-50 text-xs font-semibold text-gray-500 border-b border-gray-100 shrink-0">
                  <div className="col-span-1">选择</div>
                  <div className="col-span-8">项目信息</div>
                  <div className="col-span-3 text-right">状态</div>
                </div>

                {/* 列表 */}
                <div className="flex-1 overflow-y-auto scan-scrollbar divide-y divide-gray-50">
                  {filteredRepos.map(repo => {
                    const isSelected = selectedPaths.has(repo.path);
                    const hasCategory = !!assignedCategories[repo.path];
                    const cat = hasCategory ? categories[assignedCategories[repo.path]] : null;

                    return (
                      <div
                        key={repo.path}
                        onClick={() => toggleSelection(repo.path)}
                        className={`scan-project-row grid grid-cols-12 gap-4 px-5 py-3 items-center cursor-pointer ${isSelected ? "selected" : ""} ${hasCategory ? "assigned" : ""}`}
                      >
                        <div className="col-span-1 flex items-center">
                          <input
                            type="checkbox"
                            className="scan-checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            onClick={e => e.stopPropagation()}
                          />
                        </div>
                        <div className="col-span-8 flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-lg shrink-0">
                            <i className="fa-solid fa-folder-open text-gray-400"></i>
                          </div>
                          <div className="min-w-0">
                            <div className={`font-medium text-sm truncate ${hasCategory ? "text-gray-500" : "text-gray-900"}`}>
                              {repo.name}
                            </div>
                            <div className="text-xs text-gray-400 truncate font-mono mt-0.5">{repo.path}</div>
                          </div>
                        </div>
                        <div className="col-span-3 text-right">
                          {hasCategory && cat ? (
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${cat.bg} ${cat.text} border ${cat.border}`}>
                              {cat.icon} {cat.name}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 右侧：操作面板 */}
            <div className="lg:col-span-4 space-y-4">
              {/* 1. 选中状态 */}
              <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl shadow-lg shadow-blue-500/30 p-5 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white/10 rounded-full blur-2xl"></div>
                <div className="relative">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold flex items-center gap-2">
                      <i className="fa-solid fa-users opacity-80"></i>
                      批量归类
                    </h3>
                    <span className="text-3xl font-bold">{selectedPaths.size}</span>
                  </div>
                  <div className={`text-sm mb-3 ${selectedPaths.size === 0 ? "text-blue-200" : "text-white font-medium"}`}>
                    {selectedPaths.size === 0 ? "请在左侧选择项目" : `${previewNames}${selectedPaths.size > 2 ? ` 等 ${selectedPaths.size} 个` : ""}`}
                  </div>
                  <div className="text-xs text-blue-200 bg-blue-800/30 rounded-lg p-2.5">
                    💡 智能检测：选择多个项目后，系统将自动识别共同前缀并推荐分类
                  </div>
                </div>
              </div>

              {/* 2. 智能推荐区 */}
              {commonPrefix && selectedPaths.size >= 2 && (
                <div className="scan-recommend-card rounded-xl p-4 relative">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-lg">
                      <i className="fa-solid fa-bolt text-lg"></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-amber-900 text-sm mb-1">检测到共同前缀</h4>
                      <p className="text-xs text-amber-800 mb-3">
                        选中的 {selectedPaths.size} 个项目均以 "{commonPrefix}" 开头
                      </p>

                      {showRenameInput ? (
                        <div className="mb-3">
                          <input
                            type="text"
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-amber-300 rounded-lg text-sm mb-2 focus:outline-none focus:border-amber-500"
                            placeholder="输入分类名称..."
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <button onClick={confirmRename} className="flex-1 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-medium hover:bg-amber-600">
                              确认使用此名称
                            </button>
                            <button onClick={() => setShowRenameInput(false)} className="px-3 py-1.5 border border-amber-300 text-amber-700 rounded-lg text-xs hover:bg-amber-100">
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button onClick={acceptRecommend} className="flex-1 min-w-[100px] py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold shadow-md transition-colors flex items-center justify-center gap-1">
                            <i className="fa-solid fa-check text-xs"></i>
                            创建 "{commonPrefix}"
                          </button>
                          <button onClick={showRename} className="px-3 py-2 border-2 border-amber-500 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-100 transition-colors">
                            重命名
                          </button>
                          <button onClick={dismissRecommend} className="px-3 py-2 border border-amber-400 text-amber-600 rounded-lg text-xs hover:bg-amber-100 transition-colors">
                            添加到已有
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <button onClick={dismissRecommend} className="absolute top-2 right-2 text-amber-600/60 hover:text-amber-800 p-1">
                    <i className="fa-solid fa-xmark text-sm"></i>
                  </button>
                </div>
              )}

              {/* 3. 分类选择 */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-gray-900 text-sm">选择目标分类</h3>
                  <button onClick={createNewCategory} className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1">
                    <i className="fa-solid fa-plus text-xs"></i>
                    新建
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {Object.entries(categories).map(([id, cat]) => (
                    <div
                      key={id}
                      onClick={() => handleSelectCategory(id)}
                      className={`scan-category-card cursor-pointer border-2 rounded-lg p-3 bg-white group flex items-center gap-3 ${
                        selectedCategory === id ? "active border-blue-500" : "border-gray-100 hover:border-blue-200"
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl shrink-0 ${cat.bg}`}>
                        {cat.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-gray-900 text-sm">{cat.name}</div>
                        <div className="text-xs text-gray-500 truncate">自定义分类</div>
                      </div>
                      <div className={`transition-opacity ${selectedCategory === id ? "opacity-100 text-blue-600" : "opacity-0 group-hover:opacity-50"}`}>
                        <i className="fa-solid fa-check"></i>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 新建分类输入 */}
                {showNewCategoryInput && (
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200 scan-animate-slide-in">
                    <input
                      type="text"
                      value={newCategoryName}
                      onChange={e => setNewCategoryName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && confirmNewCategory()}
                      placeholder="分类名称..."
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm mb-2 focus:outline-none focus:border-blue-500"
                      autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setShowNewCategoryInput(false)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">
                        取消
                      </button>
                      <button onClick={confirmNewCategory} className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700">
                        确定
                      </button>
                    </div>
                  </div>
                )}

                {/* 应用按钮 */}
                <button
                  onClick={applyCategory}
                  disabled={!canApply}
                  className={`w-full mt-3 py-2.5 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 text-sm ${
                    canApply
                      ? "bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/30 cursor-pointer"
                      : "bg-gray-100 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  <i className="fa-solid fa-check"></i>
                  {canApply && selectedCategory ? `应用到「${categories[selectedCategory].name}」` : "应用归类"}
                </button>
              </div>

              {/* 4. 操作记录 */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">本次操作记录</h3>
                  <span className="text-xs text-gray-400">{history.length} 次操作</span>
                </div>
                <div className="flex flex-wrap gap-2 content-start max-h-20 overflow-y-auto">
                  {history.length === 0 ? (
                    <div className="text-xs text-gray-400 italic py-2">暂无归类操作</div>
                  ) : (
                    history.map((item, idx) => {
                      const cat = categories[item.category];
                      return (
                        <div
                          key={idx}
                          onClick={() => undoHistory(idx)}
                          className={`scan-history-tag inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer hover:opacity-80 ${cat?.bg || "bg-gray-100"} ${cat?.text || "text-gray-700"} border ${cat?.border || "border-gray-200"}`}
                          title="点击撤销"
                        >
                          <span>{cat?.icon || "📦"}</span>
                          <span>{item.name}</span>
                          <span className="opacity-60">×{item.count}</span>
                          <i className="fa-solid fa-xmark ml-1 opacity-60 text-xs"></i>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 底部固定操作栏 */}
        <footer className="bg-white border-t border-gray-200 px-6 py-4 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span>已归类: <strong className="text-gray-900">{assignedCount}</strong> 个</span>
              <span>待导入: <strong className="text-blue-600">{assignedCount}</strong> 个</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={resetAll}
                className="px-4 py-2.5 border border-gray-300 text-gray-600 rounded-lg font-medium hover:bg-gray-50 transition-colors text-sm flex items-center gap-2"
                title="重置"
              >
                <i className="fa-solid fa-rotate-left"></i>
                重置
              </button>
              <button
                onClick={onCancel}
                className="px-4 py-2.5 border border-gray-300 text-gray-600 rounded-lg font-medium hover:bg-gray-50 transition-colors text-sm"
              >
                取消
              </button>
              <button
                onClick={finishImport}
                disabled={assignedCount === 0}
                className={`px-6 py-2.5 rounded-lg font-semibold transition-all text-sm flex items-center gap-2 ${
                  assignedCount > 0
                    ? "bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/30"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                }`}
              >
                <i className="fa-solid fa-circle-check"></i>
                确认导入 {assignedCount > 0 ? `(${assignedCount})` : ""}
              </button>
            </div>
          </div>
        </footer>
      </div>

      <style>{`
        .scan-dialog {
          animation: scanSlideDown 0.3s ease-out;
        }
        @keyframes scanSlideDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .scan-project-row {
          transition: all 0.15s ease;
          border-left: 3px solid transparent;
        }
        .scan-project-row:hover {
          background-color: #f8fafc;
        }
        .scan-project-row.selected {
          background-color: #eff6ff;
          border-left-color: #3b82f6;
        }
        .scan-project-row.assigned {
          opacity: 0.5;
        }
        .scan-category-card {
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .scan-category-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
        }
        .scan-category-card.active {
          box-shadow: 0 0 0 2px #3b82f6, 0 10px 25px -5px rgba(59, 130, 246, 0.3);
          transform: translateY(-2px);
        }
        .scan-recommend-card {
          animation: scanSlideDown 0.3s ease-out;
          background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
          border: 2px solid #fbbf24;
        }
        .scan-history-tag {
          animation: scanPopIn 0.3s ease-out;
        }
        @keyframes scanPopIn {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
        .scan-checkbox {
          appearance: none;
          width: 18px;
          height: 18px;
          border: 2px solid #cbd5e1;
          border-radius: 5px;
          cursor: pointer;
          transition: all 0.15s;
          position: relative;
        }
        .scan-checkbox:checked {
          background-color: #3b82f6;
          border-color: #3b82f6;
        }
        .scan-checkbox:checked::after {
          content: '';
          position: absolute;
          left: 5px;
          top: 2px;
          width: 5px;
          height: 9px;
          border: solid white;
          border-width: 0 2px 2px 0;
          transform: rotate(45deg);
        }
        .scan-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .scan-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .scan-scrollbar::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 20px;
        }
        .scan-animate-slide-in {
          animation: scanSlideDown 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}
