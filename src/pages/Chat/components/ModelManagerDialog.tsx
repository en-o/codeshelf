// 模型管理弹窗：勾选模型启用/视觉、删除模型、快速添加模型

import { useState } from "react";
import { showToast } from "@/components/ui";
import type { AiProviderConfig } from "@/types";

interface ModelManagerDialogProps {
  open: boolean;
  onClose: () => void;
  onGoToProviders: () => void;
  aiProviders: AiProviderConfig[];
  normalized: AiProviderConfig[];
  saveAiProviders: (next: AiProviderConfig[]) => Promise<void>;
  initialProviderId: string;
}

export function ModelManagerDialog({
  open,
  onClose,
  onGoToProviders,
  aiProviders,
  normalized,
  saveAiProviders,
  initialProviderId,
}: ModelManagerDialogProps) {

  /**
   * saveAiProviders 现在会在写盘失败时回滚并抛出（见 aiProvidersStore）。
   * 这些都是 onChange 里的 async 回调，不接住就是一个静默的 unhandled rejection，
   * 界面上勾选框看着变了、其实没存下来。
   */
  async function persist(next: AiProviderConfig[]) {
    try {
      await saveAiProviders(next);
    } catch (e) {
      showToast(
        "error",
        "保存失败",
        typeof e === "string" && e ? e : e instanceof Error ? e.message : "配置未写入磁盘，请重试",
      );
    }
  }
  const [qmProviderId, setQmProviderId] = useState<string>(initialProviderId);
  const [qmModelId, setQmModelId] = useState("");

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg w-[560px] max-w-[92vw] max-h-[80vh] overflow-y-auto p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">模型管理</div>
          <button
            className="text-xs text-blue-500 hover:underline"
            onClick={() => {
              onClose();
              onGoToProviders();
            }}
          >
            完整设置 →
          </button>
        </div>

        <div className="space-y-3">
          {normalized.filter((p) => p.enabled).map((p) => (
            <div key={p.id} className="border border-gray-200 rounded p-2">
              <div className="text-xs font-semibold text-gray-700 mb-1">
                {p.name} {p.isDefaultProvider && <span className="text-[10px] text-blue-500">(默认)</span>}
              </div>
              <div className="space-y-1">
                {p.models.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      onChange={async (e) => {
                        const next = aiProviders.map((pp) => pp.id === p.id ? {
                          ...pp,
                          models: pp.models.map((mm) => mm.id === m.id ? { ...mm, enabled: e.target.checked } : mm),
                        } : pp);
                        await persist(next);
                      }}
                    />
                    <span className="font-mono flex-1 truncate">{m.model}</span>
                    {m.isDefault && <span className="text-[10px] text-blue-500">默认</span>}
                    <label
                      className="flex items-center gap-1 text-[10px] text-gray-500"
                      title="勾选后会发送 image_url 多模态分片；非视觉模型会报错"
                    >
                      <input
                        type="checkbox"
                        checked={!!m.vision}
                        onChange={async (e) => {
                          const next = aiProviders.map((pp) => pp.id === p.id ? {
                            ...pp,
                            models: pp.models.map((mm) => mm.id === m.id ? { ...mm, vision: e.target.checked } : mm),
                          } : pp);
                          await persist(next);
                        }}
                      />
                      视觉
                    </label>
                    <button
                      className="text-gray-300 hover:text-red-500"
                      title="删除"
                      onClick={async () => {
                        if (!confirm(`删除模型 ${m.model}？`)) return;
                        const next = aiProviders.map((pp) => pp.id === p.id ? {
                          ...pp,
                          models: pp.models.filter((mm) => mm.id !== m.id),
                        } : pp);
                        await persist(next);
                      }}
                    >×</button>
                  </div>
                ))}
                {p.models.length === 0 && <div className="text-[11px] text-gray-400">此供应商下暂无模型</div>}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-200 pt-3 space-y-2">
          <div className="text-xs font-semibold text-gray-700">快速添加模型</div>
          <div className="flex items-center gap-2">
            <select
              className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded"
              value={qmProviderId}
              onChange={(e) => setQmProviderId(e.target.value)}
            >
              {normalized.filter((p) => p.enabled).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input
              className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded"
              placeholder="模型 id，如 gpt-4o-mini"
              value={qmModelId}
              onChange={(e) => setQmModelId(e.target.value)}
            />
            <button
              className="px-3 py-1 text-xs bg-blue-500 text-white rounded disabled:opacity-60"
              disabled={!qmProviderId || !qmModelId.trim()}
              onClick={async () => {
                const modelName = qmModelId.trim();
                const next = aiProviders.map((pp) => pp.id === qmProviderId ? {
                  ...pp,
                  models: [...pp.models, {
                    id: `${pp.id}-${modelName}-${Date.now()}`,
                    model: modelName,
                    enabled: true,
                    isDefault: false,
                    thinking: false,
                    stream: true,
                  }],
                } : pp);
                await persist(next);
                setQmModelId("");
                showToast("success", "已添加");
              }}
            >添加</button>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            className="px-3 py-1.5 text-xs border border-gray-200 rounded"
            onClick={onClose}
          >关闭</button>
        </div>
      </div>
    </div>
  );
}
