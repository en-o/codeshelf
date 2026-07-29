import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

/**
 * 全局右键菜单：补回被 main.tsx 屏蔽掉的原生菜单里真正有用的那部分。
 *
 * 只在两种情况下出现，避免和各处自己写的菜单（项目卡片、PairDrop 等）打架：
 *   - 右键在输入框 / 文本域 / contenteditable 上 → 剪切 复制 粘贴 全选
 *   - 右键时有选中文字 → 复制
 * 其余情况不弹，事件留给组件自己的 onContextMenu 处理。
 */

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

interface MenuState {
  position: { x: number; y: number };
  items: ContextMenuItem[];
}

/** input/textarea 用 selectionStart，contenteditable 和普通文本用 window.getSelection */
function getSelectedText(el: Editable | null): string {
  if (el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    const { selectionStart, selectionEnd, value } = el;
    if (selectionStart == null || selectionEnd == null) return "";
    return value.slice(selectionStart, selectionEnd);
  }
  return window.getSelection()?.toString() ?? "";
}

/**
 * 执行编辑动作前先把焦点和选区还原回去。
 * 右键不一定会让目标获得焦点，而 execCommand 只作用于当前焦点元素；
 * 少了这一步，粘贴会插到别的地方或者干脆没反应。
 */
function restoreFocus(el: Editable, range: [number, number] | null) {
  el.focus();
  if (range && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    el.setSelectionRange(range[0], range[1]);
  }
}

export function AppContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    function onContextMenu(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const editable = target.closest<HTMLElement>(
        "input, textarea, [contenteditable='true']"
      );
      const selected = getSelectedText(editable);
      const items: ContextMenuItem[] = [];

      if (editable) {
        const inputLike =
          editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement;
        const range: [number, number] | null =
          inputLike && editable.selectionStart != null && editable.selectionEnd != null
            ? [editable.selectionStart, editable.selectionEnd]
            : null;
        const readOnly = inputLike && (editable.readOnly || editable.disabled);

        items.push(
          {
            label: "剪切",
            hint: "Ctrl/⌘ X",
            disabled: !selected || readOnly,
            onSelect: () => {
              navigator.clipboard.writeText(selected).catch(() => {});
              restoreFocus(editable, range);
              document.execCommand("delete");
            },
          },
          {
            label: "复制",
            hint: "Ctrl/⌘ C",
            disabled: !selected,
            onSelect: () => {
              navigator.clipboard.writeText(selected).catch(() => {});
            },
          },
          {
            label: "粘贴",
            hint: "Ctrl/⌘ V",
            disabled: readOnly,
            onSelect: async () => {
              // webview 的 navigator.clipboard.readText 受权限/手势限制，读走后端
              const text = await invoke<string>("read_from_clipboard").catch(() => "");
              if (!text) return;
              restoreFocus(editable, range);
              // execCommand 会触发 input 事件，React 受控组件才能收到变化
              document.execCommand("insertText", false, text);
            },
          },
          {
            label: "全选",
            hint: "Ctrl/⌘ A",
            dividerBefore: true,
            onSelect: () => {
              editable.focus();
              if (inputLike) editable.select();
              else document.execCommand("selectAll");
            },
          }
        );
      } else if (selected) {
        items.push({
          label: "复制",
          hint: "Ctrl/⌘ C",
          onSelect: () => {
            navigator.clipboard.writeText(selected).catch(() => {});
          },
        });
      }

      if (items.length === 0) return;
      setMenu({ position: { x: e.clientX, y: e.clientY }, items });
    }

    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  if (!menu) return null;
  return <ContextMenu position={menu.position} items={menu.items} onClose={close} />;
}
