import test from "node:test";
import assert from "node:assert/strict";
import handlerModule from "./dzmm-chat-handler";
import streamModule from "./dzmm-world-stream";
import stateModule from "./dzmm-world-state";
import type { DzmmWorldContext } from "./dzmm-chat";
import type { DzmmWorldState } from "./dzmm-world-state";
import type { DzmmBillingCompletion, DzmmBillingLifecycle, DzmmBillingPreflight } from "./dzmm-generation-billing";

const { handleDzmmChatPost } = handlerModule as typeof import("./dzmm-chat-handler");
const { readDzmmWorldResponse, WORLD_OPEN, WORLD_CLOSE } = streamModule as typeof import("./dzmm-world-stream");
const { createDzmmWorldState, appendDzmmWorldSnapshot, recordDzmmWorldModeChange, resolveDzmmWorldRuntime } = stateModule as typeof import("./dzmm-world-state");
const encoder = new TextEncoder();
const NOW = Date.UTC(2026, 9, 6, 4, 30);
const env = { DZMM_API_KEY: "local-test-placeholder", DZMM_BASE_URL: "https://provider.test/v1", DZMM_MODEL: "test/model" };
const prose = "她带你走进书店，把旧地图放在桌上。🌦️";
const user = "请把旧地图拿给我看看。";
const validPatch = { version: 1, changes: [
  { type: "location", value: "书店", from: "assistant", quote: "走进书店" },
  { type: "fact", action: "add", text: "旧地图已在桌上", from: "assistant", quote: "把旧地图放在桌上" },
] };

function delta(content: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}
function metadata(proposal: unknown) { return WORLD_OPEN + JSON.stringify(proposal) + WORLD_CLOSE; }
function prior(): DzmmWorldState {
  return { ...createDzmmWorldState(), location: "书店门口", facts: ["店员答应帮助找地图"],
    relationships: [{ name: "店员", affinity: 4, trust: 2, tension: 1, note: "初步熟悉" }],
    threads: [{ id: "map", kind: "goal", text: "查看旧地图", status: "open", dueAtMinute: null }] };
}
function request(world?: DzmmWorldContext, maxTokens = 2048, signal?: AbortSignal, content = user) {
  return new Request("https://app.test/api/dzmm/chat", { method: "POST", signal,
    body: JSON.stringify({ character: { name: "地图保管员" }, messages: [{ role: "user", content }],
      model: "story", maxTokens, ...(world ? { world } : {}) }) });
}
function providerResponse(chunks: string[], oneByte = false) {
  const bytes = oneByte ? Array.from(encoder.encode(chunks.join("")), byte => Uint8Array.of(byte)) : chunks.map(chunk => encoder.encode(chunk));
  let index = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < bytes.length) controller.enqueue(bytes[index++]);
      else controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
}
function billingSpy() {
  const preflights: DzmmBillingPreflight[] = [], completions: DzmmBillingCompletion[] = [];
  const billing: DzmmBillingLifecycle = { async reserve(preflight) {
    preflights.push(preflight);
    return { async finalize(completion) { completions.push(completion); } };
  } };
  return { billing, preflights, completions };
}

test("mode timeline survives regeneration through strict request and response handling without repeating a story jump", async () => {
  const minute = 60_000, start = NOW - 1451 * minute;
  const history = ["开场", "核对旧图", "旧图已核对", "等30分钟", "后来走到西厅"].map((content, i) => ({
    id: `timeline-${i}`, role: i % 2 ? "user" as const : "assistant" as const, content,
  }));
  const before = createDzmmWorldState(); before.location = "图书馆门口";
  let journal = appendDzmmWorldSnapshot(undefined, history.slice(0, 3), before, start, "realtime");
  const after = structuredClone(before); after.clock.elapsedMinutes = 40;
  after.location = "西厅"; after.facts = ["后来进入西厅"];
  journal = appendDzmmWorldSnapshot(journal, history, after, start + 10 * minute, "realtime");
  journal = recordDzmmWorldModeChange(journal, history, start + 10 * minute, "story");
  journal = appendDzmmWorldSnapshot(journal, history, after, start + 10 * minute, "story");
  journal = recordDzmmWorldModeChange(journal, history, start + 1450 * minute, "realtime");
  journal = appendDzmmWorldSnapshot(journal, history, after, start + 1450 * minute, "realtime");
  let calls = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prefix = history.slice(0, -1);
    const runtime = resolveDzmmWorldRuntime(journal, prefix, NOW, "realtime")!;
    assert.equal(runtime.state.clock.elapsedMinutes, 11);
    assert.equal(runtime.state.location, "图书馆门口");
    assert.deepEqual(runtime.state.facts, []);
    const response = await handleDzmmChatPost(request({ clockMode: "realtime", ...runtime, previousClockMode: runtime.clockMode },
      2048, undefined, "等30分钟"), env, {
      now: () => NOW, providerFetch: async () => { calls++; return providerResponse([delta("半小时后，你们继续核对地图。"), "data: [DONE]\n\n"]); },
    });
    assert.equal(response.status, 200);
    const result = await readDzmmWorldResponse(response, () => {});
    assert.equal(result.world?.state.clock.elapsedMinutes, 41, "Only active wall time and one explicit half-hour apply.");
    assert.equal(result.world?.recordedAt, NOW);
    history[4] = { ...history[4], id: `timeline-reply-${attempt}`, content: result.answer };
    journal = appendDzmmWorldSnapshot(journal, history, result.world!.state, NOW, "realtime");
  }
  assert.equal(calls, 2, "Provider calls are fully isolated mocks.");
});

test("one provider stream commits an evidenced patch atomically and keeps metadata out of visible Unicode prose", async () => {
  const state = prior(), before = structuredClone(state);
  const bodies: Array<{ messages: Array<{ role: string; content: string }>; max_tokens: number }> = [];
  const billing = billingSpy();
  const response = await handleDzmmChatPost(request({ clockMode: "story", state }), env, {
    now: () => NOW, billing: billing.billing,
    providerFetch: async (_url, options) => {
      bodies.push(JSON.parse(String(options!.body)));
      return providerResponse([delta(prose), delta(metadata(validPatch)),
        'data: {"id":"generation-world-test","choices":[],"usage":{"prompt_tokens":731,"completion_tokens":249}}\n\n',
        "data: [DONE]\n\n"], true);
    },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type")!, /text\/event-stream/);
  const visible: string[] = [];
  const result = await readDzmmWorldResponse(response, answer => visible.push(answer));
  assert.equal(result.answer, prose);
  assert.equal(result.world?.updated, true);
  assert.equal(result.world?.recordedAt, NOW);
  assert.deepEqual(result.world?.state, { ...before, location: "书店", facts: [...before.facts, "旧地图已在桌上"] });
  assert.deepEqual(state, before, "Applying a result must not mutate the input snapshot.");
  assert.ok(visible.every(answer => !answer.includes("xumeng-state") && !answer.includes('"changes"')));
  assert.equal(bodies.length, 1, "Hidden bookkeeping belongs to the reply call, not another paid generation.");
  assert.ok(bodies[0].messages.some(message => message.content.includes("隐藏世界状态协议")));
  assert.equal(billing.preflights.length, 1);
  assert.deepEqual(billing.completions, [{ outcome: "completed", hasValidOutput: true,
    usage: { promptTokens: 731, completionTokens: 249 }, generationId: "generation-world-test" }]);
});

test("an inexact quote or wrong provenance rejects the whole proposed patch, including earlier valid changes", async () => {
  for (const invalid of [
    { type: "fact", action: "add", text: "地图已带走", from: "assistant", quote: "把旧地图拿在手上" },
    { type: "fact", action: "add", text: "地图已在桌上", from: "user", quote: "把旧地图放在桌上" },
    { type: "relationship", name: "店员", affinityDelta: 999, from: "assistant", quote: "把旧地图放在桌上" },
  ]) {
    const state = prior();
    const patch = { version: 1, changes: [validPatch.changes[0], invalid] };
    const response = await handleDzmmChatPost(request({ clockMode: "story", state }), env, {
      now: () => NOW, providerFetch: async () => providerResponse([delta(prose + metadata(patch)), "data: [DONE]\n\n"]),
    });
    const result = await readDzmmWorldResponse(response, () => {});
    assert.equal(result.answer, prose);
    assert.equal(result.world?.updated, false);
    assert.deepEqual(result.world?.state, state);
  }
});

test("missing or damaged metadata preserves accepted facts and carries deterministic clock passage for each mode", async () => {
  for (const clockMode of ["story", "realtime"] as const) {
    for (const tail of ["", WORLD_OPEN + "{bad-json}" + WORLD_CLOSE, WORLD_OPEN + '{"version":1,', WORLD_OPEN.slice(0, 8)]) {
      const state = prior();
      state.clock = { elapsedMinutes: 10, day: 2, minuteOfDay: 1439, calendarLabel: "秋日", remainderMs: 10_000 };
      let prompt = "";
      const response = await handleDzmmChatPost(request({ clockMode, previousClockMode: clockMode, recordedAt: NOW - 125_000, state }), env, {
        now: () => NOW, providerFetch: async (_url, options) => {
          const messages = JSON.parse(String(options!.body)).messages as Array<{ content: string }>;
          prompt = messages.find(message => message.content.includes("隐藏世界状态协议"))!.content;
          return providerResponse([delta(prose), delta(tail), "data: [DONE]\n\n"]);
        },
      });
      const result = await readDzmmWorldResponse(response, () => {});
      const expected = structuredClone(state);
      if (clockMode === "realtime") expected.clock = { ...state.clock, elapsedMinutes: 12, day: 3, minuteOfDay: 1, remainderMs: 15_000 };
      assert.equal(result.answer, prose);
      assert.equal(result.world?.updated, false);
      assert.equal(result.world?.recordedAt, NOW);
      assert.deepEqual(result.world?.state, expected);
      assert.ok(prompt.includes(`当前世界状态：${JSON.stringify(expected)}`), "The model and committed state use the same request-time clock.");
    }
  }
});

test("switching to realtime starts a new baseline rather than charging time spent in story mode", async () => {
  const state = prior();
  const response = await handleDzmmChatPost(request({ clockMode: "realtime", previousClockMode: "story", recordedAt: NOW - 86_400_000, state }), env, {
    now: () => NOW, providerFetch: async () => providerResponse([delta(prose), "data: [DONE]\n\n"]),
  });
  const result = await readDzmmWorldResponse(response, () => {});
  assert.deepEqual(result.world?.state, state);
  assert.equal(result.world?.recordedAt, NOW);
});

test("three-year directives reach both the model and accepted state once even when metadata is missing or repeats the duration", async () => {
  const content = "三年后再次相遇";
  const duration = 3 * 365 * 1_440;
  for (const clockMode of ["story", "realtime"] as const) {
    for (const changes of [[], [{ type: "clock", from: "user", quote: content,
      explicitUserTimeJump: true, advanceMinutes: duration, day: 1 }]]) {
      const state = prior();
      state.clock = { elapsedMinutes: 90, day: 2, minuteOfDay: 900, calendarLabel: "冬至", remainderMs: 0 };
      let worldPrompt = "";
      const response = await handleDzmmChatPost(request({ clockMode, previousClockMode: clockMode,
        recordedAt: NOW - 120_000, state }, 2048, undefined, content), env, {
        now: () => NOW, providerFetch: async (_url, options) => {
          const messages = JSON.parse(String(options!.body)).messages as Array<{ content: string }>;
          worldPrompt = messages.find(message => message.content.includes("隐藏世界状态协议"))!.content;
          return providerResponse([delta("三年后，书店门口再次出现她的身影。"),
            ...(changes.length ? [delta(metadata({ version: 1, changes }))] : []), "data: [DONE]\n\n"]);
        },
      });
      const result = await readDzmmWorldResponse(response, () => {});
      const expected = structuredClone(state);
      expected.clock = { elapsedMinutes: state.clock.elapsedMinutes + duration + (clockMode === "realtime" ? 2 : 0),
        day: state.clock.day + 3 * 365, minuteOfDay: null, calendarLabel: "", remainderMs: 0 };
      assert.deepEqual(result.world?.state, expected);
      assert.ok(worldPrompt.includes(`当前世界状态：${JSON.stringify(expected)}`));
      assert.deepEqual(state.clock, { elapsedMinutes: 90, day: 2, minuteOfDay: 900, calendarLabel: "冬至", remainderMs: 0 });
    }
  }
});

test("quoted dialogue, future plans and memories do not advance deterministic story time", async () => {
  for (const content of ['她说：“三年后再次相遇。”', "我计划三年后再来", "回忆三年前再次相遇", "每天陪她聊天",
    "三年后，还能见到她吗？", "三年后，我还能认识她吗？"]) {
    const state = prior();
    const response = await handleDzmmChatPost(request({ clockMode: "story", state }, 2048, undefined, content), env, {
      now: () => NOW, providerFetch: async () => providerResponse([delta("她听完，把茶杯放在桌边。"), "data: [DONE]\n\n"]),
    });
    const result = await readDzmmWorldResponse(response, () => {});
    assert.deepEqual(result.world?.state, state, content);
  }
});

test("world bookkeeping honors the requested output cap and preserves raw provider billing usage", async () => {
  for (const maxTokens of [128, 512, 4096, 5000]) {
    const billing = billingSpy();
    const bodies: Array<{ max_tokens: number }> = [];
    const response = await handleDzmmChatPost(request({ clockMode: "story" }, maxTokens), env, {
      now: () => NOW, billing: billing.billing, providerFetch: async (_url, options) => {
        bodies.push(JSON.parse(String(options!.body)));
        return providerResponse([delta(prose + metadata(validPatch)),
          'data: {"choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":127}}\n\n', "data: [DONE]\n\n"]);
      },
    });
    await readDzmmWorldResponse(response, () => {});
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].max_tokens, Math.min(maxTokens, 4096));
    assert.equal(billing.preflights.length, 1);
    assert.equal(billing.preflights[0].maxOutputTokens, Math.min(maxTokens, 4096));
    assert.equal(billing.completions.length, 1);
    assert.deepEqual(billing.completions[0].usage, { promptTokens: 1000, completionTokens: 127 });
  }
});

test("provider error or premature EOF after hidden metadata sends no accepted world state", async () => {
  for (const ending of ["", 'event: error\ndata: {"error":{"message":"provider private failure"}}\n\n']) {
    const billing = billingSpy();
    const response = await handleDzmmChatPost(request({ clockMode: "story", state: prior() }), env, {
      now: () => NOW, billing: billing.billing,
      providerFetch: async () => providerResponse([delta(prose), delta(metadata(validPatch)), ending]),
    });
    assert.equal(response.status, 200);
    const wire = await response.text();
    assert.ok(wire.includes('"type":"text"'));
    assert.ok(wire.includes('"type":"error"'));
    assert.ok(!wire.includes('"type":"world"') && !wire.includes('"type":"done"'));
    assert.ok(!wire.includes("xumeng-state") && !wire.includes("provider private failure"));
    await assert.rejects(readDzmmWorldResponse(new Response(wire, { headers: { "Content-Type": "text/event-stream" } }), () => {}));
    assert.equal(billing.completions.length, 1);
    assert.equal(billing.completions[0].outcome, "failed");
  }
});

test("cancelling after visible text cancels upstream once without publishing metadata or committing a world event", async () => {
  let upstreamCancelled = 0;
  const billing = billingSpy();
  const response = await handleDzmmChatPost(request({ clockMode: "story", state: prior() }), env, {
    now: () => NOW, billing: billing.billing,
    providerFetch: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(encoder.encode(delta(prose))); },
      cancel() { upstreamCancelled++; },
    }), { headers: { "Content-Type": "text/event-stream" } }),
  });
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /"type":"text"/);
  assert.ok(!new TextDecoder().decode(first.value).includes('"type":"world"'));
  await reader.cancel();
  assert.equal(upstreamCancelled, 1);
  assert.equal(billing.completions.length, 1);
  assert.equal(billing.completions[0].outcome, "cancelled");
  assert.deepEqual(await reader.read(), { value: undefined, done: true });
});

test("request abort after the first delta becomes an error event and never accepts pending state", async () => {
  const abort = new AbortController();
  const billing = billingSpy();
  const response = await handleDzmmChatPost(request({ clockMode: "story", state: prior() }, 2048, abort.signal), env, {
    now: () => NOW, billing: billing.billing,
    providerFetch: async (_url, options) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(delta(prose)));
        options!.signal!.addEventListener("abort", () => controller.error(new Error("aborted upstream")), { once: true });
      },
    }), { headers: { "Content-Type": "text/event-stream" } }),
  });
  const reader = response.body!.getReader();
  let wire = new TextDecoder().decode((await reader.read()).value);
  abort.abort();
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    wire += new TextDecoder().decode(part.value);
  }
  assert.match(wire, /"type":"error"/);
  assert.ok(!wire.includes('"type":"world"') && !wire.includes('"type":"done"'));
  assert.equal(billing.completions.length, 1);
  assert.equal(billing.completions[0].outcome, "cancelled");
});

test("legacy requests keep plain-text responses without world framing or extra provider calls", async () => {
  let calls = 0;
  const response = await handleDzmmChatPost(request(), env, { now: () => NOW,
    providerFetch: async () => { calls++; return providerResponse([delta(prose), "data: [DONE]\n\n"]); } });
  assert.match(response.headers.get("Content-Type")!, /text\/plain/);
  assert.equal(await response.text(), prose);
  assert.equal(calls, 1);
});

test("malformed world context is rejected before provider calls or billing reservations", async () => {
  let calls = 0;
  const billing = billingSpy();
  const state = prior();
  for (const world of [null, [], { clockMode: "wall" }, { clockMode: "story", unknown: true },
    { clockMode: "story", recordedAt: NOW }, { clockMode: "story", previousClockMode: "wall" },
    { clockMode: "realtime", state, recordedAt: -1 }, { clockMode: "realtime", state, recordedAt: 1.5 },
    { clockMode: "realtime", state, recordedAt: 8_640_000_000_000_001 },
    { clockMode: "story", state: { ...state, extra: "not allowed" } },
    { clockMode: "story", state: { ...state, clock: { ...state.clock, minuteOfDay: 1440 } } },
  ]) {
    const payload = { character: { name: "保管员" }, messages: [{ role: "user", content: user }], world };
    const response = await handleDzmmChatPost(new Request("https://app.test/api/dzmm/chat", {
      method: "POST", body: JSON.stringify(payload),
    }), env, { now: () => NOW, billing: billing.billing,
      providerFetch: async () => { calls++; throw new Error("invalid world context must never call the provider"); } });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /世界状态|时间模式/);
  }
  assert.equal(calls, 0);
  assert.deepEqual(billing.preflights, []);
  assert.deepEqual(billing.completions, []);
});

test("world state participates in the total input context budget", async () => {
  const payload = { character: { name: "保管员" },
    messages: Array.from({ length: 7 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: "x".repeat(11_000) })) };
  const state = createDzmmWorldState();
  state.facts = Array.from({ length: 6 }, (_, index) => `fact-${index}:${"x".repeat(174)}`);
  let calls = 0;
  const providerFetch: typeof fetch = async () => { calls++; return providerResponse([delta(prose), "data: [DONE]\n\n"]); };
  const withoutWorld = await handleDzmmChatPost(new Request("https://app.test/api/dzmm/chat", {
    method: "POST", body: JSON.stringify(payload),
  }), env, { now: () => NOW, providerFetch });
  assert.equal(withoutWorld.status, 200, "The baseline fixture fits the context budget.");
  await withoutWorld.text();
  const withWorld = await handleDzmmChatPost(new Request("https://app.test/api/dzmm/chat", {
    method: "POST", body: JSON.stringify({ ...payload, world: { clockMode: "story", state } }),
  }), env, { now: () => NOW, providerFetch });
  assert.equal(withWorld.status, 400);
  assert.match(await withWorld.text(), /上下文过长/);
  assert.equal(calls, 1, "Only the request whose total context fits may reach the provider.");
});
