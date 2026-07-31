import { useEffect, useMemo, useState } from "react";
import { Download, Edit2, FileUp, Plus, Trash2, Upload, X } from "lucide-react";
import { showToast } from "@/components/ui";
import type { ApiEndpoint, ApiGroup } from "@/types";
import {
  deleteApiEndpoint,
  deleteApiGroup,
  listApiEndpoints,
  listApiGroups,
  saveApiEndpoint,
  saveApiGroup,
} from "@/services/api_chat";
import { GroupEditor } from "./GroupEditor";
import { EndpointEditor } from "./EndpointEditor";
import {
  LibraryImportDraftDialog,
  type ImportDraft,
} from "./LibraryImportDraftDialog";
import {
  LibraryDeleteConfirmDialog,
  LibraryDocumentImportChoice,
  LibraryDocumentImportUrl,
  type PendingDelete,
} from "./LibraryDialogs";
import { exportApiLibrary, importApiLibrary } from "../utils/exportLibrary";
import { importOpenApiDocument, importOpenApiDocumentFromUrl } from "../utils/importOpenApiDocument";
import { errMsg } from "@/utils/errMsg";

interface LibraryManagerDialogProps {
  open: boolean;
  onClose: () => void;
  /** 关闭时外部可以重新拉一次列表 */
  onChanged?: () => void;
}

type EditingGroup = { kind: "group"; data?: ApiGroup };
type EditingEndpoint = { kind: "endpoint"; data?: ApiEndpoint };
type Editing = EditingGroup | EditingEndpoint | null;

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

export function LibraryManagerDialog({ open, onClose, onChanged }: LibraryManagerDialogProps) {
  const [groups, setGroups] = useState<ApiGroup[]>([]);
  const [endpoints, setEndpoints] = useState<ApiEndpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | "__all__" | "__orphan__">("__all__");
  const [documentImportChoiceOpen, setDocumentImportChoiceOpen] = useState(false);
  const [documentUrlDialogOpen, setDocumentUrlDialogOpen] = useState(false);
  const [documentUrl, setDocumentUrl] = useState("");
  const [importDraft, setImportDraft] = useState<ImportDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [selectedEndpointIds, setSelectedEndpointIds] = useState<Set<string>>(new Set());

  async function reload() {
    setLoading(true);
    try {
      const [g, e] = await Promise.all([listApiGroups(), listApiEndpoints()]);
      setGroups(g);
      setEndpoints(e);
    } catch (err) {
      showToast("error", errMsg(err, "加载失败"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      reload();
      setEditing(null);
      setActiveGroupId("__all__");
      setDocumentImportChoiceOpen(false);
      setDocumentUrlDialogOpen(false);
      setDocumentUrl("");
      setImportDraft(null);
      setPendingDelete(null);
      setSelectedEndpointIds(new Set());
    }
  }, [open]);

  const filteredEndpoints = useMemo(() => {
    if (activeGroupId === "__all__") return endpoints;
    if (activeGroupId === "__orphan__") return endpoints.filter((e) => !e.groupId);
    return endpoints.filter((e) => e.groupId === activeGroupId);
  }, [endpoints, activeGroupId]);

  useEffect(() => {
    setSelectedEndpointIds((prev) => {
      const visibleIds = new Set(filteredEndpoints.map((ep) => ep.id));
      return new Set(Array.from(prev).filter((id) => visibleIds.has(id)));
    });
  }, [filteredEndpoints]);

  const importSelectedCount = useMemo(() => {
    if (!importDraft) return { groups: 0, endpoints: 0 };
    const endpointGroupIds = new Set(
      importDraft.endpoints
        .filter((ep) => importDraft.selectedEndpointIds.has(ep.id))
        .map((ep) => ep.groupId)
        .filter((id): id is string => Boolean(id)),
    );
    return {
      groups: importDraft.groups.filter((g) => importDraft.selectedGroupIds.has(g.id) || endpointGroupIds.has(g.id)).length,
      endpoints: importDraft.selectedEndpointIds.size,
    };
  }, [importDraft]);

  function findGroupConflict(g: ApiGroup): ApiGroup | undefined {
    const name = normalizeKey(g.name);
    return groups.find((existing) => existing.id === g.id || normalizeKey(existing.name) === name);
  }

  function findEndpointConflict(ep: ApiEndpoint, mappedGroupId?: string): ApiEndpoint | undefined {
    if (endpoints.some((existing) => existing.id === ep.id)) {
      return endpoints.find((existing) => existing.id === ep.id);
    }
    const importedGroup = importDraft?.groups.find((g) => g.id === ep.groupId);
    const existingGroup = importedGroup ? findGroupConflict(importedGroup) : undefined;
    const targetGroupId = mappedGroupId ?? existingGroup?.id ?? ep.groupId;
    return endpoints.find((existing) => {
      const sameGroup = (existing.groupId ?? "") === (targetGroupId ?? "");
      return sameGroup && existing.method === ep.method && existing.url === ep.url;
    });
  }

  function openImportDraft(title: string, incomingGroups: ApiGroup[], incomingEndpoints: ApiEndpoint[]) {
    setImportDraft({
      title,
      groups: incomingGroups,
      endpoints: incomingEndpoints,
      selectedGroupIds: new Set(incomingGroups.map((g) => g.id)),
      selectedEndpointIds: new Set(incomingEndpoints.map((ep) => ep.id)),
      strategy: "overwrite",
    });
  }

  function toggleImportGroup(groupId: string) {
    setImportDraft((draft) => {
      if (!draft) return draft;
      const selectedGroupIds = new Set(draft.selectedGroupIds);
      if (selectedGroupIds.has(groupId)) selectedGroupIds.delete(groupId);
      else selectedGroupIds.add(groupId);
      return { ...draft, selectedGroupIds };
    });
  }

  function toggleImportEndpoint(endpointId: string) {
    setImportDraft((draft) => {
      if (!draft) return draft;
      const selectedEndpointIds = new Set(draft.selectedEndpointIds);
      if (selectedEndpointIds.has(endpointId)) selectedEndpointIds.delete(endpointId);
      else selectedEndpointIds.add(endpointId);
      return { ...draft, selectedEndpointIds };
    });
  }

  function selectAllImportDraft() {
    setImportDraft((draft) => draft
      ? {
          ...draft,
          selectedGroupIds: new Set(draft.groups.map((g) => g.id)),
          selectedEndpointIds: new Set(draft.endpoints.map((ep) => ep.id)),
        }
      : draft,
    );
  }

  function clearImportDraftSelection() {
    setImportDraft((draft) => draft
      ? { ...draft, selectedGroupIds: new Set(), selectedEndpointIds: new Set() }
      : draft,
    );
  }

  async function handleSaveGroup(g: ApiGroup) {
    try {
      await saveApiGroup(g);
      showToast("success", "已保存");
      setEditing(null);
      await reload();
      onChanged?.();
    } catch (err) {
      showToast("error", errMsg(err, "保存失败"));
    }
  }

  async function handleSaveEndpoint(e: ApiEndpoint) {
    try {
      await saveApiEndpoint(e);
      showToast("success", "已保存");
      setEditing(null);
      await reload();
      onChanged?.();
    } catch (err) {
      showToast("error", errMsg(err, "保存失败"));
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      if (pendingDelete.kind === "group") {
        await deleteApiGroup(pendingDelete.data.id);
      } else if (pendingDelete.kind === "endpoint") {
        await deleteApiEndpoint(pendingDelete.data.id);
      } else {
        for (const ep of pendingDelete.data) {
          await deleteApiEndpoint(ep.id);
        }
      }
      setPendingDelete(null);
      setSelectedEndpointIds(new Set());
      await reload();
      onChanged?.();
    } catch (err) {
      showToast("error", errMsg(err, "删除失败"));
    }
  }

  function toggleEndpointSelection(endpointId: string) {
    setSelectedEndpointIds((prev) => {
      const next = new Set(prev);
      if (next.has(endpointId)) next.delete(endpointId);
      else next.add(endpointId);
      return next;
    });
  }

  function toggleAllVisibleEndpoints() {
    setSelectedEndpointIds((prev) => {
      if (filteredEndpoints.length > 0 && filteredEndpoints.every((ep) => prev.has(ep.id))) {
        return new Set();
      }
      return new Set(filteredEndpoints.map((ep) => ep.id));
    });
  }

  function openBatchDeleteEndpoints() {
    const selected = filteredEndpoints.filter((ep) => selectedEndpointIds.has(ep.id));
    if (selected.length === 0) return;
    setPendingDelete({ kind: "endpoints", data: selected });
  }

  async function handleExport() {
    if (groups.length === 0 && endpoints.length === 0) {
      showToast("warning", "接口库为空，无可导出内容");
      return;
    }
    try {
      const ok = await exportApiLibrary(groups, endpoints);
      if (ok) {
        showToast("success", `已导出 ${groups.length} 个分组 / ${endpoints.length} 个接口`);
      }
    } catch (err) {
      showToast("error", errMsg(err, "导出失败"));
    }
  }

  async function handleImport() {
    try {
      const parsed = await importApiLibrary();
      if (!parsed) return;
      const totalIncoming = parsed.groups.length + parsed.endpoints.length;
      if (totalIncoming === 0) {
        showToast("info", "文件中没有可导入的数据");
        return;
      }
      openImportDraft("接口库备份", parsed.groups, parsed.endpoints);
    } catch (err) {
      showToast("error", errMsg(err, "导入失败"));
    }
  }

  async function applyImportDraft() {
    if (!importDraft) return;
    if (importSelectedCount.groups + importSelectedCount.endpoints === 0) {
      showToast("warning", "请至少选择一个分组或接口");
      return;
    }
    setLoading(true);
    try {
      let gAdded = 0;
      let gUpdated = 0;
      let gIgnored = 0;
      let eAdded = 0;
      let eUpdated = 0;
      let eIgnored = 0;
      const groupIdMap = new Map<string, string>();
      const selectedEndpointGroupIds = new Set(
        importDraft.endpoints
          .filter((ep) => importDraft.selectedEndpointIds.has(ep.id))
          .map((ep) => ep.groupId)
          .filter((id): id is string => Boolean(id)),
      );

      for (const g of importDraft.groups) {
        if (!importDraft.selectedGroupIds.has(g.id) && !selectedEndpointGroupIds.has(g.id)) continue;
        const conflict = findGroupConflict(g);
        try {
          if (conflict && importDraft.strategy === "ignore") {
            groupIdMap.set(g.id, conflict.id);
            gIgnored += 1;
            continue;
          }
          const saved = await saveApiGroup(conflict ? { ...g, id: conflict.id, createdAt: conflict.createdAt } : g);
          groupIdMap.set(g.id, saved.id);
          if (conflict) gUpdated += 1;
          else gAdded += 1;
        } catch (err) {
          showToast(
            "error",
            `导入分组「${g.name}」失败：${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      for (const ep of importDraft.endpoints) {
        if (!importDraft.selectedEndpointIds.has(ep.id)) continue;
        const mappedGroupId = ep.groupId ? groupIdMap.get(ep.groupId) ?? ep.groupId : undefined;
        const conflict = findEndpointConflict(ep, mappedGroupId);
        try {
          if (conflict && importDraft.strategy === "ignore") {
            eIgnored += 1;
            continue;
          }
          await saveApiEndpoint(conflict
            ? { ...ep, id: conflict.id, groupId: mappedGroupId, createdAt: conflict.createdAt }
            : { ...ep, groupId: mappedGroupId },
          );
          if (conflict) eUpdated += 1;
          else eAdded += 1;
        } catch (err) {
          showToast(
            "error",
            `导入接口「${ep.name}」失败：${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      setImportDraft(null);
      await reload();
      onChanged?.();
      showToast(
        "success",
        `导入完成：分组新增 ${gAdded} 覆盖 ${gUpdated} 忽略 ${gIgnored}，接口新增 ${eAdded} 覆盖 ${eUpdated} 忽略 ${eIgnored}`,
      );
    } finally {
      setLoading(false);
    }
  }

  /** 有被跳过的内容就如实告知，别让用户以为全部导入成功了 */
  function reportSkipped(skipped: string[]) {
    if (skipped.length === 0) return;
    showToast(
      "warning",
      `已跳过 ${skipped.length} 个接口`,
      skipped.slice(0, 5).join("、") + (skipped.length > 5 ? ` 等 ${skipped.length} 项` : ""),
    );
  }

  async function handleImportDocument() {
    setDocumentImportChoiceOpen(false);
    try {
      const parsed = await importOpenApiDocument();
      if (!parsed) return;
      openImportDraft(parsed.title, parsed.groups, parsed.endpoints);
      reportSkipped(parsed.skipped);
    } catch (err) {
      showToast("error", errMsg(err, "导入接口文档失败"));
    }
  }

  async function handleImportDocumentUrl() {
    setDocumentImportChoiceOpen(false);
    setDocumentUrlDialogOpen(true);
  }

  async function submitImportDocumentUrl() {
    const trimmed = documentUrl.trim();
    if (!trimmed) return;
    try {
      setLoading(true);
      setDocumentUrlDialogOpen(false);
      const parsed = await importOpenApiDocumentFromUrl(trimmed);
      setLoading(false);
      openImportDraft(parsed.title, parsed.groups, parsed.endpoints);
      reportSkipped(parsed.skipped);
      setDocumentUrl("");
    } catch (err) {
      showToast("error", errMsg(err, "导入在线接口文档失败"));
      setLoading(false);
      setDocumentUrlDialogOpen(true);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-lg w-[960px] max-w-[95vw] h-[720px] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="text-sm font-semibold">📚 接口库管理</div>
          <div className="flex items-center gap-1">
            <button
              className="px-2 py-1 text-xs border border-gray-200 rounded text-gray-600 hover:bg-gray-50 flex items-center gap-1 disabled:opacity-50"
              onClick={handleImport}
              disabled={loading}
              title="从 JSON 文件导入（按 ID 合并，同 ID 将覆盖）"
            >
              <Upload size={12} /> 导入备份
            </button>
            <button
              className="px-2 py-1 text-xs border border-gray-200 rounded text-gray-600 hover:bg-gray-50 flex items-center gap-1 disabled:opacity-50"
              onClick={() => setDocumentImportChoiceOpen(true)}
              disabled={loading}
              title="导入 OpenAPI 3.0/3.1、Swagger 2.0 或 Apifox 导出的 JSON/YAML 文档"
            >
              <FileUp size={12} /> 导入文档
            </button>
            <button
              className="px-2 py-1 text-xs border border-gray-200 rounded text-gray-600 hover:bg-gray-50 flex items-center gap-1 disabled:opacity-50"
              onClick={handleExport}
              disabled={loading || (groups.length === 0 && endpoints.length === 0)}
              title="导出为 JSON（⚠️ 包含鉴权凭据，请妥善保管）"
            >
              <Download size={12} /> 导出
            </button>
            <button className="text-gray-400 hover:text-gray-700 ml-1" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* 左侧分组列表 */}
          <div className="w-64 border-r border-gray-200 flex flex-col">
            <div className="flex items-center justify-between p-3">
              <div className="text-xs font-semibold text-gray-700">分组</div>
              <button
                className="text-blue-500 hover:underline text-xs flex items-center gap-1"
                onClick={() => setEditing({ kind: "group", data: undefined })}
              >
                <Plus size={12} /> 新建
              </button>
            </div>
            <div className="flex-1 overflow-auto px-2 pb-2 space-y-1 text-xs">
              <button
                className={`w-full text-left px-2 py-1.5 rounded ${activeGroupId === "__all__" ? "bg-blue-50 text-blue-600" : "hover:bg-gray-50"}`}
                onClick={() => setActiveGroupId("__all__")}
              >
                全部接口（{endpoints.length}）
              </button>
              <button
                className={`w-full text-left px-2 py-1.5 rounded ${activeGroupId === "__orphan__" ? "bg-blue-50 text-blue-600" : "hover:bg-gray-50"}`}
                onClick={() => setActiveGroupId("__orphan__")}
              >
                独立接口（{endpoints.filter((e) => !e.groupId).length}）
              </button>
              <div className="border-t border-gray-100 my-2" />
              {groups.map((g) => (
                <div
                  key={g.id}
                  className={`group flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer ${activeGroupId === g.id ? "bg-blue-50 text-blue-600" : "hover:bg-gray-50"}`}
                  onClick={() => setActiveGroupId(g.id)}
                >
                  <span className="flex-1 truncate" title={g.name}>{g.name}</span>
                  <span className="text-[10px] text-gray-400">
                    {endpoints.filter((e) => e.groupId === g.id).length}
                  </span>
                  <button
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setEditing({ kind: "group", data: g });
                    }}
                    title="编辑"
                  >
                    <Edit2 size={11} />
                  </button>
                  <button
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setPendingDelete({ kind: "group", data: g });
                    }}
                    title="删除"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
              {!loading && groups.length === 0 && (
                <div className="text-gray-400 px-2">暂无分组</div>
              )}
            </div>
          </div>

          {/* 右侧接口列表 / 编辑器 */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div className="text-xs font-semibold text-gray-700">
                接口（{filteredEndpoints.length}）
              </div>
              <div className="flex items-center gap-3">
                {selectedEndpointIds.size > 0 && (
                  <button
                    className="text-red-500 hover:underline text-xs flex items-center gap-1"
                    onClick={openBatchDeleteEndpoints}
                  >
                    <Trash2 size={12} /> 删除所选 {selectedEndpointIds.size}
                  </button>
                )}
                <button
                  className="text-blue-500 hover:underline text-xs flex items-center gap-1"
                  onClick={() =>
                    setEditing({
                      kind: "endpoint",
                      data: undefined,
                    })
                  }
                  title={activeGroupId !== "__all__" && activeGroupId !== "__orphan__" ? "新接口将默认放入当前分组" : undefined}
                >
                  <Plus size={12} /> 新建接口
                </button>
              </div>
            </div>

            <div className="flex-1 flex min-h-0">
              <div className="w-[46%] border-r border-gray-200 overflow-auto">
                {filteredEndpoints.length > 0 && (
                  <label className="flex items-center gap-2 px-3 py-2 text-xs border-b border-gray-100 bg-gray-50 text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filteredEndpoints.every((ep) => selectedEndpointIds.has(ep.id))}
                      onChange={toggleAllVisibleEndpoints}
                    />
                    <span>全选当前列表</span>
                  </label>
                )}
                {filteredEndpoints.map((ep) => (
                  <div
                    key={ep.id}
                    className={`group flex items-center gap-2 px-3 py-2 text-xs border-b border-gray-100 cursor-pointer ${
                      editing?.kind === "endpoint" && editing.data?.id === ep.id ? "bg-blue-50" : "hover:bg-gray-50"
                    }`}
                    onClick={() => setEditing({ kind: "endpoint", data: ep })}
                  >
                    <input
                      type="checkbox"
                      checked={selectedEndpointIds.has(ep.id)}
                      onChange={() => toggleEndpointSelection(ep.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span
                      className={`font-mono px-1.5 py-0.5 rounded text-[10px] ${
                        ep.method === "GET"
                          ? "bg-green-100 text-green-700"
                          : ep.method === "DELETE"
                          ? "bg-red-100 text-red-700"
                          : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {ep.method}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{ep.name}</div>
                      <div className="truncate text-gray-400 font-mono text-[10px]">{ep.url}</div>
                    </div>
                    <button
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete({ kind: "endpoint", data: ep });
                      }}
                      title="删除"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
                {!loading && filteredEndpoints.length === 0 && (
                  <div className="p-4 text-gray-400 text-xs">暂无接口</div>
                )}
              </div>

              <div className="flex-1 overflow-auto p-4 min-w-0">
                {editing?.kind === "group" ? (
                  <GroupEditor
                    initial={editing.data}
                    onCancel={() => setEditing(null)}
                    onSave={handleSaveGroup}
                  />
                ) : editing?.kind === "endpoint" ? (
                  <EndpointEditor
                    initial={editing.data}
                    initialGroupId={
                      editing.data
                        ? undefined
                        : activeGroupId !== "__all__" && activeGroupId !== "__orphan__"
                          ? activeGroupId
                          : undefined
                    }
                    groups={groups}
                    onCancel={() => setEditing(null)}
                    onSave={handleSaveEndpoint}
                  />
                ) : (
                  <div className="text-gray-400 text-xs">在左侧选择或新建</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {pendingDelete && (
        <LibraryDeleteConfirmDialog
          pendingDelete={pendingDelete}
          loading={loading}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
      {importDraft && (
        <LibraryImportDraftDialog
          draft={importDraft}
          loading={loading}
          selectedCount={importSelectedCount}
          findGroupConflict={findGroupConflict}
          findEndpointConflict={(ep) => findEndpointConflict(ep)}
          onClose={() => setImportDraft(null)}
          onStrategyChange={(strategy) =>
            setImportDraft((draft) => (draft ? { ...draft, strategy } : draft))
          }
          onToggleGroup={toggleImportGroup}
          onToggleEndpoint={toggleImportEndpoint}
          onSelectAll={selectAllImportDraft}
          onClearSelection={clearImportDraftSelection}
          onApply={applyImportDraft}
        />
      )}
      {documentImportChoiceOpen && (
        <LibraryDocumentImportChoice
          onClose={() => setDocumentImportChoiceOpen(false)}
          onPickLocal={handleImportDocument}
          onPickUrl={handleImportDocumentUrl}
        />
      )}
      {documentUrlDialogOpen && (
        <LibraryDocumentImportUrl
          value={documentUrl}
          loading={loading}
          onChange={setDocumentUrl}
          onClose={() => setDocumentUrlDialogOpen(false)}
          onSubmit={submitImportDocumentUrl}
        />
      )}
    </div>
  );
}
