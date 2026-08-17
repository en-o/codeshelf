// clippy::type_complexity —— 全局豁免，理由：
// 命中的 8 处全部是 `Lazy<Arc<Mutex<HashMap<String, Arc<T>>>>>` 这类全局状态句柄，
// 以及 sqlx `query_as` 的元组行类型。给它们起 type 别名只是把同样的复杂度挪到别处，
// 反而多一层间接、读代码时还要跳转。这条豁免是**有意**的，不是懒得清。
#![allow(clippy::type_complexity)]

mod app_setup;
mod commands;
pub mod error;
mod handlers;
mod keyboard_hook;
pub mod mcp_gateway;
pub mod http_body;
pub mod path_guard;
pub mod process_guard;
mod storage;

use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta_builder = handlers::make_builder();

    tauri::Builder::default()
        // 单实例插件：防止重复打开应用。
        // 开发模式和正式版使用不同的标识符，可以并行运行。
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            // 右键菜单在应用已运行时触发：参数交给已有实例，不起第二个进程
            app_setup::handle_add_project_args(app, &args);
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
            // macOS：Finder 右键「打开方式 → CodeShelf」和拖到 Dock 图标都走这里。
            // 声明见 src-tauri/Info.plist 的 CFBundleDocumentTypes。
            // 只在打包后的 .app 里生效，`tauri dev` 下不会触发。
            #[cfg(target_os = "macos")]
            if let RunEvent::Opened { urls } = &event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter(|u| u.scheme() == "file")
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();
                app_setup::add_projects_by_paths(app, paths);
            }

            if let RunEvent::Exit = event {
                keyboard_hook::stop_hook_from_manager(app);
                // 杀掉仍在跑的 resume-agent node 子进程，防止孤儿进程继续调用 LLM
                commands::resume_node_agent::kill_all_runs_on_exit();
                // dsh 引擎同理：它自己还会拉起 bash / 子 agent，必须整组回收
                commands::dsh::kill_engine_on_exit();
                commands::dsh::kill_web_on_exit();
            }
        });
}
