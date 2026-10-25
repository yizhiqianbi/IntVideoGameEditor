import test from "node:test";
import assert from "node:assert/strict";
import { handleCompanionGateway, type CompanionGatewayEnvironment } from "../src/companion-gateway";

const origin = "https://qingyu.test";
const prefix = "/api/qingyu/companion/api";
const owner = "4c7c7b4e-5c9b-451c-98f9-632dc4f65212";
const session = "a86b6c7b-31d7-45e5-9b62-956fbcb8a9d7";
const requestId = "ccbd840f-0130-46e0-a41a-2b488476f530";
const cookie = "qingyu_session=" + "a".repeat(64);
const identity = { authenticated: true, user: { id: owner, role: "super", isGuest: false } };

function request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + prefix + path, {
    method, headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", ...headers },
    ...(method !== "GET" && method !== "HEAD" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
}

function environment(auth: unknown = identity) {
  const seen = { auth: [] as Request[], companion: [] as Request[] };
  const env: CompanionGatewayEnvironment = {
    BACKEND: { fetch: async input => { seen.auth.push(input as Request); return Response.json(auth); } },
    COMPANION: { fetch: async input => { const forwarded = input as Request; seen.companion.push(forwarded);
      return forwarded.url.includes("/receipts/") ? Response.json({ receipt: { status: "uncertain" } }) : Response.json({ ready: false, runtime: "isolated-test" }); } },
  };
  return { env, seen };
}

test("authentication requires the real session cookie and a server-issued UUID account", async () => {
  for (const rawCookie of ["", "other=1", "qingyu_session=forged", cookie + "; " + cookie]) {
    const { env, seen } = environment();
    assert.equal((await handleCompanionGateway(request("/health", "GET", undefined, { Cookie: rawCookie }), env)).status, 401);
    assert.equal(seen.auth.length, 0); assert.equal(seen.companion.length, 0);
  }
  for (const value of [null, {}, { user: identity.user }, { ...identity, authenticated: false }, { ...identity, authenticated: "true" },
    { ...identity, user: { ...identity.user, isGuest: "false" } }, { ...identity, user: { ...identity.user, isGuest: undefined } },
    { ...identity, user: { ...identity.user, id: "forged-account" } }]) {
    const { env, seen } = environment(value);
    assert.equal((await handleCompanionGateway(request("/health"), env)).status, 401);
    assert.equal(seen.auth.length, 1); assert.equal(seen.companion.length, 0);
  }
});

test("guest sessions reach their own companion instance without signing in", async () => {
  const { env, seen } = environment({ authenticated: false, user: { id: owner, role: "user", isGuest: true } });
  assert.equal((await handleCompanionGateway(request("/sessions"), env)).status, 200);
  assert.equal(seen.companion.length, 1);
  assert.equal(seen.companion[0].headers.get("X-Xumeng-Account-Id"), owner);
});

test("both real account roles pass while invalid backend roles fail closed", async () => {
  for (const role of ["user", "super"]) {
    const { env, seen } = environment({ ...identity, user: { ...identity.user, role } });
    assert.equal((await handleCompanionGateway(request("/sessions"), env)).status, 200);
    assert.equal(seen.companion.length, 1);
    assert.equal(seen.companion[0].headers.get("X-Xumeng-Account-Id"), owner);
  }
  for (const role of ["admin", "SUPER", undefined]) {
    const { env, seen } = environment({ ...identity, user: { ...identity.user, role } });
    const response = await handleCompanionGateway(request("/sessions", "GET", undefined, { "X-Xumeng-Role": "super", "X-Xumeng-Account-Id": owner }), env);
    assert.equal(response.status, 403); assert.equal(seen.companion.length, 0);
  }
});

test("strict routes, UUIDs, methods and queries fail before authentication", async () => {
  const { env, seen } = environment();
  for (const path of ["", "/", "/config", "/sessions/", "/sessions/not-a-uuid", `/sessions/${session}/delete`, `/sessions/${session}/receipts/not-a-uuid`, "/health?owner=other", "/sessions%2f" + session, "/health#private"]) {
    assert.equal((await handleCompanionGateway(request(path), env)).status, 404, path);
  }
  for (const [path, method] of [["/health", "POST"], ["/sessions", "DELETE"], [`/sessions/${session}`, "POST"], [`/sessions/${session}/messages`, "GET"], [`/sessions/${session}/receipts/${requestId}`, "POST"], ["/health", "HEAD"], ["/sessions", "OPTIONS"]]) {
    assert.equal((await handleCompanionGateway(request(path, method), env)).status, 405, path + method);
  }
  assert.equal((await handleCompanionGateway(new Request(origin + "/unrelated/api/health"), env)).status, 404);
  assert.equal(seen.auth.length, 0); assert.equal(seen.companion.length, 0);
});

test("write operations require same-origin JSON and reject owner/path injection", async () => {
  const { env, seen } = environment();
  for (const headers of [{ Origin: "https://other.example" }, { Origin: "null" }, { Origin: "" }, { "Sec-Fetch-Site": "cross-site" }] as Record<string, string>[]) {
    assert.equal((await handleCompanionGateway(request("/sessions", "POST", { characterId: "yume" }, headers), env)).status, 403);
  }
  assert.equal((await handleCompanionGateway(request("/sessions", "POST", { characterId: "yume" }, { "Content-Type": "text/plain" }), env)).status, 415);
  for (const body of [null, [], {}, { characterId: "other" }, { characterId: "yume", owner }, { characterId: "yume", path: "/internal" }, { characterId: "yume", role: "super" }]) {
    assert.equal((await handleCompanionGateway(request("/sessions", "POST", body), env)).status, 400);
  }
  for (const body of [{ text: " ", requestId }, { text: "x".repeat(4001), requestId }, { text: "原创地图", requestId: "bad" }, { text: "原创地图", requestId, accountId: owner }, { text: "原创地图", requestId, messages: [] }]) {
    assert.equal((await handleCompanionGateway(request(`/sessions/${session}/messages`, "POST", body), env)).status, 400);
  }
  assert.equal(seen.auth.length, 0); assert.equal(seen.companion.length, 0);
});

test("24 KB advertised and streamed boundaries reject before any service call", async () => {
  const { env, seen } = environment();
  assert.equal((await handleCompanionGateway(request("/sessions", "POST", { characterId: "yume" }, { "Content-Length": String(24 * 1024) }), env)).status, 413);
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(24 * 1024 - 1)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
  const streamed = new Request(origin + prefix + "/sessions", { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  assert.equal((await handleCompanionGateway(streamed, env)).status, 413);
  for (const raw of ["{", "\"text\"", "null"]) {
    const malformed = new Request(origin + prefix + "/sessions", { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: raw });
    assert.equal((await handleCompanionGateway(malformed, env)).status, 400);
  }
  assert.equal(seen.auth.length, 0); assert.equal(seen.companion.length, 0);
});

test("private binding receives only verified identity and canonical body, never browser credentials", async () => {
  const { env, seen } = environment();
  const response = await handleCompanionGateway(request(`/sessions/${session}/messages`, "POST", { text: "原创地图室，下午好。", requestId }, {
    Cookie: "tracking=private; " + cookie + "; preference=dark", Authorization: "Bearer browser-forgery", "X-Xumeng-Account-Id": "other-owner", "X-Xumeng-Role": "super", "X-Forwarded-Host": "evil.example", "X-Companion-Secret": "forged",
  }), env);
  assert.equal(response.status, 200); assert.equal(seen.auth.length, 1); assert.equal(seen.companion.length, 1);
  const auth = seen.auth[0], upstream = seen.companion[0];
  assert.equal(new URL(auth.url).pathname, "/v1/session"); assert.equal(auth.redirect, "manual");
  assert.deepEqual([...auth.headers], [["accept", "application/json"], ["cookie", cookie]]);
  assert.equal(upstream.url, `https://companion.internal/api/sessions/${session}/messages`); assert.equal(upstream.redirect, "manual");
  assert.deepEqual([...upstream.headers], [["accept", "application/json"], ["content-type", "application/json"], ["x-qingyu-companion-profile", "classic"], ["x-xumeng-account-id", owner], ["x-xumeng-session-token", "a".repeat(64)]]);
  assert.deepEqual(await upstream.json(), { text: "原创地图室，下午好。", requestId });
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("all allowed read/create routes reach their exact private paths without synthetic ready success", async () => {
  for (const [path, method, body] of [["/health", "GET"], ["/sessions", "GET"], [`/sessions/${session}`, "GET"], [`/sessions/${session}/receipts/${requestId}`, "GET"], ["/sessions", "POST", { characterId: "yume" }]] as const) {
    const { env, seen } = environment();
    const response = await handleCompanionGateway(request(path, method, body), env);
    assert.equal(response.status, 200); assert.equal(seen.companion[0].url, "https://companion.internal/api" + path);
    const value = await response.json() as { ready?: boolean; receipt?: unknown };
    if (path.includes("/receipts/")) assert.ok(value.receipt);
    else assert.equal(value.ready, false);
  }
  const { env } = environment(); delete env.COMPANION;
  const missing = await handleCompanionGateway(request("/health"), env);
  assert.equal(missing.status, 503); assert.equal((await missing.json() as { ready: boolean }).ready, false);
});

test("explicit reset is same-origin, confirmation-gated and forwarded only to the private host", async () => {
  const { env, seen } = environment();
  const response = await handleCompanionGateway(request("/reset", "POST", { confirmation: "discard-current-instance" } ), env);
  assert.equal(response.status, 200);
  assert.equal(seen.auth.length, 1); assert.equal(seen.companion.length, 1);
  assert.equal(seen.companion[0].url, "https://companion.internal/api/reset");
  assert.deepEqual(await seen.companion[0].json(), { confirmation: "discard-current-instance" });
  for (const body of [{}, { confirmation: "no" }, { confirmation: "discard-current-instance", extra: true }]) {
    const { env: invalidEnv, seen: invalidSeen } = environment();
    assert.equal((await handleCompanionGateway(request("/reset", "POST", body), invalidEnv)).status, 400);
    assert.equal(invalidSeen.companion.length, 0);
  }
});

test("billing overview uses the private billing binding and never exposes browser credentials", async () => {
  const { env, seen } = environment();
  env.BILLING = { companionOverview: async input => {
    const request = input as Request;
    assert.equal(request.url, "https://billing.internal/v1/companion");
    assert.equal(request.headers.get("Cookie"), cookie);
    assert.equal(request.headers.get("Authorization"), null);
    return { enabled: true, priceRevision: 1, creditsPerMessage: 2, balance: 18, reservedCredits: 0, receipts: [] };
  } };
  const response = await handleCompanionGateway(request("/billing", "GET", undefined, { Authorization: "Bearer browser-forgery" }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, priceRevision: 1, creditsPerMessage: 2, balance: 18, reservedCredits: 0, receipts: [] });
  assert.equal(seen.auth.length, 1); assert.equal(seen.companion.length, 0);
});

test("new companion style is validated and forwarded only to the private binding", async () => {
  const { env, seen } = environment();
  let forwarded: Request | undefined;
  let companionCalls = 0;
  env.COMPANION = { fetch: async input => {
    companionCalls += 1;
    forwarded = input as Request;
    return Response.json({ session: { id: session, title: "和 Yume 的聊天", messages: [], receipts: [], connection: "connected", status: "idle" } }, { status: 201 });
  } };
  const style = { version: 1, personality: "温柔且真诚", speakingStyle: "自然简短", relationshipStyle: "尊重边界，慢慢建立信任" };
  const response = await handleCompanionGateway(request("/sessions", "POST", { characterId: "yume", requestId, style }, { Authorization: "Bearer browser-forgery" }), env);
  assert.equal(response.status, 201);
  assert.equal(seen.auth.length, 1); assert.equal(companionCalls, 1);
  assert.ok(forwarded);
  assert.deepEqual(await forwarded!.json(), { characterId: "yume", requestId, style });
  assert.equal(forwarded!.headers.get("Cookie"), null);
  assert.equal(forwarded!.headers.get("Authorization"), null);
});

test("current chat style is replaced on the private binding and rejects extra fields", async () => {
  const { env, seen } = environment();
  let forwarded: Request | undefined;
  env.COMPANION = { fetch: async input => { forwarded = input as Request; return Response.json({ style: { version: 1, personality: "先讲这局", speakingStyle: "短句", relationshipStyle: "你说停就停" } }); } };
  const style = { version: 1, personality: "先讲这局", speakingStyle: "短句", relationshipStyle: "你说停就停" };
  const response = await handleCompanionGateway(request(`/sessions/${session}/style`, "PUT", { style }), env);
  assert.equal(response.status, 200);
  assert.equal(forwarded!.method, "PUT");
  assert.equal(new URL(forwarded!.url).pathname, `/api/sessions/${session}/style`);
  assert.deepEqual(await forwarded!.json(), { style });
  assert.equal(forwarded!.headers.get("Cookie"), null);
  assert.equal((await handleCompanionGateway(request(`/sessions/${session}/style`, "PUT", { style, owner }), env)).status, 400);
  assert.equal((await handleCompanionGateway(request(`/sessions/${session}/style`, "PUT", { style }, { Origin: "https://other.example" }), env)).status, 403);
  assert.equal(seen.companion.length, 0);
});

test("rich companion media survives the edge binding without being reduced to text", async () => {
  const { env } = environment();
  const rich = {
    id: session, title: "和 Yume 的聊天", messages: [{
      id: "media-1", role: "assistant", text: "", createdAt: new Date(0).toISOString(),
      media: [
        { kind: "emoji", url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", mimeType: "image/gif" },
        { kind: "voice", url: "data:audio/wav;base64,UklGRg==", mimeType: "audio/wav", durationMs: 640 },
        { kind: "image", url: "https://cdn.example.test/yume.png", mimeType: "image/png", alt: "Yume 的照片" },
      ],
    }], receipts: [], connection: "connected", status: "idle",
  };
  env.COMPANION = { fetch: async () => Response.json({ session: rich }) };
  const response = await handleCompanionGateway(request(`/sessions/${session}`), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as { session: typeof rich }).session.messages[0].media, rich.messages[0].media);
});

test("backend failures and redirects cannot reach the companion binding", async () => {
  for (const response of [new Response(null, { status: 302, headers: { Location: "https://other.example" } }), Response.json({ error: "unavailable" }, { status: 500 }), new Response("<html>login</html>")]) {
    const { env, seen } = environment(); env.BACKEND = { fetch: async () => response };
    assert.equal((await handleCompanionGateway(request("/health"), env)).status, 503);
    assert.equal(seen.companion.length, 0);
  }
  const { env, seen } = environment(); env.BACKEND = { fetch: async () => { throw new Error("isolated failure"); } };
  assert.equal((await handleCompanionGateway(request("/health"), env)).status, 503); assert.equal(seen.companion.length, 0);
});

test("intimate route reaches the same companion service with a separate profile", async () => {
  const { env, seen } = environment();
  const response = await handleCompanionGateway(new Request(origin + "/api/qingyu/companion-intimate/api/health", {
    headers: { Cookie: cookie },
  }), env);
  assert.equal(response.status, 200);
  assert.equal(seen.companion.length, 1);
  assert.equal(seen.companion[0].url, "https://companion.internal/api/health");
  assert.equal(seen.companion[0].headers.get("X-Xumeng-Account-Id"), owner);
  assert.equal(seen.companion[0].headers.get("X-Qingyu-Companion-Profile"), "intimate");
  const classic = environment();
  await handleCompanionGateway(request("/health"), classic.env);
  assert.equal(classic.seen.companion[0].headers.get("X-Qingyu-Companion-Profile"), "classic");
});

test("upstream failure preserves uncertain delivery, never retries or forwards redirect/cookie headers", async () => {
  for (const value of [new Response(null, { status: 307, headers: { Location: "https://other.example" } }), new Response("<html>down</html>"), Response.json([])]) {
    const { env } = environment(); let calls = 0;
    env.COMPANION = { fetch: async () => { calls++; return value; } };
    const response = await handleCompanionGateway(request(`/sessions/${session}/messages`, "POST", { text: "原创问候", requestId }), env);
    assert.equal(response.status, 503); assert.equal((await response.json() as { code: string }).code, "DELIVERY_UNCERTAIN"); assert.equal(calls, 1);
    assert.equal(response.headers.get("Location"), null);
  }
  const { env } = environment();
  env.COMPANION = { fetch: async () => Response.json({ error: "当前会话不存在。", code: "SESSION_NOT_FOUND" }, { status: 404, headers: { "Set-Cookie": "internal=private", "Access-Control-Allow-Origin": "*" } }) };
  const response = await handleCompanionGateway(request(`/sessions/${session}`), env);
  assert.equal(response.status, 404); assert.equal((await response.json() as { code: string }).code, "SESSION_NOT_FOUND");
  assert.equal(response.headers.get("Set-Cookie"), null); assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});


test("third companion entry forwards only the verified traveler profile", async () => {
  const { env, seen } = environment();
  const response = await handleCompanionGateway(new Request(origin + "/api/qingyu/companion-traveler/api/health", {
    headers: { Cookie: cookie, "X-Qingyu-Companion-Profile": "intimate" },
  }), env);
  assert.equal(response.status, 200);
  assert.equal(seen.companion[0].headers.get("X-Qingyu-Companion-Profile"), "traveler");
  assert.equal(seen.companion[0].headers.get("X-Xumeng-Account-Id"), owner);
});

test('proactive route forwards only an anchor, discards caller authority and rejects prompt injection fields',async()=>{
  const {env,seen}=environment();
  const path=`/sessions/${session}/proactive`;
  assert.equal((await handleCompanionGateway(request(path,'POST',{userMessageId:'native-user-id'}),env)).status,200);
  assert.deepEqual(await seen.companion[0].json(),{userMessageId:'native-user-id'});
  for(const body of [{userMessageId:'native-user-id',intent:'client instructions'},{userMessageId:''},{userMessageId:'x'.repeat(161)},{userMessageId:'line\nbreak'}]){
    assert.equal((await handleCompanionGateway(request(path,'POST',body),env)).status,400);
  }
  assert.equal((await handleCompanionGateway(request(path),env)).status,405);
  assert.equal(seen.companion.length,1);
});
