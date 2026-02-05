import { useState, useEffect, useRef } from "react";
import { ProjectCard, ScanResultDialog, ProjectDetailPanel, AddProjectDialog, AddCategoryDialog, CategorySelector, LabelSelector } from "@/components/project";
import { FloatingCategoryBall, showToast } from "@/components/ui";
import { Minus, X, MoreVertical, Plus, CheckSquare, Square, Trash2, Tag, Bookmark, Maximize2, Minimize2 } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import type { Project, GitRepo, GitStatus } from "@/types";
import { getProjects, addProject, removeProject, updateProject } from "@/services/db";
import { scanDirectory, getGitStatus } from "@/services/git";
import { open } from "@tauri-apps/plugin-dialog";
import { Dropdown, FilterPopover } from "@/components/ui";

import { getCurrentWindow } from "@tauri-apps/api/window";

export function ShelfPage() {
  const {
    projects,
    setProjects,
    searchQuery,
    setSearchQuery,
    scanDepth,
    categories: storedCategories,
    labels: storedLabels,
    markProjectDirty,
    selectedProjectId,
    setSelectedProjectId,
  } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [scanResults, setScanResults] = useState<GitRepo[] | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [onlyModified, setOnlyModified] = useState(false);
  const [showAddProjectDialog, setShowAddProjectDialog] = useState(false);
  const [showAddCategoryDialog, setShowAddCategoryDialog] = useState(false);
  const [showFloatingBall, setShowFloatingBall] = useState(false);
  const { sidebarCollapsed, setSidebarCollapsed } = useAppStore();
  const categoryBarRef = useRef<HTMLDivElement>(null);
  // Git 状态缓存，用于筛选功能
  const [gitStatusMap, setGitStatusMap] = useState<Record<string, GitStatus>>({});

  // 批量操作状态
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchCategoryModal, setShowBatchCategoryModal] = useState(false);
  const [batchCategories, setBatchCategories] = useState<string[]>([]);
  const [batchCategoryMode, setBatchCategoryMode] = useState<"replace" | "append">("append");

  // 批量标签状态
  const [showBatchLabelModal, setShowBatchLabelModal] = useState(false);
  const [batchLabels, setBatchLabels] = useState<string[]>([]);
  const [batchLabelMode, setBatchLabelMode] = useState<"replace" | "append">("append");

  // 全屏状态
  const [isMaximized, setIsMaximized] = useState(false);

  // 标签筛选状态
  const [selectedLabelFilters, setSelectedLabelFilters] = useState<string[]>([]);

  useEffect(() => {
    loadProjects();
  }, []);

  // 从 store 的 selectedProjectId 同步打开项目详情（由其他页面跳转触发）
  useEffect(() => {
    if (selectedProjectId) {
      const project = projects.find((p) => p.id === selectedProjectId);
      if (project) {
        // 更新 lastOpened 时间
        const updatedProject = { ...project, lastOpened: new Date().toISOString() };
        setProjects(projects.map(p => p.id === project.id ? updatedProject : p));
        setSelectedProject(updatedProject);
      }
      setSelectedProjectId(null);
    }
  }, [selectedProjectId, projects]);

  // 检查窗口最大化状态
  useEffect(() => {
    checkMaximized();
    // 监听窗口 resize 事件来更新最大化状态
    const handleResize = () => {
      checkMaximized();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  async function checkMaximized() {
    const appWindow = getCurrentWindow();
    const maximized = await appWindow.isMaximized();
    setIsMaximized(maximized);
  }

  async function handleToggleMaximize() {
    const appWindow = getCurrentWindow();
    await appWindow.toggleMaximize();
    checkMaximized();
  }

  // 当启用 onlyModified 筛选时，加载所有项目的 git 状态
  useEffect(() => {
    if (onlyModified && projects.length > 0) {
      loadAllGitStatus();
    }
  }, [onlyModified, projects.length]);

  // 加载所有项目的 git 状态
  async function loadAllGitStatus() {
    const statusMap: Record<string, GitStatus> = {};
    await Promise.all(
      projects.map(async (project) => {
        try {
          const status = await getGitStatus(project.path);
          statusMap[project.id] = status;
        } catch (error) {
          console.error(`Failed to get git status for ${project.name}:`, error);
        }
      })
    );
    setGitStatusMap(statusMap);
  }

  // 监听滚动，显示/隐藏浮动分类球
  useEffect(() => {
    const handleScroll = () => {
      if (categoryBarRef.current) {
        const rect = categoryBarRef.current.getBoundingClientRect();
        // 当分类栏滚出视口时显示浮动球
        setShowFloatingBall(rect.bottom < 0);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Extract unique categories (tags) from projects and stored categories
  const categories = Array.from(new Set([...storedCategories, ...projects.flatMap(p => p.tags)]));
  const activeCat = selectedTags.length === 0 ? "全部" : selectedTags[0];

  // 收集所有可用的标签（从 store 和项目中）
  const allLabels = Array.from(new Set([
    ...storedLabels,
    ...projects.flatMap(p => p.labels || [])
  ]));

  async function loadProjects() {
    try {
      // If we already have cached projects from Zustand, show them immediately
      if (projects.length > 0) {
        setLoading(false);
      } else {
        setLoading(true);
      }

      // Sync with backend in background
      const data = await getProjects();
      setProjects(data);
    } catch (error) {
      console.error("Failed to load projects:", error);
    } finally {
      setLoading(false);
    }
  }


  async function handleScanDirectory() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择要扫描的目录",
      });

      if (selected) {
        setLoading(true);
        const path = selected as string;
        const repos = await scanDirectory(path, scanDepth);

        // Filter out already added projects
        const existingPaths = new Set(projects.map(p => p.path));
        const newRepos = repos.filter(repo => !existingPaths.has(repo.path));

        if (newRepos.length === 0) {
          alert("未发现新的 Git 项目");
        } else {
          setScanResults(newRepos);
        }
      }
    } catch (error) {
      console.error("Failed to scan directory:", error);
      alert("扫描失败：" + error);
    } finally {
      setLoading(false);
    }
  }


  async function handleConfirmScan(selectedPaths: string[], categories: string[], labels: string[]) {
    try {
      setLoading(true);
      const newProjects: Project[] = [];

      for (let i = 0; i < selectedPaths.length; i++) {
        const path = selectedPaths[i];
        const category = categories[i]; // 使用对应索引的分类
        const repo = scanResults?.find(r => r.path === path);
        if (repo) {
          try {
            const project = await addProject({
              name: repo.name,
              path: repo.path,
              tags: category ? [category] : [], // 单个分类作为数组
              labels: labels,
            });
            newProjects.push(project);
          } catch (error) {
            console.error(`Failed to add project ${repo.name}:`, error);
          }
        }
      }

      if (newProjects.length > 0) {
        setProjects([...projects, ...newProjects]);
        // Mark all new projects as dirty for stats refresh
        newProjects.forEach(p => markProjectDirty(p.path));
      }

      setScanResults(null);
    } catch (error) {
      console.error("Failed to add projects:", error);
    } finally {
      setLoading(false);
    }
  }

  function handleProjectUpdate(updated: Project) {
    setProjects(projects.map((p) => (p.id === updated.id ? updated : p)));
  }

  // 打开项目详情时更新 lastOpened
  function handleShowProjectDetail(project: Project) {
    // 更新 lastOpened 时间
    const updatedProject = { ...project, lastOpened: new Date().toISOString() };
    setProjects(projects.map(p => p.id === project.id ? updatedProject : p));
    setSelectedProject(updatedProject);
  }

  function handleProjectDelete(projectId: string) {
    const deletedProject = projects.find(p => p.id === projectId);
    setProjects(projects.filter((p) => p.id !== projectId));
    // Mark the deleted project as dirty so stats are refreshed
    if (deletedProject) {
      markProjectDirty(deletedProject.path);
    }
  }

  // 批量操作函数
  function toggleBatchMode() {
    setBatchMode(!batchMode);
    if (batchMode) {
      setSelectedIds(new Set());
    }
  }

  function toggleSelectProject(id: string) {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  }

  function selectAllProjects() {
    if (selectedIds.size === sortedProjects.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedProjects.map(p => p.id)));
    }
  }

  async function handleBatchRemove() {
    if (selectedIds.size === 0) return;

    const confirmMsg = `确定要从书架移除 ${selectedIds.size} 个项目吗？\n（项目文件不会被删除）`;
    if (!confirm(confirmMsg)) return;

    try {
      setLoading(true);
      const removedProjects = projects.filter(p => selectedIds.has(p.id));
      for (const id of selectedIds) {
        await removeProject(id);
      }
      setProjects(projects.filter(p => !selectedIds.has(p.id)));
      // Mark removed projects as dirty for stats refresh
      removedProjects.forEach(p => markProjectDirty(p.path));
      setSelectedIds(new Set());
      setBatchMode(false);
      showToast("success", "移除成功", `已从书架移除 ${selectedIds.size} 个项目`);
    } catch (error) {
      console.error("Failed to remove projects:", error);
      showToast("error", "移除失败", String(error));
    } finally {
      setLoading(false);
    }
  }

  async function handleBatchUpdateCategory(newCategories: string[], mode: "replace" | "append") {
    if (selectedIds.size === 0) return;

    try {
      setLoading(true);
      const updatedProjects: Project[] = [];

      for (const id of selectedIds) {
        const currentProject = projects.find(p => p.id === id);
        let finalTags: string[];

        if (mode === "append") {
          // 追加模式：合并原有分类和新分类，去重
          const existingTags = currentProject?.tags || [];
          finalTags = Array.from(new Set([...existingTags, ...newCategories]));
        } else {
          // 替换模式：直接使用新分类
          finalTags = newCategories;
        }

        const updated = await updateProject({ id, tags: finalTags });
        updatedProjects.push(updated);
      }

      setProjects(projects.map(p => {
        const updated = updatedProjects.find(u => u.id === p.id);
        return updated || p;
      }));

      setSelectedIds(new Set());
      setBatchMode(false);
      setShowBatchCategoryModal(false);
      const modeText = mode === "append" ? "追加" : "替换";
      showToast("success", "更新成功", `已${modeText} ${selectedIds.size} 个项目的分类`);
    } catch (error) {
      console.error("Failed to update categories:", error);
      showToast("error", "更新失败", String(error));
    } finally {
      setLoading(false);
    }
  }

  async function handleBatchUpdateLabels(newLabels: string[], mode: "replace" | "append") {
    if (selectedIds.size === 0) return;

    try {
      setLoading(true);
      const updatedProjects: Project[] = [];

      for (const id of selectedIds) {
        const currentProject = projects.find(p => p.id === id);
        let finalLabels: string[];

        if (mode === "append") {
          // 追加模式：合并原有标签和新标签，去重
          const existingLabels = currentProject?.labels || [];
          finalLabels = Array.from(new Set([...existingLabels, ...newLabels]));
        } else {
          // 替换模式：直接使用新标签
          finalLabels = newLabels;
        }

        const updated = await updateProject({ id, labels: finalLabels });
        updatedProjects.push(updated);
      }

      setProjects(projects.map(p => {
        const updated = updatedProjects.find(u => u.id === p.id);
        return updated || p;
      }));

      setSelectedIds(new Set());
      setBatchMode(false);
      setShowBatchLabelModal(false);
      const modeText = mode === "append" ? "追加" : "替换";
      showToast("success", "更新成功", `已${modeText} ${selectedIds.size} 个项目的标签`);
    } catch (error) {
      console.error("Failed to update labels:", error);
      showToast("error", "更新失败", String(error));
    } finally {
      setLoading(false);
    }
  }

  // Filter projects
  const filteredProjects = projects.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.path.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (activeCat !== "全部" && !p.tags.includes(activeCat)) return false;
    if (onlyStarred && !p.isFavorite) return false;

    // onlyModified 筛选：检查项目是否有未提交的修改
    if (onlyModified) {
      const status = gitStatusMap[p.id];
      // 如果没有状态信息，暂时显示（等待加载）
      if (!status) return true;
      // 只显示有修改的项目
      if (status.isClean) return false;
    }

    // 标签筛选：项目需要包含任一选中的标签（OR 逻辑）
    if (selectedLabelFilters.length > 0) {
      const projectLabels = p.labels || [];
      if (!selectedLabelFilters.some(label => projectLabels.includes(label))) {
        return false;
      }
    }

    return true;
  });

  const sortedProjects = [...filteredProjects].sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex flex-col min-h-full">
      {/* Header with Drag Region and Window Controls integrated */}
      <header className="re-header sticky top-0 z-20" data-tauri-drag-region>
        <span
          className="toggle"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          ☰
        </span>

        <div className="flex items-center gap-2 mr-4" data-tauri-drag-region>
          <span className="text-lg font-semibold ml-2 whitespace-nowrap">📖 我的书架</span>
        </div>

        {/* Simplified Search Box */}
        <div className="re-search-center" data-tauri-drag-region>
          <div className="re-search-box">
            <input
              id="searchInput"
              placeholder="搜索项目名称或路径…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button>🔍</button>
          </div>
        </div>

        {/* Actions - Reorganized */}
        <div className="re-actions flex items-center gap-2">
          {/* Filter Button */}
          <FilterPopover
            onlyStarred={onlyStarred}
            onlyModified={onlyModified}
            onStarredChange={setOnlyStarred}
            onModifiedChange={setOnlyModified}
            availableLabels={allLabels}
            selectedLabels={selectedLabelFilters}
            onLabelsChange={setSelectedLabelFilters}
          />

          {/* Batch Mode Toggle */}
          <button
            className={`re-btn flex items-center gap-2 ${batchMode ? 're-btn-active' : ''}`}
            onClick={toggleBatchMode}
            title={batchMode ? "退出批量操作" : "批量操作"}
          >
            <CheckSquare size={16} />
            <span>{batchMode ? "退出批量" : "批量"}</span>
          </button>

          {/* More Menu */}
          <Dropdown
            trigger={
              <button className="re-btn flex items-center gap-2" title="更多操作">
                <MoreVertical size={16} />
                <span>更多</span>
              </button>
            }
            items={[
              {
                icon: "🔍",
                label: "扫描目录",
                onClick: handleScanDirectory,
              },
              {
                icon: "🏷️",
                label: "添加分类",
                onClick: () => setShowAddCategoryDialog(true),
              },
            ]}
          />

          {/* Primary Action */}
          <button className="re-btn re-btn-primary flex items-center gap-2" onClick={() => setShowAddProjectDialog(true)}>
            <Plus size={16} />
            <span>项目</span>
          </button>

          {/* Integrated Window Controls */}
          <div className="flex items-center ml-2 border-l border-gray-200 pl-3 gap-1 h-6">
            <button
              onClick={handleToggleMaximize}
              className="w-7 h-7 flex items-center justify-center hover:bg-gray-100 rounded-md transition-colors text-gray-400 hover:text-gray-600"
              title={isMaximized ? "还原" : "最大化"}
            >
              {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button
              onClick={() => getCurrentWindow()?.minimize()}
              className="w-7 h-7 flex items-center justify-center hover:bg-gray-100 rounded-md transition-colors text-gray-400 hover:text-gray-600"
              title="最小化"
            >
              <Minus size={14} />
            </button>
            <button
              onClick={() => getCurrentWindow()?.close()}
              className="w-7 h-7 flex items-center justify-center hover:bg-red-500 hover:text-white rounded-md transition-colors text-gray-400"
              title="关闭"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* Category Bar */}
      <div ref={categoryBarRef} className="re-cat-bar">
        <span className="text-sm text-gray-500">分类：</span>
        <div className="re-cat-list">
          {["全部", ...categories].map((c) => (
            <span
              key={c}
              className={`re-cat ${c === activeCat ? "active" : ""}`}
              onClick={() => setSelectedTags(c === "全部" ? [] : [c])}
            >
              {c}
            </span>
          ))}
        </div>
      </div>

      {/* Batch Action Bar */}
      {batchMode && (
        <div className="re-batch-bar">
          <div className="flex items-center gap-4">
            <button
              className="re-batch-select-all"
              onClick={selectAllProjects}
            >
              {selectedIds.size === sortedProjects.length ? (
                <CheckSquare size={16} className="text-blue-600" />
              ) : (
                <Square size={16} />
              )}
              <span>{selectedIds.size === sortedProjects.length ? "取消全选" : "全选"}</span>
            </button>
            <span className="text-sm text-gray-500">
              已选择 <strong className="text-blue-600">{selectedIds.size}</strong> 个项目
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="re-btn re-btn-secondary flex items-center gap-2"
              onClick={() => setShowBatchCategoryModal(true)}
              disabled={selectedIds.size === 0}
            >
              <Tag size={14} />
              <span>修改分类</span>
            </button>
            <button
              className="re-btn re-btn-secondary flex items-center gap-2"
              onClick={() => setShowBatchLabelModal(true)}
              disabled={selectedIds.size === 0}
            >
              <Bookmark size={14} />
              <span>修改标签</span>
            </button>
            <button
              className="re-btn re-btn-danger flex items-center gap-2"
              onClick={handleBatchRemove}
              disabled={selectedIds.size === 0}
            >
              <Trash2 size={14} />
              <span>移除书架</span>
            </button>
          </div>
        </div>
      )}

      {/* 浮动分类球 */}
      {showFloatingBall && (
        <FloatingCategoryBall
          categories={categories}
          activeCategory={activeCat}
          onCategoryChange={(category) => setSelectedTags(category === "全部" ? [] : [category])}
        />
      )}

      {/* Content */}
      <div className="flex-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent mb-4" />
            <p>加载中...</p>
          </div>
        ) : sortedProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <span className="text-6xl mb-4 opacity-50">📂</span>
            <p className="text-lg font-medium mb-2 text-gray-700">还没有项目</p>
            <p className="text-sm">点击"+ 项目"开始使用</p>
          </div>
        ) : (
          <div className="re-shelf">
            {sortedProjects.map((project) => (
              <div key={project.id} className="relative">
                {batchMode && (
                  <div
                    className="re-batch-checkbox"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelectProject(project.id);
                    }}
                  >
                    {selectedIds.has(project.id) ? (
                      <CheckSquare size={20} className="text-blue-600" />
                    ) : (
                      <Square size={20} className="text-gray-400" />
                    )}
                  </div>
                )}
                <ProjectCard
                  project={project}
                  onUpdate={handleProjectUpdate}
                  onShowDetail={batchMode ? () => toggleSelectProject(project.id) : handleShowProjectDetail}
                  onDelete={handleProjectDelete}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scan Result Dialog */}
      {scanResults && (
        <ScanResultDialog
          repos={scanResults}
          onConfirm={handleConfirmScan}
          onCancel={() => setScanResults(null)}
        />
      )}

      {/* Project Detail Panel */}
      {selectedProject && (
        <ProjectDetailPanel
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onUpdate={handleProjectUpdate}
          onSwitchProject={(p) => setSelectedProject(p)}
        />
      )}

      {/* Add Project Dialog */}
      {showAddProjectDialog && (
        <AddProjectDialog
          onConfirm={(project) => {
            setProjects([...projects, project]);
            setShowAddProjectDialog(false);
            markProjectDirty(project.path); // Mark for stats refresh
          }}
          onCancel={() => setShowAddProjectDialog(false)}
        />
      )}

      {/* Add Category Dialog */}
      {showAddCategoryDialog && (
        <AddCategoryDialog
          onClose={() => setShowAddCategoryDialog(false)}
        />
      )}

      {/* Batch Category Modal */}
      {showBatchCategoryModal && (
        <div className="modal-overlay animate-fade-in">
          <div className="modal-content animate-scale-in max-w-lg">
            <div className="modal-header">
              <div>
                <h3 className="modal-title">批量修改分类</h3>
                <p className="modal-subtitle">为选中的 {selectedIds.size} 个项目设置分类</p>
              </div>
              <button
                onClick={() => {
                  setShowBatchCategoryModal(false);
                  setBatchCategories([]);
                }}
                className="modal-close-btn"
              >
                ×
              </button>
            </div>

            <div className="modal-body">
              {/* 模式选择 */}
              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <label className="text-sm font-medium text-gray-700 mb-2 block">操作模式</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="batchMode"
                      checked={batchCategoryMode === "append"}
                      onChange={() => setBatchCategoryMode("append")}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm text-gray-700">追加分类</span>
                    <span className="text-xs text-gray-400">（保留原有分类）</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="batchMode"
                      checked={batchCategoryMode === "replace"}
                      onChange={() => setBatchCategoryMode("replace")}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm text-gray-700">替换分类</span>
                    <span className="text-xs text-gray-400">（清空原有分类）</span>
                  </label>
                </div>
              </div>

              <CategorySelector
                selectedCategories={batchCategories}
                onChange={setBatchCategories}
                multiple={true}
              />
            </div>

            <div className="modal-footer">
              <button
                onClick={() => {
                  setShowBatchCategoryModal(false);
                  setBatchCategories([]);
                }}
                className="modal-btn modal-btn-secondary"
              >
                取消
              </button>
              <button
                onClick={() => handleBatchUpdateCategory(batchCategories, batchCategoryMode)}
                disabled={batchCategories.length === 0}
                className="modal-btn modal-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                确认修改
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Label Modal */}
      {showBatchLabelModal && (
        <div className="modal-overlay animate-fade-in">
          <div className="modal-content animate-scale-in max-w-lg">
            <div className="modal-header">
              <div>
                <h3 className="modal-title">批量修改标签</h3>
                <p className="modal-subtitle">为选中的 {selectedIds.size} 个项目设置技术栈标签</p>
              </div>
              <button
                onClick={() => {
                  setShowBatchLabelModal(false);
                  setBatchLabels([]);
                }}
                className="modal-close-btn"
              >
                ×
              </button>
            </div>

            <div className="modal-body">
              {/* 模式选择 */}
              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <label className="text-sm font-medium text-gray-700 mb-2 block">操作模式</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="batchLabelMode"
                      checked={batchLabelMode === "append"}
                      onChange={() => setBatchLabelMode("append")}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm text-gray-700">追加标签</span>
                    <span className="text-xs text-gray-400">（保留原有标签）</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="batchLabelMode"
                      checked={batchLabelMode === "replace"}
                      onChange={() => setBatchLabelMode("replace")}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm text-gray-700">替换标签</span>
                    <span className="text-xs text-gray-400">（清空原有标签）</span>
                  </label>
                </div>
              </div>

              <LabelSelector
                selectedLabels={batchLabels}
                onChange={setBatchLabels}
                multiple={true}
              />
            </div>

            <div className="modal-footer">
              <button
                onClick={() => {
                  setShowBatchLabelModal(false);
                  setBatchLabels([]);
                }}
                className="modal-btn modal-btn-secondary"
              >
                取消
              </button>
              <button
                onClick={() => handleBatchUpdateLabels(batchLabels, batchLabelMode)}
                disabled={batchLabels.length === 0}
                className="modal-btn modal-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                确认修改
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
