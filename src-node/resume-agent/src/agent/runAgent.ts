import { createDeepAgent } from "deepagents";
import { tool } from "@langchain/core/tools";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { z } from "zod/v4";

import { ResumeProjectBackend } from "../fs/projectBackend.js";
import { loadPromptConfig } from "../storage/promptStore.js";
import { rotateRuns, saveFinalOutput, writeRun } from "../storage/runStore.js";
import type {
  AgentRunRecord,
  ArtifactRef,
  FinalizeAllInput,
  ResumeV2,
  RunAgentRequest,
} from "../types.js";
import { durationMs, jsonArtifact, newId, nowIso, toJsonSafe } from "../util.js";
import { RunContext, type EmitRun } from "./runContext.js";
import { createChatModel, pickModel, thinkingEnabled } from "./model.js";

const finalizeSchema = z.object({
  background: z.string().min(1),
});

type FinalizeSchemaOutput = z.infer<typeof finalizeSchema>;

const LOGGED_TOOL_NAMES = new Set([
  "ls",
  "glob",
  "grep",
  "read_file",
  "batch_read_files",
  "read_existing_background",
  "write_file",
  "edit_file",
  "execute",
  "finalize_all",
]);

export async function runResumeDeepAgent(
  request: RunAgentRequest,
  signal: AbortSignal,
  emit: EmitRun,
): Promise<{ background: string; resume: ResumeV2; run: AgentRunRecord }> {
  const prompt = request.promptConfig ?? await loadPromptConfig(request.dataDir);
  const model = pickModel(request.provider);
  await rotateRuns(request.dataDir, request.project.id);

  const startedAt = nowIso();
  const run: AgentRunRecord = {
    id: newId("run"),
    requestId: request.requestId,
    projectId: request.project.id,
    status: "running",
    startedAt,
    modelProvider: request.provider.name,
    modelName: model.model,
    promptSnapshot: prompt,
    toolPermissionMode: request.toolPermissionMode ?? "read_only",
    events: [],
  };
  await writeRun(request.dataDir, run);
  emit(run);

  const ctx = new RunContext(request, run, emit);
  await ctx.event({
    type: "system",
    status: "success",
    title: "run_started",
    data: {
      projectId: request.project.id,
      projectName: request.project.name,
      projectPath: request.project.path,
      toolPermissionMode: run.toolPermissionMode,
    },
  });

  const finalized: { value?: FinalizeAllInput } = {};
  const finalizeAll = tool(
    async (input) => {
      const parsed = finalizeSchema.parse(input);
      finalized.value = normalizeFinalOutput(parsed, request);
      const artifact = await ctx.artifact("finalize_all.json", "Finalize Payload", "finalize_payload", jsonArtifact(finalized.value));
      await ctx.event({
        type: "finalize",
        status: "success",
        title: "finalize_all",
        artifacts: [artifact],
        returnedChars: artifact.chars,
      });
      return "finalize_all accepted";
    },
    {
      name: "finalize_all",
      description: "提交最终 background.md。完成项目背景知识调查后必须调用。",
      schema: finalizeSchema,
    },
  );

  const existingBackground = tool(
    async () => {
      return ctx.timedToolEvent({
        toolName: "read_existing_background",
        args: { projectId: request.project.id },
        run: async () => {
          const { loadBackground } = await import("../storage/runStore.js");
          return await loadBackground(request.dataDir, request.project.id) ?? "";
        },
      });
    },
    {
      name: "read_existing_background",
      description: "读取当前项目已有的背景知识，如无则返回空字符串。",
      schema: z.object({}),
    },
  );

  const backend = new ResumeProjectBackend(
    ctx,
    request.project.path,
    request.sensitiveRules ?? [],
    run.toolPermissionMode,
  );
  await backend.initialize();

  const batchReadFiles = tool(
    async (input) => {
      return backend.readMany(input.paths, input.offset ?? 0, input.limit ?? 500);
    },
    {
      name: "batch_read_files",
      description: "批量读取多个项目文件。优先使用它代替连续多次 read_file，以减少工具调用轮次。",
      schema: z.object({
        paths: z.array(z.string()).min(1).max(20),
        offset: z.number().optional(),
        limit: z.number().optional(),
      }),
    },
  );

  const agent = createDeepAgent({
    name: "codeshelf-resume-agent",
    model: createChatModel(request.provider),
    backend,
    tools: [finalizeAll, existingBackground, batchReadFiles],
    systemPrompt: buildSystemPrompt(request, prompt.backgroundPrompt),
  });

  try {
    const modelTrace = new ModelTraceCallback();
    let contextArtifactsCaptured = false;
    const stream = await agent.streamEvents(
      { messages: [{ role: "user", content: buildUserPrompt(request) }] },
      { version: "v3", signal, recursionLimit: 160, callbacks: [modelTrace] } as never,
    );

    const modelEventPromise = (async () => {
      let index = 0;
      for await (const message of stream.messages) {
        index += 1;
        const started = nowIso();
        const [text, reasoning, toolCalls, usage, rawEvents, assembledMessage] = await Promise.all([
          collectText(message.text),
          collectText(message.reasoning as AsyncIterable<string>),
          collectArray(message.toolCalls as AsyncIterable<unknown>),
          Promise.resolve(message.usage as PromiseLike<unknown>).catch((err) => ({ error: err instanceof Error ? err.message : String(err) })),
          collectArray(message as AsyncIterable<unknown>),
          Promise.resolve(message.output as PromiseLike<unknown>).catch((err) => ({ error: err instanceof Error ? err.message : String(err) })),
        ]);
        const traceRecord = await modelTrace.waitFor(index, 500);
        const finished = nowIso();
        const exchange = extractModelExchange({
          traceRecord,
          assembledMessage,
          streamText: text,
          streamReasoning: reasoning,
          streamToolCalls: toolCalls,
          streamUsage: usage,
        });
        if (!contextArtifactsCaptured) {
          const context = await buildContextArtifacts(ctx, traceRecord);
          const contextArtifacts = context.artifacts;
          if (contextArtifacts.length > 0) {
            contextArtifactsCaptured = true;
            await ctx.event({
              type: "system",
              status: "success",
              title: "agent_context",
              data: {
                promptMessages: exchange.promptMessageCount,
                toolCount: exchange.availableToolCount,
                tools: context.tools,
              },
              artifacts: contextArtifacts,
            });
          }
        }
        const rawJson = {
          request: traceRecord?.request ?? null,
          response: traceRecord?.response ?? null,
          assembledMessage,
          stream: {
            text,
            reasoning,
            toolCalls,
            usage,
            rawEvents,
          },
        };
        const artifacts = [
          await ctx.artifact(`model-${index}.raw.json`, "Raw JSON", "llm_raw_json", jsonArtifact(rawJson)),
        ];
        await ctx.event({
          type: "model_call",
          status: "success",
          title: `model_call #${index}`,
          startedAt: started,
          finishedAt: finished,
          durationMs: durationMs(started, finished),
          turnIndex: index,
          modelProvider: request.provider.name,
          modelName: model.model,
          thinkingEnabled: thinkingEnabled(request.provider),
          temperature: 0.2,
          returnedChars: [...exchange.text].length,
          data: {
            modelRunId: traceRecord?.runId,
            parentRunId: traceRecord?.request.parentRunId,
            langgraphStep: exchange.langgraphStep,
            langgraphNode: exchange.langgraphNode,
            finishReason: exchange.finishReason,
            messageId: exchange.messageId,
            text: limitForEvent(exchange.text),
            textChars: [...exchange.text].length,
            reasoning: limitForEvent(exchange.reasoning),
            reasoningChars: [...exchange.reasoning].length,
            toolCallCount: exchange.toolCalls.length,
            toolCalls: exchange.toolCalls,
            usage: exchange.usage,
            tokens: exchange.tokens,
          },
          artifacts,
        });
      }
    })();

    const toolDrainPromise = (async () => {
      for await (const call of stream.toolCalls) {
        if (LOGGED_TOOL_NAMES.has(call.name)) {
          await settleToolCall(call);
          continue;
        }
        const startedAt = nowIso();
        const result = await settleToolCall(call);
        const finishedAt = nowIso();
        const artifacts = [
          await ctx.artifact(`${call.name}.stream-arguments.json`, "Arguments", "tool_arguments", jsonArtifact(call.input)),
          await ctx.artifact(`${call.name}.stream-result.json`, "Result", "tool_result", jsonArtifact(result)),
        ];
        await ctx.event({
          type: "tool_call",
          status: result.status === "error" ? "error" : "success",
          title: call.name,
          startedAt,
          finishedAt,
          durationMs: durationMs(startedAt, finishedAt),
          toolName: call.name,
          error: result.error,
          data: {
            input: {
              argsPreview: summarizeToolArgs(call.input),
              todos: extractTodos(call.input),
            },
            outputPreview: limitForEvent(jsonArtifact(result.output ?? result.error ?? result.status), 800),
          },
          artifacts,
        });
      }
    })();

    const streamOutput = await Promise.all([stream.output, modelEventPromise, toolDrainPromise]).then(([output]) => output);
    if (!finalized.value) {
      finalized.value = await runFinalizeFallback(ctx, request, streamOutput);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failRun(ctx, message);
    throw err;
  }

  const finalOutput = finalized.value;
  if (!finalOutput) {
    const message = "Deep Agent finished without calling finalize_all";
    await failRun(ctx, message);
    throw new Error(message);
  }

  const now = nowIso();
  const resume: ResumeV2 = {
    id: newId("resume"),
    createdAt: now,
    updatedAt: now,
    jobDirection: request.jobDirection,
    jdKeywords: request.jdKeywords,
    tone: request.tone,
    summary: finalOutput.summary,
    skills: finalOutput.skills ?? [],
    experiences: [],
    isSaved: false,
  };
  await saveFinalOutput(request.dataDir, request.project.id, finalOutput, resume);
  await ctx.updateRun((current) => ({
    ...current,
    status: "success",
    finishedAt: now,
    durationMs: durationMs(current.startedAt, now),
    output: {
      backgroundChars: [...finalOutput.background].length,
      resume,
    },
  }));

  return { background: finalOutput.background, resume, run: ctx.run };
}

class ModelTraceCallback extends BaseCallbackHandler {
  name = "CodeshelfModelTraceCallback";
  private sequence = 0;
  private readonly records: ModelTraceRecord[] = [];
  private readonly waiters = new Set<() => void>();

  handleChatModelStart(
    llm: unknown,
    messages: unknown,
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
  ): void {
    this.sequence += 1;
    this.records.push({
      index: this.sequence,
      runId,
      status: "running",
      startedAt: nowIso(),
      request: {
        runId,
        parentRunId,
        runName,
        tags,
        metadata,
        llm,
        messages,
        extraParams,
      },
    });
    this.notify();
  }

  handleLLMEnd(output: unknown, runId: string): void {
    const record = this.records.find((item) => item.runId === runId);
    if (!record) return;
    record.status = "success";
    record.finishedAt = nowIso();
    record.response = output;
    this.notify();
  }

  handleLLMError(err: unknown, runId: string): void {
    const record = this.records.find((item) => item.runId === runId);
    if (!record) return;
    record.status = "error";
    record.finishedAt = nowIso();
    record.error = err instanceof Error ? err.message : String(err);
    this.notify();
  }

  async waitFor(index: number, timeoutMs: number): Promise<ModelTraceRecord | undefined> {
    const existing = this.records.find((item) => item.index === index && item.status !== "running");
    if (existing) return existing;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        let wrapped: () => void;
        const timer = setTimeout(() => {
          this.waiters.delete(wrapped);
          resolve();
        }, Math.min(50, deadline - Date.now()));
        wrapped = () => {
          clearTimeout(timer);
          this.waiters.delete(wrapped);
          resolve();
        };
        this.waiters.add(wrapped);
      });
      const next = this.records.find((item) => item.index === index && item.status !== "running");
      if (next) return next;
    }
    return this.records.find((item) => item.index === index);
  }

  private notify(): void {
    for (const waiter of [...this.waiters]) waiter();
  }
}

interface ModelTraceRecord {
  index: number;
  runId: string;
  status: "running" | "success" | "error";
  startedAt: string;
  finishedAt?: string;
  request: Record<string, unknown>;
  response?: unknown;
  error?: string;
}

function normalizeFinalOutput(parsed: FinalizeSchemaOutput, request: RunAgentRequest): FinalizeAllInput {
  return {
    background: parsed.background,
  };
}

async function runFinalizeFallback(
  ctx: RunContext,
  request: RunAgentRequest,
  streamOutput: unknown,
): Promise<FinalizeAllInput | undefined> {
  const startedAt = nowIso();
  const prompt = buildFinalizeFallbackPrompt(request, ctx.run, streamOutput);
  const model = createChatModel(request.provider);
  const response = await model.invoke([
    {
      role: "system",
      content: [
        "你是 CodeShelf 的项目背景知识收敛器。",
        "上游 Deep Agent 已完成调查但没有调用 finalize_all。",
        "你必须只输出一个 JSON 对象，不要输出 Markdown，不要解释。",
        "JSON 必须只包含 background。",
        "不要编造没有证据的信息；证据不足时用保守描述。",
      ].join("\n"),
    },
    { role: "user", content: prompt },
  ] as never);
  const finishedAt = nowIso();
  const responseText = extractMessageText(response);
  const rawArtifact = await ctx.artifact(
    "finalize-fallback.raw.json",
    "Raw JSON",
    "llm_raw_json",
    jsonArtifact({ request: { prompt }, response }),
  );
  try {
    const parsed = finalizeSchema.parse(parseJsonObject(responseText));
    const output = normalizeFinalOutput(parsed, request);
    const payloadArtifact = await ctx.artifact(
      "finalize-fallback.payload.json",
      "Finalize Payload",
      "finalize_payload",
      jsonArtifact(output),
    );
    const usage = extractUsageFromMessage(response);
    await ctx.event({
      type: "model_call",
      status: "success",
      title: "finalize_fallback",
      startedAt,
      finishedAt,
      durationMs: durationMs(startedAt, finishedAt),
      modelProvider: request.provider.name,
      modelName: pickModel(request.provider).model,
      thinkingEnabled: thinkingEnabled(request.provider),
      returnedChars: [...responseText].length,
      data: {
        finishReason: "fallback_finalize",
        text: limitForEvent(responseText),
        textChars: [...responseText].length,
        usage,
        tokens: normalizeTokenSummary(usage),
      },
      artifacts: [rawArtifact],
    });
    await ctx.event({
      type: "finalize",
      status: "success",
      title: "finalize_fallback",
      artifacts: [payloadArtifact],
      returnedChars: payloadArtifact.chars,
      data: { source: "fallback" },
    });
    return output;
  } catch (err) {
    await ctx.event({
      type: "error",
      status: "error",
      title: "finalize_fallback_failed",
      error: err instanceof Error ? err.message : String(err),
      artifacts: [rawArtifact],
    });
    return undefined;
  }
}

function buildFinalizeFallbackPrompt(
  request: RunAgentRequest,
  run: AgentRunRecord,
  streamOutput: unknown,
): string {
  return [
    "请基于以下 Deep Agent 运行状态生成最终产物。",
    "",
    "项目:",
    jsonArtifact({
      id: request.project.id,
      name: request.project.name,
      path: request.project.path,
      tags: request.project.tags,
      labels: request.project.labels,
      jobDirection: request.jobDirection,
      jdKeywords: request.jdKeywords,
      tone: request.tone,
    }),
    "",
    "目标 JSON Schema:",
    jsonArtifact({
      background: "string, markdown content",
    }),
    "",
    "运行事件摘要:",
    jsonArtifact(buildFallbackEventSummary(run)),
    "",
    "最终 Agent 状态，可能包含工具返回和上下文消息:",
    limitForEvent(jsonArtifact(streamOutput), 160_000),
  ].join("\n");
}

function buildFallbackEventSummary(run: AgentRunRecord): unknown {
  return run.events.map((event) => ({
    type: event.type,
    status: event.status,
    title: event.title,
    toolName: event.toolName,
    durationMs: event.durationMs,
    error: event.error,
    data: event.type === "model_call"
      ? {
          text: limitForEvent(typeof event.data?.text === "string" ? event.data.text : "", 500),
          reasoning: limitForEvent(typeof event.data?.reasoning === "string" ? event.data.reasoning : "", 500),
          toolCalls: event.data?.toolCalls,
        }
      : event.data,
  }));
}

function extractUsageFromMessage(message: unknown): unknown {
  const safe = asObject(toJsonSafe(message));
  const kwargs = asObject(safe?.kwargs);
  const responseMetadata = asObject(kwargs?.response_metadata);
  return firstDefined(
    kwargs?.usage_metadata,
    responseMetadata?.usage,
    responseMetadata?.tokenUsage,
  );
}

function extractMessageText(message: unknown): string {
  const safe = asObject(toJsonSafe(message));
  const kwargs = asObject(safe?.kwargs);
  return firstNonEmptyString(
    contentToText(kwargs?.content),
    typeof safe?.content === "string" ? safe.content : "",
  );
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("fallback response is not JSON");
    return JSON.parse(match[0]);
  }
}

interface ModelExchangeInput {
  traceRecord?: ModelTraceRecord;
  assembledMessage: unknown;
  streamText: string;
  streamReasoning: string;
  streamToolCalls: unknown[];
  streamUsage: unknown;
}

interface TokenSummary {
  input?: number;
  output?: number;
  total?: number;
  cacheRead?: number;
  reasoning?: number;
}

interface ModelToolCallSummary {
  id?: string;
  name: string;
  argsPreview?: string;
  todos?: Array<{ content?: string; status?: string }>;
  rawArgumentsChars?: number;
}

function extractModelExchange(input: ModelExchangeInput): {
  text: string;
  reasoning: string;
  finishReason?: string;
  messageId?: string;
  usage: unknown;
  tokens: TokenSummary;
  toolCalls: ModelToolCallSummary[];
  langgraphStep?: unknown;
  langgraphNode?: unknown;
  promptMessageCount: number;
  availableToolCount: number;
} {
  const safeTrace = asObject(toJsonSafe(input.traceRecord));
  const safeAssembled = asObject(toJsonSafe(input.assembledMessage));
  const generation = asObject(getPath(safeTrace, ["response", "generations", 0, 0]));
  const generationMessage = asObject(getPath(generation, ["message"]));
  const generationKwargs = asObject(getPath(generationMessage, ["kwargs"]));
  const assembledKwargs = asObject(getPath(safeAssembled, ["kwargs"]));
  const responseMetadata = asObject(generationKwargs?.response_metadata) ?? asObject(assembledKwargs?.response_metadata);
  const additionalKwargs = asObject(generationKwargs?.additional_kwargs) ?? asObject(assembledKwargs?.additional_kwargs);

  const text = firstNonEmptyString(
    input.streamText,
    contentToText(generationKwargs?.content),
    contentToText(assembledKwargs?.content),
    typeof generation?.text === "string" ? generation.text : "",
  );
  const reasoning = firstNonEmptyString(
    input.streamReasoning,
    typeof additionalKwargs?.reasoning_content === "string" ? additionalKwargs.reasoning_content : "",
  );
  const usage = firstDefined(
    input.streamUsage,
    generationKwargs?.usage_metadata,
    assembledKwargs?.usage_metadata,
    responseMetadata?.usage,
    responseMetadata?.tokenUsage,
    getPath(safeTrace, ["response", "llmOutput", "tokenUsage"]),
  );
  const toolCalls = normalizeToolCalls(
    input.streamToolCalls,
    generationKwargs?.tool_calls,
    additionalKwargs?.tool_calls,
    assembledKwargs?.tool_calls,
  );
  const requestMetadata = asObject(getPath(safeTrace, ["request", "metadata"]));
  const requestMessages = getPath(safeTrace, ["request", "messages"]);
  const availableTools = getPath(safeTrace, ["request", "extraParams", "options", "tools"]);

  return {
    text,
    reasoning,
    finishReason: firstNonEmptyString(
      typeof getPath(generation, ["generationInfo", "finish_reason"]) === "string" ? String(getPath(generation, ["generationInfo", "finish_reason"])) : "",
      typeof responseMetadata?.finish_reason === "string" ? responseMetadata.finish_reason : "",
    ) || undefined,
    messageId: typeof generationKwargs?.id === "string" ? generationKwargs.id : undefined,
    usage,
    tokens: normalizeTokenSummary(usage),
    toolCalls,
    langgraphStep: requestMetadata?.langgraph_step,
    langgraphNode: requestMetadata?.langgraph_node,
    promptMessageCount: Array.isArray(requestMessages) ? requestMessages.length : 0,
    availableToolCount: Array.isArray(availableTools) ? availableTools.length : 0,
  };
}

async function buildContextArtifacts(
  ctx: RunContext,
  traceRecord?: ModelTraceRecord,
): Promise<{ artifacts: ArtifactRef[]; tools: Array<{ name: string; description: string }> }> {
  const safeTrace = asObject(toJsonSafe(traceRecord));
  const request = asObject(safeTrace?.request);
  if (!request) return { artifacts: [], tools: [] };
  const messages = request.messages;
  const tools = getPath(request, ["extraParams", "options", "tools"]);
  const artifacts: ArtifactRef[] = [];
  if (messages) {
    artifacts.push(await ctx.artifact(
      "agent-runtime-prompt.txt",
      "运行时提示词",
      "llm_full_prompt",
      formatRuntimePrompt(messages),
    ));
  }
  if (tools) {
    artifacts.push(await ctx.artifact(
      "agent-tools.json",
      "工具清单",
      "llm_tools_manifest",
      jsonArtifact({ tools }),
    ));
  }
  return { artifacts, tools: summarizeRuntimeTools(tools) };
}

function summarizeRuntimeTools(tools: unknown): Array<{ name: string; description: string }> {
  if (!Array.isArray(tools)) return [];
  const result: Array<{ name: string; description: string }> = [];
  for (const item of tools) {
    const object = asObject(item);
    const fn = asObject(object?.function);
    const name = typeof fn?.name === "string" ? fn.name : "";
    if (!name) continue;
    result.push({
      name,
      description: typeof fn?.description === "string" ? fn.description : "",
    });
  }
  return result;
}

function formatRuntimePrompt(messages: unknown): string {
  const safe = toJsonSafe(messages);
  const groups = Array.isArray(safe) ? safe : [safe];
  const sections: string[] = [];
  let index = 0;
  for (const group of groups) {
    const items = Array.isArray(group) ? group : [group];
    for (const item of items) {
      index += 1;
      const object = asObject(item);
      const kwargs = asObject(object?.kwargs);
      const type = typeof kwargs?.type === "string"
        ? kwargs.type
        : typeof object?.type === "string"
          ? object.type
          : `message_${index}`;
      const content = firstNonEmptyString(
        contentToText(kwargs?.content),
        contentToText(getPath(kwargs, ["lc_kwargs", "content"])),
        contentToText(object?.content),
      );
      sections.push([
        `## ${index}. ${type}`,
        "",
        content || jsonArtifact(item),
      ].join("\n"));
    }
  }
  return sections.join("\n\n---\n\n");
}

function normalizeToolCalls(...sources: unknown[]): ModelToolCallSummary[] {
  const result: ModelToolCallSummary[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const items = Array.isArray(source) ? source : [];
    for (const item of items) {
      const object = asObject(item);
      if (!object) continue;
      const fn = asObject(object.function);
      const name = firstNonEmptyString(
        typeof object.name === "string" ? object.name : "",
        typeof fn?.name === "string" ? fn.name : "",
      );
      if (!name) continue;
      const id = typeof object.id === "string" ? object.id : undefined;
      const rawArgs = firstDefined(object.args, fn?.arguments, object.input);
      const parsedArgs = parseJsonIfString(rawArgs);
      const preview = summarizeToolArgs(parsedArgs);
      const key = `${id ?? name}:${preview}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        id,
        name,
        argsPreview: preview,
        todos: extractTodos(parsedArgs),
        rawArgumentsChars: typeof rawArgs === "string" ? [...rawArgs].length : undefined,
      });
    }
  }
  return result;
}

function extractTodos(value: unknown): Array<{ content?: string; status?: string }> | undefined {
  const object = asObject(value);
  if (!Array.isArray(object?.todos)) return undefined;
  const result: Array<{ content?: string; status?: string }> = [];
  for (const item of object.todos) {
    const todo = asObject(item);
    if (!todo) continue;
    result.push({
      content: typeof todo.content === "string" ? todo.content : undefined,
      status: typeof todo.status === "string" ? todo.status : undefined,
    });
  }
  return result;
}

function summarizeToolArgs(value: unknown): string {
  const object = asObject(value);
  const todos = extractTodos(value);
  if (todos?.length) {
    return `${todos.length} todos: ${todos.slice(0, 3).map((todo) => todo.content).filter(Boolean).join(" / ")}`;
  }
  if (object && Array.isArray(object.paths)) {
    return `paths: ${object.paths.slice(0, 5).join(", ")}${object.paths.length > 5 ? " ..." : ""}`;
  }
  if (object && typeof object.file_path === "string") return object.file_path;
  if (object && typeof object.path === "string") return object.path;
  if (object && typeof object.pattern === "string") return object.pattern;
  if (object && typeof object.command === "string") return object.command;
  return limitForEvent(jsonArtifact(value), 240);
}

function normalizeTokenSummary(usage: unknown): TokenSummary {
  return {
    input: firstNumber(
      getPath(usage, ["input_tokens"]),
      getPath(usage, ["prompt_tokens"]),
      getPath(usage, ["promptTokens"]),
    ),
    output: firstNumber(
      getPath(usage, ["output_tokens"]),
      getPath(usage, ["completion_tokens"]),
      getPath(usage, ["completionTokens"]),
    ),
    total: firstNumber(
      getPath(usage, ["total_tokens"]),
      getPath(usage, ["totalTokens"]),
    ),
    cacheRead: firstNumber(
      getPath(usage, ["input_token_details", "cache_read"]),
      getPath(usage, ["prompt_tokens_details", "cached_tokens"]),
      getPath(usage, ["prompt_cache_hit_tokens"]),
    ),
    reasoning: firstNumber(
      getPath(usage, ["output_token_details", "reasoning"]),
      getPath(usage, ["completion_tokens_details", "reasoning_tokens"]),
    ),
  };
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

function parseJsonIfString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function limitForEvent(text: string, maxChars = 1200): string {
  if ([...text].length <= maxChars) return text;
  return `${[...text].slice(0, maxChars).join("")}\n[truncated]`;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function firstNonEmptyString(...values: string[]): string {
  return values.find((value) => value.trim().length > 0) ?? "";
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function getPath(value: unknown, path: Array<string | number>): unknown {
  let current = value;
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[key];
    } else {
      const object = asObject(current);
      if (!object) return undefined;
      current = object[key];
    }
  }
  return current;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

async function collectText(iterable: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const token of iterable) text += token;
  return text;
}

async function collectArray<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iterable) result.push(item);
  return result;
}

async function settleToolCall(call: {
  name: string;
  input: unknown;
  output: Promise<unknown>;
  status: Promise<string>;
  error: Promise<string | undefined>;
}): Promise<{ status: string; output?: unknown; error?: string }> {
  const [status, error, output] = await Promise.all([
    call.status.catch((err) => `error: ${err instanceof Error ? err.message : String(err)}`),
    call.error.catch((err) => err instanceof Error ? err.message : String(err)),
    call.output
      .then((value) => ({ ok: true as const, value }))
      .catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) })),
  ]);
  if (!output.ok) return { status: "error", error: output.error };
  return {
    status: status === "error" ? "error" : "success",
    output: output.value,
    error: typeof error === "string" ? error : undefined,
  };
}

async function failRun(ctx: RunContext, message: string): Promise<void> {
  await ctx.event({ type: "error", status: "error", title: "run_failed", error: message });
  const finishedAt = nowIso();
  await ctx.updateRun((run) => ({
    ...run,
    status: "error",
    finishedAt,
    durationMs: durationMs(run.startedAt, finishedAt),
    error: { message },
  }));
}

function buildSystemPrompt(request: RunAgentRequest, backgroundPrompt: string): string {
  return [
    backgroundPrompt,
    "",
    "工具权限:",
    `- 当前 toolPermissionMode=${request.toolPermissionMode ?? "read_only"}`,
    "- 优先使用 ls/glob/grep/read_file/batch_read_files 调查项目。",
    "- 需要读取多个文件时，优先一次调用 batch_read_files，不要连续逐个调用 read_file。",
    "- execute 只在 toolPermissionMode=full_agent 时可用，且**不经过 shell**：只能跑 git（log/shortlog/status/show/diff/ls-files/rev-list/rev-parse/describe/branch/tag/blame/count-objects）、wc、cloc；",
    "  管道、重定向、`&&`、`$()`、引号一律被拒绝，一次只能跑一条命令。需要组合结果时分多次调用。",
    "- 不调用 write_file/edit_file 修改项目文件。",
    "- 证据覆盖技术栈、核心模块、入口和关键实现后，调用 finalize_all。",
  ].join("\n");
}

function buildUserPrompt(request: RunAgentRequest): string {
  return [
    `项目名称: ${request.project.name}`,
    `项目路径: ${request.project.path}`,
    `项目标签: ${[...request.project.tags, ...request.project.labels].join(", ") || "无"}`,
    `求职方向: ${request.jobDirection}`,
    `JD 关键词: ${request.jdKeywords.join(", ") || "无"}`,
    `语气: ${request.tone}`,
    "",
    "请自主调查这个项目，生成 background.md。完成后调用 finalize_all。",
  ].join("\n");
}
