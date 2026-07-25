# CodeShelf 开发文档

> 项目结构与开发约定。环境搭建、构建打包与发版见 [BUILD.md](../BUILD.md)。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite 7 + TailwindCSS v4 |
| 状态 | Zustand + TanStack Query |
| 桌面框架 | Tauri 2.x（Rust） |
| 数据存储 | SQLite（sqlx，WAL 模式）+ JSON 数据文件 |
| 前后端通信 | tauri-specta 生成的类型安全绑定（`src/bindings.ts`） |
| 简历生成 sidecar | 独立 Node 进程（esbuild 打包 deepagents + LangChain） |

## 目录结构

```
codeshelf/
├── src/                       # 前端
│   ├── pages/
│   │   ├── Shelf/             # 书架：本地 Git 项目管理
│   │   ├── Dashboard/         # 统计：提交热力图、活动看板
│   │   ├── Chat/              # 助手·对话（多会话、流式、工具调用）
│   │   ├── ApiChat/           # 助手·接口（接口库 + AI 调用）
│   │   ├── AiProviders/       # 助手·模型（供应商与模型管理）
│   │   ├── Workflows/         # 助手·流程（定时编排）
│   │   ├── Toolbox/           # 工具箱（监控/下载/隧道/PairDrop/简历生成…）
│   │   └── Settings/          # 设置（含 MCP Gateway、聊天桥接）
│   ├── components/            # layout / project / ui / common / cron
│   ├── services/              # 按域封装的调用层（db/git/chat/toolbox/…）
│   ├── stores/                # Zustand 全局状态
│   ├── types/                 # TypeScript 类型
│   └── bindings.ts            # ⚠ 机器生成，勿手改（见下文）
├── src-tauri/                 # Rust 后端
│   └── src/
│       ├── commands/          # Tauri 命令，按模块分文件（git/project/chat/toolbox/…）
│       ├── storage/           # 存储层：config（路径）/ db（SQLite 池）/ schema / migrations
│       ├── handlers.rs        # 命令注册中心（tauri-specta collect_commands!）
│       ├── mcp_gateway.rs     # 内置 MCP HTTP 网关
│       ├── keyboard_hook.rs   # 全局快捷键（Windows 走底层钩子，macOS/Linux 走插件）
│       ├── app_setup.rs       # 启动装配：托盘、窗口、网关自启
│       ├── error.rs           # 统一 AppError / AppResult
│       └── lib.rs             # 应用入口装配
├── src-node/
│   ├── resume-agent/          # 简历生成 Deep Agent（Node sidecar，独立 tsconfig）
│   └── prompt/                # 简历生成提示词
├── scripts/                   # 发版、便携版、sidecar 打包脚本
└── docs/                      # 文档（archive/ 下为历史归档）
```

## 前后端通信：如何加一个 Tauri 命令

命令通过 **tauri-specta** 注册并生成 TypeScript 绑定，前端不手写 `invoke` 字符串。

1. 在 `src-tauri/src/commands/` 对应模块写函数：

   ```rust
   #[tauri::command]
   #[specta::specta]
   pub async fn my_command(param: String) -> AppResult<String> {
       Ok(format!("Hello, {param}"))
   }
   ```

2. 在 [handlers.rs](../src-tauri/src/handlers.rs) 的 `collect_commands![...]` 里注册。

3. 刷新前端绑定（改了命令签名后必跑）：

   ```bash
   cargo test --manifest-path src-tauri/Cargo.toml export_bindings -- --nocapture
   ```

   会重新生成 `src/bindings.ts`（文件头部自动带 `@ts-nocheck`）。

4. 前端从 `bindings.ts` 导入类型安全的函数直接调用；页面级的封装放 `src/services/`。

错误统一用 `error.rs` 的 `AppResult<T>`；到前端是**纯字符串**（不是 `Error` 实例），catch 时注意。

## 存储层约定

- 数据目录：macOS 在 `~/Library/Application Support/com.codeshelf.desktop`，Windows/Linux 在安装目录（详见 `storage/config.rs`）。
- SQLite 经 `storage::db::pool()` 全局连接池访问；schema 变更走 `storage/migrations/`。
- JSON 数据文件**必须**用 `storage::write_atomic` 写入（tmp + rename，防半截文件）、用 `storage::parse_json_or_backup` 解析（损坏时备份原文件再回默认值，绝不静默覆盖）。

## 简历生成 sidecar

`src-node/resume-agent` 是独立 Node 进程，经 stdin/stdout JSON-RPC 与 Rust 通信（`commands/resume_node_agent.rs`）。

- 构建：`npm run build` 会先 `tsc` 编译 sidecar，再由 `scripts/prepare-resume-agent-sidecar.mjs` 用 esbuild 打成单文件 `main.cjs` 并拷贝 Node 运行时到 `src-tauri/resources/sidecars/`。
- **依赖注意**：sidecar 的 `deepagents`、`@langchain/*`、`ignore` 声明在**根 package.json** 里（esbuild 从根 node_modules 解析），前端代码并不使用它们——不要因为"前端没引用"而删除。

## 专题文档

- [Chat 对话设计](CHAT-DESIGN.md) — 会话 / 流式 / 工具调用架构
- [Chat 工具调用原理](CHAT-TOOLS-DESIGN.md) — 工具暴露与执行循环
- [MCP Gateway](MCP-GATEWAY.md) — 把接口库暴露给外部 MCP 客户端
- [内网穿透使用说明](内网穿透使用说明.md) — SSH 反向隧道工具（用户向）
- [在线更新配置](更新步骤说明.md) — updater 签名与发版流水线

## 开发约定

- 颜色一律用 CSS 变量（`var(--color-*)`）以支持主题切换。
- 窗口关闭默认隐藏到托盘；真正退出走托盘"退出程序"（`lib.rs` 的 Exit 事件里做子进程清理）。
- 自定义标题栏：`decorations: false` + `components/layout/TitleBar.tsx`（`data-tauri-drag-region` 拖拽）。
- 新增文件系统访问范围需改 `src-tauri/capabilities/default.json`（注意保持 `.ssh` 等敏感目录的 deny 列表）。
