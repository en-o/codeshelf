import { useState, useEffect } from "react";
import {
  Activity,
  Network,
  ListTree,
  Play,
  Square,
  RefreshCw,
  Loader2,
  Trash2,
  Search,
  AlertCircle,
} from "lucide-react";
import { ToolPanelHeader } from "./index";
import { Input, Button } from "@/components/ui";
import {
  scanPorts,
  stopScan,
  getCommonPorts,
  scanLocalDevPorts,
  getLocalPortOccupation,
  getProcesses,
  getPortProcesses,
  killProcess,
  getSystemStats,
  formatBytes,
} from "@/services/toolbox";
import type {
  ScanResult,
  ScanConfig,
  PortOccupation,
  ProcessInfo,
  SystemStats,
} from "@/types/toolbox";

interface SystemMonitorProps {
  onBack: () => void;
}

type TabType = "scan" | "occupation" | "process";
type ScanMode = "common" | "range" | "custom";

export function SystemMonitor({ onBack }: SystemMonitorProps) {
  const [activeTab, setActiveTab] = useState<TabType>("occupation");

  // 端口扫描状态
  const [target, setTarget] = useState("127.0.0.1");
  const [scanMode, setScanMode] = useState<ScanMode>("common");
  const [portStart, setPortStart] = useState(1);
  const [portEnd, setPortEnd] = useState(1024);
  const [customPorts, setCustomPorts] = useState("");
  const [concurrency, setConcurrency] = useState(100);
  const [timeoutMs, setTimeoutMs] = useState(3000);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [commonPorts, setCommonPorts] = useState<number[]>([]);

  // 端口占用状态
  const [occupations, setOccupations] = useState<PortOccupation[]>([]);
  const [loadingOccupation, setLoadingOccupation] = useState(false);
  const [occupationFilter, setOccupationFilter] = useState("");

  // 进程管理状态
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [loadingProcesses, setLoadingProcesses] = useState(false);
  const [processSearch, setProcessSearch] = useState("");
  const [portFilter, setPortFilter] = useState("");

  // 公共状态
  const [showKillConfirm, setShowKillConfirm] = useState<{
    pid: number;
    name: string;
    source: "occupation" | "process";
  } | null>(null);

  // 加载常用端口列表
  useEffect(() => {
    getCommonPorts().then(setCommonPorts).catch(console.error);
  }, []);

  // 切换 Tab 时加载数据
  useEffect(() => {
    if (activeTab === "occupation" && occupations.length === 0) {
      loadOccupations();
    } else if (activeTab === "process" && processes.length === 0) {
      loadProcesses();
    }
  }, [activeTab]);

  // 加载端口占用
  async function loadOccupations() {
    setLoadingOccupation(true);
    try {
      const data = await getLocalPortOccupation();
      setOccupations(data);
    } catch (error) {
      console.error("获取端口占用失败:", error);
    } finally {
      setLoadingOccupation(false);
    }
  }

  // 加载进程列表
  async function loadProcesses() {
    setLoadingProcesses(true);
    try {
      const [procs, stats] = await Promise.all([
        getProcesses(),
        getSystemStats(),
      ]);
      setProcesses(procs);
      setSystemStats(stats);
    } catch (error) {
      console.error("加载进程数据失败:", error);
    } finally {
      setLoadingProcesses(false);
    }
  }

  // 开始扫描
  async function handleScan() {
    setScanning(true);
    setScanResults([]);

    try {
      const config: ScanConfig = {
        target,
        timeoutMs,
        concurrency,
      };

      if (scanMode === "common") {
        config.ports = commonPorts;
      } else if (scanMode === "range") {
        config.portStart = portStart;
        config.portEnd = portEnd;
      } else if (scanMode === "custom") {
        config.ports = customPorts
          .split(",")
          .map((p) => parseInt(p.trim()))
          .filter((p) => !isNaN(p) && p > 0 && p <= 65535);
      }

      const results = await scanPorts(config);
      setScanResults(results);
    } catch (error) {
      console.error("扫描失败:", error);
    } finally {
      setScanning(false);
    }
  }

  // 停止扫描
  async function handleStop() {
    try {
      await stopScan();
    } catch (error) {
      console.error("停止扫描失败:", error);
    }
    setScanning(false);
  }

  // 快速扫描本地开发端口
  async function handleScanLocalDev() {
    setScanning(true);
    setScanResults([]);
    setTarget("127.0.0.1");

    try {
      const results = await scanLocalDevPorts();
      setScanResults(results);
    } catch (error) {
      console.error("扫描失败:", error);
    } finally {
      setScanning(false);
    }
  }

  // 按端口过滤进程
  async function handlePortFilter() {
    const port = parseInt(portFilter);
    if (isNaN(port) || port <= 0) {
      loadProcesses();
      return;
    }

    setLoadingProcesses(true);
    try {
      const procs = await getPortProcesses(port);
      setProcesses(procs);
    } catch (error) {
      console.error("过滤进程失败:", error);
    } finally {
      setLoadingProcesses(false);
    }
  }

  // 终止进程
  async function handleKill(pid: number, force: boolean = false) {
    try {
      await killProcess(pid, force);
      setShowKillConfirm(null);
      // 刷新当前 Tab 的数据
      if (activeTab === "occupation") {
        loadOccupations();
      } else {
        loadProcesses();
      }
    } catch (error) {
      console.error("终止进程失败:", error);
      alert(`终止进程失败: ${error}`);
    }
  }

  // 过滤端口占用列表
  const filteredOccupations = occupations.filter((item) => {
    if (!occupationFilter) return true;
    const query = occupationFilter.toLowerCase();
    return (
      item.port.toString().includes(query) ||
      item.processName.toLowerCase().includes(query) ||
      item.pid.toString().includes(query)
    );
  });

  // 过滤进程列表
  const filteredProcesses = processes.filter((proc) => {
    if (!processSearch) return true;
    const query = processSearch.toLowerCase();
    return (
      proc.name.toLowerCase().includes(query) ||
      proc.pid.toString().includes(query) ||
      proc.cmd?.toLowerCase().includes(query)
    );
  });

  // 渲染头部操作按钮
  const renderHeaderActions = () => {
    if (activeTab === "scan") {
      return (
        <button
          onClick={handleScanLocalDev}
          disabled={scanning}
          className="re-btn flex items-center gap-2"
          title="快速扫描本地开发端口"
        >
          <RefreshCw size={16} />
          <span>扫描本地</span>
        </button>
      );
    } else if (activeTab === "occupation") {
      return (
        <button
          onClick={loadOccupations}
          disabled={loadingOccupation}
          className="re-btn flex items-center gap-2"
        >
          <RefreshCw size={16} className={loadingOccupation ? "animate-spin" : ""} />
          <span>刷新</span>
        </button>
      );
    } else {
      return (
        <button
          onClick={loadProcesses}
          disabled={loadingProcesses}
          className="re-btn flex items-center gap-2"
        >
          <RefreshCw size={16} className={loadingProcesses ? "animate-spin" : ""} />
          <span>刷新</span>
        </button>
      );
    }
  };

  return (
    <div className="flex flex-col min-h-full">
      <ToolPanelHeader
        title="系统监控"
        icon={Activity}
        onBack={onBack}
        actions={renderHeaderActions()}
      />

      <div className="flex-1 p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Tab 切换 */}
          <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
            <button
              onClick={() => setActiveTab("occupation")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                activeTab === "occupation"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <Network size={16} />
              端口占用
            </button>
            <button
              onClick={() => setActiveTab("scan")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                activeTab === "scan"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <Search size={16} />
              端口扫描
            </button>
            <button
              onClick={() => setActiveTab("process")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                activeTab === "process"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <ListTree size={16} />
              进程管理
            </button>
          </div>

          {/* 端口占用面板 */}
          {activeTab === "occupation" && (
            <div className="re-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  本地端口占用
                </h3>
                <div className="flex items-center gap-4">
                  <Input
                    value={occupationFilter}
                    onChange={(e) => setOccupationFilter(e.target.value)}
                    placeholder="搜索端口、进程名、PID..."
                    className="w-64"
                  />
                  {!loadingOccupation && occupations.length > 0 && (
                    <span className="text-sm text-gray-500">
                      共 {filteredOccupations.length} 个端口
                    </span>
                  )}
                </div>
              </div>

              {loadingOccupation ? (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                  <Loader2 size={32} className="animate-spin mb-4" />
                  <p>加载中...</p>
                </div>
              ) : filteredOccupations.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <Network size={48} className="mx-auto mb-4 opacity-50" />
                  <p>{occupationFilter ? "未找到匹配的端口" : "暂无端口占用信息"}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="text-left py-3 px-4 font-medium text-gray-500">端口</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-500">协议</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-500">进程名</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-500">PID</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-500">本地地址</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-500">状态</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-500">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOccupations.map((item, index) => (
                        <tr
                          key={`${item.port}-${item.protocol}-${item.pid}-${index}`}
                          className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        >
                          <td className="py-3 px-4 font-mono font-medium text-blue-600">
                            {item.port}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              item.protocol === "tcp"
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                                : "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
                            }`}>
                              {item.protocol.toUpperCase()}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-gray-900 dark:text-white font-medium">
                            {item.processName}
                          </td>
                          <td className="py-3 px-4 font-mono text-gray-500">
                            {item.pid}
                          </td>
                          <td className="py-3 px-4 font-mono text-gray-500 text-xs">
                            {item.localAddr}
                          </td>
                          <td className="py-3 px-4">
                            {item.state && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                {item.state}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => setShowKillConfirm({ pid: item.pid, name: item.processName, source: "occupation" })}
                              className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-500 transition-colors"
                              title="终止进程"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 端口扫描面板 */}
          {activeTab === "scan" && (
            <>
              {/* 配置区域 */}
              <div className="re-card p-5 space-y-4">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  扫描配置
                </h3>

                {/* 目标地址 */}
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-2">
                    目标地址
                  </label>
                  <Input
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    placeholder="输入 IP 地址，如 192.168.1.1"
                  />
                </div>

                {/* 扫描模式 */}
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-2">
                    扫描模式
                  </label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="scanMode"
                        checked={scanMode === "common"}
                        onChange={() => setScanMode("common")}
                        className="text-blue-500"
                      />
                      <span className="text-sm">常用端口 ({commonPorts.length}个)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="scanMode"
                        checked={scanMode === "range"}
                        onChange={() => setScanMode("range")}
                        className="text-blue-500"
                      />
                      <span className="text-sm">端口范围</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="scanMode"
                        checked={scanMode === "custom"}
                        onChange={() => setScanMode("custom")}
                        className="text-blue-500"
                      />
                      <span className="text-sm">自定义端口</span>
                    </label>
                  </div>
                </div>

                {/* 端口范围配置 */}
                {scanMode === "range" && (
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-500 mb-2">
                        起始端口
                      </label>
                      <Input
                        type="number"
                        min={1}
                        max={65535}
                        value={portStart}
                        onChange={(e) => setPortStart(parseInt(e.target.value) || 1)}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-500 mb-2">
                        结束端口
                      </label>
                      <Input
                        type="number"
                        min={1}
                        max={65535}
                        value={portEnd}
                        onChange={(e) => setPortEnd(parseInt(e.target.value) || 65535)}
                      />
                    </div>
                  </div>
                )}

                {/* 自定义端口 */}
                {scanMode === "custom" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-2">
                      端口列表（逗号分隔）
                    </label>
                    <Input
                      value={customPorts}
                      onChange={(e) => setCustomPorts(e.target.value)}
                      placeholder="如: 80, 443, 8080, 3000"
                    />
                  </div>
                )}

                {/* 高级配置 */}
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-500 mb-2">
                      并发数
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={500}
                      value={concurrency}
                      onChange={(e) => setConcurrency(parseInt(e.target.value) || 100)}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-500 mb-2">
                      超时时间 (ms)
                    </label>
                    <Input
                      type="number"
                      min={100}
                      max={10000}
                      value={timeoutMs}
                      onChange={(e) => setTimeoutMs(parseInt(e.target.value) || 3000)}
                    />
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex gap-3 pt-2">
                  {!scanning ? (
                    <Button onClick={handleScan} variant="primary">
                      <Play size={16} className="mr-2" />
                      开始扫描
                    </Button>
                  ) : (
                    <Button onClick={handleStop} variant="danger">
                      <Square size={16} className="mr-2" />
                      停止扫描
                    </Button>
                  )}
                </div>
              </div>

              {/* 扫描结果 */}
              <div className="re-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-900 dark:text-white">
                    扫描结果
                  </h3>
                  {scanning && (
                    <div className="flex items-center gap-2 text-blue-500">
                      <Loader2 size={16} className="animate-spin" />
                      <span className="text-sm">扫描中...</span>
                    </div>
                  )}
                  {!scanning && scanResults.length > 0 && (
                    <span className="text-sm text-gray-500">
                      发现 {scanResults.length} 个开放端口
                    </span>
                  )}
                </div>

                {scanResults.length === 0 && !scanning ? (
                  <div className="text-center py-10 text-gray-400">
                    <Network size={48} className="mx-auto mb-4 opacity-50" />
                    <p>暂无扫描结果</p>
                    <p className="text-sm mt-1">点击"开始扫描"开始检测</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700">
                          <th className="text-left py-3 px-4 font-medium text-gray-500">端口</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-500">状态</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-500">服务</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-500">IP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scanResults.map((result, index) => (
                          <tr
                            key={`${result.ip}-${result.port}-${index}`}
                            className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                          >
                            <td className="py-3 px-4 font-mono font-medium text-blue-600">
                              {result.port}
                            </td>
                            <td className="py-3 px-4">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                开放
                              </span>
                            </td>
                            <td className="py-3 px-4 text-gray-600 dark:text-gray-400">
                              {result.service || "-"}
                            </td>
                            <td className="py-3 px-4 text-gray-500 font-mono">
                              {result.ip}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {/* 进程管理面板 */}
          {activeTab === "process" && (
            <>
              {/* 系统统计 */}
              {systemStats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="re-card p-4">
                    <div className="text-sm text-gray-500 mb-1">内存使用</div>
                    <div className="text-lg font-semibold text-gray-900 dark:text-white">
                      {formatBytes(systemStats.usedMemory)} / {formatBytes(systemStats.totalMemory)}
                    </div>
                    <div className="mt-2 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500"
                        style={{
                          width: `${(systemStats.usedMemory / systemStats.totalMemory) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="re-card p-4">
                    <div className="text-sm text-gray-500 mb-1">交换空间</div>
                    <div className="text-lg font-semibold text-gray-900 dark:text-white">
                      {formatBytes(systemStats.usedSwap)} / {formatBytes(systemStats.totalSwap)}
                    </div>
                    <div className="mt-2 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500"
                        style={{
                          width: systemStats.totalSwap > 0
                            ? `${(systemStats.usedSwap / systemStats.totalSwap) * 100}%`
                            : "0%",
                        }}
                      />
                    </div>
                  </div>
                  <div className="re-card p-4">
                    <div className="text-sm text-gray-500 mb-1">CPU 核心数</div>
                    <div className="text-lg font-semibold text-gray-900 dark:text-white">
                      {systemStats.cpuCount}
                    </div>
                  </div>
                  <div className="re-card p-4">
                    <div className="text-sm text-gray-500 mb-1">进程总数</div>
                    <div className="text-lg font-semibold text-gray-900 dark:text-white">
                      {systemStats.processCount}
                    </div>
                  </div>
                </div>
              )}

              {/* 过滤器 */}
              <div className="re-card p-4">
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-500 mb-2">
                      搜索进程
                    </label>
                    <div className="relative">
                      <Input
                        value={processSearch}
                        onChange={(e) => setProcessSearch(e.target.value)}
                        placeholder="按名称、PID 或命令搜索..."
                      />
                      <Search
                        size={16}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                      />
                    </div>
                  </div>
                  <div className="w-full md:w-48">
                    <label className="block text-sm font-medium text-gray-500 mb-2">
                      按端口过滤
                    </label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        value={portFilter}
                        onChange={(e) => setPortFilter(e.target.value)}
                        placeholder="端口号"
                      />
                      <Button onClick={handlePortFilter} variant="secondary">
                        过滤
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 进程列表 */}
              <div className="re-card overflow-hidden">
                {loadingProcesses ? (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                    <Loader2 size={32} className="animate-spin mb-4" />
                    <p>加载中...</p>
                  </div>
                ) : filteredProcesses.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                    <ListTree size={48} className="mb-4 opacity-50" />
                    <p>未找到匹配的进程</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                          <th className="text-left py-3 px-4 font-medium text-gray-500">PID</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-500">名称</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-500">端口</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-500">状态</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-500">内存</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-500">CPU</th>
                          <th className="text-right py-3 px-4 font-medium text-gray-500">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredProcesses.slice(0, 100).map((proc) => (
                          <tr
                            key={proc.pid}
                            className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                          >
                            <td className="py-3 px-4 font-mono text-blue-600">
                              {proc.pid}
                            </td>
                            <td className="py-3 px-4 font-medium text-gray-900 dark:text-white">
                              {proc.name}
                            </td>
                            <td className="py-3 px-4 text-gray-500">
                              {proc.port ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                                  {proc.protocol?.toUpperCase()}:{proc.port}
                                </span>
                              ) : (
                                "-"
                              )}
                            </td>
                            <td className="py-3 px-4 text-gray-500">{proc.status}</td>
                            <td className="py-3 px-4 text-gray-500">
                              {formatBytes(proc.memory)}
                            </td>
                            <td className="py-3 px-4 text-gray-500">
                              {proc.cpu.toFixed(1)}%
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                onClick={() => setShowKillConfirm({ pid: proc.pid, name: proc.name, source: "process" })}
                                className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-500 transition-colors"
                                title="终止进程"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filteredProcesses.length > 100 && (
                      <div className="text-center py-3 text-sm text-gray-500 border-t border-gray-100 dark:border-gray-800">
                        显示前 100 条，共 {filteredProcesses.length} 条
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 终止进程确认对话框 */}
      {showKillConfirm !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center gap-3 text-red-500 mb-4">
              <AlertCircle size={24} />
              <h3 className="text-lg font-semibold">终止进程</h3>
            </div>

            <p className="text-gray-600 dark:text-gray-400 mb-6">
              确定要终止进程 <span className="font-mono font-medium">{showKillConfirm.name}</span> (PID: {showKillConfirm.pid}) 吗？
            </p>

            <div className="flex justify-end gap-3">
              <Button onClick={() => setShowKillConfirm(null)} variant="secondary">
                取消
              </Button>
              <Button
                onClick={() => handleKill(showKillConfirm.pid, false)}
                variant="danger"
              >
                终止
              </Button>
              <Button
                onClick={() => handleKill(showKillConfirm.pid, true)}
                variant="danger"
              >
                强制终止
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
