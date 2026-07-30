// 子进程边界：进程组 / 进程树回收，所有 spawn 外部命令的地方共用这一处。
//
// 之前 clone.rs 和 resume_node_agent.rs 各有一份 `kill_process_tree`，Unix 分支都是
// `kill <pid>` —— 只杀直接子进程。而我们 spawn 的往往是 `/bin/sh -c ...` 或 node，
// 它们自己还会拉起 git / ssh / 后台任务，这些后代收不到信号，会继续联网、写文件、
// 烧 LLM 配额。取消和超时看起来生效了，实际只是前台进程消失了。
//
// 正确做法是让子进程成为**新进程组的组长**，然后对整个进程组发信号。

use std::path::Path;

/// 让子进程独立成组（Unix）/ 隐藏控制台窗口（Windows）。
///
/// Unix：`process_group(0)` 等价于子进程 fork 后立刻 `setpgid(0, 0)`，
/// 于是 pgid == pid，`kill(-pid)` 就能覆盖它拉起的全部后代。
/// 顺带把子进程与父进程的终端信号解耦（Ctrl-C 不会误伤，也不会漏杀）。
pub fn configure(cmd: &mut tokio::process::Command) {
    #[cfg(unix)]
    cmd.process_group(0);

    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW：release 下无控制台父级，任何 spawn 都会闪黑窗
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd;
}

/// `std::process::Command` 版本（应用退出路径没有 async 运行时可用）。
pub fn configure_std(cmd: &mut std::process::Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd;
}

/// 终止整个进程树。同步实现：kill/taskkill 本身瞬间返回，
/// 且应用退出钩子里没有 async 运行时可用。
///
/// `pid` 必须是用 [`configure`] / [`configure_std`] 起的进程，否则 Unix 下
/// 退化成只杀单个进程（仍比什么都不做强）。
pub fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // /T 遍历子进程，/F 强制。Windows 没有进程组信号，这是标准做法。
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }

    #[cfg(unix)]
    {
        // 先给整组 TERM 让它有机会清理，短暂等待后再 KILL 收尾。
        // 负号 = 对进程组发信号（configure() 保证了 pgid == pid）。
        unsafe {
            libc_kill(-(pid as i32), 15); // SIGTERM
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
        unsafe {
            libc_kill(-(pid as i32), 9); // SIGKILL
            // 组信号失败（进程没被 configure 过）时兜底杀单个进程
            libc_kill(pid as i32, 9);
        }
    }
}

#[cfg(unix)]
extern "C" {
    #[link_name = "kill"]
    fn libc_kill(pid: i32, sig: i32) -> i32;
}

/// 命令输出的硬上限。超过就地截断并终止进程 —— 不能先全收进内存再截断。
pub const MAX_OUTPUT_BYTES: usize = 256 * 1024;

/// 子进程超时的上下界。工具参数里的 timeout 由模型生成，必须钳制：
/// 无上限时一个 `timeout: 999999999` 就能让进程挂到应用退出。
pub const MIN_TIMEOUT_MS: u64 = 1_000;
pub const MAX_TIMEOUT_MS: u64 = 10 * 60 * 1_000;

/// 把外部传入的 timeout 钳到 [`MIN_TIMEOUT_MS`, `MAX_TIMEOUT_MS`]。
pub fn clamp_timeout_ms(requested: u64) -> u64 {
    requested.clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
}

/// 供日志展示：路径太长时只留末尾两段。
pub fn short_path(p: &Path) -> String {
    let s = p.to_string_lossy();
    if s.len() <= 60 {
        return s.into_owned();
    }
    let tail: Vec<_> = p.components().rev().take(2).collect();
    let tail: Vec<_> = tail.into_iter().rev().collect();
    format!(".../{}", tail.iter().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_is_clamped_both_ends() {
        // 模型生成的超大值必须被钳住，否则进程能挂到应用退出
        assert_eq!(clamp_timeout_ms(u64::MAX), MAX_TIMEOUT_MS);
        assert_eq!(clamp_timeout_ms(999_999_999), MAX_TIMEOUT_MS);
        // 0 / 过小值会让命令来不及启动就超时
        assert_eq!(clamp_timeout_ms(0), MIN_TIMEOUT_MS);
        assert_eq!(clamp_timeout_ms(1), MIN_TIMEOUT_MS);
        // 正常值原样通过
        assert_eq!(clamp_timeout_ms(60_000), 60_000);
        assert_eq!(clamp_timeout_ms(MAX_TIMEOUT_MS), MAX_TIMEOUT_MS);
    }

    /// 进程组是「取消能杀干净后代」的前提，这里验证它确实生效：
    /// sh 起一个后台 sleep，杀掉 sh 所在的进程组后，sleep 必须也没了。
    #[cfg(unix)]
    #[tokio::test]
    async fn kill_tree_reaps_grandchildren() {
        use tokio::process::Command;

        let marker = std::env::temp_dir().join(format!("codeshelf-pg-{}", std::process::id()));
        let _ = std::fs::remove_file(&marker);

        // sh 拉起一个后台子进程：它 30 秒后写 marker。
        // 只杀 sh 的话，这个孙子进程会活下来并写出 marker。
        let mut cmd = Command::new("/bin/sh");
        cmd.arg("-c")
            .arg(format!("(sleep 30; touch {}) & sleep 30", marker.display()));
        // configure(&mut cmd);  // 临时关掉，验证用例确实能抓到问题
        let mut child = cmd.spawn().expect("spawn");
        let pid = child.id().expect("pid");

        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        kill_tree(pid);
        // 回收自己 spawn 的那个，否则它以僵尸态留在进程组里，干扰下面的断言
        let _ = child.wait().await;
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        // 用 pgid 查组内进程，排除僵尸（Z 态已经死了，只是还没被父进程回收）
        let out = std::process::Command::new("ps")
            .args(["-o", "pid=,stat=", "-g", &pid.to_string()])
            .output()
            .expect("ps");
        let alive: Vec<String> = String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.split_whitespace().nth(1).unwrap_or("").starts_with('Z'))
            .map(str::to_string)
            .collect();
        assert!(alive.is_empty(), "进程组里还有残留: {alive:?}");
        assert!(!marker.exists(), "后台孙子进程不该活到写出 marker");
    }
}
