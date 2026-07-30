import fs from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { TextDecoder } from "node:util";
import ignore from "ignore";
import type {
  BackendProtocolV2,
  EditResult,
  ExecuteResponse,
  FileInfo,
  GlobResult,
  GrepMatch,
  GrepResult,
  LsResult,
  ReadRawResult,
  ReadResult,
  SandboxBackendProtocolV2,
  WriteResult,
} from "deepagents";

import type { RunContext } from "../agent/runContext.js";
import type { SensitiveRule, ToolPermissionMode } from "../types.js";
import { limitText, normalizeVirtualPath } from "../util.js";

const DEFAULT_IGNORE = [
  ".git/",
  "node_modules/",
  "target/",
  "dist/",
  "build/",
  ".next/",
  ".cache/",
  "coverage/",
];

const MAX_READ_CHARS = 80_000;
const MAX_GREP_MATCHES = 300;
const MAX_EXECUTE_OUTPUT = 120_000;

export class ResumeProjectBackend implements SandboxBackendProtocolV2 {
  readonly id = "codeshelf-resume-project";
  private readonly ig = ignore();
  private totalReadChars = 0;

  constructor(
    private readonly ctx: RunContext,
    private readonly projectRoot: string,
    private readonly sensitiveRules: SensitiveRule[],
    private readonly mode: ToolPermissionMode,
  ) {
    this.ig.add(DEFAULT_IGNORE);
  }

  async initialize(): Promise<void> {
    await this.loadGitignore();
    const enabledSensitive = this.sensitiveRules
      .filter((rule) => rule.enabled !== false && rule.pattern.trim())
      .map((rule) => rule.pattern);
    if (enabledSensitive.length) this.ig.add(enabledSensitive);
  }

  async ls(dirPath: string): Promise<LsResult> {
    return this.ctx.timedToolEvent({
      toolName: "ls",
      args: { path: dirPath },
      run: async () => {
        const checked = await this.resolveReadable(dirPath);
        if (!checked.ok) return { error: checked.error };
        const entries = await fs.readdir(checked.fullPath, { withFileTypes: true }).catch((err) => {
          if (isNotFound(err)) return null;
          throw err;
        });
        if (!entries) return { error: "file_not_found" };
        const files: FileInfo[] = [];
        for (const entry of entries) {
          const rel = this.toRel(path.join(checked.fullPath, entry.name));
          if (this.isIgnored(rel, entry.isDirectory())) continue;
          const stat = await fs.stat(path.join(checked.fullPath, entry.name)).catch((err) => {
            if (isNotFound(err)) return null;
            throw err;
          });
          if (!stat) continue;
          files.push({
            path: `/${rel}${entry.isDirectory() ? "/" : ""}`,
            is_dir: entry.isDirectory(),
            size: Number(stat.size),
            modified_at: stat.mtime.toISOString(),
          });
        }
        return { files };
      },
    });
  }

  async glob(pattern: string, searchPath = "/"): Promise<GlobResult> {
    return this.ctx.timedToolEvent({
      toolName: "glob",
      args: { pattern, path: searchPath },
      run: async () => {
        const base = await this.resolveReadable(searchPath);
        if (!base.ok) return { error: base.error };
        const regex = globToRegex(pattern);
        const files: FileInfo[] = [];
        await this.walk(base.fullPath, async (full, stat) => {
          const rel = this.toRel(full);
          if (!regex.test(rel) && !regex.test(`/${rel}`)) return;
          files.push({
            path: `/${rel}${stat.isDirectory() ? "/" : ""}`,
            is_dir: stat.isDirectory(),
            size: Number(stat.size),
            modified_at: stat.mtime.toISOString(),
          });
        });
        return { files: files.slice(0, 1000) };
      },
    });
  }

  async read(filePath: string, offset = 0, limit = 500): Promise<ReadResult> {
    return this.ctx.timedToolEvent({
      toolName: "read_file",
      args: { file_path: filePath, offset, limit },
      run: async () => this.readForModel(filePath, offset, limit),
      resultToArtifact: (result) => JSON.stringify(summarizeReadResult(filePath, result), null, 2),
    });
  }

  async readMany(paths: string[], offset = 0, limit = 500): Promise<string> {
    return this.ctx.timedToolEvent({
      toolName: "batch_read_files",
      args: { paths, offset, limit },
      run: async () => {
        const sections: string[] = [];
        const summaries: Array<Record<string, unknown>> = [];
        for (const filePath of paths.slice(0, 20)) {
          const result = await this.readForModel(filePath, offset, limit);
          summaries.push(summarizeReadResult(filePath, result));
          if (result.error) {
            sections.push(`## ${filePath}\n[error] ${result.error}`);
          } else {
            sections.push(`## ${filePath}\n${String(result.content ?? "")}`);
          }
        }
        return { content: sections.join("\n\n"), summaries };
      },
      resultToArtifact: (result) => JSON.stringify(result.summaries, null, 2),
    }).then((result) => result.content);
  }

  async readRaw(filePath: string): Promise<ReadRawResult> {
    const result = await this.read(filePath, 0, 20_000);
    if (result.error) return { error: result.error };
    return {
      data: {
        content: String(result.content ?? ""),
        mimeType: result.mimeType ?? "text/plain",
        created_at: new Date().toISOString(),
        modified_at: new Date().toISOString(),
      },
    };
  }

  async grep(pattern: string, searchPath: string | null = "/", includeGlob: string | null = null): Promise<GrepResult> {
    return this.ctx.timedToolEvent({
      toolName: "grep",
      args: { pattern, path: searchPath, glob: includeGlob },
      run: async () => {
        const base = await this.resolveReadable(searchPath || "/");
        if (!base.ok) return { error: base.error };
        const include = includeGlob ? globToRegex(includeGlob) : null;
        const matches: GrepMatch[] = [];
        await this.walk(base.fullPath, async (full, stat) => {
          if (matches.length >= MAX_GREP_MATCHES || stat.isDirectory()) return;
          const rel = this.toRel(full);
          if (include && !include.test(rel) && !include.test(`/${rel}`)) return;
          if (await looksBinary(full)) return;
          const content = await fs.readFile(full, "utf8").catch(() => "");
          const lines = content.split(/\r?\n/);
          lines.forEach((line, index) => {
            if (matches.length < MAX_GREP_MATCHES && line.includes(pattern)) {
              matches.push({ path: `/${rel}`, line: index + 1, text: line });
            }
          });
        });
        return { matches };
      },
    });
  }

  async write(filePath: string, content: string): Promise<WriteResult> {
    return this.ctx.timedToolEvent({
      toolName: "write_file",
      args: { file_path: filePath, chars: [...content].length },
      run: async () => {
        const checked = await this.resolveWritable(filePath);
        if (!checked.ok) return { error: checked.error, filesUpdate: null };
        await fs.mkdir(path.dirname(checked.fullPath), { recursive: true });
        await fs.writeFile(checked.fullPath, content, "utf8");
        return { path: `/${this.toRel(checked.fullPath)}`, filesUpdate: null };
      },
    });
  }

  async edit(filePath: string, oldString: string, newString: string, replaceAll = false): Promise<EditResult> {
    return this.ctx.timedToolEvent({
      toolName: "edit_file",
      args: { file_path: filePath, oldChars: [...oldString].length, newChars: [...newString].length, replaceAll },
      run: async () => {
        const checked = await this.resolveWritable(filePath);
        if (!checked.ok) return { error: checked.error, filesUpdate: null };
        const before = await fs.readFile(checked.fullPath, "utf8").catch((err) => {
          if (isNotFound(err)) return null;
          throw err;
        });
        if (before === null) return { error: "file_not_found", filesUpdate: null };
        const occurrences = before.split(oldString).length - 1;
        if (occurrences <= 0) return { error: "old_string_not_found", filesUpdate: null };
        const after = replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, newString);
        await fs.writeFile(checked.fullPath, after, "utf8");
        return { path: `/${this.toRel(checked.fullPath)}`, occurrences: replaceAll ? occurrences : 1, filesUpdate: null };
      },
    });
  }

  /**
   * 执行命令。**不经过 shell**：命令被切成 argv，argv[0] 必须在只读白名单里，
   * 出现任何 shell 元字符直接拒绝。
   *
   * 以前这里是「真 shell + 字符串黑名单」：仓库内容里的提示注入能用命令替换、
   * 编码、别名、解释器脚本绕开黑名单，读项目外的文件或联网外传。黑名单挡不住
   * 未知写法，白名单能。
   */
  async execute(command: string): Promise<ExecuteResponse> {
    return this.ctx.timedToolEvent({
      toolName: "execute",
      args: { command, cwd: this.projectRoot, mode: this.mode },
      run: async () => {
        if (this.mode !== "full_agent") {
          return blocked("execute blocked: 未获得命令执行授权（toolPermissionMode != full_agent）");
        }
        const parsed = parseCommand(command);
        if (!parsed.ok) return blocked(`execute blocked: ${parsed.error}`);

        // 敏感文件规则必须同时约束命令执行，不能只管文件工具：
        // 任何指向被忽略/敏感路径的参数都拒绝。
        for (const arg of parsed.argv.slice(1)) {
          if (arg.startsWith("-")) continue;
          const checked = await this.resolveReadable(arg);
          // 解析不出来的（子命令、ref 名、格式串）不当路径处理；解析得出来但被规则挡住的拒绝
          if (!checked.ok && checked.error === "blocked_by_ignore_or_sensitive_rules") {
            return blocked(`execute blocked: 参数命中敏感/忽略规则 (${arg})`);
          }
        }

        return runArgv(parsed.argv, this.projectRoot);
      },
    });
  }

  private async loadGitignore(): Promise<void> {
    try {
      const content = await fs.readFile(path.join(this.projectRoot, ".gitignore"), "utf8");
      this.ig.add(content);
    } catch {
      // Project may not have .gitignore.
    }
  }

  private async resolveReadable(input: string): Promise<{ ok: true; fullPath: string } | { ok: false; error: string }> {
    const resolved = this.resolve(input);
    if (!resolved.ok) return resolved;
    const rel = this.toRel(resolved.fullPath);
    if (this.isIgnored(rel, false)) return { ok: false, error: "blocked_by_ignore_or_sensitive_rules" };
    return resolved;
  }

  private async readForModel(filePath: string, offset = 0, limit = 500): Promise<ReadResult> {
    const checked = await this.resolveReadable(filePath);
    if (!checked.ok) return { error: checked.error };
    const stat = await fs.stat(checked.fullPath).catch((err) => {
      if (isNotFound(err)) return null;
      throw err;
    });
    if (!stat) return { error: "file_not_found" };
    if (stat.isDirectory()) return { error: "is_directory" };
    if (await looksBinary(checked.fullPath)) return { error: "binary_file" };
    const raw = await fs.readFile(checked.fullPath, "utf8").catch((err) => {
      if (isNotFound(err)) return null;
      throw err;
    });
    if (raw === null) return { error: "file_not_found" };
    const lines = raw.split(/\r?\n/);
    const selected = lines.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit));
    const withLineNumbers = selected
      .map((line, index) => `${offset + index + 1}: ${line}`)
      .join("\n");
    const limited = limitText(withLineNumbers, MAX_READ_CHARS);
    this.totalReadChars += [...limited.text].length;
    return { content: limited.text, mimeType: "text/plain" };
  }

  private async resolveWritable(input: string): Promise<{ ok: true; fullPath: string } | { ok: false; error: string }> {
    if (this.mode === "read_only") return { ok: false, error: "write_blocked_by_read_only_mode" };
    const resolved = this.resolve(input);
    if (!resolved.ok) return resolved;
    if (this.mode === "workspace_write") {
      const virtual = `/${this.toRel(resolved.fullPath)}`;
      if (!virtual.startsWith("/.codeshelf-resume-agent/")) {
        return { ok: false, error: "write_blocked_outside_agent_workspace" };
      }
    }
    const rel = this.toRel(resolved.fullPath);
    if (this.isIgnored(rel, false)) return { ok: false, error: "blocked_by_ignore_or_sensitive_rules" };
    return resolved;
  }

  private resolve(input: string): { ok: true; fullPath: string } | { ok: false; error: string } {
    const root = path.resolve(this.projectRoot);
    const normalizedInput = input.replaceAll("\\", "/").trim();

    // 模型在以项目根为 "/" 的虚拟文件系统里工作：ls/glob/grep/read 返回的都是 "/rel" 形式。
    // 因此 "/"、"/main.py" 这类前导斜杠路径是“虚拟根”路径，绝不能当成操作系统根目录解析，
    // 否则会一律落到项目外、报 path_outside_project（正是工具全部失败的根因）。
    // 只有 Windows 盘符路径（C:/...）或确实落在项目根内部的真实绝对路径，才按真实绝对路径处理；
    // 其余一切（含项目外的真实绝对路径）都交给下面的虚拟路径分支，安全地映射回项目根内。
    const isWindowsAbsolute = /^[a-zA-Z]:\//.test(normalizedInput);
    const realAbsolute = path.isAbsolute(input) ? path.resolve(input) : null;
    const isRealInsideRoot =
      realAbsolute !== null && (realAbsolute === root || realAbsolute.startsWith(root + path.sep));

    if (isWindowsAbsolute || isRealInsideRoot) {
      const absoluteCandidate = isWindowsAbsolute ? path.resolve(normalizedInput) : (realAbsolute as string);
      if (absoluteCandidate !== root && !absoluteCandidate.startsWith(root + path.sep)) {
        return { ok: false, error: "path_outside_project" };
      }
      return { ok: true, fullPath: absoluteCandidate };
    }

    const virtual = normalizeVirtualPath(input);
    if (virtual.includes("..")) return { ok: false, error: "invalid_path" };
    const fullPath = path.resolve(this.projectRoot, `.${virtual}`);
    if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
      return { ok: false, error: "path_outside_project" };
    }
    return { ok: true, fullPath };
  }

  private toRel(fullPath: string): string {
    return path.relative(this.projectRoot, fullPath).replaceAll("\\", "/") || "";
  }

  private isIgnored(rel: string, isDir: boolean): boolean {
    if (!rel) return false;
    const normalized = rel.replaceAll("\\", "/");
    const safeRel = /^[a-zA-Z]:\//.test(normalized) || path.isAbsolute(normalized)
      ? this.toRel(path.resolve(normalized))
      : normalized;
    if (!safeRel || safeRel.startsWith("..")) return false;
    return this.ig.ignores(isDir && !safeRel.endsWith("/") ? `${safeRel}/` : safeRel);
  }

  private async walk(root: string, visit: (fullPath: string, stat: Stats) => Promise<void>): Promise<void> {
    const stat = await fs.stat(root).catch((err) => {
      if (isNotFound(err)) return null;
      throw err;
    });
    if (!stat) return;
    const rel = this.toRel(root);
    if (rel && this.isIgnored(rel, stat.isDirectory())) return;
    await visit(root, stat);
    if (!stat.isDirectory()) return;
    const entries = await fs.readdir(root).catch((err) => {
      if (isNotFound(err)) return [];
      throw err;
    });
    for (const entry of entries) {
      await this.walk(path.join(root, entry), visit);
    }
  }
}

function summarizeReadResult(filePath: string, result: ReadResult): Record<string, unknown> {
  const content = typeof result.content === "string" ? result.content : "";
  return {
    path: filePath,
    status: result.error ? "error" : "success",
    error: result.error,
    returnedChars: [...content].length,
    mimeType: result.mimeType,
    contentOmittedFromLog: true,
  };
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**/", "(?:.*/)?")
    .replaceAll("**", ".*")
    .replaceAll("*", "[^/]*")
    .replaceAll("?", ".");
  return new RegExp(`^${escaped}$`);
}

async function looksBinary(file: string): Promise<boolean> {
  const buf = await fs.readFile(file).catch(() => Buffer.alloc(0));
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  return sample.includes(0);
}

function isNotFound(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "ENOENT");
}

function blocked(output: string): ExecuteResponse {
  return { output, exitCode: 126, truncated: false };
}

/**
 * 允许执行的命令。只有「读取仓库元数据」这一类 —— 简历 Agent 需要的就是
 * 提交统计和文件清单，没有任何理由跑构建、包管理器或解释器。
 *
 * git 还要再限一层子命令：`git config`/`git push`/`git clean` 都不在其中。
 */
const ALLOWED_COMMANDS: Record<string, readonly string[] | null> = {
  // null = 不限子命令
  git: [
    "log",
    "shortlog",
    "status",
    "show",
    "diff",
    "ls-files",
    "rev-list",
    "rev-parse",
    "describe",
    "branch",
    "tag",
    "blame",
    "count-objects",
  ],
  wc: null,
  cloc: null,
};

/** shell 元字符：出现任何一个都直接拒绝，不试图转义。 */
const SHELL_METACHARS = /[;&|<>$`(){}\[\]!*?~\\'"\n\r\t]/;

/**
 * 把命令行切成 argv。
 *
 * ponytail: 只按空白切分，不支持引号 —— 带空格的路径参数用不了。
 * 支持引号就得写一个真解析器，而元字符全禁的前提下引号本身也没意义。
 * 如果之后真需要空格路径，改成结构化 argv 入参（工具直接收数组）而不是加解析器。
 */
export function parseCommand(command: string): { ok: true; argv: string[] } | { ok: false; error: string } {
  const trimmed = command.trim();
  if (!trimmed) return { ok: false, error: "空命令" };
  if (SHELL_METACHARS.test(trimmed)) {
    return { ok: false, error: "命令包含 shell 元字符，已拒绝（命令不经过 shell 执行）" };
  }

  const argv = trimmed.split(/\s+/);
  const bin = argv[0];
  if (!(bin in ALLOWED_COMMANDS)) {
    return {
      ok: false,
      error: `${bin} 不在只读命令白名单内（允许: ${Object.keys(ALLOWED_COMMANDS).join(", ")}）`,
    };
  }

  const subcommands = ALLOWED_COMMANDS[bin];
  if (subcommands) {
    const sub = argv.find((a, i) => i > 0 && !a.startsWith("-"));
    if (!sub || !subcommands.includes(sub)) {
      return { ok: false, error: `${bin} ${sub ?? ""} 不在允许的子命令内（允许: ${subcommands.join(", ")}）` };
    }
  }

  return { ok: true, argv };
}

function runArgv(argv: string[], cwd: string): Promise<ExecuteResponse> {
  return new Promise((resolve) => {
    // shell: false —— 引号、$()、;、&& 都不会被解释，argv 原样传给进程
    const child = spawn(argv[0], argv.slice(1), { cwd, shell: false, windowsHide: true });
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let truncated = false;
    const append = (chunk: Buffer, prefix = "") => {
      if (outputBytes >= MAX_EXECUTE_OUTPUT * 4) {
        truncated = true;
        return;
      }
      const withPrefix = prefix ? Buffer.concat([Buffer.from(prefix, "utf8"), chunk]) : chunk;
      const remaining = MAX_EXECUTE_OUTPUT * 4 - outputBytes;
      if (withPrefix.length > remaining) {
        chunks.push(withPrefix.subarray(0, remaining));
        outputBytes += remaining;
        truncated = true;
        return;
      }
      chunks.push(withPrefix);
      outputBytes += withPrefix.length;
    };
    child.stdout.on("data", (chunk) => append(chunk));
    child.stderr.on("data", (chunk) => append(chunk, "[stderr] "));
    const timer = setTimeout(() => {
      child.kill();
      truncated = true;
      append(Buffer.from("\n[process killed after timeout]", "utf8"));
    }, 120_000);
    // shell: false 时可执行文件不存在会 emit error；不接住会以未捕获异常打挂 sidecar
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(blocked(`execute failed: ${err instanceof Error ? err.message : String(err)}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let output = decodeProcessOutput(Buffer.concat(chunks));
      if ([...output].length > MAX_EXECUTE_OUTPUT) {
        output = [...output].slice(0, MAX_EXECUTE_OUTPUT).join("");
        truncated = true;
      }
      resolve({ output, exitCode: code, truncated });
    });
  });
}

function decodeProcessOutput(buffer: Buffer): string {
  if (buffer.length === 0) return "";
  const utf8 = buffer.toString("utf8");
  if (looksLikeUtf16Le(buffer)) return buffer.toString("utf16le");
  const utf8Bad = replacementCount(utf8);
  if (utf8Bad === 0) return utf8;
  try {
    const gb18030 = new TextDecoder("gb18030").decode(buffer);
    return replacementCount(gb18030) < utf8Bad ? gb18030 : utf8;
  } catch {
    return utf8;
  }
}

function replacementCount(text: string): number {
  return (text.match(/\uFFFD/g) ?? []).length;
}

function looksLikeUtf16Le(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  let zeroOdd = 0;
  const sample = Math.min(buffer.length, 200);
  for (let i = 1; i < sample; i += 2) {
    if (buffer[i] === 0) zeroOdd += 1;
  }
  return zeroOdd > sample / 4;
}

export function asBackend(value: ResumeProjectBackend): BackendProtocolV2 & SandboxBackendProtocolV2 {
  return value;
}
