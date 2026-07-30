// 子进程边界：进程组 / 进程树回收，所有 spawn 外部命令的地方共用这一处。
//
// 之前 clone.rs 和 resume_node_agent.rs 各有一份 `kill_process_tree`，Unix 分支都是
// `kill <pid>` —— 只杀直接子进程。而我们 spawn 的往往是 `/bin/sh -c ...` 或 node，
// 它们自己还会拉起 git / ssh / 后台任务，这些后代收不到信号，会继续联网、写文件、
// 烧 LLM 配额。取消和超时看起来生效了，实际只是前台进程消失了。
//
// 正确做法是让子进程成为**新进程组的组长**，然后对整个进程组发信号。

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

    /// 进程组是「取消能杀干净后代」的前提，这里验证它确实生效。
    ///
    /// 注意断言方式：不能用 `ps -g <pid>` 查进程组 —— 没有进程组时 ps 直接返回空，
    /// 断言会**空过**（第一版就是这么写的，把 `configure` 注释掉照样通过，等于没测）。
    /// 所以让 sh 把后台子进程的 PID 写到文件里，直接对那个 PID 做存活检查。
    #[cfg(unix)]
    #[tokio::test]
    async fn kill_tree_reaps_grandchildren() {
        use tokio::process::Command;

        let dir = std::env::temp_dir().join(format!("codeshelf-pg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let pidfile = dir.join("grandchild.pid");

        // sh 拉起一个后台 sleep（孙子进程）并记下它的 PID，自己也 sleep 住。
        // 只杀 sh 的话，这个孙子会活下来 —— 正是 `kill <pid>` 的老问题。
        let mut cmd = Command::new("/bin/sh");
        cmd.arg("-c").arg(format!(
            "sleep 60 & echo $! > {}; sleep 60",
            pidfile.display()
        ));
        configure(&mut cmd);
        let mut child = cmd.spawn().expect("spawn");
        let pid = child.id().expect("pid");

        // 等 sh 把孙子的 PID 写出来
        let mut grandchild = String::new();
        for _ in 0..50 {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            if let Ok(v) = std::fs::read_to_string(&pidfile) {
                if !v.trim().is_empty() {
                    grandchild = v.trim().to_string();
                    break;
                }
            }
        }
        let gpid: i32 = grandchild.parse().expect("拿不到孙子进程 PID");

        // 前置断言：孙子此刻确实活着，否则后面的「已被杀掉」毫无意义
        assert_eq!(unsafe { libc_kill(gpid, 0) }, 0, "孙子进程本应在运行");

        kill_tree(pid);
        let _ = child.wait().await;
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        // 核心断言：signal 0 只做存活探测。孙子必须已经不在了。
        // 注释掉上面的 configure() 时这一条会失败 —— 这就是它在测的东西。
        assert_ne!(
            unsafe { libc_kill(gpid, 0) },
            0,
            "后台孙子进程 {gpid} 仍在运行，进程树没杀干净"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
