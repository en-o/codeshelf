import { invoke } from "@tauri-apps/api/core";
import type {
  GitStatus,
  CommitInfo,
  BranchInfo,
  RemoteInfo,
  GitRepo,
} from "@/types";

export async function scanDirectory(path: string): Promise<GitRepo[]> {
  return invoke("scan_directory", { path });
}

export async function getGitStatus(path: string): Promise<GitStatus> {
  return invoke("get_git_status", { path });
}

export async function getCommitHistory(
  path: string,
  limit?: number
): Promise<CommitInfo[]> {
  return invoke("get_commit_history", { path, limit });
}

export async function getBranches(path: string): Promise<BranchInfo[]> {
  return invoke("get_branches", { path });
}

export async function getRemotes(path: string): Promise<RemoteInfo[]> {
  return invoke("get_remotes", { path });
}

export async function addRemote(
  path: string,
  name: string,
  url: string
): Promise<void> {
  return invoke("add_remote", { path, name, url });
}

export async function removeRemote(path: string, name: string): Promise<void> {
  return invoke("remove_remote", { path, name });
}

export async function gitPush(
  path: string,
  remote: string,
  branch: string,
  force: boolean = false
): Promise<string> {
  return invoke("git_push", { path, remote, branch, force });
}

export async function gitPull(
  path: string,
  remote: string,
  branch: string
): Promise<string> {
  return invoke("git_pull", { path, remote, branch });
}

export async function gitFetch(
  path: string,
  remote?: string
): Promise<string> {
  return invoke("git_fetch", { path, remote });
}
