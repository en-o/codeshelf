import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "@/components/ui";
import type { AppSettings, McpGatewayKey, McpGatewayStatus } from "./types";

/** Tauri invoke 的后端错误是纯字符串，不是 Error 实例；两种都兜住，别把具体原因吞成泛化文案。 */
function errMsg(e: unknown, fallback: string): string {
  if (typeof e === "string" && e) return e;
  if (e instanceof Error) return e.message;
  return fallback;
}

/**
 * 封装 MCP Gateway 在前端这一侧的所有状态与命令调用。
 * - status / host / port / keys 是从后端读到的快照。
 * - busy 用来在启动/停止过程中禁用按钮，避免重复触发。
 * - 所有写操作都会再次拉取 status，保持 UI 与实际网关一致。
 */
export function useMcpGateway() {
  const [status, setStatus] = useState<McpGatewayStatus | null>(null);
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("8787");
  const [keys, setKeys] = useState<McpGatewayKey[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (loadSavedSettings = false) => {
    try {
      if (loadSavedSettings) {
        const settings = await invoke<AppSettings>("get_app_settings");
        setHost(settings.mcp_gateway_host || "127.0.0.1");
        setPort(String(settings.mcp_gateway_port || 8787));
        setKeys(settings.mcp_gateway_keys || []);
      }
      const next = await invoke<McpGatewayStatus>("mcp_gateway_status");
      setStatus(next);
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "读取 MCP 网关状态失败");
    }
  }, []);

  useEffect(() => {
    refresh(true);
  }, [refresh]);

  const persist = useCallback(
    async (patch: Partial<AppSettings>) => {
      const settings = await invoke<AppSettings>("save_app_settings", { input: patch });
      setHost(settings.mcp_gateway_host || host);
      setPort(String(settings.mcp_gateway_port || port));
      setKeys(settings.mcp_gateway_keys || []);
      const next = await invoke<McpGatewayStatus>("mcp_gateway_status");
      setStatus(next);
      return settings;
    },
    [host, port],
  );

  const startGateway = useCallback(async () => {
    const parsedPort = Number(port);
    if (!host.trim() || !Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      showToast("warning", "请填写有效的监听地址和端口");
      return;
    }
    setBusy(true);
    try {
      await persist({
        mcp_gateway_enabled: true,
        mcp_gateway_host: host.trim(),
        mcp_gateway_port: parsedPort,
        mcp_gateway_keys: keys,
      });
      showToast("success", `MCP Gateway 已在 ${host.trim()}:${parsedPort} 启动`);
    } catch (e) {
      showToast("error", errMsg(e, "启动 MCP Gateway 失败"));
      // 保存可能已落盘但网关被安全闸拦下/停掉，重新拉一次真实状态
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [host, port, keys, persist, refresh]);

  const stopGateway = useCallback(async () => {
    setBusy(true);
    try {
      await persist({
        mcp_gateway_enabled: false,
        mcp_gateway_host: host.trim() || "127.0.0.1",
        mcp_gateway_port: Number(port) || 8787,
        mcp_gateway_keys: keys,
      });
      showToast("success", "MCP Gateway 已停止");
    } catch (e) {
      showToast("error", errMsg(e, "停止 MCP Gateway 失败"));
    } finally {
      setBusy(false);
    }
  }, [host, port, keys, persist]);

  const saveKeys = useCallback(
    async (nextKeys: McpGatewayKey[]) => {
      setKeys(nextKeys);
      try {
        await persist({ mcp_gateway_keys: nextKeys });
        showToast("success", "MCP 密钥已保存");
      } catch (e) {
        showToast("error", errMsg(e, "保存 MCP 密钥失败"));
        // 删除最后一个密钥且监听非本机地址时，后端会停掉网关，拉一次真实状态
        await refresh(true);
      }
    },
    [persist, refresh],
  );

  return {
    status,
    host,
    setHost,
    port,
    setPort,
    keys,
    busy,
    refresh,
    startGateway,
    stopGateway,
    saveKeys,
  };
}
