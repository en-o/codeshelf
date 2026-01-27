import { invoke } from "@tauri-apps/api/core";
import type { Project, CreateProjectInput, UpdateProjectInput } from "@/types";

export async function addProject(input: CreateProjectInput): Promise<Project> {
  return invoke("add_project", { input });
}

export async function removeProject(id: string): Promise<void> {
  return invoke("remove_project", { id });
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

export async function openInEditor(path: string, editorPath?: string): Promise<void> {
  return invoke("open_in_editor", { path, editorPath });
}

export async function openInTerminal(
  path: string,
  terminalType?: string,
  customPath?: string
): Promise<void> {
  return invoke("open_in_terminal", { path, terminalType, customPath });
}

export async function openUrl(url: string): Promise<void> {
  return invoke("open_url", { url });
}
