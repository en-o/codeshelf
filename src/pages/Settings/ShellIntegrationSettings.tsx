import { useEffect, useState } from "react";
import { Info, MousePointerClick } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "@/components/ui";

interface ShellContextMenuState {
  supported: boolean;
  registered: boolean;
  note: string;
}

interface ShellIntegrationSettingsProps {
  onClose?: () => void;
}

export function ShellIntegrationSettings({ onClose }: ShellIntegrationSettingsProps) {
  const [state, setState] = useState<ShellContextMenuState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    invoke<ShellContextMenuState>("get_shell_context_menu_state")
      .then(setState)
      .catch(() => setState(null));
  }, []);

  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      await invoke("set_shell_context_menu", { enabled });
      setState((s) => (s ? { ...s, registered: enabled } : s));
      showToast("success", enabled ? "已添加右键菜单" : "已移除右键菜单");
    } catch (e) {
      // Tauri 抛回来的是纯字符串，不是 Error 实例
      showToast("error", typeof e === "string" && e ? e : e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-gray-200">
        <h4 className="text-sm font-semibold text-gray-900">文件管理器右键菜单</h4>
        {onClose && (
          <button
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-blue-500 transition-colors"
          >
            收起
          </button>
        )}
      </div>

      {state?.supported ? (
        <div className="flex items-center justify-between p-3 bg-gray-100 rounded-lg">
          <div className="flex items-center gap-2">
            <MousePointerClick className="w-4 h-4 text-gray-500" />
            <div>
              <div className="text-sm text-gray-900">在资源管理器中显示「添加到 CodeShelf」</div>
              <div className="text-xs text-gray-500 mt-0.5">
                右键文件夹、或在文件夹空白处右键即可添加
              </div>
            </div>
          </div>
          <button
            disabled={busy}
            onClick={() => toggle(!state.registered)}
            className={`py-1.5 px-3 rounded-lg text-sm font-medium transition-all disabled:opacity-50 ${
              state.registered
                ? "bg-gray-200 text-gray-900 hover:bg-gray-300"
                : "bg-blue-500 text-white hover:bg-blue-600"
            }`}
          >
            {state.registered ? "移除" : "添加"}
          </button>
        </div>
      ) : (
        <div className="flex items-start gap-2 p-3 bg-gray-100 rounded-lg">
          <Info className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-gray-500">{state?.note || "正在读取…"}</div>
        </div>
      )}

      <div className="flex items-start gap-2 p-3 bg-gray-100 rounded-lg">
        <Info className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-gray-500 space-y-1">
          <p>Windows 11 的右键菜单需要先点「显示更多选项」才能看到该项。</p>
          <p>菜单项写在当前用户的注册表下，不需要管理员权限。</p>
        </div>
      </div>
    </div>
  );
}
