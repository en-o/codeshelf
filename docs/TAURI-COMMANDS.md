# Tauri 命令开发指南

## 概述

Tauri 使用命令（Commands）机制实现前端（JavaScript/TypeScript）与后端（Rust）的通信。本指南详细说明如何编写和调用 Tauri 命令。

## 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                         前端 (React)                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  services/db/index.ts                                │  │
│  │  export async function getProjects() {               │  │
│  │    return invoke("get_projects");                    │  │
│  │  }                                                    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↓ invoke()
┌─────────────────────────────────────────────────────────────┐
│                      Tauri 桥接层                            │
│  自动序列化/反序列化 JSON                                     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                      后端 (Rust)                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  src-tauri/src/commands/project.rs                   │  │
│  │  #[tauri::command]                                   │  │
│  │  pub async fn get_projects() -> Result<Vec<Project>>│  │
│  │  {                                                    │  │
│  │    // 实现逻辑                                        │  │
│  │  }                                                    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 第一部分：Rust 后端编写命令

### 1. 基本命令结构

#### 创建命令文件
```rust
// src-tauri/src/commands/project.rs

use tauri::State;
use serde::{Deserialize, Serialize};

// 定义数据结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_favorite: bool,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

// 定义输入结构
#[derive(Debug, Deserialize)]
pub struct CreateProjectInput {
    pub name: String,
    pub path: String,
    pub tags: Option<Vec<String>>,
}

// 定义命令
#[tauri::command]
pub async fn get_projects() -> Result<Vec<Project>, String> {
    // 实现逻辑
    // 返回 Result<T, E>，E 会被转换为前端的错误
    Ok(vec![])
}

#[tauri::command]
pub async fn add_project(input: CreateProjectInput) -> Result<Project, String> {
    // 参数会自动从 JSON 反序列化
    let project = Project {
        id: uuid::Uuid::new_v4().to_string(),
        name: input.name,
        path: input.path,
        is_favorite: false,
        tags: input.tags.unwrap_or_default(),
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    };

    // 保存到数据库...

    Ok(project)
}
```

### 2. 命令类型

#### 同步命令
```rust
#[tauri::command]
pub fn simple_command() -> String {
    "Hello from Rust!".to_string()
}
```

#### 异步命令
```rust
#[tauri::command]
pub async fn async_command() -> Result<String, String> {
    // 可以使用 .await
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    Ok("Done!".to_string())
}
```

#### 带状态的命令
```rust
use tauri::State;

pub struct AppState {
    pub db: Arc<Mutex<Database>>,
}

#[tauri::command]
pub async fn get_data(state: State<'_, AppState>) -> Result<String, String> {
    let db = state.db.lock().await;
    // 使用状态...
    Ok("Data".to_string())
}
```

#### 带窗口的命令
```rust
use tauri::Window;

#[tauri::command]
pub async fn show_notification(window: Window) -> Result<(), String> {
    window.emit("notification", "Hello!").map_err(|e| e.to_string())?;
    Ok(())
}
```

### 3. 错误处理

#### 自定义错误类型
```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CommandError {
    #[error("项目不存在: {0}")]
    ProjectNotFound(String),

    #[error("数据库错误: {0}")]
    DatabaseError(String),

    #[error("IO 错误: {0}")]
    IoError(#[from] std::io::Error),
}

// 实现 Serialize 以便发送到前端
impl serde::Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[tauri::command]
pub async fn get_project(id: String) -> Result<Project, CommandError> {
    // 使用自定义错误
    let project = find_project(&id)
        .ok_or_else(|| CommandError::ProjectNotFound(id))?;
    Ok(project)
}
```

### 4. 注册命令

#### 在 lib.rs 中注册
```rust
// src-tauri/src/lib.rs

mod commands;

use commands::project::{get_projects, add_project, update_project};
use commands::git::{get_git_status, scan_directory};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            // 项目管理命令
            get_projects,
            add_project,
            update_project,
            remove_project,
            toggle_favorite,

            // Git 命令
            get_git_status,
            scan_directory,
            get_commit_history,
            get_branches,
            get_remotes,

            // 其他命令
            open_in_editor,
            open_in_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 5. 完整示例

```rust
// src-tauri/src/commands/project.rs

use tauri::State;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};
use std::sync::Arc;

// 应用状态
pub struct AppState {
    pub db: Arc<Pool<Sqlite>>,
}

// 数据结构
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_favorite: bool,
    pub tags: String, // JSON 字符串
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectInput {
    pub name: String,
    pub path: String,
    pub tags: Option<Vec<String>>,
}

// 命令实现
#[tauri::command]
pub async fn get_projects(state: State<'_, AppState>) -> Result<Vec<Project>, String> {
    let projects = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects ORDER BY is_favorite DESC, name ASC"
    )
    .fetch_all(state.db.as_ref())
    .await
    .map_err(|e| format!("数据库错误: {}", e))?;

    Ok(projects)
}

#[tauri::command]
pub async fn add_project(
    input: CreateProjectInput,
    state: State<'_, AppState>,
) -> Result<Project, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let tags = serde_json::to_string(&input.tags.unwrap_or_default())
        .map_err(|e| format!("序列化错误: {}", e))?;

    sqlx::query(
        "INSERT INTO projects (id, name, path, is_favorite, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.path)
    .bind(false)
    .bind(&tags)
    .bind(&now)
    .bind(&now)
    .execute(state.db.as_ref())
    .await
    .map_err(|e| format!("插入失败: {}", e))?;

    Ok(Project {
        id,
        name: input.name,
        path: input.path,
        is_favorite: false,
        tags,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub async fn toggle_favorite(
    id: String,
    state: State<'_, AppState>,
) -> Result<Project, String> {
    // 先获取当前状态
    let project = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE id = ?"
    )
    .bind(&id)
    .fetch_one(state.db.as_ref())
    .await
    .map_err(|e| format!("项目不存在: {}", e))?;

    // 切换状态
    let new_favorite = !project.is_favorite;
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "UPDATE projects SET is_favorite = ?, updated_at = ? WHERE id = ?"
    )
    .bind(new_favorite)
    .bind(&now)
    .bind(&id)
    .execute(state.db.as_ref())
    .await
    .map_err(|e| format!("更新失败: {}", e))?;

    Ok(Project {
        is_favorite: new_favorite,
        updated_at: now,
        ..project
    })
}
```

## 第二部分：前端调用命令

### 1. 基本调用

#### 导入 invoke
```typescript
// src/services/db/index.ts
import { invoke } from "@tauri-apps/api/core";
```

#### 简单调用
```typescript
// 无参数命令
const result = await invoke("simple_command");

// 带参数命令
const result = await invoke("add_project", {
  input: {
    name: "My Project",
    path: "/path/to/project",
    tags: ["react", "typescript"]
  }
});
```

### 2. 类型安全调用

#### 定义类型
```typescript
// src/types/index.ts
export interface Project {
  id: string;
  name: string;
  path: string;
  isFavorite: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  path: string;
  tags?: string[];
}
```

#### 封装服务函数
```typescript
// src/services/db/index.ts
import { invoke } from "@tauri-apps/api/core";
import type { Project, CreateProjectInput } from "@/types";

export async function getProjects(): Promise<Project[]> {
  return invoke<Project[]>("get_projects");
}

export async function addProject(input: CreateProjectInput): Promise<Project> {
  return invoke<Project>("add_project", { input });
}

export async function updateProject(
  id: string,
  updates: Partial<Project>
): Promise<Project> {
  return invoke<Project>("update_project", { id, updates });
}

export async function removeProject(id: string): Promise<void> {
  return invoke<void>("remove_project", { id });
}

export async function toggleFavorite(id: string): Promise<Project> {
  return invoke<Project>("toggle_favorite", { id });
}
```

### 3. 错误处理

#### 基本错误处理
```typescript
try {
  const projects = await getProjects();
  console.log("项目列表:", projects);
} catch (error) {
  console.error("获取项目失败:", error);
  // error 是字符串类型（Rust 的错误消息）
}
```

#### 高级错误处理
```typescript
async function loadProjects() {
  try {
    setLoading(true);
    const projects = await getProjects();
    setProjects(projects);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // 根据错误消息类型处理
    if (message.includes("数据库错误")) {
      showError("数据库连接失败，请重试");
    } else if (message.includes("权限")) {
      showError("没有访问权限");
    } else {
      showError(`加载失败: ${message}`);
    }
  } finally {
    setLoading(false);
  }
}
```

### 4. React 集成

#### 使用 React Query
```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getProjects, addProject, toggleFavorite } from "@/services/db";

// 查询
export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
    staleTime: 1000 * 60 * 5, // 5 分钟
  });
}

// 变更
export function useAddProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: addProject,
    onSuccess: () => {
      // 刷新项目列表
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useToggleFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: toggleFavorite,
    onSuccess: (updatedProject) => {
      // 乐观更新
      queryClient.setQueryData<Project[]>(["projects"], (old) =>
        old?.map((p) => (p.id === updatedProject.id ? updatedProject : p))
      );
    },
  });
}
```

#### 在组件中使用
```typescript
function ProjectList() {
  const { data: projects, isLoading, error } = useProjects();
  const addProjectMutation = useAddProject();
  const toggleFavoriteMutation = useToggleFavorite();

  async function handleAddProject() {
    try {
      await addProjectMutation.mutateAsync({
        name: "New Project",
        path: "/path/to/project",
      });
      toast.success("项目添加成功");
    } catch (error) {
      toast.error("添加失败");
    }
  }

  if (isLoading) return <div>加载中...</div>;
  if (error) return <div>错误: {String(error)}</div>;

  return (
    <div>
      {projects?.map((project) => (
        <div key={project.id}>
          <h3>{project.name}</h3>
          <button
            onClick={() => toggleFavoriteMutation.mutate(project.id)}
          >
            {project.isFavorite ? "取消收藏" : "收藏"}
          </button>
        </div>
      ))}
      <button onClick={handleAddProject}>添加项目</button>
    </div>
  );
}
```

## 第三部分：完整开发流程

### 步骤 1: 定义数据结构

#### Rust 端
```rust
// src-tauri/src/models/project.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    // ...
}
```

#### TypeScript 端
```typescript
// src/types/index.ts
export interface Project {
  id: string;
  name: string;
  // ...
}
```

### 步骤 2: 实现 Rust 命令

```rust
// src-tauri/src/commands/project.rs
#[tauri::command]
pub async fn get_projects() -> Result<Vec<Project>, String> {
    // 实现
}
```

### 步骤 3: 注册命令

```rust
// src-tauri/src/lib.rs
.invoke_handler(tauri::generate_handler![
    get_projects,
])
```

### 步骤 4: 封装前端服务

```typescript
// src/services/db/index.ts
export async function getProjects(): Promise<Project[]> {
  return invoke("get_projects");
}
```

### 步骤 5: 在组件中使用

```typescript
// src/pages/Shelf/index.tsx
const projects = await getProjects();
```

## 第四部分：最佳实践

### 1. 命名约定

- **Rust**: 使用 snake_case
  ```rust
  #[tauri::command]
  pub async fn get_project_by_id() {}
  ```

- **TypeScript**: 使用 camelCase
  ```typescript
  export async function getProjectById() {
    return invoke("get_project_by_id");
  }
  ```

### 2. 参数传递

#### 简单参数
```rust
#[tauri::command]
pub async fn delete_project(id: String) -> Result<(), String> {}
```

```typescript
await invoke("delete_project", { id: "123" });
```

#### 复杂参数
```rust
#[tauri::command]
pub async fn update_project(
    id: String,
    name: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<Project, String>
```

```typescript
await invoke("update_project", {
  id: "123",
  name: "New Name",
  tags: ["tag1", "tag2"],
});
```

### 3. 返回值处理

#### 返回简单类型
```rust
#[tauri::command]
pub fn get_count() -> i32 {
    42
}
```

#### 返回 Result
```rust
#[tauri::command]
pub async fn risky_operation() -> Result<String, String> {
    if success {
        Ok("Success".to_string())
    } else {
        Err("Failed".to_string())
    }
}
```

### 4. 性能优化

#### 使用异步
```rust
#[tauri::command]
pub async fn heavy_operation() -> Result<String, String> {
    // 使用 tokio::spawn 避免阻塞
    let result = tokio::spawn(async {
        // 耗时操作
    }).await.map_err(|e| e.to_string())?;

    Ok(result)
}
```

#### 批量操作
```rust
#[tauri::command]
pub async fn batch_update(ids: Vec<String>) -> Result<Vec<Project>, String> {
    // 批量处理而不是多次调用
    let projects = update_multiple(ids).await?;
    Ok(projects)
}
```

## 第五部分：调试技巧

### 1. Rust 端调试

```rust
#[tauri::command]
pub async fn debug_command(input: String) -> Result<String, String> {
    println!("收到输入: {}", input);
    eprintln!("这是错误输出");

    // 使用 dbg! 宏
    dbg!(&input);

    Ok(input)
}
```

### 2. 前端调试

```typescript
async function debugInvoke() {
  console.log("调用命令前");

  try {
    const result = await invoke("debug_command", { input: "test" });
    console.log("命令结果:", result);
  } catch (error) {
    console.error("命令错误:", error);
  }

  console.log("调用命令后");
}
```

### 3. 查看 Tauri 日志

开发模式下，Tauri 会在终端输出日志：
```bash
npm run tauri dev
# 查看 Rust 的 println! 和 eprintln! 输出
```

## 第六部分：常见问题

### Q1: 命令找不到
**错误**: `Command not found: get_projects`

**解决**:
1. 检查命令是否在 `invoke_handler` 中注册
2. 检查命令名称是否匹配（Rust 和 TypeScript）
3. 重启开发服务器

### Q2: 参数类型不匹配
**错误**: `Failed to deserialize arguments`

**解决**:
1. 检查 Rust 和 TypeScript 的类型定义是否一致
2. 确保参数名称匹配
3. 使用 `Option<T>` 处理可选参数

### Q3: 异步命令不工作
**错误**: 命令一直挂起

**解决**:
1. 确保使用 `async fn`
2. 确保所有 `.await` 都正确使用
3. 检查是否有死锁

## 总结

Tauri 命令开发的关键点：

1. **Rust 端**: 使用 `#[tauri::command]` 宏定义命令
2. **注册**: 在 `invoke_handler` 中注册所有命令
3. **前端**: 使用 `invoke()` 调用命令
4. **类型安全**: 定义清晰的类型和接口
5. **错误处理**: 使用 `Result<T, E>` 处理错误
6. **封装**: 将命令调用封装在服务层

遵循这些原则，可以构建类型安全、易维护的 Tauri 应用！

## 第七部分：图标管理

### 图标目录结构

```
src-tauri/icons/
├── icon.svg           # 主图标源文件 (全息风格 SVG)
├── icon-small.svg     # 简化版源文件 (小尺寸用)
├── icon.png           # 主图标 (256x256, 透明背景)
├── 128x128.png        # 标准图标
├── 128x128@2x.png     # 高清图标 (Retina)
├── 32x32.png          # 小图标
├── tray-icon.png      # 托盘图标 (深色背景不透明)
└── app-icon-circle.ico # Windows 安装程序图标 (多尺寸)
```

### 图标设计说明

全息赛博朋克风格图标，包含以下视觉元素：
- **三层发光层板**：代表"书架"核心概念
- **Git 分支网络**：可视化多远程仓库（GitHub/Gitee）
- **代码块投影**：强化开发者工具属性
- **配色方案**：
  - 主色：`#00f5ff` (Cyan Neon)
  - 副色：`#bc13fe` (Electric Purple)
  - 基底：`#0a1428` (Deep Glass)

### 图标用途说明

| 文件 | 尺寸 | 用途 | 引用位置 |
|-----|------|------|---------|
| `icon.svg` | 200x200 viewBox | SVG 源文件 | 生成脚本 |
| `icon-small.svg` | 200x200 viewBox | 简化版源文件 | 生成脚本 |
| `icon.png` | 256x256 | 主图标 | tauri.conf.json |
| `128x128.png` | 128x128 | 标准图标 | tauri.conf.json |
| `128x128@2x.png` | 256x256 | 高清显示屏 | tauri.conf.json |
| `32x32.png` | 32x32 | 小尺寸图标 | tauri.conf.json |
| `tray-icon.png` | 32x32 | 系统托盘图标 | lib.rs |
| `app-icon-circle.ico` | 多尺寸 | Windows 安装程序 | tauri.conf.json |

### 配置引用

**tauri.conf.json:**
```json
{
  "bundle": {
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/app-icon-circle.ico",
      "icons/icon.png"
    ]
  }
}
```

**lib.rs (托盘图标):**
```rust
let icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
    .expect("Failed to load tray icon");
```

### 图标生成

从 SVG 源文件生成所有图标，运行脚本：

**Windows:**
```bash
scripts\generate-icons.bat
```

**Linux/WSL:**
```bash
bash scripts/generate-icons.sh
```

**前提条件:** 安装 ImageMagick
- Windows: `winget install ImageMagick.ImageMagick`
- Linux: `sudo apt-get install imagemagick`

**生成流程:**
1. 从 `icon.svg` 生成大尺寸图标 (256x256, 128x128)
2. 从 `icon-small.svg` 生成小尺寸图标 (32x32)
3. 托盘图标使用深色背景 `#0a1428` 确保可见性
4. ICO 文件包含多尺寸 (256/128/64/48/32/16)
