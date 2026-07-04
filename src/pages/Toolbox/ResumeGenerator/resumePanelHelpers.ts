// ResumePanelV2 的纯逻辑 helper、常量与类型（从 ResumePanelV2.tsx 抽出，无 JSX）。
// 被主面板、对话框、侧栏、编辑器共享。

import type {
  JobDirection,
  ProjectKnowledge,
  ResumeV2,
  ResumeProjectExperience,
} from "@/types/resume";
import type { AgentStep } from "@/services/resume/agents/resumeAgent";

export type RefineTask =
  | { kind: "summary_generate" | "summary_polish" }
  | { kind: "work_polish"; workId: string }
  | { kind: "project_regenerate"; projectId: string };

export const DEFAULT_TONE = "professional" as const;
export const EMPTY_JD_KEYWORDS: string[] = [];

export const JOB_OPTIONS: Array<{ id: JobDirection; name: string; description: string }> = [
  { id: "backend", name: "后端", description: "架构、接口、数据库、工程化" },
  { id: "frontend", name: "前端", description: "组件、体验、性能、工程化" },
  { id: "fullstack", name: "全栈", description: "前后端协同与端到端交付" },
];

export function refineTaskMeta(task: RefineTask): {
  title: string;
  description: string;
  placeholder: string;
} {
  switch (task.kind) {
    case "summary_generate":
      return {
        title: "生成个人简介",
        description: "基于现有个人简介、工作经历、技术栈和项目背景知识，生成面向投递的个人简介。",
        placeholder: "例如：突出 AI+政务经验、团队负责人经历、Java/Spring Cloud 技术深度",
      };
    case "summary_polish":
      return {
        title: "润色个人简介",
        description: "在不改变事实的前提下，提升个人简介的表达密度、岗位匹配度和专业度。",
        placeholder: "例如：更偏后端架构师表达；弱化管理，突出技术落地",
      };
    case "work_polish":
      return {
        title: "润色岗位职责",
        description: "润色当前工作经历的岗位职责，输出 Markdown 要点，适合直接放入简历。",
        placeholder: "例如：突出团队管理、需求交付、AI 项目推进、后端架构治理",
      };
    case "project_regenerate":
      return {
        title: "重新生成项目经历",
        description: "只重新生成当前项目经历，保留项目证据边界，输出项目描述、核心职责和项目成果。",
        placeholder: "例如：职责更聚焦后端；成果不要写虚假指标；突出 AI 模型接入与数据闭环",
      };
  }
}

export function normalizeTag(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const value = normalizeTag(tag);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function createDraftResume(jobDirection: JobDirection): ResumeV2 {
  const now = new Date().toISOString();
  return {
    id: generateRequestId(),
    createdAt: now,
    updatedAt: now,
    jobDirection,
    jdKeywords: EMPTY_JD_KEYWORDS,
    tone: DEFAULT_TONE,
    summary: "",
    skills: [],
    experiences: [],
    isSaved: false,
  };
}

export function createEmptyProjectExperience(doc: ProjectKnowledge): ResumeProjectExperience {
  return {
    projectId: doc.projectId,
    projectName: doc.projectName,
    techStack: [],
    starExperience: {
      situation: "",
      task: "",
      action: "",
      result: "",
    },
    isEdited: false,
    evidenceFiles: [],
  };
}

export function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function labelOf(key: "situation" | "action" | "result"): string {
  return {
    situation: "项目描述",
    action: "核心职责",
    result: "项目成果",
  }[key];
}

export function formatRelativeTime(value: string): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;
  const diff = Date.now() - time;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(value).toLocaleDateString("zh-CN");
}

export function formatStep(step: AgentStep): string {
  switch (step.kind) {
    case "tool_call":
      return `调用 ${step.label ?? "tool"}`;
    case "tool_result":
      return `${step.label ?? "tool"} 返回`;
    case "todo_update":
      return `更新待办${step.detail ? `: ${step.detail}` : ""}`;
    case "llm_text":
      return `${step.label ?? "模型输出"}${step.detail ? `: ${step.detail}` : ""}`;
    default:
      return `错误: ${step.detail ?? ""}`;
  }
}

export function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
