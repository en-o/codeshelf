import fs from "node:fs/promises";
import path from "node:path";

import {
  artifactsDir,
  backgroundFile,
  projectDir,
  runDir,
  runFile,
  runsDir,
  safeJoin,
} from "./paths.js";
import type {
  AgentEvent,
  AgentRunRecord,
  ArtifactContent,
  ArtifactRef,
  FinalizeAllInput,
  ResumeV2,
} from "../types.js";

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

export async function rotateRuns(dataDir: string, projectId: string): Promise<void> {
  await fs.rm(runsDir(dataDir, projectId), { recursive: true, force: true });
}

export async function deleteRuns(dataDir: string, projectId: string): Promise<void> {
  await fs.rm(runsDir(dataDir, projectId), { recursive: true, force: true });
}

export async function writeRun(dataDir: string, run: AgentRunRecord): Promise<void> {
  await writeJson(runFile(dataDir, run.projectId), run);
}

export async function readRuns(dataDir: string, projectId: string): Promise<{ current?: AgentRunRecord }> {
  return {
    current: await readJson<AgentRunRecord>(runFile(dataDir, projectId)),
  };
}

export async function appendEvent(
  dataDir: string,
  run: AgentRunRecord,
  event: AgentEvent,
): Promise<AgentRunRecord> {
  const next = { ...run, events: [...run.events, event] };
  await writeRun(dataDir, next);
  return next;
}

export async function writeArtifact(
  dataDir: string,
  projectId: string,
  fileName: string,
  label: string,
  kind: string,
  content: string,
): Promise<ArtifactRef> {
  const safe = fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}-${safe}`;
  const file = safeJoin(artifactsDir(dataDir, projectId), id, "artifactId");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
  return { id, label, kind, chars: [...content].length };
}

export async function readArtifact(
  dataDir: string,
  projectId: string,
  artifactId: string,
): Promise<ArtifactContent> {
  // artifactId 来自前端点击，`../../../etc/passwd` 不能变成读取目标
  const file = safeJoin(artifactsDir(dataDir, projectId), artifactId, "artifactId");
  return { artifactId, content: await fs.readFile(file, "utf8") };
}

export async function saveFinalOutput(
  dataDir: string,
  projectId: string,
  output: FinalizeAllInput,
  resume: ResumeV2,
): Promise<void> {
  const dir = projectDir(dataDir, projectId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(backgroundFile(dataDir, projectId), output.background, "utf8");
  await fs.writeFile(path.join(dir, "resume.json"), JSON.stringify(resume, null, 2), "utf8");
}

export async function loadBackground(dataDir: string, projectId: string): Promise<string | null> {
  try {
    return await fs.readFile(backgroundFile(dataDir, projectId), "utf8");
  } catch {
    return null;
  }
}

export async function saveBackground(dataDir: string, projectId: string, content: string): Promise<void> {
  const file = backgroundFile(dataDir, projectId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

export async function listBackgroundProjects(dataDir: string): Promise<string[]> {
  try {
    const root = path.join(dataDir, "resume_agent", "projects");
    const entries = await fs.readdir(root, { withFileTypes: true });
    const result: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        await fs.access(backgroundFile(dataDir, entry.name));
        result.push(entry.name);
      } catch {
        // Ignore projects without background.md.
      }
    }
    return result;
  } catch {
    return [];
  }
}

export async function deleteProjectKnowledge(dataDir: string, projectId: string): Promise<void> {
  await fs.rm(projectDir(dataDir, projectId), { recursive: true, force: true });
}
