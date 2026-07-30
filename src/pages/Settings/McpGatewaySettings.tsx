import { useMemo } from "react";
import { ExternalLink, Server } from "lucide-react";
import { showToast } from "@/components/ui";
import {
  ClientAuthGuide,
  ConfigBlock,
  GatewayListenerForm,
  GatewayStatusCard,
  InternalUsageCard,
  KeyManagerSection,
  KeyUsageExamples,
  SecurityNotice,
  codexTomlHeader,
  codexTomlQuery,
  configForKeyHeader,
  configForKeyQuery,
  isActiveKey,
  useMcpGateway,
} from "./mcpGateway";

/**
 * MCP Gateway 设置页面（顶层编排）：
 * - 业务状态由 useMcpGateway hook 管理；本组件只负责把数据派发给各小组件，
 *   并在启停时做必要的二次确认（鉴权风险、活动密钥被切断等）。
 * - 默认所有展示的客户端配置都采用「Authorization: Bearer」标头鉴权，
 *   兼容性最好；查询参数版本仅作为兜底，给不支持自定义标头的客户端使用。
 */
export function McpGatewaySettings() {
  const {
    status, host, setHost, port, setPort, keys, busy,
    refresh, startGateway, stopGateway, saveKeys,
  } = useMcpGateway();

  const activeKeys = useMemo(() => keys.filter(isActiveKey), [keys]);
  const firstActiveKey = activeKeys[0]?.key || null;
  const exampleKey = firstActiveKey || "<YOUR_MCP_KEY>";
  const httpUrl = status?.url || `http://${host || "127.0.0.1"}:${port || "8787"}/mcp`;

  // 标头鉴权（推荐）
  const headerJson = useMemo(() => configForKeyHeader(httpUrl, exampleKey), [httpUrl, exampleKey]);
  const headerToml = useMemo(() => codexTomlHeader(httpUrl, exampleKey), [httpUrl, exampleKey]);
  // 查询参数鉴权（兼容用）
  const queryJson = useMemo(() => configForKeyQuery(httpUrl, exampleKey), [httpUrl, exampleKey]);
  const queryToml = useMemo(() => codexTomlQuery(httpUrl, exampleKey), [httpUrl, exampleKey]);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("success", `${label}已复制`);
    } catch {
      showToast("error", "复制失败");
    }
  }

  async function handleStart() {
    // 后端 ensure_gateway_key 会在启动前补一条自动生成的密钥，
    // 不再存在「已启动但无鉴权」的状态，所以这里只做提示、不再拦。
    await startGateway();
    if (activeKeys.length === 0) {
      showToast("info", "已自动生成访问密钥", "网关不允许无鉴权运行，可在下方密钥列表查看并复制");
    }
  }

  async function handleStop() {
    if (status?.running && activeKeys.length > 0) {
      const proceed = confirm(
        `确认停止 MCP Gateway 吗？\n\n当前有 ${activeKeys.length} 条可用密钥，所有正在使用网关的客户端会立即断开。`,
      );
      if (!proceed) return;
    }
    await stopGateway();
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold flex items-center gap-2 text-gray-900">
          <Server size={18} /> MCP Gateway
        </h3>
        <p className="text-xs text-gray-500 mt-1">
          内置在 CodeShelf 面板里的 MCP Gateway，当前传输模式为流式 HTTP。端口和访问密钥都在这里配置。
          密钥格式为 <code className="font-mono px-1 rounded bg-gray-100">cs_mcp_v1_&lt;random&gt;_&lt;checksum&gt;</code>，
          复制粘贴时若校验码不匹配，列表里会标红提醒。
        </p>
      </div>

      <GatewayStatusCard
        status={status}
        fallbackUrl={httpUrl}
        busy={busy}
        onRefresh={() => refresh(true)}
        onCopy={(url) => copy(url, "网关地址")}
      />

      <InternalUsageCard running={!!status?.running} />

      <SecurityNotice status={status} host={host} keys={keys} />

      <GatewayListenerForm
        host={host}
        port={port}
        running={!!status?.running}
        busy={busy}
        onHostChange={setHost}
        onPortChange={setPort}
        onStart={handleStart}
        onStop={handleStop}
      />

      <KeyManagerSection
        keys={keys}
        httpUrl={httpUrl}
        onSaveKeys={saveKeys}
        onCopy={copy}
      />

      <ClientAuthGuide />

      <KeyUsageExamples httpUrl={httpUrl} activeKey={firstActiveKey} onCopy={copy} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ConfigBlock
          title="Claude Code / Cline / Cursor / IDE（标头鉴权 ✅ 推荐）"
          value={headerJson}
          onCopy={() => copy(headerJson, "JSON 配置")}
        />
        <ConfigBlock
          title="Codex TOML（标头鉴权 ✅ 推荐）"
          value={headerToml}
          onCopy={() => copy(headerToml, "Codex TOML 配置")}
        />
        <ConfigBlock
          title="JSON（查询参数鉴权 — 仅兼容用）"
          value={queryJson}
          onCopy={() => copy(queryJson, "JSON 配置")}
        />
        <ConfigBlock
          title="Codex TOML（查询参数鉴权 — 仅兼容用）"
          value={queryToml}
          onCopy={() => copy(queryToml, "Codex TOML 配置")}
        />
      </div>

      {status?.running && (
        <a
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
          href={status.url || httpUrl}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={13} /> 打开 MCP 网关信息
        </a>
      )}
    </div>
  );
}