import type { DshProviderSpec } from "@/services/dsh";
import type { AiProviderConfig } from "@/types";

/** dsh 默认模型的存储键，值形如 `<providerId>::<model>` */
export const DSH_DEFAULT_MODEL_KEY = "dsh.defaultModel";

/**
 * CodeShelf 的供应商 → dsh 的模型路由。
 *
 * 每个启用的供应商各生成一条，带自己的端点、密钥引用和模型清单 ——
 * 这样 dsh 里的模型下拉就等于「模型」页里配的那些，且选哪个用哪个的凭据。
 * 必须传全量：只传选中那个的话，在 dsh 界面里换个模型就会拿错家的地址去打。
 */
export function toDshProviders(providers: AiProviderConfig[]): DshProviderSpec[] {
  return providers
    .filter((p) => p.enabled)
    .map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey ?? null,
      // Claude 是自己的协议，其余按 OpenAI 兼容
      api:
        p.presetKey === "anthropic" || /(^|\.)anthropic\.com/i.test(p.baseUrl)
          ? "anthropic-messages"
          : "openai-completions",
      models: p.models.filter((m) => m.enabled).map((m) => m.model),
    }))
    .filter((p) => p.models.length > 0);
}
