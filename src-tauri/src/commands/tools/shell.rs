//! Bash 工具：在 allowedCwd 中执行 shell。Unix 用 /bin/sh -c，Windows 用 cmd /C。
//!
//! 三条边界都在这里落实（缺任何一条都能把应用拖垮）：
//! - **输出**：边读边计量，累计到上限立刻杀进程树。不能用 `Command::output()` ——
//!   那会把完整 stdout/stderr 先收进内存、最后才截断，`yes` 这类命令在超时之前就 OOM 了。
//! - **时间**：`timeout` 参数由模型生成，必须钳到上下界，否则 `timeout: 999999999`
//!   能让进程一直挂到应用退出。
//! - **进程树**：子进程独立成组，超时/超限时杀整组。只杀 `/bin/sh` 的话，
//!   它拉起的后台任务、ssh、下载会继续跑。

use crate::error::AppResult;
use crate::process_guard;
use std::fs;
use std::process::Stdio;
use std::time::Duration;

use serde_json::Value;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::timeout as tokio_timeout;

use super::ctx::{truncate, ToolCtx};

/// 单条流的上限，两条流合起来不超过 `MAX_OUTPUT_BYTES`。
const PER_STREAM_CAP: usize = process_guard::MAX_OUTPUT_BYTES / 2;

/// 边读边截断：读满 `cap` 就停止收集并返回 `true`（表示被截断）。
///
/// 关键是**不再往 buffer 里塞**，而不是读完再切 —— 后者的内存占用由命令决定，不由我们决定。
async fn read_capped<R>(mut reader: R, cap: usize) -> (Vec<u8>, bool)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut out = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut truncated = false;
    loop {
        match reader.read(&mut chunk).await {
            Ok(0) => break,
            Ok(n) => {
                if out.len() < cap {
                    let take = n.min(cap - out.len());
                    out.extend_from_slice(&chunk[..take]);
                    if out.len() >= cap {
                        truncated = true;
                        break;
                    }
                } else {
                    truncated = true;
                    break;
                }
            }
            Err(_) => break,
        }
    }
    (out, truncated)
}

pub(super) async fn tool_bash(ctx: &ToolCtx, args: &Value) -> AppResult<String> {
    let command = args
        .get("command")
        .and_then(|v| v.as_str())
        .ok_or("缺少 command")?;
    let requested_timeout = args
        .get("timeout")
        .and_then(|v| v.as_u64())
        .unwrap_or(60_000);
    let timeout_ms = process_guard::clamp_timeout_ms(requested_timeout);
    let base = ctx.allowed_cwd.as_ref().ok_or("会话未设置 allowedCwd")?;
    let base_canon = fs::canonicalize(base)
        .map_err(|e| crate::error::AppError::from(format!("allowedCwd 无效: {}", e)))?;

    #[cfg(target_family = "unix")]
    let mut cmd = {
        let mut c = Command::new("/bin/sh");
        c.arg("-c").arg(command);
        c
    };
    #[cfg(target_family = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command);
        c
    };
    cmd.current_dir(&base_canon)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // 独立进程组（Unix）/ 隐藏控制台（Windows）
    process_guard::configure(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| crate::error::AppError::from(format!("执行失败: {}", e)))?;
    let pid = child.id();

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // 两条流并发读，各自带上限；任一读满就整体收工
    let collect = async {
        let (o, e) = tokio::join!(
            async {
                match stdout {
                    Some(s) => read_capped(s, PER_STREAM_CAP).await,
                    None => (Vec::new(), false),
                }
            },
            async {
                match stderr {
                    Some(s) => read_capped(s, PER_STREAM_CAP).await,
                    None => (Vec::new(), false),
                }
            }
        );
        (o, e)
    };

    let collected = tokio_timeout(Duration::from_millis(timeout_ms), collect).await;

    // 无论超时还是读满上限，都要把整棵树收掉再返回。
    // kill_on_drop 只管直接子进程，后台孙子进程要靠进程组。
    let ((stdout_buf, stdout_cut), (stderr_buf, stderr_cut)) = match collected {
        Ok(v) => v,
        Err(_) => {
            if let Some(pid) = pid {
                process_guard::kill_tree(pid);
            }
            let _ = child.wait().await;
            return Err(crate::error::AppError::from(format!(
                "命令超时（{} ms{}）",
                timeout_ms,
                if timeout_ms != requested_timeout {
                    format!("，请求的 {} ms 已被钳制", requested_timeout)
                } else {
                    String::new()
                }
            )));
        }
    };

    let hit_cap = stdout_cut || stderr_cut;
    if hit_cap {
        // 输出达到上限：立刻终止，不等它自己跑完
        if let Some(pid) = pid {
            process_guard::kill_tree(pid);
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| crate::error::AppError::from(format!("等待命令结束失败: {}", e)))?;

    let mut out = String::new();
    out.push_str(&format!("exit: {}\n", status.code().unwrap_or(-1)));
    if hit_cap {
        out.push_str(&format!(
            "[输出超过 {} KB 上限，命令已被终止]\n",
            process_guard::MAX_OUTPUT_BYTES / 1024
        ));
    }
    if !stdout_buf.is_empty() {
        out.push_str("---stdout---\n");
        out.push_str(&String::from_utf8_lossy(&stdout_buf));
        out.push('\n');
    }
    if !stderr_buf.is_empty() {
        out.push_str("---stderr---\n");
        out.push_str(&String::from_utf8_lossy(&stderr_buf));
        out.push('\n');
    }
    Ok(truncate(out, process_guard::MAX_OUTPUT_BYTES))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn ctx_in(dir: &std::path::Path) -> ToolCtx {
        ToolCtx {
            session_id: "test".to_string(),
            allowed_cwd: Some(dir.to_path_buf()),
        }
    }

    /// 无限输出必须在上限处停住，而不是先吃满内存再截断。
    /// 旧实现用 `Command::output()`，这个用例会一直涨到 OOM。
    #[tokio::test]
    async fn unbounded_output_is_capped_and_killed() {
        let dir = std::env::temp_dir();
        let ctx = ctx_in(&dir);
        let args = serde_json::json!({ "command": "yes codeshelf", "timeout": 30000 });

        let started = std::time::Instant::now();
        let out = tool_bash(&ctx, &args).await.expect("应正常返回而不是超时");

        assert!(out.contains("上限，命令已被终止"), "应说明被截断: {}", &out[..200.min(out.len())]);
        // 返回体有确定边界
        assert!(
            out.len() <= process_guard::MAX_OUTPUT_BYTES + 4096,
            "返回体过大: {}",
            out.len()
        );
        // `yes` 是无限的：能在远小于 timeout 的时间内返回，说明是被上限截停的
        assert!(started.elapsed() < Duration::from_secs(20), "没有及时终止");
    }

    /// 超大 timeout 被钳制：命令本身很快，重点是钳制不影响正常执行。
    #[tokio::test]
    async fn oversized_timeout_is_clamped_not_rejected() {
        let dir = std::env::temp_dir();
        let ctx = ctx_in(&dir);
        let args = serde_json::json!({ "command": "echo hi", "timeout": 999_999_999u64 });
        let out = tool_bash(&ctx, &args).await.expect("钳制后仍应正常执行");
        assert!(out.contains("hi"), "{out}");
        assert!(out.starts_with("exit: 0"), "{out}");
    }

    /// 超时后后台孙子进程也必须没了。
    #[tokio::test]
    async fn timeout_kills_background_descendants() {
        let dir = std::env::temp_dir().join(format!("codeshelf-sh-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let pidfile = dir.join("bg.pid");

        let ctx = ctx_in(&dir);
        let args = serde_json::json!({
            "command": format!("sleep 60 & echo $! > {}; sleep 60", pidfile.display()),
            "timeout": 1500,
        });
        let err = tool_bash(&ctx, &args).await.expect_err("应当超时");
        assert!(format!("{:?}", err).contains("超时"));

        let gpid: i32 = std::fs::read_to_string(&pidfile)
            .expect("应写出后台 PID")
            .trim()
            .parse()
            .expect("PID 解析失败");
        tokio::time::sleep(Duration::from_millis(500)).await;
        // signal 0 = 存活探测
        assert_ne!(
            unsafe { kill_probe(gpid) },
            0,
            "后台孙子进程 {gpid} 在超时后仍在运行"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    unsafe fn kill_probe(pid: i32) -> i32 {
        extern "C" {
            fn kill(pid: i32, sig: i32) -> i32;
        }
        kill(pid, 0)
    }
}
