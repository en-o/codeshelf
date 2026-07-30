import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Plus, Play, Pencil, Trash2, Power, CheckCircle2, XCircle, Clock } from "lucide-react";
import { MacWindowControls } from "@/components/layout/MacWindowControls";
import { useSettingsStore } from "@/stores/settingsStore";
import { showToast } from "@/components/ui";
import {
  listWorkflows,
  deleteWorkflow,
  runWorkflowNow,
  setWorkflowEnabled,
  type Workflow,
} from "@/services/workflows";
import { WorkflowEditor } from "./WorkflowEditor";
import { RunDetail } from "./RunDetail";
import { errMsg } from "@/utils/errMsg";

function statusBadge(w: Workflow) {
  const s = w.lastRun?.status;
  if (s === "success") return <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 size={12} />成功</span>;
  if (s === "failure") return <span className="text-red-500 flex items-center gap-1"><XCircle size={12} />失败</span>;
  if (s === "running") return <span className="text-blue-500 flex items-center gap-1 animate-pulse"><Clock size={12} />运行中</span>;
  return <span className="text-gray-400">尚未运行</span>;
}

export function WorkflowsPage() {
  const { sidebarCollapsed, setSidebarCollapsed } = useSettingsStore();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setWorkflows(await listWorkflows());
    } catch (e) {
      showToast("error", errMsg(e, "加载失败"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const p = listen("workflow-run-changed", () => refresh());
    return () => { p.then((u) => u()); };
  }, []);

  async function handleRun(w: Workflow) {
    try {
      showToast("info", "已触发，正在运行…");
      await runWorkflowNow(w.id);
      showToast("success", "运行完成");
      refresh();
    } catch (e) {
      showToast("error", errMsg(e, "运行失败"));
    }
  }

  async function handleDelete(w: Workflow) {
    if (!confirm(`确认删除工作流「${w.name}」？`)) return;
    try {
      await deleteWorkflow(w.id);
      refresh();
      showToast("success", "已删除");
    } catch (e) {
      showToast("error", errMsg(e, "删除失败"));
    }
  }

  async function handleToggle(w: Workflow) {
    try {
      await setWorkflowEnabled(w.id, !w.enabled);
      refresh();
    } catch (e) {
      showToast("error", errMsg(e, "操作失败"));
    }
  }

  function openNew() {
    setEditing(null);
    setEditorOpen(true);
  }
  function openEdit(w: Workflow) {
    setEditing(w);
    setEditorOpen(true);
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <header className="re-header sticky top-0 z-20" data-tauri-drag-region>
        <span className="toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>☰</span>
        <div className="flex-1 flex items-center gap-3" data-tauri-drag-region>
          <span className="text-lg font-semibold ml-2">⚡ 工作流</span>
          <span className="text-[11px] text-gray-400">定时抓取 / LLM 处理 / 推送到飞书·企微·HTTP</span>
        </div>
        <div className="re-actions flex items-center gap-2">
          <button className="px-3 py-1 text-xs bg-blue-500 text-white rounded-lg flex items-center gap-1" onClick={openNew}>
            <Plus size={12} /> 新建
          </button>
          <MacWindowControls />
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-auto p-5">
        {loading && <div className="text-xs text-gray-400">加载中…</div>}
        {!loading && workflows.length === 0 && (
          <div className="re-card p-6 text-center text-gray-500 text-sm">
            还没有工作流。点击右上「新建」创建一个，比如：每天 9 点抓新闻 → LLM 总结 → 推送飞书。
          </div>
        )}
        <div className="space-y-3">
          {workflows.map((w) => (
            <div key={w.id} className="re-card p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold text-gray-800">{w.name}</div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${w.enabled ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-500"}`}>
                      {w.enabled ? "已启用" : "已禁用"}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1 flex items-center gap-3 flex-wrap">
                    <span className="font-mono">cron: {w.cron || "（仅手动）"}</span>
                    <span>节点：{w.nodes.length}</span>
                    {statusBadge(w)}
                    {w.lastRun && (
                      <button className="text-blue-500 hover:underline" onClick={() => setDetailId(w.id)}>
                        查看上次运行
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button title="立即运行" className="p-1.5 text-gray-500 hover:text-emerald-600" onClick={() => handleRun(w)}>
                    <Play size={14} />
                  </button>
                  <button title={w.enabled ? "禁用" : "启用"} className="p-1.5 text-gray-500 hover:text-blue-500" onClick={() => handleToggle(w)}>
                    <Power size={14} />
                  </button>
                  <button title="编辑" className="p-1.5 text-gray-500 hover:text-blue-500" onClick={() => openEdit(w)}>
                    <Pencil size={14} />
                  </button>
                  <button title="删除" className="p-1.5 text-gray-500 hover:text-red-500" onClick={() => handleDelete(w)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      <WorkflowEditor
        open={editorOpen}
        workflow={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={() => { setEditorOpen(false); refresh(); }}
      />
      <RunDetail
        id={detailId}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}
