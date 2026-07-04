// ResumePanelV2 的三个对话框（从 ResumePanelV2.tsx 抽出，行为不变）。

import { Sparkles, Plus, Loader2, Check, FileText as FileIcon } from "lucide-react";
import { Button } from "@/components/ui";
import { Dialog, EmptyState } from "@/components/common";
import type { ProjectKnowledge } from "@/types/resume";
import { refineTaskMeta, formatRelativeTime, type RefineTask } from "./resumePanelHelpers";

export function RefineInstructionDialog({
  task,
  value,
  running,
  onChange,
  onCancel,
  onConfirm,
}: {
  task: RefineTask | null;
  value: string;
  running: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const meta = task ? refineTaskMeta(task) : null;
  return (
    <Dialog
      open={!!task}
      onClose={onCancel}
      title={meta?.title ?? "生成 / 润色"}
      icon={Sparkles}
      size="md"
      closeOnOverlayClick={!running}
      footer={
        <>
          <Button onClick={onCancel} variant="secondary" disabled={running}>
            取消
          </Button>
          <Button onClick={onConfirm} variant="primary" disabled={running} className="gap-1">
            {running && <Loader2 size={14} className="animate-spin" />}
            {running ? "处理中..." : "确认"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-6 text-gray-600">{meta?.description}</p>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">
            补充要求（选填）
          </span>
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={5}
            className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm leading-relaxed text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={meta?.placeholder}
          />
        </label>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-500">
          留空时会使用默认策略：保留事实边界，不虚构数据，增强专业表达和信息密度。
        </div>
      </div>
    </Dialog>
  );
}

export function AddProjectExperienceDialog({
  open,
  docs,
  selectedProjectIds,
  running,
  onToggle,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  docs: ProjectKnowledge[];
  selectedProjectIds: string[];
  running: boolean;
  onToggle: (projectId: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="新增项目经历"
      icon={Plus}
      size="md"
      closeOnOverlayClick={!running}
      footer={
        <>
          <Button onClick={onCancel} variant="secondary" disabled={running}>
            取消
          </Button>
          <Button
            onClick={onConfirm}
            variant="primary"
            disabled={running || selectedProjectIds.length === 0}
            className="gap-1"
          >
            {running && <Loader2 size={14} className="animate-spin" />}
            {running ? "生成中..." : `生成 ${selectedProjectIds.length} 个项目经历`}
          </Button>
        </>
      }
    >
      {docs.length === 0 ? (
        <EmptyState
          icon={FileIcon}
          title="没有可新增的背景知识"
          description="当前已有背景知识都已经生成过项目经历了。"
          className="py-8"
        />
      ) : (
        <div className="space-y-2">
          <p className="text-sm leading-6 text-gray-600">
            可从尚未生成项目经历的背景知识中选择，直接新增到当前简历。
          </p>
          <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
            {docs.map((doc) => {
              const checked = selectedProjectIds.includes(doc.projectId);
              return (
                <button
                  key={doc.projectId}
                  type="button"
                  onClick={() => onToggle(doc.projectId)}
                  className={`flex w-full items-start justify-between rounded-xl border px-3 py-3 text-left transition ${
                    checked
                      ? "border-emerald-300 bg-emerald-50"
                      : "border-gray-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/40"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-900">{doc.projectName}</div>
                    <div className="mt-1 truncate text-xs text-gray-500">{doc.projectPath}</div>
                    <div className="mt-1 text-[11px] text-gray-400">
                      最近更新于 {formatRelativeTime(doc.updatedAt)}
                    </div>
                  </div>
                  <span
                    className={`ml-3 mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border ${
                      checked
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-gray-300 bg-white text-transparent"
                    }`}
                  >
                    <Check size={12} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function GenerateProjectSelectionDialog({
  open,
  docs,
  generatedProjectIds,
  selectedProjectIds,
  running,
  onToggle,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  docs: ProjectKnowledge[];
  generatedProjectIds: Set<string>;
  selectedProjectIds: string[];
  running: boolean;
  onToggle: (projectId: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="选择项目背景知识"
      icon={Sparkles}
      size="lg"
      closeOnOverlayClick={!running}
      footer={
        <>
          <Button onClick={onCancel} variant="secondary" disabled={running}>
            取消
          </Button>
          <Button
            onClick={onConfirm}
            variant="primary"
            disabled={running || selectedProjectIds.length === 0}
            className="gap-1"
          >
            {running && <Loader2 size={14} className="animate-spin" />}
            {running ? "生成中..." : `生成 ${selectedProjectIds.length} 个项目内容`}
          </Button>
        </>
      }
    >
      {docs.length === 0 ? (
        <EmptyState
          icon={FileIcon}
          title="没有可用的背景知识"
          description="请先到背景知识页生成至少一份项目背景知识。"
          className="py-8"
        />
      ) : (
        <div className="space-y-3">
          <p className="text-sm leading-6 text-gray-600">
            默认勾选尚未生成项目经历的项目。你也可以手动选择已生成项目，重新生成对应内容。
          </p>
          <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
            {docs.map((doc) => {
              const checked = selectedProjectIds.includes(doc.projectId);
              const generated = generatedProjectIds.has(doc.projectId);
              return (
                <button
                  key={doc.projectId}
                  type="button"
                  onClick={() => onToggle(doc.projectId)}
                  className={`flex w-full items-start justify-between rounded-xl border px-3 py-3 text-left transition ${
                    checked
                      ? "border-emerald-300 bg-emerald-50"
                      : "border-gray-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/40"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-medium text-gray-900">{doc.projectName}</div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          generated
                            ? "bg-blue-100 text-blue-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {generated ? "已生成项目经历" : "未生成项目经历"}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-xs text-gray-500">{doc.projectPath}</div>
                    <div className="mt-1 text-[11px] text-gray-400">
                      最近更新于 {formatRelativeTime(doc.updatedAt)}
                    </div>
                  </div>
                  <span
                    className={`ml-3 mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border ${
                      checked
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-gray-300 bg-white text-transparent"
                    }`}
                  >
                    <Check size={12} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Dialog>
  );
}
