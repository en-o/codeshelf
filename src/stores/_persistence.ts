// 几个 store 共用的后端持久化函数（debounced）。
// 抽出到独立模块，避免每个 store 重复定义 debounce 包装。

import { invoke } from "@tauri-apps/api/core";

/**
 * 合并式 debounce：窗口内的多次调用**累积**成一个 patch，而不是后一次覆盖前一次。
 *
 * 原来用的是普通 debounce（只保留最后一次的 args）。但每个 setter 只传自己那一个字段，
 * 于是 300ms 内先改主题、再折叠侧栏，发出去的只有 `{ sidebar_collapsed }` ——
 * 主题那次被整个丢掉。界面当次是对的（内存已更新），重启后才发现设置回退了。
 *
 * 合并后，上面的例子会发出 `{ theme, sidebar_collapsed }`。
 */
function debounceMerge<T extends object>(
  fn: (merged: T) => void | Promise<void>,
  delay: number,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Partial<T> = {};
  return (patch: T) => {
    // 后写的同名字段覆盖先写的（同一字段连续修改时取最新值），不同字段并存
    pending = { ...pending, ...patch };
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const merged = pending as T;
      pending = {};
      timer = null;
      void fn(merged);
    }, delay);
  };
}

export interface AppSettingsPatch {
  theme?: string;
  view_mode?: string;
  sidebar_collapsed?: boolean;
  scan_depth?: number;
  auto_update?: boolean;
  chat_history_dir?: string;
  chat_bridge_enabled?: boolean;
  openclaw_relay_endpoint?: string;
  bridge_provider_id?: string;
  bridge_model_id?: string;
  bridge_client_id?: string;
  show_dock_icon?: boolean;
}

export const saveAppSettings = debounceMerge<AppSettingsPatch>(async (settings) => {
  try {
    await invoke("save_app_settings", { input: settings });
  } catch (err) {
    console.error("保存应用设置失败:", err);
  }
}, 300);

export const saveUiState = debounceMerge<{ recent_detail_project_ids?: string[] }>(
  async (state) => {
    try {
      await invoke("save_ui_state", { input: state });
    } catch (err) {
      console.error("保存UI状态失败:", err);
    }
  },
  300,
);

/** 仅供单测：暴露合并逻辑本身，不碰 Tauri invoke。 */
export const __debounceMergeForTest = debounceMerge;
