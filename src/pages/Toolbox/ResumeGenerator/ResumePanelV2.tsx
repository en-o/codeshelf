import { useMemo, useState } from "react";
import { Loader2, Plus, FileText as FileIcon } from "lucide-react";
import type { AiProviderConfig } from "@/types";
import type {
  JobDirection,
  PersonalInfo,
  ProjectKnowledge,
  ResumeV2,
  ResumeProjectExperience,
} from "@/types/resume";
import {
  generateSummaryFragment,
  polishWorkExperienceFragment,
  regenerateProjectExperienceFragment,
} from "@/services/resume/agents/resumeFragments";
import { useResumeStore } from "@/stores/resumeStore";
import {
  exportResumeV2ToDocxWithDialog,
  exportResumeV2ToMarkdownWithDialog,
} from "@/services/resume/export";
import { Button, showToast } from "@/components/ui";
import { EmptyState } from "@/components/common";
import { ResumePreviewDialog } from "./ResumePreview";
import {
  createDraftResume,
  createEmptyProjectExperience,
  generateRequestId,
  uniqueTags,
  EMPTY_JD_KEYWORDS,
  DEFAULT_TONE,
  type RefineTask,
} from "./resumePanelHelpers";
import {
  RefineInstructionDialog,
  AddProjectExperienceDialog,
  GenerateProjectSelectionDialog,
} from "./resumePanelDialogs";
import { ResumeSidebar } from "./resumePanelSidebar";
import {
  GlobalProfileEditor,
  CoreSkillsEditor,
  SectionCard,
  ExperienceCard,
} from "./resumePanelEditors";

interface ResumePanelV2Props {
  knowledgeDocs: ProjectKnowledge[];
  provider: AiProviderConfig | null;
  jobDirection: JobDirection;
  onJobDirectionChange: (d: JobDirection) => void;
  resume: ResumeV2 | null;
  personalInfo: PersonalInfo;
  onResumeChange: (r: ResumeV2 | null) => void;
  onPersonalInfoChange: (info: PersonalInfo) => void;
  onSaveResume: (r: ResumeV2) => Promise<void>;
}

export function ResumePanelV2({
  knowledgeDocs,
  provider,
  jobDirection,
  onJobDirectionChange,
  resume,
  personalInfo,
  onResumeChange,
  onPersonalInfoChange,
  onSaveResume,
}: ResumePanelV2Props) {
  const {
    resumeRun,
    startResumeRun,
    appendResumeStep,
    finishResumeRun,
    knowledgeDocs: allKnowledgeDocMap,
  } = useResumeStore();
  const running = resumeRun?.status === "running";
  const [previewOpen, setPreviewOpen] = useState(false);
  const [refineTask, setRefineTask] = useState<RefineTask | null>(null);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [refineRunning, setRefineRunning] = useState(false);
  const [docxExporting, setDocxExporting] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addSelectedProjectIds, setAddSelectedProjectIds] = useState<string[]>([]);
  const [addRunning, setAddRunning] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [generateSelectedProjectIds, setGenerateSelectedProjectIds] = useState<string[]>([]);

  // 生成 / 润色 / 新增 任一在进行时，禁用其它所有简历操作按钮，避免并发 AI 调用相互覆盖。
  const busy = running || refineRunning || addRunning;

  const allKnowledgeDocs = useMemo(() => Object.values(allKnowledgeDocMap), [allKnowledgeDocMap]);
  const ready = allKnowledgeDocs.length > 0 && !!provider;
  const knowledgeDocByProjectId = useMemo(() => {
    const map = new Map<string, ProjectKnowledge>();
    allKnowledgeDocs.forEach((doc) => map.set(doc.projectId, doc));
    return map;
  }, [allKnowledgeDocs]);
  const availableKnowledgeDocs = useMemo(() => {
    const used = new Set(resume?.experiences.map((item) => item.projectId) ?? []);
    return allKnowledgeDocs.filter((doc) => !used.has(doc.projectId));
  }, [allKnowledgeDocs, resume]);
  const generatedExperienceProjectIds = useMemo(
    () => new Set(resume?.experiences.map((item) => item.projectId) ?? []),
    [resume]
  );

  const executeGenerate = async (docs: ProjectKnowledge[]) => {
    if (!provider) {
      showToast("warning", "请先配置默认 AI 供应商");
      return;
    }
    if (docs.length === 0) {
      showToast("warning", "请至少选择一份项目背景知识");
      return;
    }
    const requestId = generateRequestId();
    startResumeRun(requestId);
    try {
      const baseResume = resume ?? createDraftResume(jobDirection);
      const selectedProjectIds = new Set(docs.map((doc) => doc.projectId));
      const sourceExperiences = docs.map((doc) =>
        baseResume.experiences.find((item) => item.projectId === doc.projectId)
          ?? createEmptyProjectExperience(doc)
      );
      appendResumeStep({
        kind: "llm_text",
        label: "准备项目经历",
        detail: `${sourceExperiences.length} 个项目`,
        ts: Date.now(),
      });

      const experiences: ResumeProjectExperience[] = [];
      for (const [index, experience] of sourceExperiences.entries()) {
        appendResumeStep({
          kind: "llm_text",
          label: "生成项目经历",
          detail: `${index + 1}/${sourceExperiences.length} ${experience.projectName}`,
          ts: Date.now(),
        });
        const updated = await regenerateProjectExperienceFragment({
          provider,
          jobDirection,
          jdKeywords: EMPTY_JD_KEYWORDS,
          tone: DEFAULT_TONE,
          knowledgeDocs: docs.filter((doc) => doc.projectId === experience.projectId),
          projectId: experience.projectId,
          currentExperience: experience,
          skills: baseResume.skills,
          instruction: "",
        });
        experiences.push(updated);
      }

      const generatedByProjectId = new Map(
        experiences.map((item) => [item.projectId, item] as const)
      );
      const mergedExperiences = baseResume.experiences.map((item) =>
        generatedByProjectId.get(item.projectId) ?? item
      );
      experiences.forEach((item) => {
        if (!baseResume.experiences.some((exp) => exp.projectId === item.projectId)) {
          mergedExperiences.push(item);
        }
      });
      const orderedExperiences = [
        ...mergedExperiences.filter((item) => selectedProjectIds.has(item.projectId)),
        ...mergedExperiences.filter((item) => !selectedProjectIds.has(item.projectId)),
      ];
      const skills = uniqueTags(orderedExperiences.flatMap((item) => item.techStack));
      appendResumeStep({
        kind: "llm_text",
        label: "生成核心技能标签",
        detail: `${skills.length} 个`,
        ts: Date.now(),
      });

      const next: ResumeV2 = {
        ...baseResume,
        jobDirection,
        jdKeywords: EMPTY_JD_KEYWORDS,
        tone: DEFAULT_TONE,
        experiences: orderedExperiences,
        skills,
        updatedAt: new Date().toISOString(),
      };
      onResumeChange(next);

      if (!personalInfo.summary?.trim()) {
        appendResumeStep({
          kind: "llm_text",
          label: "生成个人简介",
          detail: "当前个人简介为空",
          ts: Date.now(),
        });
        const summary = await generateSummaryFragment({
          kind: "summary_generate",
          provider,
          jobDirection,
          jdKeywords: EMPTY_JD_KEYWORDS,
          tone: DEFAULT_TONE,
          knowledgeDocs: docs,
          personalInfo,
          skills,
          instruction: "",
        });
        onPersonalInfoChange({ ...personalInfo, summary });
      } else {
        appendResumeStep({
          kind: "llm_text",
          label: "保留个人简介",
          detail: "已有内容，不自动覆盖",
          ts: Date.now(),
        });
      }

      finishResumeRun();
      showToast("success", "简历生成完成", `已生成 ${experiences.length} 个项目内容`, 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      finishResumeRun(msg);
      showToast("error", `生成失败: ${msg}`);
    }
  };

  const openGenerateDialog = () => {
    const defaults = allKnowledgeDocs
      .filter((doc) => !generatedExperienceProjectIds.has(doc.projectId))
      .map((doc) => doc.projectId);
    setGenerateSelectedProjectIds(defaults);
    setGenerateDialogOpen(true);
  };

  const closeGenerateDialog = () => {
    if (running) return;
    setGenerateDialogOpen(false);
    setGenerateSelectedProjectIds([]);
  };

  const toggleGenerateProject = (projectId: string) => {
    setGenerateSelectedProjectIds((prev) =>
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId]
    );
  };

  const handleGenerateFromSelection = async () => {
    const docs = allKnowledgeDocs.filter((doc) => generateSelectedProjectIds.includes(doc.projectId));
    if (docs.length === 0) return;
    // 先关弹窗再生成：生成过程会持续向主面板流式追加步骤（含 loading 动画），
    // 半透明遮罩长时间盖在不断重绘的背景上会触发 WebView 合成花屏。进度改由主面板呈现。
    setGenerateDialogOpen(false);
    setGenerateSelectedProjectIds([]);
    await executeGenerate(docs);
  };

  const handleUpdateExperience = (updated: ResumeProjectExperience) => {
    if (!resume) return;
    const experiences = resume.experiences.map((e) =>
      e.projectId === updated.projectId ? updated : e
    );
    const next: ResumeV2 = {
      ...resume,
      experiences,
      skills: uniqueTags(experiences.flatMap((item) => item.techStack)),
      updatedAt: new Date().toISOString(),
    };
    onResumeChange(next);
  };

  const handleExportMarkdown = async () => {
    if (!resume) return;
    try {
      const filePath = await exportResumeV2ToMarkdownWithDialog({
        ...resume,
        personalInfo,
      });
      if (filePath) showToast("success", `已导出到 ${filePath}`);
    } catch (err) {
      showToast("error", `导出失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleExportDocx = async () => {
    if (!resume || docxExporting) return;
    setDocxExporting(true);
    try {
      const filePath = await exportResumeV2ToDocxWithDialog({
        ...resume,
        personalInfo,
      });
      if (filePath) showToast("success", `已导出到 ${filePath}`);
    } catch (err) {
      showToast("error", `导出失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDocxExporting(false);
    }
  };

  const handleSave = async () => {
    if (!resume) return;
    try {
      await onSaveResume({ ...resume, personalInfo });
    } catch (err) {
      showToast("error", `保存失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const updateResume = (patch: Partial<ResumeV2>) => {
    if (!resume) return;
    onResumeChange({
      ...resume,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  };

  const openRefineDialog = (task: RefineTask) => {
    setRefineTask(task);
    setRefineInstruction("");
  };

  const closeRefineDialog = () => {
    if (refineRunning) return;
    setRefineTask(null);
    setRefineInstruction("");
  };

  const toggleAddProject = (projectId: string) => {
    setAddSelectedProjectIds((prev) =>
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId]
    );
  };

  const openAddDialog = () => {
    setAddSelectedProjectIds([]);
    setAddDialogOpen(true);
  };

  const closeAddDialog = () => {
    if (addRunning) return;
    setAddDialogOpen(false);
    setAddSelectedProjectIds([]);
  };

  const handleAddExperiences = async () => {
    if (!provider) {
      showToast("warning", "请先配置默认 AI 供应商");
      return;
    }
    if (!resume) {
      showToast("warning", "请先生成一份简历");
      return;
    }
    const docs = availableKnowledgeDocs.filter((doc) => addSelectedProjectIds.includes(doc.projectId));
    if (docs.length === 0) {
      showToast("warning", "请先选择至少一个背景知识项目");
      return;
    }
    setAddRunning(true);
    try {
      const created: ResumeProjectExperience[] = [];
      for (const doc of docs) {
        const generated = await regenerateProjectExperienceFragment({
          provider,
          jobDirection,
          jdKeywords: EMPTY_JD_KEYWORDS,
          tone: DEFAULT_TONE,
          knowledgeDocs: [doc],
          projectId: doc.projectId,
          currentExperience: createEmptyProjectExperience(doc),
          skills: resume.skills,
          instruction: "",
        });
        created.push(generated);
      }
      const nextExperiences = [...resume.experiences, ...created];
      onResumeChange({
        ...resume,
        experiences: nextExperiences,
        skills: uniqueTags(nextExperiences.flatMap((item) => item.techStack)),
        updatedAt: new Date().toISOString(),
      });
      showToast("success", `已新增 ${created.length} 个项目经历`);
      closeAddDialog();
    } catch (err) {
      showToast("error", `新增项目经历失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAddRunning(false);
    }
  };

  const handleConfirmRefine = async () => {
    if (!refineTask) return;
    if (!provider) {
      showToast("warning", "请先配置默认 AI 供应商");
      return;
    }
    const instruction = refineInstruction.trim();
    setRefineRunning(true);
    try {
      if (refineTask.kind === "summary_generate" || refineTask.kind === "summary_polish") {
        const summary = await generateSummaryFragment({
          kind: refineTask.kind,
          provider,
          jobDirection,
          jdKeywords: EMPTY_JD_KEYWORDS,
          tone: DEFAULT_TONE,
          knowledgeDocs,
          personalInfo,
          skills: resume?.skills ?? [],
          instruction,
        });
        onPersonalInfoChange({ ...personalInfo, summary });
        showToast("success", refineTask.kind === "summary_generate" ? "个人简介已生成" : "个人简介已润色");
      } else if (refineTask.kind === "work_polish") {
        const item = personalInfo.workExperiences.find((work) => work.id === refineTask.workId);
        if (!item) throw new Error("工作经历不存在");
        const description = await polishWorkExperienceFragment({
          provider,
          jobDirection,
          jdKeywords: EMPTY_JD_KEYWORDS,
          tone: DEFAULT_TONE,
          knowledgeDocs,
          workExperience: item,
          personalInfo,
          skills: resume?.skills ?? [],
          instruction,
        });
        onPersonalInfoChange({
          ...personalInfo,
          workExperiences: personalInfo.workExperiences.map((work) =>
            work.id === item.id ? { ...work, description } : work
          ),
        });
        showToast("success", "岗位职责已润色");
      } else if (refineTask.kind === "project_regenerate") {
        if (!resume) throw new Error("尚未生成简历");
        const current = resume.experiences.find((exp) => exp.projectId === refineTask.projectId);
        if (!current) throw new Error("项目经历不存在");
        const doc = knowledgeDocByProjectId.get(refineTask.projectId);
        if (!doc) throw new Error("未找到对应的背景知识");
        const updated = await regenerateProjectExperienceFragment({
          provider,
          jobDirection,
          jdKeywords: EMPTY_JD_KEYWORDS,
          tone: DEFAULT_TONE,
          knowledgeDocs: [doc],
          projectId: refineTask.projectId,
          currentExperience: current,
          skills: resume.skills,
          instruction,
        });
        handleUpdateExperience(updated);
        showToast("success", "项目经历已重新生成");
      }
      setRefineTask(null);
      setRefineInstruction("");
    } catch (err) {
      showToast("error", `操作失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRefineRunning(false);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[304px_minmax(0,1fr)]">
      <ResumeSidebar
        ready={ready}
        running={running}
        busy={busy}
        hasResume={!!resume}
        knowledgeCount={allKnowledgeDocs.length}
        jobDirection={jobDirection}
        onJobDirectionChange={onJobDirectionChange}
        onGenerate={openGenerateDialog}
        onPreview={() => setPreviewOpen(true)}
        onSave={handleSave}
        onExportDocx={handleExportDocx}
        onExportMarkdown={handleExportMarkdown}
        docxExporting={docxExporting}
        steps={resumeRun?.steps ?? []}
      />

      <main className="min-w-0 space-y-4">
        <GlobalProfileEditor
          value={personalInfo}
          onChange={onPersonalInfoChange}
          onGenerateSummary={() => openRefineDialog({ kind: "summary_generate" })}
          onPolishSummary={() => openRefineDialog({ kind: "summary_polish" })}
          onPolishWork={(workId) => openRefineDialog({ kind: "work_polish", workId })}
          refineRunning={refineRunning}
          activeRefineTask={refineTask}
          busy={busy}
        />

        {!resume && !running && (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white">
            <EmptyState
              icon={FileIcon}
              title="尚未生成简历"
              description="左侧选择岗位方向后，点击 AI 生成简历"
              className="py-12"
            />
          </div>
        )}

        {running && !resume && (
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-6">
            <div className="flex items-center justify-center gap-2 text-sm text-blue-700">
              <Loader2 size={18} className="animate-spin" />
              模型正在基于背景知识生成简历...
            </div>
          </div>
        )}

        {resume && (
          <>
            <CoreSkillsEditor
              resume={resume}
              onUpdate={(patch) => updateResume(patch)}
              busy={busy}
            />
            <SectionCard
              icon={<FileIcon size={16} />}
              title="项目经历"
              description={`${resume.experiences.length} 个项目，可编辑项目描述、核心职责、项目成果和关键词（技术标签）`}
              action={
                <Button
                  onClick={openAddDialog}
                  variant="secondary"
                  size="sm"
                  className="gap-1"
                  disabled={availableKnowledgeDocs.length === 0 || busy}
                  title={
                    availableKnowledgeDocs.length === 0
                      ? "当前没有可新增的背景知识"
                      : "从已有背景知识新增项目经历"
                  }
                >
                  <Plus size={14} /> 新增项目经历
                </Button>
              }
            >
              <div className="space-y-3">
                {resume.experiences.map((exp) => (
                  <ExperienceCard
                    key={exp.projectId}
                    experience={exp}
                    onUpdate={handleUpdateExperience}
                    onRegenerate={(projectId) => openRefineDialog({ kind: "project_regenerate", projectId })}
                    regenerateRunning={refineRunning && refineTask?.kind === "project_regenerate" && refineTask.projectId === exp.projectId}
                    busy={busy}
                  />
                ))}
              </div>
            </SectionCard>
          </>
        )}
      </main>

      <ResumePreviewDialog
        open={previewOpen}
        resume={resume}
        personalInfo={personalInfo}
        onClose={() => setPreviewOpen(false)}
      />
      <RefineInstructionDialog
        task={refineTask}
        value={refineInstruction}
        running={refineRunning}
        onChange={setRefineInstruction}
        onCancel={closeRefineDialog}
        onConfirm={handleConfirmRefine}
      />
      <AddProjectExperienceDialog
        open={addDialogOpen}
        docs={availableKnowledgeDocs}
        selectedProjectIds={addSelectedProjectIds}
        running={addRunning}
        onToggle={toggleAddProject}
        onCancel={closeAddDialog}
        onConfirm={handleAddExperiences}
      />
      <GenerateProjectSelectionDialog
        open={generateDialogOpen}
        docs={allKnowledgeDocs}
        generatedProjectIds={generatedExperienceProjectIds}
        selectedProjectIds={generateSelectedProjectIds}
        running={running}
        onToggle={toggleGenerateProject}
        onCancel={closeGenerateDialog}
        onConfirm={handleGenerateFromSelection}
      />
    </div>
  );
}
