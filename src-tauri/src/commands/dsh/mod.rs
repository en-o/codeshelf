// DeepSeek Harness（dsh）接入：把 dsh 当作 Chat 的后端 agent 引擎。
//
// dsh 是 DeepSeek 官方的 agent harness（Node 实现），本身自带 agent loop、工具、
// 会话持久化。CodeShelf 不重写这些，只做两件事：
//   1. 托管安装 —— 用系统 npm 把**固定版本**的 dsh 装进应用数据目录，并写一个专用 profile
//   2. 驱动它 —— 子进程 + stdio 上的换行分隔 JSON-RPC（见 engine.rs，下一步实现）
//
// 子模块：
// - runtime: 环境探测（node/npm）、安装/卸载、profile 与 home 补丁落盘
// - web:     `dsh web` 官方界面（子进程 + 前端 iframe 内嵌）
//
// 曾经还有一条 JSON-RPC 引擎（自绘会话界面）。删掉了：官方界面功能更全，
// 两套并存只是让同一件事有两个入口、两份事件映射要维护。
//
// 协议、profile 组成与已知限制见 docs/specs/20260815-01-dsh引擎接入.md。

mod runtime;
mod web;

pub use runtime::*;
pub use web::*;
