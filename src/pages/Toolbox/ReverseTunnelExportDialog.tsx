// 内网穿透「导出」弹窗：按分组勾选要导出的映射。参考 SSH 隧道的 ExportDialog。

import { useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { DEFAULT_SSH_GROUP } from "@/types/toolbox";
import type { ReverseTunnel } from "@/types/toolbox";

interface ExportDialogProps {
  tunnels: ReverseTunnel[];
  onCancel: () => void;
  onConfirm: (selectedIds: string[]) => void;
}

export function ReverseTunnelExportDialog({ tunnels, onCancel, onConfirm }: ExportDialogProps) {
  // 打开时快照一次，避免 2 秒轮询导致列表 / 勾选跳动
  const [items] = useState(() => tunnels);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map((t) => t.id)));

  // 按分组聚合（默认分组置顶，其余按名）
  const groups = useMemo(() => {
    const map = new Map<string, ReverseTunnel[]>();
    for (const t of items) {
      const g = t.group || DEFAULT_SSH_GROUP;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(t);
    }
    const names = Array.from(map.keys()).sort((a, b) => {
      if (a === DEFAULT_SSH_GROUP) return -1;
      if (b === DEFAULT_SSH_GROUP) return 1;
      return a.localeCompare(b);
    });
    return names.map((name) => ({ name, items: map.get(name)! }));
  }, [items]);

  const allSelected = items.length > 0 && selected.size === items.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(groupItems: ReverseTunnel[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = groupItems.every((t) => next.has(t.id));
      for (const t of groupItems) {
        if (allOn) next.delete(t.id);
        else next.add(t.id);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((t) => t.id))
    );
  }

  return (
    <div className="fixed inset-0 top-8 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">导出内网穿透</h3>
        <p className="text-xs text-gray-400 mb-4">
          勾选要导出的映射；私钥路径不会被导出，导入后需重新设置
        </p>

        <label className="flex items-center gap-2 cursor-pointer select-none mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="w-4 h-4 accent-emerald-500"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">全选</span>
          <span className="text-xs text-gray-400">
            已选 {selected.size} / {items.length}
          </span>
        </label>

        <div className="space-y-4">
          {groups.map(({ name, items: groupItems }) => {
            const allOn = groupItems.every((t) => selected.has(t.id));
            const someOn = groupItems.some((t) => selected.has(t.id));
            return (
              <div key={name}>
                <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
                  <input
                    type="checkbox"
                    ref={(el) => {
                      if (el) el.indeterminate = someOn && !allOn;
                    }}
                    checked={allOn}
                    onChange={() => toggleGroup(groupItems)}
                    className="w-4 h-4 accent-emerald-500"
                  />
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    {name}
                  </span>
                  <span className="text-xs text-gray-400">{groupItems.length}</span>
                </label>
                <div className="space-y-1.5 pl-6">
                  {groupItems.map((t) => (
                    <label
                      key={t.id}
                      className="flex items-center gap-2 cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        onChange={() => toggle(t.id)}
                        className="w-4 h-4 accent-emerald-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                        {t.name}
                      </span>
                      <span className="text-xs text-gray-400 font-mono truncate">
                        {t.localHost}:{t.localPort} → {t.remoteBindAddr}:{t.remotePort}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button onClick={onCancel} variant="secondary">
            取消
          </Button>
          <Button
            onClick={() => onConfirm(Array.from(selected))}
            variant="primary"
            disabled={selected.size === 0}
          >
            导出所选 ({selected.size})
          </Button>
        </div>
      </div>
    </div>
  );
}
