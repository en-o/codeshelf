//! 开发服务连通性：DNS → TCP → TLS → HTTP 四层逐级检查。
//!
//! spec 的两条硬性边界：
//! - **默认只检测应用按当前系统与环境配置实际使用的网络路径，不自动禁用或绕过代理。**
//!   我们直接用 reqwest 的默认行为（读取环境变量代理），这样测出来的就是
//!   npm / cargo / git 会遇到的情况；
//! - 「直连与代理对比」属于需要用户明确授权的高级探针，**第一阶段不做** ——
//!   自动直连可能因 `NO_PROXY` 配错而把内网地址打出去。

use super::types::{DiagnosticItem, FailureKind, Verdict};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

/// 一个待检目标。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ServiceTarget {
    /// 展示名，如 "GitHub API"
    pub name: String,
    /// 完整 HTTPS URL
    pub url: String,
}

/// 首版内置的开发服务。
///
/// 这些是拉依赖、推代码时最常卡住的几个。用户可以再加自己的镜像源或 API 域名 ——
/// spec 明确要求「避免把固定服务列表写死」，所以前端会把内置项和自定义项合并后传进来。
pub fn default_targets() -> Vec<ServiceTarget> {
    [
        ("GitHub", "https://github.com"),
        ("GitHub API", "https://api.github.com"),
        ("npm registry", "https://registry.npmjs.org"),
        ("crates.io", "https://static.crates.io"),
        ("Maven Central", "https://repo1.maven.org"),
        ("Docker Hub", "https://registry-1.docker.io"),
    ]
    .into_iter()
    .map(|(name, url)| ServiceTarget {
        name: name.to_string(),
        url: url.to_string(),
    })
    .collect()
}

/// 单个目标的检查结果：四层各一条，便于定位卡在哪一步。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ServiceCheck {
    pub name: String,
    pub url: String,
    pub items: Vec<DiagnosticItem>,
}

/// 把 reqwest 的错误映射成 spec 要求的失败分类。
///
/// 分类的意义在于给出**下一步怎么核对**：DNS 失败查解析器、TLS 失败查证书和系统时间、
/// 代理拒绝查代理配置 —— 笼统一句「连接失败」没有任何排障价值。
fn classify(err: &reqwest::Error) -> (FailureKind, String) {
    let chain = format!("{:?}", err);
    let lower = chain.to_lowercase();

    if err.is_timeout() {
        return (FailureKind::Timeout, "请求超时".into());
    }
    // 顺序有讲究：TLS/证书判定要排在通用 connect 之前，
    // 因为证书错误也会被 is_connect() 归为连接类。
    if lower.contains("certificate") || lower.contains("tls") || lower.contains("handshake") {
        let hint = if lower.contains("expired") {
            "证书已过期，或本机系统时间不正确"
        } else if lower.contains("notvalidforname") || lower.contains("hostname") {
            "证书主机名不匹配（可能被中间设备劫持，或走了错误的代理）"
        } else if lower.contains("unknownissuer") || lower.contains("unknown issuer") {
            "证书签发者不受信任（企业代理通常需要安装其根证书）"
        } else {
            "TLS 握手失败"
        };
        return (FailureKind::TlsFailure, format!("{}：{}", hint, err));
    }
    if lower.contains("dns") || lower.contains("failed to lookup") || lower.contains("name or service not known") {
        return (
            FailureKind::DnsFailure,
            format!("域名解析失败，先检查系统 DNS：{}", err),
        );
    }
    if lower.contains("proxy") {
        return (
            FailureKind::ProxyRejected,
            format!("代理拒绝或不可用，检查代理地址与凭据：{}", err),
        );
    }
    if lower.contains("connection refused") {
        return (FailureKind::ConnectionRefused, format!("连接被拒绝：{}", err));
    }
    if err.is_connect() {
        return (FailureKind::Offline, format!("无法建立连接：{}", err));
    }
    (FailureKind::Other, err.to_string())
}

/// 检查一个目标。
pub async fn check_one(target: &ServiceTarget, timeout: Duration) -> ServiceCheck {
    let mut items = Vec::new();

    let host = reqwest::Url::parse(&target.url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()));

    let Some(host) = host else {
        items.push(
            DiagnosticItem::new("url", "目标地址", "用户配置")
                .failed(FailureKind::Other, "URL 无法解析出主机名"),
        );
        return ServiceCheck {
            name: target.name.clone(),
            url: target.url.clone(),
            items,
        };
    };

    // 第 1 层：DNS。放在阻塞线程池里，避免卡住 tokio worker。
    let dns_host = host.clone();
    let dns_item = tokio::task::spawn_blocking(move || {
        super::local::resolve_timed(&dns_host, Duration::from_secs(5))
    })
    .await
    .unwrap_or_else(|e| {
        DiagnosticItem::new("dns", "DNS 解析", "系统解析器")
            .failed(FailureKind::Other, format!("解析任务调度失败: {}", e))
    });
    let dns_ok = dns_item.evidence == super::types::EvidenceStatus::Observed;
    items.push(dns_item);

    // DNS 都不通就没必要往下走 —— 后面几层必然失败，报出来只会淹没真正的原因
    if !dns_ok {
        items.push(
            DiagnosticItem::new("tcp", "TCP 连接", "本机网络栈")
                .unsupported("DNS 未解析成功，跳过（先解决上一步）"),
        );
        items.push(
            DiagnosticItem::new("https", "HTTPS 请求", "本机网络栈")
                .unsupported("DNS 未解析成功，跳过（先解决上一步）"),
        );
        return ServiceCheck {
            name: target.name.clone(),
            url: target.url.clone(),
            items,
        };
    }

    // 第 2 层：TCP + 第 3/4 层：TLS/HTTP。
    // 用 reqwest 的默认配置：**遵循**系统与环境变量代理，测出来才是开发工具的真实体验。
    let started = Instant::now();
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .connect_timeout(timeout.min(Duration::from_secs(10)))
        .user_agent("CodeShelf-NetDiag/1.0")
        .build();

    match client {
        Err(e) => items.push(
            DiagnosticItem::new("https", "HTTPS 请求", "本机网络栈")
                .failed(FailureKind::Other, format!("创建 HTTP 客户端失败: {}", e)),
        ),
        Ok(client) => {
            // HEAD 更轻；部分服务不支持 HEAD，失败时回退 GET
            let resp = match client.head(&target.url).send().await {
                Ok(r) => Ok(r),
                Err(_) => client.get(&target.url).send().await,
            };
            let ms = started.elapsed().as_millis();
            match resp {
                Ok(r) => {
                    let status = r.status();
                    items.push(
                        DiagnosticItem::new("tcp", "TCP + TLS", "本机网络栈")
                            .observed(format!("握手成功（{} ms）", ms), Verdict::Normal)
                            .with_detail("连接与 TLS 握手均成功"),
                    );
                    // 4xx/5xx 也算「网络通了」—— 是服务端的事，不是网络问题，
                    // 但要如实标成需要核对，别报绿。
                    let ok = status.is_success() || status.is_redirection();
                    items.push(
                        DiagnosticItem::new("https", "HTTPS 请求", "目标服务")
                            .observed(
                                format!("HTTP {}（{} ms）", status.as_u16(), ms),
                                if ok { Verdict::Normal } else { Verdict::Warning },
                            )
                            .with_detail(if ok {
                                "服务可达".to_string()
                            } else {
                                format!("网络可达，但服务返回 {}，属于服务端状态而非网络故障", status)
                            }),
                    );
                }
                Err(e) => {
                    let (kind, detail) = classify(&e);
                    // TLS 失败时 TCP 其实是通的，分开表达才有排障价值
                    if kind == FailureKind::TlsFailure {
                        items.push(
                            DiagnosticItem::new("tcp", "TCP 连接", "本机网络栈")
                                .observed("已建立", Verdict::Normal)
                                .with_detail("TCP 可达，问题出在 TLS 层"),
                        );
                    } else {
                        items.push(
                            DiagnosticItem::new("tcp", "TCP + TLS", "本机网络栈")
                                .failed(kind, detail.clone()),
                        );
                    }
                    items.push(
                        DiagnosticItem::new("https", "HTTPS 请求", "目标服务").failed(kind, detail),
                    );
                }
            }
        }
    }

    ServiceCheck {
        name: target.name.clone(),
        url: target.url.clone(),
        items,
    }
}

/// 并发检查多个目标。
pub async fn check_all(targets: Vec<ServiceTarget>, timeout: Duration) -> Vec<ServiceCheck> {
    let futures: Vec<_> = targets
        .iter()
        .map(|t| check_one(t, timeout))
        .collect();
    futures::future::join_all(futures).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_targets_are_all_https() {
        let t = default_targets();
        assert!(!t.is_empty());
        for x in &t {
            // 只允许 HTTPS：明文 HTTP 的检测结果会被中间设备任意篡改，没有诊断价值
            assert!(x.url.starts_with("https://"), "{} 不是 HTTPS: {}", x.name, x.url);
        }
    }

    /// DNS 失败必须**跳过**后续层，而不是把 TCP/HTTPS 也报成失败把真正的原因淹没。
    ///
    /// 用语法非法的超长标签而不是 `xxx.invalid`：开发机上的 Clash / Surge 类工具
    /// 会劫持 NXDOMAIN 返回 fake-IP，后者会让这个测试随网络环境飘。
    #[tokio::test]
    async fn dns_failure_short_circuits_later_layers() {
        let t = ServiceTarget {
            name: "不存在".into(),
            url: format!("https://{}.invalid", "a".repeat(70)),
        };
        let r = check_one(&t, Duration::from_secs(5)).await;
        assert_eq!(r.items.len(), 3);
        assert_eq!(r.items[0].failure, Some(FailureKind::DnsFailure));
        // 后两层是「跳过」，不是「失败」
        assert_eq!(r.items[1].evidence, super::super::types::EvidenceStatus::Unsupported);
        assert_eq!(r.items[2].evidence, super::super::types::EvidenceStatus::Unsupported);
        // 而且都不能是 Normal
        for it in &r.items {
            assert_ne!(it.verdict, Verdict::Normal, "{} 不该显示为正常", it.id);
        }
    }

    /// URL 解析不出主机名时不能 panic。
    #[tokio::test]
    async fn malformed_url_is_reported_not_panicking() {
        let t = ServiceTarget {
            name: "坏地址".into(),
            url: "not a url".into(),
        };
        let r = check_one(&t, Duration::from_secs(2)).await;
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].verdict, Verdict::Unknown);
    }
}
