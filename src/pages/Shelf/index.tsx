import { useState, useEffect } from "react";
import { ProjectCard, ScanResultDialog, ProjectDetailDialog } from "@/components/project";
import { Minus, X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import type { Project, GitRepo } from "@/types";
import { getProjects, addProject } from "@/services/db";
import { open } from "@tauri-apps/plugin-dialog";

import { getCurrentWindow } from "@tauri-apps/api/window";

export function ShelfPage() {
  const {
    projects,
    setProjects,
    searchQuery,
    setSearchQuery,
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

        <div className="re-search-center" data-tauri-drag-region>
          <div className="re-search-box">
            <input
              id="searchInput"
              placeholder="搜索项目…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button>🔍</button>
          </div>

          <div className="re-filter-chk">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyStarred}
                onChange={(e) => setOnlyStarred(e.target.checked)}
              />
              只看收藏
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyModified}
                onChange={(e) => setOnlyModified(e.target.checked)}
              />
              只看待提交
            </label>
          </div>
        </div>

        <div className="re-actions flex items-center">
          <button className="re-btn">+ 分类</button>
          <button className="re-btn re-btn-primary" onClick={handleAddProject}>
            + 项目
          </button>

          {/* Integrated Window Controls - Minimalist and high-end */}
          <div className="flex items-center ml-4 border-l border-[var(--border)] pl-3 gap-1 h-6">
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
