import { ArrowLeftRight, FolderOpen, Globe, Lock, Plus, X } from "lucide-react";
import { Input, Button } from "@/components/ui";
import type { AuthRuleInput, ForwardRule, ProxyConfig, ServerConfig } from "@/types/toolbox";
import type { ServiceType } from "./types";

interface ServiceFormDialogProps {
  serviceType: ServiceType;
  editingServer: ServerConfig | null;
  editingRule: ForwardRule | null;
  formName: string;
  formPort: string;
  formRootDir: string;
  formUrlPrefix: string;
  formIndexPage: string;
  formCors: boolean;
  formGzip: boolean;
  formProxies: ProxyConfig[];
  formAuthRules: AuthRuleInput[];
  formLocalPort: string;
  formRemoteHost: string;
  formRemotePort: string;
  formDocPath: string;
  formExposeLan: boolean;
  onServiceTypeChange: (type: ServiceType) => void;
  onFormNameChange: (value: string) => void;
  onFormPortChange: (value: string) => void;
  onFormRootDirChange: (value: string) => void;
  onFormUrlPrefixChange: (value: string) => void;
  onFormIndexPageChange: (value: string) => void;
  onFormCorsChange: (value: boolean) => void;
  onFormGzipChange: (value: boolean) => void;
  onFormLocalPortChange: (value: string) => void;
  onFormRemoteHostChange: (value: string) => void;
  onFormRemotePortChange: (value: string) => void;
  onFormDocPathChange: (value: string) => void;
  onFormExposeLanChange: (value: boolean) => void;
  onSelectDir: () => void;
  onAddProxy: () => void;
  onUpdateProxy: (index: number, field: "prefix" | "target", value: string) => void;
  onRemoveProxy: (index: number) => void;
  onAddAuthRule: () => void;
  onUpdateAuthRule: (index: number, patch: Partial<AuthRuleInput>) => void;
  onRemoveAuthRule: (index: number) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function ServiceFormDialog({
  serviceType,
  editingServer,
  editingRule,
  formName,
  formPort,
  formRootDir,
  formUrlPrefix,
  formIndexPage,
  formCors,
  formGzip,
  formProxies,
  formAuthRules,
  formLocalPort,
  formRemoteHost,
  formRemotePort,
  formDocPath,
  formExposeLan,
  onServiceTypeChange,
  onFormNameChange,
  onFormPortChange,
  onFormRootDirChange,
  onFormUrlPrefixChange,
  onFormIndexPageChange,
  onFormCorsChange,
  onFormGzipChange,
  onFormLocalPortChange,
  onFormRemoteHostChange,
  onFormRemotePortChange,
  onFormDocPathChange,
  onFormExposeLanChange,
  onSelectDir,
  onAddProxy,
  onUpdateProxy,
  onRemoveProxy,
  onAddAuthRule,
  onUpdateAuthRule,
  onRemoveAuthRule,
  onCancel,
  onSubmit,
}: ServiceFormDialogProps) {
  const isEditing = Boolean(editingServer || editingRule);

  return (
    <div className="fixed inset-0 top-8 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          {isEditing ? "编辑服务" : "创建服务"}
        </h3>

        {!isEditing && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-500 mb-2">服务类型</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={serviceType === "web"}
                  onChange={() => onServiceTypeChange("web")}
                  className="text-blue-500"
                />
                <Globe size={16} className="text-blue-500" />
                <span className="text-sm">Web 服务</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={serviceType === "forward"}
                  onChange={() => onServiceTypeChange("forward")}
                  className="text-blue-500"
                />
                <ArrowLeftRight size={16} className="text-purple-500" />
                <span className="text-sm">端口转发</span>
              </label>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-2">服务名称</label>
            <Input
              value={formName}
              onChange={(e) => onFormNameChange(e.target.value)}
              placeholder={serviceType === "web" ? "如: 前端开发服务" : "如: 本地开发代理"}
            />
          </div>

          {serviceType === "web" ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">端口号</label>
                <Input
                  type="number"
                  value={formPort}
                  onChange={(e) => onFormPortChange(e.target.value)}
                  placeholder="如: 8080"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">静态文件目录</label>
                <div className="flex gap-2">
                  <Input
                    value={formRootDir}
                    onChange={(e) => onFormRootDirChange(e.target.value)}
                    placeholder="选择或输入目录路径"
                    className="flex-1"
                  />
                  <Button onClick={onSelectDir} variant="secondary">
                    <FolderOpen size={16} />
                  </Button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">访问前缀</label>
                <Input
                  value={formUrlPrefix}
                  onChange={(e) => onFormUrlPrefixChange(e.target.value)}
                  placeholder="默认使用目录名，如 /dist，输入 / 表示无前缀"
                />
                <p className="text-xs text-gray-400 mt-1">
                  设置访问 URL 前缀，默认使用目录名。输入 "/" 表示无前缀（直接访问根路径）
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">
                  首页文件 <span className="text-gray-400 font-normal">(可选)</span>
                </label>
                <Input
                  value={formIndexPage}
                  onChange={(e) => onFormIndexPageChange(e.target.value)}
                  placeholder="如: index.html、index、home.html"
                />
                <p className="text-xs text-gray-400 mt-1">
                  设置后启动时自动打开该页面；留空则打开目录文件列表（存在 index.html 时优先显示首页）
                </p>
              </div>

              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formCors}
                    onChange={(e) => onFormCorsChange(e.target.checked)}
                    className="rounded text-blue-500"
                  />
                  <span className="text-sm">启用 CORS</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formGzip}
                    onChange={(e) => onFormGzipChange(e.target.checked)}
                    className="rounded text-blue-500"
                  />
                  <span className="text-sm">启用 GZIP 压缩</span>
                </label>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">API 代理规则</span>
                  <button
                    onClick={onAddProxy}
                    className="text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1"
                  >
                    <Plus size={14} />
                    添加规则
                  </button>
                </div>

                {formProxies.length === 0 ? (
                  <p className="text-sm text-gray-400">暂无代理规则，点击"添加规则"配置 API 代理</p>
                ) : (
                  <div className="space-y-3">
                    {formProxies.map((proxy, index) => (
                      <div key={index} className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div className="flex-1 space-y-2">
                          <Input
                            value={proxy.prefix}
                            onChange={(e) => onUpdateProxy(index, "prefix", e.target.value)}
                            placeholder="本地访问路径，如: /api"
                          />
                          <Input
                            value={proxy.target}
                            onChange={(e) => onUpdateProxy(index, "target", e.target.value)}
                            placeholder="代理目标地址，如: http://192.168.1.100:8080/api"
                          />
                        </div>
                        <button
                          onClick={() => onRemoveProxy(index)}
                          className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                    <p className="text-xs text-gray-400">
                      访问本地路径的请求将被转发到代理目标地址，如: /api/* → http://192.168.1.100:8080/api/*
                    </p>
                  </div>
                )}
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    <Lock size={14} className="text-amber-500" />
                    访问控制
                  </span>
                  <button
                    onClick={onAddAuthRule}
                    className="text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1"
                  >
                    <Plus size={14} />
                    添加规则
                  </button>
                </div>

                {formAuthRules.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    暂无规则，全部内容公开访问。可对整站、某个子目录或单个文件设访问密码
                  </p>
                ) : (
                  <div className="space-y-3">
                    {formAuthRules.map((rule, index) => (
                      <div key={index} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            value={rule.path}
                            onChange={(e) => onUpdateAuthRule(index, { path: e.target.value })}
                            placeholder="保护的访问路径，如: / 或 /private 或 /docs/salary.pdf"
                            className="flex-1"
                          />
                          <select
                            value={rule.matchKind || "prefix"}
                            onChange={(e) => onUpdateAuthRule(index, { matchKind: e.target.value })}
                            className="px-2 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md outline-none dark:text-gray-100"
                            title="prefix = 连同下级内容一起锁；exact = 只锁这一个路径"
                          >
                            <option value="prefix">含子路径</option>
                            <option value="exact">仅此路径</option>
                          </select>
                          <button
                            onClick={() => onRemoveAuthRule(index)}
                            className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                          >
                            <X size={16} />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            type="password"
                            value={rule.password || ""}
                            onChange={(e) => onUpdateAuthRule(index, { password: e.target.value })}
                            placeholder={rule.id ? "留空 = 不改密码" : "设置访问密码"}
                            className="flex-1"
                          />
                          <Input
                            value={rule.label || ""}
                            onChange={(e) => onUpdateAuthRule(index, { label: e.target.value })}
                            placeholder="登录页提示（可选）"
                            className="flex-1"
                          />
                          <label className="flex items-center gap-1.5 text-xs text-gray-500 whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={rule.enabled !== false}
                              onChange={(e) => onUpdateAuthRule(index, { enabled: e.target.checked })}
                              className="rounded text-blue-500"
                            />
                            启用
                          </label>
                        </div>
                      </div>
                    ))}
                    {(() => {
                      // 规则匹配的是 URL 路径。服务挂在 /dist 下却填 /private 时，
                      // 请求路径其实是 /dist/private —— 规则永远命不中，用户会以为锁上了。
                      const prefix = formUrlPrefix.trim().replace(/\/+$/, "");
                      if (!prefix || prefix === "/") return null;
                      const outside = formAuthRules.filter(
                        (r) =>
                          r.path?.trim() &&
                          r.path.trim() !== prefix &&
                          !r.path.trim().startsWith(`${prefix}/`)
                      );
                      if (outside.length === 0) return null;
                      return (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          {outside.map((r) => r.path).join("、")} 不在访问前缀 {prefix} 之下，
                          这条规则不会生效。路径要写成 {prefix}/xxx
                        </p>
                      );
                    })()}
                    <p className="text-xs text-gray-400">
                      命中最长的规则生效。访问时会跳到登录页，输入密码后凭会话 Cookie 继续访问；密码只存哈希，不可找回。
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">本地端口</label>
                <Input
                  type="number"
                  value={formLocalPort}
                  onChange={(e) => onFormLocalPortChange(e.target.value)}
                  placeholder="如: 8080"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">远程主机</label>
                <Input
                  value={formRemoteHost}
                  onChange={(e) => onFormRemoteHostChange(e.target.value)}
                  placeholder="如: 192.168.1.100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">远程端口</label>
                <Input
                  type="number"
                  value={formRemotePort}
                  onChange={(e) => onFormRemotePortChange(e.target.value)}
                  placeholder="如: 3000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">
                  文档路径 <span className="text-gray-400 font-normal">(可选)</span>
                </label>
                <Input
                  value={formDocPath}
                  onChange={(e) => onFormDocPathChange(e.target.value)}
                  placeholder="如: doc.html、swagger-ui.html"
                />
                <p className="text-xs text-gray-400 mt-1">
                  设置快捷访问路径，如 API 文档页面。留空则直接访问根路径
                </p>
              </div>
            </>
          )}

          {/* 监听范围：默认只有本机能访问。以前一律绑 0.0.0.0 却显示 127.0.0.1，
              用户在咖啡厅 Wi-Fi 上把内部服务/目录暴露给了整个网段还不知道。 */}
          <div className="rounded-md border border-border p-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={formExposeLan}
                onChange={(e) => onFormExposeLanChange(e.target.checked)}
              />
              <span>
                <span className="font-medium">对局域网开放</span>
                <span className="block text-xs text-gray-400 mt-1">
                  {formExposeLan
                    ? "将监听 0.0.0.0 —— 同一网络下的任何设备都能访问。请确认当前网络可信。"
                    : "当前只监听 127.0.0.1，仅本机可访问（推荐）。需要手机/同事访问时才勾选。"}
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button onClick={onCancel} variant="secondary">
            取消
          </Button>
          <Button onClick={onSubmit} variant="primary">
            {isEditing ? "保存" : "创建"}
          </Button>
        </div>
      </div>
    </div>
  );
}
