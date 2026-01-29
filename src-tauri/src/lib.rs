mod commands;

use commands::{git, project, stats, system};
use tauri::{
    Manager,
    tray::TrayIconBuilder,
    menu::{Menu, MenuItem},
    image::Image,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 创建托盘右键菜单
            let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出程序", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            // 加载托盘图标
            let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))
                .expect("Failed to load tray icon");

            // 创建系统托盘
            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .tooltip("CodeShelf - 代码书架")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    let app = tray.app_handle();

                    match event {
                        tauri::tray::TrayIconEvent::Click { button, button_state, .. } => {
                            if button == tauri::tray::MouseButton::Left
                                && button_state == tauri::tray::MouseButtonState::Up {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                        tauri::tray::TrayIconEvent::DoubleClick { button, .. } => {
                            if button == tauri::tray::MouseButton::Left {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            println!("Tauri app setup completed with tray icon");

            Ok(())
        })
        // 拦截窗口关闭事件：隐藏到托盘而不是退出
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Git commands
            git::scan_directory,
            git::get_git_status,
            git::get_commit_history,
            git::get_branches,
            git::get_remotes,
            git::add_remote,
            git::verify_remote_url,
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
            system::open_in_explorer,
            system::open_in_editor,
            system::open_in_terminal,
            system::open_url,
            system::read_readme,
            system::test_terminal,
            system::check_git_version,
            system::check_node_version,
            system::get_app_paths,
            system::clear_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
