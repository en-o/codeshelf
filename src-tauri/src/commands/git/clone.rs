// git clone 与取消：包含进度解析、子进程管理

use crate::error::AppResult;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex as StdMutex;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use super::GitCloneProgress;

#[cfg(target_os = "windows")]
use super::CREATE_NO_WINDOW;

// ============== clone 任务状态机 ==============
//
// 原来是一个裸 `Option<u32>` PID 加一个全局 `AtomicBool` 取消标志，有三个洞：
//   1. 「检查 PID 是否为空」和「spawn 后写 PID」之间没有占位，两个并发请求能双双通过检查、
//      各自 spawn，第二个把第一个的 PID 覆盖掉 —— 取消只杀得掉一个，另一个变成孤儿进程；
//   2. 任一任务结束都无条件把 PID 清空，会把另一个任务的跟踪状态一起抹掉；
//   3. 取消标志是全局的，取消 A 会让 B 也认为自己被取消，进而**删掉 B 的目录**。
//
// 现在：一把锁保护整个状态，认领和登记都带 owner id，任何写入都先核对「这个槽位还是我的吗」。
static CLONE_TASK: StdMutex<Option<CloneTask>> = StdMutex::new(None);
static NEXT_CLONE_ID: AtomicU64 = AtomicU64::new(1);

struct CloneTask {
    /// 本次任务的所有权令牌
    id: u64,
    /// spawn 之后才有；认领成功到 spawn 之间为 None
    pid: Option<u32>,
    /// 只对本任务生效 —— 取消 A 不会波及 B
    cancelled: bool,
}

/// 原子认领：槽位空才写入自己的 id，返回该 id。已有任务在跑就报错。
fn claim_clone_task() -> AppResult<u64> {
    let mut guard = CLONE_TASK
        .lock()
        .map_err(|e| crate::error::AppError::from(e.to_string()))?;
    if guard.is_some() {
        return Err(crate::error::AppError::from(
            "另一个克隆操作正在进行中".to_string(),
        ));
    }
    let id = NEXT_CLONE_ID.fetch_add(1, Ordering::SeqCst);
    *guard = Some(CloneTask {
        id,
        pid: None,
        cancelled: false,
    });
    Ok(id)
}

/// 登记 PID。若槽位已经不是自己的（理论上不该发生），返回 false，调用方应放弃。
fn set_clone_pid(id: u64, pid: u32) -> bool {
    match CLONE_TASK.lock() {
        Ok(mut guard) => match guard.as_mut() {
            Some(task) if task.id == id => {
                task.pid = Some(pid);
                true
            }
            _ => false,
        },
        Err(_) => false,
    }
}

/// 释放槽位并返回本任务是否被取消过。**只在槽位仍属于自己时**清空。
fn release_clone_task(id: u64) -> bool {
    match CLONE_TASK.lock() {
        Ok(mut guard) => {
            let cancelled = guard.as_ref().map(|t| t.id == id && t.cancelled).unwrap_or(false);
            if guard.as_ref().map(|t| t.id == id).unwrap_or(false) {
                *guard = None;
            }
            cancelled
        }
        Err(_) => false,
    }
}

fn parse_clone_progress(line: &str) -> Option<GitCloneProgress> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    if let Some(percent_pos) = line.find('%') {
        let before = &line[..percent_pos];
        let num_start = before
            .rfind(|c: char| !c.is_ascii_digit())
            .map(|i| i + 1)
            .unwrap_or(0);
        let percent: i32 = before[num_start..].parse().unwrap_or(-1);

        let phase = if line.contains("Counting") {
            "counting"
        } else if line.contains("Compressing") {
            "compressing"
        } else if line.contains("Receiving") {
            "receiving"
        } else if line.contains("Resolving") {
            "resolving"
        } else {
            "unknown"
        };

        Some(GitCloneProgress {
            phase: phase.to_string(),
            percent,
            message: line.to_string(),
        })
    } else if line.contains("Cloning into") {
        Some(GitCloneProgress {
            phase: "cloning".to_string(),
            percent: 0,
            message: line.to_string(),
        })
    } else if line.contains("Enumerating") {
        Some(GitCloneProgress {
            phase: "enumerating".to_string(),
            percent: -1,
            message: line.to_string(),
        })
    } else {
        None
    }
}

fn kill_process_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

#[tauri::command]
#[specta::specta]
pub async fn git_clone(
    app: tauri::AppHandle,
    url: String,
    target_dir: String,
    repo_name: String,
) -> AppResult<String> {
    // clone 全程要同步阻塞读 stderr 解析进度，大仓库可达分钟级。
    // 直接在 async 命令里跑会独占一个 tokio worker 线程，期间其它 IPC 命令排队、界面转圈；
    // 整体丢进阻塞线程池。进度事件用 AppHandle::emit，跨线程安全。
    tokio::task::spawn_blocking(move || git_clone_blocking(app, url, target_dir, repo_name))
        .await
        .map_err(|e| crate::error::AppError::from(format!("git 任务调度失败: {}", e)))?
}

fn git_clone_blocking(
    app: tauri::AppHandle,
    url: String,
    target_dir: String,
    repo_name: String,
) -> AppResult<String> {
    use std::io::BufReader;
    use tauri::Emitter;

    // 先原子认领任务槽位，失败就直接返回，不做任何文件操作
    let task_id = claim_clone_task()?;

    // 认领之后的任何提前返回都必须释放槽位，否则后续 clone 全被挡住
    let target_path = match crate::path_guard::claim_new_subdir(
        std::path::Path::new(&target_dir),
        &repo_name,
    ) {
        Ok(p) => p,
        Err(e) => {
            release_clone_task(task_id);
            return Err(e);
        }
    };
    // claim_new_subdir 已经保证：repo_name 是单一正常组件（`..`、绝对路径、
    // 混合分隔符都被拒），目录由我们自己 create_dir 原子创建（无 TOCTOU），
    // 且 canonical 结果确实落在 target_dir 内、不在受保护集合里。
    let target_path_str = target_path.to_string_lossy().to_string();

    /// 认领之后失败：清理自己创建的目录（复核仍是同一个）并释放槽位。
    fn fail(
        task_id: u64,
        created: &std::path::Path,
        err: crate::error::AppError,
    ) -> crate::error::AppError {
        cleanup_created_dir(created);
        release_clone_task(task_id);
        err
    }

    // Emit initial progress
    let _ = app.emit(
        "git-clone-progress",
        GitCloneProgress {
            phase: "cloning".to_string(),
            percent: 0,
            message: "准备克隆...".to_string(),
        },
    );

    // Spawn clone process with --progress flag
    #[cfg(target_os = "windows")]
    let mut child = Command::new("git")
        .args(["clone", "--progress", &url, &target_path_str])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            fail(
                task_id,
                &target_path,
                crate::error::AppError::from(format!("启动 git clone 失败: {}", e)),
            )
        })?;

    #[cfg(not(target_os = "windows"))]
    let mut child = Command::new("git")
        .args(["clone", "--progress", &url, &target_path_str])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            fail(
                task_id,
                &target_path,
                crate::error::AppError::from(format!("启动 git clone 失败: {}", e)),
            )
        })?;

    // 登记 PID 以便取消。槽位若已不属于本任务，说明状态被外部动过，
    // 与其继续跑一个无法被取消的进程，不如立刻收掉。
    if !set_clone_pid(task_id, child.id()) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(fail(
            task_id,
            &target_path,
            crate::error::AppError::from("克隆任务状态异常，已中止".to_string()),
        ));
    }

    // Read progress from stderr (git sends progress via \r-delimited lines)
    let mut last_error_line = String::new();
    if let Some(stderr) = child.stderr.take() {
        let mut reader = BufReader::new(stderr);
        let mut buf = vec![0u8; 512];
        let mut line = String::new();

        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    for &byte in &buf[..n] {
                        if byte == b'\r' || byte == b'\n' {
                            if !line.is_empty() {
                                if let Some(progress) = parse_clone_progress(&line) {
                                    let _ = app.emit("git-clone-progress", progress);
                                }
                                last_error_line = line.clone();
                                line.clear();
                            }
                        } else {
                            line.push(byte as char);
                        }
                    }
                }
                Err(_) => break,
            }
        }

        if !line.is_empty() {
            if let Some(progress) = parse_clone_progress(&line) {
                let _ = app.emit("git-clone-progress", progress);
            }
            last_error_line = line;
        }
    }

    // Wait for process to complete
    let wait_result = child.wait();

    // 释放槽位，同时取回**本任务**的取消标志（不是全局的）
    let cancelled = release_clone_task(task_id);

    let status = match wait_result {
        Ok(s) => s,
        Err(e) => {
            cleanup_created_dir(&target_path);
            return Err(crate::error::AppError::from(format!(
                "等待克隆完成失败: {}",
                e
            )));
        }
    };

    if cancelled {
        cleanup_created_dir(&target_path);
        return Err(crate::error::AppError::from("克隆已取消".to_string()));
    }

    if status.success() {
        Ok(target_path_str)
    } else {
        cleanup_created_dir(&target_path);
        if last_error_line.is_empty() {
            Err(crate::error::AppError::from("克隆失败".to_string()))
        } else {
            Err(crate::error::AppError::from(last_error_line))
        }
    }
}

/// 删除本次 clone 自己创建的目录。
///
/// `ensure_created_dir_unchanged` 会复核它仍解析到当初 `claim_new_subdir` 返回的
/// 同一个 canonical 路径 —— 期间被换成 symlink 或被替换掉就拒绝删除，
/// 免得清理动作反过来删掉调用者根本没创建的东西。
fn cleanup_created_dir(created: &std::path::Path) {
    match crate::path_guard::ensure_created_dir_unchanged(created) {
        Ok(canonical) => {
            let _ = std::fs::remove_dir_all(&canonical);
        }
        Err(e) => {
            eprintln!("跳过 clone 清理（{}）：{}", created.display(), e);
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_git_clone() -> AppResult<()> {
    // 只标记**当前**任务并杀它的进程；槽位由跑着的任务自己释放。
    // 不再用全局标志 —— 那会让下一个任务一启动就以为自己被取消了。
    let pid = {
        let mut guard = CLONE_TASK
            .lock()
            .map_err(|e| crate::error::AppError::from(e.to_string()))?;
        match guard.as_mut() {
            Some(task) => {
                task.cancelled = true;
                task.pid
            }
            None => None,
        }
    };

    if let Some(pid) = pid {
        kill_process_tree(pid);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 这些用例操作全局槽位，串行跑（`cargo test` 默认多线程，故用一把测试锁）。
    static TEST_LOCK: StdMutex<()> = StdMutex::new(());

    fn reset() {
        *CLONE_TASK.lock().unwrap() = None;
    }

    #[test]
    fn only_one_task_can_be_claimed() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset();

        let a = claim_clone_task().expect("第一个应认领成功");
        // 并发的第二个请求必须失败 —— 旧代码里两个都能通过「PID 为空」的检查
        assert!(claim_clone_task().is_err(), "第二个不该拿到所有权");

        // 释放后下一个才能进来，且拿到不同的 id
        assert!(!release_clone_task(a), "没取消过，不该报告已取消");
        let b = claim_clone_task().expect("释放后应能认领");
        assert_ne!(a, b);
        release_clone_task(b);
        assert!(CLONE_TASK.lock().unwrap().is_none(), "最终应回到 idle");
    }

    #[test]
    fn cancel_only_affects_the_owning_task() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset();

        // A 认领并被取消
        let a = claim_clone_task().unwrap();
        assert!(set_clone_pid(a, 4242));
        CLONE_TASK.lock().unwrap().as_mut().unwrap().cancelled = true;
        assert!(release_clone_task(a), "A 应报告被取消");

        // B 是新任务，绝不能继承 A 的取消标志
        // （旧代码用全局 AtomicBool，B 会误判成已取消并删掉自己的目录）
        let b = claim_clone_task().unwrap();
        assert!(!release_clone_task(b), "B 不该被 A 的取消波及");
    }

    #[test]
    fn stale_task_cannot_clobber_the_current_slot() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        reset();

        let a = claim_clone_task().unwrap();
        release_clone_task(a);
        let b = claim_clone_task().unwrap();

        // 迟到的 A：既不能写 B 的 PID，也不能把 B 的槽位清掉
        assert!(!set_clone_pid(a, 1), "过期任务不该能登记 PID");
        assert!(!release_clone_task(a), "过期任务不该报告取消");
        assert!(
            CLONE_TASK.lock().unwrap().as_ref().map(|t| t.id) == Some(b),
            "B 的槽位必须还在"
        );

        release_clone_task(b);
        reset();
    }
}
