import { AlertCircle, Loader2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui";
import { Modal } from "./Modal";

export type ConfirmVariant = "danger" | "primary" | "warning";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  /** 标题图标，不传则按 variant 自动选 */
  icon?: LucideIcon;
  /** 视觉变体，影响图标背景、确认按钮颜色 */
  variant?: ConfirmVariant;
  /** 确认按钮文字 */
  confirmLabel?: string;
  /** 取消按钮文字 */
  cancelLabel?: string;
  /** 确认中状态：按钮 disabled + 显示 spinner */
  loading?: boolean;
  /** 额外提示（黄色高亮块，常用于"修改后需重启"等说明） */
  notice?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

const VARIANT_STYLES: Record<ConfirmVariant, {
  iconBg: string;
  iconColor: string;
  button: "primary" | "danger";
}> = {
  danger: {
    iconBg: "bg-red-100 dark:bg-red-900/30",
    iconColor: "text-red-500",
    button: "danger",
  },
  primary: {
    iconBg: "bg-blue-100 dark:bg-blue-900/30",
    iconColor: "text-blue-500",
    button: "primary",
  },
  warning: {
    iconBg: "bg-amber-100 dark:bg-amber-900/30",
    iconColor: "text-amber-500",
    button: "primary",
  },
};

/**
 * 简单"再三确认"对话框。带状态的复杂确认（含 radio、输入框等）请用 <Dialog> 槽位版。
 *
 * 同时提供 useConfirm() hook 的 imperative 版本，见 useConfirm.ts。
 */
export function ConfirmDialog({
  open,
  title,
  description,
  icon: IconProp,
  variant = "primary",
  confirmLabel = "确定",
  cancelLabel = "取消",
  loading = false,
  notice,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const styles = VARIANT_STYLES[variant];
  const Icon = IconProp ?? AlertCircle;

  return (
    <Modal open={open} onClose={loading ? () => {} : onCancel} size="sm" closeOnOverlayClick={!loading}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className={`p-2 rounded-full ${styles.iconBg}`}>
            <Icon size={20} className={styles.iconColor} />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
        </div>

        {description && (
          <div className="text-gray-600 dark:text-gray-400 mb-4 text-sm leading-relaxed whitespace-pre-wrap break-all">
            {description}
          </div>
        )}

        {notice && (
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg mb-4 text-xs text-amber-700 dark:text-amber-400">
            {notice}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} variant="secondary" disabled={loading}>
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} disabled={loading} variant={styles.button}>
            {loading && <Loader2 size={14} className="animate-spin mr-1" />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
