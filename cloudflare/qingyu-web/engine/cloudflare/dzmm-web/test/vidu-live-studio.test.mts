import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
const { WebSocketServer } = createRequire(import.meta.url)("ws") as { WebSocketServer: new (options: unknown) => any };
import { ViduLiveStudio, viduStudioLeasePrefix, viduStudioOwnerPrefix, type ViduStudioEnvironment } from "../src/vidu-live-studio";
import { handleLiveGateway, type LiveGatewayEnvironment } from "../src/live-gateway";
import { XUMENG_LIVE_VOICE_OPTIONS } from "../../../src/lib/xumeng-voices";
import { createXumengLiveScene } from "../../../src/lib/xumeng-live-scene";

const key = "isolated-provider-key-never-real", avatar = "data:image/png;base64,aGVsbG8=", account = "isolated-live-author";
type Value = Record<string, any>;
class Socket extends EventTarget {
  readyState = 0; frames: Value[] = []; accepted = false;
  accept() { this.readyState = 1; this.accepted = true; }
  send(raw: string) { assert.equal(this.readyState, 1); this.frames.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  remoteClose(code: number, reason: string, wasClean: boolean) { this.readyState = 3; this.dispatchEvent(Object.assign(new Event("close"), { code, reason, wasClean })); }
  message(type: number, payload: Value, fields: Value = {}) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type, payload, ...fields }) })); }
}
function store() {
  let data: unknown, alarm: number | null = null;
  return { get: async () => structuredClone(data), put: async (_: string, value: unknown) => { data = structuredClone(value); },
    setAlarm: async (at: number) => { alarm = at; }, deleteAlarm: async () => { alarm = null; }, getAlarm: async () => alarm,
    snapshot: () => structuredClone(data) as Value };
}
async function harness(options: { request?: (url: string, init: RequestInit) => Promise<Response>; storage?: ReturnType<typeof store>; createResponse?: Value; liveResponse?: Value; env?: Partial<ViduStudioEnvironment> } = {}) {
  let clock = 100_000, providerStatus = "on_live";
  const storage = options.storage ?? store(), jobs = new Set<Promise<unknown>>(), sockets: Socket[] = [], calls: { url: string; init: RequestInit }[] = [];
  const ctx = { storage, blockConcurrencyWhile: (fn: () => Promise<void>) => fn(), waitUntil: (job: Promise<unknown>) => { jobs.add(job); job.then(() => jobs.delete(job), () => jobs.delete(job)); } } as unknown as DurableObjectState;
  const upstream = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input); calls.push({ url, init });
    if (options.request) return options.request(url, init);
    if (url.includes("/ws/")) { const ws = new Socket(); sockets.push(ws); return { status: 101, webSocket: ws } as unknown as Response; }
    if (url.endsWith("/live/s_avatar/realtime")) return Response.json(options.createResponse ?? { live: { id: "original-live-001" }, rtc: { token: "isolated-rtc-token", user_id: "viewer-a" }, api_key: key });
    if (url.endsWith("/recording")) return Response.json({ recording: { video_url: "https://media.example/original-recording.mp4", key }, secret: key });
    if (/\/live\/v1\/lives\//.test(url)) return Response.json({ live: { id: "original-live-001", status: providerStatus, billed_seconds: 2, credits_cost: 3, api_key: key, ...options.liveResponse }, extra: key });
    return Response.json({ task_id: "original-task-a", state: "created", secret: key });
  };
  const env: ViduStudioEnvironment = { VIDU_API_KEY: key, VIDU_REGION: "global", ...options.env };
  const studio = new ViduLiveStudio(ctx, env, { fetch: upstream as typeof fetch, now: () => clock, timers: false });
  async function call(path: string, method = "GET", body?: unknown, identity = account, role = "super", signal?: AbortSignal) {
    const req = new Request("https://live-studio.internal" + path, { method, headers: { "X-Xumeng-Live-User": identity, "X-Xumeng-Live-Role": role, "Content-Type": "application/json" },
      ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}), signal });
    const response = await studio.fetch(req); return { status: response.status, data: await response.json() as Value };
  }
  const drain = async () => { while (jobs.size) await Promise.all([...jobs]); };
  const lease = async (identity = account, role = "super") => { const result = await call("/leases", "POST", {}, identity, role); assert.equal(result.status, 201); return result.data as { leaseId: string; cleanupToken: string }; };
  const start = async (id: string, mode = "real", role = "super") => call(`/leases/${id}/start`, "POST", { mode, avatar, persona: "原创成年虚拟主持人", voice: "Tina" }, account, role);
  return { studio, env, storage, sockets, calls, call, drain, lease, start, advance: (ms: number) => { clock += ms; }, setProviderStatus: (status: string) => { providerStatus = status; } };
}

test("private studio rejects paused image and video generation without any provider call or task", async () => {
  const h = await harness({ env: { GENERATION_ENABLED: "false" } }), lease = await h.lease(), path = `/leases/${lease.leaseId}`;
  for (const kind of ["image", "video"]) {
    const result = await h.call(path + "/generate", "POST", { kind, prompt: "原创地图室", images: [] });
    assert.equal(result.status, 503); assert.match(result.data.error, /暂停/);
  }
  assert.equal(h.calls.length, 0);
  assert.deepEqual((await h.call(path + "/status")).data.tasks, []);
  assert.equal((await h.call(path, "DELETE", { cleanupToken: lease.cleanupToken })).status, 200);
  assert.equal(h.calls.length, 0);
});

test("generation pause keeps an already created task queryable and leaves omitted or enabled configuration compatible", async () => {
  for (const setting of [undefined, "true"]) {
    const h = await harness({ env: { GENERATION_ENABLED: setting }, request: async url => {
      if (url.endsWith("/ent/v2/reference2image")) return Response.json({ task_id: "original-existing-material", state: "created" });
      if (url.endsWith("/ent/v2/tasks/original-existing-material/creations")) return Response.json({ state: "success", creations: [{ url: "https://media.example/original-map.png" }] });
      throw new Error("Unexpected isolated material request");
    } }), lease = await h.lease(), path = `/leases/${lease.leaseId}`;
    assert.equal((await h.call(path + "/generate", "POST", { kind: "image", prompt: "原创地图室", images: [] })).status, 200);
    assert.equal(h.calls.length, 1);
    h.env.GENERATION_ENABLED = "false";
    assert.equal((await h.call(path + "/generate", "POST", { kind: "video", prompt: "原创地图室", images: [] })).status, 503);
    assert.equal(h.calls.length, 1, "paused generation adds no provider request");
    const recovered = await h.call(path + "/task", "POST", { id: "original-existing-material" });
    assert.equal(recovered.status, 200); assert.equal(recovered.data.state, "success");
    assert.deepEqual(recovered.data.creations, [{ url: "https://media.example/original-map.png" }]);
    assert.equal(h.calls.length, 2);
    const status = await h.call(path + "/status");
    assert.equal(status.data.tasks.length, 1); assert.equal(status.data.tasks[0].id, "original-existing-material");
    assert.equal(h.calls.length, 2); await h.call(path, "DELETE", { cleanupToken: lease.cleanupToken });
  }
});

test("paused material generation leaves telephone start, speech, heartbeat, recording and stop operational", async () => {
  const h = await harness({ env: { GENERATION_ENABLED: "false" } }), lease = await h.lease(), path = `/leases/${lease.leaseId}`;
  const started = await h.start(lease.leaseId); assert.equal(started.status, 200);
  const id = started.data.session.id;
  h.sockets[0].message(2, { conn_init_ack: { success: true } }); await h.drain();
  assert.equal((await h.call(path + "/danmaku", "POST", { id, name: "原创玩家", text: "我们核对地图吧。" })).status, 200);
  assert.equal((await h.call(path + "/heartbeat", "POST", { id })).status, 200);
  assert.equal((await h.call(path + "/interrupt", "POST", { id })).status, 200);
  const recording = await h.call(path + "/recording", "POST");
  assert.equal(recording.status, 200); assert.deepEqual(recording.data.recording, { video_url: "https://media.example/original-recording.mp4" });
  h.setProviderStatus("ended");
  const stopped = await h.call(path + "/stop", "POST", { id });
  assert.equal(stopped.status, 200); assert.equal(stopped.data.providerTermination, "confirmed");
  assert.deepEqual(h.sockets[0].frames.map(frame => frame.type), [1, 99, 7, 5]);
  assert.equal(h.calls.some(call => call.url.includes("/ent/v2/")), false);
  await h.call(path, "DELETE", { cleanupToken: lease.cleanupToken });
});
test("native studio rejects public origins, invalid identity and unsupported methods", async () => {
  const h = await harness();
  assert.equal((await h.studio.fetch(new Request("https://public.example/status"))).status, 404);
  assert.equal((await h.studio.fetch(new Request("https://live-studio.internal/status"))).status, 401);
  assert.equal((await h.call("/status", "POST")).status, 405);
  assert.equal((await h.call("/status?other=1")).status, 404);
  assert.equal(h.calls.length, 0);
});
test("availability metadata survives reconstruction; unknown cleanup cannot initialize an owner", async () => {
  const h = await harness(); assert.equal((await h.call("/status")).status, 200); await h.drain();
  const restored = await harness({ storage: h.storage }); assert.equal((await restored.call("/status")).status, 200); await restored.lease();
  const empty = await harness(); assert.equal((await empty.call("/leases/00000000-0000-0000-0000-000000000000", "DELETE", { cleanupToken: "a".repeat(64) }, "lease_cleanup", "user")).status, 404);
  assert.equal(empty.storage.snapshot(), undefined);
});
test("three concurrent creates reserve exactly two leases and owner-prefixed cleanup routes", async () => {
  const h = await harness(), results = await Promise.all([h.call("/leases", "POST"), h.call("/leases", "POST"), h.call("/leases", "POST")]);
  assert.deepEqual(results.map(v => v.status), [201, 201, 429]);
  assert.equal(viduStudioLeasePrefix(results[0].data.leaseId), await viduStudioOwnerPrefix(account));
  assert.equal(h.storage.snapshot().leases.length, 2);
  assert.equal(JSON.stringify(h.storage.snapshot()).includes(results[0].data.cleanupToken), false);
});
test("logged-in accounts can start a real call and material generation stays closed", async () => {
  const h = await harness(), lease = await h.lease(account, "user"), path = `/leases/${lease.leaseId}`;
  for (const role of ["user", "super"]) {
    for (const mode of ["rehearsal", "fake", undefined]) {
      const result = await h.call(path + "/start", "POST", { mode, avatar }, account, role);
      assert.equal(result.status, 400); assert.match(result.data.error, /Vidu S2/);
    }
  }
  assert.equal((await h.call(path + "/generate", "POST", { kind: "image" }, account, "user")).status, 403);
  const started = await h.start(lease.leaseId, "real", "user");
  assert.equal(started.status, 200); assert.equal(started.data.session.mode, "real");
  assert.equal(h.calls.filter(call => call.url.endsWith("/live/s_avatar/realtime")).length, 1);
  assert.equal((await h.call("/status", "GET", undefined, account, "user")).data.realAllowed, true);
});
test("old rehearsal metadata remains recoverable and cleanup never calls Vidu", async () => {
  const original = await harness(), lease = await original.lease(), path = `/leases/${lease.leaseId}`;
  const stored = original.storage.snapshot();
  stored.leases[0].session = { id: "rehearsal-legacy-original", mode: "rehearsal", control: "performance", status: "ready", startedAt: 100_000 };
  await original.storage.put("studio", stored);
  const recovered = await harness({ storage: original.storage });
  const status = await recovered.call(path + "/status", "GET", undefined, account, "user");
  assert.equal(status.data.session.mode, "rehearsal"); assert.equal(status.data.session.status, "ended"); assert.equal(status.data.providerTermination, "confirmed");
  assert.equal((await recovered.call(path + "/stop", "POST", { id: "wrong" }, account, "user")).status, 409);
  assert.equal((await recovered.call(path + "/stop", "POST", { id: "rehearsal-legacy-original" }, account, "user")).status, 200);
  assert.equal((await recovered.call(path, "DELETE", { cleanupToken: lease.cleanupToken }, "lease_cleanup", "user")).data.ended, true);
  assert.equal((await recovered.call(path + "/status")).status, 404); assert.equal(recovered.calls.length, 0);
});
test("real create uses global S2, idle30min, control frames, scoped RTC and recording whitelist", async () => {
  const h = await harness(), lease = await h.lease(), path = `/leases/${lease.leaseId}`, started = await h.start(lease.leaseId);
  assert.equal(started.status, 200); assert.equal(started.data.session.status, "connecting");
  assert.deepEqual(started.data.rtc, { token: "isolated-rtc-token", user_id: "viewer-a" });
  const create = h.calls.find(call => call.url.endsWith("/live/s_avatar/realtime"))!, body = JSON.parse(create.init.body as string);
  assert.equal(create.url, "https://api.vidu.com/live/s_avatar/realtime"); assert.equal(body.model, "vidu-s2"); assert.equal(body.idle_timeout_seconds, 1800);
  assert.equal(new Headers(create.init.headers).get("Authorization"), `Token ${key}`);
  const socket = h.sockets[0]; assert.equal(socket.accepted, true); assert.equal(socket.frames[0].type, 1);
  socket.message(2, { conn_init_ack: { success: true, secret: key } }); await h.drain();
  const id = started.data.session.id;
  await h.call(path + "/execute", "POST", { id, motion: "挥手" });
  await h.call(path + "/references", "POST", { id, images: [{ kind: "background", url: avatar, description: "书店背景" }] });
  await h.call(path + "/interrupt", "POST", { id });
  assert.deepEqual(socket.frames.map(frame => frame.type), [1, 99, 11, 7]);
  socket.message(10, { text_msg: { content: `Token ${key}` }, secret: key }); await h.drain();
  const recording = await h.call(path + "/recording", "POST"); assert.deepEqual(recording.data.recording, { video_url: "https://media.example/original-recording.mp4" });
  const status = await h.call(path + "/status"); assert.equal(JSON.stringify(status).includes(key), false);
  const persisted = JSON.stringify(h.storage.snapshot());
  for (const privateValue of [key, "isolated-rtc-token", avatar, "原创成年虚拟主持人", "书店背景"]) assert.equal(persisted.includes(privateValue), false);
  h.setProviderStatus("ended"); const stopped = await h.call(path + "/stop", "POST", { id });
  assert.equal(stopped.data.providerTermination, "confirmed"); assert.equal(socket.frames.at(-1)!.type, 5); assert.equal(socket.readyState, 3);
  const final = await h.call(path + "/status"); assert.equal(final.data.providerStatus, "ended"); assert.equal(final.data.billedSeconds, 2); assert.equal(final.data.creditsCost, 3);
  assert.equal(final.data.session.reason, "Vidu 已确认结束");
});
test("character interaction sends current scene and player event only to the same ready real session", async () => {
  const h = await harness(), lease = await h.lease(), path = `/leases/${lease.leaseId}`, started = await h.start(lease.leaseId), id = started.data.session.id;
  const scene = { ...createXumengLiveScene("原创场景"), situation: "次日地图室", goal: "核实新的航线", ended: "离开旧码头，雨已停", relationship: "因玩家交回原件而愿意配合", recentDialogue: [{ role: "character" as const, text: "我们先检查这条线。" }] };
  const interaction = { id, kind: "action", name: "玩家", text: "我把潮汐记录放到桌上。", scene };
  assert.equal((await h.call(path + "/interaction", "POST", interaction)).status, 409);
  h.sockets[0].message(2, { conn_init_ack: { success: true } }); await h.drain();
  assert.equal((await h.call(path + "/interaction", "POST", { ...interaction, id: "old-session" })).status, 409);
  assert.equal((await h.call(path + "/interaction", "POST", interaction, account, "user")).status, 200);
  assert.equal((await h.call(path + "/interaction", "POST", { ...interaction, scene: { ...scene, futureBranch: "secret" } })).status, 400);
  assert.equal((await h.call(path + "/interaction", "POST", interaction)).status, 200);
  const frames = h.sockets[0].frames.filter(frame => frame.type === 99); assert.equal(frames.length, 2);
  const content = frames[0].payload.text_msg.content;
  for (const expected of ["次日地图室", "核实新的航线", "离开旧码头，雨已停", "因玩家交回原件而愿意配合", "我们先检查这条线。", "我把潮汐记录放到桌上。", "区分想做和已经做"]) assert.ok(content.includes(expected));
  const status = (await h.call(path + "/status")).data;
  assert.equal(status.events.at(-1).type, "interaction"); assert.match(status.events.at(-1).data.delivery, /等待人物回应/);
  const saved = JSON.stringify(h.storage.snapshot());
  for (const privateText of ["次日地图室", "我把潮汐记录放到桌上。", "核实新的航线"]) assert.equal(saved.includes(privateText), false);
  h.setProviderStatus("ended"); await h.call(path + "/stop", "POST", { id });
});
test("provider subtitle replays are idempotent, revisions replace, and new sessions exclude old events", async () => {
  let liveId = "original-subtitle-live-1", createCount = 0;
  const sockets: Socket[] = [];
  const h = await harness({ request: async (url) => {
    if (url.includes("/ws/")) { const ws = new Socket(); sockets.push(ws); return { status: 101, webSocket: ws } as unknown as Response; }
    if (url.endsWith("/live/s_avatar/realtime")) { liveId = `original-subtitle-live-${++createCount}`; return Response.json({ live: { id: liveId }, rtc: { token: "isolated-rtc-subtitle", user_id: "isolated-viewer" } }); }
    if (/\/live\/v1\/lives\//.test(url)) return Response.json({ live: { id: liveId, status: "ended", billed_seconds: 0, credits_cost: 0 } });
    throw new Error("Unexpected isolated provider route");
  } });
  const lease = await h.lease(), path = `/leases/${lease.leaseId}`, first = await h.start(lease.leaseId);
  sockets[0].message(2, { conn_init_ack: { success: true } }); await h.drain();
  const payload = { text_msg: { msg_id: "subtitle-original-1", content: "我们先核对" } };
  sockets[0].message(10, payload); sockets[0].message(10, payload); await h.drain();
  let events = (await h.call(path + "/status")).data.events.filter((event: Value) => event.type === "transcript");
  assert.equal(events.length, 1); assert.equal(events[0].revision, 0); assert.equal(events[0].sessionId, first.data.session.id);
  const originalId = events[0].id;
  const revision = { text_msg: { msg_id: "subtitle-original-1", content: "我们先核对第三页。" } };
  sockets[0].message(10, revision); sockets[0].message(10, revision); await h.drain();
  sockets[0].message(10, payload); await h.drain();
  events = (await h.call(path + "/status")).data.events.filter((event: Value) => event.type === "transcript");
  assert.equal(events.length, 1); assert.equal(events[0].id, originalId); assert.equal(events[0].revision, 1); assert.equal(events[0].data.text, "我们先核对第三页。");
  await h.call(path + "/stop", "POST", { id: first.data.session.id });
  const second = await h.start(lease.leaseId); assert.notEqual(second.data.session.id, first.data.session.id);
  sockets[1].message(2, { conn_init_ack: { success: true } });
  sockets[1].message(10, payload, { live_id: first.data.session.id }); sockets[0].message(10, payload); await h.drain();
  let status = (await h.call(path + "/status")).data; assert.equal(status.events.filter((event: Value) => event.type === "transcript").length, 0);
  sockets[1].message(10, payload, { live_id: second.data.session.id }); await h.drain();
  status = (await h.call(path + "/status")).data; assert.equal(status.events.filter((event: Value) => event.type === "transcript").length, 1);
  assert.equal(status.events.every((event: Value) => event.sessionId === second.data.session.id), true);
  const saved = JSON.stringify(h.storage.snapshot()); assert.equal(saved.includes("subtitle-original-1"), false); assert.equal(saved.includes("我们先核对"), false);
  await h.call(path + "/stop", "POST", { id: second.data.session.id });
});
test("initialization errors persist a bounded safe code and fixed explanation without another create", async () => {
  for (const code of ["LIVE_CONN_INIT_FAILED", "SIP_READY_TIMEOUT", "UNKNOWN_UPSTREAM_ERROR", `BAD_${key}`]) {
    const h = await harness(), lease = await h.lease(), started = await h.start(lease.leaseId), path = `/leases/${lease.leaseId}`;
    h.setProviderStatus("ended");
    h.sockets[0].message(2, { conn_init_ack: { success: false, error_code: code, error_msg: `private message ${key} isolated-rtc-token ${avatar}` } }); await h.drain();
    const state = (await h.call(path + "/status")).data;
    assert.equal(state.session.status, "ended"); assert.equal(state.providerTermination, "confirmed");
    assert.equal(state.lastStartError.source, "initialization"); assert.match(state.lastStartError.message, /S2/);
    assert.equal(state.lastStartError.code, code.startsWith("BAD_") ? undefined : code);
    assert.match(state.session.reason, /Vidu 已确认结束.*S2/);
    assert.deepEqual(h.sockets[0].frames.map(frame => frame.type), [1, 5]);
    assert.equal(h.calls.filter(call => call.url.endsWith("/live/s_avatar/realtime")).length, 1);
    await h.call(path + "/stop", "POST", { id: started.data.session.id });
    const restored = await harness({ storage: h.storage }), recovered = (await restored.call(path + "/status")).data;
    assert.deepEqual(recovered.lastStartError, state.lastStartError); assert.equal(recovered.session.reason, state.session.reason);
    assert.equal(restored.calls.length, 0);
    const metadata = JSON.stringify(h.storage.snapshot());
    for (const secret of [key, "isolated-rtc-token", avatar]) assert.equal(metadata.includes(secret), false);
  }
});
test("initialization dependency detail and strict trace survive stop/restart with no raw credentials or content", async () => {
  const clientSecret = "isolated-client-capability", rtcToken = "isolated-rtc-secret-for-detail";
  const h = await harness({ createResponse: { live: { id: "original-live-001", trace_id: "trace-create-original" }, rtc: { token: rtcToken, user_id: "viewer-a" }, client_secret: clientSecret } });
  const lease = await h.lease(), path = `/leases/${lease.leaseId}`, started = await h.start(lease.leaseId);
  assert.equal((await h.call(path + "/status")).data.providerTraceId, "trace-create-original");
  h.setProviderStatus("ended");
  h.sockets[0].message(2, { conn_init_ack: { success: false, error_code: "LIVE_CONN_INIT_FAILED", trace_id: "trace-init-original",
    error_msg: `Failed to connect qwen realtime websocket; ${key}; ${rtcToken}; ${clientSecret}; ${avatar}; 原创成年虚拟主持人; ${lease.cleanupToken}; https://upstream.example/connect?api_key=unknown-private-query` } });
  await h.drain();
  const state = (await h.call(path + "/status")).data;
  assert.equal(state.providerTraceId, "trace-init-original"); assert.equal(state.lastStartError.traceId, "trace-init-original");
  assert.equal(state.lastStartError.dependencyCode, "QWEN_REALTIME_CONNECT_FAILED");
  assert.match(state.lastStartError.providerDetail, /Failed to connect qwen realtime websocket/);
  assert.match(state.lastStartError.message, /上游 Qwen 实时语音依赖连接失败/);
  assert.ok(state.lastStartError.providerDetail.length <= 400);
  const publicAndSaved = JSON.stringify([state, h.storage.snapshot()]);
  for (const privateValue of [key, rtcToken, clientSecret, avatar, "原创成年虚拟主持人", lease.cleanupToken, "unknown-private-query", "redactionTargets"])
    assert.equal(publicAndSaved.includes(privateValue), false, "sensitive detail is removed before persistence");
  await h.call(path + "/stop", "POST", { id: started.data.session.id });
  const restored = await harness({ storage: h.storage }), recovered = (await restored.call(path + "/status")).data;
  assert.deepEqual(recovered.lastStartError, state.lastStartError); assert.equal(recovered.providerTraceId, "trace-init-original");
  assert.equal(h.calls.filter(call => call.url.endsWith("/live/s_avatar/realtime")).length, 1); assert.equal(restored.calls.length, 0);
});
test("unrecognized credential labels fail closed and trace IDs reject secrets, URLs, malformed or oversized values", async () => {
  for (const trace of [key, "isolated-rtc-token", "vda_unknown_private_key", "https://example.test/trace?token=unsafe", "trace\nunsafe", "a".repeat(129), "cookie-private", "eyJprivateCredential"]) {
    const h = await harness({ createResponse: { live: { id: "original-live-001", trace_id: trace }, rtc: { token: "isolated-rtc-token", user_id: "viewer-a" } }, liveResponse: { trace_id: trace } });
    const lease = await h.lease(), path = `/leases/${lease.leaseId}`; await h.start(lease.leaseId); h.setProviderStatus("ended");
    h.sockets[0].message(2, { conn_init_ack: { success: false, error_code: "LIVE_CONN_INIT_FAILED", trace_id: trace, error_msg: "Qwen connection failed; authorization: unrecognized-private-value" } });
    await h.drain();
    const state = (await h.call(path + "/status")).data;
    assert.equal(state.providerTraceId, undefined); assert.equal(state.lastStartError.traceId, undefined); assert.equal(state.lastStartError.providerDetail, undefined);
    assert.equal(JSON.stringify(h.storage.snapshot()).includes("unrecognized-private-value"), false);
  }
});
test("diagnostic sanitation precedes truncation and revalidates restored fields", async () => {
  const h = await harness(), lease = await h.lease(), path = `/leases/${lease.leaseId}`; await h.start(lease.leaseId); h.setProviderStatus("ended");
  const privateJwt = "eyJ" + "a".repeat(700) + ".payload.signature";
  h.sockets[0].message(2, { conn_init_ack: { success: false, error_code: "LIVE_CONN_INIT_FAILED", error_msg: `Failed to connect qwen realtime websocket; ${privateJwt}; data:image/png;base64,${"b".repeat(700)}; ${"normal diagnostic ".repeat(50)}` } });
  await h.drain(); const state = (await h.call(path + "/status")).data;
  assert.ok(state.lastStartError.providerDetail.length <= 400); assert.match(state.lastStartError.providerDetail, /normal diagnostic/);
  for (const privatePrefix of [privateJwt.slice(0, 50), "data:image/png;base64", "b".repeat(50)]) assert.equal(JSON.stringify(h.storage.snapshot()).includes(privatePrefix), false);
  const saved = h.storage.snapshot(); saved.leases[0].providerTraceId = "https://private.example/?token=unsafe";
  saved.leases[0].lastStartError.traceId = "vda_not_a_trace"; saved.leases[0].lastStartError.providerDetail = "authorization: forged-private-value";
  await h.storage.put("studio", saved);
  const restored = await harness({ storage: h.storage }), recovered = (await restored.call(path + "/status")).data;
  assert.equal(recovered.providerTraceId, undefined); assert.equal(recovered.lastStartError.traceId, undefined);
  assert.equal(recovered.lastStartError.providerDetail, undefined); assert.equal(recovered.lastStartError.dependencyCode, undefined);
  assert.equal(JSON.stringify(restored.storage.snapshot()).includes("forged-private-value"), false);
});
test("provider force hangup stores only known reasons and preserves its explanation after stop and restart", async () => {
  for (const reason of ["credit_insufficient", "provider_closed", "client_reconnect_timeout", "prepared_sip_disconnected", "owner_taken_over", "owner_lease_lost", "ai_output_closed", "future_safe_reason", `private ${key} isolated-rtc-token`, "toString"]) {
    const h = await harness(), lease = await h.lease(), started = await h.start(lease.leaseId), path = `/leases/${lease.leaseId}`;
    h.setProviderStatus("ended"); h.sockets[0].message(6, { hangup: { hangup_reason: reason, private: key } }); await h.drain();
    const state = (await h.call(path + "/status")).data;
    const known = !reason.startsWith("private ") && reason !== "toString" && reason !== "future_safe_reason";
    assert.equal(state.providerEndReason, known ? reason : undefined); assert.equal(state.providerTermination, "confirmed");
    assert.match(state.session.reason, known ? new RegExp(reason) : /未提供可识别/);
    assert.deepEqual(h.sockets[0].frames.map(frame => frame.type), [1]);
    await h.call(path + "/stop", "POST", { id: started.data.session.id });
    const restored = await harness({ storage: h.storage }), recovered = (await restored.call(path + "/status")).data;
    assert.equal(recovered.providerEndReason, state.providerEndReason); assert.equal(recovered.session.reason, state.session.reason);
    const metadata = JSON.stringify(h.storage.snapshot()); assert.equal(metadata.includes(key), false); assert.equal(metadata.includes("isolated-rtc-token"), false);
    assert.equal(h.calls.filter(call => call.url.endsWith("/live/s_avatar/realtime")).length, 1); assert.equal(restored.calls.length, 0);
  }
});
test("unexpected control close persists numeric code and a fixed label but discards arbitrary reason text", async () => {
  for (const code of [1006, 1000, 1011, Infinity]) {
    const h = await harness(), lease = await h.lease(), started = await h.start(lease.leaseId), path = `/leases/${lease.leaseId}`;
    h.setProviderStatus("ended");
    h.sockets[0].remoteClose(code, `private WS reason ${key} isolated-rtc-token ${avatar}`, false); await h.drain();
    const state = (await h.call(path + "/status")).data;
    assert.equal(state.controlClose.code, Number.isFinite(code) ? code : null); assert.equal(state.controlClose.wasClean, false);
    assert.equal(state.lastStartError.source, "websocket"); assert.equal(state.lastStartError.code, Number.isFinite(code) ? `WS_${code}` : undefined);
    assert.match(state.session.reason, /Vidu 已确认结束.*控制连接/);
    await h.call(path + "/stop", "POST", { id: started.data.session.id });
    const restored = await harness({ storage: h.storage }), recovered = (await restored.call(path + "/status")).data;
    assert.deepEqual(recovered.controlClose, state.controlClose); assert.deepEqual(recovered.lastStartError, state.lastStartError); assert.equal(recovered.session.reason, state.session.reason);
    const metadata = JSON.stringify(h.storage.snapshot());
    for (const secret of [key, "isolated-rtc-token", avatar, "private WS reason"]) assert.equal(metadata.includes(secret), false);
    assert.equal(h.calls.filter(call => call.url.endsWith("/live/s_avatar/realtime")).length, 1); assert.equal(restored.calls.length, 0);
  }
});
test("role revocation denies real operations but permits exact-id stop", async () => {
  const h = await harness(), lease = await h.lease(), result = await h.start(lease.leaseId), path = `/leases/${lease.leaseId}`;
  h.sockets[0].message(2, { conn_init_ack: { success: true } }); await h.drain();
  assert.equal((await h.call(path + "/danmaku", "POST", { id: result.data.session.id, text: "你好" }, account, "user")).status, 200);
  assert.equal((await h.call(path + "/heartbeat", "POST", { id: result.data.session.id }, account, "user")).status, 200);
  assert.equal((await h.call(path + "/generate", "POST", { kind: "image", prompt: "地图", images: [] }, account, "user")).status, 403);
  h.setProviderStatus("ended"); assert.equal((await h.call(path + "/stop", "POST", { id: result.data.session.id }, account, "user")).status, 200);
});
test("cleanup capability closes only its lease after logout; unrelated owner has no read access", async () => {
  const h = await harness(), lease = await h.lease(), path = `/leases/${lease.leaseId}`;
  await h.start(lease.leaseId); h.sockets[0].message(2, { conn_init_ack: { success: true } }); await h.drain(); h.setProviderStatus("ended");
  assert.equal((await h.call(path + "/status", "GET", undefined, "other-author")).status, 404);
  assert.equal((await h.call(path, "DELETE", { cleanupToken: "0".repeat(64) }, "lease_cleanup", "user")).status, 404);
  const cleanup = await h.call(path, "DELETE", { cleanupToken: lease.cleanupToken }, "lease_cleanup", "user");
  assert.equal(cleanup.data.ended, true); assert.equal(cleanup.data.providerTermination, "confirmed"); assert.equal(h.sockets[0].frames.at(-1)!.type, 5);
  assert.equal((await h.call(path + "/status")).status, 404);
});
test("malformed create or secret-bearing error is never automatically retried or leaked", async () => {
  for (const payload of ["", "<html>not-json</html>", "[]", JSON.stringify({ message: `Token ${key}`, extra: key })]) {
    const h = await harness({ request: async () => new Response(payload, { status: 502 }) }), lease = await h.lease();
    const result = await h.start(lease.leaseId); assert.ok(result.status >= 500); assert.equal(h.calls.length, 1);
    const status = await h.call(`/leases/${lease.leaseId}/status`); assert.equal(JSON.stringify(status).includes(key), false);
    assert.equal(status.data.creationUncertain, true);
    assert.equal((await h.start(lease.leaseId)).status, 409);
    await h.call(`/leases/${lease.leaseId}`, "DELETE", { cleanupToken: lease.cleanupToken }, "lease_cleanup", "user");
    assert.equal((await h.call("/leases", "POST")).status, 503);
    assert.equal(h.calls.length, 1);
  }
});
test("upstream secret reflections in liveID, RTC, taskID, creation URLs and recording URLs fail closed", async () => {
  for (const reflected of ["live", "rtc"]) {
    const h = await harness({ request: async url => url.endsWith("/live/s_avatar/realtime")
      ? Response.json({ live: { id: reflected === "live" ? key : "safe-live" }, rtc: { token: reflected === "rtc" ? key : "rtc", user_id: "viewer" } })
      : Response.json({ live: { id: "safe-live", status: "ended" } }) }), lease = await h.lease();
    const result = await h.start(lease.leaseId); assert.ok(result.status >= 500); assert.equal(JSON.stringify(result).includes(key), false);
    assert.equal(JSON.stringify(h.storage.snapshot()).includes(key), false);
    if (reflected === "rtc") assert.equal(h.storage.snapshot().leases[0].session.id, "safe-live");
  }
  let reflectedTask = true;
  const h = await harness({ request: async url => {
    if (url.includes("/creations")) return Response.json({ state: "success", creations: [{ url: `https://media.example/${key}.png` }, { url: "https://media.example/safe.png" }], authorization: key });
    return Response.json({ task_id: reflectedTask ? key : "safe-task", state: "created" });
  } }), lease = await h.lease(), path = `/leases/${lease.leaseId}`;
  const failed = await h.call(path + "/generate", "POST", { kind: "image", prompt: "原创书店", images: [] }); assert.equal(failed.status, 502); assert.equal(JSON.stringify(failed).includes(key), false);
  reflectedTask = false; await h.call(path + "/generate", "POST", { kind: "image", prompt: "原创书店", images: [] });
  const task = await h.call(path + "/task", "POST", { id: "safe-task" }); assert.deepEqual(task.data.creations, [{ url: "https://media.example/safe.png" }]);
  const real = await harness({ request: async url => {
    if (url.endsWith("/live/s_avatar/realtime")) return Response.json({ live: { id: "safe-live" }, rtc: { token: "rtc", user_id: "viewer" } });
    if (url.includes("/ws/")) return { status: 101, webSocket: new Socket() } as unknown as Response;
    return Response.json({ recording: { video_url: `https://media.example/${key}.mp4` }, private_field: key });
  } }), realLease = await real.lease(); await real.start(realLease.leaseId);
  const recording = await real.call(`/leases/${realLease.leaseId}/recording`, "POST"); assert.deepEqual(recording.data.recording, {}); assert.equal(JSON.stringify(recording).includes(key), false);
});
test("connecting timeout remains fixed at startedAt60 despite successful browser heartbeats", async () => {
  const h = await harness(), lease = await h.lease(), start = await h.start(lease.leaseId), path = `/leases/${lease.leaseId}`;
  for (let i = 0; i < 2; i++) { h.advance(20_000); await h.call(path + "/heartbeat", "POST", { id: start.data.session.id }); }
  h.advance(20_000); await h.studio.alarm();
  assert.equal((await h.call(path + "/status")).data.session.status, "ended"); assert.equal(h.sockets[0].frames.at(-1)!.type, 5);
});
test("ready session heartbeat gap ends the call, while heartbeats keep it past the old ten minute workbench", async () => {
  const h = await harness(), lease = await h.lease(), path = `/leases/${lease.leaseId}`; await h.start(lease.leaseId);
  h.sockets[0].message(2, { conn_init_ack: { success: true } }); await h.drain(); h.setProviderStatus("ended");
  h.advance(90_000); await h.studio.alarm(); assert.equal((await h.call(path + "/status")).data.session.status, "ended");
  assert.equal(h.sockets[0].frames.at(-1)!.type, 5);
  const next = await h.start(lease.leaseId); h.sockets[1].message(2, { conn_init_ack: { success: true } }); await h.drain();
  for (let i = 0; i < 22; i++) { h.advance(30_000); await h.call(path + "/heartbeat", "POST", { id: next.data.session.id }); }
  assert.equal((await h.call(path + "/status")).data.session.status, "ready");
  for (let i = 0; i < 98; i++) { h.advance(30_000); await h.call(path + "/heartbeat", "POST", { id: next.data.session.id }); }
  await h.studio.alarm();
  const ended = await h.call(path + "/status");
  assert.equal(ended.data.session.status, "ended"); assert.match(ended.data.session.reason, /一小时上限/);
  assert.equal(h.sockets[1].frames.at(-1)!.type, 5); assert.equal(h.calls.filter(call => call.url.endsWith("/live/s_avatar/realtime")).length, 2);
});
test("cleanup during a pending create still ends its late upstream live and rejects new lease until completion", async () => {
  let resolve!: (value: Response) => void; const pending = new Promise<Response>(done => { resolve = done; }); const sockets: Socket[] = [];
  const h = await harness({ request: async (url) => {
    if (url.endsWith("/live/s_avatar/realtime")) return pending;
    if (url.includes("/ws/")) { const ws = new Socket(); sockets.push(ws); return { status: 101, webSocket: ws } as unknown as Response; }
    return Response.json({ live: { id: "late-original-live", status: sockets.length ? "ended" : "on_live" } });
  } }), lease = await h.lease(), path = `/leases/${lease.leaseId}`, starting = h.start(lease.leaseId);
  while (!h.calls.length) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await h.call(path, "DELETE", { cleanupToken: lease.cleanupToken }, "lease_cleanup", "user")).data.ended, true);
  assert.equal((await h.call("/leases", "POST")).status, 503);
  resolve(Response.json({ live: { id: "late-original-live" }, rtc: { token: "rtc", user_id: "viewer" } }));
  assert.equal((await starting).status, 409); assert.equal(sockets[0].frames[0].type, 5);
  assert.equal(h.calls.filter(call => call.url.endsWith("/live/s_avatar/realtime")).length, 1);
  await h.drain();
});
test("material request remains independent from the live heartbeat and is not persisted", async () => {
  let resolve!: (value: Response) => void; const pending = new Promise<Response>(done => { resolve = done; });
  const sockets: Socket[] = [];
  const h = await harness({ request: async url => {
    if (url.endsWith("/live/s_avatar/realtime")) return Response.json({ live: { id: "original-material-live" }, rtc: { token: "isolated-rtc-token", user_id: "viewer" } });
    if (url.includes("/ws/")) { const ws = new Socket(); sockets.push(ws); return { status: 101, webSocket: ws } as unknown as Response; }
    return pending;
  } }), lease = await h.lease(), start = await h.start(lease.leaseId), path = `/leases/${lease.leaseId}`;
  sockets[0].message(2, { conn_init_ack: { success: true } }); await h.drain();
  const generating = h.call(path + "/generate", "POST", { kind: "image", prompt: "原创书店", images: [] });
  while (!h.calls.some(call => call.url.endsWith("/ent/v2/reference2image"))) await new Promise(resolve => setImmediate(resolve));
  h.advance(20_000); assert.equal((await h.call(path + "/heartbeat", "POST", { id: start.data.session.id })).status, 200);
  resolve(Response.json({ task_id: "original-task", state: "created", extra: key })); assert.equal((await generating).status, 200);
  assert.equal(JSON.stringify(h.storage.snapshot()).includes("原创书店"), false);
});
test("instance recovery closes only stored exact live and never creates or restores credentials", async () => {
  const original = await harness(), lease = await original.lease(); await original.start(lease.leaseId);
  const sockets: Socket[] = [], recovered = await harness({ storage: original.storage, request: async url => {
    assert.equal(url.includes("/live/s_avatar/realtime"), false);
    if (url.includes("/ws/")) { const ws = new Socket(); sockets.push(ws); return { status: 101, webSocket: ws } as unknown as Response; }
    return Response.json({ live: { id: "original-live-001", status: sockets.length ? "ended" : "on_live", billed_seconds: 4, credits_cost: 6 } });
  } });
  await recovered.studio.alarm();
  assert.equal(sockets.length, 1); assert.equal(sockets[0].frames[0].type, 5); assert.equal(sockets[0].frames[0].live_id, "original-live-001");
  const status = await recovered.call(`/leases/${lease.leaseId}/status`); assert.equal(status.data.session.status, "ended"); assert.equal(status.data.providerTermination, "confirmed");
  assert.equal(status.data.rtc, undefined); assert.equal(status.data.events.some((event: Value) => event.type === "transcript"), false);
});
test("failed handshake preserves unknown termination intent and blocks new live without retrying create", async () => {
  const h = await harness({ request: async url => {
    if (url.endsWith("/live/s_avatar/realtime")) return Response.json({ live: { id: "original-live-001" }, rtc: { token: "rtc", user_id: "viewer" } });
    if (url.includes("/ws/")) throw new Error("isolated handshake unavailable");
    return Response.json({ live: { id: "original-live-001", status: "on_live" } });
  } }), lease = await h.lease();
  assert.equal((await h.start(lease.leaseId)).status, 503);
  assert.equal(h.storage.snapshot().leases[0].termination, "unknown");
  assert.equal(h.storage.snapshot().leases[0].session.id, "original-live-001");
  assert.equal((await h.start(lease.leaseId)).status, 409); assert.equal((await h.call("/leases", "POST")).status, 503);
  assert.equal(h.calls.filter(call => call.url.endsWith("/live/s_avatar/realtime")).length, 1);
});
test("metadata failure after create still attempts same-live hangup and does not claim success", async () => {
  const storage = store(), put = storage.put; let unavailable = false; const sockets: Socket[] = [];
  storage.put = async (key, value) => { if (unavailable) throw new Error("isolated storage outage"); await put(key, value); };
  const h = await harness({ storage, request: async url => {
    if (url.endsWith("/live/s_avatar/realtime")) { unavailable = true; return Response.json({ live: { id: "original-live-001" }, rtc: { token: "rtc", user_id: "viewer" } }); }
    if (url.includes("/ws/")) { const ws = new Socket(); sockets.push(ws); return { status: 101, webSocket: ws } as unknown as Response; }
    return Response.json({ live: { id: "original-live-001", status: "on_live" } });
  } }), lease = await h.lease();
  assert.equal((await h.start(lease.leaseId)).status, 503);
  assert.equal(sockets[0].frames[0].type, 5); assert.equal(sockets[0].frames[0].live_id, "original-live-001");
  assert.equal(h.calls.filter(call => call.url.endsWith("/live/s_avatar/realtime")).length, 1);
});
test("unconfirmed delivered stop retains live identity, blocks replacement and bounds alarm retries", async () => {
  const h = await harness(), lease = await h.lease(), second = await h.lease(), started = await h.start(lease.leaseId), path = `/leases/${lease.leaseId}`;
  assert.equal((await h.call(path + "/stop", "POST", { id: started.data.session.id })).data.providerTermination, "requested");
  assert.match((await h.call(path + "/status")).data.session.reason, /尚未确认/);
  assert.equal((await h.start(lease.leaseId)).status, 409); assert.equal((await h.call("/leases", "POST")).status, 503);
  assert.equal((await h.start(second.leaseId)).status, 409);
  for (let i = 0; i < 12; i++) { h.advance(5000); await h.studio.alarm(); }
  const count = h.calls.length; h.advance(60_000); await h.studio.alarm(); assert.equal(h.calls.length, count);
  assert.equal(h.storage.snapshot().leases[0].session.id, started.data.session.id);
  h.setProviderStatus("ended"); assert.equal((await h.call(path + "/stop", "POST", { id: started.data.session.id })).status, 200);
});
test("native gateway uses current D1 role, strips forged headers and preserves cleanup routing", async () => {
  let currentRole = "user", requests: Request[] = []; const names: string[] = [];
  const env: LiveGatewayEnvironment = { BACKEND: { fetch: async () => Response.json({ user: { id: account, isGuest: false, role: currentRole } }) }, VIDU_API_KEY: key, VIDU_REGION: "global",
    LIVE_STUDIOS: { idFromName: name => { names.push(name); return { toString: () => name } as DurableObjectId; }, get: () => ({ fetch: async request => { requests.push(request as Request); return Response.json({ available: true, configured: true }); } }) } };
  const origin = "https://xumengchat.top", cookie = "dzmm_session=isolated", lease = "765fc580-5c97-4d25-a1ca-b0d8a07fd6c3";
  const prefix = await viduStudioOwnerPrefix(account), ownLease = `${prefix.slice(0, 8)}-${prefix.slice(8, 12)}-${prefix.slice(12, 16)}-a1ca-b0d8a07fd6c3`;
  const req = (path: string, body?: unknown, method = "POST", withCookie = true) => new Request(origin + "/api/live" + path, { method, headers: { ...(withCookie ? { Cookie: cookie } : {}), Origin: origin, "Content-Type": "application/json", "X-Xumeng-Live-Role": "super", Authorization: `Token ${key}` }, ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }) });
  assert.equal((await handleLiveGateway(req(`/leases/${ownLease}/start`, { mode: "real" }), env)).status, 200);
  assert.equal(requests[0].headers.get("X-Xumeng-Live-Role"), "user"); assert.equal(requests[0].headers.has("Authorization"), false); assert.equal(requests[0].headers.has("Cookie"), false);
  currentRole = "super"; assert.equal((await handleLiveGateway(req("/status", undefined, "GET"), env)).status, 200);
  assert.equal(requests[1].headers.get("X-Xumeng-Live-Role"), "super"); assert.equal(requests[1].headers.has("Authorization"), false); assert.equal(requests[1].headers.has("Cookie"), false);
  await handleLiveGateway(req(`/leases/${lease}`, { cleanupToken: "a".repeat(64) }, "DELETE", false), env);
  assert.equal(requests[2].headers.get("X-Xumeng-Live-User"), "lease_cleanup"); assert.equal(names.at(-1), `account:${viduStudioLeasePrefix(lease)}`);
  const before = requests.length; assert.equal((await handleLiveGateway(req(`/leases/${lease}/status`, undefined, "GET"), env)).status, 404); assert.equal(requests.length, before);
});

test("Miniflare SQLite DO keeps an upgraded connection beyond its handshake deadline and answers protocol ping/pong", { timeout: 30_000 }, async t => {
  let liveEnded = false, creates = 0, pongs = 0; const frames: Value[] = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Token ${key}`);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/live/s_avatar/realtime") {
      creates++; let body = ""; for await (const chunk of req) body += chunk;
      assert.equal(JSON.parse(body).idle_timeout_seconds, 1800);
      res.end(JSON.stringify({ live: { id: "runtime-original-live" }, rtc: { token: "runtime-viewer-token", user_id: "runtime-viewer" } }));
    } else res.end(JSON.stringify({ live: { id: "runtime-original-live", status: liveEnded ? "ended" : "on_live", billed_seconds: 1, credits_cost: 1.5 } }));
  });
  const wsServer = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    assert.equal(req.headers.authorization, `Token ${key}`); assert.match(req.url!, /^\/live\/ws\/live\/connect\?live_id=runtime-original-live&conn_id=/);
    wsServer.handleUpgrade(req, socket, head, (ws: any) => {
      const timer = setInterval(() => { if (ws.readyState === 1) ws.ping(); }, 30);
      ws.on("pong", () => { pongs++; }); ws.on("close", () => clearInterval(timer));
      ws.on("message", (raw: Buffer) => {
        const frame = JSON.parse(raw.toString()); frames.push(frame);
        if (frame.type === 1) ws.send(JSON.stringify({ type: 2, live_id: "runtime-original-live", conn_id: frame.conn_id, payload: { conn_init_ack: { success: true } } }));
        if (frame.type === 5) liveEnded = true;
      });
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  t.after(async () => { for (const socket of wsServer.clients) socket.terminate(); wsServer.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const compiled = await build({ stdin: { contents: `import { ViduLiveStudio } from './src/vidu-live-studio.ts';
    export class RuntimeStudio extends ViduLiveStudio { constructor(ctx,env) { super(ctx,env,{fetch:(input,init)=>{ const url=new URL(input); return fetch(env.ISOLATED_PROXY + url.pathname + url.search,init); }}); } }
    export default {fetch(request,env) { const url=new URL(request.url); return env.STUDIOS.get(env.STUDIOS.idFromName('isolated-runtime-owner')).fetch(new Request('https://live-studio.internal'+url.pathname,{method:request.method,headers:request.headers,body:request.body,duplex:'half'})); }};`, resolveDir: new URL("..", import.meta.url).pathname, sourcefile: "isolated-runtime.ts" }, bundle: true, platform: "browser", format: "esm", write: false, target: "es2023" });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "isolated-live-runtime", modules: true, script: compiled.outputFiles[0].text, compatibilityDate: "2026-10-02", durableObjects: { STUDIOS: { className: "RuntimeStudio", useSQLite: true } },
    bindings: { VIDU_API_KEY: key, VIDU_REGION: "global", ISOLATED_PROXY: `http://127.0.0.1:${port}` } }] }));
  t.after(() => mf.dispose());
  const call = async (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") => {
    const result = await mf.dispatchFetch("http://isolated.test" + path, { method, headers: { "X-Xumeng-Live-User": account, "X-Xumeng-Live-Role": "super", "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(result.status < 400, true, await result.clone().text()); return await result.json() as Value;
  };
  const lease = await call("/leases", {}), path = `/leases/${lease.leaseId}`, started = await call(path + "/start", { mode: "real", avatar, persona: "原创虚拟主持人" });
  assert.equal(started.session.id, "runtime-original-live");
  await new Promise(resolve => setTimeout(resolve, 21_100));
  const status = await call(path + "/status"); assert.equal(status.session.status, "ready"); assert.ok(pongs >= 1, "Cloudflare runtime must answer actual protocol ping");
  await call(path + "/danmaku", { id: started.session.id, text: "介绍书店", name: "隔离观众" });
  const stopped = await call(path + "/stop", { id: started.session.id }); assert.equal(stopped.providerTermination, "confirmed");
  assert.equal(creates, 1); assert.deepEqual(frames.map(frame => frame.type), [1, 99, 5]);
  const final = await call(path + "/status"); assert.equal(final.billedSeconds, 1); assert.equal(final.creditsCost, 1.5); assert.equal(JSON.stringify(final).includes(key), false);
  await call(path, { cleanupToken: lease.cleanupToken }, "DELETE");
});

test("voice route uses documented matching pairs and keeps legacy Tina starts compatible", async () => {
  for (const config of [
    ...XUMENG_LIVE_VOICE_OPTIONS.map(item => ({ input: { voiceProvider: item.provider, voice: item.id }, voice: item.id,
      route: item.provider === "doubao" ? { provider: "doubao", doubao: { voice: item.id } } : { provider: "qwen_omni", qwen: { voice: item.id } } })),
    { input: { voice: "Tina" }, voice: "Tina", route: { provider: "qwen_omni", qwen: { voice: "Tina" } } },
    { input: { voiceProvider: "qwen_omni", voice: "Tina" }, voice: "Tina", route: { provider: "qwen_omni", qwen: { voice: "Tina" } } },
    { input: { voiceProvider: "doubao", voice: "zh_female_liuchangnv_uranus_bigtts" }, voice: "zh_female_liuchangnv_uranus_bigtts", route: { provider: "doubao", doubao: { voice: "zh_female_liuchangnv_uranus_bigtts" } } },
    { input: { voiceProvider: "doubao" }, voice: "zh_female_liuchangnv_uranus_bigtts", route: { provider: "doubao", doubao: { voice: "zh_female_liuchangnv_uranus_bigtts" } } },
  ]) {
    const h = await harness(), lease = await h.lease();
    const result = await h.call(`/leases/${lease.leaseId}/start`, "POST", { mode: "real", avatar, persona: "原创成年虚拟主持人", ...config.input });
    assert.equal(result.status, 200);
    const creates = h.calls.filter(call => call.url.endsWith("/live/s_avatar/realtime"));
    assert.equal(creates.length, 1);
    const requestBody = JSON.parse(creates[0].init.body as string);
    assert.equal(requestBody.model, "vidu-s2");
    assert.equal(requestBody.avatar.voice, config.voice);
    assert.deepEqual(requestBody.voice_model, config.route);
  }
});
test("invalid or mismatched voice routes fail before any provider call or create reservation", async () => {
  const h = await harness(), lease = await h.lease(), path = `/leases/${lease.leaseId}`;
  const invalid: Value[] = [
    ...[null, "", "other", [], 0].map(voiceProvider => ({ voiceProvider, voice: "Tina" })),
    { voiceProvider: "doubao", voice: "Tina" },
    { voiceProvider: "doubao", voice: "Katerina" },
    { voiceProvider: "doubao", voice: "zh_female_gaolengyujie_moon_bigtts" },
    { voiceProvider: "qwen_omni", voice: "female-yujie" },
    { voiceProvider: "qwen_omni", voice: "zh_female_liuchangnv_uranus_bigtts" },
    { voice: "zh_female_liuchangnv_uranus_bigtts" },
    ...[null, false, "", "unsupported-voice"].map(voice => ({ voiceProvider: "qwen_omni", voice })),
  ];
  for (const input of invalid) {
    const result = await h.call(path + "/start", "POST", { mode: "real", avatar, persona: "原创成年虚拟主持人", ...input });
    assert.equal(result.status, 400, JSON.stringify(input));
    assert.equal(h.calls.length, 0);
    const state = h.storage.snapshot().leases[0];
    assert.equal(state.creationUncertain, false);
    assert.equal(state.session, null);
  }
  assert.equal((await h.call(path + "/status")).data.session, null);
  assert.equal(h.calls.filter(call => call.url.endsWith("/live/s_avatar/realtime")).length, 0);
});

test("recovered ended lease reads same-live final string usage receipt without another create", async () => {
  const h = await harness({ request: async url => {
    if (url.includes("/ws/")) return { status: 101, webSocket: new Socket() } as unknown as Response;
    if (url.endsWith("/live/s_avatar/realtime")) return Response.json({ live: { id: "original-receipt-live" }, rtc: { token: "receipt-rtc", user_id: "viewer-original" } });
    return Response.json({ live: { id: "original-receipt-live", status: "ended", trace_id: "receipt-trace-original", billed_seconds: "0", credits_cost: "0.00" } });
  } }), lease = await h.lease(), path = `/leases/${lease.leaseId}`;
  await h.start(lease.leaseId);
  // The private harness did not register its overridden socket; use the stored live
  // as an old ended lease to exercise recovery receipt lookup through the real GET.
  const snapshot = h.storage.snapshot(); snapshot.leases[0].session.status = "ended"; snapshot.leases[0].termination = "confirmed";
  await h.storage.put("studio", snapshot);
  const recovered = await harness({ storage: h.storage, request: async url => {
    assert.match(url, /live\/v1\/lives\/original-receipt-live$/);
    return Response.json({ live: { id: "original-receipt-live", status: "ended", trace_id: "receipt-trace-original", billed_seconds: "0", credits_cost: "0.00" } });
  } });
  const result = (await recovered.call(path + "/status")).data;
  assert.equal(result.providerTermination, "confirmed"); assert.equal(result.billedSeconds, 0); assert.equal(result.creditsCost, 0); assert.equal(result.providerTraceId, "receipt-trace-original");
  await recovered.call(path + "/status"); assert.equal(recovered.calls.length, 1);
  assert.equal(h.calls.filter(call => call.url.endsWith("/live/s_avatar/realtime")).length, 1);
});

test("force hangup remains confirmed through prepared/on_live receipt lag, then retries only the same live", async () => {
  for (const intermediateStatus of ["prepared", "on_live"]) {
    const sockets: Socket[] = [], receiptPaths: string[] = [];
    const id = `original-lag-${intermediateStatus}`;
    const h = await harness({ request: async url => {
      if (url.includes("/ws/")) { const socket = new Socket(); sockets.push(socket); return { status: 101, webSocket: socket } as unknown as Response; }
      if (url.endsWith("/live/s_avatar/realtime")) return Response.json({ live: { id }, rtc: { token: "isolated-lag-rtc", user_id: "original-lag-viewer" } });
      receiptPaths.push(url);
      assert.equal(url, `https://api.vidu.com/live/v1/lives/${id}`);
      return Response.json({ live: { id, status: receiptPaths.length === 1 ? intermediateStatus : "ended", ...(receiptPaths.length > 1 ? { billed_seconds: "4", credits_cost: "6.25" } : {}) } });
    } });
    const lease = await h.lease(), path = `/leases/${lease.leaseId}`;
    await h.start(lease.leaseId); sockets[0].message(2, { conn_init_ack: { success: true } }); await h.drain();
    sockets[0].message(6, { hangup: { hangup_reason: "ai_output_closed" } }); await h.drain();
    const delayed = (await h.call(path + "/status")).data;
    assert.equal(delayed.session.status, "ended"); assert.equal(delayed.providerTermination, "confirmed");
    assert.equal(delayed.providerStatus, intermediateStatus); assert.equal(delayed.billedSeconds, undefined); assert.equal(delayed.creditsCost, undefined);
    assert.equal(receiptPaths.length, 1, "status before retry deadline must not query again");
    assert.deepEqual(sockets[0].frames.map(frame => frame.type), [1], "provider hangup does not need a second hangup or reconnect");
    h.advance(5000);
    const settled = (await h.call(path + "/status")).data;
    assert.equal(settled.providerTermination, "confirmed"); assert.equal(settled.providerStatus, "ended");
    assert.equal(settled.billedSeconds, 4); assert.equal(settled.creditsCost, 6.25);
    await h.call(path + "/status"); assert.equal(receiptPaths.length, 2); assert.equal(sockets.length, 1);
    assert.equal(h.calls.filter(call => call.url.endsWith("/live/s_avatar/realtime")).length, 1);
  }
});

test("two real sessions in the same lease receive their own usage instead of retaining a previous receipt", async () => {
  const sockets: Socket[] = [], receiptIds: string[] = []; let creates = 0;
  const h = await harness({ request: async url => {
    if (url.includes("/ws/")) { const socket = new Socket(); sockets.push(socket); return { status: 101, webSocket: socket } as unknown as Response; }
    if (url.endsWith("/live/s_avatar/realtime")) {
      const number = ++creates;
      return Response.json({ live: { id: `original-cost-live-${number}` }, rtc: { token: `isolated-cost-rtc-${number}`, user_id: `original-cost-viewer-${number}` } });
    }
    const id = new URL(url).pathname.split("/").at(-1)!; receiptIds.push(id);
    assert.ok(["original-cost-live-1", "original-cost-live-2"].includes(id));
    return Response.json({ live: { id, status: "ended", billed_seconds: id.endsWith("1") ? "2" : "8", credits_cost: id.endsWith("1") ? "3.25" : "12.50" } });
  } });
  const lease = await h.lease(), path = `/leases/${lease.leaseId}`;
  const first = await h.start(lease.leaseId); assert.equal(first.data.session.id, "original-cost-live-1");
  sockets[0].message(2, { conn_init_ack: { success: true } }); await h.drain();
  sockets[0].message(6, { hangup: { hangup_reason: "timeout" } }); await h.drain();
  const firstReceipt = (await h.call(path + "/status")).data;
  assert.equal(firstReceipt.providerStatus, "ended"); assert.equal(firstReceipt.billedSeconds, 2); assert.equal(firstReceipt.creditsCost, 3.25);
  const second = await h.start(lease.leaseId); assert.equal(second.status, 200); assert.equal(second.data.session.id, "original-cost-live-2");
  const connecting = (await h.call(path + "/status")).data;
  assert.equal(connecting.providerStatus, undefined); assert.equal(connecting.billedSeconds, undefined); assert.equal(connecting.creditsCost, undefined);
  sockets[1].message(2, { conn_init_ack: { success: true } }); await h.drain();
  sockets[1].message(6, { hangup: { hangup_reason: "timeout" } }); await h.drain();
  const secondReceipt = (await h.call(path + "/status")).data;
  assert.equal(secondReceipt.providerTermination, "confirmed"); assert.equal(secondReceipt.providerStatus, "ended");
  assert.equal(secondReceipt.billedSeconds, 8); assert.equal(secondReceipt.creditsCost, 12.5);
  assert.deepEqual(receiptIds, ["original-cost-live-1", "original-cost-live-2"]); assert.equal(creates, 2);
});
