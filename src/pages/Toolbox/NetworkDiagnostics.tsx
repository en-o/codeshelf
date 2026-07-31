import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Loader2, Play, Trash2, Save, ExternalLink, Plus, X, Globe, AlertTriangle, HelpCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "@/components/ui";
import { errMsg } from "@/utils/errMsg";
import type {
  DiagnosticItem,
  EgressResult,
  NetworkSituation,
  EgressEndpointDisclosure,
  LocalDiagnostics,
  NetDiagSnapshotSummary,
  ServiceCheck,
  ServiceTarget,
} from "@/bindings";

interface Props {
  onBack: () => void;
}

/**
 * 网络环境诊断（第一阶段：本机诊断）。
 *
 * 展示原则来自 spec，几条都是硬要求：
 * - **不给总分**。参考项目的「纯净度/风控分」是手写权重、没有样本校准，
 *   叫「安全分」是过度承诺。这里只给问题清单 + 状态 + 覆盖率。
 * - 每项都展示数据来源和观测时间，结论可追溯。
 * - `unknown` 单独成一类，不混进「正常」也不混进「异常」——
 *   「测不到」和「没问题」是两回事。
 * - 进入页面**不自动发起任何远程请求**；本机诊断是纯本地的，
 *   联网检测由用户点按钮触发。
 */

const VERDICT_STYLE: Record<string, { label: string; cls: string }> = {
  normal: { label: "正常", cls: "text-green-700 bg-green-50 border-green-200" },
  warning: { label: "需核对", cls: "text-amber-700 bg-amber-50 border-amber-200" },
  unknown: { label: "未知", cls: "text-gray-600 bg-gray-100 border-gray-200" },
};

const EVIDENCE_LABEL: Record<string, string> = {
  not_checked: "未执行",
  observed: "已观测",
  no_hit: "查询未命中",
  stale: "缓存已过期",
  unsupported: "当前不支持",
  unavailable: "数据源不可用",
  failed: "执行失败",
};

const FAILURE_LABEL: Record<string, string> = {
  offline: "网络不可达",
  dns_failure: "DNS 解析失败",
  connection_refused: "连接被拒绝",
  tls_failure: "TLS 失败",
  proxy_rejected: "代理拒绝",
  timeout: "超时",
  other: "其它",
};

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** 值太长或带换行时单独占一行，短值与标题同行 —— 大多数值只有十几个字符。 */
const DOT: Record<string, string> = {
  normal: "bg-green-500",
  warning: "bg-amber-500",
  unknown: "bg-gray-300",
};

/**
 * 大盘里的紧凑行：`● 名称 ⋯⋯⋯ 值`。
 *
 * 值右对齐是关键 —— 一列对齐的值可以竖着扫，比每项一段说明快得多。
 * 说明文字移到 title，需要时 hover；结论区已经把要点讲过了。
 */
function StatRow({ item }: { item: DiagnosticItem }) {
  const tip = [item.detail, `来源：${item.source}`, `观测时间：${fmtTime(item.observedAt)}`]
    .filter(Boolean)
    .join("\n");
  const c = item.comparison;

  return (
    <div className="py-1 text-xs cursor-help" title={tip}>
      <div className="flex items-baseline gap-2">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[item.verdict] ?? DOT.unknown}`} />
        <span className="text-gray-600 shrink-0">{item.label}</span>
        <span className="flex-1 border-b border-dotted border-gray-200 translate-y-[-3px]" />
        <span className="font-mono text-gray-900 text-right max-w-[55%] truncate">
          {item.value ??
            (item.verdict === "unknown" ? EVIDENCE_LABEL[item.evidence] ?? item.evidence : "—")}
        </span>
      </div>

      {/* 并排对照：「本机配的是 A ↔ 外面看到的是 B」。
          一致性类结论的价值全在这一行 —— 两边摆一起才看得出对不对得上，
          写成一段话就得读完才知道。 */}
      {c && (
        <div className="mt-0.5 ml-3.5 flex items-baseline gap-1.5 flex-wrap text-[11px]">
          <span className="text-gray-400">{c.leftLabel}</span>
          <span className="font-mono text-gray-700">{c.left}</span>
          <span className={c.matched ? "text-gray-300" : "text-amber-500"}>↔</span>
          <span className="text-gray-400">{c.rightLabel}</span>
          <span className={`font-mono ${c.matched ? "text-gray-700" : "text-amber-700"}`}>
            {c.right}
          </span>
        </div>
      )}
    </div>
  );
}

/** 大盘卡片：标题 + 状态点 + 一列紧凑行 */
function StatCard({
  title,
  items,
  action,
}: {
  title: string;
  items: DiagnosticItem[];
  action?: React.ReactNode;
}) {
  const worst = items.some((i) => i.verdict === "warning")
    ? "warning"
    : items.some((i) => i.verdict === "unknown")
      ? "unknown"
      : "normal";
  return (
    <div className="border border-gray-200 rounded-lg bg-white p-3 flex flex-col">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-semibold text-gray-800">{title}</span>
        <span className={`w-2 h-2 rounded-full ${DOT[worst]}`} />
        <div className="ml-auto">{action}</div>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400 py-1">未检测</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {items.map((it, i) => (
            <StatRow key={`${it.id}-${i}`} item={it} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 四维覆盖雷达。
 *
 * **轴的含义是「该维度的检测完成度」，不是风险分。**
 * spec 明令首版不提供「纯净度 / 欺诈风险 / 账号安全」总分，理由是那些权重
 * 手写、无样本校准，叫「安全分」属于过度承诺。所以这里的轴画的是事实：
 * 这个维度有多少项拿到了新鲜证据。未知项**不会**贡献满分 —— 它们直接把轴拉低，
 * 正好对上 spec「未知项不能贡献满分」那条。
 *
 * 也因此**不显示综合分**：只标出每维的「已观测/总数」和问题数。
 */
export interface RadarAxis {
  key: string;
  label: string;
  total: number;
  observed: number;
  problems: number;
}

/**
 * 轴长 = 该维度**无问题项的占比**。
 *
 * 第一版用「检测覆盖率」，结果检测一跑完四个轴全是满的（3/3、18/18），
 * 图形永远是个正菱形 —— 等于没有信息量。用通过率才能让有矛盾的维度真正塌下去，
 * 一眼看出问题集中在哪。
 *
 * 这**不是**风险评分：它就是「这个维度 N 项里有几项没问题」这个事实，
 * 未知项和矛盾项一样把轴拉低（spec：未知项不能贡献满分）。
 * 也因此仍然**不给综合分**。
 */
function axisRatio(a: RadarAxis): number {
  if (a.total === 0) return 0;
  return Math.max(0, a.total - a.problems) / a.total;
}

export function CoverageRadar({ axes }: { axes: RadarAxis[] }) {
  // viewBox 留足边距：轴标签在 R+30 处，四周还要放下两行文字。
  // 之前 260 宽装不下「本机链路 / 6·6 · 2 待核」这种长标签，左右都被裁掉了。
  const C = 160;
  const CY = 120;
  const R = 66;
  const n = axes.length || 1;
  const angleFor = (i: number) => (-90 + (i * 360) / n) * (Math.PI / 180);
  const pt = (i: number, r: number) => ({
    x: C + r * Math.cos(angleFor(i)),
    y: CY + r * Math.sin(angleFor(i)),
  });

  // 轴长 = 覆盖率；一项都没测的维度收在中心（视觉上就是"这块是空的"）
  const verts = axes.map((a, i) => pt(i, Math.max(5, axisRatio(a) * R)));
  const polygon = verts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const anyProblem = axes.some((a) => a.problems > 0);

  return (
    <svg viewBox="0 0 320 250" className="w-full h-auto overflow-visible" role="img" aria-label="检测覆盖雷达">
      {[0.33, 0.66, 1].map((r) => (
        <circle key={r} cx={C} cy={CY} r={R * r} fill="none" stroke="#e5e7eb" strokeWidth="1" />
      ))}
      {axes.map((a, i) => {
        const e = pt(i, R);
        return <line key={a.key} x1={C} y1={CY} x2={e.x} y2={e.y} stroke="#e5e7eb" strokeWidth="1" />;
      })}
      <polygon
        points={polygon}
        fill={anyProblem ? "rgba(245,158,11,0.16)" : "rgba(34,197,94,0.16)"}
        stroke={anyProblem ? "#f59e0b" : "#22c55e"}
        strokeWidth="1.5"
      />
      {axes.map((a, i) => {
        const v = verts[i];
        return (
          <circle
            key={a.key}
            cx={v.x}
            cy={v.y}
            r="3"
            fill={a.problems > 0 ? "#f59e0b" : a.total === 0 ? "#d1d5db" : "#22c55e"}
          />
        );
      })}
      {axes.map((a, i) => {
        const l = pt(i, R + 30);
        const anchor = i === 1 ? "start" : i === 3 ? "end" : "middle";
        return (
          <g key={a.key}>
            <text
              x={l.x}
              y={l.y}
              textAnchor={anchor}
              className={a.problems > 0 ? "fill-amber-700" : "fill-gray-600"}
              fontSize="11"
            >
              {a.label}
            </text>
            <text
              x={l.x}
              y={l.y + 13}
              textAnchor={anchor}
              className={a.problems > 0 ? "fill-amber-600" : "fill-gray-400"}
              fontSize="10"
            >
              {a.total === 0
                ? "未检测"
                : a.problems > 0
                  ? `${a.problems} 项待核`
                  : `${a.total} 项正常`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function valueNeedsOwnLine(v: string): boolean {
  return v.includes("\n") || v.length > 48;
}

function ItemRow({ item, nested = false }: { item: DiagnosticItem; nested?: boolean }) {
  const style = VERDICT_STYLE[item.verdict] ?? VERDICT_STYLE.unknown;
  // "正常 + 已观测" 是重复信息。只在证据状态**不是**顺利观测时才单独标出来，
  // 那时它才携带信息（跳过 / 失败 / 不支持）。
  const showEvidence = item.evidence !== "observed" && item.evidence !== "no_hit";
  const ownLine = item.value ? valueNeedsOwnLine(item.value) : false;

  return (
    <div className={nested ? "px-3 py-2 bg-white" : "border border-gray-200 rounded-lg px-3 py-2 bg-white"}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={`text-[11px] px-1.5 py-0.5 rounded border shrink-0 ${style.cls}`}>
          {style.label}
        </span>
        <span className="text-sm font-medium text-gray-800 shrink-0">{item.label}</span>

        {/* 短值与标题同行：一眼能看到答案，不用往下扫 */}
        {item.value && !ownLine && (
          <span className="text-xs font-mono text-gray-900">{item.value}</span>
        )}
        {showEvidence && (
          <span className="text-[11px] text-gray-500">
            {EVIDENCE_LABEL[item.evidence] ?? item.evidence}
            {item.failure ? ` · ${FAILURE_LABEL[item.failure] ?? item.failure}` : ""}
          </span>
        )}

        {/* 数据来源靠右：spec 要求每个结论可追溯，但它是次要信息，不该占据视线中心。
            观测时间放进 title —— 同一次检测里各项时间几乎相同，逐行铺开全是重复；
            但它必须**可看到**（spec 验收标准），所以 hover 一定能取到。 */}
        <span
          className="ml-auto text-[11px] text-gray-400 shrink-0 cursor-help"
          title={`来源：${item.source}\n观测时间：${fmtTime(item.observedAt)}`}
        >
          {item.source}
        </span>
      </div>

      {item.value && ownLine && (
        <pre className="mt-1.5 text-xs font-mono text-gray-900 whitespace-pre-wrap break-all">
          {item.value}
        </pre>
      )}

      {/* 说明限宽：铺满整屏时一行能到 150+ 字符，眼睛跟不上换行 */}
      {item.detail && (
        <p className="mt-1 text-xs text-gray-500 leading-relaxed max-w-3xl">{item.detail}</p>
      )}
    </div>
  );
}

/**
 * 可折叠分区。明细默认收起 —— 结论已经在顶部给了，
 * 展开是为了「我想自己核对一下依据」，不是首屏必读。
 */
function Section({
  title,
  count,
  action,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-800 hover:text-gray-900"
        >
          <ChevronRight
            size={14}
            className={`text-gray-400 transition-transform ${open ? "rotate-90" : ""}`}
          />
          {title}
          {count !== undefined && <span className="text-xs text-gray-400">{count}</span>}
        </button>
        <div className="ml-auto flex items-center gap-2">{action}</div>
      </div>
      {open && <div className="p-3 space-y-2">{children}</div>}
    </section>
  );
}

export function NetworkDiagnostics({ onBack }: Props) {
  const [local, setLocal] = useState<LocalDiagnostics | null>(null);
  const [localLoading, setLocalLoading] = useState(false);
  const [targets, setTargets] = useState<ServiceTarget[]>([]);
  const [checks, setChecks] = useState<ServiceCheck[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [snapshots, setSnapshots] = useState<NetDiagSnapshotSummary[]>([]);
  const [egress, setEgress] = useState<DiagnosticItem[] | null>(null);
  const [situation, setSituation] = useState<NetworkSituation | null>(null);
  const [egressLoading, setEgressLoading] = useState(false);
  const [disclosures, setDisclosures] = useState<EgressEndpointDisclosure[]>([]);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const runLocal = useCallback(async () => {
    setLocalLoading(true);
    try {
      setLocal(await invoke<LocalDiagnostics>("netdiag_local"));
    } catch (e) {
      showToast("error", "本机诊断失败", errMsg(e, "未知原因"));
    } finally {
      setLocalLoading(false);
    }
  }, []);

  const loadSnapshots = useCallback(async () => {
    try {
      setSnapshots(await invoke<NetDiagSnapshotSummary[]>("netdiag_list_snapshots"));
    } catch (e) {
      console.error("读取诊断历史失败:", e);
    }
  }, []);

  useEffect(() => {
    // 本机诊断是纯本地操作，不产生任何远程请求，可以自动跑。
    // 联网的服务连通性检测必须由用户点按钮 —— spec：进入工具页不自动访问第三方服务。
    runLocal();
    invoke<ServiceTarget[]>("netdiag_default_targets").then(setTargets).catch(() => {});
    // 只是取「会访问哪些域名」的清单，本身不发任何外部请求
    invoke<EgressEndpointDisclosure[]>("netdiag_egress_disclosures").then(setDisclosures).catch(() => {});
    loadSnapshots();
  }, [runLocal, loadSnapshots]);

  async function runEgress() {
    if (!local) return;
    setEgressLoading(true);
    try {
      const r = await invoke<EgressResult>("netdiag_egress", { local });
      setEgress(r.items);
      setSituation(r.situation);
    } catch (e) {
      showToast("error", "出口观测失败", errMsg(e, "未知原因"));
    } finally {
      setEgressLoading(false);
    }
  }

  async function runChecks() {
    if (targets.length === 0) return;
    setChecking(true);
    try {
      setChecks(await invoke<ServiceCheck[]>("netdiag_check_services", { targets }));
    } catch (e) {
      showToast("error", "连通性检测失败", errMsg(e, "未知原因"));
    } finally {
      setChecking(false);
    }
  }

  async function saveSnapshot() {
    if (!local) return;
    const label = window.prompt("给这次快照起个名字（例如「开 VPN 前」）", "");
    if (label === null) return;
    try {
      await invoke("netdiag_save_snapshot", {
        label: label.trim() || fmtTime(local.collectedAt),
        payload: JSON.stringify({ local, egress, checks }),
      });
      showToast("success", "已保存快照", "可在下方历史里对比切换网络前后的差异");
      loadSnapshots();
    } catch (e) {
      showToast("error", "保存快照失败", errMsg(e, "未知原因"));
    }
  }

  function addTarget() {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name || !url) return;
    if (!url.startsWith("https://")) {
      showToast("error", "只支持 HTTPS", "明文 HTTP 的检测结果可能被中间设备篡改，没有诊断价值");
      return;
    }
    setTargets((prev) => [...prev, { name, url }]);
    setNewName("");
    setNewUrl("");
  }

  /** 一键跑完三段：用户要的是"现在到底怎么样"，不是分三次点。 */
  async function runAll() {
    await runLocal();
    // runLocal 里 setLocal 是异步的，这里直接取一份新的传给出口观测
    let fresh: LocalDiagnostics | null = null;
    try {
      fresh = await invoke<LocalDiagnostics>("netdiag_local");
      setLocal(fresh);
    } catch {
      /* runLocal 已经提示过了 */
    }
    if (fresh) {
      setEgressLoading(true);
      try {
        const r = await invoke<EgressResult>("netdiag_egress", { local: fresh });
        setEgress(r.items);
        setSituation(r.situation);
      } catch (e) {
        showToast("error", "出口观测失败", errMsg(e, "未知原因"));
      } finally {
        setEgressLoading(false);
      }
    }
    await runChecks();
  }

  const busy = localLoading || egressLoading || checking;

  /** 出口摘要：打开这个工具最想先看到的东西。 */
  const egressSummary = useMemo(() => {
    const pick = (id: string) => egress?.find((i) => i.id === id);
    return { v4: pick("egress.ipv4"), v6: pick("egress.ipv6"), geo: pick("egress.geo") };
  }, [egress]);

  /** 从 IPv4 那条的说明里取 Cloudflare 接入机房代码，粗略反映出口地理位置。 */
  const colo = useMemo(() => {
    const d = egressSummary.v4?.detail ?? "";
    const m = d.match(/接入机房：([A-Z]{3})/);
    return m ? m[1] : null;
  }, [egressSummary]);

  /**
   * 四个维度。按**用户关心的问题**分，不是按数据来源分 ——
   * 「本机 / 出口 / 连通性」是实现视角，用户想的是「出口是谁、链路怎么配的、
   * 两边对不对得上、服务通不通」。
   */
  const dims = useMemo(() => {
    const eg = egress ?? [];
    const svc = (checks ?? []).flatMap((c) => c.items);
    return {
      // egress.ipv4 / geo 已在上方大卡里以主视觉展示，明细卡不再重复
      egress: eg.filter((i) => i.id.startsWith("egress.")),
      local: local?.items ?? [],
      cross: eg.filter((i) => i.id.startsWith("cross.")),
      service: svc,
    };
  }, [local, egress, checks]);

  const axes: RadarAxis[] = useMemo(() => {
    const mk = (key: string, label: string, items: DiagnosticItem[]) => ({
      key,
      label,
      total: items.length,
      observed: items.filter((i) => i.evidence === "observed" || i.evidence === "no_hit").length,
      problems: items.filter((i) => i.verdict === "warning" || i.verdict === "unknown").length,
    });
    return [
      mk("egress", "公网出口", dims.egress),
      mk("cross", "一致性核对", dims.cross),
      mk("service", "开发服务", dims.service),
      mk("local", "本机链路", dims.local),
    ];
  }, [dims]);

  /**
   * 结论标题：**点出是哪个维度出了问题**，而不是只报一个数量。
   *
   * 「发现 2 处需要核对」等于把定位工作又推回给用户；
   * 「出口一致性存在矛盾」才是一句有信息量的结论。
   * 取问题最集中的那个维度命名，与雷达图上塌陷的轴对应得上。
   */
  const headline = useMemo(() => {
    const withProblems = axes.filter((a) => a.problems > 0);
    if (withProblems.length === 0) return null;
    const worst = withProblems.reduce((a, b) => (b.problems > a.problems ? b : a));
    const others = withProblems.length - 1;
    return {
      title: others > 0 ? `${worst.label}等 ${withProblems.length} 个维度存在矛盾` : `${worst.label}存在矛盾`,
      sub:
        worst.key === "cross"
          ? "本机配置与外部实际观测到的出口对不上"
          : worst.key === "egress"
            ? "公网出口未能完整确认"
            : worst.key === "service"
              ? "部分开发服务的网络路径存在问题"
              : "本机链路配置存在需要核对的项",
    };
  }, [axes]);

  /** 所有需要核对 / 未知的项，聚到顶部 —— 这才是用户要找的东西。 */
  const problems = useMemo(() => {
    const all: DiagnosticItem[] = [
      ...(local?.items ?? []),
      ...(egress ?? []),
      ...(checks ?? []).flatMap((c) => c.items),
    ];
    return all.filter((i) => {
      if (i.verdict !== "warning" && i.verdict !== "unknown") return false;
      // 本机侧的 fake-IP 提示属于**环境特征**，不是「本机与外部对不上」的矛盾 ——
      // 它已经在上面的网络环境画像里讲过了，再列进核对项只会稀释真正的问题。
      if (i.id === "local.ipv4" || i.id === "local.ipv6") return false;
      return true;
    });
  }, [local, egress, checks]);

  // 覆盖率：spec 要求首版用「问题清单 + 状态 + 检测覆盖率」代替总分
  const coverage = useMemo(() => {
    const all: DiagnosticItem[] = [
      ...(local?.items ?? []),
      ...(egress ?? []),
      ...(checks ?? []).flatMap((c) => c.items),
    ];
    const total = all.length;
    const observed = all.filter((i) => i.evidence === "observed" || i.evidence === "no_hit").length;
    const warning = all.filter((i) => i.verdict === "warning").length;
    const unknown = all.filter((i) => i.verdict === "unknown").length;
    return { total, observed, warning, unknown };
  }, [local, egress, checks]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors" title="返回">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-gray-900">网络环境诊断</h2>
          <p className="text-xs text-gray-500">
            切换代理 / VPN 后，核对本机配置与外部实际看到的出口是否一致。检测均为只读。
          </p>
        </div>
        {/* 主操作：绝大多数场景就是"跑一遍看看现在怎么样"，
            不该逼用户分三次点三个分区的按钮 */}
        <button
          onClick={saveSnapshot}
          disabled={!local}
          title="保存当前结果，用于对比切换网络前后的差异"
          className="shrink-0 inline-flex items-center px-2.5 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <Save size={13} />
          <span className="ml-1">存快照</span>
        </button>
        <button
          onClick={runAll}
          disabled={busy}
          className="shrink-0 inline-flex items-center px-3 py-2 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50 transition-colors"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          <span className="ml-1.5">完整检测</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {/* ══ 第一行：雷达概览 + 结论 ══ */}
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-3">
          <div className="border border-gray-200 rounded-lg bg-white p-3 flex items-center justify-center">
            <CoverageRadar axes={axes} />
          </div>

          <div className="border border-gray-200 rounded-lg bg-white p-4 flex flex-col">
            {coverage.total === 0 ? (
              <div className="m-auto text-center">
                <p className="text-sm text-gray-500">尚未检测</p>
                <p className="text-xs text-gray-400 mt-1">
                  点右上角「完整检测」，核对本机配置与外部实际看到的出口
                </p>
              </div>
            ) : problems.length > 0 ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                  <h3 className="text-lg font-semibold text-gray-900">
                    {headline?.title ?? "存在需要核对的项"}
                  </h3>
                </div>
                {/* 网络环境画像：「我现在处在什么网络环境、这意味着什么」。
                    这比「N 处需要核对」有用得多 —— 后者只说了有问题，
                    前者说清了当前处境和会踩到什么。 */}
                {situation ? (
                  <div className="mt-2 ml-[18px]">
                    <p className="text-sm text-gray-700">{situation.summary}</p>
                    <ul className="mt-1.5 space-y-1">
                      {situation.implications.map((im, i) => (
                        <li key={i} className="text-xs text-gray-500 leading-relaxed flex gap-1.5">
                          <span className="text-gray-300 shrink-0">·</span>
                          <span>{im}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 mt-1 ml-[18px]">{headline?.sub}</p>
                )}

                <div className="flex items-baseline justify-between mt-3 pt-3 border-t border-gray-100">
                  <span className="text-[11px] text-gray-400">核对项</span>
                  <span className="text-[11px] text-gray-300">{problems.length}</span>
                </div>

                <div className="mt-2 space-y-2.5 overflow-y-auto">
                  {problems.map((it) => {
                    // 两级：有对照且明确不一致 = 确证的矛盾；其余是证据不足
                    const solid = it.verdict === "warning";
                    return (
                      <div key={`p-${it.id}`} className="flex gap-2.5">
                        <span
                          className={`shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded h-fit mt-0.5 ${
                            solid
                              ? "bg-amber-100 text-amber-800"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {solid ? <AlertTriangle size={9} /> : <HelpCircle size={9} />}
                          {solid ? "不一致" : "未知"}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm text-gray-800">{it.label}</div>
                          {/* 具体、可核对的事实优先；解释性文字放 hover */}
                          <div
                            className="text-xs text-gray-500 mt-0.5"
                            title={it.detail ?? undefined}
                          >
                            {it.evidenceNote ??
                              (it.comparison
                                ? `${it.comparison.leftLabel} ${it.comparison.left} ↔ ${it.comparison.rightLabel} ${it.comparison.right}`
                                : it.detail)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="m-auto text-center">
                <div className="flex items-center justify-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <h3 className="text-base font-semibold text-gray-900">未发现异常</h3>
                </div>
                {situation && <p className="text-sm text-gray-700 mt-1.5">{situation.summary}</p>}
                <p className="text-xs text-gray-500 mt-1">
                  已检测 {coverage.total} 项。这只代表本次没有命中已知问题
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ══ 第二行：公网出口（核心事实，字号最大）══ */}
        <div className="border border-gray-200 rounded-lg bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <Globe size={14} className="text-gray-500" />
            <span className="text-xs font-semibold text-gray-800">公网出口</span>
            <span className="text-[11px] text-gray-400">外部服务实际看到的你</span>
            <button
              onClick={runEgress}
              disabled={egressLoading || !local}
              className={`ml-auto ${"inline-flex items-center px-2.5 py-1 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"}`}
            >
              {egressLoading ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
              <span className="ml-1">观测</span>
            </button>
          </div>

          {egressSummary.v4?.value || egressSummary.v6?.value ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">
              {/* 出口 IP 是这张卡的主角，字号明显大于其余 */}
              <div>
                <div className="text-[11px] text-gray-400 mb-0.5">出口 IP</div>
                <div className="text-2xl font-mono font-semibold text-gray-900 leading-tight break-all">
                  {egressSummary.v4?.value ?? "—"}
                </div>
                {colo && (
                  <span className="inline-block mt-1.5 text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                    接入机房 {colo}
                  </span>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <div className="text-[11px] text-gray-400">归属地</div>
                  <div className="text-sm text-gray-800">
                    {egressSummary.geo?.value ?? "—"}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] text-gray-400">出口 IPv6</div>
                  <div className="text-sm font-mono text-gray-800 break-all">
                    {egressSummary.v6?.value ?? "—"}
                  </div>
                </div>
              </div>

              <div className="space-y-3 min-w-0">
                <div>
                  <div className="text-[11px] text-gray-400">本机代理</div>
                  {/* 按分号拆行：一整串 `HTTP …；HTTPS …；SOCKS …` 靠 break-all
                      会从 SOCKS 中间断开，读起来很别扭 */}
                  <div className="text-sm text-gray-800 space-y-0.5">
                    {(local?.items.find((i) => i.id === "local.system_proxy")?.value ?? "—")
                      .split(/[；;]/)
                      .map((seg) => seg.trim())
                      .filter(Boolean)
                      .map((seg, i) => (
                        <div key={i} className="font-mono text-xs break-all">
                          {seg}
                        </div>
                      ))}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-400">系统 DNS</div>
                  <div className="text-sm font-mono text-gray-800 break-all">
                    {local?.items.find((i) => i.id === "local.dns")?.value ?? "—"}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400">尚未观测</p>
          )}

          {/* 逐项披露接收方。spec：不能只笼统提示「需要联网」。
              放在触发按钮同一张卡里，保证用户点之前一定看得到。 */}
          <details className="mt-3 group">
            <summary className="text-[11px] text-gray-400 cursor-pointer hover:text-gray-600 list-none">
              ▸ 观测会访问 {disclosures.length} 个第三方端点，它们会看到你的公网 IP
            </summary>
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-gray-500 pl-3">
              {disclosures.map((d) => (
                <li key={d.host} className="flex gap-2">
                  <span className="font-mono text-gray-600 shrink-0">{d.host}</span>
                  <span className="text-gray-300">·</span>
                  <span>{d.purpose}（{d.operator}）</span>
                </li>
              ))}
              <li className="text-gray-400 pt-0.5">
                只做地址回显，不查询商业 IP 情报库；导出报告时公网 IP 默认脱敏。
              </li>
            </ul>
          </details>
        </div>

        {/* ══ 第三行：四维明细网格 ══ */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <StatCard title="一致性核对" items={dims.cross} />
          <StatCard
            title="本机链路"
            items={dims.local}
            action={
              <button onClick={runLocal} disabled={localLoading} className="inline-flex items-center px-2.5 py-1 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
                {localLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              </button>
            }
          />
          <StatCard
            title="开发服务连通性"
            items={dims.service}
            action={
              <button onClick={runChecks} disabled={checking} className="inline-flex items-center px-2.5 py-1 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
                {checking ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              </button>
            }
          />
        </div>

        {/* 开发服务连通性 */}
        <Section
          title="开发服务连通性 · 分层明细与目标配置"
          count={checks?.length ?? targets.length}
          action={
            <button onClick={runChecks} disabled={checking} className="inline-flex items-center px-2.5 py-1 text-xs border border-gray-200 rounded-lg hover:bg-white disabled:opacity-50 transition-colors">
              {checking ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              <span className="ml-1">检测</span>
            </button>
          }
        >
          <p className="text-xs text-gray-500 max-w-3xl leading-relaxed">
            会向下列地址发起真实 HTTPS 请求，并<strong className="font-medium text-gray-700">遵循</strong>
            当前系统与环境变量代理 —— 测出来的就是 npm / cargo / git 会遇到的情况，不会自动绕过代理。
          </p>

          <div className="flex flex-wrap gap-1.5">
            {targets.map((t, i) => (
              <span
                key={`${t.url}-${i}`}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-gray-100 text-gray-700"
              >
                {t.name}
                <button
                  onClick={() => setTargets((prev) => prev.filter((_, x) => x !== i))}
                  className="text-gray-400 hover:text-red-600"
                  title="移除"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="名称，如 公司镜像源"
              className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1"
            />
            <input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://..."
              className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 flex-[2]"
            />
            <button onClick={addTarget} className="inline-flex items-center px-2.5 py-1 text-xs border border-gray-200 rounded-lg hover:bg-white disabled:opacity-50 transition-colors">
              <Plus size={12} />
            </button>
          </div>

          {checks?.map((c) => (
            <div key={c.url} className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-gray-800 shrink-0">{c.name}</span>
                <span className="text-[11px] text-gray-400 font-mono truncate flex-1 text-right">
                  {c.url}
                </span>
                {c.items[0] && (
                  <span className="text-[11px] text-gray-400 shrink-0">
                    {fmtTime(c.items[0].observedAt)}
                  </span>
                )}
              </div>
              <div className="divide-y divide-gray-100">
                {c.items.map((it, i) => (
                  <ItemRow key={`${c.url}-${it.id}-${i}`} item={it} nested />
                ))}
              </div>
            </div>
          ))}
        </Section>

        {/* 浏览器深度检测入口：固定 HTTPS 地址 */}
        <Section title="浏览器环境检测">
          <p className="text-xs text-gray-500 leading-relaxed max-w-3xl">
            Canvas / WebGL / WebRTC 这类<strong className="font-medium text-gray-700">浏览器指纹</strong>信号必须在你
            <strong className="font-medium text-gray-700">真正使用的浏览器</strong>里采集。
            CodeShelf 内嵌 WebView 有自己的 UA 和渲染环境，在这里测出来的不能代表你的
            Chrome / Firefox / Edge。
            <br />
            注意：出口 IP 和双栈这类<strong className="font-medium text-gray-700">网络层事实</strong>不受此限制，上面的「公网出口」分区
            已经从 Rust 侧直接验证过了，比浏览器里用 WebRTC 推断更准。
          </p>
          <button
            onClick={async () => {
              try {
                await invoke("open_url", { url: "https://1.1.1.1/cdn-cgi/trace" });
              } catch (e) {
                showToast("error", "打开失败", errMsg(e, "未知原因"));
              }
            }}
            className="inline-flex items-center px-2.5 py-1 text-xs border border-gray-200 rounded-lg hover:bg-white disabled:opacity-50 transition-colors"
          >
            <ExternalLink size={12} />
            <span className="ml-1">在默认浏览器中打开</span>
          </button>
        </Section>

        {/* 历史 */}
        <Section
          title="诊断历史"
          count={snapshots.length}
          action={
            snapshots.length > 0 ? (
              <button
                onClick={async () => {
                  if (!window.confirm("清空全部诊断历史？")) return;
                  try {
                    await invoke("netdiag_clear_snapshots");
                    loadSnapshots();
                  } catch (e) {
                    showToast("error", "清空失败", errMsg(e, "未知原因"));
                  }
                }}
                className="inline-flex items-center px-2.5 py-1 text-xs border border-gray-200 rounded-lg hover:bg-white disabled:opacity-50 transition-colors"
              >
                <Trash2 size={12} />
                <span className="ml-1">清空</span>
              </button>
            ) : undefined
          }
        >
          <p className="text-xs text-gray-500 max-w-3xl">
            仅保存在本机，最多保留 20 条。切换 VPN / 网络前后各存一次，可对比变化。
          </p>
          {snapshots.length === 0 ? (
            <p className="text-xs text-gray-400">暂无历史</p>
          ) : (
            <div className="space-y-1">
              {snapshots.map((sn) => (
                <div
                  key={sn.id}
                  className="flex items-center justify-between px-3 py-2 border border-gray-200 rounded-lg text-xs"
                >
                  <span className="text-gray-800">{sn.label}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400">{fmtTime(sn.createdAt)}</span>
                    <button
                      onClick={async () => {
                        try {
                          await invoke("netdiag_delete_snapshot", { id: sn.id });
                          loadSnapshots();
                        } catch (e) {
                          showToast("error", "删除失败", errMsg(e, "未知原因"));
                        }
                      }}
                      className="text-gray-400 hover:text-red-600"
                      title="删除"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
