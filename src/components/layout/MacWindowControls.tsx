import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, X, Maximize2, Minimize2 } from "lucide-react";

/**
 * macOS 风格窗口控制按钮。
 *
 * 这个组件被 7 个页面各自渲染一份（书架 / 工具箱 / 对话 / 接口 / 流程 /
 * 项目详情 / 通用页头），所以**每次切页面都会销毁重建**。这带来两个必须处理的问题：
 *
 * 1. **纯 CSS `:hover` 会失效**。浏览器只在指针移动时重算 `:hover`，
 *    新节点插入到静止的光标下面时不会自动命中，要等鼠标动一下。
 *    连续切页面而光标恰好停在按钮区域上，就会一直显示灰色。
 *    → 用模块级的指针位置 + `elementFromPoint`，在挂载时补判一次。
 *
 * 2. **重复的 IPC**。原来每次挂载都 `await isMaximized()` 并装一个 resize 监听，
 *    切页面越快调用越密，是切页卡顿的一部分。
 *    → 结果缓存在模块级，resize 监听全局只装一次。
 */

/** 最近一次已知的指针位置，用于挂载时判断光标是否已经停在按钮上。 */
const pointer = { x: -1, y: -1 };
let pointerTracked = false;

function trackPointerOnce() {
  if (pointerTracked || typeof window === "undefined") return;
  pointerTracked = true;
  // passive 且只记两个数，开销可忽略
  window.addEventListener(
    "pointermove",
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    },
    { passive: true },
  );
}

/** 光标此刻是否落在某个窗口控制组内。 */
function pointerIsOverControls(): boolean {
  if (pointer.x < 0) return false;
  const el = document.elementFromPoint(pointer.x, pointer.y);
  return !!el?.closest(".mac-window-controls");
}

/**
 * 最大化状态缓存。
 *
 * 组件被反复重建，但窗口状态是全局的、只因 resize / toggle 改变 ——
 * 没必要每次挂载都问一次后端。
 */
let maximizedCache: boolean | null = null;
const maximizedSubscribers = new Set<(v: boolean) => void>();
let resizeBound = false;

async function refreshMaximized() {
  try {
    const v = await getCurrentWindow().isMaximized();
    if (v === maximizedCache) return;
    maximizedCache = v;
    maximizedSubscribers.forEach((fn) => fn(v));
  } catch {
    /* 窗口不可用时保留上一次的值，不要把状态清成 false */
  }
}

function bindResizeOnce() {
  if (resizeBound || typeof window === "undefined") return;
  resizeBound = true;
  window.addEventListener("resize", () => void refreshMaximized());
}

export function MacWindowControls() {
  const [isMaximized, setIsMaximized] = useState(maximizedCache ?? false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    trackPointerOnce();
    bindResizeOnce();

    // 挂载时补判 hover：切页面重建后光标可能已经停在这里，
    // 而 :hover 要等鼠标移动才会命中。
    if (pointerIsOverControls()) setHovered(true);

    maximizedSubscribers.add(setIsMaximized);
    // 只有首次（缓存为空）才真的问后端，之后切页面直接用缓存
    if (maximizedCache === null) void refreshMaximized();
    else setIsMaximized(maximizedCache);

    return () => {
      maximizedSubscribers.delete(setIsMaximized);
    };
  }, []);

  return (
    <div
      className={`mac-window-controls${hovered ? " is-hovered" : ""}`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <button
        onClick={() => getCurrentWindow()?.minimize()}
        className="mac-btn mac-btn-minimize"
        title="最小化"
      >
        <Minus size={10} />
      </button>
      <button
        onClick={async () => {
          await getCurrentWindow().toggleMaximize();
          void refreshMaximized();
        }}
        className="mac-btn mac-btn-maximize"
        title={isMaximized ? "还原" : "最大化"}
      >
        {isMaximized ? <Minimize2 size={10} /> : <Maximize2 size={10} />}
      </button>
      <button
        onClick={() => getCurrentWindow()?.close()}
        className="mac-btn mac-btn-close"
        title="关闭"
      >
        <X size={10} />
      </button>
    </div>
  );
}
