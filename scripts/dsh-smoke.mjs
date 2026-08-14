#!/usr/bin/env node
// dsh 引擎协议冒烟：不花一分钱、不需要真 API key。
//
// 把 DEEPSEEK_BASE_URL 指到一个必然连不上的地址，跑一遍
// initialize → session/prompt → 事件流 → shutdown。
// 除「真的调模型」以外的全部接线（profile 组合、插件加载、权限预设、JSON-RPC 帧、
// 会话事件）都在这条路径上，模型调用失败恰好证明请求已经组装并发出去了。
//
// 用法：
//   node scripts/dsh-smoke.mjs                 # 用应用装好的 dsh（macOS 默认路径）
//   node scripts/dsh-smoke.mjs --root <目录>    # 指定 dsh 安装根（含 node_modules 与 home）
//
// 改了 src-tauri/src/commands/dsh/ 里的 profile 内容或 DSH_VERSION 之后跑一次。

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import readline from "node:readline";

const args = process.argv.slice(2);
const rootArg = args.indexOf("--root");
const root =
  rootArg >= 0
    ? path.resolve(args[rootArg + 1])
    : path.join(homedir(), "Library", "Application Support", "com.codeshelf.desktop", "dsh");

const entry = path.join(root, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const home = path.join(root, "home");

if (!existsSync(entry)) {
  console.error(`找不到 dsh 入口：${entry}`);
  console.error("先在 设置 → dsh 引擎 里安装，或用 --root 指定安装目录。");
  process.exit(2);
}

const [major] = process.versions.node.split(".").map(Number);
if (major < 22) {
  console.error(`当前 Node 是 v${process.versions.node}，dsh 需要 v22 及以上`);
  process.exit(2);
}

const child = spawn(process.execPath, [entry, "--profile", "codeshelf"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DSH_HOME: home,
    DEEPSEEK_API_KEY: "sk-smoke-not-a-real-key",
    // 保留端口 9（discard）：必然连不上，且不会真的把 key 发到任何地方
    DEEPSEEK_BASE_URL: "http://127.0.0.1:9/v1",
  },
  stdio: ["pipe", "pipe", "pipe"],
});

const seen = { initialized: false, messageId: false, turnEnded: false, idle: false, approvalNever: false };
let stderr = "";
child.stderr.on("data", (d) => (stderr += d));

readline.createInterface({ input: child.stdout }).on("line", (line) => {
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    console.error("stdout 出现非 JSON 行（有插件在往 stdout 打日志？）:", line.slice(0, 120));
    return;
  }
  if (frame.id === 1 && frame.result?.serverInfo) {
    seen.initialized = true;
    console.log("✓ initialize:", frame.result.serverInfo.name, frame.result.serverInfo.version);
    send({ jsonrpc: "2.0", id: 2, method: "session/prompt", params: { sessionId: `smoke-${Date.now()}`, contentBlocks: [{ type: "text", text: "hi" }] } });
  } else if (frame.id === 2 && frame.result?.messageId) {
    seen.messageId = true;
    console.log("✓ session/prompt 入队:", frame.result.messageId);
  } else if (frame.method === "session.event") {
    const e = frame.params.event;
    if (e.type === "approval/policy") {
      seen.approvalNever = e.data?.policy === "never";
      console.log(`${seen.approvalNever ? "✓" : "✗"} approval/policy = ${e.data?.policy}（必须是 never，否则 agent 会等一个永远来不了的审批）`);
    }
    if (e.type === "sandbox/mode") console.log("· sandbox/mode =", e.data?.mode);
    if (e.type === "turn/end") {
      seen.turnEnded = true;
      console.log("✓ turn/end:", JSON.stringify(e.data?.reason));
    }
  } else if (frame.method === "session.status" && frame.params.status === "idle") {
    seen.idle = true;
    console.log("✓ session.status = idle");
    send({ jsonrpc: "2.0", id: 3, method: "shutdown", params: {} });
  } else if (frame.id === 3) {
    console.log("✓ shutdown 已应答");
  }
});

function send(frame) {
  child.stdin.write(JSON.stringify(frame) + "\n");
}

child.on("exit", (code) => {
  const ok = seen.initialized && seen.messageId && seen.turnEnded && seen.idle && seen.approvalNever;
  if (!ok) {
    console.error("\n冒烟失败：", JSON.stringify(seen));
    if (stderr.trim()) console.error("stderr 尾部：\n" + stderr.trim().split("\n").slice(-12).join("\n"));
    process.exit(1);
  }
  console.log(`\n全部通过（dsh 退出码 ${code}）`);
  process.exit(0);
});

setTimeout(() => send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { cwd: process.cwd(), provider: "deepseek-official", model: "deepseek-v4-flash" } }), 2000);

// 兜底：卡住也要退出，别让 CI / 终端一直挂着
setTimeout(() => {
  console.error("超时 60s 未跑完");
  if (stderr.trim()) console.error(stderr.trim().split("\n").slice(-12).join("\n"));
  child.kill("SIGKILL");
  process.exit(1);
}, 60_000);
