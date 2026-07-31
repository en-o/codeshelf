import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, RefreshCw, Loader2, Play, Trash2, Save, ExternalLink, Plus, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "@/components/ui";
import { errMsg } from "@/utils/errMsg";
import type {
  DiagnosticItem,
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

export function NetworkDiagnostics({ onBack }: Props) {
  const [local, setLocal] = useState<LocalDiagnostics | null>(null);
  const [localLoading, setLocalLoading] = useState(false);
  const [targets, setTargets] = useState<ServiceTarget[]>([]);
  const [checks, setChecks] = useState<ServiceCheck[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [snapshots, setSnapshots] = useState<NetDiagSnapshotSummary[]>([]);
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
    loadSnapshots();
  }, [runLocal, loadSnapshots]);

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
        payload: JSON.stringify({ local, checks }),
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

  // 覆盖率：spec 要求首版用「问题清单 + 状态 + 检测覆盖率」代替总分
  const coverage = useMemo(() => {
    const all: DiagnosticItem[] = [
      ...(local?.items ?? []),
      ...(checks ?? []).flatMap((c) => c.items),
    ];
    const total = all.length;
    const observed = all.filter((i) => i.evidence === "observed" || i.evidence === "no_hit").length;
    const warning = all.filter((i) => i.verdict === "warning").length;
    const unknown = all.filter((i) => i.verdict === "unknown").length;
    return { total, observed, warning, unknown };
  }, [local, checks]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors" title="返回">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-gray-900">网络环境诊断</h2>
          <p className="text-xs text-gray-500">
            本机网络配置与开发服务连通性排查。所有检测均为只读，不会修改任何系统设置。
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {/* 覆盖率概览：刻意不给总分 */}
        {coverage.total > 0 && (
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">
              已观测 {coverage.observed}/{coverage.total}
            </span>
            {coverage.warning > 0 && (
              <span className="px-2 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200">
                需核对 {coverage.warning}
              </span>
            )}
            {coverage.unknown > 0 && (
              <span className="px-2 py-1 rounded bg-gray-100 text-gray-600 border border-gray-200">
                未知 {coverage.unknown}
              </span>
            )}
            {/* 独立成句而不是和徽章挤一行 —— 它是一条说明，不是一个指标 */}
            <span className="w-full sm:w-auto sm:ml-2 text-[11px] text-gray-400">
              不提供总风险分：本地检测覆盖不到公网出口与 DNS 递归路径
            </span>
          </div>
        )}

        {/* 本机诊断 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold text-gray-800">本机网络</h3>
              {/* 同一次检测里每项时间都一样，放这里一次即可 */}
              {local && (
                <span className="text-[11px] text-gray-400">
                  检测于 {fmtTime(local.collectedAt)}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={runLocal} disabled={localLoading} className="inline-flex items-center px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
                {localLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                <span className="ml-1">重新检测</span>
              </button>
              <button onClick={saveSnapshot} disabled={!local} className="inline-flex items-center px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
                <Save size={13} />
                <span className="ml-1">保存快照</span>
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            {local?.items.map((it) => <ItemRow key={it.id} item={it} />)}
          </div>
        </section>

        {/* 开发服务连通性 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">开发服务连通性</h3>
            <button onClick={runChecks} disabled={checking} className="inline-flex items-center px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50 transition-colors">
              {checking ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              <span className="ml-1">开始检测</span>
            </button>
          </div>
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
            <button onClick={addTarget} className="inline-flex items-center px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
              <Plus size={13} />
            </button>
          </div>

          {checks?.map((c) => (
            <div key={c.url} className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-gray-800 shrink-0">{c.name}</span>
                <span className="text-[11px] text-gray-400 font-mono truncate flex-1 text-right">
                  {c.url}
                </span>
                {/* 各目标的检测时间不同，这里显示有信息量（本机那组则完全相同，提到分区标题） */}
                {c.items[0] && (
                  <span className="text-[11px] text-gray-400 shrink-0">
                    {fmtTime(c.items[0].observedAt)}
                  </span>
                )}
              </div>
              {/* 三层结果用分隔线而不是各自描边：它们属于同一个目标，
                  嵌套边框会让层级看起来比实际更深 */}
              <div className="divide-y divide-gray-100">
                {c.items.map((it, i) => (
                  <ItemRow key={`${c.url}-${it.id}-${i}`} item={it} nested />
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* 浏览器深度检测入口：固定 HTTPS 地址 */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-800">浏览器环境检测</h3>
          <p className="text-xs text-gray-500 leading-relaxed max-w-3xl">
            公网出口 IP、WebRTC、双栈出口这类检测必须在你<strong>真正使用的浏览器</strong>里做。
            CodeShelf 内嵌的 WebView 有自己的 User-Agent 和渲染环境，
            在这里测出来的结果不能代表你的 Chrome / Firefox / Edge。
            <br />
            CodeShelf 自有探针尚未建设，因此这一项当前为「不支持」，而不是「正常」。
          </p>
          <button
            onClick={async () => {
              try {
                await invoke("open_url", { url: "https://ipinfo.io/json" });
              } catch (e) {
                showToast("error", "打开失败", errMsg(e, "未知原因"));
              }
            }}
            className="inline-flex items-center px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <ExternalLink size={13} />
            <span className="ml-1">在默认浏览器中查看出口 IP</span>
          </button>
        </section>

        {/* 历史 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">诊断历史</h3>
            {snapshots.length > 0 && (
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
                className="inline-flex items-center px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                <Trash2 size={13} />
                <span className="ml-1">全部清除</span>
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 max-w-3xl">
            仅保存在本机，最多保留 20 条。切换 VPN / 网络前后各存一次，可对比变化。
          </p>
          {snapshots.length === 0 ? (
            <p className="text-xs text-gray-400">暂无历史</p>
          ) : (
            <div className="space-y-1">
              {snapshots.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between px-3 py-2 border border-gray-200 rounded-lg text-xs"
                >
                  <span className="text-gray-800">{s.label}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400">{fmtTime(s.createdAt)}</span>
                    <button
                      onClick={async () => {
                        try {
                          await invoke("netdiag_delete_snapshot", { id: s.id });
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
        </section>
      </div>
    </div>
  );
}
