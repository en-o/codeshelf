mod commands;

use commands::{git, project, stats, system};

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

            // Log window creation
            println!("Tauri app setup completed");

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
            git::git_clone,
            git::sync_to_remote,
            git::checkout_branch,
            git::create_branch,
            git::git_add,
            git::git_commit,
            git::git_add_and_commit,
            git::is_git_repo,
            git::git_init,
            // Project commands
            project::add_project,
            project::remove_project,
            project::delete_project_directory,
            project::get_projects,
            project::update_project,
            project::toggle_favorite,
            // Stats commands
            stats::refresh_dashboard_stats,
            stats::get_dashboard_stats,
            stats::refresh_project_stats,
            // System commands
            system::open_in_editor,
            system::open_in_terminal,
            system::open_url,
            system::read_readme,
            system::test_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
