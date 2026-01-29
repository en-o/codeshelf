import { useState, useRef, useEffect } from "react";
import { Filter, Star, GitCommit, X, Check, Tag } from "lucide-react";

interface FilterPopoverProps {
  onlyStarred: boolean;
  onlyModified: boolean;
  onStarredChange: (value: boolean) => void;
  onModifiedChange: (value: boolean) => void;
  availableLabels: string[];
  selectedLabels: string[];
  onLabelsChange: (labels: string[]) => void;
}

export function FilterPopover({
  onlyStarred,
  onlyModified,
  onStarredChange,
  onModifiedChange,
  availableLabels,
  selectedLabels,
  onLabelsChange,
}: FilterPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const activeFiltersCount = [onlyStarred, onlyModified].filter(Boolean).length + selectedLabels.length;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen]);

  const filterOptions = [
    {
      id: "starred" as const,
      icon: Star,
      label: "只看收藏",
      description: "显示已收藏的项目",
      checked: onlyStarred,
      onChange: onStarredChange,
      activeColor: "text-yellow-500",
      activeBg: "bg-yellow-50",
    },
    {
      id: "modified" as const,
      icon: GitCommit,
      label: "只看待提交",
      description: "显示有未提交修改的项目",
      checked: onlyModified,
      onChange: onModifiedChange,
      activeColor: "text-emerald-500",
      activeBg: "bg-emerald-50",
    },
  ];

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`re-btn flex items-center gap-2 relative transition-all duration-200 ${
          isOpen ? "ring-2 ring-blue-500/30" : ""
        } ${activeFiltersCount > 0 ? "re-btn-active" : ""}`}
        title="过滤器"
      >
        <Filter size={16} />
        <span>过滤</span>
        {activeFiltersCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-blue-500 text-white text-xs rounded-full flex items-center justify-center font-semibold shadow-sm">
            {activeFiltersCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40 md:hidden"
            onClick={() => setIsOpen(false)}
          />

          <div
            className="absolute top-full right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-200 z-50 overflow-hidden animate-slide-down"
            style={{
              boxShadow: "0 20px 50px -12px rgba(0, 0, 0, 0.15), 0 8px 20px -8px rgba(0, 0, 0, 0.1)",
            }}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-transparent">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                    <Filter className="w-4 h-4 text-blue-500" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-800">过滤选项</h3>
                </div>
                {activeFiltersCount > 0 && (
                  <button
                    onClick={() => {
                      onStarredChange(false);
                      onModifiedChange(false);
                      onLabelsChange([]);
                    }}
                    className="text-xs text-red-500 hover:text-red-600 font-medium flex items-center gap-1 px-2 py-1 rounded-md hover:bg-red-50 transition-colors"
                  >
                    <X size={12} />
                    清除全部
                  </button>
                )}
              </div>
            </div>

            {/* Filter Options */}
            <div className="p-3 space-y-2">
              {filterOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    onClick={() => option.onChange(!option.checked)}
                    className={`w-full text-left p-3.5 rounded-xl transition-all duration-200 group ${
                      option.checked
                        ? "bg-blue-50 border-2 border-blue-500/50"
                        : "bg-gray-50 border-2 border-transparent hover:border-gray-200 hover:bg-gray-100"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 ${
                          option.checked
                            ? `${option.activeBg} ${option.activeColor}`
                            : "bg-white text-gray-400 group-hover:text-gray-600"
                        }`}
                      >
                        <Icon
                          className={`w-5 h-5 ${option.id === "starred" && option.checked ? "fill-current" : ""}`}
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-gray-800 text-sm">
                          {option.label}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {option.description}
                        </div>
                      </div>

                      <div
                        className={`flex-shrink-0 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all duration-200 ${
                          option.checked
                            ? "border-blue-500 bg-blue-500"
                            : "border-gray-300 group-hover:border-blue-300"
                        }`}
                      >
                        {option.checked && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Label Filter Section */}
            {availableLabels.length > 0 && (
              <div className="px-3 pb-3">
                <div className="p-3.5 rounded-xl bg-gray-50 border-2 border-transparent">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
                      <Tag className="w-4 h-4 text-purple-500" />
                    </div>
                    <div>
                      <div className="font-semibold text-gray-800 text-sm">按标签筛选</div>
                      <div className="text-xs text-gray-500">选择技术栈标签</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                    {availableLabels.map((label) => {
                      const isSelected = selectedLabels.includes(label);
                      return (
                        <button
                          key={label}
                          onClick={() => {
                            if (isSelected) {
                              onLabelsChange(selectedLabels.filter(l => l !== label));
                            } else {
                              onLabelsChange([...selectedLabels, label]);
                            }
                          }}
                          className={`px-2.5 py-1 text-xs rounded-lg transition-all duration-200 flex items-center gap-1 ${
                            isSelected
                              ? "bg-purple-500 text-white"
                              : "bg-white text-gray-600 hover:bg-purple-50 hover:text-purple-600 border border-gray-200"
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3" strokeWidth={3} />}
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
              {activeFiltersCount > 0 ? (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">
                    已启用 {activeFiltersCount} 个过滤条件
                  </span>
                  <span className="text-xs font-medium text-blue-500">
                    点击选项可切换
                  </span>
                </div>
              ) : (
                <p className="text-xs text-gray-500 text-center">
                  选择过滤条件以筛选项目列表
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
