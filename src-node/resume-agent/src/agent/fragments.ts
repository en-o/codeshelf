import { z } from "zod/v4";

import type {
  GenerateResumeFragmentRequest,
  KnowledgeInput,
  ResumeProjectExperience,
} from "../types.js";
import { jsonArtifact, toJsonSafe } from "../util.js";
import { loadPromptConfig } from "../storage/promptStore.js";
import { createChatModel } from "./model.js";

const starSchema = z.object({
  situation: z.string().default(""),
  task: z.string().default(""),
  action: z.string().default(""),
  result: z.string().default(""),
});

const projectExperienceSchema = z.object({
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  projectTime: z.string().optional(),
  projectRole: z.string().optional(),
  techStack: z.array(z.string()).default([]),
  starExperience: starSchema.default({
    situation: "",
    task: "",
    action: "",
    result: "",
  }),
  isEdited: z.boolean().default(false),
  evidenceFiles: z.array(z.string()).default([]),
});

export async function generateResumeFragment(
  request: GenerateResumeFragmentRequest,
): Promise<unknown> {
  // 加载用户在「提示词」里配置的 resumePrompt（未自定义则为内置的高质量默认提示词）。
  // 之前 fragment 路径完全忽略该配置、只用一段简短硬编码提示词，导致主生成“效果不好”
  // 且提示词编辑不生效。这里把其字段规则/反编造规则真正作用到逐项目/摘要生成上。
  const promptConfig = await loadPromptConfig(request.dataDir);
  const model = createChatModel(request.provider);
  const system = buildSystemPrompt(request, promptConfig.resumePrompt);
  const user = buildUserPrompt(request);
  const response = await model.invoke([
    { role: "system", content: system },
    { role: "user", content: user },
  ] as never);
  const text = extractMessageText(response);
  return parseFragmentResponse(text, request);
}

function buildSystemPrompt(
  request: GenerateResumeFragmentRequest,
  resumePrompt: string,
): string {
  const common = [
    "你是 CodeShelf 的简历内容编辑器，负责局部生成或润色简历内容。",
    "只能基于用户提供的个人资料、工作经历、技术栈、项目背景知识和现有内容改写。",
    "不要编造无法验证的公司、职责、指标、获奖、业务规模、性能数据或项目成果。",
    "量化指标只有在输入材料中明确出现时才能保留；否则改成定性表达。",
    "输出必须是 JSON，不要输出 Markdown 代码围栏。",
  ];
  // 用户配置（或内置默认）的简历写作规范：含字段规则、反编造规则、action 三要素与示例等。
  // 注入到 system，让「提示词」配置真正生效；其中“整份简历数组格式”由下方各任务的输出格式覆盖。
  const guideline = resumePrompt.trim()
    ? [
        "",
        "【简历写作规范（来自提示词配置，务必遵循其中的字段规则与反编造规则）】",
        resumePrompt.trim(),
      ]
    : [];
  switch (request.fragment.kind) {
    case "summary_generate":
      return [
        ...common,
        ...guideline,
        "",
        "【本次任务】只生成“个人简介 summary”一个字段：围绕目标岗位方向、技术能力、项目领域、岗位定位，形成 2-4 句自然中文简介，遵循上文 summary 字段规则，只写有证据的内容。",
        "【只输出】{\"summary\":\"...\"}（忽略写作规范中关于整份简历数组的格式）。",
      ].join("\n");
    case "summary_polish":
      return [
        ...common,
        ...guideline,
        "",
        "【本次任务】只润色“个人简介 summary”：保留原有事实与资历边界，提升表达密度与专业度，形成 2-4 句自然中文简介，遵循上文 summary 字段规则。",
        "【只输出】{\"summary\":\"...\"}。",
      ].join("\n");
    case "work_polish":
      return [
        ...common,
        "任务：润色单段工作经历中的岗位职责。",
        "要求：输出 3-6 条 Markdown 列表，动词开头，体现职责、协作、技术落地和业务支撑；不要写项目经历成稿。",
        "不得编造背景知识中没有的业务指标、性能数据与规模；无证据的数字改为定性表达。",
        "输出格式：{\"description\":\"- ...\\n- ...\"}",
      ].join("\n");
    case "project_regenerate":
      return [
        ...common,
        ...guideline,
        "",
        "【本次任务】只重写“单个项目经历”。严格遵循上文写作规范中对 techStack/situation/action/result/evidenceFiles 的字段规则，重点：",
        "- action（核心职责）：4-8 条 Markdown 列表，每条必须包含【模块/动作 + 技术方案 + 解决的问题】三要素，把技术亮点融合进职责、不单列“技术亮点”，并尽量埋入面试可追问点。",
        "- result（项目成果）：2-4 条 Markdown 列表，只写有证据的结果；无证据的数字（如 500%、3s→200ms、千万级、团队人数、提交次数等）一律不写，改用可验证的定性结果。",
        "- situation：2-3 句项目描述，不虚构行业影响；techStack：本项目实际用到的 6-12 个核心技术。",
        "【只输出】{\"experience\":{...}}，experience 必须含 projectId、projectName、projectTime、projectRole、techStack、starExperience（含 situation/action/result）、evidenceFiles（忽略写作规范中关于 summary/skills/experiences 数组的整份格式，本任务只产出单个项目）。",
      ].join("\n");
  }
}

function buildUserPrompt(request: GenerateResumeFragmentRequest): string {
  const fragment = request.fragment;
  const targetDocs =
    fragment.kind === "project_regenerate"
      ? request.knowledgeDocs.filter((doc) => doc.projectId === fragment.projectId)
      : request.knowledgeDocs;
  return [
    "简历目标：",
    jsonArtifact({
      jobDirection: request.jobDirection,
      jdKeywords: request.jdKeywords,
      tone: request.tone,
      task: fragment.kind,
      userInstruction: "instruction" in fragment ? fragment.instruction || "" : "",
    }),
    "",
    "当前输入：",
    jsonArtifact(fragment),
    "",
    "背景知识：",
    formatKnowledgeDocs(targetDocs.length ? targetDocs : request.knowledgeDocs),
  ].join("\n");
}

function formatKnowledgeDocs(docs: KnowledgeInput[]): string {
  const maxTotalChars = 80_000;
  const maxDocChars = Math.max(12_000, Math.floor(maxTotalChars / Math.max(1, docs.length)));
  let used = 0;
  const sections: string[] = [];
  for (const doc of docs) {
    const remaining = Math.max(0, maxTotalChars - used);
    const limit = Math.min(maxDocChars, remaining);
    const content = limitContent(doc.content, limit);
    used += [...content].length;
    sections.push([
      `## ${doc.projectName}`,
      "",
      jsonArtifact({
        projectId: doc.projectId,
        projectName: doc.projectName,
        projectPath: doc.projectPath,
      }),
      "",
      content,
    ].join("\n"));
    if (used >= maxTotalChars) break;
  }
  return sections.join("\n\n---\n\n");
}

function parseFragmentResponse(text: string, request: GenerateResumeFragmentRequest): unknown {
  const object = asObject(parseJsonObject(text));
  if (!object) throw new Error("模型返回不是 JSON 对象");
  const fragment = request.fragment;
  switch (fragment.kind) {
    case "summary_generate":
    case "summary_polish": {
      const summary = z.object({ summary: z.string() }).parse(object).summary.trim();
      return { summary };
    }
    case "work_polish": {
      const description = z.object({ description: z.string() }).parse(object).description.trim();
      return { description: normalizeMarkdownList(description, 6) };
    }
    case "project_regenerate": {
      const candidate = asObject(object.experience) ?? object;
      const parsed = projectExperienceSchema.parse(candidate);
      const doc = request.knowledgeDocs.find((item) => item.projectId === fragment.projectId);
      return {
        experience: normalizeProjectExperience(parsed, {
          projectId: fragment.projectId,
          projectName: doc?.projectName ?? fragment.currentExperience?.projectName ?? "",
        }),
      };
    }
  }
}

function normalizeProjectExperience(
  raw: z.infer<typeof projectExperienceSchema>,
  fallback: { projectId: string; projectName: string },
): ResumeProjectExperience {
  return {
    projectId: raw.projectId?.trim() || fallback.projectId,
    projectName: raw.projectName?.trim() || fallback.projectName,
    projectTime: raw.projectTime?.trim() || undefined,
    projectRole: raw.projectRole?.trim() || undefined,
    techStack: uniqueStrings(raw.techStack).slice(0, 14),
    starExperience: {
      situation: raw.starExperience.situation.trim(),
      task: raw.starExperience.task.trim(),
      action: normalizeMarkdownList(raw.starExperience.action, 8),
      result: normalizeMarkdownList(raw.starExperience.result, 4),
    },
    isEdited: false,
    evidenceFiles: uniqueStrings(raw.evidenceFiles).slice(0, 20),
  };
}

function normalizeMarkdownList(text: string, maxItems: number): string {
  const items = splitMarkdownItems(text).slice(0, maxItems);
  return items.map((item) => `- ${item}`).join("\n");
}

function splitMarkdownItems(text: string): string[] {
  const value = text.trim();
  if (!value) return [];
  const lines = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  const markdownLines = lines.filter((line) => /^([-*•]|\d+[.)、])\s+/.test(line));
  if (markdownLines.length >= 2) {
    return uniqueStrings(markdownLines.map(stripListMarker).filter(Boolean));
  }
  const sentenceItems = value
    .split(/(?<=[。!?；;！？])\s*/)
    .flatMap((item) => item.split(/\s*[；;]\s*/))
    .map(stripListMarker)
    .filter(Boolean);
  if (sentenceItems.length > 1) return uniqueStrings(sentenceItems);
  return uniqueStrings([stripListMarker(value)].filter(Boolean));
}

function stripListMarker(text: string): string {
  return text
    .trim()
    .replace(/^[-*•]\s+/u, "")
    .replace(/^\d+[.)、]\s*/u, "")
    .trim();
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function limitContent(content: string, maxChars: number): string {
  if ([...content].length <= maxChars) return content;
  return `${[...content].slice(0, maxChars).join("")}\n\n[背景知识过长，已截断；只允许基于可见内容生成]`;
}

function extractMessageText(message: unknown): string {
  const safe = asObject(toJsonSafe(message));
  const kwargs = asObject(safe?.kwargs);
  return firstNonEmptyString(
    contentToText(kwargs?.content),
    contentToText(safe?.content),
    typeof safe?.text === "string" ? safe.text : "",
  );
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("模型返回不是 JSON");
    }
    return JSON.parse(unfenced.slice(start, end + 1));
  }
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      const object = asObject(item);
      return typeof object?.text === "string" ? object.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function firstNonEmptyString(...values: string[]): string {
  return values.find((value) => value.trim().length > 0) ?? "";
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
