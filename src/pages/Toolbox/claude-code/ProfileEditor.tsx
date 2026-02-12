// 配置档案编辑器组件

import { useState, useMemo, useRef, useEffect } from "react";
import {
  X,
  Save,
  Sliders,
  Lock,
  ChevronDown,
  Search,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui";
import type { ConfigProfile } from "@/types/toolbox";
import {
  type QuickConfigOption,
  getCategoryIcon,
  getNestedValue,
  setNestedKey,
  deleteNestedKey,
} from "./constants";

interface ProfileEditorProps {
  profile: ConfigProfile;
  quickConfigs: QuickConfigOption[];
  isActive: boolean;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}

export function ProfileEditor({
  profile,
  quickConfigs,
  isActive,
  onSave,
  onClose,
}: ProfileEditorProps) {
  // 初始化配置内容
  const initialSettings = useMemo(() => {
    const settings = { ...(profile.settings as Record<string, unknown>) };
    delete settings.__active;
    return settings;
  }, [profile]);

  const [editingContent, setEditingContent] = useState(JSON.stringify(initialSettings, null, 2));
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 解析当前配置值
  const editingValues = useMemo(() => {
    try {
      const config = JSON.parse(editingContent);
      const values: Record<string, unknown> = {};
      quickConfigs.forEach(opt => {
        const keys = opt.configKey.split(".");
        const value = getNestedValue(config, keys);
        values[opt.id] = value !== undefined ? value : opt.defaultValue;
      });
      return values;
    } catch {
      return {};
    }
  }, [editingContent, quickConfigs]);

  // 按分类分组
  const groupedOptions = useMemo(() => {
    return quickConfigs.reduce((acc, opt) => {
      if (!acc[opt.category]) {
        acc[opt.category] = [];
      }
      acc[opt.category].push(opt);
      return acc;
    }, {} as Record<string, QuickConfigOption[]>);
  }, [quickConfigs]);

  function applyQuickConfig(optionId: string, value: unknown) {
    const opt = quickConfigs.find(o => o.id === optionId);
    if (!opt) return;

    try {
      let config: Record<string, unknown> = {};
      if (editingContent.trim()) {
        config = JSON.parse(editingContent);
      }

      const keys = opt.configKey.split(".");

      if (value === "" || value === undefined || value === null) {
        deleteNestedKey(config, keys);
      } else {
        setNestedKey(config, keys, value);
      }

      setEditingContent(JSON.stringify(config, null, 2));
    } catch {
      // JSON 解析失败
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(editingContent);
    } finally {
      setSaving(false);
    }
  }

  function renderConfigEditor(opt: QuickConfigOption) {
    const value = editingValues[opt.id];

    switch (opt.valueType) {
      case "boolean":
        return (
          <div className="flex items-center gap-1">
            <button
              onClick={() => applyQuickConfig(opt.id, "")}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                value === "" || value === undefined
                  ? "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                  : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500"
              }`}
            >
              未设置
            </button>
            <button
              onClick={() => applyQuickConfig(opt.id, true)}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                value === true
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500"
              }`}
            >
              开启
            </button>
            <button
              onClick={() => applyQuickConfig(opt.id, false)}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                value === false
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500"
              }`}
            >
              关闭
            </button>
          </div>
        );

      case "select":
        return (
          <select
            value={String(value ?? "")}
            onChange={(e) => applyQuickConfig(opt.id, e.target.value)}
            className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {opt.allowEmpty && <option value="">未设置</option>}
            {opt.options?.map(option => (
              <option key={String(option.value)} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
        );

      case "model":
        const isCustom = Boolean(value) && !opt.options?.some(o => o.value === value);
        return (
          <div className="flex flex-col gap-1 w-full">
            <select
              value={isCustom ? "__custom__" : String(value ?? "")}
              onChange={(e) => {
                if (e.target.value === "__custom__") {
                  if (!isCustom) applyQuickConfig(opt.id, "");
                } else {
                  applyQuickConfig(opt.id, e.target.value);
                }
              }}
              className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">未设置</option>
              {opt.options?.map(option => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
              <option value="__custom__">自定义...</option>
            </select>
            {isCustom && (
              <input
                type="text"
                value={String(value || "")}
                onChange={(e) => applyQuickConfig(opt.id, e.target.value)}
                placeholder="输入模型名称，如: claude-opus-4-5-20251101"
                className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            )}
          </div>
        );

      case "string":
      case "number":
        return (
          <input
            type={opt.valueType === "number" ? "number" : "text"}
            value={String(value || "")}
            onChange={(e) => applyQuickConfig(opt.id, opt.valueType === "number" ? Number(e.target.value) : e.target.value)}
            placeholder={opt.placeholder}
            className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        );

      default:
        return null;
    }
  }

  const selectedOpt = selectedConfigId ? quickConfigs.find(c => c.id === selectedConfigId) : null;
  const CategoryIcon = selectedOpt ? getCategoryIcon(selectedOpt.category) : null;

  // 统计已配置项数量
  const configuredCount = Object.entries(editingValues).filter(([, v]) => v !== "" && v !== undefined && v !== null).length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              编辑配置档案
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-gray-500">名称:</span>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                {profile.name}
              </span>
              <span title="编辑时不可修改名称">
                <Lock size={12} className="text-gray-400" />
              </span>
              {isActive && (
                <span className="text-[10px] text-green-600 bg-green-100 dark:bg-green-900/40 px-1.5 py-0.5 rounded">
                  已启用
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          >
            <X size={20} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {/* 快捷配置 - 下拉选择方式 */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Sliders size={14} />
              快捷配置
            </h4>

            {/* 下拉选择器 - 固定高度防止溢出 */}
            <div className="flex items-center gap-2">
              <select
                value={selectedConfigId || ""}
                onChange={(e) => setSelectedConfigId(e.target.value || null)}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">选择要配置的项...</option>
                {Object.entries(groupedOptions).map(([category, options]) => (
                  <optgroup key={category} label={category}>
                    {options.map((opt) => {
                      const val = editingValues[opt.id];
                      const hasValue = val !== "" && val !== undefined && val !== null;
                      return (
                        <option key={opt.id} value={opt.id}>
                          {opt.name} {hasValue ? "✓" : ""}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* 选中的配置项编辑 */}
            {selectedOpt && CategoryIcon && (
              <div className="p-4 border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <div className="flex items-start gap-3 mb-3">
                  <div className="p-2 bg-blue-100 dark:bg-blue-800 rounded-lg">
                    <CategoryIcon size={16} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-gray-900 dark:text-white">{selectedOpt.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{selectedOpt.description}</div>
                    <code className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-1 rounded mt-1 inline-block">
                      {selectedOpt.configKey}
                    </code>
                  </div>
                </div>
                <div>{renderConfigEditor(selectedOpt)}</div>
              </div>
            )}

            {/* 已配置项快速预览 */}
            <div className="text-xs text-gray-500">
              已配置: {configuredCount} 项
              {configuredCount > 0 && (
                <span className="ml-2">
                  ({Object.entries(editingValues)
                    .filter(([, v]) => v !== "" && v !== undefined && v !== null)
                    .map(([id]) => quickConfigs.find(c => c.id === id)?.name)
                    .filter(Boolean)
                    .slice(0, 3)
                    .join(", ") as string}
                  {configuredCount > 3 ? "..." : ""})
                </span>
              )}
            </div>
          </div>

          {/* JSON 编辑 */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">JSON 配置</h4>
            <textarea
              value={editingContent}
              onChange={(e) => setEditingContent(e.target.value)}
              className="w-full h-[200px] p-3 font-mono text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>

        {/* 底部 */}
        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
          <Button onClick={onClose} variant="secondary">
            取消
          </Button>
          <Button onClick={handleSave} variant="primary" disabled={saving}>
            <Save size={14} className="mr-1" />
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
