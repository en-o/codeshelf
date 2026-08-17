import { useMemo, useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { Plus, X, Pencil, FolderOpen, ChevronDown } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAiProvidersStore } from "@/stores/aiProvidersStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { showToast } from "@/components/ui";
import { migrateChatHistoryDir } from "@/services/chat";
import type { AiProviderConfig, AiModelConfig } from "@/types";

interface AiProviderSettingsProps {
  onClose?: () => void;
}

type ProviderForm = Omit<AiProviderConfig, "id" | "models"> & { models: AiModelConfig[]; id?: string };

type HistoryState = {
  value: string;
  saving: boolean;
  error: string | null;
};


const PRESET_LABELS: Record<NonNullable<AiProviderConfig["presetKey"]>, string> = {
  bailian: "百炼 / 通义千问",
  deepseek: "DeepSeek",
  openai: "OpenAI",
  ollama: "Ollama",
  moonshot: "Moonshot AI",
  anthropic: "Anthropic / Claude",
};

const PRESET_BASE_URL: Record<NonNullable<AiProviderConfig["presetKey"]>, string> = {
  bailian: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com/v1",
  ollama: "http://localhost:11434/v1",
  moonshot: "https://api.moonshot.cn/v1",
  // Claude 走自己的 /v1/messages 协议（后端 chat_anthropic.rs），不是 OpenAI 兼容
  anthropic: "https://api.anthropic.com",
};

// 内置模型列表，用于添加模型时的快速选择
const ALL_PRESET_MODELS: Record<NonNullable<AiProviderConfig["presetKey"]>, Array<Pick<AiModelConfig, "model" | "thinking">>> = {
  bailian: [
    { model: "qwen-plus", thinking: false },
    { model: "qwen-turbo", thinking: false },
    { model: "qwen-max", thinking: false },
    { model: "qwen-long", thinking: false },
    { model: "qwen3-235b-a22b", thinking: true },
    { model: "qwen3-32b", thinking: true },
    { model: "qwq-plus", thinking: true },
  ],
  deepseek: [
    { model: "deepseek-chat", thinking: false },
    { model: "deepseek-reasoner", thinking: true },
  ],
  openai: [
    { model: "gpt-4o", thinking: false },
    { model: "gpt-4o-mini", thinking: false },
    { model: "gpt-4.1", thinking: false },
    { model: "gpt-4.1-mini", thinking: false },
    { model: "gpt-4.1-nano", thinking: false },
    { model: "o3", thinking: true },
    { model: "o3-mini", thinking: true },
    { model: "o4-mini", thinking: true },
  ],
  ollama: [
    { model: "llama3.1", thinking: false },
    { model: "qwen2.5", thinking: false },
    { model: "deepseek-r1", thinking: true },
    { model: "mistral", thinking: false },
  ],
  moonshot: [
    { model: "moonshot-v1-8k", thinking: false },
    { model: "moonshot-v1-32k", thinking: false },
    { model: "moonshot-v1-128k", thinking: false },
  ],
  anthropic: [
    { model: "claude-sonnet-4-5", thinking: true },
    { model: "claude-opus-4-1", thinking: true },
    { model: "claude-haiku-4-5", thinking: false },
  ],
};

function normalizeDefaultModel(models: AiModelConfig[]): AiModelConfig[] {
  if (models.length === 0) return models;
  const enabledModels = models.filter((m) => m.enabled);
  const hasDefault = enabledModels.some((m) => m.isDefault);
  if (hasDefault) return models;
  const firstEnabled = enabledModels[0] ?? models[0];
  return models.map((m) => ({ ...m, isDefault: m.id === firstEnabled.id }));
}

function createModelTemplate(name: string, thinking = false): AiModelConfig {
  return {
    id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    model: name,
    enabled: true,
    isDefault: false,
    thinking,
    stream: true,
  };
}

function createProviderTemplate(form: ProviderForm): AiProviderConfig {
  return {
    id: form.id ?? (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    name: form.name,
    providerType: form.providerType,
    presetKey: form.presetKey,
    baseUrl: form.baseUrl,
    apiKey: form.apiKey || undefined,
    enabled: form.enabled,
    isDefaultProvider: form.isDefaultProvider,
    models: form.models,
  };
}

const initialForm = (): ProviderForm => ({
  name: "",
  providerType: "preset",
  presetKey: "openai",
  baseUrl: PRESET_BASE_URL.openai,
  apiKey: "",
  enabled: false,
  isDefaultProvider: false,
  models: [],
});

function getHistoryState(dir?: string): HistoryState {
  return {
    value: dir ?? "",
    saving: false,
    error: null,
  };
}

function ProviderFormDrawer({
  open,
  title,
  form,
  editingId,
  onClose,
  onSubmit,
  onProviderTypeChange,
  onPresetChange,
  onFormChange,
  onModelChange,
  onAddModel,
  onRemoveModel,
  onSetDefaultModel,
}: {
  open: boolean;
  title: string;
  form: ProviderForm;
  editingId: string | null;
  onClose: () => void;
  onSubmit: () => void;
  onProviderTypeChange: (type: "preset" | "custom") => void;
  onPresetChange: (key: NonNullable<AiProviderConfig["presetKey"]>) => void;
  onFormChange: (updates: Partial<ProviderForm>) => void;
  onModelChange: (id: string, updates: Partial<AiModelConfig>) => void;
  onAddModel: (template?: { model: string; thinking: boolean }) => void;
  onRemoveModel: (id: string) => void;
  onSetDefaultModel: (id: string) => void;
}) {
  const [showModelPicker, setShowModelPicker] = useState(false);

  // 获取当前供应商可用的内置模型（排除已添加的）
  const availablePresets = form.providerType === "preset" && form.presetKey
    ? (ALL_PRESET_MODELS[form.presetKey] ?? []).filter(
        (p) => !form.models.some((m) => m.model === p.model)
      )
    : [];

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 w-[520px] max-w-full bg-white shadow-2xl border-l border-gray-200 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <div className="text-sm font-semibold text-gray-900">{title}</div>
            <div className="text-xs text-gray-500 mt-0.5">填写供应商信息与模型列表</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-gray-500">供应商类型</label>
              <select
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                value={form.providerType}
                onChange={(e) => onProviderTypeChange(e.target.value as "preset" | "custom")}
              >
                <option value="preset">内置厂商</option>
                <option value="custom">自定义厂商</option>
              </select>
            </div>
            {form.providerType === "preset" && (
              <div className="space-y-1">
                <label className="text-xs text-gray-500">内置厂商</label>
                <select
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                  value={form.presetKey ?? "openai"}
                  onChange={(e) => onPresetChange(e.target.value as NonNullable<AiProviderConfig["presetKey"]>)}
                >
                  {Object.entries(PRESET_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs text-gray-500">供应商名称</label>
              <input
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                value={form.name}
                onChange={(e) => onFormChange({ name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Base URL</label>
              <input
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                value={form.baseUrl}
                onChange={(e) => onFormChange({ baseUrl: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500">API Key</label>
              <input
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                type="password"
                placeholder={editingId ? "留空表示不修改" : "请输入 API Key"}
                value={form.apiKey}
                onChange={(e) => onFormChange({ apiKey: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500">启用</label>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => onFormChange({ enabled: e.target.checked })}
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500">设为默认供应商</label>
              <input
                type="checkbox"
                checked={form.isDefaultProvider}
                onChange={(e) => onFormChange({ isDefaultProvider: e.target.checked })}
              />
            </div>
            <div className="text-[11px] text-gray-400 -mt-2">
              设为默认后，所有AI功能（对话、简历/Dockerfile生成等）将使用该供应商
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h5 className="text-sm font-semibold">模型列表</h5>
              <div className="relative">
                <button
                  className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  onClick={() => {
                    if (availablePresets.length > 0) {
                      setShowModelPicker(!showModelPicker);
                    } else {
                      onAddModel();
                      setShowModelPicker(false);
                    }
                  }}
                >
                  <Plus size={14} />
                  添加模型
                  {availablePresets.length > 0 && <ChevronDown size={12} />}
                </button>
                {showModelPicker && availablePresets.length > 0 && (
                  <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1 max-h-64 overflow-auto">
                    {availablePresets.map((preset) => (
                      <button
                        key={preset.model}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center justify-between"
                        onClick={() => {
                          onAddModel(preset);
                          setShowModelPicker(false);
                        }}
                      >
                        <span>{preset.model}</span>
                        {preset.thinking && <span className="text-purple-500 text-[10px]">thinking</span>}
                      </button>
                    ))}
                    <div className="border-t border-gray-100 mt-1 pt-1">
                      <button
                        className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:bg-gray-50"
                        onClick={() => {
                          onAddModel();
                          setShowModelPicker(false);
                        }}
                      >
                        自定义模型...
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {form.models.length === 0 && (
                <div className="p-4 bg-gray-50 rounded-lg text-xs text-gray-400 text-center">
                  暂无模型，请点击上方「添加模型」按钮
                </div>
              )}
              {form.models.map((model) => (
                <div key={model.id} className="flex flex-col gap-3 p-3 border border-gray-200 rounded-lg">
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                    placeholder="模型名称"
                    value={model.model}
                    onChange={(e) => onModelChange(model.id, { model: e.target.value })}
                  />
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={model.enabled}
                        onChange={(e) => onModelChange(model.id, { enabled: e.target.checked })}
                      />
                      启用
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        checked={model.isDefault}
                        onChange={() => onSetDefaultModel(model.id)}
                      />
                      默认
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={model.thinking}
                        onChange={(e) => onModelChange(model.id, { thinking: e.target.checked })}
                      />
                      thinking
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={model.stream !== false}
                        onChange={(e) => onModelChange(model.id, { stream: e.target.checked })}
                      />
                      流式
                    </label>
                    <button
                      className="text-xs text-red-500 hover:text-red-600"
                      onClick={() => onRemoveModel(model.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg"
          >
            取消
          </button>
          <button
            onClick={onSubmit}
            className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded-lg"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryDirModal({
  open,
  state,
  onClose,
  onChange,
  onPick,
  onSave,
}: {
  open: boolean;
  state: HistoryState;
  onClose: () => void;
  onChange: (value: string) => void;
  onPick: () => void;
  onSave: () => void;
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content w-[520px]" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>会话历史存储路径</h3>
          <button onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body space-y-3">
          <p className="text-xs text-gray-500">
            默认使用安装目录下 data/conversations，修改后会迁移历史到新目录（目标需为空）
          </p>
          <input
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            value={state.value}
            placeholder="例如：D:/codeshelf/data/conversations"
            onChange={(e) => onChange(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg flex items-center gap-1"
              onClick={onPick}
            >
              <FolderOpen size={14} />
              选择目录
            </button>
            <button
              className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded-lg disabled:opacity-60"
              onClick={onSave}
              disabled={state.saving}
            >
              {state.saving ? "迁移中..." : "保存并迁移"}
            </button>
          </div>
          {state.error && (
            <div className="text-xs text-red-500">{state.error}</div>
          )}
        </div>
      </div>
    </div>
  );
}


export type AiProviderSettingsHandle = {
  openCreateDrawer: () => void;
  openHistoryModal: () => void;
};

export const AiProviderSettings = forwardRef<AiProviderSettingsHandle, AiProviderSettingsProps>((_props, ref) => {
  const aiProviders = useAiProvidersStore((s) => s.aiProviders);
  const saveAiProviders = useAiProvidersStore((s) => s.saveAiProviders);
  const chatHistoryDir = useSettingsStore((s) => s.chatHistoryDir);
  const setChatHistoryDir = useSettingsStore((s) => s.setChatHistoryDir);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyState, setHistoryState] = useState<HistoryState>(getHistoryState(chatHistoryDir));
  const [form, setForm] = useState<ProviderForm>(initialForm());

  const submittingRef = useRef(false);

  const providers = aiProviders;

  const defaultProviderId = useMemo(
    () => providers.find((p) => p.isDefaultProvider)?.id ?? null,
    [providers]
  );

  useEffect(() => {
    setHistoryState((prev) => ({ ...prev, value: chatHistoryDir ?? "" }));
  }, [chatHistoryDir]);

  useImperativeHandle(ref, () => ({
    openCreateDrawer: openCreate,
    openHistoryModal: () => setHistoryModalOpen(true),
  }));

  async function handlePickHistoryDir() {
    try {
      const selected = await open({ directory: true, multiple: false, title: "选择会话历史目录" });
      if (selected) {
        setHistoryState((prev) => ({ ...prev, value: selected as string, error: null }));
      }
    } catch {
      setHistoryState((prev) => ({ ...prev, error: "选择目录失败" }));
    }
  }

  async function handleSaveHistoryDir() {
    if (historyState.saving) return;
    setHistoryState((prev) => ({ ...prev, saving: true, error: null }));
    try {
      const newDir = historyState.value.trim();
      if (!newDir) {
        setHistoryState((prev) => ({ ...prev, saving: false, error: "请填写有效路径" }));
        return;
      }
      await migrateChatHistoryDir(newDir);
      setChatHistoryDir(newDir);
      showToast("success", "会话历史目录已更新");
      setHistoryModalOpen(false);
    } catch (err) {
      setHistoryState((prev) => ({ ...prev, error: err instanceof Error ? err.message : "迁移失败" }));
    } finally {
      setHistoryState((prev) => ({ ...prev, saving: false }));
    }
  }

  function resetForm() {
    setEditingId(null);
    setEditorOpen(false);
    setForm(initialForm());
  }

  function openCreate() {
    setEditingId(null);
    setForm(initialForm());
    setEditorOpen(true);
  }

  function handleProviderTypeChange(type: "preset" | "custom") {
    if (type === "custom") {
      setForm((prev) => ({
        ...prev,
        providerType: "custom",
        presetKey: undefined,
        name: prev.name || "自定义厂商",
        baseUrl: prev.baseUrl || "",
      }));
    } else {
      const presetKey = (form.presetKey ?? "openai") as NonNullable<AiProviderConfig["presetKey"]>;
      setForm((prev) => ({
        ...prev,
        providerType: "preset",
        presetKey,
        name: PRESET_LABELS[presetKey],
        baseUrl: PRESET_BASE_URL[presetKey],
      }));
    }
  }

  function handlePresetChange(presetKey: NonNullable<AiProviderConfig["presetKey"]>) {
    setForm((prev) => ({
      ...prev,
      presetKey,
      name: PRESET_LABELS[presetKey],
      baseUrl: PRESET_BASE_URL[presetKey],
    }));
  }

  function openEdit(provider: AiProviderConfig) {
    setEditingId(provider.id);
    setEditorOpen(true);
    setForm({
      id: provider.id,
      name: provider.name,
      providerType: provider.providerType,
      presetKey: provider.presetKey,
      baseUrl: provider.baseUrl,
      apiKey: "",
      enabled: provider.enabled,
      isDefaultProvider: provider.isDefaultProvider,
      models: normalizeDefaultModel(provider.models),
    });
  }

  // 保存供应商配置（新增或编辑）
  async function handleSaveProvider() {
    if (submittingRef.current) return;
    submittingRef.current = true;

    try {
      if (!form.name.trim()) {
        showToast("warning", "请输入供应商名称");
        return;
      }
      if (!form.baseUrl.trim()) {
        showToast("warning", "请输入 Base URL");
        return;
      }
      if (form.models.length === 0) {
        showToast("warning", "请至少添加一个模型");
        return;
      }
      // 逐项校验，不是「至少一个非空」—— 后者会放行 [{model:"gpt-4"},{model:"  "}]，
      // 那个空模型会被存下来，之后在下拉里出现一个选不动的空项。
      const emptyIdx = form.models.findIndex((m) => !m.model.trim());
      if (emptyIdx >= 0) {
        showToast("warning", `第 ${emptyIdx + 1} 个模型的名称不能为空`);
        return;
      }
      // 同名模型同样有害：下拉里两个一样的条目，选中哪个取决于顺序
      const seen = new Set<string>();
      for (const m of form.models) {
        const key = m.model.trim();
        if (seen.has(key)) {
          showToast("warning", `模型名称重复：${key}`);
          return;
        }
        seen.add(key);
      }

      let apiKey = form.apiKey;
      if (editingId && (apiKey === "" || apiKey === undefined)) {
        apiKey = providers.find((p) => p.id === editingId)?.apiKey ?? "";
      } else if (apiKey === undefined) {
        // 编辑时未修改 API Key，保持原值；新增时未填写 API Key，设为空字符串
        apiKey = "";
      } else {
        // apiKey 保证为字符串；使用 ?? "" 来满足 TypeScript 类型缩小的要求
        apiKey = (apiKey ?? "").trim();
      }

      const normalizedModels = normalizeDefaultModel(
          form.models.map((m) => ({ ...m, model: m.model.trim() }))
      );
      const provider = createProviderTemplate({ ...form, apiKey, models: normalizedModels });

      let nextProviders: AiProviderConfig[];
      if (editingId) {
        nextProviders = providers.map((p) => (p.id === editingId ? provider : p));
      } else {
        const withoutDupe = providers.filter((p) => p.id !== provider.id);
        nextProviders = [...withoutDupe, provider];
      }

      if (provider.isDefaultProvider) {
        nextProviders = nextProviders.map((p) => ({
          ...p,
          isDefaultProvider: p.id === provider.id,
        }));
      }

      // 必须 await：以前是即发即忘 + store 内部吞异常，
      // 于是磁盘写失败时照样提示「保存成功」并清空表单，用户的 API key 就此丢失。
      await saveAiProviders(nextProviders);
      showToast("success", "保存成功");
      resetForm(); // 只有确实写成功了才关闭表单
    } catch (e) {
      // Tauri 的错误是纯字符串，不是 Error 实例（CLAUDE.md 硬约束 4）
      showToast(
        "error",
        "保存失败",
        typeof e === "string" && e ? e : e instanceof Error ? e.message : "配置未写入磁盘，请重试",
      );
      // 刻意不 resetForm：把用户填的内容留在表单里，方便直接重试
    } finally {
      submittingRef.current = false;
    }
  }

  /**
   * 保存并如实反馈结果。
   *
   * 这三个 handler 原本都是即发即忘：store 内部吞掉异常，界面无条件报成功。
   * 现在 store 会回滚并抛出，这里统一处理 —— 修一处不够，它们是同一个错误模式。
   */
  async function persistProviders(next: AiProviderConfig[], successMessage?: string) {
    try {
      await saveAiProviders(next);
      if (successMessage) showToast("success", successMessage);
    } catch (e) {
      showToast(
        "error",
        "保存失败",
        typeof e === "string" && e ? e : e instanceof Error ? e.message : "配置未写入磁盘，请重试",
      );
    }
  }

  function handleRemoveProvider(id: string) {
    void persistProviders(providers.filter((p) => p.id !== id), "已删除供应商");
  }

  function handleToggleProvider(id: string) {
    void persistProviders(
      providers.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    );
  }

  function handleSetDefaultProvider(id: string) {
    void persistProviders(
      providers.map((p) => ({ ...p, isDefaultProvider: p.id === id })),
    );
  }

  function updateModel(id: string, updates: Partial<AiModelConfig>) {
    setForm((prev) => ({
      ...prev,
      models: prev.models.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    }));
  }

  function addModel(template?: { model: string; thinking: boolean }) {
    setForm((prev) => ({
      ...prev,
      models: [
        ...prev.models,
        {
          ...createModelTemplate(template?.model ?? "", template?.thinking ?? false),
          isDefault: prev.models.length === 0, // 第一个模型自动设为默认
        },
      ],
    }));
  }

  function removeModel(id: string) {
    setForm((prev) => ({
      ...prev,
      models: prev.models.filter((m) => m.id !== id),
    }));
  }

  function setDefaultModel(id: string) {
    setForm((prev) => ({
      ...prev,
      models: prev.models.map((m) => ({ ...m, isDefault: m.id === id })),
    }));
  }

  return (
    <div className="space-y-4">
      {providers.length === 0 ? (
        <div className="p-8 bg-gray-50 rounded-lg text-center space-y-2">
          <div className="text-sm text-gray-500">暂无供应商配置</div>
          <div className="text-xs text-gray-400">点击右上角「新增供应商」按钮添加你的第一个 AI 供应商</div>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500">
                <th className="text-left px-4 py-2.5 font-medium">供应商</th>
                <th className="text-left px-4 py-2.5 font-medium">模型</th>
                <th className="text-left px-4 py-2.5 font-medium">API Key</th>
                <th className="text-left px-4 py-2.5 font-medium">状态</th>
                <th className="text-right px-4 py-2.5 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider, idx) => (
                <tr key={provider.id} className={"border-t border-gray-100" + (idx % 2 === 1 ? " bg-gray-50/50" : "")}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800">{provider.name}</span>
                      {provider.isDefaultProvider && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-blue-400 bg-blue-50 text-blue-700">默认</span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5 truncate max-w-[220px]" title={provider.baseUrl}>{provider.baseUrl}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {provider.models.map((model) => (
                        <span
                          key={model.id}
                          className={"px-1.5 py-0.5 rounded text-[10px] " + (model.enabled ? "bg-gray-100 text-gray-700" : "bg-gray-50 text-gray-400")}
                        >
                          {model.model}{model.isDefault ? " *" : ""}{model.thinking ? " 🧠" : ""}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={"text-xs " + (provider.apiKey ? "text-emerald-600" : "text-gray-400")}>
                      {provider.apiKey ? "已配置" : "未配置"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={"inline-block text-[10px] px-2 py-0.5 rounded-full border " + (provider.enabled ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-gray-300 bg-gray-50 text-gray-500")}>
                      {provider.enabled ? "已启用" : "未启用"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className={"px-2 py-1 rounded border text-xs " + (provider.enabled ? "border-green-300 text-green-600" : "border-gray-200 text-gray-500")}
                        onClick={() => handleToggleProvider(provider.id)}
                      >
                        {provider.enabled ? "停用" : "启用"}
                      </button>
                      <button
                        className={"px-2 py-1 rounded border text-xs " + (provider.isDefaultProvider ? "border-blue-400 text-blue-600" : "border-gray-200 text-gray-500")}
                        onClick={() => handleSetDefaultProvider(provider.id)}
                        disabled={!provider.enabled}
                        title="设为默认供应商，所有AI功能将使用该配置"
                      >
                        默认
                      </button>
                      <button
                        className="text-gray-400 hover:text-blue-600"
                        onClick={() => openEdit(provider)}
                        title="编辑"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="text-gray-400 hover:text-red-500"
                        onClick={() => handleRemoveProvider(provider.id)}
                        title="删除"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {defaultProviderId === null && providers.length > 0 && (
        <div className="p-3 bg-amber-50 text-xs text-amber-700 rounded-lg">
          当前尚未设置默认供应商，启用供应商后会自动设为默认。
        </div>
      )}

      <ProviderFormDrawer
        open={editorOpen}
        title={editingId ? "编辑供应商" : "新增供应商"}
        form={form}
        editingId={editingId}
        onClose={resetForm}
        onSubmit={handleSaveProvider}
        onProviderTypeChange={handleProviderTypeChange}
        onPresetChange={handlePresetChange}
        onFormChange={(updates) => setForm((prev) => ({ ...prev, ...updates }))}
        onModelChange={updateModel}
        onAddModel={addModel}
        onRemoveModel={removeModel}
        onSetDefaultModel={setDefaultModel}
      />

      <HistoryDirModal
        open={historyModalOpen}
        state={historyState}
        onClose={() => setHistoryModalOpen(false)}
        onChange={(value) => setHistoryState((prev) => ({ ...prev, value }))}
        onPick={handlePickHistoryDir}
        onSave={handleSaveHistoryDir}
      />
    </div>
  );
});
