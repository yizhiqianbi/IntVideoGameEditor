import test from "node:test";
import assert from "node:assert/strict";
import { loadCreatorSections, type CreatorSectionResult } from "./xumeng-creator-load.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test("successful libraries arrive while another is hung; the remaining section has a deadline", { timeout: 1000 }, async () => {
  const progress: CreatorSectionResult<string[]>[] = [], firstTwo = deferred<void>();
  let hungSignal: AbortSignal | undefined;
  const done = loadCreatorSections([
    async () => ["原创游戏"],
    signal => { hungSignal = signal; return new Promise(() => {}); },
    async () => ["原创团本"],
  ], new AbortController().signal, value => {
    progress.push(value);
    if (progress.filter(item => item.result.status === "fulfilled").length === 2) firstTwo.resolve();
  }, 30);
  await firstTwo.promise;
  assert.deepEqual(progress.map(value => value.index).sort(), [0, 2]);
  assert.equal(progress.at(-1)?.pending, 1);
  assert.equal(hungSignal?.aborted, false);
  await done;
  assert.equal(progress.length, 3);
  assert.equal(progress.at(-1)?.index, 1);
  assert.equal(progress.at(-1)?.result.status, "rejected");
  assert.equal(progress.at(-1)?.pending, 0);
  assert.equal(hungSignal?.aborted, true);
});

test("an aborted account scope publishes no results even if its transport returns later", { timeout: 1000 }, async () => {
  const late = deferred<string>(), started = deferred<void>(), parent = new AbortController();
  const progress: CreatorSectionResult<string>[] = [];
  let child: AbortSignal | undefined;
  const done = loadCreatorSections([signal => { child = signal; started.resolve(); return late.promise; }], parent.signal, value => progress.push(value), 100);
  await started.promise;
  parent.abort();
  await done;
  assert.equal(child?.aborted, true);
  late.resolve("原账号的迟到作品");
  await Promise.resolve();
  assert.deepEqual(progress, []);
});

test("a response arriving after its deadline cannot replace the timeout or duplicate a branch", { timeout: 1000 }, async () => {
  const late = deferred<string>(), progress: CreatorSectionResult<string>[] = [];
  await loadCreatorSections([() => late.promise], new AbortController().signal, value => progress.push(value), 20);
  assert.equal(progress.length, 1);
  assert.equal(progress[0].result.status, "rejected");
  late.resolve("迟到成功");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(progress.length, 1);
  assert.equal(progress[0].result.status, "rejected");
});

test("a synchronous loader failure is isolated from successful and empty libraries", async () => {
  const progress: CreatorSectionResult<string[]>[] = [];
  await loadCreatorSections([() => { throw new Error("暂时无法读取小说"); }, async () => [], async () => ["游戏"]], new AbortController().signal, value => progress.push(value));
  assert.equal(progress.length, 3);
  assert.equal(progress.find(value => value.index === 0)?.result.status, "rejected");
  assert.deepEqual(progress.find(value => value.index === 1)?.result, { status: "fulfilled", value: [] });
  assert.deepEqual(progress.find(value => value.index === 2)?.result, { status: "fulfilled", value: ["游戏"] });
  assert.equal(progress.at(-1)?.pending, 0);
});
