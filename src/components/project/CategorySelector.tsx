import { useState } from "react";
import { X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";

interface CategorySelectorProps {
  selectedCategories: string[];
  onChange: (categories: string[]) => void;
  multiple?: boolean;
}

export function CategorySelector({
  selectedCategories,
  onChange,
  multiple = true,
}: CategorySelectorProps) {
  const { categories, addCategory } = useAppStore();
  const [showNewInput, setShowNewInput] = useState(false);
  const [newCategory, setNewCategory] = useState("");

  function toggleCategory(category: string) {
    if (multiple) {
      if (selectedCategories.includes(category)) {
        onChange(selectedCategories.filter((c) => c !== category));
      } else {
        onChange([...selectedCategories, category]);
      }
    } else {
      onChange([category]);
    }
  }

  function handleAddNewCategory() {
    const trimmed = newCategory.trim();
    if (trimmed && !categories.includes(trimmed)) {
      addCategory(trimmed);
      onChange([...selectedCategories, trimmed]);
    }
    setNewCategory("");
    setShowNewInput(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">
          选择分类（可多选）
        </label>
        {!showNewInput && (
          <button
            onClick={() => setShowNewInput(true)}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 hover:gap-1.5 transition-all"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新建分类
          </button>
        )}
      </div>

      {/* New Category Input */}
      {showNewInput && (
        <div className="flex gap-2 animate-in slide-in-from-top-1">
          <input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddNewCategory()}
            placeholder="输入新分类名称..."
            autoFocus
            className="flex-1 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-700 placeholder-gray-400 input-focus"
          />
          <button
            onClick={handleAddNewCategory}
            className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
          >
            添加
          </button>
          <button
            onClick={() => {
              setShowNewInput(false);
              setNewCategory("");
            }}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Category Pills - 使用与HTML完全一致的类名 */}
      <div className="flex flex-wrap gap-2" id="categoryContainer">
        {categories.map((category) => {
          const isSelected = selectedCategories.includes(category);
          return (
            <label key={category} className="cursor-pointer category-pill">
              <input
                type="checkbox"
                className="category-checkbox hidden"
                checked={isSelected}
                onChange={() => toggleCategory(category)}
                value={category}
              />
              <div className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-full text-sm font-medium text-gray-600 hover:border-gray-300 select-none pr-8">
                {category}
              </div>
            </label>
          );
        })}
        {categories.length === 0 && !showNewInput && (
          <div className="text-center py-4 text-gray-400 text-sm">
            还没有分类，点击"新建分类"开始
          </div>
        )}
      </div>
    </div>
  );
}
