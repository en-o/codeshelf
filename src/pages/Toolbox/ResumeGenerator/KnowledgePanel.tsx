import { useEffect, useMemo, useState } from "react";
import { Bot, FileText } from "lucide-react";

import type { AiProviderConfig, Project } from "@/types";
import type { ProjectKnowledge } from "@/types/resume";
import { showToast } from "@/components/ui";
import { EmptyState } from "@/components/common";
import { useResumeStore } from "@/stores/resumeStore";
import { runKnowledgeAgent } from "@/services/resume/agents/knowledgeAgent";
import {
  deleteResumeKnowledgeRuns,
  getResumeKnowledgePromptConfig,
  getResumeKnowledgeRuns,
  readResumeKnowledgeRunArtifact,
  type AgentRunRecord,
  type AgentRunState,
  type ArtifactRef,
  type ResumeAgentPromptConfig,
} from "@/services/resume/knowledgeStore";
import {
  summarizeRun,
  generateRequestId,
  formatRuntimePromptFromRawJson,
  type KnowledgeView,
  type RunDetailView,
} from "./knowledgePanelHelpers";
import {
  PanelHeader,
  ProjectRail,
  BackgroundView,
  RunProcessView,
  ArtifactModal,
} from "./knowledgeRunView";

interface KnowledgePanelProps {
  selectedProjects: Project[];
  provider: AiProviderConfig | null;
  promptConfigVersion?: number;
  onNext?: () => void;
}

export function KnowledgePanel({ selectedProjects, provider, promptConfigVersion = 0, onNext }: KnowledgePanelProps) {
  const {
    knowledgeDocs,
    upsertKnowledge,
    removeKnowledge,
    knowledgeRuns,
    startKnowledgeRun,
    setKnowledgeRunSnapshot,
    finishKnowledgeRun,
    clearKnowledgeRun,
  } = useResumeStore();
  const [activeProjectId, setActiveProjectId] = useState(selectedProjects[0]?.id ?? "");
  const [activeView, setActiveView] = useState<KnowledgeView>("background");
  const [runState, setRunState] = useState<AgentRunState | null>(null);
  const [runDetailView, setRunDetailView] = useState<RunDetailView>("overview");
  const [promptConfig, setPromptConfig] = useState<ResumeAgentPromptConfig | null>(null);
  const [artifactContent, setArtifactContent] = useState<Record<string, string>>({});
  const [activeArtifact, setActiveArtifact] = useState<{ artifact: ArtifactRef; content: string } | null>(null);
  const [artifactLoadingId, setArtifactLoadingId] = useState<string | null>(null);
  // 命令执行授权：默认关闭，且每次生成后自动复位 —— 授权是按次的，不做持久化。
  // 仓库内容里的提示注入不该顺手拿到命令执行能力。
  const [allowCommands, setAllowCommands] = useState(false);

  const activeProject = selectedProjects.find((item) => item.id === activeProjectId) ?? selectedProjects[0] ?? null;
  const activeDoc = activeProject ? knowledgeDocs[activeProject.id] : undefined;
  const liveRun = activeProject ? knowledgeRuns[activeProject.id]?.run : undefined;
  const running = activeProject ? knowledgeRuns[activeProject.id]?.status === "running" : false;
  const storedRun = runState?.current?.projectId === activeProject?.id ? runState.current : null;
  const selectedRun = liveRun ?? storedRun;
  const stats = useMemo(() => summarizeRun(selectedRun), [selectedRun]);
  const showProjectRail = selectedProjects.length > 1;
  // 强约束：所有已选项目都生成了背景知识，才允许进入「生成简历」。
  const completedCount = selectedProjects.filter((p) => !!knowledgeDocs[p.id]).length;
  const allBackgroundsReady = selectedProjects.length > 0 && completedCount === selectedProjects.length;

  useEffect(() => {
    if (!selectedProjects.find((item) => item.id === activeProjectId)) {
      setActiveProjectId(selectedProjects[0]?.id ?? "");
    }
  }, [selectedProjects, activeProjectId]);

  useEffect(() => {
    void getResumeKnowledgePromptConfig()
      .then(setPromptConfig)
      .catch((err) => showToast("error", `读取提示词失败: ${err instanceof Error ? err.message : String(err)}`));
  }, [promptConfigVersion]);

  useEffect(() => {
    setRunState(null);
    setArtifactContent({});
    setActiveArtifact(null);
    if (!activeProject) return;
    void refreshRuns(activeProject.id);
  }, [activeProject?.id]);

  async function refreshRuns(projectId: string) {
    try {
      setRunState(await getResumeKnowledgeRuns(projectId));
    } catch (err) {
      showToast("error", `读取生成记录失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleGenerate(project: Project) {
    if (!provider) {
      showToast("warning", "请先配置默认 AI 供应商");
      return;
    }
    await deleteResumeKnowledgeRuns(project.id).catch(() => undefined);
    clearKnowledgeRun(project.id);
    setRunState(null);
    setArtifactContent({});
    setActiveArtifact(null);
    const requestId = generateRequestId();
    setActiveProjectId(project.id);
    setActiveView("runs");
    startKnowledgeRun(project.id, requestId);
    try {
      const result = await runKnowledgeAgent({
        requestId,
        projectId: project.id,
        provider,
        promptConfig: promptConfig ?? undefined,
        allowReadOnlyCommands: allowCommands,
        onRun: (run) => setKnowledgeRunSnapshot(project.id, run),
      });
      const doc: ProjectKnowledge = {
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        content: result.background,
        updatedAt: new Date().toISOString(),
        userEdited: false,
      };
      await upsertKnowledge(doc, false);
      finishKnowledgeRun(project.id);
      await refreshRuns(project.id);
      showToast("success", `${project.name} 已生成`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      finishKnowledgeRun(project.id, msg);
      await refreshRuns(project.id);
      showToast("error", `${project.name} 生成失败: ${msg}`);
    } finally {
      // 授权按次生效，跑完就收回
      setAllowCommands(false);
    }
  }

  async function handleDelete(projectId: string) {
    clearKnowledgeRun(projectId);
    setRunState(null);
    setArtifactContent({});
    setActiveArtifact(null);
    await removeKnowledge(projectId);
  }

  async function openArtifact(run: AgentRunRecord, artifact: ArtifactRef) {
    const cached = artifactContent[artifact.id];
    setActiveArtifact({ artifact, content: cached ?? "" });
    if (cached) return;
    setArtifactLoadingId(artifact.id);
    try {
      const result = await readResumeKnowledgeRunArtifact(run.projectId, artifact.id);
      setArtifactContent((prev) => ({ ...prev, [artifact.id]: result.content }));
      setActiveArtifact((current) => current?.artifact.id === artifact.id
        ? { artifact, content: result.content }
        : current);
    } catch (err) {
      showToast("error", `读取原始内容失败: ${err instanceof Error ? err.message : String(err)}`);
      setActiveArtifact(null);
    } finally {
      setArtifactLoadingId(null);
    }
  }

  async function openRuntimePrompt(run: AgentRunRecord, promptArtifact?: ArtifactRef, rawArtifact?: ArtifactRef) {
    if (promptArtifact) {
      await openArtifact(run, promptArtifact);
      return;
    }
    if (!rawArtifact) {
      showToast("warning", "当前记录未包含运行时提示词，请重新生成一次");
      return;
    }
    const cached = artifactContent[rawArtifact.id];
    const syntheticId = `runtime-prompt-${rawArtifact.id}`;
    setArtifactLoadingId(syntheticId);
    setActiveArtifact({
      artifact: {
        id: syntheticId,
        label: "运行时提示词",
        kind: "llm_full_prompt_fallback",
        chars: 0,
      },
      content: "",
    });
    try {
      const rawContent = cached ?? (await readResumeKnowledgeRunArtifact(run.projectId, rawArtifact.id)).content;
      if (!cached) setArtifactContent((prev) => ({ ...prev, [rawArtifact.id]: rawContent }));
      const promptContent = formatRuntimePromptFromRawJson(rawContent);
      setActiveArtifact({
        artifact: {
          id: syntheticId,
          label: "运行时提示词",
          kind: "llm_full_prompt_fallback",
          chars: [...promptContent].length,
        },
        content: promptContent,
      });
    } catch (err) {
      showToast("error", `读取运行时提示词失败: ${err instanceof Error ? err.message : String(err)}`);
      setActiveArtifact(null);
    } finally {
      setArtifactLoadingId(null);
    }
  }

  if (selectedProjects.length === 0) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <EmptyState icon={FileText} title="未选择项目" description="请先选择需要生成简历材料的项目。" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-white">
      <div className="h-full overflow-hidden px-6 pb-5">
        <div className={`mx-auto grid h-full min-h-0 grid-rows-1 max-w-6xl gap-4 ${showProjectRail ? "grid-cols-[260px_minmax(0,1fr)]" : "grid-cols-1"}`}>
          {showProjectRail && (
            <ProjectRail
              projects={selectedProjects}
              activeProjectId={activeProject?.id ?? ""}
              knowledgeDocs={knowledgeDocs}
              knowledgeRuns={knowledgeRuns}
              onSelect={(id) => setActiveProjectId(id)}
            />
          )}

          <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm shadow-emerald-900/5">
            <PanelHeader
              project={activeProject}
              provider={provider}
              running={running}
              activeView={activeView}
              stats={stats}
              canDelete={!!activeProject && !!activeDoc}
              onViewChange={setActiveView}
              onGenerate={() => activeProject && handleGenerate(activeProject)}
              onNext={onNext}
              nextDisabled={!allBackgroundsReady}
              completedCount={completedCount}
              totalCount={selectedProjects.length}
              onDelete={() => activeProject && handleDelete(activeProject.id)}
              onRefresh={() => activeProject && refreshRuns(activeProject.id)}
            />

            <label className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={allowCommands}
                disabled={running}
                onChange={(e) => setAllowCommands(e.target.checked)}
              />
              <span>
                允许本次运行执行只读命令（<code>git log</code> 等白名单命令，不经过 shell）。
                默认关闭；勾选仅对下一次生成生效。
              </span>
            </label>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {activeView === "background" && (
                <BackgroundView activeDoc={activeDoc} />
              )}

              {activeView === "runs" && (
                selectedRun ? (
                  <RunProcessView
                    run={selectedRun}
                    view={runDetailView}
                    onViewChange={setRunDetailView}
                    onOpenArtifact={openArtifact}
                    onOpenRuntimePrompt={openRuntimePrompt}
                  />
                ) : (
                  <EmptyState icon={Bot} title="暂无生成记录" description="开始生成后，会在这里完整记录模型调用和工具调用。" />
                )
              )}

            </div>
          </section>
        </div>
      </div>
      {activeArtifact && (
        <ArtifactModal
          artifact={activeArtifact.artifact}
          content={activeArtifact.content}
          loading={artifactLoadingId === activeArtifact.artifact.id}
          onClose={() => setActiveArtifact(null)}
        />
      )}
    </div>
  );
}
