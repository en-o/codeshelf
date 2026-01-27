# CodeShelf

代码书架 - 本地项目管理工具

## 技术栈

- 桌面端框架：[Tauri 2.x](https://v2.tauri.app/zh-cn/) ([Rust](https://rust-lang.org/tools/install/) 后端 + Web 前端)
- 前端框架：[React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- 构建工具：[Vite](https://vitejs.dev/)
- 样式方案：[Tailwind CSS v4](https://tailwindcss.com/)
- 状态管理：[Zustand](https://zustand-demo.pmnd.rs/) + [React Query](https://tanstack.com/query)
- 数据存储：Tauri FS API + SQLite (via tauri-plugin-sql)

---

## 环境要求

### 必需环境

| 环境 | 版本要求 | 安装方式 |
|------|---------|---------|
| Node.js | >= 18.x | [nodejs.org](https://nodejs.org/) |
| Rust | >= 1.77 | [rustup.rs](https://rustup.rs/) |
| Tauri CLI | >= 2.x | `cargo install tauri-cli` |

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

#### Linux (Fedora)

```bash
sudo dnf install \
  pkg-config \
  gtk3-devel \
  webkit2gtk4.1-devel \
  libsoup3-devel \
  libappindicator-gtk3-devel \
  librsvg2-devel
```

#### Linux (Arch)

```bash
sudo pacman -S \
  webkit2gtk-4.1 \
  gtk3 \
  libappindicator-gtk3 \
  librsvg
```

---

## 快速开始

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
# 启动 Tauri 开发服务器（推荐）
npm run tauri dev

# 或仅启动前端开发服务器（用于 UI 开发）
npm run dev
```

开发服务器启动后：
- 前端服务：http://localhost:1420
- Tauri 应用会自动打开桌面窗口

---

## 构建与打包

### 构建生产版本

```bash
npm run tauri build
```

构建产物位置：
- **Windows**: `src-tauri/target/release/bundle/msi/` 和 `nsis/`
- **macOS**: `src-tauri/target/release/bundle/dmg/` 和 `macos/`
- **Linux**: `src-tauri/target/release/bundle/deb/` 和 `appimage/`

### 仅构建前端

```bash
npm run build
```

产物位于 `dist/` 目录。

### 构建特定平台

```bash
# Windows (在 Windows 上运行)
npm run tauri build -- --target x86_64-pc-windows-msvc

# macOS (在 macOS 上运行)
npm run tauri build -- --target aarch64-apple-darwin  # Apple Silicon
npm run tauri build -- --target x86_64-apple-darwin   # Intel

# Linux (在 Linux 上运行)
npm run tauri build -- --target x86_64-unknown-linux-gnu
```

### 调试构建

```bash
# 构建带调试信息的版本
npm run tauri build -- --debug
```

---

## 项目结构

```
codeshelf/
├── src/                    # 前端源码
│   ├── components/         # React 组件
│   │   ├── ui/            # 基础 UI 组件
│   │   ├── layout/        # 布局组件
│   │   └── project/       # 项目相关组件
│   ├── pages/             # 页面组件
│   │   ├── Shelf/         # 项目书架页
│   │   ├── Dashboard/     # 数据统计页
│   │   └── Settings/      # 设置页
│   ├── stores/            # Zustand 状态管理
│   ├── services/          # API 服务层
│   ├── types/             # TypeScript 类型定义
│   └── styles/            # 全局样式
├── src-tauri/             # Tauri/Rust 后端
│   ├── src/
│   │   ├── commands/      # Tauri Commands
│   │   ├── lib.rs         # 主库文件
│   │   └── main.rs        # 入口文件
│   ├── capabilities/      # 权限配置
│   ├── Cargo.toml         # Rust 依赖配置
│   └── tauri.conf.json    # Tauri 配置
├── package.json           # Node.js 依赖配置
├── vite.config.ts         # Vite 构建配置
├── tsconfig.json          # TypeScript 配置
└── PLAN.md               # 开发计划
```

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动前端开发服务器 |
| `npm run build` | 构建前端生产版本 |
| `npm run tauri dev` | 启动 Tauri 开发模式 |
| `npm run tauri build` | 构建桌面应用 |
| `npm run tauri build -- --debug` | 构建调试版本 |

---

## 核心功能模块

### 1. 项目书架（Shelf View）

- 网格化卡片展示本地项目，支持列表/网格切换
- 卡片信息：项目名称、本地路径、关联远程仓库、最后修改时间、未推送提交数、分支状态
- 左侧目录树分组（物理文件夹结构）
- 快速搜索、标签筛选、收藏置顶（Top Shelf）

### 2. Git 数据统计

- 编码足迹热力图：基于 commit 历史生成每日活跃度
- 仪表盘指标：总项目数、今日编码时长、本周提交数、待推送提交数、未合并分支数
- 项目详情页：提交历史图表、分支可视化图谱、贡献者统计

### 3. 远程仓库管理

- 远程配置：查看/添加/修改/删除远程仓库地址
- 远程状态检测：自动检测远程可访问性、分支差异、落后/领先提交数
- 快捷操作：一键打开远程仓库网页、一键打开本地开发工具
- 强制同步策略：
  - 本地 → 远程强制推送
  - 远程 → 本地全分支同步
  - 仓库迁移模式
  - 安全的拉取更新（带冲突检测）

---

## 故障排除

### Tauri 构建失败

1. 确保系统依赖已安装（见上方"系统依赖"部分）
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
# 检查版本
pkg-config --modversion webkit2gtk-4.1
```

---

## License

[MIT](LICENSE)
