//! 出口观测与一致性核对 —— 「外面看到的你是谁」。
//!
//! 这是整个工具真正的价值所在。本机诊断回答的是「我这边怎么配的」，
//! 而排查代理/VPN 时真正要问的是：**外部服务现在看到的网络身份是什么，
//! 它和我本机的配置对得上吗？**
//!
//! ## 为什么 CodeShelf 能比浏览器做得更准
//!
//! 参考项目 DetectRadar 在 `client/src/lib/collectors/leaks/ipv6.ts` 里写道：
//! > 纯前端无法主动向外发起 IPv6 探测（跨域受限），WebRTC 候选是浏览器内
//! > 可靠且无需授权的 IPv6 暴露信号来源。
//!
//! 所以它只能从 WebRTC 候选**推断** IPv6 —— 浏览器屏蔽候选就测不到，
//! 测到了也不代表它真的绕过代理。这是 spec 列的高优先级缺陷第 5 条。
//!
//! CodeShelf 的 Rust 层没有跨域限制，可以**分别**向 IPv4-only 和 IPv6-only
//! 端点发真实请求，直接读回对方看到的源地址。这是真验证，不是推断。
//!
//! ## 隐私
//!
//! 这些请求会把用户公网 IP 暴露给端点方。因此：
//! - 只用 Cloudflare 的 `cdn-cgi/trace` 和 icanhazip 两个**无密钥回显**端点，
//!   不接商业 IP 情报服务；
//! - 必须由用户主动触发，界面在点击前列出会访问哪些域名（见 [`EGRESS_ENDPOINTS`]）；
//! - 结果里的完整 IP 在导出时默认脱敏（`redact::redact_report_text`）。

use super::types::{DiagnosticItem, FailureKind, Verdict};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// 会被访问的端点清单，供界面在用户点击**之前**逐项披露。
///
/// spec：「使用 IP 情报……查询时，第三方会收到用户公网 IP……
/// 开始前必须逐项披露数据接收方和用途，不能只笼统提示『需要联网』。」
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EgressEndpointDisclosure {
    pub host: String,
    pub purpose: String,
    pub operator: String,
}

pub fn endpoint_disclosures() -> Vec<EgressEndpointDisclosure> {
    vec![
        EgressEndpointDisclosure {
            host: "1.1.1.1".into(),
            purpose: "读取本次连接的出口 IPv4 与接入机房（回显，不做归属查询）".into(),
            operator: "Cloudflare".into(),
        },
        EgressEndpointDisclosure {
            host: "ipv6.icanhazip.com".into(),
            purpose: "单独走 IPv6 读取出口 IPv6，用于真实验证双栈出口".into(),
            operator: "Cloudflare".into(),
        },
    ]
}

const TRACE_V4: &str = "https://1.1.1.1/cdn-cgi/trace";
const ECHO_V6: &str = "https://ipv6.icanhazip.com";

/// 出口观测原始结果，供一致性核对使用。
#[derive(Debug, Clone, Default)]
struct Egress {
    ipv4: Option<String>,
    ipv6: Option<String>,
    /// Cloudflare 接入机房代码（如 SIN / HKG），粗略反映出口地理位置
    colo: Option<String>,
    /// 出口所在国家（trace 的 `loc` 字段，ISO 3166-1 alpha-2）
    loc: Option<String>,
    /// 是否正在走 Cloudflare WARP
    warp: bool,
}

/// 国家码 → 中文名。只收常见的；查不到就原样显示代码，不猜。
fn country_name(code: &str) -> &str {
    match code {
        "CN" => "中国大陆", "HK" => "中国香港", "TW" => "中国台湾", "MO" => "中国澳门",
        "SG" => "新加坡", "JP" => "日本", "KR" => "韩国", "US" => "美国",
        "DE" => "德国", "GB" => "英国", "FR" => "法国", "NL" => "荷兰",
        "CA" => "加拿大", "AU" => "澳大利亚", "RU" => "俄罗斯", "IN" => "印度",
        "MY" => "马来西亚", "TH" => "泰国", "VN" => "越南", "ID" => "印尼",
        "TR" => "土耳其", "BR" => "巴西", "AE" => "阿联酋", "PH" => "菲律宾",
        other => other,
    }
}

/// IPv6 探测的三种结果。把它们分开是**必须**的 —— 合并成一个 bool 就会
/// 重蹈「测不到即正常」的覆辙。
enum Ipv6Probe {
    /// 确实拿到了出口 IPv6
    Egress(String),
    /// 主机有 AAAA 记录，但通过 IPv6 连不通 —— 说明本机没有可用的 IPv6 出口
    NoEgress,
    /// 连 AAAA 都解析不到，这个探测方法在当前环境不适用（不是「没有 IPv6」）
    Inconclusive(String),
}

/// 按协议族解析主机名。
///
/// **不能只靠 `local_address` 绑定源地址** —— 那不影响解析。
/// 解析器返回 IPv4 而 socket 绑在 IPv6 上时，连接会因协议族不匹配失败，
/// 结果被误读成「没有 IPv6 出口」。本机就踩到了这个坑：
/// Clash 的 fake-IP DNS 对同一主机同时给出 A（198.18.x.x）和 AAAA（fdfe:...），
/// reqwest 取了 A，于是 IPv6 探测必然失败。
///
/// 正确做法是自己解析、按协议族过滤，再把结果**钉死**给 HTTP 客户端。
fn resolve_family(host: &str, port: u16, want_v6: bool) -> Result<Vec<std::net::SocketAddr>, String> {
    use std::net::ToSocketAddrs;
    let addrs: Vec<_> = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("解析 {} 失败: {}", host, e))?
        .filter(|a| a.is_ipv6() == want_v6)
        .collect();
    if addrs.is_empty() {
        return Err(format!(
            "{} 没有 {} 记录",
            host,
            if want_v6 { "AAAA" } else { "A" }
        ));
    }
    Ok(addrs)
}

/// trace 的解析结果
struct Trace {
    ip: String,
    colo: Option<String>,
    loc: Option<String>,
    warp: bool,
}

async fn fetch_trace(timeout: Duration) -> Result<Trace, String> {
    // 1.1.1.1 是 IP 字面量，不涉及解析，直接请求即可
    let c = reqwest::Client::builder()
        .timeout(timeout)
        .user_agent("CodeShelf-NetDiag/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let text = c
        .get(TRACE_V4)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    // trace 是 `key=value` 逐行文本
    let mut ip = None;
    let mut colo = None;
    let mut loc = None;
    let mut warp = false;
    for line in text.lines() {
        if let Some(v) = line.strip_prefix("ip=") {
            ip = Some(v.trim().to_string());
        } else if let Some(v) = line.strip_prefix("colo=") {
            colo = Some(v.trim().to_string());
        } else if let Some(v) = line.strip_prefix("loc=") {
            let v = v.trim();
            if !v.is_empty() && v != "XX" {
                loc = Some(v.to_string());
            }
        } else if let Some(v) = line.strip_prefix("warp=") {
            warp = v.trim() == "on";
        }
    }
    ip.map(|ip| Trace { ip, colo, loc, warp })
        .ok_or_else(|| "响应里没有 ip 字段".to_string())
}

async fn probe_ipv6(timeout: Duration) -> Ipv6Probe {
    const HOST: &str = "ipv6.icanhazip.com";

    // 先解析出 AAAA。解析不到 = 方法不适用，不能推断成「没有 IPv6」
    let addrs = match resolve_family(HOST, 443, true) {
        Ok(a) => a,
        Err(e) => return Ipv6Probe::Inconclusive(e),
    };

    // 把解析结果钉死给客户端，绕开 Happy Eyeballs 选到 IPv4
    let c = match reqwest::Client::builder()
        .timeout(timeout)
        .user_agent("CodeShelf-NetDiag/1.0")
        .resolve_to_addrs(HOST, &addrs)
        .build()
    {
        Ok(c) => c,
        Err(e) => return Ipv6Probe::Inconclusive(e.to_string()),
    };

    match c.get(ECHO_V6).send().await {
        Ok(r) => match r.text().await {
            Ok(t) if t.trim().parse::<std::net::Ipv6Addr>().is_ok() => {
                Ipv6Probe::Egress(t.trim().to_string())
            }
            Ok(t) => Ipv6Probe::Inconclusive(format!("响应不是合法 IPv6: {}", t.trim())),
            Err(e) => Ipv6Probe::Inconclusive(e.to_string()),
        },
        // 解析出了 AAAA 却连不通 —— 这才是「没有可用 IPv6 出口」的证据
        Err(_) => Ipv6Probe::NoEgress,
    }
}

/// 出口观测 + 一致性核对。
///
/// `local_items` 是本机诊断的结果，用来做**交叉核对** —— 单独看出口 IP 价值有限，
/// 「本机说 A、外面看到 B」这种矛盾才是排障线索。
pub async fn observe(
    local_items: &[DiagnosticItem],
    timeout: Duration,
) -> (Vec<DiagnosticItem>, NetworkSituation) {
    let mut out = Vec::new();
    let mut eg = Egress::default();

    // --- 出口 IPv4 ---
    let item = DiagnosticItem::new("egress.ipv4", "公网出口 IPv4", "Cloudflare cdn-cgi/trace");
    match fetch_trace(timeout).await {
        Ok(t) => {
            eg.ipv4 = Some(t.ip.clone());
            eg.colo = t.colo.clone();
            eg.loc = t.loc.clone();
            eg.warp = t.warp;
            out.push(
                item.observed(t.ip.clone(), Verdict::Normal)
                    .with_detail("外部服务实际看到的源地址"),
            );

            // 归属地：trace 的 loc 字段直接给国家码，不需要商业 IP 情报库
            let geo = DiagnosticItem::new("egress.geo", "出口归属地", "Cloudflare cdn-cgi/trace");
            out.push(match (&t.loc, &t.colo) {
                (Some(loc), colo) => geo
                    .observed(
                        match colo {
                            Some(c) => format!("{}（{}）· 接入机房 {}", country_name(loc), loc, c),
                            None => format!("{}（{}）", country_name(loc), loc),
                        },
                        Verdict::Normal,
                    )
                    .with_detail(
                        "Cloudflare 按本次连接判定的国家，非商业 IP 情报库查询。\
                         想要 ASN / 运营商 / 住宅或机房类型需要接入 IP 情报服务，本版未接",
                    ),
                (None, _) => geo.unsupported("trace 未返回国家码"),
            });

            if t.warp {
                out.push(
                    DiagnosticItem::new("egress.warp", "Cloudflare WARP", "Cloudflare cdn-cgi/trace")
                        .observed("已启用", Verdict::Warning)
                        .with_detail("检测到本次连接经由 Cloudflare WARP，出口由 WARP 决定"),
                );
            }
        }
        Err(e) => out.push(item.failed(FailureKind::Offline, format!("无法获取出口 IPv4：{}", e))),
    }

    // --- 出口 IPv6（钉死 AAAA 后真实请求，而不是 WebRTC 推断）---
    let item = DiagnosticItem::new("egress.ipv6", "公网出口 IPv6", "ipv6.icanhazip.com");
    match probe_ipv6(timeout).await {
        Ipv6Probe::Egress(ip) => {
            eg.ipv6 = Some(ip.clone());
            out.push(
                item.observed(ip, Verdict::Normal)
                    .with_detail("强制通过 IPv6 发起请求得到的真实出口地址（不是从 WebRTC 候选推断）"),
            );
        }
        Ipv6Probe::NoEgress => out.push(
            item.observed("无 IPv6 出口", Verdict::Normal).with_detail(
                "目标主机有 AAAA 记录，但通过 IPv6 连不通 —— 本机当前没有可用的 IPv6 出口路径",
            ),
        ),
        // 关键：解析不到 AAAA 只说明这个探测方法用不了，**不能**推断成「没有 IPv6」。
        // 之前正是把这种情况报成了 Normal + 「这是明确结论」，属于测不到即正常。
        Ipv6Probe::Inconclusive(why) => out.push(item.unsupported(format!(
            "无法判定 IPv6 出口：{}。常见于 fake-IP 模式的代理工具改写了 DNS 结果；\
             这不代表你没有 IPv6",
            why
        ))),
    }

    out.extend(cross_checks(local_items, &eg));
    let situation = describe_situation(local_items, &eg);
    (out, situation)
}


/// 当前网络环境的**画像**：一句话说清「我现在处在什么网络环境、这意味着什么」。
///
/// 这是整个工具最该给出的东西。列一堆检测项只回答了「测了什么」，
/// 用户真正要的是「我这会儿的网络是什么状态，会影响到什么」。
/// 参考项目那句「存在公网地址不一致或环境特征被标记的风险」就是这个角色，
/// 但它偏风险判定；开发场景更需要的是**处境描述 + 具体影响**。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSituation {
    /// 一句话画像，例如「流量经代理从新加坡出网」
    pub summary: String,
    /// 逐条影响：这个环境下会发生什么。每条都要能直接对应到用户的实际动作。
    pub implications: Vec<String>,
}

/// 由本机观测 + 出口观测推导画像。
fn describe_situation(local_items: &[DiagnosticItem], eg: &Egress) -> NetworkSituation {
    let find = |id: &str| local_items.iter().find(|i| i.id == id);
    let tun = find("local.ipv4")
        .and_then(|i| i.detail.as_deref())
        .map(|d| d.contains("fake-IP"))
        .unwrap_or(false);
    let proxy_on = find("local.system_proxy")
        .and_then(|i| i.value.as_deref())
        .map(|v| v != "未启用")
        .unwrap_or(false);

    // ── 一句话画像 ──
    let where_ = match (&eg.ipv4, &eg.loc) {
        (Some(_), Some(l)) => format!("从{}出网", country_name(l)),
        (Some(_), None) => "已连通公网".to_string(),
        (None, _) => "公网出口未确认".to_string(),
    };
    let how = if eg.warp {
        "经 Cloudflare WARP"
    } else if tun {
        "经代理工具 TUN 接管"
    } else if proxy_on {
        "经系统代理"
    } else {
        "直连"
    };
    let summary = if eg.ipv4.is_some() {
        format!("流量{}{}", how, where_)
    } else {
        format!("{}（{}）", where_, how)
    };

    // ── 逐条影响 ──
    let mut implications = Vec::new();

    if tun {
        implications.push(
            "本机看到的 IP 是代理工具的 fake-IP，不是真实网卡地址 —— \
             用 ifconfig / 系统设置查到的地址不能代表你的实际出口"
                .to_string(),
        );
    }

    // DNS 与出口分属不同地区：对开发者最实际的影响是「解析结果可能不是你以为的那个」
    if let (Some(dns), Some(loc)) = (find("local.dns").and_then(|i| i.value.as_deref()), &eg.loc) {
        if dns_region_hint(dns, eg.colo.as_deref().unwrap_or("")).is_some() {
            implications.push(format!(
                "域名解析走国内 DNS（{}），实际连接却从{}出去 —— \
                 拉取镜像 / 访问 CDN 时可能被解析到离出口很远的节点，表现为「能连上但很慢」",
                dns,
                country_name(loc)
            ));
        }
    }

    match (&eg.ipv4, &eg.ipv6) {
        (Some(_), Some(_)) => implications.push(
            "IPv4 与 IPv6 都能独立出网。只为 IPv4 配代理时，支持 IPv6 的服务会绕开代理直连"
                .to_string(),
        ),
        (Some(_), None) => {
            implications.push("只有 IPv4 出口，不存在 IPv6 绕过代理的情况".to_string())
        }
        _ => {}
    }

    if implications.is_empty() {
        implications.push("未发现本机配置与实际出口之间的矛盾".to_string());
    }

    NetworkSituation {
        summary,
        implications,
    }
}

/// 一致性核对：本机配置 vs 外部观测。**矛盾才是价值。**
fn cross_checks(local_items: &[DiagnosticItem], eg: &Egress) -> Vec<DiagnosticItem> {
    let mut out = Vec::new();
    let find = |id: &str| local_items.iter().find(|i| i.id == id);

    // --- 1. 代理是否真的改变了出口 ---
    let item = DiagnosticItem::new("cross.proxy_effective", "代理是否生效", "本机配置 × 出口观测");
    let proxy_on = find("local.system_proxy")
        .and_then(|i| i.value.as_deref())
        .map(|v| v != "未启用")
        .unwrap_or(false)
        || find("local.ipv4")
            .and_then(|i| i.detail.as_deref())
            .map(|d| d.contains("fake-IP"))
            .unwrap_or(false);

    let local_side = find("local.system_proxy")
        .and_then(|i| i.value.clone())
        .unwrap_or_else(|| "—".into());
    out.push(match (&eg.ipv4, proxy_on) {
        (Some(ip), true) => item
            .observed("已生效", Verdict::Normal)
            .with_comparison(
                "本机代理",
                local_side,
                "实际出口",
                match &eg.loc {
                    Some(l) => format!("{} {}", ip, country_name(l)),
                    None => ip.clone(),
                },
                true,
            )
            .with_detail("若出口位置不是你预期的节点，说明分流规则没把流量导向那里"),
        (Some(ip), false) => item
            .observed("直连", Verdict::Normal)
            .with_comparison("本机代理", "未启用", "实际出口", ip.clone(), true),
        (None, _) => item.failed(FailureKind::Offline, "未取到出口 IP，无法判断代理是否生效"),
    });

    // --- 2. 双栈出口是否一致 ---
    // 这是 CodeShelf 相对浏览器方案的核心优势：真实验证，不是 WebRTC 推断。
    let item = DiagnosticItem::new("cross.dual_stack", "双栈出口一致性", "IPv4 × IPv6 出口观测");
    out.push(match (&eg.ipv4, &eg.ipv6) {
        (Some(v4), Some(v6)) => item
            .observed("双栈并存", Verdict::Warning)
            .with_comparison("IPv4 出口", v4.clone(), "IPv6 出口", v6.clone(), false)
            .with_evidence(format!("IPv6 可独立出网（{}）", v6))
            .with_detail(
                "两条出口都存在。只为 IPv4 配代理时 IPv6 会绕过它 —— \
                 核对代理是否同时接管 IPv6，或在系统层关闭 IPv6",
            ),
        (Some(v4), None) => item
            .observed("仅 IPv4", Verdict::Normal)
            .with_comparison("IPv4 出口", v4.clone(), "IPv6 出口", "无", true)
            .with_detail("没有 IPv6 出口，不存在 IPv6 绕过代理的风险"),
        (None, Some(v6)) => item
            .observed("仅 IPv6", Verdict::Warning)
            .with_comparison("IPv4 出口", "无", "IPv6 出口", v6.clone(), false)
            .with_detail("只有 IPv6 出口而 IPv4 不可用，这不常见，建议核对网络配置"),
        // 两族都没拿到：可能真的离线，也可能两次探测都不适用。
        // 无论哪种都只能是 unknown，不能替用户下结论。
        (None, None) => item.failed(
            FailureKind::Offline,
            "两个协议族都没取到出口地址，无法判断双栈状态",
        ),
    });

    // --- 3. DNS 解析器与出口是否在同一地区 ---
    // DetectRadar 那份实现被 spec 点名「文案与算法不一致」（阻断级问题 1）：
    // 它并没有真的比较解析器国家与出口国家。这里做一个**克制**的版本 ——
    // 只在能明确判断时提示，且措辞只描述观测事实，不写"DNS 已泄露"。
    if let (Some(dns), Some(colo)) = (
        find("local.dns").and_then(|i| i.value.as_deref()),
        eg.colo.as_deref(),
    ) {
        let item = DiagnosticItem::new("cross.dns_region", "DNS 与出口地区", "系统 DNS × 出口机房");
        let right = match &eg.loc {
            Some(l) => format!("{}（{}）", country_name(l), colo),
            None => colo.to_string(),
        };
        match dns_region_hint(dns, colo) {
            Some(note) => out.push(
                item.observed("地区不一致", Verdict::Warning)
                    .with_comparison("系统 DNS", dns.to_string(), "出口地区", right.clone(), false)
                    .with_evidence(format!("解析器在中国大陆，出口在 {}", right))
                    .with_detail(note),
            ),
            None => out.push(
                item.observed("未见矛盾", Verdict::Normal)
                    .with_comparison("系统 DNS", dns.to_string(), "出口地区", right, true)
                    .with_detail(
                        "未发现明显的地区矛盾。注意这只比较了「配置了哪个解析器」与「出口机房」，\
                         无法确认查询实际走了哪条递归路径 —— 那需要自有权威 DNS 探针",
                    ),
            ),
        }
    }

    out
}

/// 已知的地区性公共 DNS。用于提示「解析器所在地区与出口机房明显不同」。
///
/// 只收录归属明确的少数几个，且**只提示不下结论** —— 用户完全可能有意这么配。
/// 宁可漏报也不误报：让人去查一个不存在的问题，比不提示更糟。
fn dns_region_hint(dns_value: &str, colo: &str) -> Option<&'static str> {
    const CN_DNS: [&str; 6] = [
        "114.114.114.114", "114.114.115.115",
        "223.5.5.5", "223.6.6.6",   // 阿里
        "119.29.29.29", "180.76.76.76", // DNSPod / 百度
    ];
    // Cloudflare 中国大陆没有接入机房，出现这些代码基本可判定出口在境外
    const NON_CN_COLO: [&str; 12] = [
        "SIN", "HKG", "NRT", "KIX", "ICN", "LAX", "SJC", "SEA", "FRA", "AMS", "LHR", "CDG",
    ];

    let has_cn_dns = CN_DNS.iter().any(|d| dns_value.contains(d));
    let colo_outside_cn = NON_CN_COLO.contains(&colo);

    if has_cn_dns && colo_outside_cn {
        return Some(
            "系统配置的是中国大陆公共 DNS，而出口机房在境外。\
             这说明域名解析和实际连接很可能走了不同的路径 —— \
             常见于代理只接管了 TCP 流量、DNS 仍走本地解析器的配置。\
             这是观测到的事实，不一定是问题（有人有意如此），但值得核对",
        );
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, value: &str, detail: &str) -> DiagnosticItem {
        DiagnosticItem::new(id, id, "test")
            .observed(value, Verdict::Normal)
            .with_detail(detail)
    }

    /// 双栈同时存在时必须提示 —— 这是「IPv6 绕过只代理 IPv4 的隧道」这个
    /// 经典泄露场景，也是本模块相对 WebRTC 推断方案的核心价值。
    #[test]
    fn dual_stack_present_is_flagged() {
        let eg = Egress {
            ipv4: Some("1.2.3.4".into()),
            ipv6: Some("2a12::1".into()),
            colo: None,
            loc: None,
            warp: false,
        };
        let out = cross_checks(&[], &eg);
        let ds = out.iter().find(|i| i.id == "cross.dual_stack").unwrap();
        assert_eq!(ds.verdict, Verdict::Warning, "双栈并存应提示核对");
        assert!(ds.detail.as_ref().unwrap().contains("绕过"));
    }

    /// 只有 IPv4 时不该制造焦虑。
    #[test]
    fn ipv4_only_is_normal() {
        let eg = Egress {
            ipv4: Some("1.2.3.4".into()),
            ipv6: None,
            colo: None,
            loc: None,
            warp: false,
        };
        let out = cross_checks(&[], &eg);
        let ds = out.iter().find(|i| i.id == "cross.dual_stack").unwrap();
        assert_eq!(ds.verdict, Verdict::Normal);
    }

    /// 出口取不到时，交叉核对必须是 unknown，不能装作有结论。
    #[test]
    fn missing_egress_never_yields_a_verdict() {
        let out = cross_checks(&[], &Egress::default());
        for i in &out {
            assert_eq!(i.verdict, Verdict::Unknown, "{} 无证据却给了结论", i.id);
        }
    }

    /// DNS 地区提示：只在**确实矛盾**时出现，且不能误报。
    #[test]
    fn dns_region_hint_only_fires_on_real_mismatch() {
        // 中国 DNS + 境外机房 = 提示
        assert!(dns_region_hint("114.114.114.114", "SIN").is_some());
        assert!(dns_region_hint("223.5.5.5", "HKG").is_some());

        // 境外 DNS + 境外机房 = 不提示（正常的一致配置）
        assert!(dns_region_hint("1.1.1.1", "SIN").is_none());
        assert!(dns_region_hint("8.8.8.8", "LAX").is_none());
        // 中国 DNS + 未知机房代码 = 不提示，宁可漏报也不误报
        assert!(dns_region_hint("114.114.114.114", "XYZ").is_none());
    }

    /// 交叉核对要能读到本机诊断的结果，并输出**并排对照**。
    ///
    /// 断言对照结构而不是文案：文案会改，"本机配的是 A、外面看到的是 B
    /// 这两个值都得在" 才是真正的契约。
    #[test]
    fn proxy_effectiveness_produces_side_by_side() {
        let local = vec![
            item(
                "local.ipv4",
                "198.18.0.1",
                "这是代理工具 TUN 模式的 fake-IP（198.18.0.0/15）",
            ),
            item("local.system_proxy", "HTTP 127.0.0.1:7897", "已启用系统代理"),
        ];
        let eg = Egress {
            ipv4: Some("109.176.19.134".into()),
            ipv6: None,
            colo: Some("SIN".into()),
            loc: Some("SG".into()),
            warp: false,
        };
        let out = cross_checks(&local, &eg);
        let p = out.iter().find(|i| i.id == "cross.proxy_effective").unwrap();

        let c = p.comparison.as_ref().expect("代理生效项必须给出并排对照");
        assert!(c.left.contains("7897"), "左侧应是本机代理配置: {:?}", c.left);
        assert!(
            c.right.contains("109.176.19.134"),
            "右侧应是实际出口: {:?}",
            c.right
        );
        // 国家码要被翻成可读名字，而不是甩一个 SG 给用户
        assert!(c.right.contains("新加坡"), "应显示可读归属地: {:?}", c.right);
    }

    /// 双栈与 DNS 两项也必须是对照式，且 matched 要如实反映是否一致。
    #[test]
    fn dual_stack_and_dns_are_comparisons() {
        let local = vec![item("local.dns", "114.114.114.114", "共 1 个解析器")];
        let eg = Egress {
            ipv4: Some("1.2.3.4".into()),
            ipv6: Some("2a12::1".into()),
            colo: Some("SIN".into()),
            loc: Some("SG".into()),
            warp: false,
        };
        let out = cross_checks(&local, &eg);

        let ds = out.iter().find(|i| i.id == "cross.dual_stack").unwrap();
        let c = ds.comparison.as_ref().expect("双栈项必须给出对照");
        assert_eq!(c.left, "1.2.3.4");
        assert_eq!(c.right, "2a12::1");
        assert!(!c.matched, "双栈并存应标记为不一致，供界面高亮");

        let dns = out.iter().find(|i| i.id == "cross.dns_region").unwrap();
        let c = dns.comparison.as_ref().expect("DNS 项必须给出对照");
        assert_eq!(c.left, "114.114.114.114");
        assert!(c.right.contains("新加坡"), "{:?}", c.right);
        assert!(!c.matched, "中国 DNS + 境外出口应标记为不一致");
    }
}

#[cfg(test)]
mod smoke {
    use super::*;

    /// 端到端：真实观测出口、生成画像并交叉核对。`--nocapture` 可见。
    /// 只断言状态语义自洽 —— 具体结论取决于跑测试时的网络。
    #[tokio::test]
    async fn print_real_egress_and_situation() {
        let local = crate::commands::toolbox::netdiag::local::collect();
        let (out, situation) = observe(&local.items, Duration::from_secs(15)).await;

        println!("\n=== 当前网络环境 ===");
        println!("  {}", situation.summary);
        for i in &situation.implications {
            println!("  · {}", i);
        }

        println!("\n=== 逐项结论 ===");
        for it in &out {
            let cmp = it
                .comparison
                .as_ref()
                .map(|c| format!("  [{} {} ↔ {} {}]", c.left_label, c.left, c.right_label, c.right))
                .unwrap_or_default();
            println!(
                "[{:?}/{:?}] {} = {}{}",
                it.evidence,
                it.verdict,
                it.label,
                it.value.as_deref().unwrap_or("-"),
                cmp
            );
        }

        for it in &out {
            if it.evidence != super::super::types::EvidenceStatus::Observed
                && it.evidence != super::super::types::EvidenceStatus::NoHit
            {
                assert_eq!(it.verdict, Verdict::Unknown, "{} 状态不自洽", it.id);
            }
        }
        assert!(!situation.summary.is_empty(), "画像不能为空");
        assert!(!situation.implications.is_empty(), "至少要给一条影响说明");
    }
}
