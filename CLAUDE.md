# CodeShelf · AI 协作约束

> 本文件是项目的**约束层（宪法）**，会被自动载入每次 AI 会话。
> 只列**必须遵守的硬约束**，理由与展开见 [开发规范](docs/CONVENTIONS.md)、[AI Coding 实践](docs/AI-CODING.md)。
>
> 下面每一条都来自本项目真实踩过的坑，不是通用最佳实践的抄录。**违反其中任何一条都会造成可复现的线上问题。**

## 项目定位

CodeShelf（代码书架）—— 本地项目管理 · AI 助手 · 开发者工具箱，三合一的跨平台桌面应用。
技术栈：**Tauri 2（Rust）+ React 19 + TypeScript + Vite 7 + TailwindCSS v4**，数据存 SQLite（sqlx）+ JSON 文件。
Rust edition 2021，最低 1.88（依赖 cookie_store / time 的实际要求）。前端与 Rust 通过 **tauri-specta** 生成的类型安全绑定通信。

## 硬约束

### 1. 存储：JSON 数据文件必须原子写、解析失败必须备份

```rust
crate::storage::write_atomic(&path, content)?;              // ✅ 写：tmp + fsync + rename
let v: T = crate::storage::parse_json_or_backup(&path, &content); // ✅ 读：坏文件改名备份后回默认值
```

- ❌ 禁止对应用数据文件直接用 `fs::write`（崩溃/断电会留半截文件）
- ❌ 禁止 `serde_json::from_str(..).unwrap_or_default()`（解析失败静默回默认值，下次保存即**永久覆盖用户的 API key**）
- 例外：写用户自己的文件（`claude_code/config_io.rs`、`tools/fs_ops.rs`）、临时脚本、PairDrop 接收文件不适用

### 2. 改了 Tauri 命令签名，必须重新生成前端绑定

```bash
cd src-tauri && cargo test --lib export_bindings
```

命令在 `src-tauri/src/handlers.rs` 的 `collect_commands![]` 注册；不重新生成，`src/bindings.ts` 就与后端脱节。
`src/bindings.ts` 是**机器生成文件，禁止手改**。

### 3. 改了 Windows 专有代码，必须交叉编译验证

`#[cfg(target_os = "windows")]` 块在 macOS/Linux 上**根本不会被编译**，本地 `cargo check` 全绿不代表没问题。

```bash
docker build -t codeshelf-win-check -f scripts/Dockerfile.win-check .   # 首次
docker run --rm -v "$PWD":/work \
  -v codeshelf-cargo-registry:/usr/local/cargo/registry \
  -v codeshelf-cargo-target-win:/work/src-tauri/target-win \
  -e CARGO_TARGET_DIR=/work/src-tauri/target-win \
  codeshelf-win-check cargo check --lib --target x86_64-pc-windows-gnu
```

### 4. 前端接到的 Tauri 错误是纯字符串，不是 `Error` 实例

```ts
// ❌ 后端错误会被吞成泛化文案
catch (e) { showToast("error", e instanceof Error ? e.message : "失败"); }
// ✅
catch (e) { showToast("error", typeof e === "string" && e ? e : e instanceof Error ? e.message : "失败"); }
```

### 5. 轮询必须加 `document.hidden` 守卫

应用常驻系统托盘，窗口隐藏后 `setInterval` 仍在跑，会持续空转 IPC。

```ts
const t = setInterval(() => { if (!document.hidden) refresh(); }, 2000);
```

### 6. `deepagents` / `@langchain/*` / `ignore` 不可删

它们在**根 `package.json`**，但前端代码不引用——是 `src-node/resume-agent` 这个 Node sidecar 的依赖，esbuild 打包时从根 `node_modules` 解析。**不要因为"前端搜不到引用"就当作死依赖删掉**，删了简历生成功能直接构建失败。

### 7. NSIS 安装脚本不得对 `$INSTDIR` 追加产品名

Tauri 的 NSIS 默认已装到 `…\CodeShelf`（自带产品名一层）。任何"末段不是产品名就补一层"的逻辑都会在每次升级时再套一层，导致 `CodeShelf\CodeShelf\CodeShelf` 越来越深；而 Windows 的数据目录跟着 exe 走，老数据被留在上一层，表现为**"更新后数据全没了"**。

### 8. 修 Bug 要修根因，不要只补调用方

报告给出的是症状。动手前先 grep 所有调用者：在共享函数里加一处守卫，比在每个调用方各加一处的 diff 更小，也不会漏掉别的路径。

## 验证命令

| 场景 | 命令 |
|---|---|
| 前端类型 | `npx tsc --noEmit` |
| Rust 编译 | `cd src-tauri && cargo check` |
| Rust 测试 | `cd src-tauri && cargo test --lib` |
| 完整构建（含 sidecar 打包） | `npm run build` |
| 发版前总校验 | `npm run verify:release` |
| Windows 专有代码 | 见约束 3 |

## 工作方式

- **提交信息**：Conventional Commits，`type(scope): 描述` —— 详见 [CONVENTIONS.md](docs/CONVENTIONS.md#提交信息)
- **写 Spec 的门槛**：仅**新增工具箱工具、跨模块重构、数据迁移、外部协议变更**需要先写 spec（放 `docs/specs/`）；日常 bugfix 与 UI 微调直接改 —— 详见 [AI-CODING.md](docs/AI-CODING.md)
- **一次只做一件事**：任务拆小、做完立即验证。不要一口气改 500 行再回头找 bug。
- **改动前先读**：本项目有大量非直觉约定（上面 8 条只是可枚举的部分），动某个模块前先读它的周边代码与注释。

## Non-Goals（明确不做）

- ❌ 不引入新的前端测试框架 / 状态管理 / UI 库——现有 Zustand + TanStack Query + Tailwind 够用
- ❌ 不为"以后可能需要"写抽象：不加单实现的 interface、不加只有一个产物的 factory
- ❌ 不把数据存到安装目录之外做迁移（除非明确讨论过）——Windows 现状即安装目录，改动影响面大
- ❌ 不在未经交叉验证的情况下改 Windows 专有分支
