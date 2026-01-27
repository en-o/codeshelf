import { useState, useRef, useEffect } from "react";
import { Filter } from "lucide-react";

interface FilterPopoverProps {
  onlyStarred: boolean;
  onlyModified: boolean;
  onStarredChange: (value: boolean) => void;
  onModifiedChange: (value: boolean) => void;
}

export function FilterPopover({
  onlyStarred,
  onlyModified,
  onStarredChange,
  onModifiedChange,
}: FilterPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const activeFiltersCount = [onlyStarred, onlyModified].filter(Boolean).length;

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

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`re-btn flex items-center gap-2 relative ${
          activeFiltersCount > 0 ? "re-btn-active" : ""
        }`}
        title="过滤器"
      >
        <Filter size={16} />
        <span>过滤</span>
        {activeFiltersCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-[var(--primary)] text-white text-xs rounded-full flex items-center justify-center">
            {activeFiltersCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-[var(--border)] py-2 z-50">
          <div className="px-3 py-2 text-xs font-semibold text-[var(--text-light)] uppercase tracking-wider">
            过滤选项
          </div>
          <div className="px-3 py-1 space-y-2">
            <label className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-[var(--bg-light)] px-2 rounded transition-colors">
              <input
                type="checkbox"
                checked={onlyStarred}
                onChange={(e) => onStarredChange(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm text-[var(--text)]">只看收藏</span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer py-2 hover:bg-[var(--bg-light)] px-2 rounded transition-colors">
              <input
                type="checkbox"
                checked={onlyModified}
                onChange={(e) => onModifiedChange(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm text-[var(--text)]">只看待提交</span>
            </label>
          </div>
          {activeFiltersCount > 0 && (
            <>
              <div className="h-px bg-[var(--border)] my-2" />
              <button
                onClick={() => {
                  onStarredChange(false);
                  onModifiedChange(false);
                }}
                className="w-full px-5 py-2 text-left text-sm text-[var(--primary)] hover:bg-[var(--bg-light)] transition-colors"
              >
                清除所有过滤
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
