import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Project } from "@/types";
import { markProjectDirty as markDirty } from "@/services/stats";
import {
  setProjectEditor as setProjectEditorApi,
  setProjectClaudeEnv as setProjectClaudeEnvApi,
} from "@/services/db";
import { saveUiState } from "./_persistence";

interface ProjectsState {
  projects: Project[];
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  setProjectEditor: (projectId: string, editorId: string | null) => void;
  setProjectClaudeEnv: (projectId: string, claudeEnvName: string | null) => void;

  recentDetailProjectIds: string[];
  addRecentDetailProject: (projectId: string) => void;

  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;

  categories: string[];
  setCategories: (categories: string[]) => void;
  addCategory: (category: string) => void;
  removeCategory: (category: string) => Promise<void>;

  labels: string[];
  setLabels: (labels: string[]) => void;
  addLabel: (label: string) => void;
  removeLabel: (label: string) => Promise<void>;

  markProjectDirty: (projectPath: string) => void;
}

const DEFAULT_LABELS = [
  "Java",
  "Python",
  "JavaScript",
  "TypeScript",
  "React",
  "Vue",
  "Node.js",
  "Go",
  "Rust",
  "Spring Boot",
];

export const useProjectsStore = create<ProjectsState>()((set, get) => ({
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
  setProjectEditor: (projectId, editorId) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, editorId: editorId ?? undefined } : p
      ),
    }));
    setProjectEditorApi(projectId, editorId).catch(console.error);
  },
  setProjectClaudeEnv: (projectId, claudeEnvName) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, claudeEnvName: claudeEnvName ?? undefined }
          : p
      ),
    }));
    setProjectClaudeEnvApi(projectId, claudeEnvName).catch(console.error);
  },

  recentDetailProjectIds: [],
  addRecentDetailProject: (projectId) => {
    set((state) => {
      const filtered = state.recentDetailProjectIds.filter(
        (id) => id !== projectId
      );
      const updated = [projectId, ...filtered].slice(0, 9);
      saveUiState({ recent_detail_project_ids: updated });
      return { recentDetailProjectIds: updated };
    });
  },

  selectedProjectId: null,
  setSelectedProjectId: (selectedProjectId) => set({ selectedProjectId }),

  categories: [],
  setCategories: (categories) => {
    set({ categories });
    invoke("save_categories", { categories }).catch(console.error);
  },
  addCategory: (category) => {
    const state = get();
    if (!state.categories.includes(category)) {
      const updated = [...state.categories, category];
      set({ categories: updated });
      invoke("save_categories", { categories: updated }).catch(console.error);
    }
  },
  removeCategory: async (category) => {
    const state = get();
    // 走后端 remove_category：它会先清掉**所有项目的引用**再更新词表。
    // 以前这里只 save_categories，项目引用留在库里，重启后词表又从项目聚合出来，
    // 被删的分类当场复活。
    const prev = { categories: state.categories, projects: state.projects };
    set({
      categories: state.categories.filter((c) => c !== category),
      projects: state.projects.map((p) => ({
        ...p,
        tags: p.tags.filter((t) => t !== category),
      })),
    });
    try {
      const updated = await invoke<string[]>("remove_category", { category });
      set({ categories: updated });
    } catch (err) {
      console.error("删除分类失败:", err);
      set(prev); // 落库失败就回滚，别让界面显示一个其实还在的删除
      throw err;
    }
  },

  labels: DEFAULT_LABELS,
  setLabels: (labels) => set({ labels }),
  addLabel: (label) => {
    const state = get();
    if (!state.labels.includes(label)) {
      const updated = [...state.labels, label];
      set({ labels: updated });
      invoke("save_labels", { labels: updated }).catch(console.error);
    }
  },
  removeLabel: async (label) => {
    const state = get();
    const prev = { labels: state.labels, projects: state.projects };
    set({
      labels: state.labels.filter((l) => l !== label),
      projects: state.projects.map((p) => ({
        ...p,
        labels: p.labels?.filter((l) => l !== label),
      })),
    });
    try {
      const updated = await invoke<string[]>("remove_label", { label });
      set({ labels: updated });
    } catch (err) {
      console.error("删除标签失败:", err);
      set(prev);
      throw err;
    }
  },

  markProjectDirty: (projectPath) => {
    markDirty(projectPath).catch(console.error);
  },
}));
