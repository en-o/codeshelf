/**
 * 把任意 catch 到的值转成给用户看的错误文案。
 *
 * **Tauri invoke 抛出来的是纯字符串，不是 `Error` 实例**（CLAUDE.md 硬约束 4）。
 * 所以下面这种常见写法是错的：
 *
 * ```ts
 * catch (e) { showToast("error", e instanceof Error ? e.message : "保存失败"); }
 * //                              ^ 后端错误永远走不到这里，全部退化成「保存失败」
 * ```
 *
 * 后端辛苦拼出来的「端口 8080 已被占用」「目录不存在」这类信息会被整个吞掉，
 * 用户和排查的人只看得到一句泛化文案。
 *
 * 这里把两种形态都兜住，并保留 fallback 供真的拿不到信息时使用。
 */
export function errMsg(e: unknown, fallback: string): string {
  if (typeof e === "string" && e.trim()) return e;
  if (e instanceof Error && e.message) return e.message;
  // 后端偶尔会返回结构化对象（如 { message: "..." }）
  if (e && typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return fallback;
}

/**
 * 用户主动取消（选文件对话框点了取消等）不是故障，不该弹错误。
 *
 * 判据保守：只认明确的取消语义，拿不准一律当成真错误报出来 ——
 * 宁可多报一次，也不要把真实故障静默掉。
 */
export function isUserCancel(e: unknown): boolean {
  const msg = typeof e === "string" ? e : e instanceof Error ? e.message : "";
  return /用户取消|已取消|cancell?ed by user|operation was cancell?ed/i.test(msg);
}
