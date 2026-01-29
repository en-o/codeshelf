# CodeShelf

代码书架 - 本地项目管理工具

一个基于 Tauri 的桌面应用，用于管理和追踪本地 Git 项目，提供可视化的项目管理、Git 状态监控和提交统计功能。

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
- **数据库**: SQLite (tauri-plugin-sql)

## 📋 环境要求

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

## 🚀 快速开始

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

### 构建生产版本
```bash
npm run tauri build
```

构建产物位置：
- **Windows**: `src-tauri/target/release/bundle/msi/` 和 `nsis/`
- **macOS**: `src-tauri/target/release/bundle/dmg/` 和 `macos/`
- **Linux**: `src-tauri/target/release/bundle/deb/` 和 `appimage/`

## 📁 项目结构
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  
```
codeshelf/
├── src/                          # 前端源代码
│   ├── components/               # React 组件
│   │   ├── layout/              # 布局组件（MainLayout, Sidebar）
│   │   ├── project/             # 项目组件（卡片、详情、扫描）
│   │   └── ui/                  # 基础 UI 组件（Button, Input, Heatmap）
│   ├── pages/                   # 页面组件
│   │   ├── Shelf/               # 项目书架页
│   │   ├── Dashboard/           # 数据统计页
│   │   └── Settings/            # 设置页
│   ├── services/                # API 服务层
│   │   ├── db/                  # 数据库操作
│   │   └── git/                 # Git 操作
│   ├── stores/                  # Zustand 状态管理
│   ├── types/                   # TypeScript 类型定义
│   └── styles/                  # 全局样式
├── src-tauri/                   # Tauri/Rust 后端
│   ├── src/                     # Rust 源代码
│   │   ├── commands/            # Tauri Commands
│   │   ├── db/                  # 数据库模块
│   │   └── git/                 # Git 操作模块
│   ├── capabilities/            # 权限配置
│   ├── Cargo.toml               # Rust 依赖
│   └── tauri.conf.json          # Tauri 配置
├── DEVELOPMENT.md               # 开发文档
├── API.md                       # API 文档
└── README.md                    # 项目说明
```

## 📚 文档

### 核心文档
- [开发文档](DEVELOPMENT.md) - 详细的开发指南和项目结构说明
- [API 文档](API.md) - 完整的 API 接口文档
- [Tauri 命令开发指南](TAURI-COMMANDS.md) - 前后端通信开发指南

### 专题文档
- [图标管理](ICONS.md) - 图标文件说明和更新指南
- [图标配置](ICONS-SETUP.md) - 图标配置完整指南
- [自定义标题栏](TITLEBAR.md) - 标题栏实现和扩展指南


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
| `npm run tauri dev` | 启动 Tauri 开发模式 |
| `npm run tauri build` | 构建桌面应用 |
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

## 📄 许可证

[Apache License 2.0](LICENSE)

## 🙏 致谢

- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [React](https://react.dev/) - UI 框架
- [TailwindCSS](https://tailwindcss.com/) - CSS 框架
- [Lucide](https://lucide.dev/) - 图标库

---

**Made with ❤️ by CodeShelf Team**
