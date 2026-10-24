import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL as NodeURL } from "node:url";
import { characterShareLocations } from "../src/character-share";
import { fetchRequest, type Env } from "../src/worker";

const ORIGIN = "https://xumengchat.top";
function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, init);
}
function environment(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response("shell", { headers: { "Content-Type": "text/html" } }) },
    BACKEND: { fetch: async () => Response.json({ user: { id: "account-a" } }) },
    BILLING: { reserve: async () => ({ enabled: false }), finalize: async () => { throw new Error("disabled billing must not settle"); } },
    CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) },
    DZMM_API_KEY: "mock-private-provider-key",
    DZMM_BASE_URL: "https://model.example/v1",
    DZMM_MODEL: "mock/model",
    ...overrides,
  };
}

test("default website icon and manifest addresses serve original brand bytes rather than the page shell", async () => {
  for (const [path, file, mime] of [
    ["/favicon.ico", "brand/xumeng-favicon.ico", "image/x-icon"],
    ["/icon.svg", "brand/xumeng-mark.svg", "image/svg+xml"],
    ["/apple-touch-icon.png", "brand/xumeng-icon-192.png", "image/png"],
    ["/apple-touch-icon-precomposed.png", "brand/xumeng-icon-192.png", "image/png"],
    ["/manifest.webmanifest", "manifest.webmanifest", "application/manifest+json"],
    ["/site.webmanifest", "manifest.webmanifest", "application/manifest+json"],
  ]) {
    const bytes = await readFile(new NodeURL(`../../../public/dzmm/${file}`, import.meta.url));
    const env = environment({ ASSETS: { fetch: async (input: Request | string | NodeURL) => {
      const upstream = input as Request;
      assert.equal(upstream.url, `${ORIGIN}/assets/xumeng/${file}?v=brand`);
      assert.equal(upstream.headers.get("If-None-Match"), '"brand-etag"');
      return new Response(upstream.method === "HEAD" ? null : bytes, {
        headers: { "Content-Type": mime, ETag: '"brand-etag"' },
      });
    } } });
    for (const method of ["GET", "HEAD"]) {
      const response = await fetchRequest(request(`${path}?v=brand`, {
        method, headers: { "If-None-Match": '"brand-etag"' },
      }), env);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Content-Type"), mime);
      assert.equal(response.headers.get("Location"), null);
      assert.equal(response.headers.get("ETag"), '"brand-etag"');
      assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
      assert.equal(response.headers.get("Cache-Control"), "public, max-age=300, must-revalidate");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), method === "HEAD" ? Buffer.alloc(0) : bytes);
    }
  }
});

test("the neutral character cover serves its exact SVG through the public asset route", async () => {
  const path = "/assets/xumeng/brand/xumeng-character-placeholder.svg";
  const bytes = await readFile(new NodeURL("../../../public/dzmm/brand/xumeng-character-placeholder.svg", import.meta.url));
  const env = environment({ ASSETS: { fetch: async (input: Request | string | NodeURL) => {
    const upstream = input as Request;
    assert.equal(upstream.url, `${ORIGIN}${path}`);
    return new Response(upstream.method === "HEAD" ? null : bytes, { headers: { "Content-Type": "image/svg+xml" } });
  } } });
  for (const method of ["GET", "HEAD"]) {
    const response = await fetchRequest(request(path, { method }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "image/svg+xml");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), method === "HEAD" ? Buffer.alloc(0) : bytes);
  }
});

test("default brand addresses reject unsupported methods and cannot return a successful HTML fallback", async () => {
  for (const path of ["/favicon.ico", "/icon.svg", "/apple-touch-icon.png", "/apple-touch-icon-precomposed.png", "/manifest.webmanifest", "/site.webmanifest"]) {
    let assetFetches = 0;
    const env = environment({ ASSETS: { fetch: async () => {
      assetFetches++;
      return new Response("<html>page shell</html>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } } });
    const mutation = await fetchRequest(request(path, { method: "POST", body: "ignored" }), env);
    assert.equal(mutation.status, 405);
    assert.equal(mutation.headers.get("Allow"), "GET, HEAD");
    assert.equal(assetFetches, 0);
    const missing = await fetchRequest(request(path), env);
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get("Content-Type") || "", /application\/json/);
    assert.equal(assetFetches, 1);
  }
  const cached = await fetchRequest(request("/favicon.ico"), environment({
    ASSETS: { fetch: async () => new Response(null, { status: 304, headers: { ETag: '"brand-etag"' } }) },
  }));
  assert.equal(cached.status, 304);
  assert.equal(cached.headers.get("ETag"), '"brand-etag"');
  assert.equal(await cached.text(), "");
});

test("canonical root serves the shell and legacy entry redirects preserve query for GET and HEAD", async () => {
  let assets = 0;
  const env = environment({ ASSETS: { fetch: async () => { assets++; return new Response("shell"); } } });
  assert.equal(await (await fetchRequest(request("/?q=story"), env)).text(), "shell");
  for (const path of ["/dzmm", "/dzmm/"]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await fetchRequest(request(`${path}?q=a%26b&lang=zh`, { method }), env);
      assert.equal(response.status, 308);
      assert.equal(response.headers.get("Location"), `${ORIGIN}/?q=a%26b&lang=zh`);
      assert.equal(await response.text(), "");
    }
  }
  const mutation = await fetchRequest(request("/dzmm", { method: "POST", body: "retained" }), env);
  assert.equal(mutation.status, 405);
  assert.equal(mutation.headers.get("Location"), null);
  assert.equal(assets, 1);
});

test("legacy verified asset paths map to new names without a backend or SPA fetch", async () => {
  const env = environment({ ASSETS: { fetch: async () => { throw new Error("unexpected SPA"); } } });
  const pairs = [
    ["brand/icon.svg", "brand/xumeng-mark.svg"],
    ["brand/favicon.ico", "brand/xumeng-favicon.ico"],
    ["brand/icon-192.png", "brand/xumeng-icon-192.png"],
    ["brand/icon-512.png", "brand/xumeng-icon-512.png"],
    ["brand/sources.json", "brand/sources.json"],
    ["manifest.webmanifest", "manifest.webmanifest"],
    ["covers/2999180.webp", "covers/2999180.webp"],
    ["covers/1342638.png", "covers/1342638.png"],
    ["gallery/3691277-1.webp", "gallery/3691277-1.webp"],
    ["categories/truelove.webp", "categories/truelove.webp"],
    ["public-character-introductions.json", "public-character-introductions.json"],
  ];
  for (const [oldPath, newPath] of pairs) {
    const response = await fetchRequest(request(`/dzmm/${oldPath}?v=2`), env);
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("Location"), `${ORIGIN}/assets/xumeng/${newPath}?v=2`);
  }
  const head = await fetchRequest(request("/dzmm/brand/icon.svg", { method: "HEAD" }), env);
  assert.equal(head.status, 308);
  assert.equal(await head.text(), "");
});

test("unknown legacy paths and invalid asset paths cannot become SPA routes or open redirects", async () => {
  let bindings = 0;
  const env = environment({ ASSETS: { fetch: async () => { bindings++; return new Response("SPA"); } } });
  for (const path of ["/dzmm/character/private", "/dzmm/brand/secret.env", "/dzmm//foreign.example/logo.svg", "/assets/xumeng/unknown", "/assets/xumeng/brand/icon.svg"]) {
    const response = await fetchRequest(request(path), env);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Location"), null);
  }
  const mutation = await fetchRequest(request("/dzmm/covers/2999180.webp", { method: "PUT", body: "bytes" }), env);
  assert.equal(mutation.status, 405);
  assert.equal(mutation.headers.get("Location"), null);
  assert.equal(bindings, 0);
});

test("keyword aliases redirect browsers and crawlers directly to the same-origin root without HTML or indexing restrictions", async () => {
  let bindings = 0;
  const env = environment({
    ASSETS: { fetch: async () => { bindings++; return new Response("SPA"); } },
    BACKEND: { fetch: async () => { bindings++; return new Response("backend"); } },
  });
  for (const path of ["/nsfw", "/NSFW/", "/nSfW///", "/porn", "/PoRn/", "/%6e%73%66%77", "/porn%2f", "//NSFW//"]) {
    for (const method of ["GET", "HEAD"]) {
      for (const userAgent of ["Mozilla/5.0", "Googlebot", "bingbot"]) {
        const response = await fetchRequest(request(`${path}?next=https%3A%2F%2Fforeign.example&source=a%26b`, { method, headers: { "User-Agent": userAgent } }), env);
        assert.equal(response.status, 302);
        assert.equal(response.headers.get("Location"), `${ORIGIN}/?next=https%3A%2F%2Fforeign.example&source=a%26b`);
        assert.equal(response.headers.get("X-Robots-Tag"), null);
        assert.equal(response.headers.get("Cache-Control"), null);
        assert.equal(response.headers.get("Content-Type"), null);
        assert.equal(await response.text(), "");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await fetchRequest(request(path, { method }), env);
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("Allow"), "GET, HEAD");
      assert.equal(response.headers.get("Location"), null);
    }
  }
  const alternateOrigin = "https://dzmm-web.example";
  const alternate = await fetchRequest(new Request(`${alternateOrigin}/porn?next=//foreign.example`), env);
  assert.equal(alternate.headers.get("Location"), `${alternateOrigin}/?next=//foreign.example`);
  assert.equal(bindings, 0);
});

test("robots allows crawling and advertises the fixed canonical sitemap with GET and empty HEAD", async () => {
  const response = await fetchRequest(request("/robots.txt"), environment());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/plain; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=300");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(await response.text(), "User-agent: *\nAllow: /\nSitemap: https://xumengchat.top/sitemap.xml\n");
  assert.equal(await (await fetchRequest(request("/robots.txt", { method: "HEAD" }), environment())).text(), "");
  const unsupported = await fetchRequest(request("/robots.txt", { method: "POST" }), environment());
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get("Location"), null);
});

test("sitemap contains canonical public pages without hash routes, redirects or request-host pollution", async () => {
  const env = environment({ ASSETS: { fetch: async () => { throw new Error("must not use SPA"); } } });
  const response = await fetchRequest(new Request("https://foreign.example/sitemap.xml?url=attacker", { headers: { Host: "malicious.example" } }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/xml; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=300");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  const xml = await response.text();
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
  assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]), ["https://xumengchat.top/", "https://xumengchat.top/community-guidelines", ...characterShareLocations()]);
  assert.equal([...xml.matchAll(/<url>/g)].length, 2 + characterShareLocations().length);
  assert.doesNotMatch(xml, /nsfw|porn|#|foreign|malicious|attacker/);
  const head = await fetchRequest(request("/sitemap.xml", { method: "HEAD" }), env);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("Content-Type"), "application/xml; charset=utf-8");
  assert.equal(await head.text(), "");
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const unsupported = await fetchRequest(request("/sitemap.xml", { method }), env);
    assert.equal(unsupported.status, 405);
    assert.equal(unsupported.headers.get("Allow"), "GET, HEAD");
    assert.equal(unsupported.headers.get("Location"), null);
  }
});

test("new and legacy backend mutation URLs preserve body, session and host-only Set-Cookie without redirect", async () => {
  const seen: { url: string; method: string; body: string; cookie: string | null }[] = [];
  const env = environment({ BACKEND: { fetch: async input => {
    const forwarded = input as Request;
    seen.push({ url: forwarded.url, method: forwarded.method, body: await forwarded.text(), cookie: forwarded.headers.get("Cookie") });
    return Response.json({ saved: true }, { status: 201, headers: { "Set-Cookie": "dzmm_session=rotated; Path=/; Secure; HttpOnly; SameSite=Lax" } });
  } } });
  for (const prefix of ["/api/backend/", "/api/dzmm/backend/"]) {
    const response = await fetchRequest(request(`${prefix}v1/characters?revision=3`, {
      method: "POST", body: '{"name":"测试角色"}',
      headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: "other=hidden; dzmm_session=existing" },
    }), env);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("Location"), null);
    assert.equal(response.headers.get("Set-Cookie"), "dzmm_session=rotated; Path=/; Secure; HttpOnly; SameSite=Lax");
  }
  assert.deepEqual(seen[0], seen[1]);
  assert.deepEqual(seen[0], { url: "https://dzmm-backend.850587960.workers.dev/v1/characters?revision=3", method: "POST", body: '{"name":"测试角色"}', cookie: "dzmm_session=existing" });
});

test("new and legacy media GET URLs preserve query, bytes and conditional headers", async () => {
  const bytes = new Uint8Array([0, 255, 128, 42]);
  const urls: string[] = [];
  const env = environment({ BACKEND: { fetch: async input => {
    const forwarded = input as Request;
    urls.push(forwarded.url);
    assert.equal(forwarded.headers.get("If-None-Match"), '"saved"');
    return new Response(bytes, { headers: { "Content-Type": "image/webp", ETag: '"saved"' } });
  } } });
  for (const prefix of ["/api/backend/", "/api/dzmm/backend/"]) {
    const response = await fetchRequest(request(`${prefix}v1/media/account/cover.webp?q=a%26b`, { headers: { "If-None-Match": '"saved"' } }), env);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    assert.equal(response.headers.get("ETag"), '"saved"');
  }
  assert.deepEqual(urls, Array(2).fill("https://dzmm-backend.850587960.workers.dev/v1/media/account/cover.webp?q=a%26b"));
});

test("chat aliases use the same configured status and authenticated provider stream", async () => {
  const payloads: unknown[] = [];
  const env = environment();
  const status = [];
  for (const path of ["/api/chat", "/api/dzmm/chat"]) {
    status.push(await (await fetchRequest(request(path), env)).json());
    const response = await fetchRequest(request(path, {
      method: "POST", body: JSON.stringify({ character: { name: "林音" }, messages: [{ role: "user", content: "你好" }] }),
      headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: "dzmm_session=existing" },
    }), env, { providerFetch: async (_url, init) => {
      payloads.push(JSON.parse(init!.body as string));
      return new Response('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
    } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Location"), null);
    assert.equal(await response.text(), "你好");
  }
  assert.deepEqual(status[0], status[1]);
  assert.deepEqual(payloads[0], payloads[1]);
});

test("new API aliases retain origin checks and unknown APIs never reach the SPA", async () => {
  let calls = 0;
  const env = environment({ BACKEND: { fetch: async () => { calls++; return new Response("unexpected"); } }, ASSETS: { fetch: async () => { calls++; return new Response("SPA"); } } });
  for (const path of ["/api/chat", "/api/backend/v1/auth/guest", "/api/dzmm/chat", "/api/dzmm/backend/v1/auth/guest"]) {
    assert.equal((await fetchRequest(request(path, { method: "POST", headers: { Origin: "https://foreign.example" } }), env)).status, 403);
  }
  assert.equal((await fetchRequest(request("/api/backend/unknown"), environment({ BACKEND: { fetch: async () => Response.json({ error: "not found" }, { status: 404 }) } }))).status, 404);
  assert.equal((await fetchRequest(request("/api/unknown"), env)).status, 404);
  assert.equal(calls, 0);
});

test("valid assets keep their bytes while missing assets cannot inherit the HTML SPA fallback", async () => {
  const bytes = new Uint8Array([0, 255, 128, 42]);
  const existing = await fetchRequest(request("/assets/xumeng/brand/xumeng-icon-192.png"), environment({ ASSETS: { fetch: async () => new Response(bytes, { headers: { "Content-Type": "image/png" } }) } }));
  assert.equal(existing.status, 200);
  assert.deepEqual(new Uint8Array(await existing.arrayBuffer()), bytes);
  assert.equal(existing.headers.get("Content-Type"), "image/png");
  assert.equal((await fetchRequest(request("/assets/xumeng/covers/999999.webp"), environment())).status, 404);
  const config = await readFile(new NodeURL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.equal(JSON.parse(config.replace(/^\s*\/\/.*$/gm, "")).assets.run_worker_first, true);
});
