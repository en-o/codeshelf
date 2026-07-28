# CodeShelf 开发与构建

> 本文档面向参与开发与发布的同学。项目介绍见 [README](README.md)，项目结构与开发约定见 [开发文档](docs/DEVELOPMENT.md)。

## 🛠 技术栈

### 前端
- **框架**: React 19 + TypeScript
- **构建**: Vite
- **样式**: TailwindCSS v4
- **状态**: Zustand + TanStack Query
- **图标**: Lucide React

### 后端
- **框架**: Tauri 2.x
- **语言**: Rust
- **数据库**: SQLite（sqlx，WAL 模式）

## 📋 环境要求

### 必需环境

| 环境 | 版本要求    | 安装方式 |
|------|---------|---------|
| Node.js | >= 20.x | [nodejs.org](https://nodejs.org/) |
| Rust | >= 1.77 | [rustup.rs](https://rustup.rs/) |
| Tauri CLI | >= 2.x  | `cargo install tauri-cli` |

### 系统依赖

#### Windows
无需额外安装，确保已安装 [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)（Windows 10/11 通常已预装）。

#### macOS
```bash
xcode-select --install
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install -y \
  pkg-config \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev \
  libappindicator3-dev \
  librsvg2-dev
```

## 🚀 快速开始

> 分支策略见 [开发规范 · 分支](docs/CONVENTIONS.md#分支)：`main` 发版 / `dev` 开发 / `release/x.y.z` 触发构建 / `feat|fix/<简述>` 功能分支。

### 1. 克隆项目
```bash
git clone https://github.com/en-o/codeshelf.git
cd codeshelf
```

### 2. 安装依赖
```bash
# 安装前端依赖
npm install

# 安装 Tauri CLI（如果尚未安装）
cargo install tauri-cli
```

### 3. 开发模式运行
```bash
# 启动 Tauri 开发服务器
npm run tauri dev
```

开发服务器启动后：
- 前端服务：http://localhost:1420
- Tauri 应用会自动打开桌面窗口

## 📦 构建与打包

### 构建安装版
```bash
npm run tauri build
```

构建产物位置：
- **Windows**: `src-tauri/target/release/bundle/msi/` 和 `nsis/`
- **macOS**: `src-tauri/target/release/bundle/dmg/` 和 `macos/`
- **Linux**: `src-tauri/target/release/bundle/deb/` 和 `appimage/`

### 构建便携版（绿色版，仅 Windows）

便携版无需安装，解压即用，不支持自动更新。

```bash
# 方式 1：运行脚本
scripts\build-portable.bat

# 方式 2：npm 命令
npm run build:portable
```

构建完成后在项目根目录生成：
```
CodeShelf-Portable-vX.X.X-x64.zip
├── CodeShelf.exe    # 主程序
└── .portable        # 便携版标记（禁用自动更新）
```

### 发版流程

> **推送前校验**：在推到 `release/**` 分支之前，本地先跑一遍
> ```bash
> npm run verify:release
> ```
> 这条命令会串联跑 `npm ci` → `npm run build`（tsc + vite）→ `cargo check --release --lib --bins`，严格对齐 `.github/workflows/release.yml` 里 `tauri-action` 实际跑的编译环节（不包 bundle，~30s）。clippy 不强制，想另外跑：`(cd src-tauri && cargo clippy --release)`。
>
> **可选：Windows 交叉编译检查（第 3 步）**。`verify:release` 的最后一步会用 Docker 跑 `cargo check --target x86_64-pc-windows-gnu`，专门抓 `#[cfg(target_os = "windows")]` 下的编译错误 —— 在 macOS/Linux 上原生 `cargo check` 会把 Windows-only 代码预处理掉，永远看不到这类错。首次需要构建一次镜像（之后一直复用）：
> ```bash
> docker build -t codeshelf-win-check -f scripts/Dockerfile.win-check .
> ```
> 结尾的 `.` 是构建上下文，**不能省** —— `-f` 只负责指定 Dockerfile，省掉上下文 buildx 会报 `requires 1 argument`。镜像就绪后，`verify:release` 会自动 `docker run` 跑这一步；没装 Docker 或镜像不存在时会自动跳过、不阻塞流程。
>
> 要真·复现 CI 的 macOS ARM 产物：
> ```bash
> npm run tauri build -- --target aarch64-apple-darwin --config src-tauri/tauri.release.conf.json
> ```

使用发版脚本自动更新版本号并触发 GitHub Actions 构建：

```bash
# Windows
scripts\release.bat 0.2.0

# Linux/macOS
./scripts/release.sh 0.2.0
```

发版脚本会：
1. 更新 `package.json`、`tauri.conf.json`、`Cargo.toml` 中的版本号
2. 创建 `release/x.x.x` 分支并推送
3. 触发 GitHub Actions 自动构建并发布

发布产物包括：
- 安装版（`.msi`、`.exe`、`.dmg`、`.deb`、`.AppImage`）
- 便携版（`CodeShelf-Portable-vX.X.X-x64.zip`）
- 自动更新文件（`latest.json`）

发版说明正文取自根目录的 `RELEASE_NOTES.md`（CI 会读取其内容作为 GitHub Release 的描述，发版前记得更新它）。updater 签名密钥与 GitHub Secrets 的一次性配置见[在线更新配置指南](docs/更新步骤说明.md)。

## 📚 文档

完整索引见 **[docs/README.md](docs/README.md)**。

- [开发文档](docs/DEVELOPMENT.md) - 项目结构、如何加 Tauri 命令、存储层约定
- [开发规范](docs/CONVENTIONS.md) - 提交信息、分支策略、代码风格、测试要求
- [在线更新配置](docs/更新步骤说明.md) - updater 签名密钥、GitHub Secrets、发版排错
- [MCP Gateway](docs/MCP-GATEWAY.md) - 将接口库暴露给 Claude Code、Kimi、Codex、Copilot 等 MCP 客户端

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📝 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动前端开发服务器 |
| `npm run build` | 构建前端生产版本 |
| `npm run verify:release` | 推送前本地校验：tsc + vite + cargo check（对齐 release.yml 的编译环节） |
| `npm run tauri dev` | 启动 Tauri 开发模式 |
| `npm run tauri build` | 构建桌面应用（安装版） |
| `npm run build:portable` | 构建便携版（绿色版） |
| `npm run tauri build -- --debug` | 构建调试版本 |

## 🐛 故障排除

### Tauri 构建失败
1. 确保系统依赖已安装
2. 清理缓存后重新构建：
   ```bash
   rm -rf node_modules src-tauri/target
   npm install
   npm run tauri build
   ```

### 前端热更新不工作
确保 Vite 开发服务器在 1420 端口运行，检查 `vite.config.ts` 配置。

### WebView 相关错误 (Linux)
确保安装了正确版本的 WebKitGTK：
```bash
pkg-config --modversion webkit2gtk-4.1
```
