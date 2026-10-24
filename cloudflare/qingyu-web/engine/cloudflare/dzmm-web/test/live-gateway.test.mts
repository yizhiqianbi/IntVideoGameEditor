import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { handleLiveGateway, type LiveGatewayEnvironment } from "../src/live-gateway";
import { viduStudioOwnerPrefix } from "../src/vidu-live-studio";
const origin = "https://xumengchat.top", lease = "765fc580-5c97-4d25-a1ca-b0d8a07fd6c3";
const secret = "only-test-bridge-secret-32-characters-long";
function environment(role = "user", isGuest = false): LiveGatewayEnvironment {
  return { BACKEND: { fetch: async () => Response.json({ user: { id: "original-live-test", isGuest, role } }) }, LIVE_BRIDGE_URL: "https://bridge.example/xumeng-api", XUMENG_LIVE_BRIDGE_SECRET: secret };
}
function request(path: string, method = "GET", value?: unknown, overrides: Record<string, string> = {}) {
  return new Request(origin + "/api/live" + path, { method, headers: { Cookie: "dzmm_session=test-only", Origin: origin, "Content-Type": "application/json", ...overrides }, ...(method !== "GET" ? { body: JSON.stringify(value ?? {}) } : {}) });
}
test("anonymous and guest live access do not call bridge or model", async () => {
  let bridge = 0;
  const options = { fetch: async () => { bridge++; throw new Error("forbidden"); } };
  assert.equal((await handleLiveGateway(new Request(origin + "/api/live/status"), environment(), options)).status, 401);
  assert.equal((await handleLiveGateway(request("/leases", "POST"), environment("super", true), options)).status, 401);
  assert.equal(bridge, 0);
});
test("live namespace is strict; methods and origins rejected before account lookup", async () => {
  let auth = 0; const env = { ...environment(), BACKEND: { fetch: async () => { auth++; throw new Error("forbidden"); } } };
  for (const path of ["/config", "/leases/not-a-lease/status", "/status?user=other", "/leases/" + lease + "/events"]) assert.equal((await handleLiveGateway(request(path), env)).status, 404);
  assert.equal((await handleLiveGateway(request("/leases", "GET"), env)).status, 405);
  assert.equal((await handleLiveGateway(request("/leases", "POST", {}, { Origin: "https://foreign.example" }), env)).status, 403);
  assert.equal(auth, 0);
});
test("ordinary live account can start a call but cannot generate material or forge a super role", async () => {
  let bridge = 0;
  const options = { fetch: async (_input: unknown, init?: RequestInit) => {
    bridge++;
    assert.equal(new Headers(init?.headers).get("X-Xumeng-Live-Role"), "user");
    return Response.json({ accepted: true });
  } };
  for (const [action, value] of [["generate", { kind: "image" }], ["task", { id: "task-a" }]] as const) assert.equal((await handleLiveGateway(request(`/leases/${lease}/${action}`, "POST", value), environment(), options)).status, 403);
  assert.equal(bridge, 0);
  for (const [action, value] of [["start", { mode: "real", role: "super" }], ["recording", {}]] as const) assert.equal((await handleLiveGateway(request(`/leases/${lease}/${action}`, "POST", value), environment(), options)).status, 200);
  assert.equal(bridge, 2);
});
test("new starts reject rehearsal and invalid modes for every role before bridge delegation", async () => {
  let bridge = 0;
  for (const role of ["user", "super"]) {
    for (const mode of ["rehearsal", "fake", undefined]) {
      const response = await handleLiveGateway(request(`/leases/${lease}/start`, "POST", { mode }), environment(role), { fetch: async () => { bridge++; throw new Error("forbidden"); } });
      assert.equal(response.status, 400); assert.match(((await response.json()) as Record<string, string>).error, /Vidu S2/);
    }
  }
  const unavailable = await handleLiveGateway(request(`/leases/${lease}/start`, "POST", { mode: "real" }), environment(), { fetch: async () => { bridge++; throw new Error("forbidden"); } });
  assert.equal(unavailable.status, 503); assert.doesNotMatch(((await unavailable.json()) as Record<string, string>).error, /演练/);
  assert.equal(bridge, 1);
});
test("signature freezes backend account, role, path and exact JSON bytes; secrets and cookies stay server side", async () => {
  const raw = { mode: "real", avatar: "mock-avatar", userId: "forged", role: "user" };
  let count = 0;
  const response = await handleLiveGateway(request(`/leases/${lease}/start`, "POST", raw, { "X-Xumeng-Live-User": "forged" }), environment("super"), {
    now: () => 1_790_000_000_000, nonce: () => lease,
    fetch: async (input, init) => {
      count++; const url = new URL(String(input)), headers = new Headers(init?.headers);
      assert.equal(url.href, `https://bridge.example/xumeng-api/leases/${lease}/start`);
      assert.equal(headers.get("X-Xumeng-Live-User"), "original-live-test"); assert.equal(headers.get("X-Xumeng-Live-Role"), "super");
      assert.equal(headers.get("Cookie"), null); assert.equal(headers.get("Origin"), null); assert.equal(headers.get("Authorization"), null);
      const bytes = Buffer.from(init?.body as Uint8Array); assert.equal(bytes.toString(), JSON.stringify(raw));
      const canonical = ["POST", url.pathname, "original-live-test", "super", "1790000000", lease, createHash("sha256").update(bytes).digest("hex")].join("\n");
      assert.equal(headers.get("X-Xumeng-Live-Signature"), createHmac("sha256", secret).update(canonical).digest("hex"));
      return Response.json({ session: { id: "isolated-real-own", mode: "real" }, csrf: "child-private-token", accountId: "wrong-upstream" });
    },
  });
  assert.equal(response.status, 200); const body = await response.json() as Record<string, unknown>; assert.equal(body.accountId, "original-live-test"); assert.equal(body.csrf, undefined);
  assert.equal(count, 1); assert.ok(!JSON.stringify(body).includes(secret));
});
test("missing bridge has truthful status, refuses operations, and never silently uses a fake video", async () => {
  const env = { ...environment("super"), LIVE_BRIDGE_URL: undefined };
  const status = await (await handleLiveGateway(request("/status"), env)).json() as Record<string, unknown>;
  assert.equal(status.available, false); assert.equal(status.configured, false); assert.equal(status.realAllowed, true);
  assert.equal((await handleLiveGateway(request("/leases", "POST"), env)).status, 503);
});
test("provider start errors and unknown outcome survive without auto retry", async () => {
  let calls = 0;
  const fail = await handleLiveGateway(request(`/leases/${lease}/start`, "POST", { mode: "real" }), environment("super"), { fetch: async () => { calls++; return Response.json({ error: "cannot confirm session creation" }, { status: 400 }); } });
  assert.equal(fail.status, 400); assert.equal(((await fail.json()) as Record<string, unknown>).error, "cannot confirm session creation"); assert.equal(calls, 1);
  for (const bad of [new Response(null, { status: 303, headers: { Location: "https://other.example" } }), new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } })]) assert.equal((await handleLiveGateway(request("/leases", "POST"), environment("super"), { fetch: async () => bad })).status, 503);
});
test("streamed and advertised body bounds are enforced before bridge requests", async () => {
  let calls = 0; const opts = { fetch: async () => { calls++; throw new Error("forbidden"); } };
  assert.equal((await handleLiveGateway(request("/leases", "POST", {}, { "Content-Length": String(21 * 1024 * 1024) }), environment(), opts)).status, 413);
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(20 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
  const streamed = new Request(origin + "/api/live/leases", { method: "POST", headers: { Origin: origin, Cookie: "dzmm_session=test-only", "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  assert.equal((await handleLiveGateway(streamed, environment(), opts)).status, 413);
  const invalid = new Request(origin + "/api/live/leases", { method: "POST", headers: { Origin: origin, Cookie: "dzmm_session=test-only", "Content-Type": "application/json" }, body: "{" });
  assert.equal((await handleLiveGateway(invalid, environment(), opts)).status, 400); assert.equal(calls, 0);
});
test("rate limiting affects creation/generation but not stop or heartbeat", async () => {
  const env = { ...environment("super"), LIVE_RATE_LIMITER: { limit: async () => ({ success: false }) } };
  assert.equal((await handleLiveGateway(request("/leases", "POST"), env)).status, 429);
  for (const action of ["stop", "heartbeat"]) assert.equal((await handleLiveGateway(request(`/leases/${lease}/${action}`, "POST", { id: "own" }), env, { fetch: async () => Response.json({}) })).status, 200);
});
test("interaction route authenticates and forwards current-scene JSON without exposing server keys", async () => {
  let calls = 0;
  const body = { id: "original-live-session", kind: "speech", name: "玩家", text: "先把地图展开吧。", scene: { situation: "原创地图室", goal: "核对航线", relationship: "愿意合作", established: "图已找回", ended: "雨已停", recentDialogue: [], sourceLabel: "当前会话" } };
  const response = await handleLiveGateway(request(`/leases/${lease}/interaction`, "POST", body), environment("super"), { fetch: async (url, init) => {
    calls++; assert.equal(new URL(String(url)).pathname, `/xumeng-api/leases/${lease}/interaction`);
    assert.equal(new Headers(init?.headers).get("X-Xumeng-Live-Role"), "super");
    assert.equal(Buffer.from(init?.body as Uint8Array).toString(), JSON.stringify(body));
    return Response.json({ sent: true });
  } });
  assert.equal(response.status, 200); assert.equal(calls, 1); assert.equal((await response.json() as Record<string, unknown>).sent, true);
  assert.equal((await handleLiveGateway(new Request(origin + `/api/live/leases/${lease}/interaction`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) }), environment("super"))).status, 401);
});
test("lease cleanup capability survives logout without granting status or actions", async () => {
  const cleanupToken = "ab".repeat(32);
  let auth = 0, bridge = 0;
  const env = { ...environment(), BACKEND: { fetch: async () => { auth++; throw new Error("Logged out"); } } };
  const anonymous = (path: string, method: string, body: unknown) => new Request(origin + "/api/live" + path, { method, headers: { Origin: origin, "Content-Type": "application/json" }, ...(method !== "GET" ? { body: JSON.stringify(body) } : {}) });
  const result = await handleLiveGateway(anonymous(`/leases/${lease}`, "DELETE", { cleanupToken }), env, { fetch: async (url, init) => {
    bridge++; assert.equal(new Headers(init?.headers).get("X-Xumeng-Live-User"), "lease_cleanup");
    assert.equal(new Headers(init?.headers).get("X-Xumeng-Live-Role"), "user");
    assert.equal(new URL(String(url)).pathname, `/xumeng-api/leases/${lease}`);
    assert.equal(Buffer.from(init?.body as Uint8Array).toString(), JSON.stringify({ cleanupToken }));
    return Response.json({ ended: true });
  } });
  assert.equal(result.status, 200); assert.equal(auth, 0); assert.equal(bridge, 1);
  assert.equal((await handleLiveGateway(anonymous(`/leases/${lease}`, "DELETE", { cleanupToken: "invalid" }), env)).status, 401);
  assert.equal((await handleLiveGateway(anonymous(`/leases/${lease}`, "DELETE", { cleanupToken, extra: "x".repeat(1024) }), env)).status, 413);
  for (const [path, method] of [[`/leases/${lease}/status`, "GET"], [`/leases/${lease}/start`, "POST"], ["/leases", "POST"]]) {
    assert.equal((await handleLiveGateway(anonymous(path, method, { cleanupToken, mode: "real" }), env)).status, 401);
  }
});

test("generation pause rejects both material kinds before native studio or fallback bridge calls", async () => {
  for (const native of [false, true]) {
    let studioCalls = 0, bridgeCalls = 0, rateLimitCalls = 0;
    const env: LiveGatewayEnvironment = { ...environment("super"), GENERATION_ENABLED: "false",
      LIVE_RATE_LIMITER: { limit: async () => { rateLimitCalls++; return { success: true }; } },
      ...(native ? { VIDU_API_KEY: "isolated-native-key", LIVE_STUDIOS: {
        idFromName: (name: string) => ({ toString: () => name }),
        get: () => ({ fetch: async () => { studioCalls++; throw new Error("Paused generation must not reach studio"); } }),
      } } : {}),
    };
    for (const kind of ["image", "video"]) {
      const result = await handleLiveGateway(request(`/leases/${lease}/generate`, "POST", { kind, prompt: "原创地图室", images: [] }), env,
        { fetch: async () => { bridgeCalls++; throw new Error("Paused generation must not reach bridge"); } });
      assert.equal(result.status, 503);
      assert.match((await result.json() as { error: string }).error, /暂停/);
      assert.equal(result.headers.get("Cache-Control"), "private, no-store");
    }
    assert.equal(studioCalls, 0); assert.equal(bridgeCalls, 0); assert.equal(rateLimitCalls, 0);
  }
});

test("generation pause preserves telephone controls, old task and recording queries on both gateway paths", async () => {
  const prefix = await viduStudioOwnerPrefix("original-live-test");
  const ownLease = `${prefix.slice(0, 8)}-${prefix.slice(8, 12)}-${prefix.slice(12, 16)}-a1ca-b0d8a07fd6c3`;
  const actions = ["start", "stop", "heartbeat", "interaction", "execute", "danmaku", "interrupt", "references", "task", "recording"];
  for (const native of [false, true]) {
    const delegated: string[] = [];
    const env: LiveGatewayEnvironment = { ...environment("super"), GENERATION_ENABLED: "false",
      ...(native ? { VIDU_API_KEY: "isolated-native-key", LIVE_STUDIOS: {
        idFromName: (name: string) => ({ toString: () => name }),
        get: () => ({ fetch: async (input: RequestInfo | URL) => { delegated.push(new URL((input as Request).url).pathname); return Response.json({ accepted: true }); } }),
      } } : {}),
    };
    for (const action of actions) {
      const path = `/leases/${ownLease}/${action}`;
      const result = await handleLiveGateway(request(path, "POST", { mode: "real", id: "original-existing-task" }), env, {
        fetch: async input => { delegated.push(new URL(String(input)).pathname.replace("/xumeng-api", "")); return Response.json({ accepted: true }); },
      });
      assert.equal(result.status, 200, `${native ? "native" : "bridge"} ${action}`);
      assert.equal((await result.json() as { accepted: boolean }).accepted, true);
    }
    assert.deepEqual(delegated, actions.map(action => `/leases/${ownLease}/${action}`));
  }
});
