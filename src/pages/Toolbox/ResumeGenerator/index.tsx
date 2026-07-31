import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import {
  FileText,
  AlertCircle,
  Bot,
  Settings,
  Wand2,
  Database,
  ListChecks,
  Trash2,
  FileDown,
  Pencil,
  Plus,
  ChevronLeft,
  ChevronDown,
  Check,
  ShieldAlert,
  Copy,
  ScrollText,
  Search,
  X,
} from "lucide-react";
import { useProjectsStore } from "@/stores/projectsStore";
import { useAiProvidersStore } from "@/stores/aiProvidersStore";
import { useUiStore } from "@/stores/uiStore";
import { useResumeStore } from "@/stores/resumeStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { JobDirection, PersonalInfo, ResumeV2 } from "@/types/resume";
import {
  exportResumeV2ToDocxWithDialog,
  exportResumeV2ToMarkdownWithDialog,
} from "@/services/resume/export";
import {
  hasResumeProfileContent,
  loadResumeProfile,
  saveResumeProfile,
} from "@/services/resume/profile";
import {
  loadResumePreference,
  resolveResumeProvider,
  saveResumePreference,
  type ResumePreference,
} from "@/services/resume/preferences";
import { Button, showToast } from "@/components/ui";
import { EmptyState } from "@/components/common";
import { ToolPanelHeader } from "../index";
import { KnowledgePanel } from "./KnowledgePanel";
import { PromptConfigDialog } from "./PromptConfigDialog";
import { ResumePanelV2 } from "./ResumePanelV2";
import { SaveResumeDialog } from "./SaveResumeDialog";
import { SensitiveFileRulesDialog } from "./SensitiveFileRulesDialog";

type Tab = "select" | "knowledge" | "resume";
type View = "history" | "workflow";

interface ResumeGeneratorProps {
  onBack: () => void;
}

/**
 * 路径只留最后两段。
 *
 * 书架里所有项目的前缀几乎都一样（`/Users/xxx/Desktop/tan/code/...`），
 * 完整显示既占地方又把真正能区分项目的尾部挤掉了。完整路径放 title。
 */
function shortPath(full: string): string {
  const parts = full.split("/").filter(Boolean);
  if (parts.length <= 2) return full;
  return `…/${parts.slice(-2).join("/")}`;
}

export function ResumeGenerator({ onBack }: ResumeGeneratorProps) {
  const projects = useProjectsStore((s) => s.projects);
  const { aiProviders } = useAiProvidersStore();
  const setCurrentPage = useUiStore((s) => s.setCurrentPage);
  const sensitiveFilePatterns = useSettingsStore((s) => s.sensitiveFilePatterns);
  const {
    knowledgeDocs,
    loadAllKnowledgeFromDisk,
    savedResumes,
    setSavedResumes,
    clearResumeRun,
  } = useResumeStore();

  const [view, setView] = useState<View>(() =>
    savedResumes.length > 0 ? "history" : "workflow"
  );
  const [activeTab, setActiveTab] = useState<Tab>("select");
  // 编辑已有简历模式：从「我的简历」打开时为 true，隐藏创建向导的步骤条，直接进编辑器。
  const [editingSaved, setEditingSaved] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** 项目筛选关键词。十几个项目靠肉眼扫太慢，这是这一步最缺的东西。 */
  const [projectQuery, setProjectQuery] = useState("");
  const [jobDirection, setJobDirection] = useState<JobDirection>("backend");
  const [resume, setResume] = useState<ResumeV2 | null>(null);
  const [resumeProfile, setResumeProfile] = useState<PersonalInfo>(() => loadResumeProfile());
  const [saveDialogResume, setSaveDialogResume] = useState<ResumeV2 | null>(null);
  const [renameTarget, setRenameTarget] = useState<ResumeV2 | null>(null);
  const [sensitiveRulesOpen, setSensitiveRulesOpen] = useState(false);
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [promptConfigVersion, setPromptConfigVersion] = useState(0);
  // 用户选过的 provider/model;null = 跟系统默认走。
  const [preference, setPreference] = useState<ResumePreference | null>(() =>
    loadResumePreference()
  );
  // 切换面板的展开/折叠
  const [pickerOpen, setPickerOpen] = useState(false);

  // 启动加载磁盘上已有的背景知识
  useEffect(() => {
    loadAllKnowledgeFromDisk((id) => {
      const p = projects.find((p) => p.id === id);
      return p ? { name: p.name, path: p.path } : undefined;
    });
  }, [loadAllKnowledgeFromDisk, projects]);

  useEffect(() => {
    if (hasResumeProfileContent(resumeProfile)) return;
    const fallback = savedResumes.find((item) => hasResumeProfileContent(item.personalInfo))?.personalInfo;
    if (!fallback) return;
    setResumeProfile(fallback);
    saveResumeProfile(fallback);
  }, [resumeProfile, savedResumes]);

  const resolved = useMemo(
    () => resolveResumeProvider(aiProviders, preference),
    [aiProviders, preference]
  );
  const effectiveProvider = resolved?.provider ?? null;
  const hasProviders = aiProviders.length > 0;
  const hasAvailableProvider = aiProviders.some((p) => p.enabled);

  const selectableProviders = useMemo(
    () => aiProviders.filter((p) => p.enabled && p.models.some((m) => m.enabled)),
    [aiProviders]
  );

  const applyPreference = (next: ResumePreference | null) => {
    setPreference(next);
    saveResumePreference(next);
    setPickerOpen(false);
  };

  const openPromptManager = () => setPromptDialogOpen(true);

  const startNewResume = () => {
    setResume(null);
    setSelectedIds(new Set());
    setJobDirection("backend");
    setView("workflow");
    setActiveTab("select");
    setEditingSaved(false);
    clearResumeRun();
  };

  const selectedProjects = useMemo(
    () => projects.filter((p) => selectedIds.has(p.id)),
    [projects, selectedIds]
  );

  const selectedKnowledgeDocs = useMemo(
    () => selectedProjects.map((p) => knowledgeDocs[p.id]).filter(Boolean),
    [selectedProjects, knowledgeDocs]
  );
  const sensitiveRuleCount = useMemo(
    () =>
      sensitiveFilePatterns.filter(
        (line) => line.trim() && !line.trim().startsWith("#")
      ).length,
    [sensitiveFilePatterns]
  );

  const goToAISettings = () => {
    setCurrentPage("aiProviders");
    onBack();
  };

  // 强绑定：项目选择一旦变化，之前基于旧选择生成的简历即失效，清空以强制重走「生成简历」。
  // 已保存的简历仍在「我的简历」中，不受影响。
  const invalidateGeneratedResume = () => {
    if (resume) {
      setResume(null);
      clearResumeRun();
      showToast("warning", "项目选择已变更，已清空当前生成结果，请重新生成简历");
    }
  };

  const toggleProject = (id: string) => {
    invalidateGeneratedResume();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * 按名称 / 路径 / 标签过滤。
   *
   * 已选中的项**永远保留**在列表里：否则搜一下就把之前勾的隐藏掉，
   * 用户会以为选择丢了，还得清空搜索才能确认。
   */
  const visibleProjects = useMemo(() => {
    const q = projectQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        selectedIds.has(p.id) ||
        p.name.toLowerCase().includes(q) ||
        p.path.toLowerCase().includes(q) ||
        p.labels.some((l) => l.toLowerCase().includes(q)),
    );
  }, [projects, projectQuery, selectedIds]);

  const toggleAll = () => {
    invalidateGeneratedResume();
    if (selectedIds.size === projects.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(projects.map((p) => p.id)));
    }
  };

  const handleSaveResume = async (r: ResumeV2) => {
    const exists = savedResumes.some((item) => item.id === r.id);
    if (exists) {
      await saveResumeRecord({
        ...r,
        personalInfo: resumeProfile,
        updatedAt: new Date().toISOString(),
        isSaved: true,
      });
      showToast("success", "已保存");
      return;
    }
    // 新简历首次保存时才打开命名 dialog。返回 Promise 以兼容 ResumePanelV2 的 await。
    setSaveDialogResume({ ...r, personalInfo: resumeProfile });
  };

  const defaultResumeName = useMemo(() => {
    if (!saveDialogResume) return "";
    if (saveDialogResume.name) return saveDialogResume.name;
    const date = new Date().toLocaleDateString("zh-CN");
    return `${saveDialogResume.jobDirection} · ${saveDialogResume.experiences.length} 个项目 · ${date}`;
  }, [saveDialogResume]);

  const persistResume = async (name: string) => {
    if (!saveDialogResume) return;
    const stored: ResumeV2 = {
      ...saveDialogResume,
      name,
      personalInfo: resumeProfile,
      updatedAt: new Date().toISOString(),
      isSaved: true,
    };
    try {
      await saveResumeRecord(stored);
      setSaveDialogResume(null);
      showToast("success", "已保存");
    } catch (err) {
      console.error("保存简历失败:", err);
      showToast("error", `保存失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const saveResumeRecord = async (stored: ResumeV2) => {
    const updated = [stored, ...savedResumes.filter((s) => s.id !== stored.id)];
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_resumes", { data: updated });
    setSavedResumes(updated);
    setResume(stored);
  };

  const handleOpenSaved = (r: ResumeV2) => {
    setResume(r);
    setJobDirection(r.jobDirection);
    setSelectedIds(new Set(r.experiences.map((e) => e.projectId)));
    setActiveTab("resume");
    setView("workflow");
    setEditingSaved(true);
  };

  const handleDeleteSaved = async (e: MouseEvent, id: string) => {
    e.stopPropagation();
    const updated = savedResumes.filter((r) => r.id !== id);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_resumes", { data: updated });
      setSavedResumes(updated);
    } catch (err) {
      console.error(err);
      showToast("error", `删除失败: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    showToast("success", "已删除");
  };

  const handleExportSaved = async (e: MouseEvent, r: ResumeV2) => {
    e.stopPropagation();
    try {
      const filePath = await exportResumeV2ToMarkdownWithDialog({
        ...r,
        personalInfo: r.personalInfo ?? resumeProfile,
      });
      if (filePath) showToast("success", `已导出到 ${filePath}`);
    } catch (err) {
      showToast("error", `导出失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleExportSavedDocx = async (e: MouseEvent, r: ResumeV2) => {
    e.stopPropagation();
    try {
      const filePath = await exportResumeV2ToDocxWithDialog({
        ...r,
        personalInfo: r.personalInfo ?? resumeProfile,
      });
      if (filePath) showToast("success", `已导出到 ${filePath}`);
    } catch (err) {
      showToast("error", `导出失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDuplicateSaved = async (e: MouseEvent, r: ResumeV2) => {
    e.stopPropagation();
    const now = new Date().toISOString();
    const duplicate: ResumeV2 = {
      ...r,
      id: makeResumeId(),
      name: `${r.name || `${r.jobDirection} · ${r.experiences.length} 个项目`} 副本`,
      createdAt: now,
      updatedAt: now,
      isSaved: true,
      personalInfo: r.personalInfo ?? resumeProfile,
    };
    const updated = [duplicate, ...savedResumes];
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_resumes", { data: updated });
      setSavedResumes(updated);
      showToast("success", "已复制为新简历");
    } catch (err) {
      console.error(err);
      showToast("error", `复制失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleRenameSaved = (e: MouseEvent, r: ResumeV2) => {
    e.stopPropagation();
    setRenameTarget(r);
  };

  const persistRename = async (name: string) => {
    if (!renameTarget) return;
    const renamed: ResumeV2 = {
      ...renameTarget,
      name,
      updatedAt: new Date().toISOString(),
    };
    const updated = savedResumes.map((r) => (r.id === renamed.id ? renamed : r));
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_resumes", { data: updated });
      setSavedResumes(updated);
      if (resume?.id === renamed.id) setResume(renamed);
      setRenameTarget(null);
      showToast("success", "已重命名");
    } catch (err) {
      console.error(err);
      showToast("error", `重命名失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const renderProviderStatus = () => {
    if (!hasProviders || !hasAvailableProvider || !resolved) {
      const msg = !hasProviders
        ? "未配置 AI 供应商"
        : !hasAvailableProvider
        ? "没有启用的 AI 供应商"
        : "未找到可用的 AI 供应商 / 模型";
      return (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-amber-800">{msg}</div>
              <div className="text-sm text-amber-700 mt-1">
                简历生成需要使用支持工具调用的 AI 模型。请先配置并启用一个供应商。
              </div>
              <Button
                onClick={goToAISettings}
                size="sm"
                className="mt-2 gap-1 bg-amber-100 hover:bg-amber-200 text-amber-800 border-amber-200"
                variant="secondary"
              >
                <Settings size={14} /> 前往配置
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm shadow-emerald-900/5">
        <div className="flex items-center gap-3 p-3">
          <Bot size={18} className="text-emerald-600" />
          <div className="flex-1 text-sm text-emerald-900">
            使用 <span className="font-medium">{resolved.provider.name}</span>
            <span className="text-emerald-600"> / {resolved.modelName}</span>
            {resolved.source === "system" && (
              <span className="ml-2 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                系统默认
              </span>
            )}
            {resolved.source === "user" && (
              <span className="ml-2 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                已自选
              </span>
            )}
          </div>
          <button
            onClick={() => setPickerOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-800"
          >
            <Settings size={12} /> 切换
            <ChevronDown
              size={12}
              className={`transition-transform ${pickerOpen ? "rotate-180" : ""}`}
            />
          </button>
        </div>
        {pickerOpen && (
          <div className="space-y-2 border-t border-emerald-100 bg-emerald-50/50 p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-600">选择本页要使用的供应商和模型</span>
              {resolved.source === "user" && (
                <button
                  onClick={() => applyPreference(null)}
                  className="text-xs text-gray-500 hover:text-emerald-600"
                >
                  恢复为系统默认
                </button>
              )}
            </div>
            <div className="space-y-2 max-h-72 overflow-auto">
              {selectableProviders.map((p) => {
                const enabledModels = p.models.filter((m) => m.enabled);
                return (
                  <div
                    key={p.id}
                    className="border border-gray-200 rounded-md overflow-hidden"
                  >
                    <div className="px-3 py-2 bg-gray-50 text-xs font-medium text-gray-700 flex items-center gap-2">
                      {p.name}
                      {p.isDefaultProvider && (
                        <span className="text-[10px] text-gray-400">系统默认</span>
                      )}
                    </div>
                    <div className="divide-y divide-gray-100">
                      {enabledModels.map((m) => {
                        const active =
                          resolved.provider.id === p.id && resolved.modelId === m.id;
                        return (
                          <button
                            key={m.id}
                            onClick={() =>
                              applyPreference({ providerId: p.id, modelId: m.id })
                            }
                            className={`w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-emerald-50 ${
                              active ? "bg-emerald-50 text-emerald-700" : "text-gray-700"
                            }`}
                          >
                            <span className="truncate">{m.model}</span>
                            {active && <Check size={12} className="text-emerald-600" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="pt-2 border-t border-gray-100 flex justify-end">
              <button
                onClick={goToAISettings}
                className="text-xs text-gray-500 hover:text-emerald-600 flex items-center gap-1"
              >
                <Settings size={12} /> 去 AI 设置增删供应商
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSelectTab = () => (
    <div className="space-y-5">
      {renderProviderStatus()}

      <div className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm shadow-emerald-900/5">
        <div className="border-b border-emerald-100 bg-emerald-50/70 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-emerald-950">
                选择项目
              </h3>
              <div className="mt-1 text-xs text-emerald-700/75">
                已选择 {selectedIds.size} / {projects.length} 个项目
                {projectQuery && (
                  <span className="ml-2 text-emerald-600/70">
                    · 筛选出 {visibleProjects.length} 个
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* 十几个项目靠滚动找太慢，搜索是这一步最缺的东西 */}
              <div className="relative">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  value={projectQuery}
                  onChange={(e) => setProjectQuery(e.target.value)}
                  placeholder="搜索名称 / 路径 / 标签"
                  className="w-52 rounded-full border border-emerald-200 bg-white py-1.5 pl-7 pr-7 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
                {projectQuery && (
                  <button
                    onClick={() => setProjectQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    title="清除"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <button
                onClick={toggleAll}
                className="shrink-0 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={projects.length === 0}
              >
                {selectedIds.size === projects.length && projects.length > 0
                  ? "取消全选"
                  : "全选项目"}
              </button>
            </div>
          </div>
        </div>
        {projects.length === 0 ? (
          <div className="bg-gray-50/60">
            <EmptyState
              icon={FileText}
              title="书架中没有项目"
              description="请先添加项目到书架"
              className="py-8"
            />
          </div>
        ) : (
          // 不在这里再套一层滚动：外层页面已经能滚，
          // 嵌套滚动会出现两个滚动条，鼠标停在哪一层就滚哪一层，非常难用。
          <div className="p-3">
            {visibleProjects.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-400">
                没有匹配「{projectQuery}」的项目
              </div>
            ) : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {visibleProjects.map((p) => {
              const checked = selectedIds.has(p.id);
              const hasKnowledge = !!knowledgeDocs[p.id];
              return (
                <label
                  key={p.id}
                  title={p.path}
                  className={`group flex cursor-pointer flex-col rounded-xl border p-3 transition-all ${
                    checked
                      ? "border-emerald-400 bg-emerald-50/70 shadow-sm shadow-emerald-500/10"
                      : "border-gray-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/40"
                  }`}
                >
                  {/* 勾选框与项目名同行。原来是徽章、名称、路径各占一行，
                      外加 min-h-[156px] 固定高 —— 17 个项目要滚 900+px。
                      「项目」徽章 17 张卡完全一样，零信息量，去掉。 */}
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleProject(p.id)}
                      className="h-4 w-4 shrink-0 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
                      {p.name}
                    </span>
                    {hasKnowledge && (
                      <span
                        title="已生成背景知识"
                        className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700"
                      >
                        已生成
                      </span>
                    )}
                  </div>

                  {/* 路径只显示尾部：所有项目前缀都是同一串
                      `/Users/xxx/Desktop/tan/...`，占两行还把有用的尾部截掉了 */}
                  <div className="mt-1 truncate pl-6 text-[11px] text-gray-400">
                    {shortPath(p.path)}
                  </div>

                  {p.labels.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1 pl-6">
                      {p.labels.slice(0, 4).map((l) => (
                        <span
                          key={l}
                          className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] text-gray-500"
                        >
                          {l}
                        </span>
                      ))}
                    </div>
                  )}
                </label>
              );
            })}
            </div>
            )}
          </div>
        )}
      </div>

    </div>
  );

  const renderResumeTab = () => (
    <div className="space-y-6">
      {renderProviderStatus()}
      {selectedKnowledgeDocs.length === 0 && !resume ? (
        <div className="bg-gray-50 rounded-lg border border-dashed border-gray-200">
          <EmptyState
            icon={ListChecks}
            title="还没有可用的背景知识"
            description="请回到「背景知识」标签，为已选项目生成背景知识"
            className="py-8"
          />
        </div>
      ) : (
        <>
          <ResumePanelV2
            knowledgeDocs={selectedKnowledgeDocs}
            provider={effectiveProvider}
            jobDirection={jobDirection}
            onJobDirectionChange={setJobDirection}
            resume={resume}
            personalInfo={resumeProfile}
            onResumeChange={setResume}
            onPersonalInfoChange={(info) => {
              setResumeProfile(info);
              saveResumeProfile(info);
            }}
            onSaveResume={handleSaveResume}
          />
        </>
      )}
    </div>
  );

  const renderHistoryView = () => (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">我的简历</h3>
            <p className="mt-1 text-xs text-gray-500">
              点击卡片继续编辑，底部图标可直接执行复制、导出和删除。
            </p>
          </div>
          <Button
            onClick={startNewResume}
            variant="primary"
            size="sm"
            className="gap-1.5 bg-emerald-500 hover:bg-emerald-600 focus:ring-emerald-500"
          >
            <Plus size={14} /> 创建简历
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
          {savedResumes.map((r) => (
            <article
              key={r.id}
              onClick={() => handleOpenSaved(r)}
              className="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-lg hover:shadow-emerald-900/10 cursor-pointer"
            >
              <div className="relative aspect-[3/2] border-b border-gray-200 bg-gradient-to-br from-white via-gray-50 to-emerald-50/50 p-3">
                <div className="absolute right-3 top-3 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] text-gray-500">
                  {jobDirectionLabel(r.jobDirection)}
                </div>
                <div className="flex h-full items-center justify-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-gray-200 bg-white text-gray-300 shadow-sm">
                    <FileText size={30} />
                  </div>
                </div>
              </div>
              <div className="space-y-2.5 p-3.5">
                <div>
                  <div className="truncate text-sm font-semibold text-gray-900">
                    {r.name || `${jobDirectionLabel(r.jobDirection)}简历`}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    最近更新于 {formatRelativeTime(r.updatedAt || r.createdAt)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px] text-gray-500">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5">{r.experiences.length} 个项目</span>
                  {!!r.skills.length && <span className="rounded-full bg-gray-100 px-2 py-0.5">{r.skills.length} 个技能</span>}
                </div>
                <div className="flex items-center justify-between border-t border-gray-100 pt-2.5">
                  <div className="flex items-center gap-1">
                    <IconActionButton
                      title="重命名"
                      onClick={(e) => handleRenameSaved(e, r)}
                      icon={<Pencil size={14} />}
                    />
                    <IconActionButton
                      title="复制"
                      onClick={(e) => handleDuplicateSaved(e, r)}
                      icon={<Copy size={14} />}
                    />
                    <IconActionButton
                      title="导出 docx"
                      onClick={(e) => handleExportSavedDocx(e, r)}
                      icon={<ScrollText size={14} />}
                    />
                    <IconActionButton
                      title="导出 Markdown"
                      onClick={(e) => handleExportSaved(e, r)}
                      icon={<FileDown size={14} />}
                    />
                  </div>
                  <IconActionButton
                    title="删除"
                    onClick={(e) => handleDeleteSaved(e, r.id)}
                    icon={<Trash2 size={14} />}
                    danger
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );

  const TABS: Array<{
    id: Tab;
    label: string;
    icon: ReactNode;
    badge?: string;
    disabled?: boolean;
  }> = [
    {
      id: "select",
      label: "① 选项目",
      icon: <ListChecks size={14} />,
      badge: selectedIds.size > 0 ? String(selectedIds.size) : undefined,
    },
    {
      id: "knowledge",
      label: "② 生成背景",
      icon: <Database size={14} />,
      badge:
        selectedIds.size > 0
          ? `${selectedKnowledgeDocs.length}/${selectedIds.size}`
          : undefined,
      disabled: selectedIds.size === 0,
    },
    {
      id: "resume",
      label: "③ 生成简历",
      icon: <Wand2 size={14} />,
      // 强约束：必须为「全部」已选项目生成背景知识后，才能进入生成简历
      disabled:
        selectedProjects.length === 0 ||
        selectedKnowledgeDocs.length < selectedProjects.length,
    },
  ];

  const renderTabs = () => (
    <div className="inline-flex w-fit gap-1 rounded-full border border-emerald-100 bg-white p-1 shadow-sm shadow-emerald-900/5">
      {TABS.map((t) => {
        const active = activeTab === t.id;
        return (
            <button
              key={t.id}
              onClick={() => {
                setActiveTab(t.id);
              }}
              disabled={t.disabled}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-emerald-500 text-white shadow-sm"
                : t.disabled
                ? "text-gray-300 cursor-not-allowed"
                : "text-gray-600 hover:bg-emerald-50 hover:text-emerald-700"
            }`}
          >
            {t.icon}
            {t.label}
            {t.badge && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                  active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  const showHistory = view === "history" && savedResumes.length > 0;

  const headerActions = (
    <div className="flex items-center gap-2">
      <Button
        onClick={openPromptManager}
        variant="secondary"
        size="sm"
        className="gap-1.5"
        title="编辑背景知识与简历生成提示词"
      >
        <Settings size={14} />
        提示词
      </Button>
      <Button
        onClick={() => setSensitiveRulesOpen(true)}
        variant="secondary"
        size="sm"
        className="gap-1.5"
        title="配置背景知识生成时需要跳过的敏感文件规则"
      >
        <ShieldAlert size={14} />
        敏感规则
        {sensitiveRuleCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white text-gray-600 border border-gray-200">
            {sensitiveRuleCount}
          </span>
        )}
      </Button>
      {!showHistory && savedResumes.length > 0 ? (
        <button
          onClick={() => setView("history")}
          className="text-sm text-gray-600 hover:text-emerald-600 flex items-center gap-1"
        >
          <ChevronLeft size={16} /> 我的简历
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-white">
      <ToolPanelHeader
        title="简历生成器"
        icon={FileText}
        onBack={onBack}
        actions={headerActions}
      />

      <div className="flex-1 flex flex-col min-h-0">
        {showHistory ? (
          renderHistoryView()
        ) : editingSaved ? (
          <div className="flex-1 overflow-auto p-6">
            <div className="max-w-7xl mx-auto space-y-5">
              {renderResumeTab()}
            </div>
          </div>
        ) : activeTab === "knowledge" ? (
          <>
            <div className="px-6 pt-5 pb-4">
              <div className="max-w-6xl mx-auto">{renderTabs()}</div>
            </div>
            <KnowledgePanel
              selectedProjects={selectedProjects}
              provider={effectiveProvider}
              promptConfigVersion={promptConfigVersion}
              onNext={() => setActiveTab("resume")}
            />
          </>
        ) : (
          <>
            <div className="flex-1 overflow-auto p-6">
              <div className="max-w-7xl mx-auto space-y-5">
                {renderTabs()}
                {activeTab === "select" && renderSelectTab()}
                {activeTab === "resume" && renderResumeTab()}
              </div>
            </div>

            {/* 操作栏放在滚动容器**外面**，是它的兄弟节点。
                放在里面用 sticky 不行：sticky 只能在自己的容器块内浮动，
                作为最后一个子元素时根本没有可浮动的空间，会停在内容中间。
                放外面才是「内容滚动、操作栏不动」，而且只有一个滚动条。 */}
            {activeTab === "select" && (
              <div className="shrink-0 border-t border-gray-200 bg-white px-6 py-3">
                <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
                  <span className="text-xs text-gray-500">
                    已选 {selectedIds.size} 个项目
                  </span>
                  <Button
                    onClick={() => setActiveTab("knowledge")}
                    disabled={selectedIds.size === 0}
                    variant="primary"
                    size="md"
                    className="gap-2 bg-emerald-500 hover:bg-emerald-600 focus:ring-emerald-500"
                  >
                    <Database size={16} />
                    下一步：生成 / 查看背景知识
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <SaveResumeDialog
        open={!!saveDialogResume}
        defaultName={defaultResumeName}
        onCancel={() => setSaveDialogResume(null)}
        onConfirm={persistResume}
      />

      <SaveResumeDialog
        open={!!renameTarget}
        title="重命名简历"
        defaultName={
          renameTarget?.name ||
          `${renameTarget?.jobDirection ?? ""} · ${renameTarget?.experiences.length ?? 0} 个项目`
        }
        onCancel={() => setRenameTarget(null)}
        onConfirm={persistRename}
      />

      <SensitiveFileRulesDialog
        open={sensitiveRulesOpen}
        onClose={() => setSensitiveRulesOpen(false)}
      />
      <PromptConfigDialog
        open={promptDialogOpen}
        onClose={() => setPromptDialogOpen(false)}
        onSaved={() => setPromptConfigVersion((value) => value + 1)}
      />
    </div>
  );
}

function IconActionButton({
  title,
  onClick,
  icon,
  danger = false,
}: {
  title: string;
  onClick: (event: MouseEvent) => void;
  icon: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition ${
        danger
          ? "border-red-100 text-red-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          : "border-gray-200 text-gray-400 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
      }`}
    >
      {icon}
    </button>
  );
}

function formatRelativeTime(value: string): string {
  const now = Date.now();
  const time = new Date(value).getTime();
  const diffHours = Math.max(0, Math.floor((now - time) / (1000 * 60 * 60)));
  if (diffHours < 1) return "1 小时内";
  if (diffHours < 24) return `${diffHours} 小时前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays} 天前`;
  return new Date(value).toLocaleDateString("zh-CN");
}

function jobDirectionLabel(direction: JobDirection): string {
  if (direction === "backend") return "后端";
  if (direction === "frontend") return "前端";
  return "全栈";
}

function makeResumeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
