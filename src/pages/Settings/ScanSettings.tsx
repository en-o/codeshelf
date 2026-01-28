
import { Info, Check } from "lucide-react";
import { useAppStore } from "@/stores/appStore";

interface ScanSettingsProps {
  onClose?: () => void;
}

export function ScanSettings({ onClose }: ScanSettingsProps) {
  const { scanDepth, setScanDepth } = useAppStore();
  const presets = [1, 3, 5, 10];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-gray-200">
        <h4 className="text-sm font-semibold text-gray-900">扫描深度设置</h4>
        {onClose && (
          <button
            onClick={onClose}
            className="text-xs text-gray-500 hover:text-blue-500 transition-colors"
          >
            收起
          </button>
        )}
      </div>

      <div className="space-y-4">
        {/* Current Value Display */}
        <div className="flex items-center justify-center py-4">
          <div className="text-center">
            <div className="text-4xl font-bold text-blue-500">{scanDepth}</div>
            <div className="text-sm text-gray-500 mt-1">当前扫描深度</div>
          </div>
        </div>

        {/* Slider */}
        <div className="px-2">
          <input
            type="range"
            min={1}
            max={10}
            value={scanDepth}
            onChange={(e) => {
              const value = parseInt(e.target.value);
              setScanDepth(value);

            }}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-2">
            <span>1层</span>
            <span>5层</span>
            <span>10层</span>
          </div>
        </div>

        {/* Preset Buttons */}
        <div className="flex gap-2">
          {presets.map((preset) => (
            <button
              key={preset}
              onClick={() => {
                setScanDepth(preset);
              }}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                scanDepth === preset
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-900 hover:bg-gray-200"
              }`}
            >
              {preset}层
              {scanDepth === preset && <Check className="w-3 h-3 inline ml-1" />}
            </button>
          ))}
        </div>

        {/* Info */}
        <div className="flex items-start gap-2 p-3 bg-gray-100 rounded-lg">
          <Info className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-gray-500 space-y-1">
            <p>扫描目录时的最大递归深度（1-10层）</p>
            <p>• 较小的值：扫描更快，但可能遗漏深层项目</p>
            <p>• 较大的值：扫描更彻底，但耗时更长</p>
          </div>
        </div>
      </div>
    </div>
  );
}
