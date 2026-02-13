// 快捷配置管理组件

import { useState } from "react";
import {
  X,
  Save,
  Plus,
  Edit3,
  Trash2,
  Sliders,
} from "lucide-react";
import { Button } from "@/components/ui";
import {
  type QuickConfigOption,
  DEFAULT_QUICK_CONFIGS,
  getCategoryIcon,
  saveQuickConfigs,
} from "./constants";

interface QuickConfigManagerProps {
  quickConfigs: QuickConfigOption[];
  onConfigsChange: (configs: QuickConfigOption[]) => void;
  onClose: () => void;
}

export function QuickConfigManager({
  quickConfigs,
  onConfigsChange,
  onClose,
}: QuickConfigManagerProps) {
  const [editingConfig, setEditingConfig] = useState<QuickConfigOption | null>(null);

  // 按分类分组
  const groupedOptions = quickConfigs.reduce((acc, opt) => {
    if (!acc[opt.category]) {
      acc[opt.category] = [];
    }
    acc[opt.category].push(opt);
    return acc;
  }, {} as Record<string, QuickConfigOption[]>);

  function handleSaveConfig(config: QuickConfigOption) {
    const isNew = !quickConfigs.find(c => c.id === config.id);
    const newConfigs = isNew
      ? [...quickConfigs, { ...config, id: `custom_${Date.now()}` }]
      : quickConfigs.map(c => c.id === config.id ? config : c);
    onConfigsChange(newConfigs);
    // 异步保存到后端
    saveQuickConfigs(newConfigs).catch(console.error);
    setEditingConfig(null);
  }

  function handleDeleteConfig(id: string) {
    const newConfigs = quickConfigs.filter(c => c.id !== id);
    onConfigsChange(newConfigs);
    // 异步保存到后端
    saveQuickConfigs(newConfigs).catch(console.error);
  }

  function handleReset() {
    onConfigsChange(DEFAULT_QUICK_CONFIGS);
    // 异步保存到后端
    saveQuickConfigs(DEFAULT_QUICK_CONFIGS).catch(console.error);
  }

  return (
    <div className="fixed inset-0 top-8 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Sliders size={20} />
            快捷配置管理
          </h3>
          <div className="flex items-center gap-2">
            <Button onClick={handleReset} variant="secondary" className="text-xs">
              重置默认
            </Button>
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {editingConfig ? (
            <QuickConfigEditor
              config={editingConfig}
              onSave={handleSaveConfig}
              onCancel={() => setEditingConfig(null)}
              isNew={!quickConfigs.find(c => c.id === editingConfig.id)}
            />
          ) : (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button
                  onClick={() => setEditingConfig({
                    id: "",
                    name: "",
                    description: "",
                    category: "自定义",
                    configKey: "",
                    valueType: "string",
                    defaultValue: "",
                  })}
                  variant="primary"
                  className="text-sm"
                >
                  <Plus size={14} className="mr-1" />
                  新增配置项
                </Button>
              </div>

              <div className="space-y-2">
                {Object.entries(groupedOptions).map(([category, options]) => {
                  const CategoryIcon = getCategoryIcon(category);
                  return (
                    <div key={category} className="border border-gray-200 dark:border-gray-700 rounded-lg">
                      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 font-medium text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
                        <CategoryIcon size={14} />
                        {category}
                      </div>
                      <div className="divide-y divide-gray-100 dark:divide-gray-800">
                        {options.map((opt) => (
                          <div key={opt.id} className="flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-800">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm">{opt.name}</div>
                              <div className="text-xs text-gray-500 truncate">{opt.description}</div>
                              <div className="text-xs text-gray-400 mt-1">
                                <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{opt.configKey}</code>
                                <span className="mx-2">•</span>
                                <span>默认: {String(opt.defaultValue) || "(空)"}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setEditingConfig(opt)}
                                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500"
                                title="编辑"
                              >
                                <Edit3 size={14} />
                              </button>
                              {opt.id.startsWith("custom_") && (
                                <button
                                  onClick={() => handleDeleteConfig(opt.id)}
                                  className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-500"
                                  title="删除"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 快捷配置编辑器
function QuickConfigEditor({
  config,
  onSave,
  onCancel,
  isNew,
}: {
  config: QuickConfigOption;
  onSave: (config: QuickConfigOption) => void;
  onCancel: () => void;
  isNew: boolean;
}) {
  const [form, setForm] = useState<QuickConfigOption>(config);
  const [optionsText, setOptionsText] = useState(
    config.options?.map(o => `${o.label}:${o.value}`).join("\n") || ""
  );

  function handleSave() {
    const finalConfig = { ...form };
    if ((form.valueType === "select" || form.valueType === "model") && optionsText.trim()) {
      finalConfig.options = optionsText.split("\n").filter(Boolean).map(line => {
        const [label, value] = line.split(":");
        return { label: label?.trim() || "", value: value?.trim() || label?.trim() || "" };
      });
    }
    onSave(finalConfig);
  }

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-gray-900 dark:text-white">
        {isNew ? "新增配置项" : "编辑配置项"}
      </h4>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">名称 *</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">配置键 *</label>
          <input
            type="text"
            value={form.configKey}
            onChange={(e) => setForm(f => ({ ...f, configKey: e.target.value }))}
            placeholder="如: autoApproveAll"
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-500 mb-1">描述</label>
        <input
          type="text"
          value={form.description}
          onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">分类</label>
          <input
            type="text"
            value={form.category}
            onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">值类型</label>
          <select
            value={form.valueType}
            onChange={(e) => setForm(f => ({ ...f, valueType: e.target.value as QuickConfigOption["valueType"] }))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="string">字符串</option>
            <option value="boolean">布尔值</option>
            <option value="number">数字</option>
            <option value="select">选择</option>
            <option value="model">模型（可自定义）</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-500 mb-1">默认值</label>
        {form.valueType === "boolean" ? (
          <select
            value={form.defaultValue === "" ? "" : String(form.defaultValue)}
            onChange={(e) => setForm(f => ({ ...f, defaultValue: e.target.value === "" ? "" : e.target.value === "true" }))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">未设置</option>
            <option value="true">开启 (true)</option>
            <option value="false">关闭 (false)</option>
          </select>
        ) : (
          <input
            type={form.valueType === "number" ? "number" : "text"}
            value={String(form.defaultValue ?? "")}
            onChange={(e) => setForm(f => ({ ...f, defaultValue: form.valueType === "number" ? Number(e.target.value) : e.target.value }))}
            placeholder={form.valueType === "model" ? "如: claude-opus-4-5-20251101 或留空" : ""}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}
      </div>

      {(form.valueType === "select" || form.valueType === "model") && (
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">选项（每行一个，格式: 显示名:值）</label>
          <textarea
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            placeholder={"Claude Sonnet 4:claude-sonnet-4-20250514\nClaude Opus 4:claude-opus-4-20250514"}
            rows={4}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
          />
        </div>
      )}

      {form.valueType === "string" && (
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">占位符</label>
          <input
            type="text"
            value={form.placeholder || ""}
            onChange={(e) => setForm(f => ({ ...f, placeholder: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4">
        <Button onClick={onCancel} variant="secondary">取消</Button>
        <Button onClick={handleSave} variant="primary" disabled={!form.name || !form.configKey}>
          <Save size={14} className="mr-1" />
          保存
        </Button>
      </div>
    </div>
  );
}
