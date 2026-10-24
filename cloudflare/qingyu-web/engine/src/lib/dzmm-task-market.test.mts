import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import clientModule from "./dzmm-task-market";
import type { TaskMarketDraftSnapshot, TaskMarketTask, TaskMarketAssignment } from "./dzmm-task-market";
const { fetchTaskMarket, fetchTaskMarketDetail, claimTaskMarketTask, reviewTaskMarketWork, publishTaskMarketTask,
  readTaskMarketDraft, saveTaskMarketDraft, composeTaskMarketInstructions, TaskMarketError } = clientModule as typeof import("./dzmm-task-market");
const realFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  globalThis.fetch = realFetch;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
});
function storage() {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
  } } });
  return map;
}
function snapshot(): TaskMarketDraftSnapshot {
  return { schemaVersion: 1, accountId: "owner-a", publishing: true,
    form: { title: " 原创港城地图 ", description: " 地图与行动衔接 ", requirements: " 一条具体建议 ", category: "feedback", characterId: "", rewardPoints: 10, slots: 2, hours: 24 },
    workDrafts: { "task-a": { text: "  原创草稿\n灯塔🌊\n  ", revision: 3 } },
    attempt: { accountId: "owner-a", requestId: "11111111-1111-4111-8111-111111111111", title: "原创港城地图", description: "地图与行动衔接", requirements: "一条具体建议", category: "feedback", characterId: null, rewardPoints: 10, slots: 2, deadlineAt: 1 },
  };
}
function task(): TaskMarketTask {
  return { id: "task-a", owner: { id: "publisher", nickname: "原创发布者" }, title: "原创委托", description: "普通地图反馈", requirements: "提出建议", category: "feedback", characterId: null, characterName: null, rewardPoints: 10, slots: 2, remainingSlots: 1, deadlineAt: 100, status: "open", version: 1, createdAt: 1, updatedAt: 1, hidden: false, participating: true, approvedCount: 0, submissionCount: 0, reviewReason: "", canClaim: false };
}
function assignment(): TaskMarketAssignment {
  return { id: "assignment-a", taskId: "task-a", userId: "player-a", status: "claimed", version: 1, createdAt: 1, updatedAt: 1, submittedAt: null, reviewedAt: null, reviewReason: "", rewardPoints: 10 };
}
const invalid = (error: unknown) => error instanceof TaskMarketError && error.status === 502;

test("task drafts preserve verbatim work, original frozen request and expired replay without crossing account keys", () => {
  storage(); const saved = snapshot(); saveTaskMarketDraft(saved);
  assert.deepEqual(readTaskMarketDraft("owner-a"), saved);
  assert.equal(readTaskMarketDraft("owner-b"), null);
});
test("foreign identity and changed frozen content reject without overwriting stored original", () => {
  const map = storage(), key = "xumeng-task-market-draft-v1:owner-a";
  for (const value of [{ ...snapshot(), accountId: "owner-b" }, { ...snapshot(), attempt: { ...snapshot().attempt!, title: "另一个任务" } }]) {
    const raw = JSON.stringify(value); map.set(key, raw);
    assert.throws(() => readTaskMarketDraft("owner-a"), /草稿格式无效|不一致/);
    assert.equal(map.get(key), raw);
  }
});
test("corrupt and oversized draft reads surface an error and retain recoverable raw data", () => {
  const map = storage(), key = "xumeng-task-market-draft-v1:owner-a";
  for (const raw of ["{bad-json", "x".repeat(1000001)]) {
    map.set(key, raw); assert.throws(() => readTaskMarketDraft("owner-a")); assert.equal(map.get(key), raw);
  }
});
test("detail rejects wrong account, wrong requested task, and cross-task assignment", async () => {
  const value = { accountId: "player-a", task: task(), assignment: assignment(), submissions: [] };
  globalThis.fetch = async () => Response.json({ ...value, accountId: "player-b" });
  await assert.rejects(fetchTaskMarketDetail("player-a", "task-a"), error => error instanceof TaskMarketError && error.status === 409);
  globalThis.fetch = async () => Response.json(value);
  await assert.rejects(fetchTaskMarketDetail("player-a", "task-b"), invalid);
  globalThis.fetch = async () => Response.json({ ...value, assignment: { ...assignment(), taskId: "task-b" } });
  await assert.rejects(fetchTaskMarketDetail("player-a", "task-a"), invalid);
});
test("claim and owner acceptance require their exact returned assignment identity", async () => {
  globalThis.fetch = async () => Response.json({ accountId: "player-a", task: task(), assignment: { ...assignment(), userId: "player-b" } });
  await assert.rejects(claimTaskMarketTask("player-a", "task-a"), invalid);
  globalThis.fetch = async () => Response.json({ accountId: "publisher", task: task(), assignment: assignment() });
  await assert.rejects(reviewTaskMarketWork("publisher", "task-a", "other-assignment", 1, "approved"), invalid);
});
test("network-lost publication is uncertain, and explicit retry sends the identical frozen body", async () => {
  const frozen = snapshot().attempt!, bodies: string[] = [];
  globalThis.fetch = async (_input, options) => { bodies.push(String(options?.body)); throw new Error("lost response"); };
  await assert.rejects(publishTaskMarketTask(frozen), error => error instanceof TaskMarketError && error.uncertain);
  globalThis.fetch = async (_input, options) => { bodies.push(String(options?.body)); return Response.json({ accountId: frozen.accountId, task: { ...task(), owner: { id: frozen.accountId, nickname: "原创发布者" } } }); };
  await publishTaskMarketTask(frozen); assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]);
});

test("joined listing sends the participant filter while keeping account validation", async () => {
  let requested = "";
  globalThis.fetch = async input => {
    requested = String(input);
    return Response.json({ accountId: "player-a", pointsKind: "credit", modelBillingLinked: true,
      tasks: [task()], total: 1, offset: 0, limit: 20, hasMore: false });
  };
  assert.equal((await fetchTaskMarket("player-a", { filter: "joined" })).tasks[0].participating, true);
  assert.equal(new URL(requested, "https://app.test").searchParams.get("filter"), "joined");
  await assert.rejects(fetchTaskMarket("player-b", { filter: "joined" }), error => error instanceof TaskMarketError && error.status === 409);
});

test("a never-returning write aborts at 20 seconds, reports an uncertain result and never retries", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | null | undefined;
  let calls = 0;
  globalThis.fetch = async (_input, options) => {
    calls++; signal = options?.signal;
    return new Promise<Response>(() => undefined);
  };
  const pending = claimTaskMarketTask("player-a", "task-a");
  const rejected = assert.rejects(pending, error => error instanceof TaskMarketError && error.status === 504
    && error.uncertain && /无法确认操作结果.*刷新任务状态/.test(error.message));
  t.mock.timers.tick(19_999);
  assert.equal(signal?.aborted, false);
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(signal?.aborted, true);
  t.mock.timers.tick(60_000);
  assert.equal(calls, 1);
});

test("a never-returning read aborts at 20 seconds with a retry prompt and no uncertain mutation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, options) => {
    signal = options?.signal;
    return new Promise<Response>(() => undefined);
  };
  const rejected = assert.rejects(fetchTaskMarketDetail("player-a", "task-a"), error => error instanceof TaskMarketError
    && error.status === 504 && !error.uncertain && /读取超时.*刷新状态后重试/.test(error.message));
  t.mock.timers.tick(20_000);
  await rejected;
  assert.equal(signal?.aborted, true);
});

test("the same 20 second write deadline includes a response body that never finishes", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | null | undefined;
  let calls = 0;
  let deliver!: (response: Response) => void;
  let reading!: () => void;
  const readingStarted = new Promise<void>(resolve => { reading = resolve; });
  const response = new Response(new ReadableStream<Uint8Array>(), { status: 201 });
  const readJson = response.json.bind(response);
  response.json = () => { reading(); return readJson(); };
  globalThis.fetch = async (_input, options) => {
    calls++; signal = options?.signal;
    return new Promise<Response>(resolve => { deliver = resolve; });
  };
  const rejected = assert.rejects(claimTaskMarketTask("player-a", "task-a"), error => error instanceof TaskMarketError
    && error.status === 504 && error.uncertain);
  t.mock.timers.tick(19_000);
  deliver(response);
  await readingStarted;
  t.mock.timers.tick(999);
  assert.equal(signal?.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(signal?.aborted, true);
  assert.equal(calls, 1);
});

test("completed and rejected responses clear their deadline instead of aborting later", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const signals: (AbortSignal | null | undefined)[] = [];
  const value = { accountId: "player-a", task: task(), assignment: assignment(), submissions: [] };
  globalThis.fetch = async (_input, options) => { signals.push(options?.signal); return Response.json(value); };
  assert.equal((await fetchTaskMarketDetail("player-a", "task-a")).assignment?.status, "claimed");
  await assert.rejects(fetchTaskMarketDetail("player-b", "task-a"), error => error instanceof TaskMarketError && error.status === 409);
  t.mock.timers.tick(20_000);
  assert.equal(signals.length, 2);
  assert.ok(signals.every(signal => signal && !signal.aborted));
});

test("structured draft keeps blank rows and verbatim metadata but frozen request filters only blank rows", () => {
  storage(); const saved = snapshot();
  saved.form.instructions = { goal: "  完成港城巡航\n🌊  ", constraints: [" 保持角色一致 ", ""], rules: [" 先调查故障 ", " ", "再寻找材料"] };
  saved.attempt!.instructions = composeTaskMarketInstructions(saved.form.instructions);
  saveTaskMarketDraft(saved); assert.deepEqual(readTaskMarketDraft("owner-a"), saved);
  assert.deepEqual(saved.attempt!.instructions, { goal: "  完成港城巡航\n🌊  ", constraints: [" 保持角色一致 "], rules: [" 先调查故障 ", "再寻找材料"] });
});
test("old frozen publish body stays omitted; changed rule order rejects without overwriting", async () => {
  const map = storage(), saved = snapshot(), key = "xumeng-task-market-draft-v1:owner-a";
  saveTaskMarketDraft(saved); const old = readTaskMarketDraft("owner-a")!;
  assert.equal(Object.hasOwn(old.attempt!, "instructions"), false);
  const bodies: string[] = [];
  globalThis.fetch = async (_input, options) => { bodies.push(String(options?.body)); return Response.json({ accountId: saved.accountId, task: { ...task(), owner: { id: saved.accountId, nickname: "作者" } } }); };
  await publishTaskMarketTask(old.attempt!); assert.equal(bodies[0], JSON.stringify(saved.attempt));
  saved.form.instructions = { goal: "巡航", constraints: [], rules: ["先调查", "再修复"] };
  saved.attempt!.instructions = { ...saved.form.instructions, rules: ["再修复", "先调查"] };
  const raw = JSON.stringify(saved); map.set(key, raw); assert.throws(() => readTaskMarketDraft("owner-a"), /不一致/); assert.equal(map.get(key), raw);
});
test("oversized combined unfinished instructions remain recoverable while publication validates total", () => {
  storage(); const saved = snapshot(); saved.attempt = null;
  saved.form.instructions = { goal: "目".repeat(4000), constraints: [], rules: Array.from({ length: 20 }, () => "规".repeat(500)) };
  saveTaskMarketDraft(saved); assert.deepEqual(readTaskMarketDraft("owner-a"), saved);
  assert.throws(() => composeTaskMarketInstructions(saved.form.instructions), /12,000/);
});
test("invalid instruction DTO is rejected; structured ordinary content remains verbatim", async () => {
  const value = { accountId: "player-a", task: task(), assignment: assignment(), submissions: [] };
  for (const instructions of [null, { goal: "x", constraints: [], rules: [], automatic: true }, { goal: "x", constraints: [""], rules: [] }]) {
    globalThis.fetch = async () => Response.json({ ...value, task: { ...value.task, instructions } });
    await assert.rejects(fetchTaskMarketDetail("player-a", "task-a"), invalid);
  }
  const instructions = { goal: "目标\n🌊", constraints: ["普通约束"], rules: ["<b>原样文字</b>"] };
  globalThis.fetch = async () => Response.json({ ...value, task: { ...value.task, instructions } });
  assert.deepEqual((await fetchTaskMarketDetail("player-a", "task-a")).task.instructions, instructions);
});
