import { Sun, Moon, Monitor } from "lucide-react";
import { useAppStore, Theme } from "@/stores/appStore";

interface AppearanceSettingsProps {
  onClose?: () => void;
}

export function AppearanceSettings({ onClose }: AppearanceSettingsProps) {
  const { theme, setTheme } = useAppStore();

  const themes = [
    { value: "light" as Theme, label: "浅色", icon: Sun, description: "明亮的界面主题" },
    { value: "dark" as Theme, label: "深色", icon: Moon, description: "暗色界面主题" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-gray-200">
        <h4 className="text-sm font-semibold text-gray-900">选择主题模式</h4>
        {onClose && (
          <button
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-blue-500 transition-colors"
          >
            收起
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {themes.map(({ value, label, icon: Icon, description }) => {
          const isSelected = value === theme;
          return (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={`flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all ${
                isSelected
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-blue-500/50 hover:bg-gray-50"
              }`}
            >
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                  isSelected ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-400"
                }`}
              >
                <Icon className="w-6 h-6" />
              </div>
              <div className="text-center">
                <div
                  className={`font-semibold ${
                    isSelected ? "text-blue-500" : "text-gray-900"
                  }`}
                >
                  {label}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{description}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-start gap-2 p-3 bg-gray-100 rounded-lg">
        <Monitor className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-gray-500">
          主题设置会自动保存并应用到整个应用程序。选择适合您工作环境的主题模式。
        </p>
      </div>
    </div>
  );
}
