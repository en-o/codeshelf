import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";

// 生产环境禁用 DevTools
if (!import.meta.env.DEV) {
  // 禁用右键菜单（防止 Inspect Element）
  document.addEventListener("contextmenu", (e) => e.preventDefault());

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
