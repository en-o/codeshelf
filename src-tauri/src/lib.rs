mod commands;

use commands::{git, project, system};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Git commands
            git::scan_directory,
            git::get_git_status,
            git::get_commit_history,
            git::get_branches,
            git::get_remotes,
            git::add_remote,
            git::remove_remote,
            git::git_push,
            git::git_pull,
            git::git_fetch,
            // Project commands
            project::add_project,
            project::remove_project,
            project::get_projects,
            project::update_project,
            project::toggle_favorite,
            // System commands
            system::open_in_editor,
            system::open_in_terminal,
            system::open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
