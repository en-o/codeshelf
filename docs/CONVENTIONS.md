# 开发规范

> 硬约束（违反会造成线上问题的那些）在根目录 [CLAUDE.md](../CLAUDE.md)，本文是完整的协作规范与理由。
> AI 协作方法论见 [AI-CODING.md](AI-CODING.md)。

## 提交信息

采用 **[Conventional Commits](https://www.conventionalcommits.org/zh-hans/)**：

```
type(scope): 描述
```

发版脚本产出的 `chore: release v0.1.41` 已经是这个格式，本规范只是把它推广到日常提交。

### type

| type | 用于 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修 bug |
| `docs` | 只改文档 |
| `refactor` | 重构（不改外部行为） |
| `perf` | 性能优化 |
| `build` | 构建、依赖、打包、安装器 |
| `chore` | 杂项（发版、配置） |

### scope

按模块取：`shelf`、`chat`、`toolbox`、`workflow`、`resume`、`storage`、`mcp`、`installer`、`git`、`settings`、`deps`。跨多个模块时可省略。

### 正反例

```bash
# ❌ 现状（无法追溯改了什么）
fix
fix 53
123
README.md

# ✅
fix(downloader): 暂停后状态被覆写为 cancelled 导致无法恢复
fix(installer): 移除 NSIS 对 $INSTDIR 追加产品名的逻辑
feat(toolbox): 新增内网穿透工具
refactor(pairdrop): 拆分纯函数与叶子组件到独立模块
docs: 重写 README 并归档过时文档
build(deps): 移除未使用的 vite-plugin-node-polyfills
```

### 要求

- 描述用**中文**、说清**做了什么**，而不是"修复问题"这类空话
- 一次提交只做一件事；不相关的改动分开提交
- 关联 issue 写在描述后：`fix(chat): 流式中文乱码 (#53)`

## 分支

| 分支 | 用途 |
|---|---|
| `main` | 发版分支，保持可构建 |
| `dev` | 日常开发 |
| `release/x.y.z` | 发版分支，**推送触发 CI 构建**，不允许改动 |
| `feat/<简述>`、`fix/<简述>` | 功能与修复分支 |

现有的 `git`、`mcpserver`、`openclaw` 等无前缀分支是历史遗留，新分支请按上表命名。

## 代码风格

总原则：**写得像周边的代码**——注释密度、命名、惯用法都随上下文，而不是另起一套。

### Rust

- 错误统一用 `AppResult<T>` / `AppError`（`src-tauri/src/error.rs`），不要裸 `String` 或 `unwrap()`
- 面向用户的错误信息用中文，且要具体（说清哪个路径/哪个值出了问题）
- 子线程/后台任务里**禁止 panic**：`expect()` 只杀当前线程，主程序无感知，功能会静默失效
- 新增 Tauri 命令要加 `#[specta::specta]` 并在 `handlers.rs` 注册，然后重新生成 bindings

### TypeScript / React

- **不新增 `as any`**（现存 36 处是历史债，别再加）
- 颜色一律用 CSS 变量 `var(--color-*)`，不硬编码色值——否则暗色主题会坏
- `src/bindings.ts` 是机器生成的，**禁止手改**
- 组件超过 ~800 行考虑拆分，优先抽**纯函数**和**叶子展示组件**（有状态的核心留在原处，硬拆反而增加 props 穿透）

## 测试

务实标准，不追求覆盖率数字：

- **非平凡逻辑**（分支判断、解析器、路径校验、状态机）留**一个能跑的检查**，用 Rust `#[test]`
- 纯搬移、纯样式、一行改动**不需要**测试
- **不引入前端测试框架**——当前前端靠 `tsc` 全量类型检查 + 完整构建把关，为一次改动引入 vitest 不划算

跑测试：`cd src-tauri && cargo test --lib`

## 提交前自检

| 改了什么 | 必须跑 |
|---|---|
| 任何前端代码 | `npx tsc --noEmit` |
| 任何 Rust 代码 | `cd src-tauri && cargo check` |
| Rust 逻辑（非注释） | `cd src-tauri && cargo test --lib` |
| **Tauri 命令签名** | `cargo test --lib export_bindings` 重新生成 bindings |
| **`#[cfg(target_os = "windows")]` 代码** | Docker 交叉编译，见 [CLAUDE.md](../CLAUDE.md#3-改了-windows-专有代码必须交叉编译验证) |
| 依赖 / 构建配置 | `npm run build`（含 sidecar 打包） |
| 发版前 | `npm run verify:release` |

## 评审关注点

逻辑对不对通常不是问题，重点看**设计好不好**：

- **过度抽象**？单实现的 interface、只有一个产物的 factory、为"以后可能需要"写的配置项
- **吞异常**？`catch {}` 空块、`let _ =` 忽略关键错误、`unwrap_or_default()` 掩盖解析失败
- **边界条件**？空输入、并发调用、路径含空格/中文、网络中断
- **跨模块一致性**？同一件事在别处是怎么做的，有没有现成的工具函数可复用
- **根因还是症状**？修 bug 时是否 grep 过所有调用方（本项目出现过同一 bug 在两个文件各有一份拷贝，只修一处的情况）

## 发版

1. 更新 `RELEASE_NOTES.md`——CI 会读它作为 GitHub Release 的正文，**发版前必须写**，否则用户看到的是默认文案
2. 跑 `npm run verify:release`
3. `./scripts/release.sh x.y.z`（Windows 用 `scripts\release.bat`），脚本会同步三处版本号并推送 `release/x.y.z` 触发构建

签名密钥与 GitHub Secrets 的一次性配置见 [更新步骤说明](更新步骤说明.md)。
