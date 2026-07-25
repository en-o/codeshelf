# CodeShelf MCP Gateway

CodeShelf 的 MCP Gateway 是应用面板的一部分，不需要单独启动第二个服务。你在 `设置 -> MCP Gateway` 里配置监听地址、端口和访问密钥，CodeShelf 会通过流式 HTTP MCP 入口把接口库暴露为 tools。

## 能力

- 每个已保存的 API 接口会变成一个 MCP tool。
- Tool 名可读且稳定，例如 `api_get_api_assets_18a7fb87`。
- 旧的 endpoint-id 名称，例如 `ep_18a7fb8742e76640`，仍可作为兼容调用入口。
- 接口的 JSON Schema 会映射为 MCP `inputSchema`。
- 调用复用 CodeShelf 现有执行器，包括 baseUrl、path/query/body、headers、Bearer/Basic/API Key/Session 鉴权。
- 返回内容同时包含文本结果和结构化结果。
- 如果没有配置任何访问密钥，`/mcp` 不需要鉴权；只要配置了密钥，JSON-RPC 请求就必须携带未过期且启用的密钥。`/health` 和信息页可用于连通检查。
- **安全限制**：无密钥的免鉴权模式只允许监听回环地址（`127.0.0.1`）。要监听 `0.0.0.0` 等非本机地址（供局域网/其他设备访问），必须先配置至少一个访问密钥，否则网关拒绝启动。

## 启动方式

1. 打开 CodeShelf。
2. 进入 `设置 -> MCP Gateway`。
3. 设置监听地址和端口，例如 `127.0.0.1` + `8787`。
4. 按需创建访问密钥。没有密钥时不需要鉴权；添加密钥后会启用鉴权。密钥可以手动输入，也可以自动生成；可以永久有效，也可以设置过期时间；可以为不同客户端创建多个密钥。
5. 点击启动。
6. 外部 MCP 客户端连接 `http://127.0.0.1:8787/mcp`。

启用状态、host、port 和密钥列表会保存到应用设置里。下次 CodeShelf 启动时，如果 MCP Gateway 是启用状态，会自动按保存的端口恢复。

## 鉴权

`/mcp` 支持三种传递密钥的方式：

```http
Authorization: Bearer cs_mcp_xxx
```

```http
x-api-key: cs_mcp_xxx
```

```text
http://127.0.0.1:8787/mcp?key=cs_mcp_xxx
```

如果客户端支持自定义 header，可以使用 header。更通用的方式是 `?key=` 查询参数，很多自定义 MCP 表单都会稳定传递 URL。

## MCP 客户端配置

流式 HTTP 配置示例：

```json
{
  "mcpServers": {
    "codeshelf-api": {
      "url": "http://127.0.0.1:8787/mcp?key=cs_mcp_xxx"
    }
  }
}
```

Codex TOML 示例：

```toml
[mcp_servers.codeshelf-api]
url = "http://127.0.0.1:8787/mcp?key=cs_mcp_xxx"
```

Claude Code、Kimi、GitHub Copilot 和 IDE 集成如果支持流式 HTTP MCP endpoint，就填上面的 URL 和密钥。这个实现刻意不再提供独立 stdio sidecar，避免出现面板和外部进程两套网关。

## 冒烟测试

健康检查：

```bash
curl -s http://127.0.0.1:8787/health
```

列出 tools：

```bash
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer cs_mcp_xxx' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
