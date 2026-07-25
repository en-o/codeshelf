mod app_setup;
mod commands;
pub mod error;
mod handlers;
mod keyboard_hook;
pub mod mcp_gateway;
mod storage;

use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta_builder = handlers::make_builder();

    tauri::Builder::default()
        // 单实例插件：防止重复打开应用。
        // 开发模式和正式版使用不同的标识符，可以并行运行。
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            specta_builder.mount_events(app);
            app_setup::run_setup(app)
        })
        // 拦截窗口关闭：隐藏到托盘而非退出。
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                keyboard_hook::stop_hook_from_manager(app);
                // 杀掉仍在跑的 resume-agent node 子进程，防止孤儿进程继续调用 LLM
                commands::resume_node_agent::kill_all_runs_on_exit();
            }
        });
}
