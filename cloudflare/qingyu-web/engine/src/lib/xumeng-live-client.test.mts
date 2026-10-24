import assert from "node:assert/strict";
import { test } from "node:test";
import liveModule from "./xumeng-live-client.ts";
const {
  createXumengLiveLease, fetchXumengLiveAvailability, parseXumengLiveSession, parseXumengLiveStatus,
  parseXumengLiveTask, releaseXumengLiveLease, requestXumengLive, XumengLiveRequestError, xumengLiveHttpsUrl, xumengLiveLeasePath,
} = liveModule as typeof import("./xumeng-live-client.ts");

const accountId = "original-live-a";
const cleanupToken = "1a".repeat(32);
const session = { id: "live-original-a", mode: "rehearsal", control: "performance", status: "ready", startedAt: 1791412000000 };
const status = { accountId, configured: false, region: "cn", session, events: [{ id: "event-original-a", type: "direction", time: session.startedAt, data: { intent: "介绍海港的修理工作", rehearsal: true } }], tasks: [], lastStartError: null };

test("status accepts an owned session and rejects cross-account replies", () => {
  assert.deepEqual(parseXumengLiveStatus(status, accountId).session, session);
  assert.throws(() => parseXumengLiveStatus(status, "original-live-b"), /格式异常/);
  assert.throws(() => parseXumengLiveStatus({ ...status, tasks: Array.from({ length: 101 }, () => ({})) }, accountId), /格式异常/);
  assert.throws(() => parseXumengLiveStatus({ ...status, events: [{ id: "bad", type: "direction", time: NaN }] }, accountId), /格式异常/);
});
test("subtitle session identity and revision survive parsing; malformed identities do not", () => {
  const event = { id: "subtitle-original", type: "transcript", time: session.startedAt, sessionId: session.id, revision: 1, data: { role: "主播", text: "修订后的完整字幕" } };
  assert.deepEqual(parseXumengLiveStatus({ ...status, events: [event] }, accountId).events[0], event);
  for (const patch of [{ sessionId: "" }, { sessionId: {} }, { revision: -1 }, { revision: 1.5 }, { revision: "1" }]) assert.throws(() => parseXumengLiveStatus({ ...status, events: [{ ...event, ...patch }] }, accountId), /格式异常/);
});
test("session rejects incomplete or unrelated mode/state while preserving ended reason", () => {
  assert.equal(parseXumengLiveSession(null), null);
  for (const patch of [{ id: "" }, { control: "auto" }, { mode: "other" }, { status: "paid" }, { startedAt: Infinity }]) assert.throws(() => parseXumengLiveSession({ ...session, ...patch }), /格式异常/);
  assert.equal(parseXumengLiveSession({ ...session, status: "ended", reason: "已手动结束" })?.reason, "已手动结束");
});
test("generation previews accept only credential-free HTTPS media", () => {
  const parsed = parseXumengLiveTask({ id: "task-original-a", kind: "image", state: "success", createdAt: session.startedAt,
    creations: [{ url: "https://example.com/original.png" }, { url: "javascript:alert(1)" }, { url: "http://example.com/local.png" }, { url: "https://secret@example.com/image.png" }] });
  assert.deepEqual(parsed.creations, [{ url: "https://example.com/original.png" }]);
  assert.equal(xumengLiveHttpsUrl("data:image/png;base64,AA=="), null);
  assert.throws(() => parseXumengLiveTask({ ...parsed, creations: Array.from({ length: 21 }, () => ({ url: "https://example.com/original.png" })) }), /格式异常/);
});
test("lease path escapes IDs and request adapter sends same-origin JSON mutations", async () => {
  const original = globalThis.fetch;
  let seen: { path: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => { seen = { path: String(input), init }; return Response.json({ sent: true }); };
  try {
    const path = xumengLiveLeasePath("lease/original", "heartbeat");
    assert.equal(path, "/api/live/leases/lease%2Foriginal/heartbeat");
    await requestXumengLive(path, { method: "POST", body: { id: session.id } });
    assert.equal(seen?.init?.credentials, "same-origin");
    assert.equal(seen?.init?.body, JSON.stringify({ id: session.id }));
    assert.equal(seen?.init?.cache, "no-store");
    await assert.rejects(requestXumengLive("https://example.com/api/live"), /地址无效/);
  } finally { globalThis.fetch = original; }
});
test("empty or invalid upstream acknowledgements do not appear as successful mutations", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("", { status: 200 });
    await assert.rejects(requestXumengLive("/api/live/leases", { method: "POST" }), /避免重复开播/);
    globalThis.fetch = async () => Response.json([], { status: 200 });
    await assert.rejects(requestXumengLive("/api/live/status"), /格式异常/);
    globalThis.fetch = async () => Response.json({ error: "当前账号只允许演练" }, { status: 403 });
    await assert.rejects(requestXumengLive("/api/live/leases/a/start", { method: "POST" }), /只允许演练/);
  } finally { globalThis.fetch = original; }
});
test("valid HTTP errors retain status for exact lease expiry detection", async () => {
  const original = globalThis.fetch;
  try {
    for (const httpStatus of [401, 403, 404, 503]) {
      globalThis.fetch = async () => Response.json({ error: `isolated-${httpStatus}` }, { status: httpStatus });
      await assert.rejects(requestXumengLive("/api/live/leases/isolated/status"), failure => {
        assert.ok(failure instanceof XumengLiveRequestError);
        assert.equal(failure.status, httpStatus);
        assert.equal(failure.message, `isolated-${httpStatus}`);
        return true;
      });
    }
  } finally { globalThis.fetch = original; }
});
test("malformed 404 and transport failures cannot masquerade as a confirmed missing lease", async () => {
  const original = globalThis.fetch;
  try {
    for (const reply of ["", "<html>not a lease response</html>", "[]", "{}", '{"error":123}', '{"error":""}', '{"error":" "}', JSON.stringify({ error: "x".repeat(2001) })]) {
      globalThis.fetch = async () => new Response(reply, { status: 404 });
      await assert.rejects(requestXumengLive("/api/live/leases/isolated/status"), failure => {
        assert.ok(failure instanceof Error);
        assert.equal(failure instanceof XumengLiveRequestError, false);
        return true;
      });
    }
    globalThis.fetch = async () => { throw new TypeError("isolated transport unavailable"); };
    await assert.rejects(requestXumengLive("/api/live/leases/isolated/status"), failure => {
      assert.ok(failure instanceof TypeError);
      assert.equal(failure instanceof XumengLiveRequestError, false);
      return true;
    });
  } finally { globalThis.fetch = original; }
});
test("availability and new leases reject stale account acknowledgements", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ available: true, configured: true, realAllowed: true, accountId: "original-live-b" });
    await assert.rejects(fetchXumengLiveAvailability(accountId), /格式异常/);
    globalThis.fetch = async () => Response.json({ leaseId: "lease-original-a", accountId: "original-live-b", cleanupToken });
    await assert.rejects(createXumengLiveLease(accountId), /格式异常/);
    for (const invalidToken of [undefined, "", "1".repeat(63), "A".repeat(64), "g".repeat(64), 123]) {
      globalThis.fetch = async () => Response.json({ leaseId: "lease-original-a", accountId, cleanupToken: invalidToken });
      await assert.rejects(createXumengLiveLease(accountId), /格式异常/);
    }
    globalThis.fetch = async () => Response.json({ leaseId: "lease-original-a", accountId, cleanupToken });
    assert.deepEqual(await createXumengLiveLease(accountId), { leaseId: "lease-original-a", cleanupToken });
  } finally { globalThis.fetch = original; }
});
test("lease cleanup sends its captured lease/token pair with keepalive after identity changes", async () => {
  const original = globalThis.fetch;
  const requests: { path: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => { requests.push({ path: String(input), init }); return Response.json({ ended: true }); };
  try {
    const oldLease = { leaseId: "lease-original-a", cleanupToken };
    const newLease = { leaseId: "lease-original-b", cleanupToken: "2b".repeat(32) };
    await releaseXumengLiveLease(oldLease, true);
    assert.equal(requests[0].path, "/api/live/leases/lease-original-a");
    assert.equal(requests[0].init?.method, "DELETE");
    assert.equal(requests[0].init?.keepalive, true);
    assert.equal(requests[0].init?.body, JSON.stringify({ cleanupToken: oldLease.cleanupToken }));
    assert.notEqual(requests[0].init?.body, JSON.stringify({ cleanupToken: newLease.cleanupToken }));
    assert.equal(requests[0].init?.credentials, "same-origin");
    await assert.rejects(releaseXumengLiveLease({ ...oldLease, cleanupToken: "invalid" }, true), /格式异常/);
    assert.equal(requests.length, 1);
  } finally { globalThis.fetch = original; }
});
test("cleanup cannot authorize leaving when a successful HTTP response lacks end acknowledgement", async () => {
  const original = globalThis.fetch;
  try {
    for (const reply of [{}, { ended: false }, { ended: "true" }]) {
      globalThis.fetch = async () => Response.json(reply);
      await assert.rejects(releaseXumengLiveLease({ leaseId: "lease-original-a", cleanupToken }), /尚未确认/);
    }
    globalThis.fetch = async () => Response.json({ ended: true });
    await releaseXumengLiveLease({ leaseId: "lease-original-a", cleanupToken });
  } finally { globalThis.fetch = original; }
});
