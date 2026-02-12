use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use once_cell::sync::Lazy;

use crate::storage;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(alias = "is_favorite")]
    pub is_favorite: bool,
    pub tags: Vec<String>,
    pub labels: Vec<String>,
    #[serde(alias = "created_at")]
    pub created_at: String,
    #[serde(alias = "updated_at")]
    pub updated_at: String,
    #[serde(alias = "last_opened")]
    pub last_opened: Option<String>,
}

/// 项目数据文件格式（带版本信息）
#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectsFile {
    pub version: u32,
    pub last_updated: String,
    pub projects: Vec<Project>,
}

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

// 项目数据存储
static PROJECTS: Lazy<Mutex<Vec<Project>>> = Lazy::new(|| {
    // 启动时从文件加载
    let projects = load_projects_from_file().unwrap_or_default();
    Mutex::new(projects)
});

// 获取数据文件路径
fn get_data_file_path() -> PathBuf {
    // 使用安装目录的 data 文件夹
    match storage::get_storage_config() {
        Ok(config) => config.projects_file(),
        Err(e) => {
            log::error!("获取存储配置失败: {}", e);
            // 如果无法获取配置，使用当前目录的 data 文件夹
            PathBuf::from("data").join("projects.json")
        }
    }
}

// 从文件加载项目
fn load_projects_from_file() -> Result<Vec<Project>, String> {
    let path = get_data_file_path();
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read projects file: {}", e))?;

    // VersionedData 使用 flatten，格式为 {version, last_updated, projects: [...]}
    let projects_file: ProjectsFile = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse projects file: {}", e))?;

    log::info!("从文件加载了 {} 个项目", projects_file.projects.len());
    Ok(projects_file.projects)
}

// 保存项目到文件
fn save_projects_to_file(projects: &[Project]) -> Result<(), String> {
    let path = get_data_file_path();

    // 使用带版本信息的格式保存
    let projects_file = ProjectsFile {
        version: 1,
        last_updated: chrono::Utc::now().to_rfc3339(),
        projects: projects.to_vec(),
    };

    let content = serde_json::to_string(&projects_file)
        .map_err(|e| format!("Failed to serialize projects: {}", e))?;

    fs::write(&path, content)
        .map_err(|e| format!("Failed to write projects file: {}", e))?;

    Ok(())
}

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
        labels: input.labels.unwrap_or_default(),
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

    // 保存到文件
    save_projects_to_file(&projects)?;

    Ok(project)
}

#[tauri::command]
pub async fn remove_project(id: String) -> Result<(), String> {
    let mut projects = PROJECTS.lock().map_err(|e| e.to_string())?;

    if let Some(pos) = projects.iter().position(|p| p.id == id) {
        projects.remove(pos);
        // 保存到文件
        save_projects_to_file(&projects)?;
        Ok(())
    } else {
        Err("Project not found".to_string())
    }
}

#[tauri::command]
pub async fn delete_project_directory(id: String) -> Result<(), String> {
    let mut projects = PROJECTS.lock().map_err(|e| e.to_string())?;

    if let Some(pos) = projects.iter().position(|p| p.id == id) {
        let project = &projects[pos];
        let path = &project.path;

        // Delete the directory
        std::fs::remove_dir_all(path).map_err(|e| format!("Failed to delete directory: {}", e))?;

        // Remove from projects list
        projects.remove(pos);

        // 保存到文件
        save_projects_to_file(&projects)?;

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
        if let Some(labels) = input.labels {
            project.labels = labels;
        }
        project.updated_at = get_current_time();
        let updated = project.clone();

        // 保存到文件
        save_projects_to_file(&projects)?;

        Ok(updated)
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
        let updated = project.clone();

        // 保存到文件
        save_projects_to_file(&projects)?;

        Ok(updated)
    } else {
        Err("Project not found".to_string())
    }
}
