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

    // 右键菜单若已注册，用当前 exe 路径重写一遍（应用移动/升级后旧路径会失效）
    commands::shell_integration::refresh_registration_on_startup();

    // 冷启动路径：应用没在跑时被右键菜单/命令行拉起，参数在 env 里。
    // 热启动路径见 lib.rs 的单实例回调。
    let args: Vec<String> = std::env::args().collect();
    handle_add_project_args(app.handle(), &args);

    println!("Tauri app setup completed with tray icon");
    Ok(())
}

/// 处理 `--add-project <路径>`：文件管理器右键菜单和命令行共用的入口。
///
/// 冷启动（run_setup）和热启动（单实例回调）都调这里，两条路径行为一致。
/// 添加是异步的，结果通过事件通知前端，失败也发事件——右键菜单点了没反应最难排查。
pub fn handle_add_project_args(app: &AppHandle, args: &[String]) {
    if let Some(path) = parse_add_project_arg(args) {
        add_projects_by_paths(app, vec![path]);
    }
}

/// 应用外部触发的添加：Windows 右键菜单 / 命令行 / macOS「打开方式」与 Dock 拖放。
///
/// 结果通过事件通知前端，失败也发事件——右键菜单点了没反应最难排查。
pub fn add_projects_by_paths(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        focus_main_window(&app);
        for path in paths {
            match commands::project::add_project_by_path(path.clone()).await {
                Ok(result) => emit_or_buffer(&app, ExternalAddEvent::Added(Box::new(result))),
                Err(e) => {
                    log::error!("外部添加项目失败 ({}): {}", path, e);
                    emit_or_buffer(&app, ExternalAddEvent::Failed(e.to_string()));
                }
            }
        }
    });
}

/// 「外部添加项目」的结果事件。
///
/// 冷启动时后端在 setup 阶段就可能把项目加完并发事件，而前端 React 的
/// `listen()` 还没注册 —— 事件直接掉地上，用户点了右键菜单却什么都没发生。
///
/// 所以：前端就绪之前**只入队不发事件**，就绪时由前端一次性取走。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", tag = "kind", content = "payload")]
pub enum ExternalAddEvent {
    // Box：Added 携带整个 Project，与 Failed(String) 体量差距很大。
    // 不装箱的话每个 enum 值都按最大变体分配，队列里全是浪费。
    Added(Box<commands::project::AddProjectByPathResult>),
    Failed(String),
}

static PENDING_EXTERNAL: std::sync::Mutex<Vec<ExternalAddEvent>> = std::sync::Mutex::new(Vec::new());
static FRONTEND_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 前端已就绪就直接发事件，否则入队等它来取。
///
/// 判定和入队在**同一把锁**里完成：否则「检查未就绪」和「push」之间前端刚好取走队列，
/// 这条事件就会永远留在队列里没人处理。
fn emit_or_buffer(app: &AppHandle, event: ExternalAddEvent) {
    let mut queue = match PENDING_EXTERNAL.lock() {
        Ok(q) => q,
        Err(e) => e.into_inner(),
    };
    if FRONTEND_READY.load(std::sync::atomic::Ordering::SeqCst) {
        drop(queue);
        emit_external_event(app, &event);
    } else {
        queue.push(event);
    }
}

fn emit_external_event(app: &AppHandle, event: &ExternalAddEvent) {
    match event {
        ExternalAddEvent::Added(result) => {
            let _ = app.emit("project-added-externally", result.as_ref());
        }
        ExternalAddEvent::Failed(msg) => {
            let _ = app.emit("project-add-failed", msg.clone());
        }
    }
}

/// 前端注册完监听后调用：标记就绪并取走冷启动期间积压的事件。
///
/// 取队列和置位在同一把锁里，保证不会出现「取完之后、置位之前」产生的事件被丢掉。
#[tauri::command]
#[specta::specta]
pub fn take_pending_external_projects() -> Vec<ExternalAddEvent> {
    let mut queue = match PENDING_EXTERNAL.lock() {
        Ok(q) => q,
        Err(e) => e.into_inner(),
    };
    FRONTEND_READY.store(true, std::sync::atomic::Ordering::SeqCst);
    std::mem::take(&mut *queue)
}

/// 支持 `--add-project <路径>` 与 `--add-project=<路径>` 两种写法。
/// Windows 注册表里 `"%V"` 展开后可能带引号或尾部反斜杠，路径校验在
/// normalize_project_path 里统一做，这里只负责取出参数。
fn parse_add_project_arg(args: &[String]) -> Option<String> {
    const FLAG: &str = "--add-project";

    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if let Some(rest) = arg.strip_prefix(FLAG) {
            let value = match rest.strip_prefix('=') {
                Some(v) => v.to_string(),
                // 裸 flag：路径是下一个参数
                None if rest.is_empty() => iter.next()?.to_string(),
                // --add-projectXXX 之类的意外参数，不认
                None => continue,
            };
            let value = value.trim().trim_matches('"').to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
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
///
/// 任何环节失败都记入 `storage::set_startup_error`，前端在加载数据前查询它并整屏阻断。
/// 以前是"打条日志继续启动"：界面照常渲染空数据，用户以为数据没了，
/// 下一次保存就把空状态覆盖上去。
fn init_storage_and_db() {
    if let Err(e) = try_init_storage_and_db() {
        eprintln!("启动失败: {}", e);
        log::error!("启动失败: {}", e);
        storage::set_startup_error(e);
        // pool() 不能 panic：内存兜底库让漏过去的命令返回普通 SQL 错误
        tauri::async_runtime::block_on(storage::db::init_fallback_pool());
    }
}

fn try_init_storage_and_db() -> Result<(), String> {
    let config = storage::init_storage().map_err(|e| format!("数据目录不可用：{}", e))?;
    let db_path = config.db_file();
    let data_dir = config.data_dir.clone();

    // 恢复失败时必须停在这里：不能在半恢复的数据上继续 init_db
    storage::migrations::apply_pending_restore(&data_dir)
        .map_err(|e| format!("从备份恢复失败：{}", e))?;

    tauri::async_runtime::block_on(async {
        storage::db::init_db(&db_path)
            .await
            .map_err(|e| format!("数据库打开失败：{}", e))?;
        storage::migrations::run_migrations(&data_dir)
            .await
            .map_err(|e| format!("数据库迁移失败：{}", e))
    })
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
            // 日志时间戳用本机时区（默认是 UTC，会与系统时间差几个小时）
            .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
            .target(tauri_plugin_log::Target::new(
                tauri_plugin_log::TargetKind::Folder {
                    path: log_dir,
                    file_name: Some("app".into()),
                },
            ))
            // 保留最近 5 个日志文件，单文件 10MB —— 总量上界固定为约 50MB。
            //
            // 原来是 KeepAll：文件数量和总容量都没有上限，长期运行的机器上日志会
            // 无限增长（应用常驻托盘，一跑就是几周）。
            // KeepSome(5) 仍保留足够的排查窗口：单文件 10MB 通常能覆盖数天的运行记录。
            .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
            .max_file_size(10 * 1024 * 1024) // 10MB/文件 × 5 = 上限约 50MB
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
        tauri::tray::TrayIconEvent::DoubleClick {
            button: tauri::tray::MouseButton::Left,
            ..
        } => focus_main_window(app),
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

#[cfg(test)]
mod tests {
    use super::parse_add_project_arg;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn test_parse_add_project_arg() {
        let exe = "codeshelf.exe";

        // 两种写法都要认
        assert_eq!(
            parse_add_project_arg(&args(&[exe, "--add-project", "/a/b"])),
            Some("/a/b".into())
        );
        assert_eq!(
            parse_add_project_arg(&args(&[exe, "--add-project=/a/b"])),
            Some("/a/b".into())
        );

        // Windows 注册表 "%V" 展开后可能带引号
        assert_eq!(
            parse_add_project_arg(&args(&[exe, "--add-project", "\"C:\\a b\""])),
            Some("C:\\a b".into())
        );

        // 没有参数 / 缺值 / 形近参数都不能误命中
        assert_eq!(parse_add_project_arg(&args(&[exe])), None);
        assert_eq!(parse_add_project_arg(&args(&[exe, "--add-project"])), None);
        assert_eq!(
            parse_add_project_arg(&args(&[exe, "--add-project-xyz", "/a/b"])),
            None
        );
        assert_eq!(parse_add_project_arg(&args(&[exe, "--add-project", "   "])), None);
    }
}
