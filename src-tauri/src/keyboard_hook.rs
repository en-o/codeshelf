/// Windows 低级键盘钩子模块
/// 使用 SetWindowsHookEx(WH_KEYBOARD_LL) 替代 RegisterHotKey，
/// 多个钩子链式共存不会冲突。
///
/// 非 Windows 平台提供 no-op 命令存根。
use crate::error::AppResult;
use serde::Deserialize;

#[derive(Deserialize, specta::Type)]
#[allow(dead_code)]
pub struct GlobalShortcutBinding {
    pub id: String,
    pub keys: String,
}

// ============== Windows 实现 ==============

#[cfg(target_os = "windows")]
mod win {
    use std::sync::mpsc::{self, Receiver, SyncSender};
    use std::sync::{Arc, Mutex, OnceLock};
    use std::thread::JoinHandle;
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;

    use crate::error::AppResult;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx, KBDLLHOOKSTRUCT, MSG,
        WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
    };

    // --- 修饰键位掩码 ---
    pub const MOD_CTRL: u8 = 1;
    pub const MOD_ALT: u8 = 2;
    pub const MOD_SHIFT: u8 = 4;

    // --- 虚拟键码常量 ---
    const VK_CONTROL: u32 = 0x11;
    const VK_MENU: u32 = 0x12; // Alt
    const VK_SHIFT: u32 = 0x10;
    const VK_LCONTROL: u32 = 0xA2;
    const VK_RCONTROL: u32 = 0xA3;
    const VK_LMENU: u32 = 0xA4;
    const VK_RMENU: u32 = 0xA5;
    const VK_LSHIFT: u32 = 0xA0;
    const VK_RSHIFT: u32 = 0xA1;
    const VK_LWIN: u32 = 0x5B;
    const VK_RWIN: u32 = 0x5C;

    // --- 数据结构 ---

    #[derive(Clone)]
    pub struct HookBinding {
        pub id: String,
        pub modifiers: u8,
        pub vk_code: u32,
    }

    struct HookShared {
        bindings: Arc<Mutex<Vec<HookBinding>>>,
        sender: SyncSender<String>,
    }

    pub static HOOK_SHARED_BINDINGS: OnceLock<Arc<Mutex<Vec<HookBinding>>>> = OnceLock::new();
    static HOOK_SHARED: OnceLock<HookShared> = OnceLock::new();

    pub struct HookState {
        pub thread_handle: JoinHandle<()>,
        pub thread_id: u32,
    }

    pub struct KeyboardHookManager(pub std::sync::Mutex<Option<HookState>>);

    /// 判断虚拟键码是否为修饰键（在 hook_proc 中跳过）
    fn is_modifier_vk(vk: u32) -> bool {
        matches!(
            vk,
            VK_CONTROL
                | VK_MENU
                | VK_SHIFT
                | VK_LCONTROL
                | VK_RCONTROL
                | VK_LMENU
                | VK_RMENU
                | VK_LSHIFT
                | VK_RSHIFT
                | VK_LWIN
                | VK_RWIN
        )
    }

    // --- 钩子回调 ---

    unsafe extern "system" fn hook_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        if n_code >= 0 {
            let msg = w_param.0 as u32;
            if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN {
                let kb = &*(l_param.0 as *const KBDLLHOOKSTRUCT);
                let vk = kb.vkCode;

                if !is_modifier_vk(vk) {
                    // 读取当前修饰键状态
                    let mut mods: u8 = 0;
                    if (GetAsyncKeyState(VK_CONTROL as i32) as u16) & 0x8000 != 0 {
                        mods |= MOD_CTRL;
                    }
                    if (GetAsyncKeyState(VK_MENU as i32) as u16) & 0x8000 != 0 {
                        mods |= MOD_ALT;
                    }
                    if (GetAsyncKeyState(VK_SHIFT as i32) as u16) & 0x8000 != 0 {
                        mods |= MOD_SHIFT;
                    }

                    // 匹配绑定
                    if let Some(shared) = HOOK_SHARED.get() {
                        if let Ok(bindings) = shared.bindings.try_lock() {
                            for b in bindings.iter() {
                                if b.vk_code == vk && b.modifiers == mods {
                                    let _ = shared.sender.try_send(b.id.clone());
                                    break;
                                }
                            }
                        }
                        // try_lock 失败 = 正在更新绑定，跳过本次检测（不阻塞钩子）
                    }
                }
            }
        }

        // 始终传递给下一个钩子，不吞按键
        CallNextHookEx(None, n_code, w_param, l_param)
    }

    // --- 钩子线程管理 ---

    pub fn start_hook(app_handle: tauri::AppHandle) -> AppResult<HookState> {
        let bindings = Arc::new(Mutex::new(Vec::<HookBinding>::new()));
        let (sender, receiver): (SyncSender<String>, Receiver<String>) = mpsc::sync_channel(64);

        // 保存绑定列表引用供 Tauri 命令使用
        HOOK_SHARED_BINDINGS
            .set(bindings.clone())
            .map_err(|_| "键盘钩子已初始化".to_string())?;

        // 初始化全局共享状态
        HOOK_SHARED
            .set(HookShared { bindings, sender })
            .map_err(|_| "键盘钩子已初始化".to_string())?;

        // 线程 ID 传递通道
        let (tid_tx, tid_rx) = mpsc::sync_channel::<u32>(1);

        let thread_handle = std::thread::spawn(move || {
            unsafe {
                // 发送当前线程 ID
                let tid = windows::Win32::System::Threading::GetCurrentThreadId();
                let _ = tid_tx.send(tid);

                // 失败时不能 panic：panic 只杀本线程，主程序无感知。记日志后退化为无钩子。
                let hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0) {
                    Ok(hook) => hook,
                    Err(e) => {
                        log::error!("注册全局键盘钩子失败，全局快捷键不可用: {}", e);
                        return;
                    }
                };

                // 消息循环（WH_KEYBOARD_LL 要求线程有消息循环）
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    // WM_QUIT 会使 GetMessageW 返回 FALSE 退出循环
                }

                let _ = UnhookWindowsHookEx(hook);
            }
        });

        let thread_id = tid_rx
            .recv()
            .map_err(|_| "获取钩子线程 ID 失败".to_string())?;

        // 异步分发任务：从 channel 读取 binding id，通过 Tauri 事件发送到前端
        let app = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            while let Ok(id) = receiver.recv() {
                let _ = tauri::Emitter::emit(&app, "global-shortcut-event", &id);
            }
        });

        log::info!("键盘钩子已启动, 线程ID: {}", thread_id);

        Ok(HookState {
            thread_handle,
            thread_id,
        })
    }

    /// 停止钩子线程
    pub fn stop_hook(state: HookState) {
        unsafe {
            // 向钩子线程发送 WM_QUIT
            windows::Win32::UI::WindowsAndMessaging::PostThreadMessageW(
                state.thread_id,
                windows::Win32::UI::WindowsAndMessaging::WM_QUIT,
                WPARAM(0),
                LPARAM(0),
            )
            .ok();
        }
        let _ = state.thread_handle.join();
        log::info!("键盘钩子已停止");
    }

    /// 从 Tauri 管理状态中停止钩子
    pub fn stop_hook_from_manager(app: &tauri::AppHandle) {
        use tauri::Manager;
        if let Some(manager) = app.try_state::<KeyboardHookManager>() {
            if let Ok(mut guard) = manager.0.lock() {
                if let Some(state) = guard.take() {
                    stop_hook(state);
                }
            }
        }
    }

    /// 按键解析：键名 -> Windows 虚拟键码
    pub fn key_name_to_vk(name: &str) -> AppResult<u32> {
        // 单个字母 a-z
        if name.len() == 1 {
            let ch = name
                .chars()
                .next()
                .expect("name.len() == 1 ensures at least one char");
            if ch.is_ascii_lowercase() {
                return Ok(ch.to_ascii_uppercase() as u32); // VK_A=0x41 .. VK_Z=0x5A
            }
            if ch.is_ascii_digit() {
                return Ok(ch as u32); // 0x30..0x39
            }
        }

        // F1-F24
        if let Some(rest) = name.strip_prefix('f') {
            if let Ok(n) = rest.parse::<u32>() {
                if (1..=24).contains(&n) {
                    return Ok(0x6F + n); // VK_F1=0x70
                }
            }
        }

        // 特殊键映射
        match name {
            "space" => Ok(0x20),
            "enter" | "return" => Ok(0x0D),
            "escape" | "esc" => Ok(0x1B),
            "tab" => Ok(0x09),
            "backspace" => Ok(0x08),
            "delete" | "del" => Ok(0x2E),
            "insert" => Ok(0x2D),
            "home" => Ok(0x24),
            "end" => Ok(0x23),
            "pageup" => Ok(0x21),
            "pagedown" => Ok(0x22),
            "up" => Ok(0x26),
            "down" => Ok(0x28),
            "left" => Ok(0x25),
            "right" => Ok(0x27),
            "capslock" => Ok(0x14),
            "numlock" => Ok(0x90),
            "scrolllock" => Ok(0x91),
            "printscreen" => Ok(0x2C),
            "pause" => Ok(0x13),
            // 符号键
            ";" | "semicolon" => Ok(0xBA),
            "=" | "equal" => Ok(0xBB),
            "," | "comma" => Ok(0xBC),
            "-" | "minus" => Ok(0xBD),
            "." | "period" => Ok(0xBE),
            "/" | "slash" => Ok(0xBF),
            "`" | "backquote" => Ok(0xC0),
            "[" | "bracketleft" => Ok(0xDB),
            "\\" | "backslash" => Ok(0xDC),
            "]" | "bracketright" => Ok(0xDD),
            "'" | "quote" => Ok(0xDE),
            _ => Err(crate::error::AppError::from(format!("未知按键: {}", name))),
        }
    }

    /// 解析快捷键字符串，如 "ctrl+alt+c" -> (modifiers, vk_code)
    pub fn parse_keys(keys: &str) -> AppResult<(u8, u32)> {
        let mut modifiers: u8 = 0;
        let mut vk_code: Option<u32> = None;

        for part in keys.split('+') {
            let part = part.trim().to_lowercase();
            match part.as_str() {
                "ctrl" | "control" => modifiers |= MOD_CTRL,
                "alt" => modifiers |= MOD_ALT,
                "shift" => modifiers |= MOD_SHIFT,
                _ => {
                    if vk_code.is_some() {
                        return Err(crate::error::AppError::from(format!(
                            "多个非修饰键: {}",
                            keys
                        )));
                    }
                    vk_code = Some(key_name_to_vk(&part)?);
                }
            }
        }

        match vk_code {
            Some(vk) => Ok((modifiers, vk)),
            None => Err(crate::error::AppError::from(format!("缺少主键: {}", keys))),
        }
    }
}

// ============== macOS/Linux 实现 ==============

#[cfg(not(target_os = "windows"))]
mod non_win {
    use std::collections::HashMap;
    use std::sync::Mutex;
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

    use crate::error::AppResult;

    /// 快捷键 ID → action_id 映射，供 handler 查找
    pub struct GlobalShortcutState(pub Mutex<HashMap<u32, String>>);

    impl GlobalShortcutState {
        pub fn new() -> Self {
            Self(Mutex::new(HashMap::new()))
        }
    }

    /// 按键名称 → Code 枚举
    fn key_name_to_code(name: &str) -> AppResult<Code> {
        // 单个字母 a-z
        if name.len() == 1 {
            let ch = name
                .chars()
                .next()
                .expect("name.len() == 1 ensures at least one char");
            if ch.is_ascii_lowercase() {
                return match ch {
                    'a' => Ok(Code::KeyA),
                    'b' => Ok(Code::KeyB),
                    'c' => Ok(Code::KeyC),
                    'd' => Ok(Code::KeyD),
                    'e' => Ok(Code::KeyE),
                    'f' => Ok(Code::KeyF),
                    'g' => Ok(Code::KeyG),
                    'h' => Ok(Code::KeyH),
                    'i' => Ok(Code::KeyI),
                    'j' => Ok(Code::KeyJ),
                    'k' => Ok(Code::KeyK),
                    'l' => Ok(Code::KeyL),
                    'm' => Ok(Code::KeyM),
                    'n' => Ok(Code::KeyN),
                    'o' => Ok(Code::KeyO),
                    'p' => Ok(Code::KeyP),
                    'q' => Ok(Code::KeyQ),
                    'r' => Ok(Code::KeyR),
                    's' => Ok(Code::KeyS),
                    't' => Ok(Code::KeyT),
                    'u' => Ok(Code::KeyU),
                    'v' => Ok(Code::KeyV),
                    'w' => Ok(Code::KeyW),
                    'x' => Ok(Code::KeyX),
                    'y' => Ok(Code::KeyY),
                    'z' => Ok(Code::KeyZ),
                    _ => Err(crate::error::AppError::from(format!("未知按键: {}", name))),
                };
            }
            if ch.is_ascii_digit() {
                return match ch {
                    '0' => Ok(Code::Digit0),
                    '1' => Ok(Code::Digit1),
                    '2' => Ok(Code::Digit2),
                    '3' => Ok(Code::Digit3),
                    '4' => Ok(Code::Digit4),
                    '5' => Ok(Code::Digit5),
                    '6' => Ok(Code::Digit6),
                    '7' => Ok(Code::Digit7),
                    '8' => Ok(Code::Digit8),
                    '9' => Ok(Code::Digit9),
                    _ => unreachable!(),
                };
            }
        }

        // F1-F24
        if let Some(rest) = name.strip_prefix('f') {
            if let Ok(n) = rest.parse::<u32>() {
                return match n {
                    1 => Ok(Code::F1),
                    2 => Ok(Code::F2),
                    3 => Ok(Code::F3),
                    4 => Ok(Code::F4),
                    5 => Ok(Code::F5),
                    6 => Ok(Code::F6),
                    7 => Ok(Code::F7),
                    8 => Ok(Code::F8),
                    9 => Ok(Code::F9),
                    10 => Ok(Code::F10),
                    11 => Ok(Code::F11),
                    12 => Ok(Code::F12),
                    13 => Ok(Code::F13),
                    14 => Ok(Code::F14),
                    15 => Ok(Code::F15),
                    16 => Ok(Code::F16),
                    17 => Ok(Code::F17),
                    18 => Ok(Code::F18),
                    19 => Ok(Code::F19),
                    20 => Ok(Code::F20),
                    21 => Ok(Code::F21),
                    22 => Ok(Code::F22),
                    23 => Ok(Code::F23),
                    24 => Ok(Code::F24),
                    _ => Err(crate::error::AppError::from(format!("未知功能键: F{}", n))),
                };
            }
        }

        // 特殊键映射
        match name {
            "space" => Ok(Code::Space),
            "enter" | "return" => Ok(Code::Enter),
            "escape" | "esc" => Ok(Code::Escape),
            "tab" => Ok(Code::Tab),
            "backspace" => Ok(Code::Backspace),
            "delete" | "del" => Ok(Code::Delete),
            "insert" => Ok(Code::Insert),
            "home" => Ok(Code::Home),
            "end" => Ok(Code::End),
            "pageup" => Ok(Code::PageUp),
            "pagedown" => Ok(Code::PageDown),
            "up" => Ok(Code::ArrowUp),
            "down" => Ok(Code::ArrowDown),
            "left" => Ok(Code::ArrowLeft),
            "right" => Ok(Code::ArrowRight),
            "capslock" => Ok(Code::CapsLock),
            "numlock" => Ok(Code::NumLock),
            "scrolllock" => Ok(Code::ScrollLock),
            "printscreen" => Ok(Code::PrintScreen),
            "pause" => Ok(Code::Pause),
            // 符号键
            ";" | "semicolon" => Ok(Code::Semicolon),
            "=" | "equal" => Ok(Code::Equal),
            "," | "comma" => Ok(Code::Comma),
            "-" | "minus" => Ok(Code::Minus),
            "." | "period" => Ok(Code::Period),
            "/" | "slash" => Ok(Code::Slash),
            "`" | "backquote" => Ok(Code::Backquote),
            "[" | "bracketleft" => Ok(Code::BracketLeft),
            "\\" | "backslash" => Ok(Code::Backslash),
            "]" | "bracketright" => Ok(Code::BracketRight),
            "'" | "quote" => Ok(Code::Quote),
            _ => Err(crate::error::AppError::from(format!("未知按键: {}", name))),
        }
    }

    /// 解析快捷键字符串，如 "ctrl+alt+c" → Shortcut
    /// macOS 映射: "ctrl" → Command (META), "alt" → Option (ALT)
    pub fn parse_shortcut(keys: &str) -> AppResult<Shortcut> {
        let mut modifiers = Modifiers::empty();
        let mut main_key: Option<Code> = None;

        for part in keys.split('+') {
            let part = part.trim().to_lowercase();
            match part.as_str() {
                "ctrl" | "control" => modifiers |= Modifiers::META, // macOS Command 键
                "alt" => modifiers |= Modifiers::ALT,               // macOS Option 键
                "shift" => modifiers |= Modifiers::SHIFT,
                _ => {
                    if main_key.is_some() {
                        return Err(crate::error::AppError::from(format!(
                            "多个非修饰键: {}",
                            keys
                        )));
                    }
                    main_key = Some(key_name_to_code(&part)?);
                }
            }
        }

        match main_key {
            Some(code) => Ok(Shortcut::new(Some(modifiers), code)),
            None => Err(crate::error::AppError::from(format!("缺少主键: {}", keys))),
        }
    }
}

// ============== 公共 API ==============

#[cfg(target_os = "windows")]
pub use win::KeyboardHookManager;

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
pub struct KeyboardHookManager(pub std::sync::Mutex<Option<()>>);

#[cfg(not(target_os = "windows"))]
pub use non_win::GlobalShortcutState;

// --- start_hook ---

#[cfg(target_os = "windows")]
pub fn start_hook(app_handle: tauri::AppHandle) -> AppResult<win::HookState> {
    win::start_hook(app_handle)
}

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
pub fn start_hook(_app_handle: tauri::AppHandle) -> AppResult<()> {
    log::warn!("键盘钩子仅支持 Windows 平台");
    Ok(())
}

// --- stop_hook_from_manager ---

#[cfg(target_os = "windows")]
pub fn stop_hook_from_manager(app: &tauri::AppHandle) {
    win::stop_hook_from_manager(app);
}

#[cfg(not(target_os = "windows"))]
pub fn stop_hook_from_manager(_app: &tauri::AppHandle) {}

// --- Tauri 命令 ---

#[cfg(target_os = "windows")]
#[tauri::command]
#[specta::specta]
pub async fn register_global_shortcuts(shortcuts: Vec<GlobalShortcutBinding>) -> AppResult<()> {
    let bindings_lock = win::HOOK_SHARED_BINDINGS
        .get()
        .ok_or_else(|| crate::error::AppError::from("键盘钩子未初始化".to_string()))?;

    let mut new_bindings = Vec::with_capacity(shortcuts.len());
    for s in &shortcuts {
        let (modifiers, vk_code) = win::parse_keys(&s.keys)?;
        new_bindings.push(win::HookBinding {
            id: s.id.clone(),
            modifiers,
            vk_code,
        });
    }

    // 整体替换绑定列表
    let mut bindings = bindings_lock
        .lock()
        .map_err(|e| crate::error::AppError::from(format!("锁获取失败: {}", e)))?;
    *bindings = new_bindings;

    log::info!("已注册 {} 个全局快捷键", shortcuts.len());
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
#[specta::specta]
pub async fn register_global_shortcuts(
    app: tauri::AppHandle,
    shortcuts: Vec<GlobalShortcutBinding>,
) -> AppResult<()> {
    use tauri::Manager;
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let global_shortcut = app.global_shortcut();

    // 清除旧注册
    global_shortcut
        .unregister_all()
        .map_err(|e| crate::error::AppError::from(format!("注销快捷键失败: {}", e)))?;

    // 更新映射
    let state = app.state::<GlobalShortcutState>();
    let mut map = state
        .0
        .lock()
        .map_err(|e| crate::error::AppError::from(format!("锁获取失败: {}", e)))?;
    map.clear();

    for s in &shortcuts {
        let shortcut = non_win::parse_shortcut(&s.keys)?;
        let shortcut_id = shortcut.id();
        global_shortcut.register(shortcut).map_err(|e| {
            crate::error::AppError::from(format!("注册快捷键 {} 失败: {}", s.keys, e))
        })?;
        map.insert(shortcut_id, s.id.clone());
    }

    log::info!("已注册 {} 个全局快捷键 (macOS)", shortcuts.len());
    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
#[specta::specta]
pub async fn unregister_all_global_shortcuts() -> AppResult<()> {
    if let Some(bindings_lock) = win::HOOK_SHARED_BINDINGS.get() {
        let mut bindings = bindings_lock
            .lock()
            .map_err(|e| crate::error::AppError::from(format!("锁获取失败: {}", e)))?;
        bindings.clear();
        log::info!("已注销所有全局快捷键");
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
#[specta::specta]
pub async fn unregister_all_global_shortcuts(app: tauri::AppHandle) -> AppResult<()> {
    use tauri::Manager;
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    app.global_shortcut()
        .unregister_all()
        .map_err(|e| crate::error::AppError::from(format!("注销快捷键失败: {}", e)))?;

    let state = app.state::<GlobalShortcutState>();
    let mut map = state
        .0
        .lock()
        .map_err(|e| crate::error::AppError::from(format!("锁获取失败: {}", e)))?;
    map.clear();

    log::info!("已注销所有全局快捷键 (macOS)");
    Ok(())
}
