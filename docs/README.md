# 文档索引

## 我想…

| 我想… | 看这个 |
|---|---|
| 了解这个项目是什么 | [README](../README.md) |
| 把项目跑起来 / 打包 / 发版 | [BUILD.md](../BUILD.md) |
| 知道代码结构、某个功能在哪 | [DEVELOPMENT.md](DEVELOPMENT.md) |
| 知道提交信息、分支、代码风格怎么写 | [CONVENTIONS.md](CONVENTIONS.md) |
| 用 AI 协作开发本项目 | [CLAUDE.md](../CLAUDE.md)（硬约束）+ [AI-CODING.md](AI-CODING.md)（方法论） |
| 写一份大功能的 Spec | [specs/README.md](specs/README.md) |

## 分层

```
CLAUDE.md            约束层 · 硬性规则，AI 每次会话自动加载
├── CONVENTIONS.md   规范层 · 提交/分支/风格/测试/评审
├── AI-CODING.md     方法层 · SDD 流程与上下文工程
└── specs/           需求层 · 大功能的规格说明
```

## 全部文档

### 上手与流程
- [README](../README.md) — 项目介绍与功能一览
- [BUILD.md](../BUILD.md) — 环境要求、构建打包、发版流程
- [DEVELOPMENT.md](DEVELOPMENT.md) — 目录结构、如何加 Tauri 命令、存储层约定、sidecar
- [CONVENTIONS.md](CONVENTIONS.md) — 开发规范
- [更新步骤说明](更新步骤说明.md) — updater 签名密钥、GitHub Secrets、发版排错

### AI 协作
- [CLAUDE.md](../CLAUDE.md) — 约束层「宪法」，8 条硬约束 + 验证命令
- [AI-CODING.md](AI-CODING.md) — SDD 实践：四步流程、Spec 门槛、上下文工程、质量保证
- [specs/](specs/) — 大功能规格说明与模板

### 设计文档
- [CHAT-DESIGN.md](CHAT-DESIGN.md) — Chat 模块：会话管理、流式渲染、工具调用循环
- [CHAT-TOOLS-DESIGN.md](CHAT-TOOLS-DESIGN.md) — 工具调用原理：如何暴露工具、执行与结果整理
- [MCP-GATEWAY.md](MCP-GATEWAY.md) — 把接口库暴露给 Claude Code / Codex / Kimi 等 MCP 客户端

### 用户向
- [内网穿透使用说明](内网穿透使用说明.md) — SSH 反向隧道工具的完整用法

### 归档
- [archive/](archive/) — 已过时的历史文档（早期需求文档、阶段性 PRD、UI 原型）。**内容与当前代码可能不一致，仅作历史参考，不再维护。**

## 维护约定

- 文档写**为什么**和**约定**，不复述代码能自己说清的东西
- **不要在文档里粘贴脚本/代码全文**——必然与源文件失同步（本项目曾出现文档内 release.sh 83 行 vs 真实 188 行）；改为链接到源文件
- 引用代码位置**只写文件路径、不写行号**，行号腐烂得最快
- 文档过时了就改或归档，不要留着误导人
