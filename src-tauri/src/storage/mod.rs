// 存储模块

pub mod config;
pub mod db;
pub mod migrations;
pub mod schema;

pub use config::{get_storage_config, init_storage};
pub use schema::*;

use std::io::Write;
use std::path::Path;

/// 原子写文件：先写同目录 .tmp 再 rename，避免崩溃/断电/磁盘满留下半截文件。
/// 签名与 `std::fs::write` 一致，数据文件的写入应一律用它。
pub fn write_atomic<P: AsRef<Path>, C: AsRef<[u8]>>(path: P, contents: C) -> std::io::Result<()> {
    let path = path.as_ref();
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    let tmp = path.with_file_name(format!("{}.tmp", file_name));
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(contents.as_ref())?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)
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
}
