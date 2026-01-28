import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { addProject } from "@/services/db";
import { isGitRepo, gitInit } from "@/services/git";
import { useAppStore } from "@/stores/appStore";
import type { Project } from "@/types";

interface AddProjectDialogProps {
  onConfirm: (project: Project) => void;
  onCancel: () => void;
}

export function AddProjectDialog({ onConfirm, onCancel }: AddProjectDialogProps) {
  const { categories: storeCategories, addCategory, labels: storeLabels, addLabel } = useAppStore();
  const [mode, setMode] = useState<"local" | "git">("local");
  const [localPath, setLocalPath] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [gitTargetPath, setGitTargetPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedTechs, setSelectedTechs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [newCategoryInput, setNewCategoryInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [customTechInput, setCustomTechInput] = useState(false);
  const [customTechName, setCustomTechName] = useState("");

  // Git repository check
  const [isGitRepository, setIsGitRepository] = useState<boolean | null>(null);
  const [shouldInitGit, setShouldInitGit] = useState(false);

  // 标签图标配置
  const LABEL_ICONS: Record<string, { bg: string; text: string; round?: boolean }> = {
    "Java": { bg: "bg-orange-600", text: "J" },
    "Vue": { bg: "bg-green-500", text: "V", round: true },
    "React": { bg: "bg-blue-400", text: "⚛", round: true },
    "Angular": { bg: "bg-red-500", text: "A", round: true },
    "小程序": { bg: "bg-green-600", text: "微" },
    "Node.js": { bg: "bg-green-500", text: "N" },
    "Python": { bg: "bg-blue-500", text: "P", round: true },
    "Go": { bg: "bg-cyan-500", text: "G", round: true },
    "Rust": { bg: "bg-orange-700", text: "R", round: true },
    "TypeScript": { bg: "bg-blue-600", text: "TS" },
    "JavaScript": { bg: "bg-yellow-400", text: "JS" },
    "PHP": { bg: "bg-indigo-500", text: "P" },
    "Spring Boot": { bg: "bg-green-600", text: "S" },
    "Docker": { bg: "bg-blue-500", text: "D" },
    "Kubernetes": { bg: "bg-blue-600", text: "K8" },
  };

  function getLabelIcon(label: string) {
    const config = LABEL_ICONS[label] || { bg: "bg-gray-500", text: label.slice(0, 2) };
    return (
      <div className={`w-5 h-5 ${config.round ? 'rounded-full' : 'rounded'} ${config.bg} flex items-center justify-center flex-shrink-0`}>
        <span className="text-white text-xs font-medium">{config.text}</span>
      </div>
    );
  }

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) {
        onCancel();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [loading, onCancel]);

  async function handleSelectLocalPath() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择项目文件夹",
      });

      if (selected) {
        const path = selected as string;
        setLocalPath(path);
        if (!projectName) {
          const name = path.split(/[\\/]/).pop() || "";
          setProjectName(name);
        }
        setError("");

        // Check if it's a git repository
        try {
          const isRepo = await isGitRepo(path);
          setIsGitRepository(isRepo);
          setShouldInitGit(!isRepo); // Default to init if not a repo
        } catch {
          setIsGitRepository(false);
          setShouldInitGit(true);
        }
      }
    } catch (err) {
      setError("选择文件夹失败");
    }
  }

  async function handleSelectGitTargetPath() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择克隆目标目录",
      });

      if (selected) {
        setGitTargetPath(selected as string);
        setError("");
      }
    } catch (err) {
      setError("选择目录失败");
    }
  }

  async function handleConfirm() {
    try {
      setLoading(true);
      setError("");

      if (mode === "local") {
        if (!localPath) {
          setError("请选择项目文件夹");
          return;
        }

        // Initialize git if user chose to
        if (!isGitRepository && shouldInitGit) {
          try {
            await gitInit(localPath);
          } catch (err) {
            setError("Git 初始化失败: " + err);
            return;
          }
        }

        const name = projectName.trim() || localPath.split(/[\\/]/).pop() || "Unknown";
        const project = await addProject({
          name,
          path: localPath,
          tags: selectedCategories,
          labels: selectedTechs,
        });

        onConfirm(project);
      } else {
        if (!gitUrl.trim()) {
          setError("请输入 Git 仓库地址");
          return;
        }
        if (!gitTargetPath) {
          setError("请选择克隆目标目录");
          return;
        }

        let name = projectName.trim();
        if (!name) {
          const match = gitUrl.match(/\/([^\/]+?)(\.git)?$/);
          name = match ? match[1] : "Unknown";
        }

        const clonePath = await invoke<string>("git_clone", {
          url: gitUrl.trim(),
          targetDir: gitTargetPath,
          repoName: name,
        });

        const project = await addProject({
          name,
          path: clonePath,
          tags: selectedCategories,
          labels: selectedTechs,
        });

        onConfirm(project);
      }
    } catch (err: any) {
      setError(err.toString());
    } finally {
      setLoading(false);
    }
  }

  function toggleCategory(name: string) {
    if (selectedCategories.includes(name)) {
      setSelectedCategories(selectedCategories.filter((c) => c !== name));
    } else {
      setSelectedCategories([...selectedCategories, name]);
    }
  }

  function toggleTech(value: string) {
    if (selectedTechs.includes(value)) {
      setSelectedTechs(selectedTechs.filter((t) => t !== value));
    } else {
      setSelectedTechs([...selectedTechs, value]);
    }
  }

  function addNewCategory() {
    setNewCategoryInput(true);
  }

  function confirmAddCategory() {
    const name = newCategoryName.trim();
    if (name) {
      if (!storeCategories.includes(name)) {
        addCategory(name);
      }
      setSelectedCategories([...selectedCategories, name]);
      setNewCategoryName("");
      setNewCategoryInput(false);
    }
  }

  function cancelAddCategory() {
    setNewCategoryName("");
    setNewCategoryInput(false);
  }

  function addCustomTech() {
    setCustomTechInput(true);
  }

  function confirmAddTech() {
    const name = customTechName.trim();
    if (name) {
      // 添加到 store 中
      addLabel(name);
      setSelectedTechs([...selectedTechs, name]);
      setCustomTechName("");
      setCustomTechInput(false);
    }
  }

  function cancelAddTech() {
    setCustomTechName("");
    setCustomTechInput(false);
  }

  const canSubmit = mode === "local" ? !!localPath : !!gitUrl && !!gitTargetPath;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="add-project-dialog bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden border border-gray-100 flex flex-col max-h-[600px]">
        {/* 头部 */}
        <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
              <i className="fa-solid fa-plus text-white text-xl"></i>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800">添加项目</h2>
              <p className="text-sm text-gray-500 mt-0.5">添加本地已有项目到书架</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={loading}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
          >
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        {/* 可滚动内容区 */}
        <div className="flex-1 overflow-y-auto add-project-scrollbar">
          {/* 标签切换 */}
          <div className="px-8 pt-6">
            <div className="flex gap-3 p-1 bg-gray-100 rounded-xl inline-flex">
              <button
                onClick={() => { setMode("local"); setError(""); }}
                className={`add-project-tab ${mode === "local" ? "add-project-tab-active" : "add-project-tab-inactive"}`}
              >
                <i className="fa-regular fa-folder-open"></i>
                本地目录
                <span className="text-xs opacity-75 ml-1">添加已存在的项目</span>
              </button>
              <button
                onClick={() => { setMode("git"); setError(""); }}
                className={`add-project-tab ${mode === "git" ? "add-project-tab-active" : "add-project-tab-inactive"}`}
              >
                <i className="fa-brands fa-git-alt"></i>
                Git 克隆
                <span className="text-xs opacity-75 ml-1">从远程仓库克隆</span>
              </button>
            </div>
          </div>

          {/* 表单内容 */}
          <div className="p-8 space-y-6">
            {/* 步骤1：选择路径 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <span className="add-project-step-number">1</span>
                <span>{mode === "local" ? "选择项目路径" : "配置仓库信息"}</span>
              </div>

              {mode === "local" ? (
                <div className="space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={localPath}
                        readOnly
                        placeholder="点击选择项目文件夹..."
                        onClick={handleSelectLocalPath}
                        className="w-full pl-4 pr-10 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm add-project-input transition-all placeholder-gray-400 cursor-pointer"
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                        <i className="fa-regular fa-folder text-lg"></i>
                      </div>
                    </div>
                    <button
                      onClick={handleSelectLocalPath}
                      className="px-5 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all flex items-center gap-2 shadow-sm"
                    >
                      <i className="fa-solid fa-folder-tree"></i>
                      浏览
                    </button>
                  </div>

                  {/* Git Repository Status */}
                  {localPath && isGitRepository !== null && (
                    <div className={`flex items-center gap-3 p-3 rounded-xl ${isGitRepository ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
                      {isGitRepository ? (
                        <>
                          <i className="fa-brands fa-git-alt text-green-600"></i>
                          <span className="text-sm text-green-700">已检测到 Git 仓库</span>
                        </>
                      ) : (
                        <>
                          <i className="fa-solid fa-exclamation-triangle text-amber-600"></i>
                          <span className="text-sm text-amber-700 flex-1">此目录不是 Git 仓库</span>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={shouldInitGit}
                              onChange={(e) => setShouldInitGit(e.target.checked)}
                              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                            />
                            <span className="text-sm font-medium text-amber-800">初始化 Git 仓库</span>
                          </label>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative">
                    <i className="fa-brands fa-git-alt absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
                    <input
                      type="text"
                      value={gitUrl}
                      onChange={(e) => { setGitUrl(e.target.value); setError(""); }}
                      placeholder="https://github.com/user/repo.git"
                      className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono add-project-input transition-all"
                    />
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={gitTargetPath}
                        readOnly
                        placeholder="选择克隆目标目录..."
                        onClick={handleSelectGitTargetPath}
                        className="w-full pl-4 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm add-project-input transition-all cursor-pointer text-gray-800 placeholder-gray-400"
                      />
                    </div>
                    <button
                      onClick={handleSelectGitTargetPath}
                      className="px-5 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all flex items-center gap-2 shadow-sm"
                    >
                      <i className="fa-solid fa-folder-tree"></i>
                      浏览
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 步骤2：完善信息 */}
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <span className="add-project-step-number">2</span>
                <span>完善项目信息</span>
              </div>

              {/* 项目名称 */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">项目名称</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="留空则自动从路径提取"
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm add-project-input transition-all placeholder-gray-400"
                />
              </div>

              {/* 选择分类 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">选择分类（可多选）</label>
                  {!newCategoryInput && (
                    <button
                      onClick={addNewCategory}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 hover:gap-1.5 transition-all"
                    >
                      <i className="fa-solid fa-plus text-xs"></i>
                      新建分类
                    </button>
                  )}
                </div>

                {/* New Category Input */}
                {newCategoryInput && (
                  <div className="flex gap-2 add-project-animate-slide-in">
                    <input
                      type="text"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && confirmAddCategory()}
                      placeholder="输入新分类名称..."
                      autoFocus
                      className="flex-1 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-700 placeholder-gray-400 add-project-input"
                    />
                    <button
                      onClick={confirmAddCategory}
                      className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
                    >
                      添加
                    </button>
                    <button
                      onClick={cancelAddCategory}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {storeCategories.map((category) => (
                    <label key={category} className="cursor-pointer add-project-category-pill">
                      <input
                        type="checkbox"
                        className="add-project-category-checkbox hidden"
                        checked={selectedCategories.includes(category)}
                        onChange={() => toggleCategory(category)}
                        value={category}
                      />
                      <div className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-full text-sm font-medium text-gray-600 hover:border-gray-300 select-none pr-8 transition-all">
                        {category}
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* 技术栈标签 */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    技术栈标签（可多选）
                    <span className="text-xs text-gray-400 font-normal">帮助快速识别项目类型</span>
                  </label>
                  {!customTechInput && (
                    <button
                      onClick={addCustomTech}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 hover:gap-1.5 transition-all"
                    >
                      <i className="fa-solid fa-plus text-xs"></i>
                      自定义
                    </button>
                  )}
                </div>

                {/* Custom Tech Input */}
                {customTechInput && (
                  <div className="flex gap-2 add-project-animate-slide-in">
                    <input
                      type="text"
                      value={customTechName}
                      onChange={(e) => setCustomTechName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && confirmAddTech()}
                      placeholder="输入技术栈名称..."
                      autoFocus
                      className="flex-1 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-700 placeholder-gray-400 add-project-input"
                    />
                    <button
                      onClick={confirmAddTech}
                      className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
                    >
                      添加
                    </button>
                    <button
                      onClick={cancelAddTech}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-4 gap-2">
                  {storeLabels.map((label) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => toggleTech(label)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-left ${
                        selectedTechs.includes(label)
                          ? "bg-blue-50 border-2 border-blue-500"
                          : "bg-gray-50 border-2 border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      {getLabelIcon(label)}
                      <span className={`text-sm font-medium truncate ${selectedTechs.includes(label) ? "text-blue-700" : "text-gray-700"}`}>
                        {label}
                      </span>
                    </button>
                  ))}
                  {storeLabels.length === 0 && (
                    <div className="col-span-4 text-center py-4 text-gray-400 text-sm">
                      暂无标签，请在设置中添加或点击"自定义"
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                <i className="fa-solid fa-circle-exclamation text-red-500 flex-shrink-0 mt-0.5"></i>
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* 底部留白，防止内容被固定底部遮挡 */}
            <div className="h-20"></div>
          </div>
        </div>

        {/* 底部固定按钮栏 */}
        <div className="px-8 py-5 bg-gray-50 border-t border-gray-200 flex justify-end gap-3 shrink-0 sticky bottom-0 z-10">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-6 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-200 transition-all"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || !canSubmit}
            className="add-project-btn-primary px-8 py-2.5 text-white rounded-xl text-sm font-medium transition-all flex items-center gap-2 min-w-[120px] justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading && <i className="fa-solid fa-circle-notch fa-spin"></i>}
            {!loading && <i className="fa-solid fa-check"></i>}
            {loading ? (mode === "git" ? "克隆中..." : "添加中...") : "确定"}
          </button>
        </div>
      </div>

      <style>{`
        .add-project-dialog {
          animation: addProjectSlideIn 0.3s ease-out;
        }
        @keyframes addProjectSlideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .add-project-step-number {
          background: #3b82f6;
          color: white;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 600;
        }
        .add-project-input:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        .add-project-tab {
          padding: 0.625rem 1.5rem;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          font-weight: 500;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .add-project-tab-active {
          background: #3b82f6;
          color: white;
          box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.3);
        }
        .add-project-tab-inactive {
          background: white;
          color: #6b7280;
          border: 1px solid #e5e7eb;
        }
        .add-project-tab-inactive:hover {
          background: #f9fafb;
          color: #374151;
        }
        .add-project-category-checkbox:checked + div {
          background: #eff6ff;
          border-color: #3b82f6;
          color: #1e40af;
          position: relative;
        }
        .add-project-category-checkbox:checked + div::after {
          content: '\u2713';
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 12px;
          color: #3b82f6;
        }
        .add-project-category-pill {
          transition: all 0.2s;
        }
        .add-project-category-pill:hover {
          transform: scale(1.02);
        }
        .add-project-btn-primary {
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
        }
        .add-project-btn-primary:hover:not(:disabled) {
          background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
          box-shadow: 0 6px 20px rgba(59, 130, 246, 0.5);
          transform: translateY(-1px);
        }
        .add-project-btn-primary:active:not(:disabled) {
          transform: translateY(0);
          box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4);
        }
        .add-project-animate-slide-in {
          animation: addProjectSlideInFromTop 0.15s ease-out;
        }
        @keyframes addProjectSlideInFromTop {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .add-project-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .add-project-scrollbar::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-radius: 4px;
        }
        .add-project-scrollbar::-webkit-scrollbar-thumb {
          background: #c1c1c1;
          border-radius: 4px;
        }
        .add-project-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #a8a8a8;
        }
      `}</style>
    </div>
  );
}
