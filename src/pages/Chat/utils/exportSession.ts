import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import type { ChatSession } from "@/types";

function sanitizeFilename(input: string): string {
  return input.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) || "chat";
}

export function sessionToMarkdown(session: ChatSession): string {
  const lines: string[] = [];
  lines.push(`# ${session.title}`);
  lines.push("");
  lines.push(`> 模型：${session.providerId} / ${session.modelId}`);
  lines.push(`> 创建：${session.createdAt}`);
  lines.push(`> 更新：${session.updatedAt}`);
  if (session.systemPrompt) {
    lines.push("");
    lines.push("## System");
    lines.push("");
    lines.push(session.systemPrompt);
  }
  for (const msg of session.messages) {
    lines.push("");
    lines.push(`## ${msg.role === "user" ? "用户" : msg.role === "assistant" ? "助手" : "系统"}`);
    lines.push("");
    if (msg.thinkingContent) {
      lines.push("<details><summary>thinking</summary>");
      lines.push("");
      lines.push(msg.thinkingContent);
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
    lines.push(msg.content);
  }
  return lines.join("\n") + "\n";
}

export async function exportSessionAsMarkdown(session: ChatSession): Promise<boolean> {
  const filename = `${sanitizeFilename(session.title)}.md`;
  const path = await save({
    title: "导出会话",
    defaultPath: filename,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!path) return false;
  await writeTextFile(path, sessionToMarkdown(session));
  return true;
}

/** 导出文件的结构版本。缺失视为 legacy（本字段引入之前导出的文件）。 */
export const EXPORT_SCHEMA_VERSION = 1;

export async function exportSessionAsJson(session: ChatSession): Promise<boolean> {
  const filename = `${sanitizeFilename(session.title)}.json`;
  const path = await save({
    title: "导出会话（JSON）",
    defaultPath: filename,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return false;
  const payload = { schemaVersion: EXPORT_SCHEMA_VERSION, ...session };
  await writeTextFile(path, JSON.stringify(payload, null, 2));
  return true;
}

const MESSAGE_ROLES = new Set(["system", "user", "assistant", "tool"]);

/**
 * 完整校验导入结构，任何一处不合法都在**落盘之前**抛错，
 * 不会产生半条会话。逐条报出下标，方便定位坏在哪一行。
 */
function validateSession(parsed: unknown): ChatSession {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON 格式不正确：顶层应为对象");
  }
  const o = parsed as Record<string, unknown>;

  // 版本：缺失 = 本字段引入之前的导出，按 legacy 放行；高于当前版本则拒绝，
  // 因为新版可能有本版本读不懂的字段语义，勉强导入等于静默丢数据。
  if (o.schemaVersion !== undefined) {
    if (typeof o.schemaVersion !== "number" || !Number.isInteger(o.schemaVersion)) {
      throw new Error("schemaVersion 字段不是整数");
    }
    if (o.schemaVersion > EXPORT_SCHEMA_VERSION) {
      throw new Error(
        `文件版本 v${o.schemaVersion} 高于当前支持的 v${EXPORT_SCHEMA_VERSION}，请升级 CodeShelf 后再导入`,
      );
    }
  }

  const str = (key: string, required: boolean): string | undefined => {
    const v = o[key];
    if (v === undefined || v === null) {
      if (required) throw new Error(`缺少 ${key} 字段`);
      return undefined;
    }
    if (typeof v !== "string") throw new Error(`${key} 字段应为字符串`);
    return v;
  };

  str("id", true);
  str("title", true);
  str("createdAt", false);
  str("updatedAt", false);

  if (!Array.isArray(o.messages)) throw new Error("缺少 messages 字段");
  o.messages.forEach((m, i) => {
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      throw new Error(`messages[${i}] 不是对象`);
    }
    const msg = m as Record<string, unknown>;
    if (typeof msg.id !== "string" || !msg.id) throw new Error(`messages[${i}].id 缺失或不是字符串`);
    if (typeof msg.role !== "string" || !MESSAGE_ROLES.has(msg.role)) {
      throw new Error(`messages[${i}].role 非法：${String(msg.role)}`);
    }
    if (typeof msg.content !== "string") throw new Error(`messages[${i}].content 不是字符串`);
    if (msg.attachments !== undefined && !Array.isArray(msg.attachments)) {
      throw new Error(`messages[${i}].attachments 不是数组`);
    }
    if (msg.toolCalls !== undefined && !Array.isArray(msg.toolCalls)) {
      throw new Error(`messages[${i}].toolCalls 不是数组`);
    }
  });

  return parsed as ChatSession;
}

export async function importSessionFromJson(): Promise<ChatSession | null> {
  const picked = await open({
    title: "导入会话",
    multiple: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!picked || Array.isArray(picked)) return null;
  const content = await readTextFile(picked as string);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("JSON 解析失败：文件不是合法的 JSON");
  }
  return validateSession(parsed);
}

/** 供单测直接调用，跳过文件对话框。 */
export const __validateSessionForTest = validateSession;
