import { Input } from "@/components/ui";

export function SettingsPage() {
  return (
    <div className="flex flex-col h-full p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold text-white mb-6">设置</h1>

      {/* Editor Settings */}
      <section className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-medium text-white mb-4">编辑器设置</h2>
        <div className="space-y-4">
          <Input
            label="默认编辑器命令"
            placeholder="code"
            defaultValue="code"
          />
          <p className="text-sm text-gray-500">
            支持 VSCode (code)、IDEA (idea)、Sublime Text (subl) 等
          </p>
        </div>
      </section>

      {/* Scan Settings */}
      <section className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-medium text-white mb-4">扫描设置</h2>
        <div className="space-y-4">
          <Input
            label="扫描深度"
            type="number"
            placeholder="3"
            defaultValue="3"
            min={1}
            max={10}
          />
          <p className="text-sm text-gray-500">
            扫描目录时的最大递归深度
          </p>
        </div>
      </section>

      {/* About */}
      <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-lg font-medium text-white mb-4">关于</h2>
        <div className="text-gray-400 space-y-2">
          <p>CodeShelf v0.1.0</p>
          <p>代码书架 - 本地项目管理工具</p>
          <p className="text-sm text-gray-500">
            基于 Tauri + React + TypeScript 构建
          </p>
        </div>
      </section>
    </div>
  );
}
