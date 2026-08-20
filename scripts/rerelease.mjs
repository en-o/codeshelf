#!/usr/bin/env node
/**
 * 重发一个失败的版本 —— 把上一次的残留清干净，再照常跑发版脚本。
 *
 * 用法：
 *   node scripts/rerelease.mjs 0.1.46          # 清理 + 重新发 0.1.46
 *   node scripts/rerelease.mjs 0.1.46 --dry-run # 只打印会做什么，不动手
 *
 * 为什么要有它：0.1.46 打包失败后，手工把版本号「全文替换」回 0.1.45 ——
 * 连 Cargo.lock 里 num-integer 的 0.1.46 也被一起按成 0.1.45，
 * 再发版时 cargo 重新解析依赖就报 `failed to select a version for num-integer`。
 * 退版本这件事根本不该手工做：这里用 git reset 撤掉那个发版提交，
 * 版本文件（含 lock）原样回到发版前，不会误伤任何依赖。
 *
 * 跨平台只留一份实现（node），末尾按平台调 release.sh / release.bat ——
 * 清理逻辑要是 sh 和 bat 各写一遍，迟早漂移，这个坑项目里已经踩过。
 */

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { baseBranchFor } from "./release-precheck.mjs";

const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const BLUE = "\x1b[0;34m";
const NC = "\x1b[0m";

const info = (m) => console.log(`${BLUE}[INFO]${NC} ${m}`);
const success = (m) => console.log(`${GREEN}[SUCCESS]${NC} ${m}`);
const warn = (m) => console.log(`${YELLOW}[WARN]${NC} ${m}`);
const skip = (m) => console.log(`${BLUE}[SKIP]${NC} ${m}`);
function fail(m) {
  console.error(`${RED}[ERROR]${NC} ${m}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const version = args.find((a) => !a.startsWith("-"));

if (!version) {
  console.log(`
${YELLOW}CodeShelf 重新发版脚本${NC}

用法: node scripts/rerelease.mjs <版本号> [--dry-run]

示例:
  node scripts/rerelease.mjs 0.1.46      # 清掉上次失败的残留，重新发 0.1.46
  node scripts/rerelease.mjs 0.2.0-1     # 预览版同理（基线 main-v）

会做的事（每步都幂等，没有残留就跳过）：
  1. 删除 GitHub 上 v<版本> 的 draft release（已 Publish 的会拒绝，不误删线上版本）
  2. 删除 tag v<版本>（本地 + 远端）
  3. 删除分支 release/<版本>（本地 + 远端）
  4. 撤掉基线分支上未推送的 "chore: release v<版本>" 提交（git reset，不手工改版本号）
  5. 调 scripts/release.sh / release.bat 重新发一次
`);
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(-\d+)?$/.test(version)) {
  fail(`版本号格式无效: ${version}（正式版 x.y.z，预览版 x.y.z-N）`);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDir);
process.chdir(projectRoot);

const tag = `v${version}`;
const branch = `release/${version}`;
const baseBranch = baseBranchFor(version);

/** 跑命令，返回 stdout；失败返回 null。`check` 类调用一律用它，不让异常冒泡。 */
function run(cmd, cmdArgs, { allowFail = true } = {}) {
  try {
    return execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    if (allowFail) return null;
    fail(`${cmd} ${cmdArgs.join(" ")} 失败：${e.stderr?.toString().trim() || e.message}`);
  }
}

/** 会改状态的操作统一走这里，--dry-run 时只打印。 */
function act(desc, cmd, cmdArgs) {
  if (dryRun) {
    console.log(`${YELLOW}[DRY-RUN]${NC} ${desc}: ${cmd} ${cmdArgs.join(" ")}`);
    return true;
  }
  const out = run(cmd, cmdArgs);
  if (out === null) {
    warn(`${desc} 失败（可能已经不存在），继续`);
    return false;
  }
  success(desc);
  return true;
}

info(`项目目录: ${projectRoot}`);
info(`目标版本: ${version}（基线 ${baseBranch}）`);
if (dryRun) warn("--dry-run：只打印，不实际执行");

// 0. 前置：必须在基线分支、工作树干净 —— 下面有 git reset --hard，脏工作树会被抹掉
const current = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (current !== baseBranch) {
  fail(`当前分支是 ${current}，${version} 应从 ${baseBranch} 重发，请先 git checkout ${baseBranch}`);
}
const dirty = run("git", ["status", "--porcelain"]);
if (dirty) {
  console.error(`\n${dirty}\n`);
  fail("工作树不干净（见上）。这里会 git reset --hard，请先提交或 stash。");
}

// 1. GitHub 上的 release：draft 才删，已发布的拒绝
const ghVersion = run("gh", ["--version"]);
if (!ghVersion) {
  warn(`没装 gh CLI，跳过删除 GitHub Release。若 ${tag} 有残留的 draft，请手工删除：`);
  warn(`  https://github.com/en-o/codeshelf/releases`);
} else {
  const state = run("gh", ["release", "view", tag, "--json", "isDraft,isPrerelease,url"]);
  if (!state) {
    skip(`GitHub 上没有 ${tag} 的 release`);
  } else {
    const { isDraft, url } = JSON.parse(state);
    if (!isDraft) {
      fail(
        `${tag} 已经 Publish（${url}），不能当作失败的发版删掉。\n` +
          `        用户可能已经装上了。请改用下一个版本号重发。`,
      );
    }
    // --cleanup-tag：draft 上可能已经绑了 tag，一起清掉，省得下面再删一次
    act(`删除 draft release ${tag}`, "gh", ["release", "delete", tag, "--yes", "--cleanup-tag"]);
  }
}

// 2. tag（gh 没装 / --cleanup-tag 没清干净时兜底）
if (run("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`])) {
  act(`删除本地 tag ${tag}`, "git", ["tag", "-d", tag]);
} else {
  skip(`本地没有 tag ${tag}`);
}
if (run("git", ["ls-remote", "--exit-code", "--tags", "origin", tag])) {
  act(`删除远端 tag ${tag}`, "git", ["push", "origin", "--delete", `refs/tags/${tag}`]);
} else {
  skip(`远端没有 tag ${tag}`);
}

// 3. release 分支（release.sh 的前置校验会因为它已存在而直接拦下）
if (run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]) !== null) {
  act(`删除本地分支 ${branch}`, "git", ["branch", "-D", branch]);
} else {
  skip(`本地没有分支 ${branch}`);
}
if (run("git", ["ls-remote", "--exit-code", "--heads", "origin", branch])) {
  act(`删除远端分支 origin/${branch}`, "git", ["push", "origin", "--delete", branch]);
} else {
  skip(`远端没有分支 ${branch}`);
}

// 4. 撤掉基线分支上的发版提交
//    只撤**未推送**的：已经推到 origin/<base> 的提交一旦 reset 就会分叉，
//    那比留着一个多余的版本号提交麻烦得多。
const lastSubject = run("git", ["log", "-1", "--format=%s"]);
if (lastSubject === `chore: release v${version}`) {
  run("git", ["fetch", "origin", baseBranch, "--quiet"]);
  const head = run("git", ["rev-parse", "HEAD"]);
  const pushed = run("git", ["branch", "--contains", head, "-r"]) || "";
  if (pushed.includes(`origin/${baseBranch}`)) {
    warn(`发版提交已推送到 origin/${baseBranch}，不 reset（会分叉）。`);
    warn(`版本文件已经是 ${version}，release.sh 会检测到无改动 —— 如果它报错，请改用下一个版本号。`);
  } else {
    act(`撤掉发版提交 "${lastSubject}"`, "git", ["reset", "--hard", "HEAD~1"]);
  }
} else {
  skip(`${baseBranch} 最近一个提交不是 "chore: release v${version}"，无需回退`);
}

// 5. 重新发版：改写版本号 / 提交 / 建分支 / 推送全部交给原脚本，这里不重复一遍
console.log("");
info("残留已清理，开始重新发版…");
if (dryRun) {
  console.log(`${YELLOW}[DRY-RUN]${NC} 将执行: scripts/release.${process.platform === "win32" ? "bat" : "sh"} ${version}`);
  process.exit(0);
}
const isWin = process.platform === "win32";
const releaseScript = path.join(scriptDir, isWin ? "release.bat" : "release.sh");
const result = isWin
  ? spawnSync("cmd", ["/c", releaseScript, version], { stdio: "inherit" })
  : spawnSync("bash", [releaseScript, version], { stdio: "inherit" });
process.exit(result.status ?? 1);
