import path from "node:path";

export function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * 把外部标识（artifactId 等）当文件名用之前必须过这里。
 *
 * sanitizeId 只做替换，`..` 会原样留下（`.` 不在被替换的字符里）——
 * `path.join(dir, "..")` 照样跳出目录。这里显式拒绝而不是替换：
 * 非法 id 一定是调用方或数据出了问题，不该被悄悄改名成另一个文件。
 */
export function assertSafeId(id: string, what = "id"): string {
  if (!id || id.length > 128 || id === "." || id === ".." || id.startsWith(".")) {
    throw new Error(`非法${what}: ${JSON.stringify(id)}`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error(`非法${what}（只允许字母、数字、. - _）: ${JSON.stringify(id)}`);
  }
  return id;
}

/** 在 dir 下用外部标识拼路径，并校验结果确实落在 dir 内。 */
export function safeJoin(dir: string, id: string, what = "id"): string {
  const full = path.join(dir, assertSafeId(id, what));
  const resolvedDir = path.resolve(dir);
  if (path.resolve(full) !== path.join(resolvedDir, id)) {
    throw new Error(`路径越界: ${JSON.stringify(id)}`);
  }
  return full;
}

export function resumeAgentRoot(dataDir: string): string {
  return path.join(dataDir, "resume_agent");
}

export function promptsFile(dataDir: string): string {
  return path.join(resumeAgentRoot(dataDir), "prompts.json");
}

export function projectDir(dataDir: string, projectId: string): string {
  return path.join(resumeAgentRoot(dataDir), "projects", sanitizeId(projectId));
}

export function backgroundFile(dataDir: string, projectId: string): string {
  return path.join(projectDir(dataDir, projectId), "background.md");
}

export function runsDir(dataDir: string, projectId: string): string {
  return path.join(projectDir(dataDir, projectId), "runs");
}

export function runDir(dataDir: string, projectId: string): string {
  return path.join(runsDir(dataDir, projectId), "current");
}

export function runFile(dataDir: string, projectId: string): string {
  return path.join(runDir(dataDir, projectId), "run.json");
}

export function artifactsDir(dataDir: string, projectId: string): string {
  return path.join(runDir(dataDir, projectId), "artifacts");
}
