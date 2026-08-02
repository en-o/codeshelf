#!/usr/bin/env node
/**
 * 发版前置校验 —— `release.sh` 与 `release.bat` **共用同一份实现**。
 *
 * 为什么不在两个脚本里各写一遍：判定逻辑一旦有两份就一定会漂移。
 * 实际已经发生过 —— sh 改成「只允许发版 commit 领先」之后，bat 还停在
 * 「一律拦」；sh 改成「只 add 存在的文件」之后，bat 还在无条件 add 五个。
 * 用户在 Windows 上撞到的报错和 macOS 上的行为对不上，正是这么来的。
 *
 * batch 的 `for /f ... in ('git ...')` 做这类多分支判断也很脆（引号、特殊字符、
 * 延迟展开都能踩），而两个脚本本来就都依赖 node 改 JSON。所以判定统一放这里，
 * shell/batch 只负责各自的文件改写和 git 操作。
 *
 * 用法：
 *   node scripts/release-precheck.mjs baseline <version>   # 版本格式 + 分支 + 工作树 + 基线 + 分支占用
 *   node scripts/release-precheck.mjs verify-staged        # 暂存区只含版本文件
 *
 * 退出码：0 通过，1 不通过（原因打到 stderr）。
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";

/** 发版提交只应包含这五个文件。 */
export const VERSION_FILES = [
  "package.json",
  "package-lock.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];

const RED = "\x1b[0;31m";
const YELLOW = "\x1b[1;33m";
const NC = "\x1b[0m";

function fail(msg) {
  process.stderr.write(`${RED}[ERROR]${NC} ${msg}\n`);
  process.exit(1);
}
function warn(msg) {
  process.stdout.write(`${YELLOW}[WARN]${NC} ${msg}\n`);
}

/** 跑 git 并返回 stdout；失败时返回 null（由调用方决定是否致命）。 */
function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch (e) {
    if (allowFail) return null;
    fail(`git ${args.join(" ")} 失败：${e.stderr?.toString().trim() || e.message}`);
  }
}

function baseline(version) {
  // 1) 版本号格式。两个平台必须用**同一条**正则 ——
  //    bat 早先用 `for /f delims=.` 只看有没有第三段，`1.2.foo` 也能过。
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    fail(`版本号格式无效: ${version} (应为 x.y.z 格式，如 0.2.0)`);
  }

  // 2) 必须在 git 仓库里
  if (!fs.existsSync(".git")) fail("当前目录不是 git 仓库");

  // 3) 必须在 main 分支
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") {
    fail(`当前分支是 ${branch}，请在 main 分支上运行此脚本`);
  }

  // 4) 工作树与暂存区必须干净。
  //    脚本只 add 五个版本文件，但 commit 会把**所有** staged 内容一并提交；
  //    未暂存的改动则参与了本地验证却进不了 release，两边代码对不上。
  const dirty = git(["status", "--porcelain"]);
  if (dirty) {
    process.stderr.write(`\n${dirty}\n\n`);
    fail("工作树/暂存区不干净（见上）。发版必须从确定的源码开始：请先提交或 stash。");
  }

  // 5) 基线：**只允许**领先在发版提交上。
  //
  //    不要求与 origin/main 完全一致：本脚本自己就会在 main 上留下一个
  //    `chore: release vX`（提交后才切分支），下次发版时 main 天然领先一个。
  //    强制一致会逼着先 `git push origin main`，而那会让 CI 在 main 上再跑一遍 ——
  //    同一个 commit 触发两个 workflow。
  //    但**落后**必须拦：那意味着拿旧代码打包。分叉同理。
  if (git(["fetch", "origin", "main", "--quiet"], { allowFail: true }) === null) {
    fail("无法 fetch origin/main，请检查网络或远程配置");
  }
  const local = git(["rev-parse", "HEAD"]);
  const remote = git(["rev-parse", "origin/main"]);
  const base = git(["merge-base", "HEAD", "origin/main"]);

  if (local !== remote) {
    if (local === base) {
      fail("本地 main 落后于 origin/main，会用旧代码打包。请先 git pull");
    } else if (remote === base) {
      const subjects = (git(["log", "--format=%s", "origin/main..HEAD"]) || "")
        .split("\n")
        .filter(Boolean);
      const nonRelease = subjects.filter((s) => !/^chore: release v/.test(s));
      if (nonRelease.length > 0) {
        process.stderr.write(`\n${nonRelease.join("\n")}\n\n`);
        fail(
          "main 上有未推送的非发版提交（见上）。它们不会进入本次 release 分支，请先推送或整理。",
        );
      }
      warn(`main 领先 origin/main ${subjects.length} 个提交，均为历史发版提交，继续。`);
    } else {
      fail("本地 main 与 origin/main 已分叉，请先处理后再发版");
    }
  }

  // 6) release 分支不能已存在
  const branchName = `release/${version}`;
  if (git(["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], { allowFail: true }) !== null) {
    fail(`本地分支 ${branchName} 已存在，请先删除: git branch -D ${branchName}`);
  }
  if (git(["ls-remote", "--exit-code", "--heads", "origin", branchName], { allowFail: true }) !== null) {
    fail(`远程分支 origin/${branchName} 已存在，请先删除或使用其他版本号`);
  }
}

function verifyStaged() {
  // 开工前已确认工作树干净，此刻 staged 的应当恰好是这五个文件的子集
  //（缺失的 lock 文件会被跳过，所以是子集而非全等）。
  const staged = (git(["diff", "--cached", "--name-only"]) || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const extra = staged.filter((f) => !VERSION_FILES.includes(f));
  if (extra.length > 0) {
    process.stderr.write(`\n${extra.join("\n")}\n\n`);
    fail("暂存区出现了非版本文件（见上），已中止。发版提交只应包含版本号改动。");
  }
  process.stdout.write("本次发版提交将包含：\n");
  staged.forEach((f) => process.stdout.write(`    ${f}\n`));
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "baseline") baseline(arg);
else if (cmd === "verify-staged") verifyStaged();
else {
  process.stderr.write("用法: release-precheck.mjs baseline <version> | verify-staged\n");
  process.exit(2);
}
