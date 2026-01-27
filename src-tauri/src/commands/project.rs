use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_favorite: bool,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateProjectInput {
    pub name: String,
    pub path: String,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateProjectInput {
    pub id: String,
    pub name: Option<String>,
    pub tags: Option<Vec<String>>,
}

// In-memory store for now, will be replaced with SQLite
use std::sync::Mutex;
use once_cell::sync::Lazy;

static PROJECTS: Lazy<Mutex<Vec<Project>>> = Lazy::new(|| Mutex::new(Vec::new()));

fn generate_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    format!("{:x}", duration.as_nanos())
}

fn get_current_time() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    format!("{}", duration.as_secs())
}

#[tauri::command]
pub async fn add_project(input: CreateProjectInput) -> Result<Project, String> {
    let project = Project {
        id: generate_id(),
        name: input.name,
        path: input.path,
        is_favorite: false,
        tags: input.tags.unwrap_or_default(),
        created_at: get_current_time(),
        updated_at: get_current_time(),
        last_opened: None,
    };

    let mut projects = PROJECTS.lock().map_err(|e| e.to_string())?;

    // Check if path already exists
    if projects.iter().any(|p| p.path == project.path) {
        return Err("Project with this path already exists".to_string());
    }

    projects.push(project.clone());
    Ok(project)
}

#[tauri::command]
pub async fn remove_project(id: String) -> Result<(), String> {
    let mut projects = PROJECTS.lock().map_err(|e| e.to_string())?;

    if let Some(pos) = projects.iter().position(|p| p.id == id) {
        projects.remove(pos);
        Ok(())
    } else {
        Err("Project not found".to_string())
    }
}

#[tauri::command]
pub async fn get_projects() -> Result<Vec<Project>, String> {
    let projects = PROJECTS.lock().map_err(|e| e.to_string())?;
    Ok(projects.clone())
}

#[tauri::command]
pub async fn update_project(input: UpdateProjectInput) -> Result<Project, String> {
    let mut projects = PROJECTS.lock().map_err(|e| e.to_string())?;

    if let Some(project) = projects.iter_mut().find(|p| p.id == input.id) {
        if let Some(name) = input.name {
            project.name = name;
        }
        if let Some(tags) = input.tags {
            project.tags = tags;
        }
        project.updated_at = get_current_time();
        Ok(project.clone())
    } else {
        Err("Project not found".to_string())
    }
}

#[tauri::command]
pub async fn toggle_favorite(id: String) -> Result<Project, String> {
    let mut projects = PROJECTS.lock().map_err(|e| e.to_string())?;

    if let Some(project) = projects.iter_mut().find(|p| p.id == id) {
        project.is_favorite = !project.is_favorite;
        project.updated_at = get_current_time();
        Ok(project.clone())
    } else {
        Err("Project not found".to_string())
    }
}
