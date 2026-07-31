//! 文件管理器右键菜单集成：右键文件夹 →「添加到 CodeShelf」。
//!
//! Windows：写用户级注册表（HKCU），不需要管理员权限。
//! macOS：Finder 右键走 app bundle 的 NSServices 声明（见 src-tauri/Info.plist），
//!        表现为「右键 → 快速操作/服务 → 添加到 CodeShelf」；拖到 Dock 图标
//!        则走 CFBundleDocumentTypes + RunEvent::Opened。
//! Linux：各家文件管理器各一套（Nautilus/Dolphin/Thunar），不做。
//!
//! 菜单项最终执行 `codeshelf.exe --add-project "<目录>"`，
//! 参数解析与添加逻辑在 app_setup::handle_add_project_args。

use crate::error::AppResult;
use serde::Serialize;

#[cfg(target_os = "macos")]
mod macos;

#[derive(Debug, Serialize, specta::Type)]
pub struct ShellContextMenuState {
    /// 当前平台是否支持在应用内开关右键菜单
    pub supported: bool,
    /// 是否已注册
    pub registered: bool,
    /// 平台限制说明，直接显示给用户（不支持时才有内容）
    pub note: String,
}

#[tauri::command]
#[specta::specta]
pub fn get_shell_context_menu_state() -> AppResult<ShellContextMenuState> {
    #[cfg(target_os = "windows")]
    {
        Ok(ShellContextMenuState {
            supported: true,
            registered: win::is_registered(),
            note: String::new(),
        })
    }

    #[cfg(target_os = "macos")]
    {
        let registered = macos::is_declared_in_bundle();
        Ok(ShellContextMenuState {
            supported: false,
            registered,
            note: if registered {
                "Finder 中右键文件夹 →「快速操作」或「服务」→「添加到 CodeShelf」。\
                 首次安装后启动一次 CodeShelf 即会刷新服务列表；开启 Dock 图标后，\
                 也可以把文件夹直接拖到 Dock 图标上。"
                    .to_string()
            } else {
                "当前运行版本的安装包未包含 Finder 服务，请安装包含此功能的新版本。".to_string()
            },
        })
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Ok(ShellContextMenuState {
            supported: false,
            registered: false,
            note: "当前平台暂不支持文件管理器右键菜单集成。".to_string(),
        })
    }
}

#[tauri::command]
#[specta::specta]
pub fn set_shell_context_menu(enabled: bool) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        if enabled {
            win::register()
        } else {
            win::unregister()
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Err(crate::error::AppError::from(
            "当前平台不支持在应用内开关右键菜单".to_string(),
        ))
    }
}

/// 启动时调用：已注册的话用当前 exe 路径重写一遍。
/// 应用被移动或升级后 exe 路径可能变了，旧的 command 指向不存在的文件，
/// 表现为「右键菜单点了没反应」——这种问题最难被用户描述清楚。
pub fn refresh_registration_on_startup() {
    #[cfg(target_os = "windows")]
    {
        if win::is_registered() {
            if let Err(e) = win::register() {
                log::error!("刷新右键菜单注册失败: {}", e);
            }
        }
    }
}

/// 注册 Info.plist 中声明的 Finder Service provider，并要求 macOS 立即刷新服务列表。
/// 必须在主线程的 setup 阶段调用。
pub fn register_macos_finder_service(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    macos::register(app);

    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

// ============== Windows 实现 ==============

#[cfg(target_os = "windows")]
mod win {
    use crate::error::{AppError, AppResult};
    use std::ffi::c_void;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegOpenKeyExW, RegSetValueExW, HKEY,
        HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ,
    };

    /// 两处入口：文件夹本身用 %1；文件夹空白处用 %V 表示当前目录。
    const MENU_KEYS: [(&str, &str); 2] = [
        (r"Software\Classes\Directory\shell\CodeShelf", "%1"),
        (
            r"Software\Classes\Directory\Background\shell\CodeShelf",
            "%V",
        ),
    ];

    const MENU_LABEL: &str = "添加到 CodeShelf";

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// 把 UTF-16 缓冲区当字节切片交给 RegSetValueExW（REG_SZ 要求含结尾的 NUL）
    fn as_bytes(buf: &[u16]) -> &[u8] {
        unsafe { std::slice::from_raw_parts(buf.as_ptr() as *const u8, buf.len() * 2) }
    }

    struct RegKey(HKEY);

    impl Drop for RegKey {
        fn drop(&mut self) {
            unsafe {
                let _ = RegCloseKey(self.0);
            }
        }
    }

    fn create_key(subkey: &str) -> AppResult<RegKey> {
        let mut hkey = HKEY::default();
        let status = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(wide(subkey).as_ptr()),
                None,
                PCWSTR::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_WRITE,
                None,
                &mut hkey,
                None,
            )
        };
        if status != ERROR_SUCCESS {
            return Err(AppError::from(format!(
                "创建注册表项失败 {}: {:?}",
                subkey, status
            )));
        }
        Ok(RegKey(hkey))
    }

    /// name = None 表示写「默认值」
    fn set_string(key: &RegKey, name: Option<&str>, value: &str) -> AppResult<()> {
        let data = wide(value);
        let name_buf = name.map(wide);
        let name_ptr = match &name_buf {
            Some(buf) => PCWSTR(buf.as_ptr()),
            None => PCWSTR::null(),
        };
        let status =
            unsafe { RegSetValueExW(key.0, name_ptr, None, REG_SZ, Some(as_bytes(&data))) };
        if status != ERROR_SUCCESS {
            return Err(AppError::from(format!("写注册表值失败: {:?}", status)));
        }
        Ok(())
    }

    fn key_exists(subkey: &str) -> bool {
        let mut hkey = HKEY::default();
        let status = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(wide(subkey).as_ptr()),
                None,
                KEY_READ,
                &mut hkey,
            )
        };
        if status == ERROR_SUCCESS {
            unsafe {
                let _ = RegCloseKey(hkey);
            }
            true
        } else {
            false
        }
    }

    pub fn is_registered() -> bool {
        MENU_KEYS
            .iter()
            .all(|(base, _)| key_exists(&format!("{}\\command", base)))
    }

    #[link(name = "shell32")]
    extern "system" {
        fn SHChangeNotify(event_id: i32, flags: u32, item1: *const c_void, item2: *const c_void);
    }

    /// 通知 Explorer 关联信息已变化，避免必须重启资源管理器或注销才能看到菜单。
    fn notify_explorer() {
        const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
        const SHCNF_IDLIST: u32 = 0;
        unsafe {
            SHChangeNotify(
                SHCNE_ASSOCCHANGED,
                SHCNF_IDLIST,
                std::ptr::null(),
                std::ptr::null(),
            );
        }
    }

    pub fn register() -> AppResult<()> {
        let exe = std::env::current_exe()
            .map_err(|e| AppError::from(format!("获取程序路径失败: {}", e)))?;
        let exe = exe.to_string_lossy().to_string();

        for (base, placeholder) in MENU_KEYS {
            let key = create_key(base)?;
            set_string(&key, None, MENU_LABEL)?;
            // Icon 让菜单项显示应用图标
            set_string(&key, Some("Icon"), &format!("\"{}\",0", exe))?;
            // 明确单选语义，避免 Explorer 将多选路径拼成无法解析的单个参数。
            set_string(&key, Some("MultiSelectModel"), "Single")?;

            let cmd_key = create_key(&format!("{}\\command", base))?;
            // 两侧引号必须写进值里，否则带空格的路径会被拆成多个参数。
            let command = format!("\"{}\" --add-project \"{}\"", exe, placeholder);
            set_string(&cmd_key, None, &command)?;
        }

        notify_explorer();
        Ok(())
    }

    pub fn unregister() -> AppResult<()> {
        for (base, _) in MENU_KEYS {
            let status = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, PCWSTR(wide(base).as_ptr())) };
            // 本来就不存在不算失败（ERROR_FILE_NOT_FOUND = 2）
            if status != ERROR_SUCCESS && status.0 != 2 {
                return Err(AppError::from(format!(
                    "删除注册表项失败 {}: {:?}",
                    base, status
                )));
            }
        }
        notify_explorer();
        Ok(())
    }
}
