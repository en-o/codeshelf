# 20260519-01-基于 LangChain Deep Agents 重构「个人简历」功能

## 一、背景

CodeShelf 当前的简历生成功能（`src/pages/Toolbox/ResumeGenerator/` + `src/services/resume/`）采用「一次性 prompt」模式：直接读取项目 README/依赖文件/git commit 数据，单次调用 AI 输出 STAR 项目经历。该实现对项目代码理解浅、上下文极易溢出、无法持续维护，且 git commit 数据并非所有项目都有意义。

本次需求引入 **LangChain Deep Agents** 框架重构简历功能，把流程拆成两个 Agent：

- **KnowledgeAgent**：自主探索项目代码 → 产出固定章节的「项目背景知识 Markdown」，可独立编辑、版本化、持续维护
- **ResumeAgent**：基于背景知识 + 岗位方向 + JD 关键词 + 语气 → 生成 STAR 项目经历，支持 Markdown / Word 导出

## 二、功能变更

### 2.1 新增

| 项 | 说明 |
|---|---|
| 项目背景知识文档管理 | 一项目一份独立 Markdown，存到 `<data_dir>/resume_knowledge/<projectId>.md`；可重新生成、手动编辑、查看/恢复历史版本 |
| 自动备份 | 每次重新生成或保存前，旧版本自动复制到 `<data_dir>/resume_knowledge/<projectId>.history/<timestamp>.md` |
| ignore 规则三层叠加 | 内置兜底（`.git/` / `node_modules/` / `target/` 等） + 项目 `.gitignore` + 项目可选 `.codeshelfignore` |
| Deep Agents 自主探索 | Agent 通过 `project_list_dir` / `project_read_file` / `project_grep` 工具按功能点探索项目代码 |
| JD 关键词支持 | UI 可输入关键词，Agent 会优先把命中的关键词写进 action 字段 |
| 语气配置 | 专业 / 简洁两种语气可选 |
| Word 导出 | 用 `docx` npm 包生成 `.docx` 文件 |
| STAR 项目经历手动编辑 | 在简历预览中可对每个项目的 S/T/A/R 四段分别编辑 |

### 2.2 移除

| 项 | 原因 |
|---|---|
| Git commit 统计预热 | 用户明确不再需要 commit 数据参与简历生成 |
| 量化贡献章节 | 配合移除 git 数据 |
| 依赖文件硬编码解析 | 改由 Agent 自主读取依赖文件并理解 |
| 敏感文件 glob 列表 | 由 ignore 三层规则替代 |

## 三、技术栈变更

新增 npm 依赖：

```
deepagents@^1.10.2
langchain@^1.4.0
@langchain/core@^1.1.46
@langchain/openai@^1.4.5
docx@^9.6.1
ignore@^7.0.5
```

LLM 调用模式从 Tauri 后端的 `chat_complete` invoke 改为前端直接用 LangChain `ChatOpenAI`（基于已有 `AiProviderConfig` 的 baseURL + apiKey）。要求模型支持 OpenAI 兼容的 tool calling 协议。

## 四、文件改动清单

### 4.1 前端新增

| 文件 | 主要导出 / 方法 |
|---|---|
| `src/services/resume/llmFactory.ts` | `pickModel(provider)` / `buildChatModel(provider, opts)` —— 从 `AiProviderConfig` 构造 `ChatOpenAI` |
| `src/services/resume/tools/ignoreEngine.ts` | `buildIgnoreFilter(projectPath)` —— 解析 `.gitignore` / `.codeshelfignore` + 内置规则；返回 `IgnoreFilter` |
| `src/services/resume/tools/projectFs.ts` | `createProjectFsTools(projectPath, ig)` —— 创建 3 个 LangChain tool：`project_list_dir` / `project_read_file` / `project_grep` |
| `src/services/resume/agents/knowledgeAgent.ts` | `runKnowledgeAgent(opts)` —— 调用 `createDeepAgent` 探索项目并生成背景知识；`AgentStep` 类型用于 UI 进度反馈 |
| `src/services/resume/agents/resumeAgent.ts` | `runResumeAgent(opts)` —— 基于背景知识生成 STAR 简历 JSON |
| `src/services/resume/knowledgeStore.ts` | `loadResumeKnowledge` / `saveResumeKnowledge` / `listResumeKnowledge` / `listResumeKnowledgeHistory` / `readResumeKnowledgeHistory` / `deleteResumeKnowledge` —— `invoke` 包装 |
| `src/pages/Toolbox/ResumeGenerator/KnowledgePanel.tsx` | 背景知识 tab UI：项目列表 + Markdown 预览/编辑 + 历史版本恢复 |
| `src/pages/Toolbox/ResumeGenerator/JobConfigPanel.tsx` | 岗位方向 + JD 关键词 + 语气配置 |
| `src/pages/Toolbox/ResumeGenerator/ResumePanelV2.tsx` | 简历生成、预览、保存、导出（含 STAR 编辑卡片）；导出按钮调用 `exportResumeV2ToMarkdownWithDialog` / `exportResumeV2ToDocxWithDialog` |

### 4.2 前端改造

| 文件 | 改动 |
|---|---|
| `src/types/resume.ts` | 追加新类型：`Tone`、`ProjectKnowledge`、`KnowledgeHistoryEntry`、`ResumeGenerateOptions`、`ResumeProjectExperience`、`ResumeV2` |
| `src/stores/resumeStore.ts` | 加 `knowledgeDocs: Record<string, ProjectKnowledge>` 状态；加 `loadAllKnowledgeFromDisk` / `upsertKnowledge` / `setKnowledgeInMemory` / `removeKnowledge` / `getKnowledge` 方法 |
| `src/services/resume/export.ts` | 删除旧的 `exportResumeToMarkdown` / `exportResumeToText` / `exportExperienceToPrompt` / `exportResumeToFileWithDialog`；新增 `exportResumeV2ToMarkdown` / `exportResumeV2ToMarkdownWithDialog` / `exportResumeV2ToDocxBlob` / `exportResumeV2ToDocxWithDialog` |
| `src/services/resume/index.ts` | 更新导出：导出 `export` / `knowledgeStore` / `runKnowledgeAgent` / `runResumeAgent` 及相关类型 |
| `src/pages/Toolbox/ResumeGenerator/index.tsx` | **完全重写**：tab 切换布局（选项目 / 背景知识 / 简历）；启动加载磁盘上的背景知识；项目列表显示「已生成背景知识」标记 |
| `package.json` / `package-lock.json` | 加 6 个新依赖 |

### 4.3 前端删除

| 文件 | 原因 |
|---|---|
| `src/services/resume/aiGenerator.ts` | 由 `agents/resumeAgent.ts` 取代 |
| `src/services/resume/dependencyParser.ts` | 改由 Agent 自主分析依赖 |
| `src/services/resume/projectFileAnalyzer.ts` | 改由 Agent 自主探索 |
| `src/pages/Toolbox/ResumeGenerator/ProjectAnalyzer.tsx` | 由 `KnowledgePanel` 内置的进度反馈取代 |
| `src/pages/Toolbox/ResumeGenerator/useResumeData.ts` | 不再需要 git 预热 |
| `src/pages/Toolbox/ResumeGenerator/ResumeEditor.tsx` | 由 `ResumePanelV2` 内联的 `ExperienceCard` 取代 |
| `src/pages/Toolbox/ResumeGenerator/ResumePreview.tsx` | 简历预览已合并到 `ResumePanelV2` |

### 4.4 后端新增

| 文件 | 主要 command |
|---|---|
| `src-tauri/src/commands/resume.rs` | `get_resumes` / `save_resumes`（从 `settings` 迁移）；`save_resume_knowledge(project_id, content, user_edited)` 含自动备份；`load_resume_knowledge(project_id)`；`list_resume_knowledge()`；`list_resume_knowledge_history(project_id)`；`read_resume_knowledge_history(project_id, timestamp)`；`delete_resume_knowledge(project_id)`；导出类型 `ResumeKnowledgeHistoryEntry { timestamp, size }` |

### 4.5 后端改造

| 文件 | 改动 |
|---|---|
| `src-tauri/src/storage/config.rs` | 加 `resume_knowledge_dir()` / `resume_knowledge_file(project_id)` / `resume_knowledge_history_dir(project_id)` 三个路径方法；加内部 `sanitize_id(id)` 辅助函数（防止文件名注入） |
| `src-tauri/src/commands/mod.rs` | 声明 `pub mod resume;` |
| `src-tauri/src/commands/settings.rs` | 移除 `get_resumes` / `save_resumes`（迁移到 `resume` 模块） |
| `src-tauri/src/handlers.rs` | `use` 加 `resume`；`collect_commands![]` 中替换 `settings::save_resumes` / `settings::get_resumes` 为 `resume::*` 及 5 个新命令的注册 |

## 五、验收

### 5.1 编译验收

- ✅ 前端 `npx tsc --noEmit` 通过（除 `src/bindings.ts` 4 个预存错误外无新增错误，这 4 个是 tauri-specta 自动生成文件的已知问题，与本次改动无关）
- ✅ 后端 `cargo check` 通过（无 warning，1m 30s）

### 5.2 端到端验证（运行时手动验证）

| 验收项 | 步骤 |
|---|---|
| ignore 生效 | 在「背景知识」tab 触发生成，确认 Agent 探索时未访问 `node_modules` / `target` / `dist` 等目录 |
| 背景知识首次生成 | 选项目 → 切到「背景知识」→ 点「生成」→ 确认 `<data_dir>/resume_knowledge/<projectId>.md` 文件出现，内容含 5 个固定章节 |
| 自动备份 | 再次「重新生成」→ 确认 `<data_dir>/resume_knowledge/<projectId>.history/<timestamp>.md` 出现 |
| 手编保存 | 编辑背景知识 → 保存 → 重启应用后内容仍在 |
| 历史恢复 | 点「历史」→ 选时间戳 → 恢复后内容回滚（保存后才会写盘并产生新备份） |
| 简历生成 | 切到「简历」→ 选岗位 + JD 关键词 + 语气 → 点「生成」→ STAR 输出含命中的 JD 关键词，无编造数字 |
| Markdown 导出 | 点「Markdown」→ 选路径 → 用 VSCode 打开内容完整 |
| Word 导出 | 点「Word」→ 选路径 → 用 Word/WPS 打开格式正确 |

## 六、风险与遗留

1. **模型 tool calling 兼容性**：Ollama 上部分本地模型不支持 OpenAI tool calling 协议；首次使用时若 Agent 持续无响应，需切换为支持 tool calling 的模型（DeepSeek、通义千问、Moonshot、OpenAI、Anthropic 兼容代理等）。
2. **`src/bindings.ts` 重新生成**：新命令的类型化绑定需要跑 `cargo test export_bindings`；当前 Windows 环境下该 test 因 cdylib 入口点问题失败（`STATUS_ENTRYPOINT_NOT_FOUND`），不影响运行时（前端用 raw `invoke<T>` 调用），但 IDE 不会有类型提示。建议在 macOS/Linux 上重生 bindings 后提交。
3. **bindings.ts 预存错误**：HEAD 上的 `src/bindings.ts` 自带 4 个 TS 错误（`ShortcutInput` 重复 + 未使用变量），与本次改动无关；`npm run build` 会因此失败，但所有业务代码已通过类型检查。

## 七、后续协作约定（给后来人 / AI 助手看）

> 重构主体已合并并进入持续修复阶段，后续接手前请先读这一节。

### 7.1 本文档定位

本文档是**完工存档**，不是 TODO 清单。"四、文件改动清单" 描述的是 `56bd9b7` 那次重构**已经落地**的事情，"五、验收" 章节标 ✅ 说明编译/功能已经过过一遍。

后续接到与简历模块相关的任务时：

- 默认认为文档列出的功能/文件/方法**都已存在**，先用 `git log` / `grep` 在代码里找一找再判断要不要新增。
- 不要把文档的章节当成"应该实现而尚未实现"的项去补。
- 想新增章节描述的东西时，先确认现有实现是不是已经覆盖（例如版本恢复 = `historyOpen` / `listResumeKnowledgeHistory` / `readResumeKnowledgeHistory`，不要再另起一个名字相近的"运行记录"/"流程明细"功能）。

### 7.2 修 bug 任务的边界

简历模块（`src/pages/Toolbox/ResumeGenerator/` 与 `src/services/resume/` + `src-tauri/src/commands/resume.rs`）目前处在迭代修复阶段，commit message 普遍是 "fix 简历"。修 bug 任务时：

- 严格只动复现 bug 所需的最小范围。
- 不要顺手新增 IPC 命令、新建独立 service 文件（如 `qualityCheck.ts` 这类）、加运行流程持久化、加额外 UI 入口。
- 改动如果超出"修一个明确 bug"的范围（例如要新增 IPC、新文件、跨文件 >50 行），应该先和需求方对齐再动手。

### 7.3 可观测性 / 质检 / 流程持久化类设施

像「Agent 调用流程落盘 (`KnowledgeRunRecord` / `save_knowledge_run` 等)」「背景知识质量自动检查 (`qualityCheck.ts`)」「失败重试与重放」这类**辅助性设施**本身有价值，可以做，但要满足两个条件：

1. **当成"优化功能"的正式任务来做**，不要在修 bug 时夹带；要有明确的需求来源。
2. **在当前实现基础上扩展**，不要另起一套。例如：
   - 想增强可追溯性 → 扩展现有 `listResumeKnowledgeHistory` 的元信息（加 `model` / `requestId` / `status` 字段），而不是另造平行的 `list_knowledge_runs`。
   - 想加质检 → 先看 `runKnowledgeAgent` / `runResumeAgent` 内部已有的校验逻辑能不能加 hook 点，而不是新建一个独立模块。
