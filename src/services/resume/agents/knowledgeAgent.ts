import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { AiProviderConfig } from "@/types";
import type { JobDirection, ResumeV2, Tone } from "@/types/resume";
import type {
  AgentRunRecord,
  ResumeAgentPromptConfig,
} from "@/services/resume/knowledgeStore";

export interface KnowledgeRunResult {
  background: string;
  run: AgentRunRecord;
  resume: ResumeV2;
}

export interface RunKnowledgeAgentOptions {
  requestId: string;
  projectId: string;
  provider: AiProviderConfig;
  jobDirection?: JobDirection;
  jdKeywords?: string[];
  tone?: Tone;
  promptConfig?: ResumeAgentPromptConfig;
  /**
   * 是否允许 Agent 执行只读命令（git log 等白名单命令，不经过 shell）。
   * 默认 false —— 仓库内容里的提示注入不该顺手拿到命令执行能力。
   * 调用方必须按次由用户明确勾选后才传 true。
   */
  allowReadOnlyCommands?: boolean;
  onRun?: (run: AgentRunRecord) => void;
  signal?: AbortSignal;
}

interface RunEventPayload {
  type: "event";
  requestId: string;
  projectId: string;
  run: AgentRunRecord;
}

interface RunCommandResult {
  background: string;
  resume: ResumeV2;
  run: AgentRunRecord;
}

export async function runKnowledgeAgent(
  opts: RunKnowledgeAgentOptions,
): Promise<KnowledgeRunResult> {
  const unlisten = await listen<RunEventPayload>("resume-agent-run-event-v3", (event) => {
    if (event.payload.requestId !== opts.requestId) return;
    opts.onRun?.(event.payload.run);
  });

  const onAbort = () => {
    void invoke("cancel_resume_deep_agent", { requestId: opts.requestId }).catch(() => {});
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const result = await invoke<RunCommandResult>("run_resume_deep_agent", {
      request: {
        requestId: opts.requestId,
        projectId: opts.projectId,
        provider: opts.provider,
        jobDirection: opts.jobDirection ?? "fullstack",
        jdKeywords: opts.jdKeywords ?? [],
        tone: opts.tone ?? "professional",
        promptConfig: opts.promptConfig ?? null,
        // 默认只读；命令执行必须由用户按次授权
        toolPermissionMode: opts.allowReadOnlyCommands ? "full_agent" : "read_only",
      },
    });
    return result;
  } finally {
    unlisten();
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
