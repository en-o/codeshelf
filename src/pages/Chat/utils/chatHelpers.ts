// 纯工具函数 / 类型：模型选项构造、消息构造、提及路径处理、会话标题摘要

import type { AiModelConfig, AiProviderConfig, ChatMessage } from "@/types";

export interface ModelOption {
  providerId: string;
  providerName: string;
  modelId: string;
  model: AiModelConfig;
  baseUrl: string;
  apiKey?: string;
  key: string;
  /** 供应商协议；缺省 OpenAI 兼容。"anthropic" 走 Claude 原生 /v1/messages */
  protocol?: "anthropic";
}

export function buildModelOptions(providers: AiProviderConfig[]): ModelOption[] {
  const options: ModelOption[] = [];
  for (const p of providers) {
    if (!p.enabled) continue;
    for (const m of p.models) {
      if (!m.enabled) continue;
      options.push({
        providerId: p.id,
        providerName: p.name,
        modelId: m.id,
        model: m,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        key: `${p.id}:${m.id}`,
        // 协议在这里判一次就够：所有发请求的地方都从 ModelOption 取
        protocol: p.presetKey === "anthropic" ? "anthropic" : undefined,
      });
    }
  }
  options.sort((a, b) => {
    const aProvider = providers.find((p) => p.id === a.providerId);
    const bProvider = providers.find((p) => p.id === b.providerId);
    const aIsDefaultProvider = aProvider?.isDefaultProvider ? 1 : 0;
    const bIsDefaultProvider = bProvider?.isDefaultProvider ? 1 : 0;
    if (aIsDefaultProvider !== bIsDefaultProvider) return bIsDefaultProvider - aIsDefaultProvider;
    const aIsDefault = a.model.isDefault ? 1 : 0;
    const bIsDefault = b.model.isDefault ? 1 : 0;
    if (aIsDefault !== bIsDefault) return bIsDefault - aIsDefault;
    return 0;
  });
  return options;
}

export function getDefaultOptionKey(providers: AiProviderConfig[]): string | null {
  const defaultProvider =
    providers.filter((p) => p.enabled).find((p) => p.isDefaultProvider) ?? providers.filter((p) => p.enabled)[0];
  if (!defaultProvider) return null;
  const defaultModel =
    defaultProvider.models.filter((m) => m.enabled).find((m) => m.isDefault) ?? defaultProvider.models.filter((m) => m.enabled)[0];
  if (!defaultModel) return null;
  return `${defaultProvider.id}:${defaultModel.id}`;
}

/** 生成本地唯一 ID（会话或消息通用）。crypto.randomUUID 不可用时退回时间戳+随机串。 */
export function newId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function makeMessage(role: ChatMessage["role"], content: string, extra?: Partial<ChatMessage>): ChatMessage {
  return {
    id: newId(),
    role,
    content,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

export function formatMentionPath(path: string): string {
  if (/\s|"/.test(path)) {
    return `@"${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return `@${path}`;
}

export function unescapeMentionPath(path: string): string {
  return path.replace(/\\(["\\])/g, "$1");
}

export function trimMentionPunctuation(path: string): string {
  return path.replace(/[,.!?;:，。！？；：、)）\]】}]+$/u, "");
}

export function summarizeTitle(messages: ChatMessage[]): string | null {
  const firstUser = messages.find((m) => m.role === "user" && m.content.trim());
  if (!firstUser) return null;
  const trimmed = firstUser.content.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 20) + (trimmed.length > 20 ? "..." : "");
}
