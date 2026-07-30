// 迁移协调器：按版本号顺序应用未完成的迁移。
//
// 当前实现 v1：建表 + 从 JSON 搬迁现有数据。
//
// 重要约束：
// - 任何 step 失败都不应破坏原 JSON 文件（用户能手动恢复）
// - 备份在最前面执行，确保即使后续步骤崩溃也有完整副本
// - 表创建用 raw_sql 一次性执行（v1_initial.sql 包含多个 CREATE）
// - 数据搬迁每个数据集一个事务，单个数据集失败时其他已迁移的不回滚

use crate::error::AppResult;
use std::fs;
use std::path::{Path, PathBuf};

use crate::storage::db::{get_schema_version, pool, set_schema_version};

mod v1_from_json;

const V1_INITIAL_SQL: &str = include_str!("v1_initial.sql");

const PENDING_RESTORE_FLAG: &str = ".pending_restore";

/// 应用所有待执行的迁移。`data_dir` 是 JSON 文件所在目录。
pub async fn run_migrations(data_dir: &Path) -> AppResult<()> {
    let current = get_schema_version().await?;

    if current < 1 {
        log::info!("数据库 schema_version={}，开始执行 v1 迁移", current);
        run_v1(data_dir).await?;
        set_schema_version(1).await?;
        log::info!("v1 迁移完成，schema_version=1");
    } else {
        log::debug!("数据库 schema_version={}，无迁移待执行", current);
    }

    Ok(())
}

async fn run_v1(data_dir: &Path) -> AppResult<()> {
    // Step 1: 备份整个 data 目录（关键保险）
    let backup_dir = make_backup_dir(data_dir)?;
    log::info!("备份数据目录到: {:?}", backup_dir);
    backup_directory(data_dir, &backup_dir)?;

    // Step 2: 建表
    log::info!("创建 v1 表结构");
    sqlx::raw_sql(V1_INITIAL_SQL)
        .execute(pool())
        .await
        .map_err(|e| crate::error::AppError::from(format!("建表失败: {}", e)))?;

    // Step 3: 逐数据集搬迁。任一失败立即终止（用户应能在日志里看到原因，
    //         并通过 backup_<ts> 目录恢复）。
    v1_from_json::migrate_projects(data_dir).await?;
    v1_from_json::migrate_chat(data_dir).await?;
    v1_from_json::migrate_clipboard(data_dir).await?;
    v1_from_json::migrate_stats(data_dir).await?;

    // Step 4: 给原 JSON / 目录改名加 .migrated 后缀（不删除）
    v1_from_json::mark_files_migrated(data_dir)?;

    Ok(())
}

fn make_backup_dir(data_dir: &Path) -> AppResult<PathBuf> {
    let parent = data_dir
        .parent()
        .ok_or_else(|| crate::error::AppError::from("无法定位 data_dir 父目录".to_string()))?;
    let ts = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
    Ok(parent.join(format!("backup_{}", ts)))
}

fn backup_directory(src: &Path, dst: &Path) -> AppResult<()> {
    if !src.exists() {
        // 干净启动，没有数据需要备份
        return Ok(());
    }
    // 目录可能空 —— 仍然创建一个空备份目录，作为"迁移执行过"的证据
    fs::create_dir_all(dst)
        .map_err(|e| crate::error::AppError::from(format!("创建备份目录失败: {}", e)))?;
    copy_dir_recursive(src, dst)?;
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> AppResult<()> {
    for entry in fs::read_dir(src)
        .map_err(|e| crate::error::AppError::from(format!("读取目录 {:?} 失败: {}", src, e)))?
    {
        let entry =
            entry.map_err(|e| crate::error::AppError::from(format!("读取条目失败: {}", e)))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let ft = entry
            .file_type()
            .map_err(|e| crate::error::AppError::from(format!("读取类型失败 {:?}: {}", from, e)))?;
        if ft.is_dir() {
            fs::create_dir_all(&to).map_err(|e| {
                crate::error::AppError::from(format!("创建子目录 {:?} 失败: {}", to, e))
            })?;
            copy_dir_recursive(&from, &to)?;
        } else if ft.is_file() {
            fs::copy(&from, &to).map_err(|e| {
                crate::error::AppError::from(format!("复制 {:?} 失败: {}", from, e))
            })?;
        }
    }
    Ok(())
}

// ============== 回滚（restore from backup） ==============
//
// 设计：restore 命令不会立即恢复（pool 已经持有连接、Windows 下文件被锁）。
// 它只写一个 .pending_restore=<timestamp> 标记文件，提示用户重启。
// 下次启动时，在 init_db 之前调用 apply_pending_restore() 执行实际恢复。
//
// 顺序很关键 —— **当前数据要活到最后一步**：
//   1. 先摘掉 flag：无论后面成败，下次启动都不会再跑一遍破坏性流程；
//   2. 严格校验 timestamp 与备份目录（格式 + canonical containment + 非 symlink）；
//   3. 复制备份到同级 staging 目录，校验清单和 SQLite 头；
//   4. 两次 rename 原子切换：data → .restore_previous_<ts>，staging → data；
//      第二步失败就把 previous 换回来。
//   5. 失败时写 .restore_failed 说明原因，并向上抛错（启动流程据此进入阻断状态）。
//
// 旧实现是「先清空 data_dir 再复制」：来源损坏、磁盘满、权限失败都发生在
// 用户数据已经销毁之后，且 flag 还在，每次启动重复销毁一次。

const RESTORE_FAILED_FLAG: &str = ".restore_failed";

/// 备份目录名里的时间戳形如 `20260730T041500Z`（见 make_backup_dir 的 `%Y%m%dT%H%M%SZ`）。
/// 严格匹配，`..`、路径分隔符和绝对路径连进入拼接的机会都没有。
fn validate_timestamp(ts: &str) -> AppResult<()> {
    let b = ts.as_bytes();
    let ok = b.len() == 16
        && b[..8].iter().all(u8::is_ascii_digit)
        && b[8] == b'T'
        && b[9..15].iter().all(u8::is_ascii_digit)
        && b[15] == b'Z';
    if ok {
        Ok(())
    } else {
        Err(crate::error::AppError::from(format!(
            "非法的备份时间戳: {:?}",
            ts
        )))
    }
}

/// 解析并校验 `backup_<ts>`：必须是备份根（data_dir 的父目录）下的真实目录，
/// 不能是 symlink，不能等于 data_dir，也不能是 data_dir 的祖先。
fn resolve_backup_dir(data_dir: &Path, timestamp: &str) -> AppResult<PathBuf> {
    validate_timestamp(timestamp)?;

    let parent = data_dir
        .parent()
        .ok_or_else(|| crate::error::AppError::from("无法定位 data_dir 父目录".to_string()))?;
    let candidate = parent.join(format!("backup_{}", timestamp));

    let meta = fs::symlink_metadata(&candidate).map_err(|_| {
        crate::error::AppError::from(format!("备份 {} 不存在", timestamp))
    })?;
    if meta.file_type().is_symlink() {
        return Err(crate::error::AppError::from(format!(
            "备份 {} 是符号链接，拒绝使用",
            timestamp
        )));
    }
    if !meta.is_dir() {
        return Err(crate::error::AppError::from(format!(
            "备份 {} 不是目录",
            timestamp
        )));
    }

    let canonical = candidate.canonicalize().map_err(|e| {
        crate::error::AppError::from(format!("无法解析备份目录 {}: {}", candidate.display(), e))
    })?;
    let canonical_parent = parent.canonicalize().map_err(|e| {
        crate::error::AppError::from(format!("无法解析备份根 {}: {}", parent.display(), e))
    })?;

    // containment：必须正好是备份根的直接子目录
    if canonical.parent() != Some(canonical_parent.as_path()) {
        return Err(crate::error::AppError::from(format!(
            "备份目录 {} 不在备份根 {} 内",
            canonical.display(),
            canonical_parent.display()
        )));
    }

    // source == destination，或 source 包含 destination —— 复制/切换都会自噬
    if let Ok(canonical_data) = data_dir.canonicalize() {
        if canonical == canonical_data || canonical_data.starts_with(&canonical) {
            return Err(crate::error::AppError::from(
                "备份来源与当前数据目录重叠，拒绝恢复".to_string(),
            ));
        }
    }

    Ok(canonical)
}

/// 写一个 "下次启动时恢复 backup_<ts>" 的标记。
pub fn schedule_restore(data_dir: &Path, timestamp: &str) -> AppResult<()> {
    // 校验放在写标记之前：非法时间戳不该留下任何待执行状态
    resolve_backup_dir(data_dir, timestamp)?;

    fs::create_dir_all(data_dir)
        .map_err(|e| crate::error::AppError::from(format!("创建 data_dir 失败: {}", e)))?;
    let flag = data_dir.join(PENDING_RESTORE_FLAG);
    crate::storage::write_atomic(&flag, timestamp)
        .map_err(|e| crate::error::AppError::from(format!("写入 restore 标记失败: {}", e)))?;
    let _ = fs::remove_file(data_dir.join(RESTORE_FAILED_FLAG));
    Ok(())
}

/// 在 init_db 之前调用。如果有 pending restore 标记，执行恢复。
///
/// 返回 Err 表示恢复失败 —— 调用方必须阻断启动，不能在半恢复的数据上继续初始化。
pub fn apply_pending_restore(data_dir: &Path) -> AppResult<()> {
    let flag = data_dir.join(PENDING_RESTORE_FLAG);
    if !flag.exists() {
        return Ok(());
    }
    let timestamp = fs::read_to_string(&flag)
        .map_err(|e| crate::error::AppError::from(format!("读取 restore 标记失败: {}", e)))?
        .trim()
        .to_string();

    // 先摘标记：后面无论成败，下次启动都不会重复执行破坏性步骤
    let _ = fs::remove_file(&flag);

    match restore_from_backup_dir(data_dir, &timestamp) {
        Ok(previous) => {
            log::warn!(
                "已从备份 {} 恢复；切换前的数据保留在 {}",
                timestamp,
                previous.display()
            );
            Ok(())
        }
        Err(e) => {
            // 当前数据未被触碰；把失败原因落盘，供界面/日志诊断
            let _ = fs::create_dir_all(data_dir);
            let _ = crate::storage::write_atomic(
                data_dir.join(RESTORE_FAILED_FLAG),
                format!("{}\t{}", timestamp, e),
            );
            log::error!("从备份 {} 恢复失败（当前数据未改动）: {}", timestamp, e);
            Err(e)
        }
    }
}

/// 实际恢复。成功时返回「切换前数据」的快照目录。失败时保证 data_dir 未被修改。
fn restore_from_backup_dir(data_dir: &Path, timestamp: &str) -> AppResult<PathBuf> {
    let backup_dir = resolve_backup_dir(data_dir, timestamp)?;
    let parent = data_dir
        .parent()
        .ok_or_else(|| crate::error::AppError::from("无法定位 data_dir 父目录".to_string()))?;

    log::warn!("正在从备份 {} 恢复数据（staging 校验中）...", timestamp);

    // 1. 复制到同级 staging（同一文件系统，后面 rename 才是原子的）
    let staging = parent.join(format!(".restore_staging_{}", timestamp));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| {
            crate::error::AppError::from(format!("清理旧 staging 失败: {}", e))
        })?;
    }
    fs::create_dir_all(&staging)
        .map_err(|e| crate::error::AppError::from(format!("创建 staging 失败: {}", e)))?;

    let copied = copy_dir_recursive(&backup_dir, &staging).and_then(|_| verify_staging(&staging));
    if let Err(e) = copied {
        let _ = fs::remove_dir_all(&staging);
        return Err(e);
    }

    // 2. 原子切换。两次 rename 都在同一父目录内。
    let previous = parent.join(format!(
        ".restore_previous_{}",
        chrono::Utc::now().format("%Y%m%dT%H%M%SZ")
    ));
    let had_data = data_dir.exists();
    if had_data {
        fs::rename(data_dir, &previous).map_err(|e| {
            let _ = fs::remove_dir_all(&staging);
            crate::error::AppError::from(format!("移开当前数据目录失败: {}", e))
        })?;
    }
    if let Err(e) = fs::rename(&staging, data_dir) {
        // 回滚：把原数据换回去，用户看到的还是恢复前的状态
        if had_data {
            let _ = fs::rename(&previous, data_dir);
        }
        let _ = fs::remove_dir_all(&staging);
        return Err(crate::error::AppError::from(format!(
            "切换恢复数据失败（已回滚到恢复前状态）: {}",
            e
        )));
    }

    Ok(previous)
}

/// staging 可用性校验：目录非空 + SQLite 主库文件头正确。
///
/// ponytail: 只验 SQLite 文件头魔数，不做 `PRAGMA integrity_check`
/// （那需要在 pool 之外再开一个连接）。页级损坏仍会漏过 —— 如果真的出现
/// 「恢复后库能打开但内容坏了」，再升级成完整 integrity_check。
fn verify_staging(staging: &Path) -> AppResult<()> {
    let empty = fs::read_dir(staging)
        .map_err(|e| crate::error::AppError::from(format!("读取 staging 失败: {}", e)))?
        .next()
        .is_none();
    if empty {
        return Err(crate::error::AppError::from(
            "备份内容为空，拒绝用它覆盖当前数据".to_string(),
        ));
    }

    let db = staging.join("codeshelf.db");
    if db.exists() {
        use std::io::Read;
        let mut header = [0u8; 16];
        let mut f = fs::File::open(&db)
            .map_err(|e| crate::error::AppError::from(format!("打开备份数据库失败: {}", e)))?;
        f.read_exact(&mut header).map_err(|e| {
            crate::error::AppError::from(format!("备份数据库过小或不可读: {}", e))
        })?;
        if &header != b"SQLite format 3\0" {
            return Err(crate::error::AppError::from(
                "备份中的 codeshelf.db 不是有效的 SQLite 文件".to_string(),
            ));
        }
    }
    Ok(())
}

/// 上一次恢复失败的原因（供前端展示）。没有失败标记时返回 None。
pub fn last_restore_failure(data_dir: &Path) -> Option<String> {
    fs::read_to_string(data_dir.join(RESTORE_FAILED_FLAG))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// 列举所有可用备份的时间戳（按新到旧排序）。
/// 只认合法格式，避免把手工创建的 `backup_../x` 之类目录当成候选返回给前端。
pub fn list_backup_timestamps(data_dir: &Path) -> AppResult<Vec<String>> {
    let parent = data_dir
        .parent()
        .ok_or_else(|| crate::error::AppError::from("无法定位 data_dir 父目录".to_string()))?;
    if !parent.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(parent)
        .map_err(|e| crate::error::AppError::from(format!("读取备份目录失败: {}", e)))?
    {
        let entry =
            entry.map_err(|e| crate::error::AppError::from(format!("读取条目失败: {}", e)))?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(ts) = name.strip_prefix("backup_") {
            if validate_timestamp(ts).is_ok() {
                out.push(ts.to_string());
            }
        }
    }
    out.sort_by(|a, b| b.cmp(a));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "codeshelf-restore-{}-{}-{}",
            tag,
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn timestamp_format_is_strict() {
        assert!(validate_timestamp("20260730T041500Z").is_ok());
        for bad in [
            "20260730T041500Z/..",
            "../data",
            "/etc",
            "20260730T041500",
            "2026073T041500Z",
            "",
            "..",
        ] {
            assert!(validate_timestamp(bad).is_err(), "应拒绝: {bad}");
        }
    }

    #[test]
    fn traversal_and_overlap_are_rejected_before_touching_data() {
        let root = tmp("traversal");
        let data = root.join("data");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("keep.json"), b"{}").unwrap();
        fs::create_dir_all(root.join("backup_20260730T041500Z")).unwrap();

        for bad in [
            "20260730T041500Z/..",
            "20260730T041500Z/../data",
            "/etc",
            "..",
        ] {
            assert!(resolve_backup_dir(&data, bad).is_err());
            assert!(schedule_restore(&data, bad).is_err());
        }

        // 当前数据一个字节都没动，也没有留下待执行标记
        assert!(data.join("keep.json").exists());
        assert!(!data.join(PENDING_RESTORE_FLAG).exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn failed_restore_keeps_current_data_and_does_not_retry() {
        let root = tmp("fail");
        let data = root.join("data");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("keep.json"), b"{\"a\":1}").unwrap();

        // 备份里放一个坏掉的 codeshelf.db —— staging 校验必须拦下来
        let backup = root.join("backup_20260730T041500Z");
        fs::create_dir_all(&backup).unwrap();
        fs::write(backup.join("codeshelf.db"), b"not a sqlite file").unwrap();

        schedule_restore(&data, "20260730T041500Z").unwrap();
        assert!(apply_pending_restore(&data).is_err());

        // 当前数据完好；flag 已摘掉，下次启动不会再破坏一次
        assert_eq!(
            fs::read_to_string(data.join("keep.json")).unwrap(),
            "{\"a\":1}"
        );
        assert!(!data.join(PENDING_RESTORE_FLAG).exists());
        assert!(last_restore_failure(&data).is_some());
        assert!(apply_pending_restore(&data).is_ok());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn successful_restore_swaps_and_keeps_previous_snapshot() {
        let root = tmp("ok");
        let data = root.join("data");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("now.json"), b"new").unwrap();

        let backup = root.join("backup_20260730T041500Z");
        fs::create_dir_all(backup.join("sub")).unwrap();
        fs::write(backup.join("sub/old.json"), b"old").unwrap();

        schedule_restore(&data, "20260730T041500Z").unwrap();
        apply_pending_restore(&data).unwrap();

        assert_eq!(
            fs::read_to_string(data.join("sub/old.json")).unwrap(),
            "old"
        );
        assert!(!data.join("now.json").exists());
        // 切换前的数据留了快照
        assert!(fs::read_dir(&root).unwrap().filter_map(|e| e.ok()).any(|e| e
            .file_name()
            .to_string_lossy()
            .starts_with(".restore_previous_")));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn list_ignores_non_conforming_backup_dirs() {
        let root = tmp("list");
        let data = root.join("data");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(root.join("backup_20260730T041500Z")).unwrap();
        fs::create_dir_all(root.join("backup_whatever")).unwrap();
        fs::write(root.join("backup_20260101T000000Z"), b"file not dir").unwrap();

        assert_eq!(
            list_backup_timestamps(&data).unwrap(),
            vec!["20260730T041500Z".to_string()]
        );

        let _ = fs::remove_dir_all(&root);
    }
}
