import { invoke } from "@tauri-apps/api/core";
import type {
  GitStatus,
  CommitInfo,
  CommitFileChange,
  BranchInfo,
  RemoteInfo,
  GitRepo,
  SyncResult,
} from "@/types";

export interface ConflictFileContent {
  file: string;
  base?: string;
  current?: string;
  incoming?: string;
  worktree?: string;
}

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

export async function getCommitDetail(
  path: string,
  commitHash: string
): Promise<CommitInfo> {
  return invoke("get_commit_detail", { path, commitHash });
}

export async function getCommitFiles(
  path: string,
  commitHash: string
): Promise<CommitFileChange[]> {
  return invoke("get_commit_files", { path, commitHash });
}

export async function searchCommits(
  path: string,
  query: string,
  searchType?: "author" | "message" | "hash",
  limit?: number
): Promise<CommitInfo[]> {
  return invoke("search_commits", { path, query, searchType, limit });
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
): Promise<SyncResult> {
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

export async function gitUnstage(
  path: string,
  files: string[] = []
): Promise<string> {
  return invoke("git_unstage", { path, files });
}

export async function gitDiscardFiles(
  path: string,
  files: string[],
  includeUntracked: boolean = false
): Promise<string> {
  return invoke("git_discard_files", { path, files, includeUntracked });
}

export async function gitStashPush(
  path: string,
  message?: string
): Promise<string> {
  return invoke("git_stash_push", { path, message });
}

export async function gitStashPop(path: string): Promise<string> {
  return invoke("git_stash_pop", { path });
}

export async function gitStashApply(path: string): Promise<string> {
  return invoke("git_stash_apply", { path });
}

export async function gitRevertCommit(path: string, commitHash: string): Promise<string> {
  return invoke("git_revert_commit", { path, commitHash });
}

export async function gitCherryPick(path: string, commitHash: string): Promise<string> {
  return invoke("git_cherry_pick", { path, commitHash });
}

export async function getConflictFileContent(path: string, file: string): Promise<ConflictFileContent> {
  return invoke("get_conflict_file_content", { path, file });
}

export async function gitCheckoutConflictVersion(
  path: string,
  file: string,
  version: "ours" | "theirs"
): Promise<string> {
  return invoke("git_checkout_conflict_version", { path, file, version });
}

export async function gitMarkResolved(path: string, file: string): Promise<string> {
  return invoke("git_mark_resolved", { path, file });
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

export async function cancelGitClone(): Promise<void> {
  return invoke("cancel_git_clone");
}
