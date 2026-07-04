import { writeTextFile } from "@tauri-apps/plugin-fs";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { ResumeV2 } from "@/types/resume";

const DIRECTION_TITLE: Record<string, string> = {
  backend: "后端开发工程师",
  frontend: "前端开发工程师",
  fullstack: "全栈开发工程师",
};

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

// ============== Markdown 导出 ==============

export function exportResumeV2ToMarkdown(resume: ResumeV2): string {
  const lines: string[] = [];
  lines.push(`# ${DIRECTION_TITLE[resume.jobDirection] ?? resume.jobDirection}简历`);
  lines.push("");
  lines.push(
    `> 由 CodeShelf 简历生成器（Deep Agents）于 ${formatDateTime(resume.createdAt)} 生成`
  );
  lines.push("");
  if (resume.personalInfo) {
    appendPersonalInfo(lines, resume);
  }

  // 与预览一致：个人信息里的 summary 优先，否则回退到生成的 resume.summary
  const summary = (resume.personalInfo?.summary ?? resume.summary ?? "").trim();
  if (summary) {
    lines.push("## 个人简介");
    lines.push("");
    lines.push(summary);
    lines.push("");
  }

  if (resume.skills.length > 0) {
    lines.push("## 核心技能");
    lines.push("");
    lines.push(resume.skills.join(" · "));
    lines.push("");
  }

  appendWorkExperiences(lines, resume);

  lines.push("## 项目经历");
  lines.push("");
  resume.experiences.forEach((exp, idx) => {
    lines.push(`### ${idx + 1}. ${exp.projectName}`);
    lines.push("");
    if (exp.projectTime) {
      lines.push(`**项目时间**: ${exp.projectTime}`);
      lines.push("");
    }
    if (exp.projectRole) {
      lines.push(`**项目角色**: ${exp.projectRole}`);
      lines.push("");
    }
    if (exp.techStack.length > 0) {
      lines.push(`**技术栈**: ${exp.techStack.join(", ")}`);
      lines.push("");
    }
    const s = exp.starExperience;
    if (s.situation) {
      lines.push("**项目描述**");
      lines.push("");
      lines.push(s.situation);
      lines.push("");
    }
    if (s.action) {
      lines.push("**核心职责**");
      lines.push("");
      lines.push(s.action);
      lines.push("");
    }
    if (s.result) {
      lines.push("**项目成果**");
      lines.push("");
      lines.push(s.result);
      lines.push("");
    }
    if (idx < resume.experiences.length - 1) {
      lines.push("---");
      lines.push("");
    }
  });

  appendEducation(lines, resume);

  return lines.join("\n");
}

function appendPersonalInfo(lines: string[], resume: ResumeV2): void {
  const info = resume.personalInfo;
  if (!info) return;
  const basic = info.basic;
  const job = info.jobPreference;
  const top = [
    basic.name && `姓名: ${basic.name}`,
    job.expectedPosition && `求职岗位: ${job.expectedPosition}`,
    basic.phone && `手机: ${basic.phone}`,
    basic.email && `邮箱: ${basic.email}`,
    basic.workExperience && `工作经验: ${basic.workExperience}`,
    job.expectedSalary && `期望薪资: ${job.expectedSalary}`,
    ...(info.customFields ?? [])
      .filter((item) => item.label.trim() || item.value.trim())
      .map((item) => `${item.label || "自定义"}: ${item.value}`),
  ].filter(Boolean);
  if (top.length === 0 && collectWebsites(resume).length === 0) return;
  lines.push("## 个人信息");
  lines.push("");
  for (const item of top) lines.push(`- ${item}`);
  for (const site of collectWebsites(resume)) {
    lines.push(`- ${site.label ? `${site.label}: ` : ""}${site.url}`);
  }
  lines.push("");
}

function appendWorkExperiences(lines: string[], resume: ResumeV2): void {
  const items = resume.personalInfo?.workExperiences ?? [];
  if (items.length === 0) return;
  lines.push("## 工作经历");
  lines.push("");
  for (const item of items) {
    lines.push(`### ${[item.company, item.position].filter(Boolean).join(" · ") || "未命名工作经历"}`);
    const time = [item.startDate, item.endDate].filter(Boolean).join(" - ");
    if (time) {
      lines.push("");
      lines.push(`**时间**: ${time}`);
    }
    if (item.description) {
      lines.push("");
      lines.push(item.description);
    }
    lines.push("");
  }
}

function appendEducation(lines: string[], resume: ResumeV2): void {
  const educations = (resume.personalInfo?.educations ?? []).filter((item) =>
    Boolean(item.school || item.degree || item.startDate || item.endDate)
  );
  if (educations.length === 0) return;
  lines.push("## 教育背景");
  lines.push("");
  for (const education of educations) {
    const title = [education.school, education.degree].filter(Boolean).join(" · ");
    if (title) lines.push(`### ${title}`);
    const time = [education.startDate, education.endDate].filter(Boolean).join(" - ");
    if (time) lines.push(`**时间**: ${time}`);
    lines.push("");
  }
}

function collectWebsites(resume: ResumeV2): Array<{ label: string; url: string }> {
  const social = resume.personalInfo?.social;
  if (!social) return [];
  return [...(social.websites ?? [])]
    .filter((item) => item.url.trim())
    .map((item) => ({ label: item.label, url: item.url }));
}

export async function exportResumeV2ToMarkdownWithDialog(
  resume: ResumeV2
): Promise<string | null> {
  const md = exportResumeV2ToMarkdown(resume);
  const timestamp = new Date().toISOString().slice(0, 10);
  const filePath = await save({
    filters: [{ name: "Markdown", extensions: ["md"] }],
    defaultPath: `resume-${timestamp}.md`,
  });
  if (!filePath) return null;
  await writeTextFile(filePath, md);
  return filePath;
}

export async function exportResumeV2ToDocxWithDialog(
  resume: ResumeV2
): Promise<string | null> {
  const timestamp = new Date().toISOString().slice(0, 10);
  const name = resume.personalInfo?.basic.name?.trim();
  const direction = DIRECTION_TITLE[resume.jobDirection] ?? resume.jobDirection;
  const defaultPath = name
    ? `${name}-${direction}-${timestamp}.docx`
    : `resume-${timestamp}.docx`;
  const filePath = await save({
    filters: [{ name: "Word 文档", extensions: ["docx"] }],
    defaultPath,
  });
  if (!filePath) return null;
  await invoke<string>("export_resume_docx", {
    resume,
    filePath,
  });
  return filePath;
}
