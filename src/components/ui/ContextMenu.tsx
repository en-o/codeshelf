import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  /** 右侧灰色提示，通常是快捷键 */
  hint?: string;
  disabled?: boolean;
  /** 在这一项之前画一条分隔线 */
  dividerBefore?: boolean;
}

interface ContextMenuProps {
  /** 视口坐标（clientX / clientY） */
  position: { x: number; y: number };
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * 通用右键菜单：只管渲染、定位防溢出、点外面 / ESC / 滚动时关闭。
 * 菜单项的业务逻辑由调用方决定。
 *
 * 项目里原先有三份各自实现的菜单（EditorContextMenu / TerminalContextMenu /
 * PairDrop），重复的都是这些壳逻辑，新菜单一律用这个组件。
 */
export function ContextMenu({ position, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(position);

  // 用 layout effect 在绘制前修正位置，避免菜单先在溢出处闪一帧
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const x = position.x + width > window.innerWidth ? window.innerWidth - width - 8 : position.x;
    const y = position.y + height > window.innerHeight ? window.innerHeight - height - 8 : position.y;
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [position]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // 滚动时菜单会与目标脱节，直接关掉
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  if (items.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[180px] p-1 rounded-lg bg-white border border-gray-200 shadow-lg animate-[contextMenuIn_0.12s_ease-out]"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item, i) => (
        <div key={`${item.label}-${i}`}>
          {item.dividerBefore && <div className="my-1 h-px bg-gray-200" />}
          <button
            disabled={item.disabled}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
            className="w-full flex items-center justify-between gap-6 px-3 py-1.5 rounded text-left text-sm text-gray-900 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default"
          >
            <span>{item.label}</span>
            {item.hint && <span className="text-xs text-gray-500">{item.hint}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}
