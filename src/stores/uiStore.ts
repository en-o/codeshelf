import { create } from "zustand";
import type { ToolType } from "@/types/toolbox";

export type PageType =
  | "shelf"
  | "dashboard"
  | "settings"
  | "toolbox"
  | "aiProviders"
  | "chat"
  | "workflows"
  | "apiChat";

interface UiState {
  initialized: boolean;
  setInitialized: (initialized: boolean) => void;

  currentPage: PageType;
  setCurrentPage: (page: PageType) => void;

  searchQuery: string;
  setSearchQuery: (query: string) => void;

  selectedTags: string[];
  setSelectedTags: (tags: string[]) => void;

  showShortcutQuickLookup: boolean;
  toggleShortcutQuickLookup: () => void;

  showClipboardQuickAccess: boolean;
  toggleClipboardQuickAccess: () => void;

  popupAutoHideWindow: boolean;
  setPopupAutoHideWindow: (v: boolean) => void;

  popupCursorPosition: { x: number; y: number } | null;
  setPopupCursorPosition: (pos: { x: number; y: number } | null) => void;

  toolboxNavigateTarget: ToolType | null;
  toolboxDockerProjectPath: string | null;
  toolboxDockerProjectName: string | null;
  chatNavigateSessionId: string | null;
  externalAddProjectPaths: string[];

  navigateToTool: (tool: ToolType) => void;
  navigateToDockerTool: (
    projectPath?: string,
    projectName?: string
  ) => void;
  navigateToChatSession: (sessionId: string) => void;
  clearChatNavigateSession: () => void;
  clearToolboxNavigateTarget: () => void;
  clearToolboxDockerProject: () => void;
  enqueueExternalAddProjectPath: (path: string) => void;
  takeExternalAddProjectPath: () => string | null;
}

export const useUiStore = create<UiState>()((set) => ({
  initialized: false,
  setInitialized: (initialized) => set({ initialized }),

  currentPage: "shelf",
  setCurrentPage: (currentPage) => set({ currentPage }),

  searchQuery: "",
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  selectedTags: [],
  setSelectedTags: (selectedTags) => set({ selectedTags }),

  showShortcutQuickLookup: false,
  toggleShortcutQuickLookup: () =>
    set((state) => ({
      showShortcutQuickLookup: !state.showShortcutQuickLookup,
    })),

  showClipboardQuickAccess: false,
  toggleClipboardQuickAccess: () =>
    set((state) => ({
      showClipboardQuickAccess: !state.showClipboardQuickAccess,
    })),

  popupAutoHideWindow: false,
  setPopupAutoHideWindow: (v) => set({ popupAutoHideWindow: v }),

  popupCursorPosition: null,
  setPopupCursorPosition: (pos) => set({ popupCursorPosition: pos }),

  toolboxNavigateTarget: null,
  toolboxDockerProjectPath: null,
  toolboxDockerProjectName: null,
  chatNavigateSessionId: null,
  externalAddProjectPaths: [],

  navigateToTool: (tool) =>
    set({ currentPage: "toolbox", toolboxNavigateTarget: tool }),
  navigateToDockerTool: (projectPath, projectName) =>
    set({
      currentPage: "toolbox",
      toolboxNavigateTarget: "docker",
      toolboxDockerProjectPath: projectPath || null,
      toolboxDockerProjectName: projectName || null,
    }),
  navigateToChatSession: (sessionId) =>
    set({ currentPage: "chat", chatNavigateSessionId: sessionId }),
  clearChatNavigateSession: () => set({ chatNavigateSessionId: null }),
  clearToolboxNavigateTarget: () => set({ toolboxNavigateTarget: null }),
  clearToolboxDockerProject: () =>
    set({
      toolboxDockerProjectPath: null,
      toolboxDockerProjectName: null,
    }),
  enqueueExternalAddProjectPath: (path) =>
    set((state) => ({
      externalAddProjectPaths: state.externalAddProjectPaths.includes(path)
        ? state.externalAddProjectPaths
        : [...state.externalAddProjectPaths, path],
    })),
  takeExternalAddProjectPath: () => {
    let next: string | null = null;
    set((state) => {
      if (state.externalAddProjectPaths.length === 0) return state;
      next = state.externalAddProjectPaths[0];
      return { externalAddProjectPaths: state.externalAddProjectPaths.slice(1) };
    });
    return next;
  },
}));
