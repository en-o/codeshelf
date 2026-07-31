//! 本机网络观测：地址、路由、系统代理、环境变量代理、系统 DNS。
//!
//! 平台差异全部收敛在这个文件里。每个平台读不到时返回 `unsupported`/`failed`，
//! **绝不返回空值冒充成功** —— spec 的跨平台验收标准就是这一条。

use super::redact::redact_proxy_url;
use super::types::{DiagnosticItem, FailureKind, Verdict};
use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 本机诊断结果。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalDiagnostics {
    pub items: Vec<DiagnosticItem>,
    /// 采集时间 RFC3339
    pub collected_at: String,
    /// 平台标识，用于历史对比时提示"换了机器"
    pub platform: String,
}

/// 跑一次本机诊断。
pub fn collect() -> LocalDiagnostics {
    let mut items = vec![
        primary_ipv4(),
        primary_ipv6(),
        default_route(),
        system_proxy(),
    ];
    items.extend(env_proxies());
    items.push(system_dns());

    LocalDiagnostics {
        items,
        collected_at: super::types::now_rfc3339(),
        platform: std::env::consts::OS.to_string(),
    }
}

/// 执行平台命令，拿 stdout。失败返回 Err(原因)。
fn run(cmd: &str, args: &[&str]) -> Result<String, String> {
    let mut c = Command::new(cmd);
    c.args(args);
    #[cfg(target_os = "windows")]
    c.creation_flags(CREATE_NO_WINDOW);

    let out = c
        .output()
        .map_err(|e| format!("执行 {} 失败: {}", cmd, e))?;
    if !out.status.success() {
        return Err(format!(
            "{} 退出码 {:?}: {}",
            cmd,
            out.status.code(),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// 本机出站 IPv4。
///
/// 用 UDP socket 的 connect **不发送任何数据**，只让内核按路由表选出源地址。
/// 这比解析 `ifconfig` 输出稳得多，也跨平台一致；同时它反映的是"当前实际走哪张网卡"，
/// 正是排查 VPN/多网卡时想知道的。
fn primary_ipv4() -> DiagnosticItem {
    let item = DiagnosticItem::new("local.ipv4", "本机出站 IPv4", "本机路由选择");
    match local_addr_via_udp("8.8.8.8:80", false) {
        Ok(addr) => item
            .observed(addr, Verdict::Normal)
            .with_detail("按当前路由表选出的源地址；这不是公网出口 IP，公网出口需要外部观察点才能确认"),
        Err(e) => item.failed(FailureKind::Offline, format!("无法确定出站 IPv4：{}", e)),
    }
}

fn primary_ipv6() -> DiagnosticItem {
    let item = DiagnosticItem::new("local.ipv6", "本机出站 IPv6", "本机路由选择");
    match local_addr_via_udp("[2001:4860:4860::8888]:80", true) {
        Ok(addr) => item
            .observed(addr, Verdict::Normal)
            .with_detail("本机存在 IPv6 出站路径；是否绕过代理需要双栈公网探针才能确认"),
        // 没有 IPv6 是非常正常的状态，不是故障 —— 但也**不能**说成"正常"，
        // 因为"没有 IPv6"和"有但探测不到"在本地模式下无法区分。
        Err(_) => DiagnosticItem::new("local.ipv6", "本机出站 IPv6", "本机路由选择")
            .unsupported("未探测到 IPv6 出站路径。本地模式无法区分「确实没有 IPv6」与「有但被策略阻断」，需要 AAAA-only 公网探针"),
    }
}

fn local_addr_via_udp(target: &str, v6: bool) -> Result<String, String> {
    let bind = if v6 { "[::]:0" } else { "0.0.0.0:0" };
    let sock = std::net::UdpSocket::bind(bind).map_err(|e| e.to_string())?;
    // connect 只设置默认目标，不产生任何流量
    sock.connect(target).map_err(|e| e.to_string())?;
    let addr = sock.local_addr().map_err(|e| e.to_string())?;
    Ok(addr.ip().to_string())
}

/// 默认路由 / 网关。
fn default_route() -> DiagnosticItem {
    let item = DiagnosticItem::new("local.route", "默认路由", "本机路由表");

    #[cfg(target_os = "macos")]
    let parsed = run("route", &["-n", "get", "default"]).map(|out| {
        let gw = grep_value(&out, "gateway:");
        let iface = grep_value(&out, "interface:");
        match (gw, iface) {
            (Some(g), Some(i)) => Some(format!("{} via {}", i, g)),
            (None, Some(i)) => Some(format!("{}（无网关，可能是点对点链路）", i)),
            _ => None,
        }
    });

    #[cfg(target_os = "linux")]
    let parsed = run("ip", &["route", "show", "default"]).map(|out| {
        out.lines().next().map(|l| l.trim().to_string()).filter(|l| !l.is_empty())
    });

    #[cfg(target_os = "windows")]
    let parsed = run("route", &["print", "0.0.0.0"]).map(|out| {
        // 输出是表格，取 0.0.0.0 那一行的网关列
        out.lines()
            .find(|l| l.trim_start().starts_with("0.0.0.0"))
            .and_then(|l| {
                let cols: Vec<&str> = l.split_whitespace().collect();
                // Network Destination / Netmask / Gateway / Interface / Metric
                if cols.len() >= 4 {
                    Some(format!("{} via {}", cols[3], cols[2]))
                } else {
                    None
                }
            })
    });

    match parsed {
        Ok(Some(v)) => item.observed(v, Verdict::Normal),
        Ok(None) => item.failed(FailureKind::Other, "路由表里没有默认路由（当前可能没有可用网络）"),
        Err(e) => item.failed(FailureKind::Other, e),
    }
}

#[cfg(target_os = "macos")]
fn grep_value(out: &str, key: &str) -> Option<String> {
    out.lines()
        .find(|l| l.trim().starts_with(key))
        .and_then(|l| l.split(':').nth(1))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// 系统代理设置。
fn system_proxy() -> DiagnosticItem {
    let item = DiagnosticItem::new("local.system_proxy", "系统代理", "操作系统网络设置");

    #[cfg(target_os = "macos")]
    {
        match run("scutil", &["--proxy"]) {
            Ok(out) => {
                let enabled_http = out.contains("HTTPEnable : 1");
                let enabled_https = out.contains("HTTPSEnable : 1");
                let enabled_socks = out.contains("SOCKSEnable : 1");
                if !(enabled_http || enabled_https || enabled_socks) {
                    return item
                        .observed("未启用", Verdict::Normal)
                        .with_detail("系统层未配置 HTTP/HTTPS/SOCKS 代理");
                }
                let mut parts = Vec::new();
                if enabled_http {
                    parts.push(format!("HTTP {}", scutil_endpoint(&out, "HTTPProxy", "HTTPPort")));
                }
                if enabled_https {
                    parts.push(format!("HTTPS {}", scutil_endpoint(&out, "HTTPSProxy", "HTTPSPort")));
                }
                if enabled_socks {
                    parts.push(format!("SOCKS {}", scutil_endpoint(&out, "SOCKSProxy", "SOCKSPort")));
                }
                item.observed(parts.join("；"), Verdict::Normal)
                    .with_detail("已启用系统代理。若排查的是「某些站点连不上」，先确认它是否在绕过列表内")
            }
            Err(e) => item.failed(FailureKind::Other, e),
        }
    }

    #[cfg(target_os = "windows")]
    {
        // 读注册表而不是调用 WinINet API：不需要额外依赖，输出也易于解释
        match run(
            "reg",
            &[
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                "/v",
                "ProxyEnable",
            ],
        ) {
            Ok(out) => {
                let enabled = out.split_whitespace().last().map(|v| v.ends_with('1')).unwrap_or(false);
                if !enabled {
                    return item
                        .observed("未启用", Verdict::Normal)
                        .with_detail("注册表 ProxyEnable=0");
                }
                let server = run(
                    "reg",
                    &[
                        "query",
                        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                        "/v",
                        "ProxyServer",
                    ],
                )
                .ok()
                .and_then(|o| o.split_whitespace().last().map(|s| s.to_string()))
                .unwrap_or_else(|| "（读取失败）".into());
                item.observed(redact_proxy_url(&server), Verdict::Normal)
                    .with_detail("已启用系统代理")
            }
            Err(e) => item.failed(FailureKind::Other, e),
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux 没有统一的系统代理概念：桌面环境各自为政，命令行程序主要看环境变量。
        // 与其猜一个不准的答案，不如明说读不到 —— 环境变量代理在下面单独列。
        item.unsupported(
            "Linux 没有统一的系统级代理设置（GNOME/KDE 各自存储，命令行程序通常只看环境变量）。请参考下方「环境变量代理」",
        )
    }
}

#[cfg(target_os = "macos")]
fn scutil_endpoint(out: &str, host_key: &str, port_key: &str) -> String {
    let host = grep_value(out, &format!("{} :", host_key)).unwrap_or_default();
    let port = grep_value(out, &format!("{} :", port_key)).unwrap_or_default();
    if host.is_empty() {
        return "（未读取到地址）".into();
    }
    let joined = if port.is_empty() {
        host
    } else {
        format!("{}:{}", host, port)
    };
    redact_proxy_url(&joined)
}

/// 开发环境常用的代理环境变量。
///
/// 这些才是 npm / cargo / git / curl 真正会读的东西，与系统代理经常不一致 ——
/// "浏览器能开但 npm 装不上"多半就是这里。
fn env_proxies() -> Vec<DiagnosticItem> {
    const VARS: [&str; 8] = [
        "HTTP_PROXY", "http_proxy",
        "HTTPS_PROXY", "https_proxy",
        "ALL_PROXY", "all_proxy",
        "NO_PROXY", "no_proxy",
    ];

    let mut found: Vec<(String, String)> = Vec::new();
    for v in VARS {
        if let Ok(val) = std::env::var(v) {
            if !val.trim().is_empty() {
                found.push((v.to_string(), val));
            }
        }
    }

    let item = DiagnosticItem::new("local.env_proxy", "环境变量代理", "进程环境变量");
    if found.is_empty() {
        return vec![item
            .observed("未设置", Verdict::Normal)
            .with_detail("未设置 HTTP_PROXY / HTTPS_PROXY / ALL_PROXY / NO_PROXY")];
    }

    let rendered = found
        .iter()
        .map(|(k, v)| {
            // NO_PROXY 是域名列表，不含凭据，原样展示更有用
            if k.eq_ignore_ascii_case("no_proxy") {
                format!("{}={}", k, v)
            } else {
                format!("{}={}", k, redact_proxy_url(v))
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    vec![item
        .observed(rendered, Verdict::Normal)
        .with_detail("凭据已脱敏。注意这些变量只影响读取它们的程序，与系统代理可能不一致")]
}

/// 系统配置的 DNS 服务器。
fn system_dns() -> DiagnosticItem {
    let item = DiagnosticItem::new("local.dns", "系统 DNS", "操作系统 DNS 配置");

    #[cfg(target_os = "macos")]
    let servers = run("scutil", &["--dns"]).map(|out| {
        let mut v: Vec<String> = out
            .lines()
            .filter_map(|l| l.trim().strip_prefix("nameserver[").map(|s| s.to_string()))
            .filter_map(|s| s.split(':').nth(1).map(|x| x.trim().to_string()))
            .collect();
        v.dedup();
        v
    });

    #[cfg(target_os = "linux")]
    let servers = std::fs::read_to_string("/etc/resolv.conf")
        .map_err(|e| format!("读取 /etc/resolv.conf 失败: {}", e))
        .map(|out| {
            out.lines()
                .filter_map(|l| l.trim().strip_prefix("nameserver "))
                .map(|s| s.trim().to_string())
                .collect::<Vec<_>>()
        });

    #[cfg(target_os = "windows")]
    let servers = run("powershell", &["-NoProfile", "-Command",
        "Get-DnsClientServerAddress -AddressFamily IPv4 | Select-Object -ExpandProperty ServerAddresses"])
        .map(|out| {
            out.lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect::<Vec<_>>()
        });

    match servers {
        Ok(list) if !list.is_empty() => {
            let n = list.len();
            item.observed(list.join(", "), Verdict::Normal).with_detail(format!(
                "共 {} 个解析器。本地模式只能看到「配置了谁」，无法确认查询实际走了哪条递归路径 —— 那需要自有权威 DNS 探针",
                n
            ))
        }
        Ok(_) => item.failed(FailureKind::Other, "未读取到任何 DNS 服务器配置"),
        Err(e) => item.failed(FailureKind::Other, e),
    }
}

/// 解析一个域名并计时，用于验证 DNS 是否真的可用。
pub fn resolve_timed(host: &str, timeout: Duration) -> DiagnosticItem {
    use std::net::ToSocketAddrs;
    let item = DiagnosticItem::new(
        &format!("dns.{}", host),
        &format!("解析 {}", host),
        "系统解析器",
    );

    let started = Instant::now();
    // std 的解析没有超时参数，放到线程里配合 recv_timeout 兜底，
    // 否则一个卡住的 DNS 会让整个诊断挂住。
    let (tx, rx) = std::sync::mpsc::channel();
    let target = format!("{}:443", host);
    std::thread::spawn(move || {
        let r = target.to_socket_addrs().map(|it| {
            it.map(|a| a.ip().to_string()).collect::<Vec<_>>()
        });
        let _ = tx.send(r.map_err(|e| e.to_string()));
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(ips)) if !ips.is_empty() => {
            let ms = started.elapsed().as_millis();
            let slow = ms > 800;
            item.observed(
                format!("{}（{} ms）", ips.join(", "), ms),
                if slow { Verdict::Warning } else { Verdict::Normal },
            )
            .with_detail(if slow {
                "解析耗时偏高，可能是 DNS 服务器响应慢或链路质量差"
            } else {
                "解析正常"
            })
        }
        Ok(Ok(_)) => item.failed(FailureKind::DnsFailure, "解析成功但没有返回任何地址"),
        Ok(Err(e)) => item.failed(FailureKind::DnsFailure, format!("解析失败: {}", e)),
        Err(_) => item.failed(
            FailureKind::Timeout,
            format!("解析超时（>{} ms）", timeout.as_millis()),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::toolbox::netdiag::types::EvidenceStatus;

    /// 本机采集必须在任何平台都能跑完且不 panic，
    /// 而且**每一项都要有明确状态** —— 不能有 NotChecked 漏网。
    #[test]
    fn collect_returns_explicit_status_for_every_item() {
        let d = collect();
        assert!(!d.items.is_empty());
        for it in &d.items {
            assert_ne!(
                it.evidence,
                EvidenceStatus::NotChecked,
                "{} 采集后仍是 NotChecked",
                it.id
            );
            // 核心不变式：非新鲜证据不能显示成正常
            if it.evidence != EvidenceStatus::Observed && it.evidence != EvidenceStatus::NoHit {
                assert_eq!(it.verdict, Verdict::Unknown, "{} 状态与结论不一致", it.id);
                assert!(it.value.is_none(), "{} 没观测到却带了 value", it.id);
            }
        }
    }

    /// 环境变量里的代理凭据不能出现在结果里。
    #[test]
    fn env_proxy_credentials_are_redacted() {
        std::env::set_var("HTTPS_PROXY", "http://alice:supersecret@127.0.0.1:7890");
        let items = env_proxies();
        std::env::remove_var("HTTPS_PROXY");

        let rendered = items[0].value.clone().unwrap_or_default();
        assert!(rendered.contains("7890"), "应保留主机端口: {rendered}");
        assert!(
            !rendered.contains("supersecret"),
            "凭据泄露: {rendered}"
        );
    }

    /// 解析失败必须报成失败，不能显示为正常。
    ///
    /// 这里用**语法非法**的域名（单个标签超过 63 字节，DNS 规范上限），
    /// 解析器在本地就会拒绝。不能用 `xxx.invalid` 这类"应该不存在"的域名 ——
    /// 开发机上常见的 Clash / Surge 类工具会劫持 NXDOMAIN 并返回
    /// `198.18.0.x` 的 fake-IP，用它做断言的测试会随网络环境时红时绿。
    #[test]
    fn dns_resolution_failure_is_never_normal() {
        let too_long = format!("{}.invalid", "a".repeat(70));
        let item = resolve_timed(&too_long, Duration::from_secs(3));
        assert_ne!(item.verdict, Verdict::Normal, "解析失败不能显示为正常");
        assert_eq!(item.verdict, Verdict::Unknown);
        assert!(item.failure.is_some(), "应带失败分类");
        assert!(item.value.is_none(), "失败时不该有观测值");
    }
}
