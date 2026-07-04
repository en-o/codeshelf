// ResumePanelV2 的所有编辑器 / 展示子组件（从 ResumePanelV2.tsx 抽出，行为不变）。
// SectionCard 作为区块容器被各编辑器复用。

import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  User,
  Upload,
  Sparkles,
  Edit3,
  FileText as FileIcon,
  X,
  Plus,
  Link as LinkIcon,
  Trash2,
  BriefcaseBusiness,
  Loader2,
  GraduationCap,
  RotateCcw,
  ChevronUp,
  ChevronDown,
  Check,
} from "lucide-react";
import type {
  PersonalInfo,
  PersonalWebsite,
  PersonalCustomField,
  WorkExperience,
  EducationExperience,
  ResumeV2,
  ResumeProjectExperience,
  STARExperience,
} from "@/types/resume";
import { Button, showToast } from "@/components/ui";
import { MarkdownRenderer } from "@/components/project/MarkdownRenderer";
import { makeId, normalizeTag, uniqueTags, labelOf, type RefineTask } from "./resumePanelHelpers";

export function SectionCard({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-sm shadow-emerald-900/5">
      <div className="flex items-start justify-between gap-3 border-b border-emerald-50 px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 rounded-lg bg-emerald-50 p-1.5 text-emerald-600">{icon}</div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
            {description && (
              <p className="mt-0.5 text-xs leading-5 text-gray-500">{description}</p>
            )}
          </div>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function GlobalProfileEditor({
  value,
  onChange,
  onGenerateSummary,
  onPolishSummary,
  onPolishWork,
  refineRunning,
  activeRefineTask,
  busy,
}: {
  value: PersonalInfo;
  onChange: (next: PersonalInfo) => void;
  onGenerateSummary: () => void;
  onPolishSummary: () => void;
  onPolishWork: (workId: string) => void;
  refineRunning: boolean;
  activeRefineTask: RefineTask | null;
  busy: boolean;
}) {
  const basic = value.basic;
  const job = value.jobPreference;
  const websites = value.social.websites ?? [];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const updateBasic = (patch: Partial<PersonalInfo["basic"]>) =>
    onChange({ ...value, basic: { ...value.basic, ...patch } });
  const updateJob = (patch: Partial<PersonalInfo["jobPreference"]>) =>
    onChange({ ...value, jobPreference: { ...value.jobPreference, ...patch } });
  const updateWebsites = (next: PersonalWebsite[]) =>
    onChange({ ...value, social: { ...value.social, websites: next } });
  const updateCustomFields = (next: PersonalCustomField[]) =>
    onChange({ ...value, customFields: next });
  const updateWorkExperiences = (next: WorkExperience[]) =>
    onChange({ ...value, workExperiences: next });
  const updateEducations = (next: EducationExperience[]) =>
    onChange({ ...value, educations: next });

  const handleAvatarFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("warning", "请选择图片文件");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") updateBasic({ avatarUrl: reader.result });
    };
    reader.onerror = () => showToast("error", "头像读取失败");
    reader.readAsDataURL(file);
  };

  return (
    <>
      <SectionCard
        icon={<User size={16} />}
        title="基本信息"
        description="全局维护一份，所有简历预览、保存和导出都会使用"
      >
        <div className="grid gap-5 lg:grid-cols-[132px_minmax(0,1fr)]">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="group relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 text-2xl font-semibold text-gray-500 transition hover:border-emerald-300 hover:bg-emerald-50"
              title="上传头像"
            >
              {basic.avatarUrl ? (
                <img src={basic.avatarUrl} alt="头像" className="h-full w-full object-cover" />
              ) : (
                (basic.name || "头像").slice(0, 1)
              )}
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gray-950/65 py-1 text-[11px] font-normal text-white opacity-0 transition group-hover:opacity-100">
                <Upload size={11} /> 上传
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                handleAvatarFile(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            {basic.avatarUrl && (
              <button
                type="button"
                onClick={() => updateBasic({ avatarUrl: undefined })}
                className="text-xs text-gray-400 hover:text-red-600"
              >
                移除头像
              </button>
            )}
          </div>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <ProfileField label="姓名" value={basic.name ?? ""} onChange={(name) => updateBasic({ name })} />
              <ProfileField label="手机" value={basic.phone ?? ""} onChange={(phone) => updateBasic({ phone })} />
              <ProfileField label="邮箱" value={basic.email ?? ""} onChange={(email) => updateBasic({ email })} />
              <ProfileField label="工作经验" value={basic.workExperience ?? ""} onChange={(workExperience) => updateBasic({ workExperience })} placeholder="如 3 年" />
              <ProfileField label="求职岗位" value={job.expectedPosition ?? ""} onChange={(expectedPosition) => updateJob({ expectedPosition })} />
              <ProfileField label="期望薪资" value={job.expectedSalary ?? ""} onChange={(expectedSalary) => updateJob({ expectedSalary })} placeholder="如 15-20K" />
            </div>
            <CustomFieldEditor
              fields={value.customFields ?? []}
              onChange={updateCustomFields}
            />
            <WebsiteEditor websites={websites} onChange={updateWebsites} />
          </div>
        </div>
      </SectionCard>

      <SummaryEditor
        value={value.summary ?? ""}
        onChange={(summary) => onChange({ ...value, summary })}
        onGenerate={onGenerateSummary}
        onPolish={onPolishSummary}
        busy={busy}
      />

      <WorkExperienceEditor
        items={value.workExperiences}
        onChange={updateWorkExperiences}
        onPolish={onPolishWork}
        activePolishId={activeRefineTask?.kind === "work_polish" ? activeRefineTask.workId : null}
        polishRunning={refineRunning}
        busy={busy}
      />

      <EducationEditor
        items={value.educations}
        onChange={updateEducations}
      />
    </>
  );
}

function SummaryEditor({
  value,
  onChange,
  onGenerate,
  onPolish,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  onGenerate: () => void;
  onPolish: () => void;
  busy: boolean;
}) {
  return (
    <SectionCard
      icon={<Sparkles size={16} />}
      title="个人简介"
      description="围绕工作经验方向、技术能力和项目领域生成或润色"
      action={
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onGenerate}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-xs text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            <Sparkles size={12} /> AI 生成
          </button>
          <button
            type="button"
            onClick={onPolish}
            disabled={busy || !value.trim()}
            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Edit3 size={12} /> 润色
          </button>
        </div>
      }
    >
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={5}
        className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm leading-relaxed text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500"
        placeholder="用 2-4 句话概括经验方向、技术能力、项目领域和岗位定位"
      />
    </SectionCard>
  );
}

export function CoreSkillsEditor({
  resume,
  onUpdate,
  busy,
}: {
  resume: ResumeV2;
  onUpdate: (patch: Partial<ResumeV2>) => void;
  busy: boolean;
}) {
  const [newSkill, setNewSkill] = useState("");
  const addSkill = () => {
    const value = normalizeTag(newSkill);
    if (!value) return;
    onUpdate({ skills: uniqueTags([...resume.skills, value]) });
    setNewSkill("");
  };
  return (
    <SectionCard
      icon={<FileIcon size={16} />}
      title="核心技能"
      description="技能标签会完整展示，并支持新增或删除"
    >
      <div>
        <div className="flex flex-wrap gap-1.5">
          {resume.skills.length === 0 ? (
            <span className="text-xs text-gray-400">无</span>
          ) : (
            resume.skills.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
              >
                {s}
                <button
                  type="button"
                  onClick={() => onUpdate({ skills: resume.skills.filter((item) => item !== s) })}
                  disabled={busy}
                  className="rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={`删除 ${s}`}
                >
                  <X size={11} />
                </button>
              </span>
            ))
          )}
        </div>
        <div className="mt-2 flex max-w-md gap-2">
          <input
            value={newSkill}
            onChange={(event) => setNewSkill(event.target.value)}
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addSkill();
              }
            }}
            className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="新增核心技能，回车确认"
          />
          <Button type="button" onClick={addSkill} variant="secondary" size="sm" className="gap-1" disabled={busy}>
            <Plus size={12} /> 新增
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

function ProfileField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500"
      />
    </label>
  );
}

function WebsiteEditor({
  websites,
  onChange,
}: {
  websites: PersonalWebsite[];
  onChange: (next: PersonalWebsite[]) => void;
}) {
  const add = () => onChange([...websites, { id: makeId("site"), label: "", url: "" }]);
  const update = (id: string, patch: Partial<PersonalWebsite>) =>
    onChange(websites.map((item) => item.id === id ? { ...item, ...patch } : item));
  const remove = (id: string) => onChange(websites.filter((item) => item.id !== id));
  return (
    <div className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LinkIcon size={15} className="text-gray-500" />
          <h5 className="text-sm font-medium text-gray-900">网站链接</h5>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={add} className="gap-1">
          <Plus size={12} /> 添加
        </Button>
      </div>
      <div className="space-y-2">
        {websites.length === 0 && <div className="text-xs text-gray-400">可添加 GitHub、博客、作品集等多个链接。</div>}
        {websites.map((item) => (
          <div key={item.id} className="grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)_32px]">
              <input
                value={item.label}
                onChange={(event) => update(item.id, { label: event.target.value })}
                placeholder="名称"
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <input
              value={item.url}
              onChange={(event) => update(item.id, { url: event.target.value })}
              placeholder="https://..."
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              type="button"
              onClick={() => remove(item.id)}
              className="inline-flex items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600"
              aria-label="删除网站"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomFieldEditor({
  fields,
  onChange,
}: {
  fields: PersonalCustomField[];
  onChange: (next: PersonalCustomField[]) => void;
}) {
  const add = () => onChange([...fields, { id: makeId("field"), label: "", value: "" }]);
  const update = (id: string, patch: Partial<PersonalCustomField>) =>
    onChange(fields.map((item) => item.id === id ? { ...item, ...patch } : item));
  const remove = (id: string) => onChange(fields.filter((item) => item.id !== id));
  return (
    <div className="space-y-2">
      {fields.map((field) => (
        <div key={field.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_32px]">
          <input
            value={field.label}
            onChange={(event) => update(field.id, { label: event.target.value })}
            placeholder="字段名称"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <input
            value={field.value}
            onChange={(event) => update(field.id, { value: event.target.value })}
            placeholder="字段内容"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="button"
            onClick={() => remove(field.id)}
            className="inline-flex items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"
            aria-label="删除自定义字段"
          >
            <X size={15} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-emerald-300 px-3 py-2 text-sm text-emerald-600 hover:bg-emerald-50"
      >
        <Plus size={15} /> 新增自定义字段
      </button>
    </div>
  );
}

function WorkExperienceEditor({
  items,
  onChange,
  onPolish,
  activePolishId,
  polishRunning,
  busy,
}: {
  items: WorkExperience[];
  onChange: (next: WorkExperience[]) => void;
  onPolish: (workId: string) => void;
  activePolishId: string | null;
  polishRunning: boolean;
  busy: boolean;
}) {
  const add = () => onChange([...items, { id: makeId("work"), company: "", position: "", startDate: "", endDate: "", description: "" }]);
  const update = (id: string, patch: Partial<WorkExperience>) =>
    onChange(items.map((item) => item.id === id ? { ...item, ...patch } : item));
  const remove = (id: string) => onChange(items.filter((item) => item.id !== id));
  return (
    <SectionCard
      icon={<BriefcaseBusiness size={16} />}
      title="工作经历"
      description="单独维护，可按 Markdown 要点填写职责"
      action={
        <Button type="button" size="sm" variant="secondary" onClick={add} className="shrink-0 gap-1">
          <Plus size={12} /> 添加
        </Button>
      }
    >
      <div className="space-y-3">
        {items.length === 0 && <div className="text-xs text-gray-400">没有工作经历时可以留空。</div>}
        {items.map((item, index) => (
          <div key={item.id} className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">工作经历 {index + 1}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onPolish(item.id)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {polishRunning && activePolishId === item.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Sparkles size={12} />
                  )}
                  润色职责
                </button>
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="删除工作经历"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={item.company ?? ""} onChange={(event) => update(item.id, { company: event.target.value })} placeholder="公司名称" className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-500" />
              <input value={item.position ?? ""} onChange={(event) => update(item.id, { position: event.target.value })} placeholder="职位" className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-500" />
              <input value={item.startDate ?? ""} onChange={(event) => update(item.id, { startDate: event.target.value })} placeholder="开始时间" className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-500" />
              <input value={item.endDate ?? ""} onChange={(event) => update(item.id, { endDate: event.target.value })} placeholder="结束时间 / 至今" className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <textarea
              value={item.description ?? ""}
              onChange={(event) => update(item.id, { description: event.target.value })}
              rows={4}
              className="mt-2 w-full resize-y rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs leading-5 outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="- 负责...\n- 推动..."
            />
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function EducationEditor({
  items,
  onChange,
}: {
  items: EducationExperience[];
  onChange: (next: EducationExperience[]) => void;
}) {
  const add = () => onChange([...items, { id: makeId("edu"), school: "", degree: "", startDate: "", endDate: "" }]);
  const update = (id: string, patch: Partial<EducationExperience>) =>
    onChange(items.map((item) => item.id === id ? { ...item, ...patch } : item));
  const remove = (id: string) => onChange(items.filter((item) => item.id !== id));
  return (
    <SectionCard
      icon={<GraduationCap size={16} />}
      title="教育背景"
      description="可添加多条，仅保留学校、学历和起止时间"
      action={
        <Button type="button" size="sm" variant="secondary" onClick={add} className="shrink-0 gap-1">
          <Plus size={12} /> 添加
        </Button>
      }
    >
      <div className="space-y-3">
        {items.length === 0 && <div className="text-xs text-gray-400">没有教育背景时可以留空。</div>}
        {items.map((item, index) => (
          <div key={item.id} className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">教育背景 {index + 1}</span>
              <button
                type="button"
                onClick={() => remove(item.id)}
                className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                aria-label="删除教育背景"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <input value={item.school ?? ""} onChange={(event) => update(item.id, { school: event.target.value })} placeholder="学校" className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-500" />
              <input value={item.degree ?? ""} onChange={(event) => update(item.id, { degree: event.target.value })} placeholder="学历" className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-500" />
              <input value={item.startDate ?? ""} onChange={(event) => update(item.id, { startDate: event.target.value })} placeholder="开始时间" className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-500" />
              <input value={item.endDate ?? ""} onChange={(event) => update(item.id, { endDate: event.target.value })} placeholder="结束时间" className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export function ExperienceCard({
  experience,
  onUpdate,
  onRegenerate,
  regenerateRunning,
  busy,
}: {
  experience: ResumeProjectExperience;
  onUpdate: (e: ResumeProjectExperience) => void;
  onRegenerate: (projectId: string) => void;
  regenerateRunning: boolean;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<STARExperience>(experience.starExperience);
  const [draftProjectTime, setDraftProjectTime] = useState(experience.projectTime ?? "");
  const [draftProjectRole, setDraftProjectRole] = useState(experience.projectRole ?? "");
  const [draftTechStack, setDraftTechStack] = useState<string[]>(experience.techStack);
  const [newSkill, setNewSkill] = useState("");

  const hasContent = useMemo(() => {
    const s = experience.starExperience;
    return !!(s.situation || s.task || s.action || s.result);
  }, [experience.starExperience]);

  const startEdit = () => {
    setDraft(experience.starExperience);
    setDraftProjectTime(experience.projectTime ?? "");
    setDraftProjectRole(experience.projectRole ?? "");
    setDraftTechStack(experience.techStack);
    setNewSkill("");
    setEditing(true);
    setExpanded(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setDraft(experience.starExperience);
    setDraftProjectTime(experience.projectTime ?? "");
    setDraftProjectRole(experience.projectRole ?? "");
    setDraftTechStack(experience.techStack);
    setNewSkill("");
  };
  const save = () => {
    onUpdate({
      ...experience,
      projectTime: draftProjectTime.trim() || undefined,
      projectRole: draftProjectRole.trim() || undefined,
      techStack: uniqueTags(draftTechStack),
      starExperience: draft,
      isEdited: true,
    });
    setEditing(false);
  };
  const addSkill = () => {
    const next = normalizeTag(newSkill);
    if (!next) return;
    setDraftTechStack((items) => uniqueTags([...items, next]));
    setNewSkill("");
  };

  return (
    <div className="overflow-hidden rounded-lg border border-emerald-100 bg-white">
      <div
        className="flex cursor-pointer items-center justify-between border-b border-emerald-50 bg-emerald-50/30 px-4 py-3"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h5 className="font-medium text-gray-900 truncate">{experience.projectName}</h5>
            {experience.isEdited && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                已编辑
              </span>
            )}
            {hasContent && !experience.isEdited && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">
                AI 生成
              </span>
            )}
          </div>
          {(experience.projectTime || experience.projectRole) && (
            <div className="text-xs text-gray-500 mt-0.5 truncate">
              {[experience.projectTime, experience.projectRole].filter(Boolean).join(" · ")}
            </div>
          )}
          {experience.techStack.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {experience.techStack.map((skill) => (
                <SkillPill key={skill} skill={skill} />
              ))}
            </div>
          )}
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onRegenerate(experience.projectId);
            }}
            disabled={regenerateRunning || editing || busy}
            className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1 text-xs text-white hover:bg-emerald-600 disabled:cursor-default disabled:opacity-50"
          >
            {regenerateRunning ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            重生成
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (!editing) startEdit();
            }}
            disabled={editing}
            className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 disabled:cursor-default disabled:border-gray-200 disabled:text-gray-400"
          >
            {hasContent ? <Edit3 size={12} /> : <RotateCcw size={12} />}
            {editing ? "编辑中" : hasContent ? "编辑" : "填写"}
          </button>
        {expanded ? (
          <ChevronUp size={16} className="text-gray-400" />
        ) : (
          <ChevronDown size={16} className="text-gray-400" />
        )}
        </div>
      </div>

      {expanded && (
        <div className="p-4">
          {editing ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    项目时间
                  </label>
                  <input
                    value={draftProjectTime}
                    onChange={(e) => setDraftProjectTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="如：2024年01月 - 至今；无法确认可留空"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    项目角色
                  </label>
                  <input
                    value={draftProjectRole}
                    onChange={(e) => setDraftProjectRole(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="如：后端开发工程师 / 核心开发"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  关键词（技术标签）
                </label>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                  <div className="flex flex-wrap gap-1.5">
                    {draftTechStack.length === 0 ? (
                      <span className="px-2 py-1 text-xs text-gray-400">暂无标签</span>
                    ) : (
                      draftTechStack.map((skill) => (
                        <span
                          key={skill}
                          className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
                        >
                          {skill}
                          <button
                            type="button"
                            onClick={() => setDraftTechStack((items) => items.filter((item) => item !== skill))}
                            className="rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                            aria-label={`删除 ${skill}`}
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={newSkill}
                      onChange={(event) => setNewSkill(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addSkill();
                        }
                      }}
                      className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="新增关键词，回车确认"
                    />
                    <Button type="button" onClick={addSkill} variant="secondary" size="sm" className="gap-1">
                      <Plus size={12} /> 新增
                    </Button>
                  </div>
                </div>
              </div>
              {(["situation", "action", "result"] as const).map((k) => (
                <div key={k}>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    {labelOf(k)}
                  </label>
                  <textarea
                    rows={k === "situation" ? 3 : k === "action" ? 8 : 5}
                    value={draft[k]}
                    onChange={(e) => setDraft((p) => ({ ...p, [k]: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={k === "situation" ? "项目描述正文" : "- 第一条\n- 第二条"}
                  />
                </div>
              ))}
              <div className="flex items-center justify-end gap-2">
                <Button onClick={cancelEdit} variant="secondary" size="sm" className="gap-1">
                  <X size={12} /> 取消
                </Button>
                <Button onClick={save} variant="primary" size="sm" className="gap-1">
                  <Check size={12} /> 保存
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {hasContent ? (
                (["situation", "action", "result"] as const).map((k) =>
                  experience.starExperience[k] ? (
                    <div key={k}>
                      <h6 className="text-xs font-medium text-gray-700 mb-1">{labelOf(k)}</h6>
                      {k === "situation" ? (
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                          {experience.starExperience[k]}
                        </p>
                      ) : (
                        <MarkdownBlock content={experience.starExperience[k]} />
                      )}
                    </div>
                  ) : null
                )
              ) : (
                <div className="text-center py-4 text-gray-400 text-sm">暂无内容</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SkillPill({ skill }: { skill: string }) {
  return (
    <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600">
      {skill}
    </span>
  );
}

function MarkdownBlock({ content }: { content: string }) {
  return (
    <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-700">
      <MarkdownRenderer content={content} />
    </div>
  );
}
