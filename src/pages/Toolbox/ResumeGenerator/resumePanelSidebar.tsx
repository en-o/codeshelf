// ResumePanelV2 左侧操作栏（从 ResumePanelV2.tsx 抽出，行为不变）。

import { useState } from "react";
import {
  Sparkles,
  Loader2,
  Eye,
  Save,
  FileDown,
  FileText as FileIcon,
  SlidersHorizontal,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import type { JobDirection } from "@/types/resume";
import type { AgentStep } from "@/services/resume/agents/resumeAgent";
import { JOB_OPTIONS, formatStep } from "./resumePanelHelpers";

export function ResumeSidebar({
  ready,
  running,
  busy,
  hasResume,
  knowledgeCount,
  jobDirection,
  onJobDirectionChange,
  onGenerate,
  onPreview,
  onSave,
  onExportDocx,
  onExportMarkdown,
  docxExporting,
  steps,
}: {
  ready: boolean;
  running: boolean;
  busy: boolean;
  hasResume: boolean;
  knowledgeCount: number;
  jobDirection: JobDirection;
  onJobDirectionChange: (d: JobDirection) => void;
  onGenerate: () => void;
  onPreview: () => void;
  onSave: () => void;
  onExportDocx: () => void;
  onExportMarkdown: () => void;
  docxExporting: boolean;
  steps: AgentStep[];
}) {
  const [configOpen, setConfigOpen] = useState(false);
  const direction = JOB_OPTIONS.find((item) => item.id === jobDirection);

  return (
    <aside className="xl:sticky xl:top-4 xl:self-start">
      <div className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm shadow-emerald-900/5">
        <div className="border-b border-emerald-100 bg-emerald-50/70 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-950">
                <Sparkles size={16} className="text-emerald-600" />
                简历生成
              </div>
              <div className="mt-1 text-xs text-emerald-700/75">
                {knowledgeCount} 份背景知识 · {direction?.name ?? "岗位方向"}
              </div>
            </div>
            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-700 shadow-sm">
              AI
            </span>
          </div>
        </div>

        <div className="space-y-4 p-4">
          <button
            type="button"
            onClick={onGenerate}
            disabled={!ready || busy}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-emerald-500/25 transition hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {running ? "生成中..." : hasResume ? "AI 重新生成内容" : "AI 生成简历"}
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onPreview}
              disabled={!hasResume || busy}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Eye size={14} /> 预览
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!hasResume || busy}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save size={14} /> 保存
            </button>
            <button
              type="button"
              onClick={onExportDocx}
              disabled={!hasResume || docxExporting || busy}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {docxExporting ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
              {docxExporting ? "导出中..." : "导出 docx"}
            </button>
            <button
              type="button"
              onClick={onExportMarkdown}
              disabled={!hasResume || busy}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileIcon size={14} /> 导出 MD
            </button>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50/60">
            <button
              type="button"
              onClick={() => setConfigOpen((value) => !value)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
            >
              <span className="inline-flex items-center gap-2 text-xs font-medium text-gray-700">
                <SlidersHorizontal size={14} className="text-gray-500" />
                生成配置
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                {direction?.name}
                {configOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </span>
            </button>

            {configOpen && (
              <div className="border-t border-gray-200 px-3 pb-3 pt-2">
                <div className="mb-2 text-xs font-medium text-gray-600">岗位方向</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {JOB_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onJobDirectionChange(opt.id)}
                      disabled={busy}
                      className={`rounded-lg border px-2 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        jobDirection === opt.id
                          ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                          : "border-gray-200 bg-white text-gray-700 hover:border-emerald-200 hover:bg-white"
                      }`}
                      title={opt.description}
                    >
                      <div className="text-xs font-medium">{opt.name}</div>
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 text-[11px] leading-4 text-gray-400">
                  {direction?.description}
                </div>
              </div>
            )}
          </div>

          {running && steps.length > 0 && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <Loader2 size={13} className="animate-spin" />
                生成过程
              </div>
              <div className="max-h-36 space-y-1 overflow-auto text-[11px] leading-4 text-emerald-700/80">
                {steps.slice(-8).map((step, index) => (
                  <div key={index} className="truncate font-mono">
                    {formatStep(step)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
