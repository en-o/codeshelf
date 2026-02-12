// 项目管理模块

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use once_cell::sync::Lazy;

use crate::storage::{get_storage_config, generate_id, current_iso_time, Project};

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateProjectInput {
    pub name: String,
    pub path: String,
    pub tags: Option<Vec<String>>,
    pub labels: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateProjectInput {
    pub id: String,
    pub name: Option<String>,
    pub tags: Option<Vec<String>>,
    pub labels: Option<Vec<String>>,
}

// 项目数据存储（内存缓存）
static PROJECTS: Lazy<Mutex<Vec<Project>>> = Lazy::new(|| {
    let projects = load_projects_from_file().unwrap_or_default();
    Mutex::new(projects)
});

fn get_data_file_path() -> PathBuf {
    match get_storage_config() {
        Ok(config) => config.projects_file(),
        Err(e) => {
            log::error!("获取存储配置失败: {}", e);
            PathBuf::from("data").join("projects.json")
        }
    }
}

fn load_projects_from_file() -> Result<Vec<Project>, String> {
    let path = get_data_file_path();
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read projects file: {}", e))?;

    // 直接解析为项目数组
    let projects: Vec<Project> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse projects file: {}", e))?;

    log::info!("从文件加载了 {} 个项目", projects.len());
    Ok(projects)
}

fn save_projects_to_file(projects: &[Project]) -> Result<(), String> {
    let path = get_data_file_path();

    // 确保目录存在
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create data directory: {}", e))?;
    }

    // 直接保存为项目数组
    let content = serde_json::to_string(projects)
        .map_err(|e| format!("Failed to serialize projects: {}", e))?;

    fs::write(&path, content)
        .map_err(|e| format!("Failed to write projects file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn get_projects() -> Result<Vec<Project>, String> {
    let projects = PROJECTS.lock().map_err(|e| e.to_string())?;
    Ok(projects.clone())
}

#[tauri::command]
pub fn create_project(input: CreateProjectInput) -> Result<Project, String> {
    let mut projects = PROJECTS.lock().map_err(|e| e.to_string())?;

    // 检查路径是否已存在
    if projects.iter().any(|p| p.path == input.path) {
        return Err("项目路径已存在".to_string());
    }

    let now = current_iso_time();
    let project = Project {
        id: generate_id(),
        name: input.name,
        path: input.path,
        is_favorite: false,
        tags: input.tags.unwrap_or_default(),
        labels: input.labels.unwrap_or_default(),
        created_at: now.clone(),
        updated_at: now,
        last_opened: None,
    };

    projects.push(project.clone());
    save_projects_to_file(&projects)?;

    Ok(project)
}

#[tauri::command]
pub fn update_project(input: UpdateProjectInput) -> Result<Project, String> {
    let mut projects = PROJECTS.lock().map_err(|e| e.to_string())?;

    let project = projects
        .iter_mut()
        .find(|p| p.id == input.id)
        .ok_or("项目不存在")?;

    if let Some(name) = input.name {
        project.name = name;
    }
    if let Some(tags) = input.tags {
        project.tags = tags;
    }
    if let Some(labels) = input.labels {
        project.labels = labels;
    }
    project.updated_at = current_iso_time();

    let updated = project.clone();
    save_projects_to_file(&projects)?;

    Ok(updated)
}

#[tauri::command]
pub fn delete_project(id: String) -> Result<(), String> {
    let mut projects = PROJECTS.lock().map_err(|e| e.to_string())?;

    let index = projects.iter().position(|p| p.id == id).ok_or("项目不存在")?;
    projects.remove(index);

    save_projects_to_file(&projects)?;
    Ok(())
}

#[tauri::command]
pub fn delete_project_directory(id: String) -> Result<(), String> {
    let mut projects = PROJECTS.lock().map_err(|e| e.to_string())?;

    let index = projects.iter().position(|p| p.id == id).ok_or("项目不存在")?;
    let project = &projects[index];
    let path = PathBuf::from(&project.path);

    // 删除目录
    if path.exists() {
        fs::remove_dir_all(&path)
            .map_err(|e| format!("删除目录失败: {}", e))?;
    }

    // 从列表中移除
    projects.remove(index);
    save_projects_to_file(&projects)?;

    Ok(())
}

#[tauri::command]
pub fn toggle_favorite(id: String) -> Result<Project, String> {
    let mut projects = PROJECTS.lock().map_err(|e| e.to_string())?;

    let project = projects
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("项目不存在")?;

    project.is_favorite = !project.is_favorite;
    project.updated_at = current_iso_time();

    let updated = project.clone();
    save_projects_to_file(&projects)?;

    Ok(updated)
}

#[tauri::command]
pub fn update_last_opened(id: String) -> Result<Project, String> {
    let mut projects = PROJECTS.lock().map_err(|e| e.to_string())?;

    let project = projects
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("项目不存在")?;

    project.last_opened = Some(current_iso_time());
    project.updated_at = current_iso_time();

    let updated = project.clone();
    save_projects_to_file(&projects)?;

    Ok(updated)
}

#[tauri::command]
pub fn batch_update_projects(updates: Vec<UpdateProjectInput>) -> Result<Vec<Project>, String> {
    let mut projects = PROJECTS.lock().map_err(|e| e.to_string())?;
    let mut updated_projects = Vec::new();

    for update in updates {
        if let Some(project) = projects.iter_mut().find(|p| p.id == update.id) {
            if let Some(name) = update.name {
                project.name = name;
            }
            if let Some(tags) = update.tags {
                project.tags = tags;
            }
            if let Some(labels) = update.labels {
                project.labels = labels;
            }
            project.updated_at = current_iso_time();
            updated_projects.push(project.clone());
        }
    }

    save_projects_to_file(&projects)?;
    Ok(updated_projects)
}

#[tauri::command]
pub fn batch_delete_projects(ids: Vec<String>) -> Result<(), String> {
    let mut projects = PROJECTS.lock().map_err(|e| e.to_string())?;
    projects.retain(|p| !ids.contains(&p.id));
    save_projects_to_file(&projects)?;
    Ok(())
}

#[tauri::command]
pub fn import_projects(new_projects: Vec<CreateProjectInput>) -> Result<Vec<Project>, String> {
    let mut projects = PROJECTS.lock().map_err(|e| e.to_string())?;
    let mut imported = Vec::new();

    for input in new_projects {
        if projects.iter().any(|p| p.path == input.path) {
            continue;
        }

        let now = current_iso_time();
        let project = Project {
            id: generate_id(),
            name: input.name,
            path: input.path,
            is_favorite: false,
            tags: input.tags.unwrap_or_default(),
            labels: input.labels.unwrap_or_default(),
            created_at: now.clone(),
            updated_at: now,
            last_opened: None,
        };

        projects.push(project.clone());
        imported.push(project);
    }

    save_projects_to_file(&projects)?;
    Ok(imported)
}

/// 重新加载项目（从文件同步）
#[tauri::command]
pub fn reload_projects() -> Result<Vec<Project>, String> {
    let new_projects = load_projects_from_file()?;
    let mut projects = PROJECTS.lock().map_err(|e| e.to_string())?;
    *projects = new_projects;
    Ok(projects.clone())
}
