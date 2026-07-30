import { useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { commands, type StartupStatus } from "@/bindings";

/**
 * 启动致命错误的整屏阻断页。
 *
 * 后端在数据目录不可写、SQLite 打不开、迁移失败或备份恢复失败时会记录
 * fatalError；此时**一条数据都不能加载**——以前是照常渲染空界面，用户以为
 * 数据没了，下一次保存直接把空状态覆盖上去。
 *
 * 这里同时是备份恢复的用户入口：后端早就有 list/restore 命令，但界面上够不到，
 * 真出故障时用户只能干瞪眼。
 */
export function StartupErrorScreen({ status }: { status: StartupStatus }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRestore = async (timestamp: string) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    const res = await commands.restoreFromBackup(timestamp);
    if (res.status === "ok") {
      setMessage(res.data);
    } else {
      // Tauri 的错误是纯字符串，不是 Error 实例
      setError(typeof res.error === "string" && res.error ? res.error : "恢复标记写入失败");
    }
    setBusy(false);
  };

  return (
    <div className="h-screen overflow-auto bg-background p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-destructive">CodeShelf 无法正常启动</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            为避免用空数据覆盖你的原始数据，应用已停止加载。请先处理下面的问题，或从备份恢复。
          </p>
        </div>

        <pre className="whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          {status.fatalError}
        </pre>

        {status.restoreError && (
          <div className="rounded-md border border-border p-4 text-sm">
            <div className="font-medium">上一次备份恢复失败</div>
            <div className="mt-1 break-all text-muted-foreground">{status.restoreError}</div>
            <div className="mt-1 text-muted-foreground">当前数据未被修改。</div>
          </div>
        )}

        <div className="space-y-1 text-sm text-muted-foreground">
          <div className="break-all">数据目录：{status.dataDir || "（无法确定）"}</div>
          <div className="break-all">日志目录：{status.logsDir || "（无法确定）"}</div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">可用备份（新到旧）</div>
          {status.backups.length === 0 ? (
            <div className="text-sm text-muted-foreground">没有找到可用备份。</div>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {status.backups.map((ts) => (
                <li key={ts} className="flex items-center justify-between gap-4 px-4 py-2">
                  <span className="font-mono text-sm">{ts}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleRestore(ts)}
                    className="rounded-md border border-border px-3 py-1 text-sm hover:bg-accent disabled:opacity-50"
                  >
                    从此备份恢复
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            恢复会先把备份复制到临时目录校验，通过后才切换；切换前的数据会保留为
            <code className="mx-1">.restore_previous_*</code>快照。
          </p>
        </div>

        {message && <div className="text-sm text-primary">{message}</div>}
        {error && <div className="text-sm text-destructive">{error}</div>}

        <button
          type="button"
          onClick={() => relaunch()}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
        >
          重启应用
        </button>
      </div>
    </div>
  );
}
