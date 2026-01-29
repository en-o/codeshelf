import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Project, ViewMode } from "@/types";
import { markProjectDirty as markDirty } from "@/services/stats";

export type Theme = "light" | "dark";

export interface EditorConfig {
  id: string;
  name: string;
  path: string;
  icon?: string;
}

export interface TerminalConfig {
  type: "default" | "powershell" | "cmd" | "terminal" | "iterm" | "custom";
  customPath?: string;
  // 存储各终端类型的自定义路径（当自动检测失败时使用）
  paths?: {
    powershell?: string;
    cmd?: string;
    terminal?: string;
    iterm?: string;
    default?: string;
  };
}

export type PageType = "shelf" | "dashboard" | "settings";

interface AppState {
  // Projects
  projects: Project[];
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;

  // Stats - mark project as dirty for incremental refresh
  markProjectDirty: (projectPath: string) => void;

  // Navigation
  currentPage: PageType;
  setCurrentPage: (page: PageType) => void;
  navigateToProject: (projectPath: string) => void;

  // UI State
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedTags: string[];
  setSelectedTags: (tags: string[]) => void;

  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;

  // Sidebar
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Settings
  scanDepth: number;
  setScanDepth: (depth: number) => void;

  // Categories (项目分类)
  categories: string[];
  addCategory: (category: string) => void;
  removeCategory: (category: string) => void;

  // Labels (技术栈标签)
  labels: string[];
  addLabel: (label: string) => void;
  removeLabel: (label: string) => void;

  // Editor Settings
  editors: EditorConfig[];
  addEditor: (editor: EditorConfig) => void;
  removeEditor: (id: string) => void;
  updateEditor: (id: string, updates: Partial<EditorConfig>) => void;
  setDefaultEditor: (id: string) => void;

  // Terminal Settings
  terminalConfig: TerminalConfig;
  setTerminalConfig: (config: TerminalConfig) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Projects
      projects: [],
      setProjects: (projects) => set({ projects }),
      addProject: (project) =>
        set((state) => ({ projects: [...state.projects, project] })),
      removeProject: (id) =>
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
        })),
      updateProject: (id, updates) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        })),

      // Stats - mark project as dirty (calls Rust command)
      markProjectDirty: (projectPath) => {
        // Fire and forget - don't need to await
        markDirty(projectPath).catch(console.error);
      },

      // Navigation
      currentPage: "shelf",
      setCurrentPage: (currentPage) => set({ currentPage }),
      navigateToProject: (projectPath) => set((state) => {
        const project = state.projects.find((p) => p.path === projectPath);
        if (project) {
          return { currentPage: "shelf" as PageType, selectedProjectId: project.id };
        }
        return { currentPage: "shelf" as PageType };
      }),

      // UI State
      viewMode: "grid",
      setViewMode: (viewMode) => set({ viewMode }),
      selectedProjectId: null,
      setSelectedProjectId: (selectedProjectId) => set({ selectedProjectId }),
      searchQuery: "",
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      selectedTags: [],
      setSelectedTags: (selectedTags) => set({ selectedTags }),

      // Theme
      theme: "light",
      setTheme: (theme) => set({ theme }),

      // Sidebar
      sidebarCollapsed: false,
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

      // Settings
      scanDepth: 3,
      setScanDepth: (scanDepth) => set({ scanDepth }),

      // Categories (项目分类)
      categories: [],
      addCategory: (category) =>
        set((state) => ({
          categories: state.categories.includes(category)
            ? state.categories
            : [...state.categories, category],
        })),
      removeCategory: (category) =>
        set((state) => ({
          categories: state.categories.filter((c) => c !== category),
          // Also remove from projects
          projects: state.projects.map((p) => ({
            ...p,
            tags: p.tags.filter((t) => t !== category),
          })),
        })),

      // Labels (技术栈标签)
      labels: ["Java", "Python", "JavaScript", "TypeScript", "React", "Vue", "Node.js", "Go", "Rust", "Spring Boot"],
      addLabel: (label) =>
        set((state) => ({
          labels: state.labels.includes(label)
            ? state.labels
            : [...state.labels, label],
        })),
      removeLabel: (label) =>
        set((state) => ({
          labels: state.labels.filter((l) => l !== label),
          // Also remove from projects
          projects: state.projects.map((p) => ({
            ...p,
            labels: p.labels?.filter((l) => l !== label),
          })),
        })),

      // Editor Settings
      editors: [],
      addEditor: (editor) =>
        set((state) => ({ editors: [...state.editors, editor] })),
      removeEditor: (id) =>
        set((state) => ({
          editors: state.editors.filter((e) => e.id !== id),
        })),
      updateEditor: (id, updates) =>
        set((state) => ({
          editors: state.editors.map((e) =>
            e.id === id ? { ...e, ...updates } : e
          ),
        })),
      setDefaultEditor: (id) =>
        set((state) => {
          const editor = state.editors.find((e) => e.id === id);
          if (!editor) return state;
          const others = state.editors.filter((e) => e.id !== id);
          return { editors: [editor, ...others] };
        }),

      // Terminal Settings
      terminalConfig: { type: "default" },
      setTerminalConfig: (terminalConfig) => set({ terminalConfig }),
    }),
    {
      name: "codeshelf-storage",
      partialize: (state) => ({
        projects: state.projects,
        viewMode: state.viewMode,
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
        scanDepth: state.scanDepth,
        categories: state.categories,
        labels: state.labels,
        editors: state.editors,
        terminalConfig: state.terminalConfig,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AppState>;
        // 如果 localStorage 中没有 labels 或为空数组，使用默认值
        const defaultLabels = ["Java", "Python", "JavaScript", "TypeScript", "React", "Vue", "Node.js", "Go", "Rust", "Spring Boot"];
        return {
          ...currentState,
          ...persisted,
          projects: persisted.projects || [],
          labels: persisted.labels && persisted.labels.length > 0 ? persisted.labels : defaultLabels,
        };
      },
    }
  )
);
