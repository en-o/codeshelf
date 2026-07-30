import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { AiProviderConfig } from "@/types";

interface AiProvidersState {
  aiProviders: AiProviderConfig[];
  setAiProviders: (providers: AiProviderConfig[]) => void;
  saveAiProviders: (providers: AiProviderConfig[]) => Promise<void>;
  ensureAiDefaultProvider: (
    providers: AiProviderConfig[]
  ) => AiProviderConfig[];
}

export const useAiProvidersStore = create<AiProvidersState>()((set, get) => ({
  aiProviders: [],
  setAiProviders: (aiProviders) => set({ aiProviders }),
  ensureAiDefaultProvider: (providers) => {
    const hasDefault = providers.some(
      (p) => p.isDefaultProvider && p.enabled
    );
    if (hasDefault || providers.length === 0) {
      return providers;
    }
    const firstEnabled = providers.find((p) => p.enabled);
    if (!firstEnabled) {
      return providers;
    }
    return providers.map((p) => ({
      ...p,
      isDefaultProvider: p.id === firstEnabled.id,
    }));
  },
  saveAiProviders: async (providers) => {
    const normalized = get().ensureAiDefaultProvider(providers);
    const prev = get().aiProviders;
    set({ aiProviders: normalized });
    try {
      await invoke("save_ai_providers", { providers: normalized });
    } catch (err) {
      // 不能吞掉：以前这里只 console.error，调用方拿不到失败，
      // 页面照样提示「保存成功」并关闭表单，重启后配置（含 API key）消失。
      // 回滚乐观更新，把错误抛给调用方决定怎么展示。
      console.error("保存 AI 供应商配置失败:", err);
      set({ aiProviders: prev });
      throw err;
    }
  },
}));
