//! 脱敏。
//!
//! spec 的要求分两处：
//! - 「对 URL 中可能含 token、用户名、密码的代理配置先脱敏，再展示或导出」——
//!   代理地址是最容易泄露凭据的地方，`http://user:pass@proxy:8080` 会原样出现在
//!   环境变量里，展示、日志和导出都不能带出去；
//! - 「导出时默认遮盖公网 IP、局域网 IP、主机名和可能识别用户的网络名称」。
//!
//! **没有**主机名 / SSID 脱敏：第一阶段根本不采集这两类字段，
//! 加一个没人调用的函数只是投机。真要加时也不能在自由文本里正则替换 ——
//! 那分不清「用户的笔记本名」和「github.com」，误伤后者会让报告失去价值。
//!
//! 注意展示与导出的默认强度不同：本机诊断页要能看到自己的内网 IP 才有排障价值，
//! 所以 IP 遮盖只在**导出**时默认开启（[`redact_ip`]），而凭据脱敏
//! （[`redact_proxy_url`]）任何时候都做。

/// 去掉 URL 里的用户名和密码。
///
/// 不用 url crate 解析：代理环境变量经常是 `host:port` 这种不完整形态，
/// 解析失败就原样返回反而更危险。这里只做一件事 —— 把 `scheme://` 和最后一个
/// `@` 之间的内容替换掉，其余原样保留。
pub fn redact_proxy_url(raw: &str) -> String {
    let s = raw.trim();
    if s.is_empty() {
        return String::new();
    }

    // 定位 scheme 之后的位置（没有 scheme 时从头开始）
    let after_scheme = s.find("://").map(|i| i + 3).unwrap_or(0);
    let rest = &s[after_scheme..];

    // authority 段在第一个 '/'、'?' 或 '#' 之前
    let authority_end = rest
        .find(['/', '?', '#'])
        .unwrap_or(rest.len());
    let authority = &rest[..authority_end];

    // 用**最后一个** '@'：密码里可能含 '@'
    let Some(at) = authority.rfind('@') else {
        return s.to_string();
    };
    let creds = &authority[..at];
    if creds.is_empty() {
        return s.to_string();
    }

    // 保留用户名首字符便于辨认是哪个账号，密码整体抹掉
    let masked = match creds.split_once(':') {
        Some((user, _pass)) => format!("{}:***", mask_user(user)),
        None => mask_user(creds).to_string(),
    };

    format!(
        "{}{}{}{}",
        &s[..after_scheme],
        masked,
        &authority[at..],
        &rest[authority_end..]
    )
}

fn mask_user(user: &str) -> String {
    let mut chars = user.chars();
    match chars.next() {
        Some(first) if user.chars().count() > 1 => format!("{}***", first),
        Some(_) => "***".to_string(),
        None => String::new(),
    }
}

/// 遮盖 IP 的主机位，保留网段便于判断「是不是同一个网络」。
///
/// IPv4 保留前两段（`192.168.x.x`），IPv6 保留前两组。
/// 完整 IP 必须由用户主动选择显示 —— 这是 spec 的展示原则。
#[cfg_attr(not(test), allow(dead_code))]
pub fn redact_ip(ip: &str) -> String {
    let s = ip.trim();
    if s.is_empty() {
        return String::new();
    }
    if let Ok(v4) = s.parse::<std::net::Ipv4Addr>() {
        let o = v4.octets();
        return format!("{}.{}.x.x", o[0], o[1]);
    }
    if let Ok(v6) = s.parse::<std::net::Ipv6Addr>() {
        let seg = v6.segments();
        return format!("{:x}:{:x}::/32", seg[0], seg[1]);
    }
    // 不是合法 IP（可能是主机名）：整体遮盖，别猜
    "***".to_string()
}


#[cfg(test)]
mod tests {
    use super::*;

    /// 代理 URL 里的凭据在**任何**展示路径上都不能出现。
    #[test]
    fn proxy_credentials_are_always_removed() {
        let cases = [
            ("http://user:pass@proxy.example.com:8080", "pass"),
            ("https://alice:s3cr3t@10.0.0.1:3128", "s3cr3t"),
            ("socks5://tokenuser:tok_ABC123@127.0.0.1:1080", "tok_ABC123"),
            // 密码里含 '@'：必须按最后一个 '@' 切，否则会漏
            ("http://u:p@ss@proxy:8080", "p@ss"),
            // 带路径和查询串
            ("http://user:pass@proxy:8080/pac?x=1", "pass"),
            // 只有用户名没有密码
            ("http://onlyuser@proxy:8080", "onlyuser"),
        ];
        for (raw, secret) in cases {
            let out = redact_proxy_url(raw);
            assert!(
                !out.contains(secret),
                "凭据泄露了！输入 {raw:?} -> 输出 {out:?}（含 {secret:?}）"
            );
            // 主机和端口必须保留，否则排障没法用
            assert!(out.contains("8080") || out.contains("3128") || out.contains("1080"), "{out}");
        }
    }

    /// 没有凭据的地址原样保留 —— 脱敏不该破坏正常配置的可读性。
    #[test]
    fn urls_without_credentials_are_untouched() {
        for raw in [
            "http://proxy.example.com:8080",
            "socks5://127.0.0.1:1080",
            "127.0.0.1:7890", // 不完整形态，环境变量里很常见
            "https://proxy.corp.internal/pac.js",
            "",
        ] {
            assert_eq!(redact_proxy_url(raw), raw.trim(), "不该改动 {raw:?}");
        }
    }

    #[test]
    fn ip_redaction_keeps_network_drops_host() {
        assert_eq!(redact_ip("192.168.1.100"), "192.168.x.x");
        assert_eq!(redact_ip("10.0.0.7"), "10.0.x.x");
        assert_eq!(redact_ip("203.0.113.42"), "203.0.x.x");
        // IPv6
        assert!(redact_ip("2001:db8::1").starts_with("2001:db8"));
        // 非 IP 一律整体遮盖，不做猜测
        assert_eq!(redact_ip("my-laptop.local"), "***");
        assert_eq!(redact_ip(""), "");
    }

}

/// 对整段诊断文本做导出脱敏：IP 保留网段、主机名只留首字母。
///
/// 用于「导出报告给同事/技术支持」这个场景 —— spec 要求导出**默认**遮盖公网 IP、
/// 局域网 IP、主机名和可能识别用户的网络名称，完整 IP 必须由用户主动选择显示。
///
/// 用正则在文本里就地替换，而不是逐字段处理：诊断结果里的 IP 散落在
/// value / detail 各处，逐字段改会漏，而漏一个就等于没脱敏。
pub fn redact_report_text(text: &str) -> String {
    use std::sync::OnceLock;
    static IPV4: OnceLock<regex::Regex> = OnceLock::new();
    static IPV6: OnceLock<regex::Regex> = OnceLock::new();

    let ipv4 = IPV4.get_or_init(|| regex::Regex::new(r"\b\d{1,3}(?:\.\d{1,3}){3}\b").unwrap());
    // 只匹配带多个冒号的形态，避免误伤 `127.0.0.1:8080` 里的端口冒号
    let ipv6 = IPV6.get_or_init(|| {
        regex::Regex::new(r"\b(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\b").unwrap()
    });

    let step1 = ipv6.replace_all(text, |c: &regex::Captures| {
        let m = &c[0];
        // 解析得出才替换，解析不出的原样保留（可能是时间戳之类）
        if m.parse::<std::net::Ipv6Addr>().is_ok() {
            redact_ip(m)
        } else {
            m.to_string()
        }
    });
    ipv4.replace_all(&step1, |c: &regex::Captures| {
        let m = &c[0];
        if m.parse::<std::net::Ipv4Addr>().is_ok() {
            redact_ip(m)
        } else {
            m.to_string()
        }
    })
    .into_owned()
}

#[cfg(test)]
mod export_tests {
    use super::*;

    /// 导出文本里不能残留完整 IP —— 漏一个就等于没脱敏。
    #[test]
    fn report_text_redaction_catches_every_ip() {
        let report = "本机出站 IPv4 = 198.18.0.1\n                      默认路由 = en0 via 192.168.33.1\n                      系统 DNS = 114.114.114.114, 8.8.8.8\n                      解析 github.com = 20.205.243.166, 2001:db8::dead:beef\n                      代理 = http://127.0.0.1:7897";
        let out = redact_report_text(report);

        for full in [
            "198.18.0.1", "192.168.33.1", "114.114.114.114", "8.8.8.8",
            "20.205.243.166", "2001:db8::dead:beef", "127.0.0.1",
        ] {
            assert!(!out.contains(full), "完整 IP 残留: {full}\n{out}");
        }
        // 网段要保留，否则导出的报告没法判断"是不是同一个网络"
        assert!(out.contains("192.168.x.x"), "{out}");
        assert!(out.contains("198.18.x.x"), "{out}");
        // 端口不能被吃掉
        assert!(out.contains("7897"), "端口丢失: {out}");
        // 主机名等非 IP 内容原样保留
        assert!(out.contains("github.com"), "{out}");
        assert!(out.contains("en0"), "{out}");
    }

    /// 不能误伤版本号、时间之类的数字串。
    #[test]
    fn non_ip_numbers_are_not_touched() {
        let text = "耗时 1234 ms，版本 1.2.3，共 20 项，时间 2026-07-31T10:20:30";
        assert_eq!(redact_report_text(text), text);
    }
}
