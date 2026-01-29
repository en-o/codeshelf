# 自定义标题栏说明

## 实现方案

我们选择了 **React 自定义标题栏** 方案，原因如下：

### 优点
1. **完全自定义**: 可以添加任何功能（搜索框、快捷按钮等）
2. **跨平台一致**: 在 Windows、macOS、Linux 上外观一致
3. **灵活扩展**: 方便添加新功能
4. **主题支持**: 完美适配浅色/深色主题

### 实现细节

#### 1. Tauri 配置
在 `src-tauri/tauri.conf.json` 中设置 `decorations: false` 隐藏原生标题栏：

```json
{
  "app": {
    "windows": [{
      "decorations": false
    }]
  }
}
```

#### 2. 标题栏组件
创建了 `TitleBar.tsx` 组件，包含：
- **左侧**: 应用图标和标题
- **中间**: 快捷操作按钮（可选）
- **右侧**: 窗口控制按钮（最小化、最大化、关闭）

#### 3. 窗口拖拽
使用 `data-tauri-drag-region` 属性使标题栏可拖拽：

```tsx
<div data-tauri-drag-region className="...">
  {/* 标题栏内容 */}
</div>
```

#### 4. 窗口控制
使用 Tauri API 控制窗口：

```typescript
import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();
await appWindow.minimize();    // 最小化
await appWindow.toggleMaximize(); // 最大化/还原
await appWindow.close();       // 关闭
```

## 如何添加新功能

### 1. 添加快捷按钮

在 `TitleBar.tsx` 的中间区域添加按钮：

```tsx
<button
  onClick={() => onNavigate("new-page")}
  className="px-3 py-1 text-xs rounded transition-colors"
  title="新功能"
>
  <Icon className="w-3.5 h-3.5" />
</button>
```

### 2. 添加搜索框

```tsx
<div className="flex items-center gap-2">
  <Search className="w-3.5 h-3.5" />
  <input
    type="text"
    placeholder="搜索..."
    className="w-40 px-2 py-1 text-xs bg-transparent border-none focus:outline-none"
  />
</div>
```

### 3. 添加通知图标

```tsx
<button className="relative px-3 py-1">
  <Bell className="w-3.5 h-3.5" />
  {hasNotifications && (
    <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full" />
  )}
</button>
```

### 4. 添加用户头像

```tsx
<button className="flex items-center gap-2 px-3 py-1">
  <img src={avatar} className="w-5 h-5 rounded-full" />
  <span className="text-xs">{username}</span>
</button>
```

## 样式定制

### 修改标题栏高度

在 `TitleBar.tsx` 中修改 `h-8` 类：

```tsx
<div className="h-10 ...">  {/* 改为 10 (40px) */}
```

### 修改窗口控制按钮样式

```tsx
<button
  className="h-full px-4 hover:bg-blue-500 hover:text-white"
>
  <Minus className="w-4 h-4" />
</button>
```

### 添加渐变背景

```tsx
<div className="bg-gradient-to-r from-blue-500 to-purple-500 ...">
```

## 平台差异处理

### macOS 特殊处理

macOS 的窗口控制按钮通常在左侧：

```tsx
{process.platform === 'darwin' ? (
  // macOS: 控制按钮在左侧
  <div className="flex items-center gap-2">
    <button onClick={handleClose}>●</button>
    <button onClick={handleMinimize}>●</button>
    <button onClick={handleMaximize}>●</button>
  </div>
) : (
  // Windows/Linux: 控制按钮在右侧
  <div className="flex items-center">
    {/* 现有的按钮 */}
  </div>
)}
```

### Windows 11 风格

```tsx
<button className="h-full px-4 hover:bg-gray-200 dark:hover:bg-gray-700">
  <Minus className="w-3 h-3" />
</button>
```

## 常见问题

### Q: 双击标题栏无法最大化？
A: 添加双击事件：

```tsx
<div
  data-tauri-drag-region
  onDoubleClick={handleMaximize}
  className="..."
>
```

### Q: 标题栏按钮无法点击？
A: 确保按钮没有 `data-tauri-drag-region` 属性：

```tsx
<button className="...">  {/* 不要添加 data-tauri-drag-region */}
  <X />
</button>
```

### Q: 如何隐藏快捷按钮？
A: 在 `MainLayout.tsx` 中不传递 `onNavigate` 属性：

```tsx
<TitleBar />  {/* 不传递 onNavigate 和 currentPage */}
```

## 性能优化

### 1. 防抖窗口状态检查

```typescript
const [isMaximized, setIsMaximized] = useState(false);

useEffect(() => {
  let timeout: NodeJS.Timeout;

  const checkMaximized = async () => {
    const appWindow = getCurrentWindow();
    const maximized = await appWindow.isMaximized();
    setIsMaximized(maximized);
  };

  const debouncedCheck = () => {
    clearTimeout(timeout);
    timeout = setTimeout(checkMaximized, 100);
  };

  window.addEventListener('resize', debouncedCheck);
  return () => window.removeEventListener('resize', debouncedCheck);
}, []);
```

### 2. 使用 CSS 变量

所有颜色使用 CSS 变量，避免重复计算：

```tsx
className="bg-[var(--color-bg-primary)]"
```

## 扩展示例

### 完整的标题栏示例

```tsx
export function TitleBar() {
  return (
    <div data-tauri-drag-region className="flex items-center h-10 bg-[var(--color-bg-primary)]">
      {/* 左侧 */}
      <div className="flex items-center gap-3 px-4">
        <FolderGit2 className="w-5 h-5 text-blue-500" />
        <span className="text-sm font-semibold">CodeShelf</span>
      </div>

      {/* 中间 - 搜索和快捷操作 */}
      <div className="flex-1 flex items-center justify-center gap-4">
        <div className="flex items-center gap-2 px-3 py-1 bg-[var(--color-bg-tertiary)] rounded-lg">
          <Search className="w-4 h-4" />
          <input
            type="text"
            placeholder="搜索项目..."
            className="w-60 bg-transparent border-none focus:outline-none"
          />
        </div>

        <button className="p-2 hover:bg-[var(--color-bg-tertiary)] rounded-lg">
          <Plus className="w-4 h-4" />
        </button>

        <button className="p-2 hover:bg-[var(--color-bg-tertiary)] rounded-lg">
          <Bell className="w-4 h-4" />
        </button>
      </div>

      {/* 右侧 - 窗口控制 */}
      <div className="flex items-center h-full">
        <button onClick={handleMinimize} className="h-full px-4 hover:bg-[var(--color-bg-tertiary)]">
          <Minus className="w-4 h-4" />
        </button>
        <button onClick={handleMaximize} className="h-full px-4 hover:bg-[var(--color-bg-tertiary)]">
          <Square className="w-3.5 h-3.5" />
        </button>
        <button onClick={handleClose} className="h-full px-4 hover:bg-red-500 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
```

## 总结

自定义标题栏提供了最大的灵活性，可以轻松添加：
- 搜索框
- 快捷按钮
- 通知图标
- 用户信息
- 主题切换
- 任何自定义功能

只需在 `TitleBar.tsx` 中添加相应的 JSX 和逻辑即可！
