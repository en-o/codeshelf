import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "@/components/ui";
import { errMsg } from "@/utils/errMsg";

export interface EditorConfig {
  id: string;
  name: string;
  path: string;
  icon?: string;
  is_default?: boolean;
}

export interface TerminalConfig {
  type:
    | "default"
    | "powershell"
    | "cmd"
    | "terminal"
    | "iterm"
    | "custom";
  customPath?: string;
  paths?: {
    powershell?: string;
    cmd?: string;
    terminal?: string;
    iterm?: string;
    default?: string;
    custom?: string;
  };
}

interface EditorsState {
  editors: EditorConfig[];
  setEditors: (editors: EditorConfig[]) => void;
  addEditor: (editor: EditorConfig) => void;
  removeEditor: (id: string) => void;
  updateEditor: (id: string, updates: Partial<EditorConfig>) => void;
  setDefaultEditor: (id: string) => void;

  terminalConfig: TerminalConfig;
  setTerminalConfig: (config: TerminalConfig) => void;
}

export const useEditorsStore = create<EditorsState>()((set, get) => ({
  editors: [],
  setEditors: (editors) => set({ editors }),
  addEditor: (editor) => {
    set((state) => ({ editors: [...state.editors, editor] }));
    invoke("add_editor", {
      input: {
        name: editor.name,
        path: editor.path,
        icon: editor.icon,
        is_default: false,
      },
    })
      .then((editors: unknown) => {
        set({ editors: editors as EditorConfig[] });
      })
      .catch((e) => {
        set((state) => ({ editors: state.editors.filter((x) => x !== editor) }));
        showToast("error", "添加编辑器失败", errMsg(e, "配置未写入磁盘，请重试"));
      });
  },
  removeEditor: (id) => {
    const before = get().editors;
    set((state) => ({
      editors: state.editors.filter((e) => e.id !== id),
    }));
    invoke("remove_editor", { id })
      .then((editors: unknown) => {
        set({ editors: editors as EditorConfig[] });
      })
      .catch((e) => {
        set({ editors: before });
        showToast("error", "删除编辑器失败", errMsg(e, "配置未写入磁盘，请重试"));
      });
  },
  updateEditor: (id, updates) => {
    const before = get().editors;
    set((state) => ({
      editors: state.editors.map((e) =>
        e.id === id ? { ...e, ...updates } : e
      ),
    }));
    const editor = get().editors.find((e) => e.id === id);
    if (editor) {
      invoke("update_editor", {
        id,
        input: {
          name: editor.name,
          path: editor.path,
          icon: editor.icon,
          // 必须**保留**原有的默认标记。原来这里固定传 false，
          // 于是「改一下默认编辑器的名字或路径」会把默认关系一并清掉。
          is_default: editor.is_default ?? false,
        },
      })
        .then((editors: unknown) => {
          set({ editors: editors as EditorConfig[] });
        })
        .catch((e) => {
          // 写失败必须回滚，否则界面显示已保存、重启后却是旧值
          set({ editors: before });
          showToast("error", "保存编辑器失败", errMsg(e, "配置未写入磁盘，请重试"));
        });
    }
  },
  setDefaultEditor: (id) => {
    const before = get().editors;
    // 乐观更新只翻 flag，**不重排数组**。
    // 原来是把选中项挪到第一位，而后端不重排、返回的仍是原顺序 ——
    // 响应一到就把乐观结果覆盖掉，看起来像「设了但没生效」。
    set((state) => ({
      editors: state.editors.map((e) => ({ ...e, is_default: e.id === id })),
    }));
    invoke("set_default_editor", { id })
      .then((editors: unknown) => {
        set({ editors: editors as EditorConfig[] });
      })
      .catch((e) => {
        set({ editors: before });
        showToast("error", "设置默认编辑器失败", errMsg(e, "配置未写入磁盘，请重试"));
      });
  },

  terminalConfig: { type: "default" },
  setTerminalConfig: (terminalConfig) => {
    const before = get().terminalConfig;
    set({ terminalConfig });
    invoke("save_terminal_config", {
      input: {
        terminal_type: terminalConfig.type,
        custom_path: terminalConfig.customPath,
        terminal_path: terminalConfig.paths?.[terminalConfig.type],
        // 完整传 map：界面允许为每种终端分别配置路径，
        // 只传当前类型那一条的话，其它类型的设置重启即丢。
        terminal_paths: terminalConfig.paths ?? {},
      },
    }).catch((e) => {
      set({ terminalConfig: before });
      showToast("error", "保存终端配置失败", errMsg(e, "配置未写入磁盘，请重试"));
    });
  },
}));
