import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { ConfirmDialog, type ConfirmVariant } from "./ConfirmDialog";

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  variant?: ConfirmVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  notice?: ReactNode;
}

/**
 * Imperative 风格确认对话框。
 *
 * 用法：
 * ```tsx
 * const confirm = useConfirm();
 * async function handleDelete() {
 *   const ok = await confirm({ title: "确认删除？", variant: "danger" });
 *   if (!ok) return;
 *   // do delete
 * }
 * ```
 *
 * 必须把 `<ConfirmHost />` 渲染到组件树某处；用根 App 装一次即可。
 * 见 `src/components/common/ConfirmHost.tsx`。
 */

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

type Listener = (pending: PendingConfirm | null) => void;
const listeners = new Set<Listener>();
let current: PendingConfirm | null = null;

function emit(p: PendingConfirm | null) {
  current = p;
  for (const l of listeners) l(p);
}

/**
 * 非 hook 版本，供 service/工具函数在组件外调用（同一个 `<ConfirmHost />`）。
 * 组件里请用 `useConfirm()`。
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // 同一时间只允许一个 confirm；若已经有挂起的，拒绝旧的
    if (current) {
      current.resolve(false);
    }
    emit({ options, resolve });
  });
}

export function useConfirm() {
  return useCallback(confirmDialog, []);
}

/**
 * 内部 host 组件，订阅 listeners 并渲染当前 pending confirm。
 * 调用方应在根处渲染一次（在 ConfirmHost.tsx 中暴露）。
 */
export function useConfirmHostState() {
  const [pending, setPending] = useState<PendingConfirm | null>(current);

  useEffect(() => {
    const listener: Listener = (p) => setPending(p);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const handleConfirm = useCallback(() => {
    if (!pending) return;
    pending.resolve(true);
    emit(null);
  }, [pending]);

  const handleCancel = useCallback(() => {
    if (!pending) return;
    pending.resolve(false);
    emit(null);
  }, [pending]);

  return { pending, handleConfirm, handleCancel };
}

/**
 * 把这个组件渲染到根（如 App.tsx 顶层）来启用 useConfirm。
 */
export function ConfirmHost() {
  const { pending, handleConfirm, handleCancel } = useConfirmHostState();

  if (!pending) return null;

  return createPortal(
    <ConfirmDialog
      open={true}
      title={pending.options.title}
      description={pending.options.description}
      icon={pending.options.icon}
      variant={pending.options.variant}
      confirmLabel={pending.options.confirmLabel}
      cancelLabel={pending.options.cancelLabel}
      notice={pending.options.notice}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />,
    document.body,
  );
}
