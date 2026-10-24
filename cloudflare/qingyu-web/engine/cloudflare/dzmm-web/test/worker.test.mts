import test from "node:test";
import assert from "node:assert/strict";
import { fetchRequest, type Env } from "../src/worker";

const ORIGIN = "https://dzmm-web.example";
const PRIVATE_KEY = "mock-provider-secret";
const encoder = new TextEncoder();
const MEMORY_PATHS = ["/api/memory", "/api/dzmm/memory"];
const MEMORY_STATE = {
  summary: "用户把书归还给林音。",
  scene: "书店柜台",
  completed: ["归还借阅的书"],
  pending: ["确认周末的开店时间"],
  relationships: ["林音认识了用户"],
  items: ["书已交给林音"],
};

function environment(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response("SPA shell") },
    BACKEND: { fetch: async () => Response.json({ user: { id: "guest-a", isGuest: true } }) },
    BILLING: { reserve: async () => ({ enabled: false }), finalize: async () => { throw new Error("disabled billing must not settle"); } },
    CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) },
    DZMM_API_KEY: PRIVATE_KEY,
    DZMM_BASE_URL: "https://model.example/v1",
    DZMM_MODEL: "mock/model",
    ...overrides,
  };
}

function request(path: string, options: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, options);
}

function chatRequest(extra: RequestInit = {}, value: unknown = {
  character: { name: "林音", description: "书店店员" },
  messages: [{ role: "user", content: "你好" }],
  model: "balanced",
}): Request {
  return request("/api/dzmm/chat", {
    method: "POST",
    body: JSON.stringify(value),
    ...extra,
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      Cookie: "dzmm_session=valid-session",
      "CF-Connecting-IP": "203.0.113.8",
      ...Object.fromEntries(new Headers(extra.headers)),
    },
  });
}

function sse(content: string): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function memoryRequest(path = "/api/memory", extra: RequestInit = {}): Request {
  return request(path, {
    method: "POST",
    body: JSON.stringify({
      messages: [{ role: "user", content: "我把书还给你。" }, { role: "assistant", content: "林音接过了书。" }],
      model: "balanced",
    }),
    ...extra,
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      Cookie: "dzmm_session=valid-session",
      "CF-Connecting-IP": "203.0.113.8",
      ...Object.fromEntries(new Headers(extra.headers)),
    },
  });
}

function memoryProviderResponse(): Response {
  return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(MEMORY_STATE) } }] });
}

test("assets are served separately and unknown API routes cannot fall back to HTML", async () => {
  let assets = 0;
  const env = environment({ ASSETS: { fetch: async () => { assets++; return new Response("SPA"); } } });
  assert.equal(await (await fetchRequest(request("/"), env)).text(), "SPA");
  assert.equal((await fetchRequest(request("/api/unknown"), env)).status, 404);
  const health = await fetchRequest(request("/health"), env);
  assert.deepEqual(await health.json(), { ok: true, service: "dzmm-web" });
  assert.equal(assets, 1);
});

test("mutations reject foreign, null and missing browser origins before calling bindings", async () => {
  let calls = 0;
  const env = environment({ BACKEND: { fetch: async () => { calls++; throw new Error("unexpected backend"); } } });
  for (const origin of ["https://foreign.example", "null", undefined]) {
    const headers = origin ? { Origin: origin } : undefined;
    const response = await fetchRequest(request("/api/dzmm/backend/v1/auth/guest", { method: "POST", headers }), env);
    assert.equal(response.status, 403);
  }
  assert.equal((await fetchRequest(chatRequest({ headers: { Origin: "https://foreign.example" } }), env)).status, 403);
  assert.equal(calls, 0);
});

test("gateway passes session, edge IP, JSON and revisions to the existing backend", async () => {
  let seen: Request | undefined;
  const env = environment({ BACKEND: { fetch: async input => {
    seen = input as Request;
    assert.equal(await seen.text(), '{"version":7}');
    return Response.json({ saved: true }, {
      headers: { "Set-Cookie": "dzmm_session=new-session; Path=/; Secure; HttpOnly; SameSite=Lax",
        "Access-Control-Allow-Origin": "https://dzmm-backend.850587960.workers.dev" },
    });
  } } });
  const response = await fetchRequest(request("/api/dzmm/backend/v1/state?q=a%26b", {
    method: "PUT", body: '{"version":7}', headers: {
      Origin: ORIGIN, "Content-Type": "application/json", "If-Match": "7",
      Cookie: "other_cookie=private; dzmm_session=old-session; another_cookie=no",
      "CF-Connecting-IP": "203.0.113.9", Authorization: "untrusted-client-token",
    },
  }), env);
  assert.equal(response.status, 200);
  assert.equal(seen!.url, "https://dzmm-backend.850587960.workers.dev/v1/state?q=a%26b");
  assert.equal(seen!.headers.get("Origin"), "https://dzmm-backend.850587960.workers.dev");
  assert.equal(seen!.headers.get("Cookie"), "dzmm_session=old-session");
  assert.equal(seen!.headers.get("CF-Connecting-IP"), "203.0.113.9");
  assert.equal(seen!.headers.get("If-Match"), "7");
  assert.equal(seen!.headers.get("Authorization"), null);
  assert.ok(response.headers.get("Set-Cookie")?.includes("HttpOnly"));
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("raw media uploads and download security headers survive the gateway", async () => {
  const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 255, 128, 42]);
  const env = environment({ BACKEND: { fetch: async input => {
    const forwarded = input as Request;
    if (forwarded.method === "POST") {
      assert.equal(forwarded.headers.get("Content-Type"), "image/webp");
      assert.deepEqual(new Uint8Array(await forwarded.arrayBuffer()), bytes);
      return Response.json({ key: "owned/cover.webp" }, { status: 201 });
    }
    return new Response(bytes, { headers: {
      "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox", ETag: '"opaque-etag"',
    } });
  } } });
  const upload = await fetchRequest(request("/api/dzmm/backend/v1/media", {
    method: "POST", body: bytes, headers: { Origin: ORIGIN, "Content-Type": "image/webp" },
  }), env);
  assert.equal(upload.status, 201);
  const download = await fetchRequest(request("/api/dzmm/backend/v1/media/owned/cover.webp"), env);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
  assert.equal(download.headers.get("Content-Type"), "image/webp");
  assert.equal(download.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(download.headers.get("Content-Security-Policy"), "default-src 'none'; sandbox");
  assert.equal(download.headers.get("ETag"), '"opaque-etag"');
});

test("proxy body limits are enforced from declared length and actual bytes before backend writes", async () => {
  let calls = 0;
  const env = environment({ BACKEND: { fetch: async () => { calls++; return new Response("unexpected"); } } });
  const declaredHeaders: Record<string, string>[] = [{ "Content-Length": "5242881" }, {}];
  for (const headers of declaredHeaders) {
    const response = await fetchRequest(request("/api/dzmm/backend/v1/media", {
      method: "POST", headers: { Origin: ORIGIN, ...headers }, body: new Uint8Array(5242881),
    }), env);
    assert.equal(response.status, 413);
  }
  assert.equal(calls, 0);
});

test("proxy preserves backend errors and response cancellation reaches backend streams", async () => {
  let cancelled = false;
  const env = environment({ BACKEND: { fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode("partial")); },
    cancel() { cancelled = true; },
  }), { status: 409, headers: { "Content-Type": "application/json" } }) } });
  const response = await fetchRequest(request("/api/dzmm/backend/v1/state"), env);
  assert.equal(response.status, 409);
  await response.body!.cancel();
  assert.equal(cancelled, true);
});

test("conditional media requests preserve 304 while unexpected redirects are rejected", async () => {
  const cached = await fetchRequest(request("/api/dzmm/backend/v1/media/owned/cover.webp", {
    headers: { "If-None-Match": '"saved-etag"' },
  }), environment({ BACKEND: { fetch: async input => {
    assert.equal((input as Request).headers.get("If-None-Match"), '"saved-etag"');
    return new Response(null, { status: 304, headers: { ETag: '"saved-etag"' } });
  } } }));
  assert.equal(cached.status, 304);
  assert.equal(cached.headers.get("ETag"), '"saved-etag"');
  const redirected = await fetchRequest(request("/api/dzmm/backend/v1/state"), environment({
    BACKEND: { fetch: async () => new Response(null, { status: 302, headers: { Location: "https://foreign.example" } }) },
  }));
  assert.equal(redirected.status, 502);
  assert.equal(redirected.headers.get("Location"), null);
});

test("binding errors are sanitized and unsupported proxy methods are rejected", async () => {
  const env = environment({ BACKEND: { fetch: async () => { throw new Error(PRIVATE_KEY); } } });
  const response = await fetchRequest(request("/api/dzmm/backend/v1/state"), env);
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes(PRIVATE_KEY));
  assert.equal((await fetchRequest(request("/api/dzmm/backend/v1/state", { method: "OPTIONS" }), env)).status, 405);
});

test("chat status exposes model configuration without secret or implicit process environment", async () => {
  const env = environment();
  const configured = await (await fetchRequest(request("/api/dzmm/chat"), env)).text();
  assert.ok(configured.includes('"configured":true'));
  assert.ok(!configured.includes(PRIVATE_KEY));
  const prior = process.env.DZMM_API_KEY;
  process.env.DZMM_API_KEY = PRIVATE_KEY;
  try {
    const unconfigured = await (await fetchRequest(request("/api/dzmm/chat"), environment({ DZMM_API_KEY: undefined }))).json() as { configured: boolean };
    assert.equal(unconfigured.configured, false);
  } finally {
    if (prior === undefined) delete process.env.DZMM_API_KEY;
    else process.env.DZMM_API_KEY = prior;
  }
});

test("200 user:null sessions cannot call a model or consume model rate limits", async () => {
  let rateCalls = 0;
  let providerCalls = 0;
  const env = environment({
    BACKEND: { fetch: async input => {
      const forwarded = input as Request;
      assert.equal(new URL(forwarded.url).pathname, "/v1/session");
      assert.equal(forwarded.headers.get("Cookie"), "dzmm_session=valid-session");
      assert.equal(forwarded.headers.get("CF-Connecting-IP"), "203.0.113.8");
      return Response.json({ user: null, authenticated: false });
    } },
    CHAT_RATE_LIMITER: { limit: async () => { rateCalls++; return { success: true }; } },
  });
  const response = await fetchRequest(chatRequest(), env, { providerFetch: async () => { providerCalls++; return sse("unexpected"); } });
  assert.equal(response.status, 401);
  assert.equal(providerCalls, 0);
  assert.equal(rateCalls, 0);
});

test("guest sessions can stream real provider protocol and rate keys come from server identity and IP", async () => {
  const keys: string[] = [];
  const env = environment({
    DZMM_STORY_MODEL: "mock/story-model",
    CHAT_RATE_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: true }; } },
  });
  const response = await fetchRequest(chatRequest({}, {
    character: { name: "林音" }, messages: [{ role: "user", content: "继续" }], model: "story",
  }), env, { providerFetch: async (url, options) => {
    assert.equal(url, "https://model.example/v1/chat/completions");
    assert.equal(new Headers(options?.headers).get("Authorization"), `Bearer ${PRIVATE_KEY}`);
    const sent = JSON.parse(options?.body as string);
    assert.equal(sent.model, "mock/story-model");
    assert.equal(sent.messages[0].role, "system");
    assert.ok(sent.messages[0].content.includes("林音"));
    return sse("你好 🌱");
  } });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "你好 🌱");
  assert.deepEqual(keys, ["chat:ip:203.0.113.8", "chat:user:guest-a"]);
});

test("IP and account rate rejection both return 429 without calling a provider", async () => {
  for (const deniedKey of ["chat:ip:203.0.113.8", "chat:user:guest-a"]) {
    let providerCalls = 0;
    const env = environment({ CHAT_RATE_LIMITER: { limit: async ({ key }) => ({ success: key !== deniedKey }) } });
    const response = await fetchRequest(chatRequest(), env, { providerFetch: async () => { providerCalls++; return sse("unexpected"); } });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "60");
    assert.equal(providerCalls, 0);
  }
});

test("missing or failed rate bindings fail closed without provider calls", async () => {
  let calls = 0;
  const response = await fetchRequest(chatRequest(), environment({
    CHAT_RATE_LIMITER: { limit: async () => { throw new Error(PRIVATE_KEY); } },
  }), { providerFetch: async () => { calls++; return sse("unexpected"); } });
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes(PRIVATE_KEY));
  assert.equal(calls, 0);
});

test("both memory aliases authenticate server sessions and return nonstream provider state", async () => {
  for (const path of MEMORY_PATHS) {
    const keys: string[] = [];
    let sessionCalls = 0;
    let providerCalls = 0;
    const env = environment({
      DZMM_BALANCED_MODEL: "mock/memory-model",
      BACKEND: { fetch: async input => {
        sessionCalls++;
        const forwarded = input as Request;
        assert.equal(forwarded.url, "https://dzmm-backend.850587960.workers.dev/v1/session");
        assert.equal(forwarded.headers.get("Cookie"), "dzmm_session=valid-session");
        assert.equal(forwarded.headers.get("CF-Connecting-IP"), "203.0.113.8");
        assert.equal(forwarded.headers.get("Authorization"), null);
        return Response.json({ user: { id: "server-user", isGuest: true } });
      } },
      MEMORY_RATE_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: true }; } },
      CHAT_RATE_LIMITER: { limit: async () => { assert.fail("memory must use its dedicated limiter"); } },
    });
    const response = await fetchRequest(memoryRequest(path, { headers: {
      Cookie: "other_cookie=private; dzmm_session=valid-session; another_cookie=no",
      Authorization: "untrusted-client-token",
    } }), env, { providerFetch: async (url, options) => {
      providerCalls++;
      assert.equal(url, "https://model.example/v1/chat/completions");
      assert.equal(new Headers(options?.headers).get("Authorization"), `Bearer ${PRIVATE_KEY}`);
      const sent = JSON.parse(options?.body as string);
      assert.equal(sent.model, "mock/memory-model");
      assert.equal(sent.stream, false);
      assert.equal(sent.messages[0].role, "system");
      assert.deepEqual(JSON.parse(sent.messages[1].content), {
        previousState: null,
        historicalMessages: [{ role: "user", content: "我把书还给你。" }, { role: "assistant", content: "林音接过了书。" }],
      });
      return memoryProviderResponse();
    } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.deepEqual(await response.json(), { state: MEMORY_STATE });
    assert.deepEqual(keys, ["memory:ip:203.0.113.8", "memory:user:server-user"]);
    assert.equal(sessionCalls, 1);
    assert.equal(providerCalls, 1);
  }
});

test("memory and chat use separate limiter bindings and separate keys when sharing the fallback", async () => {
  for (const dedicated of [true, false]) {
    const chatKeys: string[] = [];
    const memoryKeys: string[] = [];
    const env = environment({
      CHAT_RATE_LIMITER: { limit: async ({ key }) => { chatKeys.push(key); return { success: true }; } },
      ...(dedicated ? { MEMORY_RATE_LIMITER: { limit: async ({ key }: { key: string }) => {
        memoryKeys.push(key); return { success: true };
      } } } : {}),
    });
    const chat = await fetchRequest(chatRequest(), env, { providerFetch: async () => sse("你好") });
    assert.equal(chat.status, 200);
    assert.equal(await chat.text(), "你好");
    const memory = await fetchRequest(memoryRequest(), env, { providerFetch: async () => memoryProviderResponse() });
    assert.equal(memory.status, 200);
    assert.deepEqual(await memory.json(), { state: MEMORY_STATE });
    assert.deepEqual(chatKeys, dedicated
      ? ["chat:ip:203.0.113.8", "chat:user:guest-a"]
      : ["chat:ip:203.0.113.8", "chat:user:guest-a", "memory:ip:203.0.113.8", "memory:user:guest-a"]);
    assert.deepEqual(memoryKeys, dedicated ? ["memory:ip:203.0.113.8", "memory:user:guest-a"] : []);
  }
});

test("memory user:null sessions cannot call providers or either rate limiter", async () => {
  let rateCalls = 0;
  let providerCalls = 0;
  const limit = async () => { rateCalls++; return { success: true }; };
  const env = environment({
    BACKEND: { fetch: async () => Response.json({ user: null, authenticated: false }) },
    CHAT_RATE_LIMITER: { limit },
    MEMORY_RATE_LIMITER: { limit },
  });
  for (const path of MEMORY_PATHS) {
    const response = await fetchRequest(memoryRequest(path), env, { providerFetch: async () => {
      providerCalls++; return memoryProviderResponse();
    } });
    assert.equal(response.status, 401);
  }
  assert.equal(providerCalls, 0);
  assert.equal(rateCalls, 0);
});

test("memory rejects foreign, null, missing and cross-site origins before all bindings", async () => {
  let bindingCalls = 0;
  let providerCalls = 0;
  const limit = async () => { bindingCalls++; return { success: true }; };
  const env = environment({
    BACKEND: { fetch: async () => { bindingCalls++; return Response.json({ user: { id: "unexpected" } }); } },
    CHAT_RATE_LIMITER: { limit },
    MEMORY_RATE_LIMITER: { limit },
  });
  for (const path of MEMORY_PATHS) {
    const origins: Record<string, string>[] = [{ Origin: "https://foreign.example" }, { Origin: "null" }, {},
      { Origin: ORIGIN, "Sec-Fetch-Site": "cross-site" }];
    for (const headers of origins) {
      const response = await fetchRequest(request(path, { method: "POST", body: "{", headers }), env, {
        providerFetch: async () => { providerCalls++; return memoryProviderResponse(); },
      });
      assert.equal(response.status, 403);
    }
  }
  assert.equal(bindingCalls, 0);
  assert.equal(providerCalls, 0);
});

test("memory IP and account limits return 429 before providers and short-circuit denied IPs", async () => {
  for (const path of MEMORY_PATHS) {
    for (const deniedKey of ["memory:ip:203.0.113.8", "memory:user:guest-a"]) {
      const keys: string[] = [];
      let providerCalls = 0;
      const env = environment({ MEMORY_RATE_LIMITER: { limit: async ({ key }) => {
        keys.push(key); return { success: key !== deniedKey };
      } } });
      const response = await fetchRequest(memoryRequest(path), env, { providerFetch: async () => {
        providerCalls++; return memoryProviderResponse();
      } });
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("Retry-After"), "60");
      assert.deepEqual(keys, deniedKey.startsWith("memory:ip:")
        ? ["memory:ip:203.0.113.8"] : ["memory:ip:203.0.113.8", "memory:user:guest-a"]);
      assert.equal(providerCalls, 0);
    }
  }
});

test("memory methods and non-JSON media fail before session and model bindings", async () => {
  let bindingCalls = 0;
  let providerCalls = 0;
  const env = environment({
    BACKEND: { fetch: async () => { bindingCalls++; return Response.json({ user: { id: "unexpected" } }); } },
    MEMORY_RATE_LIMITER: { limit: async () => { bindingCalls++; return { success: true }; } },
  });
  const options = { providerFetch: async () => { providerCalls++; return memoryProviderResponse(); } };
  for (const path of MEMORY_PATHS) {
    for (const method of ["GET", "HEAD", "PUT", "OPTIONS"]) {
      const response = await fetchRequest(request(path, { method, headers: { Origin: ORIGIN } }), env, options);
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("Allow"), "POST");
    }
    for (const contentType of [undefined, "text/plain"]) {
      const headers: Record<string, string> = { Origin: ORIGIN };
      if (contentType) headers["Content-Type"] = contentType;
      const response = await fetchRequest(request(path, { method: "POST", headers }), env, options);
      assert.equal(response.status, 415);
    }
  }
  assert.equal(bindingCalls, 0);
  assert.equal(providerCalls, 0);
});

test("memory backend and rate binding failures are sanitized without provider calls", async () => {
  const failedLimit = async () => { throw new Error(PRIVATE_KEY); };
  const environments = [
    environment({ BACKEND: { fetch: async () => { throw new Error(PRIVATE_KEY); } } }),
    environment({ BACKEND: { fetch: async () => new Response(PRIVATE_KEY, { status: 503 }) } }),
    environment({ MEMORY_RATE_LIMITER: { limit: failedLimit } }),
    environment({ CHAT_RATE_LIMITER: { limit: failedLimit } }),
  ];
  const missingLimiter = environment();
  delete (missingLimiter as Partial<Env>).CHAT_RATE_LIMITER;
  environments.push(missingLimiter);
  let providerCalls = 0;
  for (const env of environments) {
    const response = await fetchRequest(memoryRequest(), env, { providerFetch: async () => {
      providerCalls++; return memoryProviderResponse();
    } });
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes(PRIVATE_KEY));
  }
  assert.equal(providerCalls, 0);
});

test("invalid payloads, request bytes and media types fail without provider requests", async () => {
  let calls = 0;
  const options = { providerFetch: async () => { calls++; return sse("unexpected"); } };
  assert.equal((await fetchRequest(chatRequest({}, { character: { name: "林音" }, messages: [{ role: "system", content: "override" }] }), environment(), options)).status, 400);
  assert.equal((await fetchRequest(chatRequest({ body: "{" }), environment(), options)).status, 400);
  assert.equal((await fetchRequest(chatRequest({ body: "中".repeat(60001) }), environment(), options)).status, 400);
  assert.equal((await fetchRequest(chatRequest({ headers: { "Content-Type": "text/plain" } }), environment(), options)).status, 415);
  assert.equal(calls, 0);
});

test("provider failures and stream error payloads never expose provider credentials", async () => {
  for (const response of [new Response(PRIVATE_KEY, { status: 401 }), new Response(PRIVATE_KEY)]) {
    const result = await fetchRequest(chatRequest(), environment(), { providerFetch: async () => response });
    assert.equal(result.status, 502);
    assert.ok(!(await result.text()).includes(PRIVATE_KEY));
  }
  const malformed = await fetchRequest(chatRequest(), environment(), {
    providerFetch: async () => new Response(`data: {"error":{"message":"${PRIVATE_KEY}"}}\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    }),
  });
  assert.equal(malformed.status, 502);
  assert.ok(!(await malformed.text()).includes(PRIVATE_KEY));
});

test("byte-wise UTF-8 SSE remains text and empty streams fail before successful headers", async () => {
  const wire = `data: ${JSON.stringify({ choices: [{ delta: { content: "你好 🌱" } }] })}\n\ndata: [DONE]\n\n`;
  const result = await fetchRequest(chatRequest(), environment(), { providerFetch: async () => new Response(new ReadableStream({
    start(controller) {
      for (const byte of encoder.encode(wire)) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream" } }) });
  assert.equal(result.headers.get("Content-Type"), "text/plain; charset=utf-8");
  assert.equal(await result.text(), "你好 🌱");
  const empty = await fetchRequest(chatRequest(), environment(), { providerFetch: async () => sse(" \n\t ") });
  assert.equal(empty.status, 502);
  assert.ok(empty.headers.get("Content-Type")?.includes("application/json"));
});

test("truncated and overlong replies retain valid text then fail safely", async () => {
  const truncated = await fetchRequest(chatRequest(), environment(), {
    providerFetch: async () => new Response('data: {"choices":[{"delta":{"content":"未写完"}}]}\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    }),
  });
  const reader = truncated.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "未写完");
  await assert.rejects(reader.read(), /提前中断/);
  const overlong = await fetchRequest(chatRequest(), environment(), {
    providerFetch: async () => sse("文".repeat(11999) + "🌱" + "额外内容"),
  });
  const capped = overlong.body!.getReader();
  const retained = new TextDecoder().decode((await capped.read()).value);
  assert.equal(retained.length, 11999);
  assert.ok(!retained.includes("�"));
  await assert.rejects(capped.read(), /长度上限/);
});

test("client cancellation aborts provider fetch and cancels its stream", async () => {
  let signal: AbortSignal | null | undefined;
  let cancelled = false;
  const response = await fetchRequest(chatRequest(), environment(), {
    providerFetch: async (_url, options) => {
      signal = options?.signal;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"生成中"}}]}\n\n')); },
        cancel() { cancelled = true; },
      }), { headers: { "Content-Type": "text/event-stream" } });
    },
  });
  const reader = response.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "生成中");
  await reader.cancel();
  assert.equal(signal?.aborted, true);
  assert.equal(cancelled, true);
});
