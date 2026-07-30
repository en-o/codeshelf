import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

const repoRoot = process.cwd();
const entryFile = path.join(repoRoot, "src-node", "resume-agent", "src", "main.ts");
const sidecarRoot = path.join(repoRoot, "src-tauri", "resources", "sidecars");
const agentOutDir = path.join(sidecarRoot, "resume-agent");
const nodeOutDir = path.join(sidecarRoot, "node");
const agentOutFile = path.join(agentOutDir, "main.cjs");
const nodeOutFile = path.join(
  nodeOutDir,
  process.platform === "win32" ? "node.exe" : "node",
);

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * 目标架构由 **Tauri target** 决定，不能用 runner 的架构去猜。
 *
 * macOS 的 aarch64 和 x86_64 两个产物是在同一台 runner 上交叉编译的，
 * 直接拷 `process.execPath` 至少有一个会内置错误架构的 Node，
 * 装到真机上 sidecar 起不来。
 *
 * 传 `--target <tauri-target>`（如 `aarch64-apple-darwin`）即可；
 * 不传则退回当前进程架构（本地开发的常见情况）。
 */
function resolveTargetArch() {
  const idx = process.argv.indexOf("--target");
  // 优先级：显式 --target > 环境变量覆盖 > Tauri 注入的 target triple/arch > 当前进程。
  //
  // `TAURI_ENV_TARGET_TRIPLE` / `TAURI_ENV_ARCH` 是 Tauri v2 传给 beforeBuildCommand 的，
  // 所以 `tauri build --target x86_64-apple-darwin` 时这里自动就是对的，
  // CI 不需要额外传参（本地交叉构建同理）。
  const target =
    (idx >= 0 ? process.argv[idx + 1] : null) ||
    process.env.CODESHELF_SIDECAR_TARGET ||
    process.env.TAURI_ENV_TARGET_TRIPLE ||
    process.env.TAURI_ENV_ARCH;
  if (!target) return { arch: process.arch, source: "当前进程" };

  const arch = target.startsWith("aarch64") || target.startsWith("arm64")
    ? "arm64"
    : target.startsWith("x86_64") || target.startsWith("x64")
      ? "x64"
      : null;
  if (!arch) throw new Error(`无法从 target 推断架构: ${target}`);
  return { arch, source: `target ${target}` };
}

/**
 * 读可执行文件头，返回架构标识。用于**无条件校验**产物 —— 不管 Node 是拷来的
 * 还是下载来的，架构不对就让构建失败，而不是等用户装上才发现起不来。
 */
async function detectArch(file) {
  const fd = await fs.open(file, "r");
  try {
    const buf = Buffer.alloc(64);
    await fd.read(buf, 0, 64, 0);

    // macOS universal (fat) binary：magic cafebabe（大端），后面是若干个 arch 切片。
    // 本机的 /bin/ls、以及某些渠道装的 node 都是这种；不处理会误判成 unknown。
    // 只要**包含**目标架构的切片就算匹配 —— fat 包在目标机器上能正常跑。
    if (buf.readUInt32BE(0) === 0xcafebabe) {
      const count = buf.readUInt32BE(4);
      const slices = [];
      for (let i = 0; i < Math.min(count, 16); i++) {
        const hdr = Buffer.alloc(8);
        await fd.read(hdr, 0, 8, 8 + i * 20); // fat_arch: cputype, cpusubtype, ...
        const cputype = hdr.readUInt32BE(0);
        if (cputype === 0x0100000c) slices.push("arm64");
        else if (cputype === 0x01000007) slices.push("x64");
      }
      return slices.length ? `fat:${slices.join("+")}` : "fat:unknown";
    }

    // Mach-O（macOS）：小端 magic feedfacf(64位)，cputype 在 offset 4
    if (buf.readUInt32LE(0) === 0xfeedfacf) {
      const cputype = buf.readUInt32LE(4);
      if (cputype === 0x0100000c) return "arm64"; // CPU_TYPE_ARM64
      if (cputype === 0x01000007) return "x64"; // CPU_TYPE_X86_64
      return `mach-o:0x${cputype.toString(16)}`;
    }
    // ELF（Linux）：e_machine 在 offset 18
    if (buf.readUInt32BE(0) === 0x7f454c46) {
      const machine = buf.readUInt16LE(18);
      if (machine === 0xb7) return "arm64";
      if (machine === 0x3e) return "x64";
      return `elf:0x${machine.toString(16)}`;
    }
    // PE（Windows）：PE 头偏移在 0x3c，Machine 紧跟 "PE\0\0"
    if (buf.readUInt16LE(0) === 0x5a4d) {
      const peOff = buf.readUInt32LE(0x3c);
      const hdr = Buffer.alloc(6);
      await fd.read(hdr, 0, 6, peOff);
      const machine = hdr.readUInt16LE(4);
      if (machine === 0xaa64) return "arm64";
      if (machine === 0x8664) return "x64";
      return `pe:0x${machine.toString(16)}`;
    }
    return "unknown";
  } finally {
    await fd.close();
  }
}

/** 从 nodejs.org 取指定架构的官方运行时（仅在与当前进程架构不一致时才需要）。 */
async function downloadNodeRuntime(arch) {
  const version = process.version; // 与本地一致，避免行为差异
  const platform = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win" : "linux";
  const ext = platform === "win" ? "zip" : "tar.gz";
  const name = `node-${version}-${platform}-${arch}`;
  const url = `https://nodejs.org/dist/${version}/${name}.${ext}`;

  process.stdout.write(`Downloading Node runtime for ${arch}: ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载 Node 运行时失败 (${res.status}): ${url}`);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codeshelf-node-"));
  const archive = path.join(tmp, `node.${ext}`);
  await fs.writeFile(archive, Buffer.from(await res.arrayBuffer()));

  if (ext === "zip") {
    execFileSync("powershell", ["-Command", `Expand-Archive -Path '${archive}' -DestinationPath '${tmp}' -Force`], { stdio: "inherit" });
    return path.join(tmp, name, "node.exe");
  }
  execFileSync("tar", ["-xzf", archive, "-C", tmp], { stdio: "inherit" });
  return path.join(tmp, name, "bin", "node");
}

async function copyRuntime() {
  await ensureDir(nodeOutDir);
  const { arch: wantArch, source } = resolveTargetArch();

  let src = process.execPath;
  if (wantArch !== process.arch) {
    // 交叉打包：runner 是 x64 而目标是 arm64（或反之），必须换一份运行时
    src = await downloadNodeRuntime(wantArch);
  }
  await fs.copyFile(src, nodeOutFile);
  if (process.platform !== "win32") {
    await fs.chmod(nodeOutFile, 0o755);
  }

  // 无条件校验：产物架构必须**是**或**包含**目标架构，不对就让构建当场失败
  const actual = await detectArch(nodeOutFile);
  const ok = actual === wantArch || (actual.startsWith("fat:") && actual.includes(wantArch));
  if (!ok) {
    throw new Error(
      `内置 Node 架构不匹配：期望 ${wantArch}（来自${source}），实际 ${actual}。\n` +
        `继续打包会得到一个在目标机器上无法启动 sidecar 的安装包。`,
    );
  }

  const { size } = await fs.stat(nodeOutFile);
  process.stdout.write(
    `Node runtime: ${src} -> ${nodeOutFile} ` +
      `[${process.version} ${process.platform}/${actual}, ${(size / 1024 / 1024).toFixed(1)} MiB, 目标来自${source}]\n`,
  );
}

async function bundleAgent() {
  await ensureDir(agentOutDir);
  await build({
    entryPoints: [entryFile],
    outfile: agentOutFile,
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    sourcemap: false,
    legalComments: "none",
    packages: "bundle",
    external: ["node:*"],
  });
}

async function main() {
  await bundleAgent();
  await copyRuntime();
  process.stdout.write(`Prepared resume-agent sidecar at ${sidecarRoot}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack || err.message : String(err)}\n`);
  process.exitCode = 1;
});
