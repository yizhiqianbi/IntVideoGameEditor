import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { getXumengPaymentInfoPage, renderXumengPaymentInfoPage, XUMENG_PAYMENT_INFO_PAGES, XUMENG_PAYMENT_SUPPORT_EMAIL } from "../../../src/lib/xumeng-payment-info";

const ORIGIN = "https://xumengchat.top";
const CONDITIONAL_HEADERS = ["If-None-Match", "If-Modified-Since", "If-Match", "If-Unmodified-Since", "Range", "If-Range"];
const ROOT_ETAG = '"isolated-payment-info-root"';
const ROOT_MODIFIED = "Thu, 15 Oct 2026 00:00:00 GMT";

test("public payment page lookup is shared by the Worker and SPA, and renders fixed draft content", () => {
  assert.deepEqual(XUMENG_PAYMENT_INFO_PAGES.map(page => page.path), ["/pricing", "/terms", "/privacy", "/refund-policy", "/support"]);
  for (const page of XUMENG_PAYMENT_INFO_PAGES) {
    assert.equal(getXumengPaymentInfoPage(page.path), page);
    assert.equal(getXumengPaymentInfoPage(`${page.path.toUpperCase()}///`), page);
    assert.equal(getXumengPaymentInfoPage(`/%${page.path.charCodeAt(1).toString(16)}${page.path.slice(2)}`), page);
    const html = renderXumengPaymentInfoPage(page);
    assert.match(html, /草稿 · 待确认/);
    assert.match(html, /Waffo 正式收款审核尚未通过，人民币月卡尚不能付款/);
    assert.ok(html.includes(`href="mailto:${XUMENG_PAYMENT_SUPPORT_EMAIL}"`));
    assert.match(html, /aria-label="服务与政策"/);
    assert.match(html, /@media\(max-width:700px\)/);
    assert.match(html, /overflow-wrap:anywhere/);
    assert.match(html, /href="#payment-info-content"/);
    for (const section of page.sections) {
      assert.ok(html.includes(`href="#${section.id}"`));
      assert.ok(html.includes(`aria-labelledby="${section.id}-title"`));
      assert.ok(html.includes(`<h2 id="${section.id}-title">${section.title}</h2>`));
    }
    for (const linkedPage of XUMENG_PAYMENT_INFO_PAGES) assert.ok(html.includes(`href="${linkedPage.path}"`));
    assert.ok(html.includes(`href="${page.path}" aria-current="page"`));
    assert.doesNotMatch(html, /<form|<input|<button|pancake\.waffo|cashier|\/api\/|立即购买|立即支付/);
  }
  for (const path of ["/", "/pricing-extra", "/support/private", "/api/terms", "/%zzpricing"]) assert.equal(getXumengPaymentInfoPage(path), undefined);
  const pricing = renderXumengPaymentInfoPage(getXumengPaymentInfoPage("/pricing")!);
  assert.match(pricing, /CNY ¥28/);
  assert.match(pricing, /30 天/);
  assert.match(pricing, /100 Credit/);
  assert.match(pricing, /最多领取 30 次/);
  assert.match(pricing, /不自动续费/);
});

test("all five payment draft routes render in workerd without account, billing or external requests", { timeout: 60_000 }, async t => {
  const [compiled, sourceShell] = await Promise.all([
    build({ entryPoints: [fileURLToPath(new NodeURL("../src/entry.ts", import.meta.url))], bundle: true,
      platform: "browser", format: "esm", external: ["cloudflare:workers"], write: false, target: "es2023" }),
    readFile(new NodeURL("../index.html", import.meta.url), "utf8"),
  ]);
  assert.ok(sourceShell.includes('<div id="root"></div>'));
  const shell = sourceShell.replace('<div id="root"></div>', '<div id="root"><p>isolated-root-placeholder</p></div>');
  const assetCalls: { url: string; method: string; headers: Record<string, string> }[] = [];
  const privateCalls: string[] = [];
  let assetMode: "html" | "missing" | "non-html" = "html";
  const guardScript = `import { WorkerEntrypoint } from "cloudflare:workers";
    export class BillingGuard extends WorkerEntrypoint {
      async reserve() { await this.env.OBSERVE.fetch("https://isolated.test/billing/reserve"); throw new Error("unexpected billing"); }
      async finalize() { await this.env.OBSERVE.fetch("https://isolated.test/billing/finalize"); throw new Error("unexpected billing"); }
    }
    export class RateLimitGuard extends WorkerEntrypoint {
      async limit() { await this.env.OBSERVE.fetch("https://isolated.test/rate-limit"); return { success: false }; }
    }
    export default { fetch() { return new Response("isolated guard"); } };`;
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: "isolated-payment-pages", modules: true, script: compiled.outputFiles[0].text, compatibilityDate: "2026-10-02",
      serviceBindings: {
        ASSETS: async request => {
          assetCalls.push({ url: request.url, method: request.method, headers: Object.fromEntries(request.headers) });
          if (assetMode === "missing") return new Response("private missing-asset detail", { status: 404 });
          if (assetMode === "non-html") return Response.json({ error: "private invalid-asset detail" });
          const headers = { "Content-Type": "text/html; charset=utf-8", ETag: ROOT_ETAG, "Last-Modified": ROOT_MODIFIED,
            "Content-Length": String(Buffer.byteLength(shell)) };
          if (request.headers.has("If-None-Match") || request.headers.has("If-Modified-Since")) return new Response(null, { status: 304, headers });
          if (request.headers.has("If-Match") || request.headers.has("If-Unmodified-Since")) return new Response(null, { status: 412 });
          if (request.headers.has("Range")) return new Response(shell.slice(0, 12), { status: 206, headers });
          return new Response(request.method === "HEAD" ? null : shell, { headers });
        },
        BACKEND: async request => { privateCalls.push(request.url); return new Response("unexpected account read", { status: 503 }); },
        BILLING: { name: "payment-page-private-guards", entrypoint: "BillingGuard" },
        CHAT_RATE_LIMITER: { name: "payment-page-private-guards", entrypoint: "RateLimitGuard" },
      }, outboundService: async request => { privateCalls.push(request.url); return new Response("unexpected network", { status: 503 }); } },
    { name: "payment-page-private-guards", modules: true, script: guardScript, compatibilityDate: "2026-10-02",
      serviceBindings: { OBSERVE: async request => { privateCalls.push(request.url); return new Response(null, { status: 204 }); } } },
  ] }));
  const call = async (path: string, method = "GET", headers: Record<string, string> = {}, origin = ORIGIN) => {
    const response = await mf.dispatchFetch(`${origin}${path}`, { method, headers, redirect: "manual" });
    return { response, html: await response.text() };
  };

  try {
    await t.test("GET has readable body, specific metadata and draft noindex, with fixed canonical URLs", async () => {
      for (const page of XUMENG_PAYMENT_INFO_PAGES) {
        const { response, html } = await call(`${page.path}?next=https%3A%2F%2Fforeign.example`, "GET", {}, "https://local-preview.example");
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
        assert.equal(response.headers.get("Cache-Control"), "public, max-age=300, must-revalidate");
        assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
        assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
        assert.ok(html.includes(`<title>${page.title}</title>`));
        assert.ok(html.includes(`<h1>${page.label}</h1>`));
        assert.ok(html.includes(`content="${page.description}"`));
        assert.ok(html.includes(`href="${ORIGIN}${page.path}"`));
        assert.ok(html.includes(`content="${ORIGIN}${page.path}"`));
        assert.match(html, /name="robots" content="noindex, nofollow"/);
        assert.match(html, /草稿 · 待确认/);
        for (const section of page.sections) for (const paragraph of section.paragraphs) assert.ok(html.includes(paragraph));
        assert.doesNotMatch(html, /isolated-root-placeholder|local-preview|foreign\.example|application\/ld\+json/);
        assert.equal(assetCalls.at(-1)!.url, "https://local-preview.example/");
        assert.equal(assetCalls.at(-1)!.method, "GET");
      }
    });

    await t.test("HEAD is empty, aliases redirect and other methods fail before fetching any asset", async () => {
      for (const page of XUMENG_PAYMENT_INFO_PAGES) {
        const head = await call(page.path, "HEAD");
        assert.equal(head.response.status, 200); assert.equal(head.html, "");
        assert.equal(head.response.headers.get("X-Robots-Tag"), "noindex, nofollow");
        const start = assetCalls.length;
        const aliases = [`${page.path}/`, page.path.toUpperCase(), `/%${page.path.charCodeAt(1).toString(16)}${page.path.slice(2)}`];
        for (const alias of aliases) {
          for (const method of ["GET", "HEAD"]) {
            const redirect = await call(`${alias}?source=a%26b`, method);
            assert.equal(redirect.response.status, 308);
            assert.equal(redirect.response.headers.get("Location"), `${ORIGIN}${page.path}?source=a%26b`);
            assert.equal(redirect.html, "");
          }
        }
        for (const path of [page.path, ...aliases]) {
          for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
            const rejected = await call(path, method);
            assert.equal(rejected.response.status, 405);
            assert.equal(rejected.response.headers.get("Allow"), "GET, HEAD");
            assert.equal(rejected.response.headers.get("Location"), null);
          }
        }
        assert.equal(assetCalls.length, start);
      }
    });

    await t.test("homepage validators, ranges, cookies and authorization never reach the public shell", async () => {
      const requestHeaders = Object.fromEntries(CONDITIONAL_HEADERS.map(name => [name, name === "Range" ? "bytes=0-11" : ROOT_ETAG]));
      Object.assign(requestHeaders, { Cookie: "dzmm_session=synthetic-should-not-be-read", Authorization: "Bearer isolated-no-permission" });
      for (const page of XUMENG_PAYMENT_INFO_PAGES) {
        for (const method of ["GET", "HEAD"]) {
          const { response, html } = await call(`${page.path}?ignored=1`, method, requestHeaders);
          assert.equal(response.status, 200);
          if (method === "HEAD") assert.equal(html, ""); else assert.ok(html.includes(`<h1>${page.label}</h1>`));
          for (const name of ["ETag", "Last-Modified", "Content-Length"]) assert.equal(response.headers.get(name), null);
          assert.equal(assetCalls.at(-1)!.url, `${ORIGIN}/`);
          assert.equal(assetCalls.at(-1)!.method, "GET");
          const actualHeaders = new Headers(assetCalls.at(-1)!.headers);
          for (const name of [...CONDITIONAL_HEADERS, "Cookie", "Authorization"]) assert.equal(actualHeaders.get(name), null);
        }
      }
    });

    await t.test("missing or non-HTML assets return a truthful 503 and draft pages stay out of the sitemap", async () => {
      for (assetMode of ["missing", "non-html"] as const) {
        for (const page of XUMENG_PAYMENT_INFO_PAGES) {
          const { response, html } = await call(page.path);
          assert.equal(response.status, 503);
          assert.deepEqual(JSON.parse(html), { error: "服务说明页面暂时不可用。" });
          assert.doesNotMatch(html, /private|missing-asset|invalid-asset/);
        }
      }
      assetMode = "html";
      const sitemap = await call("/sitemap.xml");
      assert.equal(sitemap.response.status, 200);
      for (const page of XUMENG_PAYMENT_INFO_PAGES) assert.ok(!sitemap.html.includes(`${ORIGIN}${page.path}</loc>`));
    });
  } finally {
    await mf.dispose();
    assert.deepEqual(privateCalls, [], "Public policy pages must not read sessions, create orders, bill or call external services");
  }
});
