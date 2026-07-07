// lib.rs 中 .setup() 回调的实现。
// 按职责拆成多个小函数，避免 setup body 变成 200 行的"上帝函数"。
// run_setup() 是入口；其它函数按调用顺序排列。

use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

use crate::{commands, keyboard_hook, mcp_gateway, storage};

pub fn run_setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    apply_macos_window_style(app);
    init_storage_and_db();
    init_logging(app.handle())?;
    init_tray(app)?;
    init_workers(app);
    init_global_shortcuts(app.handle())?;
    init_keyboard_hook(app);

    // 启动剪贴板监控（后台任务，无需 manage 返回值）
    commands::toolbox::clipboard::start_clipboard_monitor(app.handle().clone());

    println!("Tauri app setup completed with tray icon");
    Ok(())
}

/// macOS: 根据设置决定是否隐藏 Dock 图标 + 让窗口背景透明以支持圆角。
fn apply_macos_window_style(app: &mut tauri::App) {
    #[cfg(target_os = "macos")]
    {
        // 默认 Accessory（仅菜单栏），若设置 show_dock_icon=true 则改为 Regular。
        let show_dock = storage::get_storage_config()
            .ok()
            .and_then(|cfg| std::fs::read_to_string(cfg.app_settings_file()).ok())
            .and_then(|s| serde_json::from_str::<storage::AppSettings>(&s).ok())
            .map(|s| s.show_dock_icon)
            .unwrap_or(false);

        let policy = if show_dock {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        };
        app.set_activation_policy(policy);

        if let Some(window) = app.get_webview_window("main") {
            use objc2_app_kit::{NSColor, NSWindow};
            use objc2_foundation::MainThreadMarker;

            if let Ok(ns_win) = window.ns_window() {
                let _mtm = MainThreadMarker::new().expect("must be on main thread");
                let ns_window: &NSWindow = unsafe { &*(ns_win as *const NSWindow) };
                let clear = NSColor::clearColor();
                ns_window.setBackgroundColor(Some(&clear));
                ns_window.setOpaque(false);
                ns_window.setHasShadow(true);
            }
        }
    }

    let _ = app;
}

/// macOS: 运行时切换 Dock 图标显隐。供 save_app_settings 调用。
#[cfg(target_os = "macos")]
pub fn apply_dock_visibility(app: &AppHandle, show_dock: bool) {
    let policy = if show_dock {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    };
    if let Err(e) = app.set_activation_policy(policy) {
        log::error!("切换 Dock 显示状态失败: {}", e);
    }
}

/// 初始化存储系统 + SQLite。
/// 顺序：apply_pending_restore → init_db → run_migrations。
/// 任何环节失败都只打 log，不阻止应用启动。
fn init_storage_and_db() {
    if let Err(e) = storage::init_storage() {
        eprintln!("存储系统初始化警告: {}", e);
    }

    if let Ok(config) = storage::get_storage_config() {
        let db_path = config.db_file();
        let data_dir = config.data_dir.clone();

        if let Err(e) = storage::migrations::apply_pending_restore(&data_dir) {
            eprintln!("应用 pending restore 失败: {}", e);
            log::error!("应用 pending restore 失败: {}", e);
        }

        if let Err(e) = tauri::async_runtime::block_on(async {
            storage::db::init_db(&db_path).await?;
            storage::migrations::run_migrations(&data_dir).await
        }) {
            eprintln!("SQLite 初始化或迁移失败: {}", e);
            log::error!("SQLite 初始化或迁移失败: {}", e);
        }
    }
}

/// 注册 tauri_plugin_log，日志写到 storage 配置的 logs_dir。
fn init_logging(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let log_dir = if let Ok(config) = storage::get_storage_config() {
        config.logs_dir.clone()
    } else {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.join("logs")))
            .unwrap_or_else(|| std::path::PathBuf::from("logs"))
    };

    let _ = std::fs::create_dir_all(&log_dir);

    app.plugin(
        tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .target(tauri_plugin_log::Target::new(
                tauri_plugin_log::TargetKind::Folder {
                    path: log_dir,
                    file_name: Some("app".into()),
                },
            ))
            .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
            .max_file_size(10 * 1024 * 1024) // 10MB
            .build(),
    )?;

    Ok(())
}

/// 构建托盘菜单 + 图标，并绑定事件处理。
fn init_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let open_logs = MenuItem::with_id(app, "open_logs", "打开日志目录", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出程序", true, None::<&str>)?;

    let tool_monitor = MenuItem::with_id(app, "tool_monitor", "系统监控", true, None::<&str>)?;
    let tool_downloader =
        MenuItem::with_id(app, "tool_downloader", "文件下载", true, None::<&str>)?;
    let tool_server = MenuItem::with_id(app, "tool_server", "本地服务", true, None::<&str>)?;
    let tool_claude = MenuItem::with_id(app, "tool_claude", "Claude Code", true, None::<&str>)?;
    let tool_netcat = MenuItem::with_id(app, "tool_netcat", "Netcat", true, None::<&str>)?;
    let tool_shortcuts =
        MenuItem::with_id(app, "tool_shortcuts", "快捷键备忘", true, None::<&str>)?;
    let tool_clipboard =
        MenuItem::with_id(app, "tool_clipboard", "剪贴板历史", true, None::<&str>)?;
    let tool_ssh_tunnel = MenuItem::with_id(app, "tool_sshTunnel", "SSH 隧道", true, None::<&str>)?;
    let toolbox_submenu = Submenu::with_items(
        app,
        "工具箱",
        true,
        &[
            &tool_monitor,
            &tool_downloader,
            &tool_server,
            &tool_claude,
            &tool_netcat,
            &tool_shortcuts,
            &tool_clipboard,
            &tool_ssh_tunnel,
        ],
    )?;

    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[&show, &sep1, &toolbox_submenu, &sep2, &open_logs, &quit],
    )?;

    let icon =
        Image::from_bytes(include_bytes!("../icons/icon.png")).expect("Failed to load tray icon");

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("CodeShelf - 代码书架")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(handle_tray_menu_event)
        .on_tray_icon_event(handle_tray_icon_event)
        .build(app)?;

    Ok(())
}

fn handle_tray_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();
    match id {
        "show" => focus_main_window(app),
        "open_logs" => open_logs_dir(app),
        "quit" => app.exit(0),
        _ if id.starts_with("tool_") => {
            focus_main_window(app);
            let tool_type = &id[5..]; // strip "tool_" prefix
            let _ = app.emit("navigate-to-tool", tool_type);
        }
        _ => {}
    }
}

fn handle_tray_icon_event(tray: &tauri::tray::TrayIcon, event: tauri::tray::TrayIconEvent) {
    let app = tray.app_handle();
    match event {
        tauri::tray::TrayIconEvent::Click {
            button,
            button_state,
            ..
        } => {
            if button == tauri::tray::MouseButton::Left
                && button_state == tauri::tray::MouseButtonState::Up
            {
                focus_main_window(app);
            }
        }
        tauri::tray::TrayIconEvent::DoubleClick { button, .. } => {
            if button == tauri::tray::MouseButton::Left {
                focus_main_window(app);
            }
        }
        _ => {}
    }
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 托盘「打开日志目录」：在系统文件管理器中打开日志所在文件夹。
/// 日志目录与 init_logging 一致（storage 配置的 logs_dir）。
fn open_logs_dir(app: &AppHandle) {
    let _ = app;
    let log_dir = storage::get_storage_config()
        .map(|c| c.logs_dir.clone())
        .unwrap_or_else(|_| std::path::PathBuf::from("logs"));
    let _ = std::fs::create_dir_all(&log_dir);
    if let Err(e) = open_path_in_file_manager(&log_dir) {
        log::error!("打开日志目录失败 ({}): {}", log_dir.display(), e);
    }
}

/// 跨平台在文件管理器中打开一个目录。
fn open_path_in_file_manager(path: &std::path::Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).spawn()?;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("explorer")
            .arg(path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(path).spawn()?;
    }
    Ok(())
}

/// 启动后台 worker：netcat 状态、workflow 调度器、chat bridge poller、MCP gateway。
fn init_workers(app: &mut tauri::App) {
    app.manage(commands::toolbox::netcat::NetcatState::new());

    {
        let handle = commands::workflows::spawn_scheduler(app.handle().clone());
        app.manage(std::sync::Arc::new(tokio::sync::RwLock::new(handle)));
    }

    {
        let handle = commands::chat_bridge::spawn_bridge(app.handle().clone());
        app.manage(std::sync::Arc::new(tokio::sync::RwLock::new(handle)));
    }

    // 按设置启动内置 MCP Gateway（CodeShelf 面板的一部分）
    tauri::async_runtime::spawn(async {
        if let Err(e) = mcp_gateway::apply_settings_from_storage().await {
            eprintln!("MCP Gateway 初始化失败: {}", e);
        }
    });
}

/// macOS/Linux 全局快捷键插件。Windows 走自己的 keyboard hook（见 init_keyboard_hook）。
fn init_global_shortcuts(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(not(target_os = "windows"))]
    {
        app.manage(keyboard_hook::GlobalShortcutState::new());

        app.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Some(state) = app.try_state::<keyboard_hook::GlobalShortcutState>() {
                            if let Ok(map) = state.0.lock() {
                                if let Some(action_id) = map.get(&shortcut.id()) {
                                    let _ = app.emit("global-shortcut-event", action_id);
                                }
                            }
                        }
                    }
                })
                .build(),
        )?;
    }

    let _ = app;
    Ok(())
}

/// Windows: 启动键盘钩子线程；非 Windows 平台空操作。
fn init_keyboard_hook(app: &tauri::App) {
    #[cfg(target_os = "windows")]
    {
        match keyboard_hook::start_hook(app.handle().clone()) {
            Ok(state) => {
                app.manage(keyboard_hook::KeyboardHookManager(std::sync::Mutex::new(
                    Some(state),
                )));
            }
            Err(e) => {
                log::error!("键盘钩子启动失败: {}", e);
            }
        }
    }

    let _ = app;
}
