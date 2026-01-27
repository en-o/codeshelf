import { Input } from "@/components/ui";
import { useAppStore, Theme } from "@/stores/appStore";
import { Sun, Moon, Minus, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function SettingsPage() {
  const { theme, setTheme, sidebarCollapsed, setSidebarCollapsed, scanDepth, setScanDepth } = useAppStore();

  return (
    <div className="flex flex-col min-h-full">
      {/* Header with Title and Integrated Window Controls */}
      <header className="re-header sticky top-0 z-20" data-tauri-drag-region>
        <span
          className="toggle"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          ☰
        </span>

        <div className="flex-1 flex items-center gap-3" data-tauri-drag-region>
          <span className="text-lg font-semibold ml-2">⚙️ 设置</span>
        </div>

        <div className="re-actions flex items-center">
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

      <div className="p-5 mt-5 flex flex-col gap-6">
        {/* Theme Settings */}
        <section className="re-card">
          <h2 className="text-[17px] font-semibold mb-6">外观</h2>
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-[var(--text-light)] mb-4">
                主题模式
              </label>
              <div className="flex gap-4">
                <ThemeOption
                  icon={Sun}
                  label="浅色"
                  value="light"
                  currentValue={theme}
                  onChange={setTheme}
                />
                <ThemeOption
                  icon={Moon}
                  label="深色"
                  value="dark"
                  currentValue={theme}
                  onChange={setTheme}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Editor Settings */}
        <section className="re-card">
          <h2 className="text-[17px] font-semibold mb-6">编辑器设置</h2>
          <div className="space-y-5">
            <Input
              label="默认编辑器命令"
              placeholder="code"
              defaultValue="code"
            />
            <p className="text-sm text-[var(--text-light)] leading-relaxed">
              支持 VSCode (code)、IDEA (idea)、Sublime Text (subl) 等
            </p>
          </div>
        </section>

        {/* Scan Settings */}
        <section className="re-card">
          <h2 className="text-[17px] font-semibold mb-6">扫描设置</h2>
          <div className="space-y-5">
            <Input
              label="扫描深度"
              type="number"
              placeholder="3"
              value={scanDepth.toString()}
              onChange={(e) => {
                const value = parseInt(e.target.value);
                if (value >= 1 && value <= 10) {
                  setScanDepth(value);
                }
              }}
              min={1}
              max={10}
            />
            <p className="text-sm text-[var(--text-light)] leading-relaxed">
              扫描目录时的最大递归深度（1-10层）
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

interface ThemeOptionProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: Theme;
  currentValue: Theme;
  onChange: (value: Theme) => void;
}

function ThemeOption({ icon: Icon, label, value, currentValue, onChange }: ThemeOptionProps) {
  const isSelected = value === currentValue;

  return (
    <button
      onClick={() => onChange(value)}
      className={`flex items-center gap-3 px-6 py-3.5 rounded-lg border transition-all ${isSelected
        ? "border-[var(--primary)] bg-[var(--primary-light)] text-[var(--primary)]"
        : "border-[var(--border)] hover:border-[var(--primary)] text-[var(--text-light)] hover:bg-[var(--primary-light)] hover:text-[var(--primary)]"
        }`}
    >
      <Icon className="w-5 h-5" />
      <span className="font-medium">{label}</span>
    </button>
  );
}
