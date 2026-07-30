import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readJsonOrBackup, writeFileAtomic, writeJsonAtomic } from "./atomicIo.js";

async function tmpdir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "codeshelf-atomic-"));
}

test("损坏 JSON 被改名备份，原内容可恢复", async () => {
  const dir = await tmpdir();
  const file = path.join(dir, "runs.json");
  await fs.writeFile(file, '{"important":"data",TRUNCATED', "utf8");

  const got = await readJsonOrBackup(file);
  assert.equal(got, undefined, "损坏文件应返回 undefined");

  // 原文件已被改名，不再挡在原路径上
  await assert.rejects(() => fs.access(file));

  // 备份存在且内容一字未改 —— 这是"可人工恢复"的前提
  const entries = await fs.readdir(dir);
  const backup = entries.find((e) => e.startsWith("runs.json.corrupt-"));
  assert.ok(backup, `应留下 corrupt 备份，实际: ${entries.join(", ")}`);
  assert.equal(
    await fs.readFile(path.join(dir, backup!), "utf8"),
    '{"important":"data",TRUNCATED',
  );

  await fs.rm(dir, { recursive: true, force: true });
});

test("文件不存在与内容为空返回 undefined，且不产生备份", async () => {
  const dir = await tmpdir();
  assert.equal(await readJsonOrBackup(path.join(dir, "nope.json")), undefined);

  const empty = path.join(dir, "empty.json");
  await fs.writeFile(empty, "   \n", "utf8");
  assert.equal(await readJsonOrBackup(empty), undefined);

  // 空文件是正常初始状态，不该被当成损坏搬走
  const entries = await fs.readdir(dir);
  assert.deepEqual(
    entries.filter((e) => e.includes("corrupt")),
    [],
  );

  await fs.rm(dir, { recursive: true, force: true });
});

test("合法 JSON 正常往返", async () => {
  const dir = await tmpdir();
  const file = path.join(dir, "a.json");
  await writeJsonAtomic(file, { a: 1, nested: { b: [1, 2, 3] } });
  assert.deepEqual(await readJsonOrBackup(file), { a: 1, nested: { b: [1, 2, 3] } });
  await fs.rm(dir, { recursive: true, force: true });
});

test("并发写同一文件：结果必须是某一次的完整内容，不能是拼接残片", async () => {
  const dir = await tmpdir();
  const file = path.join(dir, "concurrent.json");

  // 长度差异很大的载荷：用固定临时名时，短的写完 rename 后长的再 rename，
  // 或两者交错写同一个 tmp，就可能落下一份长度不对的残缺文件。
  const payloads = Array.from({ length: 12 }, (_, i) => ({
    who: i,
    filler: "x".repeat((i + 1) * 5000),
  }));

  await Promise.all(payloads.map((p) => writeJsonAtomic(file, p)));

  // 读回来必须恰好等于其中某一个载荷 —— 而不是半新半旧
  const got = (await readJsonOrBackup(file)) as { who: number; filler: string } | undefined;
  assert.ok(got, "并发写后文件应可读");
  const expected = payloads.find((p) => p.who === got!.who);
  assert.ok(expected, `who 值异常: ${got!.who}`);
  assert.equal(got!.filler.length, expected!.filler.length, "内容长度与 who 不匹配，写入被撕裂了");
  assert.deepEqual(got, expected);

  // 临时文件不能留在数据目录里
  const leftovers = (await fs.readdir(dir)).filter((e) => e.includes(".tmp"));
  assert.deepEqual(leftovers, [], `残留临时文件: ${leftovers.join(", ")}`);

  await fs.rm(dir, { recursive: true, force: true });
});

test("写入后旧文件被完整替换，且不留临时文件", async () => {
  const dir = await tmpdir();
  const file = path.join(dir, "b.txt");
  await writeFileAtomic(file, "第一版");
  await writeFileAtomic(file, "第二版内容更长一些");
  assert.equal(await fs.readFile(file, "utf8"), "第二版内容更长一些");
  assert.deepEqual(
    (await fs.readdir(dir)).filter((e) => e !== "b.txt"),
    [],
  );
  await fs.rm(dir, { recursive: true, force: true });
});
