import { invoke } from "@tauri-apps/api/core";
import type { Project, CreateProjectInput, UpdateProjectInput } from "@/types";

export async function addProject(input: CreateProjectInput): Promise<Project> {
  return invoke("create_project", { input });
}

export async function removeProject(id: string): Promise<void> {
  return invoke("delete_project", { id });
}

export async function deleteProjectDirectory(id: string): Promise<void> {
  return invoke("delete_project_directory", { id });
}

export async function getProjects(): Promise<Project[]> {
  return invoke("get_projects");
}

export async function updateProject(input: UpdateProjectInput): Promise<Project> {
  return invoke("update_project", { input });
}

export async function toggleFavorite(id: string): Promise<Project> {
  return invoke("toggle_favorite", { id });
}

export async function updateLastOpened(id: string): Promise<Project> {
  return invoke("update_last_opened", { id });
}

export async function batchUpdateProjects(updates: UpdateProjectInput[]): Promise<Project[]> {
  return invoke("batch_update_projects", { updates });
}

export async function batchDeleteProjects(ids: string[]): Promise<void> {
  return invoke("batch_delete_projects", { ids });
}

export async function importProjects(newProjects: CreateProjectInput[]): Promise<Project[]> {
  return invoke("import_projects", { newProjects });
}

export async function reloadProjects(): Promise<Project[]> {
  return invoke("reload_projects");
}

export async function openInEditor(path: string, editorPath?: string): Promise<void> {
  return invoke("open_in_editor", { path, editorPath });
}

export async function openInExplorer(path: string): Promise<void> {
  return invoke("open_in_explorer", { path });
}

export async function openInTerminal(
  path: string,
  terminalType?: string,
  customPath?: string,
  terminalPath?: string
): Promise<void> {
  return invoke("open_in_terminal", { path, terminalType, customPath, terminalPath });
}

export async function openUrl(url: string): Promise<void> {
  return invoke("open_url", { url });
}
