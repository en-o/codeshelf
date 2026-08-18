# CodeShelf · 代码书架

> 本地项目管理 · AI 助手 · 开发者工具箱 —— 三合一的轻量跨平台桌面应用

[![Release](https://img.shields.io/github/v/release/en-o/codeshelf?style=flat-square)](https://github.com/en-o/codeshelf/releases)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square)
[![License](https://img.shields.io/badge/license-Apache--2.0-green?style=flat-square)](LICENSE)
![Built with](https://img.shields.io/badge/Tauri%202%20+%20React%2019-24C8DB?style=flat-square)

![书架主界面](docs/images/1.png)

## 这是什么

参与的项目越来越多，本地仓库散落在不同目录、不同托管平台（GitHub / Gitee / GitLab），于是常常：**找不到项目在哪、忘了哪些还没提交或推送、在文件管理器 / 终端 / 编辑器 / 一堆小工具之间反复横跳。**

CodeShelf 把这些收进**一个桌面窗口**：集中管理本地 Git 项目、直观看到自己的编码活动，并顺手内置了一批日常离不开的 AI 助手与开发工具。像书架整理书一样，把你所有代码项目摆得清清楚楚、随手可取。

## 为什么用它

- 🗂 **本地优先** —— 直接管理磁盘上真实的 Git 仓库；项目、配置、会话、密钥全部存在本地，不上云、不用注册登录。
- 🧩 **三合一** —— 项目管理、AI 助手、开发者工具箱同处一窗，少装十个零散小工具，少开十个浏览器标签页。
- 🤖 **AI 原生** —— 对话能调用工具、（授权后）操作本地目录、调用你自建的接口；还能把整个接口库通过 **MCP Gateway** 暴露给 Claude Code / Codex / Kimi / Copilot 等外部客户端。
- 🪶 **轻量跨平台** —— 基于 Tauri（Rust + 系统 WebView），安装包小、内存占用低，Windows / macOS / Linux 一套体验。
- 🔒 **隐私友好** —— 敏感数据留在本机；跨设备传输走局域网、数据内存中转，不落公网。

## 📦 下载安装

前往 [Releases 页面](https://github.com/en-o/codeshelf/releases) 下载 **Windows / macOS / Linux** 最新安装包，或 Windows 免安装的**便携版**。应用内支持自动检查更新。

版本分两条线，由版本号区分：**正式版 `0.2.0`**、**预览版 `0.2.0-1`**（带 `-N` 后缀，发布为 Pre-release）。
两条线各自更新、互不可见 —— 正式版只会更新到正式版，预览版只会更新到预览版。想换线自行下载对方安装包覆盖安装即可，数据不丢。

macOS 请按处理器选择安装包：

| 设备 | 安装包 |
|---|---|
| Apple Silicon（M1 / M2 / M3 / M4 等） | `CodeShelf_<版本>_aarch64.dmg` |
| Intel Mac | `CodeShelf_<版本>_x64.dmg` |

`.AppImage` 是 Linux 应用格式，不能在 macOS 上安装。

## 🖼 功能一览

### 📖 书架
集中管理本地 Git 项目：**扫描目录批量入库**、卡片 / 列表视图、搜索、分类与收藏。点开任意项目即可查看分支、工作区变更、远程仓库与提交历史，并一键**提交 / 拉取 / 推送**，或直达编辑器 / 文件夹 / 终端 / 对话。

![项目详情面板](docs/images/0.png)

![扫描入库与批量操作](docs/images/2.png)

### 📊 统计
开发活动看板：项目总数、今日 / 本周提交、待推送数量，以及一整年的**提交热力图**和最近活动，让你的贡献一目了然。

![数据统计](docs/images/3.png)

### 🤖 助手
把 AI 能力拆成四个子页，各司其职：

| 子页 | 说明 |
|------|------|
| 💬 对话 | 多会话 AI 对话，可调用工具、可授权操作本地目录 |
| 🧪 接口 | 管理接口库（分组 / 接口 / 鉴权），让 AI 调用你自己的接口 |
| ✨ 模型 | 统一管理 OpenAI 兼容的供应商与模型，内置验证聊天 |
| ⚡ 流程 | 定时编排「抓取网页 → 大模型 → Webhook」的自动化流程 |

![AI 供应商与模型管理](docs/images/4.png)

### 🧰 工具

工具箱是 CodeShelf 的另一个重点：一个面向 **开发提效 + 运维提效** 的百宝箱。平时要装一堆命令行、开一排小软件才能干的事 —— 端口排查、Docker、内网穿透、抓包联调、批量下载 —— 全收进同一个界面，不用在多个工具之间来回切换、也不用为一次性需求四处找软件。

![工具箱](docs/images/5.png)

**🚀 开发提效** —— 本地开发、联调、日常效率

| 工具 | 说明 |
|------|------|
| 本地服务 | 一键起 Web 静态服务 + 端口转发，支持 CORS、gzip 和多代理规则，前后端联调 / Mock / 跨域一把梭 |
| Netcat `beta` | TCP/UDP 协议测试，客户端与服务器双模式，抓包联调、调试物联网设备 |
| 跨设备传输 `beta` | 局域网内一对一收发文字和文件，浏览器扫码即用，所有数据内存中转 |
| 剪贴板历史 | 自动记录复制内容，支持搜索、置顶、持久化存储，快捷键快速呼出 |
| 快捷键备忘 | 预置 Mac/Windows 常用快捷键，支持自定义编辑、搜索、导入导出 |
| Claude Code | 管理 Claude Code 配置文件，检查安装状态，编辑全局设置 |

**🛠 运维提效** —— 部署、排障、远程访问

| 工具 | 说明 |
|------|------|
| 系统监控 | 端口扫描、本地端口占用查看、进程管理和系统资源监控，快速定位「端口被谁占了」 |
| Docker 镜像 | 发现和编辑 Dockerfile，生成模板，构建、运行、推送和删除镜像 |
| 文件下载 | 下载远程文件 / 制品，支持断点续传、重试机制和下载队列管理 |
| SSH 隧道 `beta` | 通过 SSH 将远程内网端口映射到本地，直连远程 Redis / MySQL / 管理面板 |
| 内网穿透 `beta` | 通过 SSH 反向隧道把本地服务映射到你的 VPS 公网端口，用于 webhook 等外网回调调试（[使用说明](docs/内网穿透使用说明.md)） |

> 此外还有 **简历生成** `beta` —— 基于 LangChain Deep Agents 分析项目代码，自动生成项目背景知识与 STAR 简历经历。

### ⚙️ 设置
主题外观、编辑器与终端、目录扫描深度、标签与快捷键、聊天桥接，以及把接口库暴露给外部 MCP 客户端的 **MCP Gateway**。

![设置](docs/images/6.png)

## 🧑‍💻 开发

基于 **Tauri 2 + React 19 + TypeScript** 构建。环境要求、本地运行、构建打包与发版流程见 **[开发与构建指南](BUILD.md)**。

### 分支说明

| 分支 | 用途 | 发什么 |
|---|---|---|
| `main` | 正式版基线，日常开发与合并的主干 | 正式版 `x.y.z`，走 `releases/latest` 更新端点 |
| `main-v` | 预览版基线，尝鲜功能先在这条线上发 | 预览版 `x.y.z-N`，走固定 tag `preview` 的更新端点 |
| `release/<版本>` | 由 `scripts/release.sh` 自动创建并推送 | 触发 CI 构建，构建完即可删；不要手工提交到这里 |

发版脚本按版本号自动认基线：`./scripts/release.sh 0.2.0` 必须在 `main` 上跑，
`./scripts/release.sh 0.2.0-1` 必须在 `main-v` 上跑，跑错分支会被前置校验拦下。
渠道隔离与发布细节见 [更新步骤说明](docs/更新步骤说明.md)。

完整文档见 **[docs/](docs/README.md)**，常用入口：

- [开发文档](docs/DEVELOPMENT.md) —— 项目结构、如何加 Tauri 命令、存储层约定
- [开发规范](docs/CONVENTIONS.md) —— 提交信息、分支、代码风格、测试与评审
- [AI Coding 实践](docs/AI-CODING.md) —— 本项目的 SDD 协作方法（硬约束见 [CLAUDE.md](CLAUDE.md)）
- [MCP Gateway](docs/MCP-GATEWAY.md) —— 把接口库暴露给 Claude Code、Kimi、Codex、Copilot 等 MCP 客户端

## 📄 许可证

[Apache License 2.0](LICENSE)

## 🙏 致谢

- [Tauri](https://tauri.app/) —— 跨平台桌面应用框架
- [React](https://react.dev/) —— UI 框架
- [TailwindCSS](https://tailwindcss.com/) —— CSS 框架
- [Lucide](https://lucide.dev/) —— 图标库
