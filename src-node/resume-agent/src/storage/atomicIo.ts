import fs from "node:fs/promises";
import path from "node:path";

/**
 * Node sidecar 侧的原子写 / 损坏备份，语义与 Rust 的
 * `crate::storage::write_atomic` + `parse_json_or_backup` 对齐。
 *
 * 原来这边是直接 `fs.writeFile` + `JSON.parse(...) catch { return undefined }`：
 * - 写到一半掉电会留下半截文件；
 * - 解析失败静默回默认值，下一次保存就把默认值写回去，原数据永久丢失。
 */

let tmpSeq = 0;

/**
 * 原子写：临时文件 → fsync → rename。
 *
 * 临时名带 pid + 自增序号，**不能**用固定的 `<name>.tmp`：
 * 两个并发保存会写同一个临时文件、互相覆盖内容后各自 rename，
 * 结果可能是一份半新半旧的残缺文件，原子写反而成了破坏源。
 */
export async function writeFileAtomic(file: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${tmpSeq++}`;
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tmp, "w");
    await handle.writeFile(contents, "utf8");
    // fsync：rename 是原子的，但不保证数据已经落盘
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(tmp, file);
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(value, null, 2));
}

/**
 * 读 JSON。文件不存在返回 undefined；**内容损坏则改名备份**为
 * `<原名>.corrupt-<时间戳>` 后再返回 undefined。
 *
 * 区分这两种情况很重要：不存在是正常的初始状态，损坏则意味着有数据要抢救 ——
 * 直接吞掉的话，调用方拿到 undefined 走默认值，下一次保存就把它覆盖了。
 */
export async function readJsonOrBackup<T>(file: string): Promise<T | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return undefined; // 不存在 / 读不了，没有数据可丢
  }
  if (!raw.trim()) return undefined;

  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const backup = `${file}.corrupt-${Date.now()}`;
    try {
      await fs.rename(file, backup);
      console.error(
        `[resume-agent] 解析 ${file} 失败（${(err as Error).message}），已备份到 ${backup}`,
      );
    } catch {
      console.error(`[resume-agent] 解析 ${file} 失败且备份未成功：${(err as Error).message}`);
    }
    return undefined;
  }
}
