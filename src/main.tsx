import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";

// 屏蔽 webview 原生右键菜单，统一由应用内菜单接管（components/ui/AppContextMenu）。
// 原先这段只在生产环境生效，导致三种行为：dev 的 macOS 弹原生菜单、dev 的 Windows
// 什么都没有、prod 全平台连输入框的复制粘贴都没有——本地根本测不出线上的样子。
// dev 下按住 Shift 右键仍可唤出原生菜单，用于 Inspect Element 调试。
document.addEventListener("contextmenu", (e) => {
  if (import.meta.env.DEV && e.shiftKey) return;
  e.preventDefault();
});

// 生产环境禁用 DevTools
if (!import.meta.env.DEV) {
  // 拦截 DevTools 快捷键
  document.addEventListener("keydown", (e) => {
    // F12
    if (e.key === "F12") { e.preventDefault(); return; }
    // Ctrl/Cmd + Shift + I / C / J
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && ["I", "i", "C", "c", "J", "j"].includes(e.key)) {
      e.preventDefault();
    }
  });
}

// 阻止把文件拖进窗口时 WebView 直接导航打开该文件(整个 app 被文件覆盖、只能退出解决)。
// 只 preventDefault、不 stopPropagation,页面内的拖拽上传(如跨设备传输)仍能读到 dataTransfer.files。
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
