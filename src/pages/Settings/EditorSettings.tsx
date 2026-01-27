import { useState } from "react";
import { Plus, Trash2, FolderOpen, AlertCircle } from "lucide-react";
import { useAppStore, EditorConfig } from "@/stores/appStore";
import { open } from "@tauri-apps/plugin-dialog";

export function EditorSettings() {
  const { editors, addEditor, removeEditor } = useAppStore();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEditor, setNewEditor] = useState({ name: "", path: "" });

  async function handleBrowsePath() {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "选择编辑器可执行文件",
      });

      if (selected) {
        setNewEditor({ ...newEditor, path: selected as string });
      }
    } catch (error) {
      console.error("Failed to select file:", error);
    }
  }

  function handleAddEditor() {
    if (!newEditor.name.trim() || !newEditor.path.trim()) {
      alert("请填写编辑器名称和路径");
      return;
    }

    const editor: EditorConfig = {
      id: Date.now().toString(),
      name: newEditor.name.trim(),
      path: newEditor.path.trim(),
    };

    addEditor(editor);
    setNewEditor({ name: "", path: "" });
    setShowAddForm(false);
  }

  return (
    <section className="re-card">
      <h2 className="text-[17px] font-semibold mb-6">编辑器设置</h2>

      {/* 说明文档 */}
      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900">
            <p className="font-semibold mb-2">配置说明</p>
            <ul className="space-y-1 text-xs">
              <li>• <strong>Windows:</strong> 选择编辑器的 .exe 文件（如 C:\Program Files\Microsoft VS Code\Code.exe）</li>
              <li>• <strong>macOS:</strong> 选择应用程序包内的可执行文件（如 /Applications/Visual Studio Code.app/Contents/Resources/app/bin/code）</li>
              <li>• 可以添加多个编辑器，打开项目时将使用第一个配置的编辑器</li>
              <li>• 如果未配置编辑器，将尝试使用系统默认的 VS Code</li>
            </ul>
          </div>
        </div>
      </div>

      {/* 编辑器列表 */}
      <div className="space-y-3 mb-4">
        {editors.length === 0 ? (
          <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
            <div className="text-sm font-medium">暂无配置的编辑器</div>
            <div className="text-xs mt-1">点击下方按钮添加编辑器</div>
          </div>
        ) : (
          editors.map((editor, index) => (
            <div
              key={editor.id}
              className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-blue-300 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-gray-900">{editor.name}</span>
                  {index === 0 && (
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                      默认
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 font-mono truncate">{editor.path}</div>
              </div>
              <button
                onClick={() => removeEditor(editor.id)}
                className="ml-4 p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                title="删除"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* 添加编辑器表单 */}
      {showAddForm ? (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              编辑器名称
            </label>
            <input
              type="text"
              value={newEditor.name}
              onChange={(e) => setNewEditor({ ...newEditor, name: e.target.value })}
              placeholder="例如：VS Code、IntelliJ IDEA"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              可执行文件路径
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newEditor.path}
                onChange={(e) => setNewEditor({ ...newEditor, path: e.target.value })}
                placeholder="选择或输入编辑器可执行文件路径"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
              <button
                onClick={handleBrowsePath}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                <FolderOpen size={16} />
                浏览
              </button>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleAddEditor}
              className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              确认添加
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setNewEditor({ name: "", path: "" });
              }}
              className="px-6 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full py-2.5 border-2 border-dashed border-gray-300 hover:border-blue-500 text-gray-600 hover:text-blue-600 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          <Plus size={16} />
          添加编辑器
        </button>
      )}
    </section>
  );
}
