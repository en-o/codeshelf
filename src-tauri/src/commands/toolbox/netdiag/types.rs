//! 网络环境诊断的共享类型。
//!
//! 核心设计来自 spec 的「状态模型」：**执行状态与解释状态必须分开保存**。
//! 参考项目最严重的问题是「测不到即正常」—— 数据源没配置、请求超时、平台不支持
//! 都可能落到绿色/满分，把「未知」误报成「安全」。这里用类型把这条规则钉死：
//! [`Verdict::from_evidence`] 是唯一的映射入口，`unsupported` / `unavailable` /
//! `failed` / `stale` 一律只能得到 [`Verdict::Unknown`]。

use serde::{Deserialize, Serialize};

/// 执行与证据状态：这次**采集**发生了什么。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceStatus {
    /// 用户尚未开始，或该项尚未执行
    NotChecked,
    /// 本次成功获得可解释的新数据
    Observed,
    /// 名单类数据源查询成功且明确未命中
    NoHit,
    /// 只有超过有效期的缓存数据
    Stale,
    /// 当前平台/部署没有这项能力（例如未建设 DNS 探针）
    Unsupported,
    /// 已配置的外部数据源暂时不可用
    Unavailable,
    /// 本应可执行，但网络、权限、解析或协议失败
    Failed,
}

/// 解释状态：对用户意味着什么。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    /// 有新鲜、完整证据，且符合当前明确规则
    Normal,
    /// 有新鲜、完整证据，发现需要核对的差异
    Warning,
    /// 证据不足、过期、冲突，或当前规则不能给出结论
    Unknown,
}

impl Verdict {
    /// 由证据状态推导解释状态的**唯一入口**。
    ///
    /// `ok_verdict` 只在证据确实新鲜完整时才被采纳；其余一律 `Unknown`。
    /// 这样新增检测项时不可能绕过规则写出一个「失败但显示正常」的分支。
    pub fn from_evidence(evidence: EvidenceStatus, ok_verdict: Verdict) -> Verdict {
        match evidence {
            // 有新鲜证据：采纳调用方的判断（可能是 Normal 也可能是 Warning）
            EvidenceStatus::Observed | EvidenceStatus::NoHit => ok_verdict,
            // 其余全部只能是 Unknown —— 这是本模块最重要的一条不变式
            EvidenceStatus::NotChecked
            | EvidenceStatus::Stale
            | EvidenceStatus::Unsupported
            | EvidenceStatus::Unavailable
            | EvidenceStatus::Failed => Verdict::Unknown,
        }
    }
}

/// 失败原因分类。spec 要求区分离线、DNS 失败、TLS 失败、代理拒绝、超时。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    /// 完全离线 / 网络不可达
    Offline,
    /// 域名解析失败
    DnsFailure,
    /// TCP 连接被拒绝或不可达
    ConnectionRefused,
    /// TLS 握手失败（证书过期、主机名不匹配、协议不兼容等）
    TlsFailure,
    /// 代理拒绝或代理本身不可用
    ProxyRejected,
    /// 超时
    Timeout,
    /// 其它（原因见 detail）
    Other,
}

/// 一条诊断结论。
///
/// 每项都带**数据来源**和**观测时间**，对应 spec「每个结论展示数据来源、
/// 检测时间和判断依据，避免只给一个不可解释的分数」。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticItem {
    /// 稳定标识，前端据此做差异对比
    pub id: String,
    /// 展示名
    pub label: String,
    /// 采集状态
    pub evidence: EvidenceStatus,
    /// 解释状态（必须由 `Verdict::from_evidence` 得出）
    pub verdict: Verdict,
    /// 观测到的值；未观测到时为 None（**不要**用空串冒充成功）
    pub value: Option<String>,
    /// 判断依据 / 补充说明
    pub detail: Option<String>,
    /// 数据来源，例如 "本机路由表"、"系统 DNS 配置"
    pub source: String,
    /// 观测时间 RFC3339
    pub observed_at: String,
    /// 失败时的分类
    pub failure: Option<FailureKind>,
}

impl DiagnosticItem {
    pub fn new(id: &str, label: &str, source: &str) -> Self {
        Self {
            id: id.to_string(),
            label: label.to_string(),
            evidence: EvidenceStatus::NotChecked,
            verdict: Verdict::Unknown,
            value: None,
            detail: None,
            source: source.to_string(),
            observed_at: now_rfc3339(),
            failure: None,
        }
    }

    /// 观测成功。`ok_verdict` 表示「在有证据的前提下」该判为正常还是需要核对。
    pub fn observed(mut self, value: impl Into<String>, ok_verdict: Verdict) -> Self {
        self.evidence = EvidenceStatus::Observed;
        self.verdict = Verdict::from_evidence(EvidenceStatus::Observed, ok_verdict);
        self.value = Some(value.into());
        self.observed_at = now_rfc3339();
        self
    }

    /// 当前平台/部署不支持。**不是**失败，也**不是**正常。
    pub fn unsupported(mut self, why: impl Into<String>) -> Self {
        self.evidence = EvidenceStatus::Unsupported;
        self.verdict = Verdict::from_evidence(EvidenceStatus::Unsupported, Verdict::Normal);
        self.detail = Some(why.into());
        self
    }

    /// 本应可执行但失败了。
    pub fn failed(mut self, kind: FailureKind, detail: impl Into<String>) -> Self {
        self.evidence = EvidenceStatus::Failed;
        self.verdict = Verdict::from_evidence(EvidenceStatus::Failed, Verdict::Normal);
        self.failure = Some(kind);
        self.detail = Some(detail.into());
        self
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }
}

pub fn now_rfc3339() -> String {
    chrono::Local::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 本模块最重要的不变式：任何非新鲜证据都不能显示成「正常」。
    /// 参考项目正是在这里把「未知」误报成了「安全」。
    #[test]
    fn non_fresh_evidence_can_never_be_normal() {
        for e in [
            EvidenceStatus::NotChecked,
            EvidenceStatus::Stale,
            EvidenceStatus::Unsupported,
            EvidenceStatus::Unavailable,
            EvidenceStatus::Failed,
        ] {
            // 即使调用方坚持要 Normal，也必须被降级
            assert_eq!(
                Verdict::from_evidence(e, Verdict::Normal),
                Verdict::Unknown,
                "{e:?} 不该映射成 Normal"
            );
            assert_eq!(
                Verdict::from_evidence(e, Verdict::Warning),
                Verdict::Unknown,
                "{e:?} 不该映射成 Warning"
            );
        }
    }

    /// 有新鲜证据时才采纳调用方的判断，Normal / Warning 都要能传下去。
    #[test]
    fn fresh_evidence_passes_through_verdict() {
        for e in [EvidenceStatus::Observed, EvidenceStatus::NoHit] {
            assert_eq!(Verdict::from_evidence(e, Verdict::Normal), Verdict::Normal);
            assert_eq!(Verdict::from_evidence(e, Verdict::Warning), Verdict::Warning);
        }
    }

    /// 构造器不能绕过上面的规则。
    #[test]
    fn builders_respect_the_invariant() {
        let ok = DiagnosticItem::new("x", "X", "本机").observed("127.0.0.1", Verdict::Normal);
        assert_eq!(ok.verdict, Verdict::Normal);
        assert!(ok.value.is_some());

        let un = DiagnosticItem::new("x", "X", "本机").unsupported("尚未建设探针");
        assert_eq!(un.verdict, Verdict::Unknown, "unsupported 必须是 Unknown");
        assert!(un.value.is_none(), "没有观测到值就不该有 value");

        let f = DiagnosticItem::new("x", "X", "本机").failed(FailureKind::Timeout, "超时");
        assert_eq!(f.verdict, Verdict::Unknown, "failed 必须是 Unknown");
        assert_eq!(f.failure, Some(FailureKind::Timeout));
        assert!(f.value.is_none());
    }
}
