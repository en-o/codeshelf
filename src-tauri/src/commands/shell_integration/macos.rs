//! macOS Finder Service provider.
//!
//! `Info.plist` advertises `addToCodeShelf:userData:error:` for `public.folder`.
//! Finder passes selected folder URLs on an `NSPasteboard`; this provider converts
//! them to paths and feeds the same backend entry point used by Dock drag/open events.

use std::sync::OnceLock;

use objc2::{
    define_class, msg_send,
    rc::{autoreleasepool, Retained},
    runtime::NSObjectProtocol,
    ClassType, MainThreadOnly,
};
use objc2_app_kit::{
    NSApplication, NSPasteboard, NSPasteboardURLReadingFileURLsOnlyKey, NSUpdateDynamicServices,
};
use objc2_foundation::{
    ns_string, MainThreadMarker, NSArray, NSBundle, NSDictionary, NSNumber, NSObject, NSString,
    NSURL,
};
use tauri::AppHandle;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn is_declared_in_bundle() -> bool {
    NSBundle::mainBundle()
        .objectForInfoDictionaryKey(ns_string!("NSServices"))
        .is_some()
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements and this class has no ivars or Drop impl.
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[name = "CodeShelfServiceProvider"]
    struct ServiceProvider;

    // SAFETY: NSObjectProtocol adds no requirements beyond the NSObject superclass.
    unsafe impl NSObjectProtocol for ServiceProvider {}

    impl ServiceProvider {
        /// Objective-C signature required by NSServices:
        /// `-addToCodeShelf:userData:error:`.
        #[unsafe(method(addToCodeShelf:userData:error:))]
        fn add_to_codeshelf(
            &self,
            pasteboard: &NSPasteboard,
            _user_data: Option<&NSString>,
            _error: *mut *mut NSString,
        ) {
            let paths = read_folder_paths(pasteboard);
            if paths.is_empty() {
                log::warn!("Finder 服务未收到文件夹路径");
                return;
            }

            if let Some(app) = APP_HANDLE.get() {
                crate::app_setup::add_projects_by_paths(app, paths);
            } else {
                log::error!("Finder 服务触发时 AppHandle 尚未初始化");
            }
        }
    }
);

impl ServiceProvider {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm);
        // SAFETY: NSObject's `init` signature and ownership convention are well-defined.
        unsafe { msg_send![this, init] }
    }
}

fn read_folder_paths(pasteboard: &NSPasteboard) -> Vec<String> {
    autoreleasepool(|_| {
        let classes = NSArray::from_slice(&[NSURL::class()]);
        let file_urls_only = unsafe { NSPasteboardURLReadingFileURLsOnlyKey };
        let yes = NSNumber::new_bool(true);
        let options = NSDictionary::from_slices(&[file_urls_only], &[yes.as_ref()]);

        // SAFETY: The class list contains NSURL and the options dictionary contains
        // the documented boolean value for NSPasteboardURLReadingFileURLsOnlyKey.
        let objects = unsafe { pasteboard.readObjectsForClasses_options(&classes, Some(&options)) };

        objects
            .into_iter()
            .flat_map(|items| {
                items
                    .iter()
                    .filter_map(|object| {
                        object
                            .downcast::<NSURL>()
                            .ok()
                            .and_then(|url| url.path())
                            .map(|path| path.to_string())
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    })
}

pub fn register(app: &AppHandle) {
    let _ = APP_HANDLE.set(app.clone());

    autoreleasepool(|_| {
        let mtm = MainThreadMarker::new().expect("Finder Service 必须在主线程注册");
        let provider = ServiceProvider::new(mtm);
        let ns_app = NSApplication::sharedApplication(mtm);

        // SAFETY: ServiceProvider exposes the exact selector declared in Info.plist.
        // NSApplication retains its servicesProvider.
        unsafe { ns_app.setServicesProvider(Some(&provider)) };

        // 应用通常在首次启动前已复制到 /Applications；主动刷新可避免等到下次登录。
        NSUpdateDynamicServices();
    });
}
