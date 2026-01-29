# CodeShelf - 项目结构文档

## 项目概述

CodeShelf 是一个基于 Tauri + React + TypeScript 的本地项目管理工具，用于管理和追踪本地 Git 仓库。

## 技术栈

- **前端框架**: React 18 + TypeScript
- **桌面框架**: Tauri 2.x
- **状态管理**: Zustand
- **样式**: TailwindCSS 4.x
- **数据请求**: TanStack Query
- **图标**: Lucide React
- **构建工具**: Vite

## 项目结构

```
codeshelf/
├── src/                          # 前端源代码
│   ├── components/               # React 组件
│   │   ├── layout/              # 布局组件
│   │   │   ├── MainLayout.tsx   # 主布局（包含侧边栏）
│   │   │   ├── Sidebar.tsx      # 侧边栏导航
│   │   │   └── index.ts         # 导出
│   │   ├── project/             # 项目相关组件
│   │   │   ├── ProjectCard.tsx          # 项目卡片（网格/列表视图）
│   │   │   ├── ProjectDetailDialog.tsx  # 项目详情对话框
│   │   │   ├── ScanResultDialog.tsx     # 扫描结果选择对话框
│   │   │   └── index.ts                 # 导出
│   │   └── ui/                  # 通用 UI 组件
│   │       ├── Button.tsx       # 按钮组件
│   │       ├── Input.tsx        # 输入框组件
│   │       ├── CommitHeatmap.tsx # 提交热力图
│   │       └── index.ts         # 导出
│   ├── pages/                   # 页面组件
│   │   ├── Dashboard/           # 数据统计页面
│   │   │   └── index.tsx
│   │   ├── Settings/            # 设置页面
│   │   │   └── index.tsx
│   │   └── Shelf/               # 项目书架页面
│   │       └── index.tsx
│   ├── services/                # 服务层（API 调用）
│   │   ├── db/                  # 数据库操作
│   │   │   └── index.ts         # 项目 CRUD 操作
│   │   └── git/                 # Git 操作
│   │       └── index.ts         # Git 命令封装
│   ├── stores/                  # 状态管理
│   │   └── appStore.ts          # 全局应用状态（Zustand）
│   ├── types/                   # TypeScript 类型定义
│   │   └── index.ts             # 所有类型定义
│   ├── styles/                  # 样式文件
│   │   └── index.css            # 全局样式 + TailwindCSS
│   ├── App.tsx                  # 根组件
│   └── main.tsx                 # 应用入口
├── src-tauri/                   # Tauri 后端（Rust）
│   ├── src/                     # Rust 源代码
│   │   ├── commands/            # Tauri 命令（前端调用的 API）
│   │   ├── db/                  # 数据库模块
│   │   ├── git/                 # Git 操作模块
│   │   ├── lib.rs               # 库入口
│   │   └── main.rs              # 应用入口
│   ├── capabilities/            # Tauri 权限配置
│   │   └── default.json         # 默认权限
│   ├── Cargo.toml               # Rust 依赖配置
│   └── tauri.conf.json          # Tauri 配置
├── package.json                 # Node.js 依赖配置
├── vite.config.ts               # Vite 配置
├── tsconfig.json                # TypeScript 配置
└── README.md                    # 项目说明
```

## 核心功能模块

### 1. 项目书架 (Shelf)
**位置**: `src/pages/Shelf/index.tsx`

**功能**:
- 显示所有项目（网格/列表视图）
- 搜索项目
- 添加单个项目
- 扫描目录批量添加项目
- 显示项目详情
- 收藏项目

**相关组件**:
- `ProjectCard` - 项目卡片
- `ScanResultDialog` - 扫描结果选择
- `ProjectDetailDialog` - 项目详情

### 2. 数据统计 (Dashboard)
**位置**: `src/pages/Dashboard/index.tsx`

**功能**:
- 显示统计数据（总项目数、今日提交、本周提交、待推送）
- 提交热力图（365天）
- 最近活动（开发中）

**相关组件**:
- `CommitHeatmap` - 热力图组件

### 3. 设置 (Settings)
**位置**: `src/pages/Settings/index.tsx`

**功能**:
- 主题切换（浅色/深色）
- 编辑器配置
- 扫描深度配置

### 4. 状态管理
**位置**: `src/stores/appStore.ts`

**管理的状态**:
- `projects` - 项目列表
- `viewMode` - 视图模式（网格/列表）
- `theme` - 主题（浅色/深色）
- `sidebarCollapsed` - 侧边栏折叠状态
- `searchQuery` - 搜索关键词
- `selectedTags` - 选中的标签

### 5. 服务层

#### Git 服务 (`src/services/git/index.ts`)
- `scanDirectory()` - 扫描目录查找 Git 仓库
- `getGitStatus()` - 获取 Git 状态
- `getCommitHistory()` - 获取提交历史
- `getBranches()` - 获取分支列表
- `getRemotes()` - 获取远程仓库
- `gitPush/Pull/Fetch()` - Git 操作

#### 数据库服务 (`src/services/db/index.ts`)
- `getProjects()` - 获取所有项目
- `addProject()` - 添加项目
- `updateProject()` - 更新项目
- `removeProject()` - 删除项目
- `toggleFavorite()` - 切换收藏状态
- `openInEditor()` - 在编辑器中打开
- `openInTerminal()` - 在终端中打开

## 类型定义

**位置**: `src/types/index.ts`

主要类型:
- `Project` - 项目信息
- `GitStatus` - Git 状态
- `CommitInfo` - 提交信息
- `BranchInfo` - 分支信息
- `RemoteInfo` - 远程仓库信息
- `DashboardStats` - 统计数据
- `DailyActivity` - 每日活动

## 主题系统

**实现方式**: CSS 变量 + 类名切换

**主题变量** (`src/styles/index.css`):
```css
:root {
  --color-bg-primary: #ffffff;
  --color-bg-secondary: #f8fafc;
  --color-text-primary: #0f172a;
  /* ... */
}

.dark {
  --color-bg-primary: #0f172a;
  --color-bg-secondary: #1e293b;
  --color-text-primary: #f8fafc;
  /* ... */
}
```

**切换逻辑**: `MainLayout.tsx` 监听 `theme` 状态，动态添加/移除 `dark` 类

## 开发流程

### 1. 启动开发服务器
```bash
npm run tauri dev
```

### 2. 构建生产版本
```bash
npm run tauri build
```

### 3. 添加新页面
1. 在 `src/pages/` 创建新目录
2. 创建 `index.tsx`
3. 在 `Sidebar.tsx` 添加导航项
4. 在 `App.tsx` 添加路由

### 4. 添加新组件
1. 在对应目录创建组件文件
2. 在 `index.ts` 导出
3. 在需要的地方导入使用

### 5. 添加新的 Tauri 命令

详细步骤请参考 [Tauri 命令开发指南](TAURI-COMMANDS.md)

**快速步骤**:
1. 在 `src-tauri/src/commands/` 添加 Rust 函数
2. 在 `src-tauri/src/lib.rs` 注册命令
3. 在前端 `src/services/` 添加对应的 TypeScript 函数

**示例**:
```rust
// Rust 端
#[tauri::command]
pub async fn my_command(param: String) -> Result<String, String> {
    Ok(format!("Hello, {}!", param))
}
```

```typescript
// TypeScript 端
export async function myCommand(param: string): Promise<string> {
  return invoke("my_command", { param });
}
```

### 6. 修改权限
编辑 `src-tauri/capabilities/default.json`

## 组件设计原则

### 1. 组件职责单一
每个组件只负责一个功能模块

### 2. 样式使用 CSS 变量
所有颜色使用 `var(--color-*)` 以支持主题切换

### 3. 类型安全
所有组件都有明确的 TypeScript 类型定义

### 4. 错误处理
所有异步操作都有 try-catch 错误处理

### 5. 加载状态
所有数据加载都有 loading 状态显示

## 常用命令

```bash
# 安装依赖
npm install

# 开发模式
npm run tauri dev

# 构建
npm run tauri build

# 类型检查
npm run type-check

# 格式化代码
npm run format
```

## 注意事项

1. **路径处理**: Windows 路径需要转换为 WSL 路径（如果在 WSL 环境）
2. **权限配置**: 文件系统操作需要在 `capabilities/default.json` 配置权限
3. **主题切换**: 使用 CSS 变量而不是硬编码颜色
4. **状态持久化**: 使用 Zustand 的 persist 中间件自动保存状态
5. **Git 操作**: 所有 Git 操作都通过 Tauri 命令调用 Rust 后端

## 下一步开发建议

1. **标签管理**: 添加标签的增删改查功能
2. **项目分组**: 支持项目分组管理
3. **快捷操作**: 添加更多快捷操作（如快速切换分支）
4. **搜索优化**: 支持按标签、远程源等筛选
5. **导入导出**: 支持项目列表的导入导出
6. **最近活动**: 实现最近活动时间线
7. **性能优化**: 大量项目时的虚拟滚动
8. **多语言**: 添加国际化支持

## 问题排查

### 编译错误
- 检查 TypeScript 类型定义
- 检查导入路径是否正确
- 运行 `npm run type-check`

### Tauri 命令调用失败
- 检查 Rust 函数是否正确注册
- 检查权限配置
- 查看 Tauri 控制台日志

### 样式问题
- 检查是否使用了 CSS 变量
- 检查 TailwindCSS 类名是否正确
- 检查主题切换逻辑

## 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交代码
4. 创建 Pull Request

## 许可证

MIT License
