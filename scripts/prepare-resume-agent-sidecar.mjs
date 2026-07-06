import fs from "node:fs/promises";
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

async function copyRuntime() {
  await ensureDir(nodeOutDir);
  await fs.copyFile(process.execPath, nodeOutFile);
  if (process.platform !== "win32") {
    await fs.chmod(nodeOutFile, 0o755);
  }
  // 打印被拷贝的 node 运行时信息，便于确认架构与目标平台一致（CI 打包排错关键）。
  const { size } = await fs.stat(nodeOutFile);
  const mib = (size / 1024 / 1024).toFixed(1);
  process.stdout.write(
    `Copied Node runtime: ${process.execPath} (${process.version} ${process.platform}/${process.arch}) -> ${nodeOutFile} [${mib} MiB]\n`,
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
