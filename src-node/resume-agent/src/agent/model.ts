import { ChatOpenAI } from "@langchain/openai";
import type { AiProviderConfig } from "../types.js";

export function pickModel(provider: AiProviderConfig) {
  const model = provider.models.find((item) => item.enabled && item.isDefault) ?? provider.models.find((item) => item.enabled);
  if (!model) {
    throw new Error("No enabled model found in provider");
  }
  return model;
}

export function createChatModel(
  provider: AiProviderConfig,
  options?: { maxTokens?: number },
) {
  const model = pickModel(provider);
  return new ChatOpenAI({
    model: model.model,
    apiKey: provider.apiKey || "EMPTY",
    configuration: {
      baseURL: `${provider.baseUrl.replace(/\/$/, "")}`,
    },
    temperature: model.thinking ? undefined : 0.2,
    streaming: false,
    // 默认 8192；简历 JSON 会随项目数增长，调用方按项目数动态放大，
    // 避免输出在 JSON 中途被截断导致整次解析失败。
    maxTokens: options?.maxTokens ?? 8192,
  });
}

export function thinkingEnabled(provider: AiProviderConfig): boolean {
  return Boolean(pickModel(provider).thinking);
}
