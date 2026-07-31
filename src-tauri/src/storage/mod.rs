// 存储模块

pub mod legacy_windows;
pub mod config;
pub mod db;
pub mod migrations;
pub mod schema;

pub use config::{get_storage_config, init_storage};
pub use schema::*;

use std::io::Write;
use std::path::Path;
use std::sync::OnceLock;

/// 启动阶段的致命错误（数据目录不可写 / SQLite 打不开 / 迁移失败 / 恢复失败）。
///
/// 以前这些失败只打一行日志就继续启动，前端照常加载，结果是"假可用"：
/// 界面看起来空了，用户以为数据没了，下一次保存还会把空状态写回去。
/// 现在记录下来，由前端在初始化前查询并整屏阻断。
static STARTUP_ERROR: OnceLock<String> = OnceLock::new();

pub fn set_startup_error(message: String) {
    let _ = STARTUP_ERROR.set(message);
}

pub fn startup_error() -> Option<&'static String> {
    STARTUP_ERROR.get()
}

/// 原子写文件：先写同目录 .tmp 再 rename，避免崩溃/断电/磁盘满留下半截文件。
/// 签名与 `std::fs::write` 一致，数据文件的写入应一律用它。
pub fn write_atomic<P: AsRef<Path>, C: AsRef<[u8]>>(path: P, contents: C) -> std::io::Result<()> {
    let path = path.as_ref();
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    // 临时名必须**每次唯一**。用固定的 `<name>.tmp` 时，两个并发保存会写同一个临时文件，
    // 互相覆盖内容后各自 rename，结果可能是一份半新半旧的残缺文件 ——
    // 原子写反而成了破坏源。pid + 单调计数器足以区分进程内外的并发。
    static TMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let tmp = path.with_file_name(format!(
        "{}.tmp-{}-{}",
        file_name,
        std::process::id(),
        TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));

    let write_result = (|| -> std::io::Result<()> {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(contents.as_ref())?;
        f.sync_all()?;
        Ok(())
    })();
    if let Err(e) = write_result {
        // 写失败别把临时文件留在数据目录里
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

/// 解析 JSON 数据文件；失败时把损坏文件改名备份（<原名>.corrupt-<时间戳>）并返回默认值。
/// 之前的 `unwrap_or_default()` 会静默回默认，下一次保存就把默认值写回文件、
/// 永久丢掉原数据（含 API key 等）；备份保证了原始内容可人工恢复。
pub fn parse_json_or_backup<T: serde::de::DeserializeOwned + Default>(
    path: &Path,
    content: &str,
) -> T {
    match serde_json::from_str(content) {
        Ok(v) => v,
        Err(e) => {
            let file_name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "file".to_string());
            let backup = path.with_file_name(format!(
                "{}.corrupt-{}",
                file_name,
                chrono::Utc::now().timestamp()
            ));
            log::error!(
                "解析 {} 失败（{}），已将损坏文件备份到 {} 并回退默认值",
                path.display(),
                e,
                backup.display()
            );
            let _ = std::fs::rename(path, &backup);
            T::default()
        }
    }
}

/// 测试专用：生成**保证唯一**的临时目录名。
///
/// 不能用 `temp_dir().join(format!("prefix-{}", process::id()))` ——
/// 同一个测试二进制里所有测试的 PID 都一样，唯一性完全依赖前缀字符串。
/// 一旦两个测试不小心用了同一个前缀（`codeshelf-legacy-` 就撞过），
/// 并行执行时一个正在写、另一个 `remove_dir_all`，表现为**偶发**失败，
/// 串行跑又完全正常，极难定位。
///
/// 这里叠加一个进程内自增计数，从根上排除这类碰撞。
#[cfg(test)]
pub fn unique_test_dir(prefix: &str) -> std::path::PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    std::env::temp_dir().join(format!(
        "{}-{}-{}",
        prefix,
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_atomic_and_parse_backup() {
        let dir = std::env::temp_dir().join(format!("codeshelf-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("data.json");

        // 原子写：内容落盘、无 .tmp 残留
        write_atomic(&file, br#"{"a":1}"#).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), r#"{"a":1}"#);
        assert!(!dir.join("data.json.tmp").exists());

        // 正常解析
        let v: std::collections::HashMap<String, i32> =
            parse_json_or_backup(&file, r#"{"a":1}"#);
        assert_eq!(v.get("a"), Some(&1));

        // 损坏内容：返回默认值，且原文件被改名备份而不是留在原地等着被覆盖
        let v: std::collections::HashMap<String, i32> = parse_json_or_backup(&file, "{broken");
        assert!(v.is_empty());
        assert!(!file.exists());
        assert!(std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains(".corrupt-")));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 并发写同一文件不能互相破坏。用固定的 `<name>.tmp` 时，多个线程写同一个
    /// 临时文件、内容交错后各自 rename，最终可能落下一份长度对不上的残缺文件。
    #[test]
    fn concurrent_writes_never_tear_the_file() {
        let dir = std::env::temp_dir().join(format!("codeshelf-concurrent-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("data.json");

        // 长度差异很大的载荷，撕裂时长度对不上就能被发现
        let payloads: Vec<String> = (0..12)
            .map(|i| format!("{}:{}", i, "x".repeat((i + 1) * 5000)))
            .collect();

        std::thread::scope(|scope| {
            for p in &payloads {
                let path = path.clone();
                scope.spawn(move || {
                    write_atomic(&path, p.as_bytes()).expect("write_atomic");
                });
            }
        });

        // 读回来必须恰好等于其中某一个完整载荷
        let got = std::fs::read_to_string(&path).expect("文件应可读");
        assert!(
            payloads.contains(&got),
            "写入被撕裂：长度 {}，前缀 {:?}",
            got.len(),
            &got[..20.min(got.len())]
        );

        // 临时文件不能留在数据目录里
        let leftovers: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "残留临时文件: {leftovers:?}");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
