import { invoke } from "@tauri-apps/api/core";
import type {
  GitStatus,
  CommitInfo,
  BranchInfo,
  RemoteInfo,
  GitRepo,
} from "@/types";

export async function scanDirectory(path: string, depth?: number): Promise<GitRepo[]> {
  return invoke("scan_directory", { path, depth });
}

export async function getGitStatus(path: string): Promise<GitStatus> {
  return invoke("get_git_status", { path });
}

export async function getCommitHistory(
  path: string,
  limit?: number,
  refName?: string
): Promise<CommitInfo[]> {
  return invoke("get_commit_history", { path, limit, refName });
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

export async function verifyRemoteUrl(url: string): Promise<void> {
  return invoke("verify_remote_url", { url });
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

export async function syncToRemote(
  path: string,
  sourceRemote: string,
  targetRemote: string,
  syncAllBranches: boolean,
  force: boolean = false
): Promise<string> {
  return invoke("sync_to_remote", {
    path,
    sourceRemote,
    targetRemote,
    syncAllBranches,
    force,
  });
}

export async function checkoutBranch(
  path: string,
  branch: string
): Promise<string> {
  return invoke("checkout_branch", { path, branch });
}

export async function createBranch(
  path: string,
  branch: string,
  checkout: boolean = true
): Promise<string> {
  return invoke("create_branch", { path, branch, checkout });
}

export async function gitAdd(
  path: string,
  files: string[] = []
): Promise<string> {
  return invoke("git_add", { path, files });
}

export async function gitCommit(
  path: string,
  message: string
): Promise<string> {
  return invoke("git_commit", { path, message });
}

export async function gitAddAndCommit(
  path: string,
  files: string[],
  message: string
): Promise<string> {
  return invoke("git_add_and_commit", { path, files, message });
}

export async function isGitRepo(path: string): Promise<boolean> {
  return invoke("is_git_repo", { path });
}

export async function gitInit(path: string): Promise<string> {
  return invoke("git_init", { path });
}
