import { useState, useEffect } from "react";
import { ProjectCard, ScanResultDialog, ProjectDetailDialog } from "@/components/project";
import { Minus, X, MoreVertical, Plus } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import type { Project, GitRepo } from "@/types";
import { getProjects, addProject } from "@/services/db";
import { scanDirectory } from "@/services/git";
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
  } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [scanResults, setScanResults] = useState<GitRepo[] | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [onlyModified, setOnlyModified] = useState(false);
  const { sidebarCollapsed, setSidebarCollapsed } = useAppStore();

  useEffect(() => {
    loadProjects();
  }, []);

  // Extract unique categories (tags) from projects
  const categories = Array.from(new Set(projects.flatMap(p => p.tags)));
  const activeCat = selectedTags.length === 0 ? "全部" : selectedTags[0];

  async function loadProjects() {
    try {
      setLoading(true);
      const data = await getProjects();
      setProjects(data);
    } catch (error) {
      console.error("Failed to load projects:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddProject() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择项目文件夹",
      });

      if (selected) {
        const path = selected as string;
        const name = path.split(/[\\/]/).pop() || "Unknown";

        const project = await addProject({
          name,
          path,
          tags: [],
        });

        setProjects([...projects, project]);
      }
    } catch (error) {
      console.error("Failed to add project:", error);
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


  async function handleConfirmScan(selectedPaths: string[]) {
    try {
      setLoading(true);
      const newProjects: Project[] = [];

      for (const path of selectedPaths) {
        const repo = scanResults?.find(r => r.path === path);
        if (repo) {
          try {
            const project = await addProject({
              name: repo.name,
              path: repo.path,
              tags: [],
            });
            newProjects.push(project);
          } catch (error) {
            console.error(`Failed to add project ${repo.name}:`, error);
          }
        }
      }

      if (newProjects.length > 0) {
        setProjects([...projects, ...newProjects]);
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

  function handleProjectDelete(projectId: string) {
    setProjects(projects.filter((p) => p.id !== projectId));
  }

  // Filter projects
  const filteredProjects = projects.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.path.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (activeCat !== "全部" && !p.tags.includes(activeCat)) return false;
    if (onlyStarred && !p.isFavorite) return false;

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
          />

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
                onClick: () => {
                  // TODO: 实现添加分类功能
                  alert("添加分类功能待实现");
                },
              },
            ]}
          />

          {/* Primary Action */}
          <button className="re-btn re-btn-primary flex items-center gap-2" onClick={handleAddProject}>
            <Plus size={16} />
            <span>项目</span>
          </button>

          {/* Integrated Window Controls */}
          <div className="flex items-center ml-2 border-l border-[var(--border)] pl-3 gap-1 h-6">
            <button
              onClick={() => getCurrentWindow()?.minimize()}
              className="w-7 h-7 flex items-center justify-center hover:bg-[rgba(0,0,0,0.05)] rounded-md transition-colors text-[var(--text-light)] hover:text-[var(--text)]"
              title="最小化"
            >
              <Minus size={14} />
            </button>
            <button
              onClick={() => getCurrentWindow()?.close()}
              className="w-7 h-7 flex items-center justify-center hover:bg-red-500 hover:text-white rounded-md transition-colors text-[var(--text-light)]"
              title="关闭"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* Category Bar */}
      <div className="re-cat-bar">
        <span style={{ fontSize: "14px", color: "var(--text-light)" }}>分类：</span>
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

      {/* Content */}
      <div className="flex-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-[var(--text-light)]">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--primary)] border-t-transparent mb-4" />
            <p>加载中...</p>
          </div>
        ) : sortedProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[var(--text-light)]">
            <span className="text-6xl mb-4 opacity-50">📂</span>
            <p className="text-lg font-medium mb-2 text-[var(--text)]">还没有项目</p>
            <p className="text-sm">点击"+ 项目"开始使用</p>
          </div>
        ) : (
          <div className="re-shelf">
            {sortedProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onUpdate={handleProjectUpdate}
                onShowDetail={setSelectedProject}
                onDelete={handleProjectDelete}
              />
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

      {/* Project Detail Dialog */}
      {selectedProject && (
        <ProjectDetailDialog
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
        />
      )}
    </div>
  );
}
