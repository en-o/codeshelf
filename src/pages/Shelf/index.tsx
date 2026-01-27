import { useState, useEffect } from "react";
import {
  Search,
  Grid3X3,
  List,
  FolderPlus,
  RefreshCw,
} from "lucide-react";
import { Button, Input } from "@/components/ui";
import { ProjectCard } from "@/components/project";
import { useAppStore } from "@/stores/appStore";
import type { Project } from "@/types";
import { getProjects, addProject } from "@/services/db";
import { scanDirectory } from "@/services/git";
import { open } from "@tauri-apps/plugin-dialog";

export function ShelfPage() {
  const {
    projects,
    setProjects,
    viewMode,
    setViewMode,
    searchQuery,
    setSearchQuery,
  } = useAppStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProjects();
  }, []);

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
        const repos = await scanDirectory(selected as string);
        const newProjects: Project[] = [];

        for (const repo of repos) {
          // Check if project already exists
          if (!projects.some((p) => p.path === repo.path)) {
            try {
              const project = await addProject({
                name: repo.name,
                path: repo.path,
                tags: [],
              });
              newProjects.push(project);
            } catch {
              // Project might already exist, skip
            }
          }
        }

        if (newProjects.length > 0) {
          setProjects([...projects, ...newProjects]);
        }
      }
    } catch (error) {
      console.error("Failed to scan directory:", error);
    } finally {
      setLoading(false);
    }
  }

  function handleProjectUpdate(updated: Project) {
    setProjects(projects.map((p) => (p.id === updated.id ? updated : p)));
  }

  // Filter projects based on search query
  const filteredProjects = projects.filter(
    (project) =>
      project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.path.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Sort: favorites first, then by name
  const sortedProjects = [...filteredProjects].sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 p-4 border-b border-gray-800">
        <h1 className="text-xl font-semibold text-white">项目书架</h1>

        <div className="flex items-center gap-3 flex-1 max-w-2xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <Input
              placeholder="搜索项目..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="flex items-center border border-gray-700 rounded-lg">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2 ${
                viewMode === "grid"
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-2 ${
                viewMode === "list"
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleScanDirectory}>
            <RefreshCw className="w-4 h-4 mr-2" />
            扫描目录
          </Button>
          <Button onClick={handleAddProject}>
            <FolderPlus className="w-4 h-4 mr-2" />
            添加项目
          </Button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : sortedProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500">
            <FolderPlus className="w-12 h-12 mb-4" />
            <p className="text-lg mb-2">还没有项目</p>
            <p className="text-sm">点击"添加项目"或"扫描目录"开始使用</p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sortedProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                viewMode="grid"
                onUpdate={handleProjectUpdate}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sortedProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                viewMode="list"
                onUpdate={handleProjectUpdate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
