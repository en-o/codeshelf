import { useState } from "react";
import { X } from "lucide-react";

// 预设的技术栈标签 - 与HTML版本完全一致
const DEFAULT_LABELS = [
  {
    value: "Java",
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M12 3L1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3z" stroke="#e97f15" />
      </svg>
    ),
  },
  {
    value: "Vue",
    icon: (
      <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
        <span className="text-white text-xs font-bold">V</span>
      </div>
    ),
  },
  {
    value: "React",
    icon: (
      <div className="w-6 h-6 rounded-full bg-blue-400 flex items-center justify-center">
        <span className="text-white text-xs font-bold">⚛</span>
      </div>
    ),
  },
  {
    value: "Angular",
    icon: (
      <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center">
        <span className="text-white text-xs font-bold">A</span>
      </div>
    ),
  },
  {
    value: "小程序",
    icon: (
      <div className="w-6 h-6 rounded bg-green-600 flex items-center justify-center">
        <span className="text-white text-[10px]">微</span>
      </div>
    ),
  },
  {
    value: "Node.js",
    icon: (
      <div className="w-6 h-6 rounded bg-green-500 flex items-center justify-center">
        <span className="text-white text-xs">N</span>
      </div>
    ),
  },
  {
    value: "Python",
    icon: (
      <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
        <span className="text-white text-xs">P</span>
      </div>
    ),
  },
  {
    value: "Go",
    icon: (
      <div className="w-6 h-6 rounded-full bg-cyan-500 flex items-center justify-center">
        <span className="text-white text-xs font-bold">G</span>
      </div>
    ),
  },
  {
    value: "Rust",
    icon: (
      <div className="w-6 h-6 rounded-full bg-orange-700 flex items-center justify-center">
        <span className="text-white text-xs">R</span>
      </div>
    ),
  },
  {
    value: "TypeScript",
    icon: (
      <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center">
        <span className="text-white text-xs font-bold">TS</span>
      </div>
    ),
  },
  {
    value: "JavaScript",
    icon: (
      <div className="w-6 h-6 rounded bg-yellow-400 flex items-center justify-center">
        <span className="text-white text-xs font-bold">JS</span>
      </div>
    ),
  },
  {
    value: "PHP",
    icon: (
      <div className="w-6 h-6 rounded bg-indigo-500 flex items-center justify-center">
        <span className="text-white text-xs">P</span>
      </div>
    ),
  },
];

interface LabelSelectorProps {
  selectedLabels: string[];
  onChange: (labels: string[]) => void;
  multiple?: boolean;
}

export function LabelSelector({
  selectedLabels,
  onChange,
  multiple = true,
}: LabelSelectorProps) {
  const [customLabel, setCustomLabel] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);

  const allLabels = [
    ...DEFAULT_LABELS,
    ...selectedLabels
      .filter((label) => !DEFAULT_LABELS.some((d) => d.value === label))
      .map((label) => ({
        value: label,
        icon: (
          <div className="w-6 h-6 rounded bg-gray-600 flex items-center justify-center">
            <span className="text-white text-xs">{label.slice(0, 2)}</span>
          </div>
        ),
      })),
  ];

  function toggleLabel(label: string) {
    if (multiple) {
      if (selectedLabels.includes(label)) {
        onChange(selectedLabels.filter((l) => l !== label));
      } else {
        onChange([...selectedLabels, label]);
      }
    } else {
      onChange([label]);
    }
  }

  function handleAddCustomLabel() {
    const trimmed = customLabel.trim();
    if (trimmed && !selectedLabels.includes(trimmed)) {
      onChange([...selectedLabels, trimmed]);
    }
    setCustomLabel("");
    setShowCustomInput(false);
  }

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
          技术栈标签（可多选）
          <span className="text-xs text-gray-400 font-normal">帮助快速识别项目类型</span>
        </label>
        {!showCustomInput && (
          <button
            onClick={() => setShowCustomInput(true)}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 hover:gap-1.5 transition-all"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            自定义
          </button>
        )}
      </div>

      {/* Custom Label Input */}
      {showCustomInput && (
        <div className="flex gap-2 animate-in slide-in-from-top-1">
          <input
            type="text"
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddCustomLabel()}
            placeholder="输入自定义标签..."
            autoFocus
            className="flex-1 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-700 placeholder-gray-400 input-focus"
          />
          <button
            onClick={handleAddCustomLabel}
            className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
          >
            添加
          </button>
          <button
            onClick={() => {
              setShowCustomInput(false);
              setCustomLabel("");
            }}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Label Grid - 使用与HTML完全一致的类名 */}
      <div className="grid grid-cols-3 gap-2" id="techContainer">
        {allLabels.map((label) => {
          const isSelected = selectedLabels.includes(label.value);
          return (
            <label key={label.value} className="cursor-pointer tech-tag">
              <input
                type="checkbox"
                className="tag-checkbox hidden"
                checked={isSelected}
                onChange={() => toggleLabel(label.value)}
                value={label.value}
              />
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg hover:border-gray-300 transition-all">
                <div className="w-6 h-6 flex items-center justify-center">
                  {label.icon}
                </div>
                <span className="text-sm font-medium text-gray-700">{label.value}</span>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
