import { useState, useEffect, useRef, useCallback } from "react";
import { ProjectCard, ScanResultDialog, ProjectDetailPanel, AddProjectDialog, AddCategoryDialog, CategorySelector, LabelSelector } from "@/components/project";
import { ResumeGenerator } from "../Toolbox/ResumeGenerator";
import { FloatingCategoryBall, showToast } from "@/components/ui";
import { MoreVertical, Plus, CheckSquare, Square, Trash2, Tag, Bookmark, ChevronLeft, ChevronRight } from "lucide-react";
import { useProjectsStore } from "@/stores/projectsStore";
import { useUiStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { Project, GitRepo, GitStatus } from "@/types";
import { getProjects, addProject, removeProject, updateProject } from "@/services/db";
import { scanDirectory, getGitStatus } from "@/services/git";
import { open } from "@tauri-apps/plugin-dialog";
import { Dropdown, FilterPopover } from "@/components/ui";
import { MacWindowControls } from "@/components/layout/MacWindowControls";
import { errMsg } from "@/utils/errMsg";

export function ShelfPage() {
  const {
    projects,
    setProjects,
    categories: storedCategories,
    labels: storedLabels,
    markProjectDirty,
    selectedProjectId,
    setSelectedProjectId,
  } = useProjectsStore();
  const { searchQuery, setSearchQuery } = useUiStore();
  const scanDepth = useSettingsStore((s) => s.scanDepth);
  const [loading, setLoading] = useState(true);
  const [scanResults, setScanResults] = useState<GitRepo[] | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [onlyModified, setOnlyModified] = useState(false);
  const [showAddProjectDialog, setShowAddProjectDialog] = useState(false);
  const [addProjectInitialPath, setAddProjectInitialPath] = useState<string | null>(null);
  const [showAddCategoryDialog, setShowAddCategoryDialog] = useState(false);
  const [showFloatingBall, setShowFloatingBall] = useState(false);
  const { sidebarCollapsed, setSidebarCollapsed } = useSettingsStore();
  const categoryBarRef = useRef<HTMLDivElement>(null);
  const catListRef = useRef<HTMLDivElement>(null);
  const [catScrollState, setCatScrollState] = useState({ left: false, right: false });
  // Git 状态缓存，用于筛选功能
  const [gitStatusMap, setGitStatusMap] = useState<Record<string, GitStatus>>({});
  // 读取失败的项目单独记一份：失败 ≠ 干净，也 ≠ 还在加载。
  // 只有一个 map 的话，「git 不存在 / 不是仓库 / 目录不可访问」会和「加载中」混在一起，
  // 筛选时被静默归类，用户不知道有项目根本没读到状态。
  const [gitErrorIds, setGitErrorIds] = useState<Set<string>>(new Set());
  const externalAddProjectPaths = useUiStore((s) => s.externalAddProjectPaths);
  const takeExternalAddProjectPath = useUiStore((s) => s.takeExternalAddProjectPath);

  // 系统文件管理器传入的路径只负责调起现有添加表单；多个路径按顺序逐个处理。
  useEffect(() => {
    if (showAddProjectDialog || externalAddProjectPaths.length === 0) return;
    const path = takeExternalAddProjectPath();
    if (!path) return;
    setSelectedProject(null);
    setAddProjectInitialPath(path);
    setShowAddProjectDialog(true);
  }, [externalAddProjectPaths, showAddProjectDialog, takeExternalAddProjectPath]);

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

  // 标签筛选状态
  const [selectedLabelFilters, setSelectedLabelFilters] = useState<string[]>([]);

  // 简历生成器状态
  const [showResumeGenerator, setShowResumeGenerator] = useState(false);

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

  // 当启用 onlyModified 筛选时，加载所有项目的 git 状态
  useEffect(() => {
    if (onlyModified && projects.length > 0) {
      loadAllGitStatus();
    }
  }, [onlyModified, projects.length]);

  /**
   * 批量操作逐项执行并**对账**。
   *
   * 原来是 `for (...) await ...` 一把梭：中途某一项失败会直接抛出，
   * 前面已经成功的那些既不会反映到界面上，也不会被告知用户；
   * 而成功路径的 toast 固定报 `selectedIds.size`，与真正成功的数量未必一致。
   *
   * 现在每项独立成败，返回成功项和失败明细，由调用方按真实结果更新状态和提示。
   */
  async function runBatch<T>(
    ids: Iterable<string>,
    fn: (id: string) => Promise<T>,
  ): Promise<{ ok: T[]; failed: { id: string; error: unknown }[] }> {
    const ok: T[] = [];
    const failed: { id: string; error: unknown }[] = [];
    // 去重：同一个 ID 出现两次会被执行两遍，第二次多半报"不存在"
    for (const id of new Set(ids)) {
      try {
        ok.push(await fn(id));
      } catch (error) {
        console.error(`批量操作失败 (${id}):`, error);
        failed.push({ id, error });
      }
    }
    return { ok, failed };
  }

  /** 按真实成败给提示：全成功 / 部分失败 / 全失败 三种都要说清楚 */
  function reportBatch(action: string, okCount: number, failed: { id: string; error: unknown }[]) {
    if (failed.length === 0) {
      showToast("success", `${action}成功`, `${okCount} 个项目`);
      return;
    }
    const detail = errMsg(failed[0].error, "未知原因");
    if (okCount === 0) {
      showToast("error", `${action}失败`, `${failed.length} 个项目全部失败：${detail}`);
    } else {
      showToast(
        "warning",
        `${action}部分失败`,
        `${okCount} 个成功，${failed.length} 个失败：${detail}`,
      );
    }
  }

  // 加载所有项目的 git 状态
  async function loadAllGitStatus() {
    const statusMap: Record<string, GitStatus> = {};
    const failed = new Set<string>();
    await Promise.all(
      projects.map(async (project) => {
        try {
          const status = await getGitStatus(project.path);
          statusMap[project.id] = status;
        } catch (error) {
          console.error(`Failed to get git status for ${project.name}:`, error);
          failed.add(project.id);
        }
      })
    );
    setGitStatusMap(statusMap);
    setGitErrorIds(failed);
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

    // 滚动容器是 main 元素，不是 window
    const scrollContainer = document.querySelector('main.overflow-auto');
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", handleScroll);
      return () => scrollContainer.removeEventListener("scroll", handleScroll);
    }
  }, []);

  // Extract unique categories (tags) from projects and stored categories
  const categories = Array.from(new Set([...storedCategories, ...projects.flatMap(p => p.tags)]));
  const activeCat = selectedTags.length === 0 ? "全部" : selectedTags[0];

  // 分类栏滚动检测
  const updateCatScroll = useCallback(() => {
    const el = catListRef.current;
    if (!el) return;
    const hasOverflow = el.scrollWidth > el.clientWidth + 1;
    setCatScrollState({
      left: el.scrollLeft > 2,
      right: hasOverflow && el.scrollLeft < el.scrollWidth - el.clientWidth - 2,
    });
  }, []);

  useEffect(() => {
    const el = catListRef.current;
    if (!el) return;
    updateCatScroll();
    el.addEventListener("scroll", updateCatScroll, { passive: true });
    const ro = new ResizeObserver(updateCatScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateCatScroll);
      ro.disconnect();
    };
  }, [updateCatScroll, categories.length]);

  const scrollCatList = (dir: "left" | "right") => {
    const el = catListRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -200 : 200, behavior: "smooth" });
  };

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
      const { ok: removedIds, failed } = await runBatch(selectedIds, async (id) => {
        await removeProject(id);
        return id;
      });
      const removedSet = new Set(removedIds);
      // 只移除**确实删掉**的那些，失败的留在书架上（它们还在）
      const removedProjects = projects.filter(p => removedSet.has(p.id));
      setProjects(projects.filter(p => !removedSet.has(p.id)));
      removedProjects.forEach(p => markProjectDirty(p.path));
      // 失败的保持选中，用户可以直接重试
      setSelectedIds(new Set(failed.map(f => f.id)));
      if (failed.length === 0) setBatchMode(false);
      reportBatch("移除", removedIds.length, failed);
    } catch (error) {
      console.error("Failed to remove projects:", error);
      showToast("error", "移除失败", errMsg(error, "未知原因"));
    } finally {
      setLoading(false);
    }
  }

  async function handleBatchUpdateCategory(newCategories: string[], mode: "replace" | "append") {
    if (selectedIds.size === 0) return;

    try {
      setLoading(true);
      const updatedProjects: Project[] = [];

      // 逐项独立成败：中途一项失败不该让前面成功的改动丢掉界面反馈
      const { ok: okUpdates, failed } = await runBatch(selectedIds, async (id) => {
        const currentProject = projects.find(p => p.id === id);
        const finalTags =
          mode === "append"
            ? Array.from(new Set([...(currentProject?.tags || []), ...newCategories]))
            : newCategories;
        return updateProject({ id, tags: finalTags });
      });
      updatedProjects.push(...okUpdates);

      setProjects(projects.map(p => {
        const updated = updatedProjects.find(u => u.id === p.id);
        return updated || p;
      }));

      setSelectedIds(new Set(failed.map(f => f.id)));
      if (failed.length === 0) setBatchMode(false);
      setShowBatchCategoryModal(false);
      const modeText = mode === "append" ? "追加" : "替换";
      reportBatch(`${modeText}分类`, updatedProjects.length, failed);
    } catch (error) {
      console.error("Failed to update categories:", error);
      showToast("error", "更新失败", errMsg(error, "未知原因"));
    } finally {
      setLoading(false);
    }
  }

  async function handleBatchUpdateLabels(newLabels: string[], mode: "replace" | "append") {
    if (selectedIds.size === 0) return;

    try {
      setLoading(true);
      const updatedProjects: Project[] = [];

      const { ok: okUpdates, failed } = await runBatch(selectedIds, async (id) => {
        const currentProject = projects.find(p => p.id === id);
        const finalLabels =
          mode === "append"
            ? Array.from(new Set([...(currentProject?.labels || []), ...newLabels]))
            : newLabels;
        return updateProject({ id, labels: finalLabels });
      });
      updatedProjects.push(...okUpdates);

      setProjects(projects.map(p => {
        const updated = updatedProjects.find(u => u.id === p.id);
        return updated || p;
      }));

      setSelectedIds(new Set(failed.map(f => f.id)));
      if (failed.length === 0) setBatchMode(false);
      setShowBatchLabelModal(false);
      const modeText = mode === "append" ? "追加" : "替换";
      reportBatch(`${modeText}标签`, updatedProjects.length, failed);
    } catch (error) {
      console.error("Failed to update labels:", error);
      showToast("error", "更新失败", errMsg(error, "未知原因"));
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
      // 状态未知（读取失败或仍在加载）时**保留**该项目：
      // 隐藏等于替用户断言"它没有修改"，而我们根本不知道。
      // 卡片本身会显示「状态未知 / 读取中…」，不会被静默误分类。
      if (!status) return true;
      if (gitErrorIds.has(p.id)) return true;
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
              {
                icon: "📄",
                label: "简历生成",
                onClick: () => setShowResumeGenerator(true),
              },
            ]}
          />

          {/* Primary Action */}
          <button
            className="re-btn re-btn-primary flex items-center gap-2"
            onClick={() => {
              setAddProjectInitialPath(null);
              setShowAddProjectDialog(true);
            }}
          >
            <Plus size={16} />
            <span>项目</span>
          </button>

          <MacWindowControls />
        </div>
      </header>

      {/* Category Bar */}
      <div ref={categoryBarRef} className="re-cat-bar">
        <span className="text-sm text-gray-500 flex-shrink-0">分类：</span>
        {catScrollState.left && (
          <button className="re-cat-arrow" onClick={() => scrollCatList("left")}>
            <ChevronLeft size={14} />
          </button>
        )}
        <div className={`re-cat-scroll-wrap ${catScrollState.left ? 'fade-left' : ''} ${catScrollState.right ? 'fade-right' : ''}`}>
          <div ref={catListRef} className="re-cat-list">
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
        {catScrollState.right && (
          <button className="re-cat-arrow" onClick={() => scrollCatList("right")}>
            <ChevronRight size={14} />
          </button>
        )}
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
          initialPath={addProjectInitialPath}
          onConfirm={(project) => {
            setProjects([...projects, project]);
            setShowAddProjectDialog(false);
            setAddProjectInitialPath(null);
            markProjectDirty(project.path); // Mark for stats refresh
          }}
          onCancel={() => {
            setShowAddProjectDialog(false);
            setAddProjectInitialPath(null);
          }}
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

      {/* Resume Generator —— 与 re-main-wrap 同框,留出侧边栏 + 6px 间距 + 圆角白底 */}
      {showResumeGenerator && (
        <div
          className="fixed z-50 bg-white overflow-hidden flex flex-col"
          style={{
            top: 6,
            right: 6,
            bottom: 6,
            left: sidebarCollapsed ? 6 : 206,
            borderRadius: 12,
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            transition: '0.25s ease',
          }}
        >
          <ResumeGenerator onBack={() => setShowResumeGenerator(false)} />
        </div>
      )}
    </div>
  );
}
