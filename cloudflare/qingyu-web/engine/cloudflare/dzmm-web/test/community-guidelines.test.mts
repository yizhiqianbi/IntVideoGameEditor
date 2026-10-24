import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { build } from "esbuild";
import { characterShareLocations } from "../src/character-share";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const ORIGIN = "https://xumengchat.top";
const PAGE_PATH = "/community-guidelines";
const CANONICAL = `${ORIGIN}${PAGE_PATH}`;
const ROOT_ETAG = '"isolated-homepage-etag"';
const ROOT_MODIFIED = "Fri, 09 Oct 2026 00:00:00 GMT";
const TITLE = "叙梦社区公约";
const DESCRIPTION = "叙梦的社区交流、创作发布、隐私保护与举报规则。";
const REPORT_DIRECTORY = new NodeURL("../../../output/xumeng/iteration/community-guidelines-20261010/route-test/", import.meta.url);
const CONDITIONAL_HEADERS = ["If-None-Match", "If-Modified-Since", "If-Match", "If-Unmodified-Since", "Range", "If-Range"] as const;

type AssetObservation = { url: string; method: string; conditionalHeaders: Record<string, string | null>; mode: string };
type ResponseObservation = { url: string; method: string; status: number; headers: Record<string, string>; bodyBytes: number };

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}=["']([^"']*)["']`, "i").exec(tag)?.[1];
}

function metaContent(html: string, kind: "name" | "property", name: string): string[] {
  return [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map(match => match[0])
    .filter(tag => attribute(tag, kind) === name)
    .map(tag => attribute(tag, "content") ?? "");
}

function assertServerRenderedPage(html: string): void {
  assert.match(html, /<h1>社区公约<\/h1>/);
  assert.match(html, /写自己的故事，也尊重别人的边界。/);
  assert.match(html, /版本 1\.0/);
  assert.match(html, /<time datetime="2026-10-10">2026-10-10<\/time>/);
  for (const [id, heading] of [
    ["respect", "交流有分寸"], ["publishing", "发布前说清楚"], ["rights", "尊重原创与授权"],
    ["safety", "守住内容边界"], ["privacy", "保护彼此的隐私"], ["fair-use", "公平参与社区"],
    ["report", "遇到问题怎么反馈"],
  ]) {
    const sectionTag = [...html.matchAll(/<section\b[^>]*>/gi)].map(match => match[0]).find(tag => attribute(tag, "id") === id);
    assert.ok(sectionTag, `The public HTML must contain the ${id} rule section without running JavaScript`);
    assert.equal(attribute(sectionTag, "aria-labelledby"), `${id}-title`);
    assert.ok(html.includes(`<h2 id="${id}-title">${heading}</h2>`));
    assert.ok(html.includes(`href="#${id}"`), `The table of contents must reach ${id}`);
  }
  assert.match(html, /禁止涉及未成年人的性化、剥削内容/);
  assert.match(html, /不要发布他人的电话、住址、证件、支付信息或未经许可的私聊截图/);
  assert.match(html, /点击“举报”并填写理由/);
  assert.match(html, /href="\/#forum"/);
  assert.doesNotMatch(html, /isolated-root-shell-marker/);
}

test("community guidelines use the real Worker, HTMLRewriter and ASSETS in workerd", { timeout: 60_000 }, async t => {
  // Keep the Worker entry point untouched. The asset binding uses the site's real
  // document and a root sentinel so a successful SPA fallback cannot pass as SSR.
  const [compiled, sourceShell] = await Promise.all([
    build({ entryPoints: [fileURLToPath(new NodeURL("../src/entry.ts", import.meta.url))], bundle: true,
      platform: "browser", format: "esm", external: ["cloudflare:workers"], write: false, target: "es2023" }),
    readFile(new NodeURL("../index.html", import.meta.url), "utf8"),
  ]);
  assert.ok(sourceShell.includes('<div id="root"></div>'), "The fixture must use the real site's root element");
  const shell = sourceShell.replace('<div id="root"></div>', '<div id="root"><p>isolated-root-shell-marker</p></div>');
  const assetCalls: AssetObservation[] = [];
  const backendCalls: string[] = [];
  const billingCalls: string[] = [];
  const rateLimitCalls: string[] = [];
  const outboundCalls: string[] = [];
  const responses: ResponseObservation[] = [];
  const completedChecks: string[] = [];
  let assetMode = "html";
  let renderedHtml = "";

  // RPC methods use a named WorkerEntrypoint, as the production BILLING binding
  // does. A fetch-only stub would not observe accidental reserve/finalize calls.
  const guardScript = `import { WorkerEntrypoint } from "cloudflare:workers";
    export class BillingGuard extends WorkerEntrypoint {
      async reserve() { await this.env.OBSERVE.fetch("https://isolated.test/billing/reserve"); return { enabled: false }; }
      async finalize() { await this.env.OBSERVE.fetch("https://isolated.test/billing/finalize"); throw new Error("unexpected billing"); }
    }
    export class RateLimitGuard extends WorkerEntrypoint {
      async limit() { await this.env.OBSERVE.fetch("https://isolated.test/rate-limit/limit"); return { success: false }; }
    }
    export default { fetch() { return new Response("isolated service guard"); } };`;

  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: "isolated-community-guidelines", modules: true, script: compiled.outputFiles[0].text,
      compatibilityDate: "2026-10-02", serviceBindings: {
        ASSETS: async request => {
          assetCalls.push({ url: request.url, method: request.method, mode: assetMode,
            conditionalHeaders: Object.fromEntries(CONDITIONAL_HEADERS.map(name => [name, request.headers.get(name)])) });
          if (assetMode === "missing") return new Response("isolated missing asset", { status: 404 });
          if (assetMode === "non-html") return Response.json({ error: "isolated non-HTML asset" });
          const headers = { "Content-Type": "text/html; charset=utf-8", ETag: ROOT_ETAG, "Last-Modified": ROOT_MODIFIED,
            "Content-Length": String(Buffer.byteLength(shell)) };
          if (request.headers.get("If-None-Match") === ROOT_ETAG || request.headers.get("If-Modified-Since") === ROOT_MODIFIED) {
            return new Response(null, { status: 304, headers: { ETag: ROOT_ETAG, "Last-Modified": ROOT_MODIFIED } });
          }
          if (request.headers.has("If-Match") || request.headers.has("If-Unmodified-Since")) return new Response(null, { status: 412 });
          if (request.headers.has("Range")) return new Response(shell.slice(0, 12), { status: 206, headers });
          return new Response(request.method === "HEAD" ? null : shell, { headers });
        },
        BACKEND: async request => { backendCalls.push(request.url); return new Response("unexpected account lookup", { status: 503 }); },
        BILLING: { name: "isolated-public-service-guards", entrypoint: "BillingGuard" },
        CHAT_RATE_LIMITER: { name: "isolated-public-service-guards", entrypoint: "RateLimitGuard" },
      }, outboundService: async request => {
        outboundCalls.push(request.url); return new Response("unexpected external request", { status: 503 });
      } },
    { name: "isolated-public-service-guards", modules: true, script: guardScript, compatibilityDate: "2026-10-02",
      serviceBindings: { OBSERVE: async request => {
        const path = new URL(request.url).pathname;
        (path.startsWith("/billing/") ? billingCalls : rateLimitCalls).push(path);
        return new Response(null, { status: 204 });
      } } },
  ] }));

  const call = async (path: string, init: { method?: string; headers?: Record<string, string> } = {}, origin = ORIGIN) => {
    const response = await mf.dispatchFetch(`${origin}${path}`, { ...init, redirect: "manual" });
    const body = Buffer.from(await response.arrayBuffer());
    responses.push({ url: `${origin}${path}`, method: init.method ?? "GET", status: response.status,
      headers: Object.fromEntries(response.headers), bodyBytes: body.byteLength });
    return { response, body, html: body.toString("utf8") };
  };
  const assertNoPrivateServices = () => {
    assert.deepEqual(backendCalls, [], "A public page must not look up a session/account");
    assert.deepEqual(billingCalls, [], "A public page must not reserve or settle a charge");
    assert.deepEqual(rateLimitCalls, [], "A public page must not enter model rate limiting");
    assert.deepEqual(outboundCalls, [], "A public page must not fetch a model/provider or external service");
  };

  try {
    await t.test("GET returns readable rules and rewrites canonical/social metadata from the actual HTML shell", async () => {
      const start = assetCalls.length;
      const { response, html } = await call(`${PAGE_PATH}?source=a%26b`, {}, "https://isolated-preview.example");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
      assert.equal(response.headers.get("Cache-Control"), "public, max-age=300, must-revalidate");
      assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
      assertServerRenderedPage(html);
      assert.deepEqual([...html.matchAll(/<title>([^<]+)<\/title>/g)].map(match => match[1]), [TITLE]);
      for (const [kind, name, expected] of [
        ["name", "description", DESCRIPTION], ["property", "og:description", DESCRIPTION],
        ["name", "twitter:description", DESCRIPTION], ["property", "og:title", TITLE],
        ["name", "twitter:title", TITLE], ["property", "og:url", CANONICAL],
      ] as const) assert.deepEqual(metaContent(html, kind, name), [expected]);
      const canonicals = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => match[0]).filter(tag => attribute(tag, "rel") === "canonical");
      assert.deepEqual(canonicals.map(tag => attribute(tag, "href")), [CANONICAL]);
      assert.deepEqual(metaContent(html, "name", "robots"), ["index, follow"]);
      assert.deepEqual(metaContent(html, "name", "viewport"), ["width=device-width, initial-scale=1.0"]);
      assert.match(html, /<script type="module" src="\/src\/main\.tsx"><\/script>/);
      assert.doesNotMatch(html, /application\/ld\+json/);
      assert.doesNotMatch(html, /isolated-preview\.example|source=a/);
      assert.equal(assetCalls.length - start, 1);
      assert.equal(assetCalls.at(-1)!.url, "https://isolated-preview.example/");
      assert.equal(assetCalls.at(-1)!.method, "GET");
      renderedHtml = html;
      assertNoPrivateServices(); completedChecks.push("SSR and metadata");
    });

    await t.test("HEAD is empty and unsupported methods reject before any asset/service lookup", async () => {
      const { response, body } = await call(PAGE_PATH, { method: "HEAD" });
      assert.equal(response.status, 200);
      assert.equal(body.byteLength, 0);
      assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
      assert.equal(response.headers.get("Cache-Control"), "public, max-age=300, must-revalidate");
      assert.equal(assetCalls.at(-1)!.method, "GET", "HEAD must still retrieve a complete rewriteable shell internally");
      const start = assetCalls.length;
      for (const path of [PAGE_PATH, "/Community-Guidelines/"]) {
        for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
          const rejected = await call(path, { method });
          assert.equal(rejected.response.status, 405);
          assert.equal(rejected.response.headers.get("Allow"), "GET, HEAD");
          assert.equal(rejected.response.headers.get("Location"), null);
        }
      }
      assert.equal(assetCalls.length, start);
      assertNoPrivateServices(); completedChecks.push("HEAD and method restrictions");
    });

    await t.test("case, trailing slashes and encoded aliases permanently redirect with the query intact", async () => {
      const start = assetCalls.length;
      for (const path of ["/community-guidelines/", "/COMMUNITY-GUIDELINES", "/Community-Guidelines///", "/%63ommunity-guidelines", "//COMMUNITY-GUIDELINES//"]) {
        for (const method of ["GET", "HEAD"]) {
          const { response, body } = await call(`${path}?source=a%26b&next=https%3A%2F%2Fforeign.example`, { method });
          assert.equal(response.status, 308);
          assert.equal(response.headers.get("Location"), `${CANONICAL}?source=a%26b&next=https%3A%2F%2Fforeign.example`);
          assert.equal(body.byteLength, 0);
        }
      }
      assert.equal(assetCalls.length, start);
      assertNoPrivateServices(); completedChecks.push("Canonical route aliases");
    });

    await t.test("root asset validators/ranges cannot turn the rewritten public document into 304, 206 or 503", async () => {
      // First prove the binding really responds conditionally for the homepage.
      const rootConditions: Record<string, string>[] = [{ "If-None-Match": ROOT_ETAG }, { "If-Modified-Since": ROOT_MODIFIED }];
      for (const headers of rootConditions) {
        const root = await call("/", { headers });
        assert.equal(root.response.status, 304); assert.equal(root.body.byteLength, 0);
      }
      const conditions: Record<string, string>[] = [
        { "If-None-Match": ROOT_ETAG }, { "If-Modified-Since": ROOT_MODIFIED },
        { "If-Match": '"unrelated-document"', "If-Unmodified-Since": "Thu, 01 Jan 1970 00:00:00 GMT" },
        { Range: "bytes=0-11", "If-Range": ROOT_ETAG },
      ];
      for (const headers of conditions) {
        for (const method of ["GET", "HEAD"]) {
          const start = assetCalls.length;
          const { response, body, html } = await call(`${PAGE_PATH}?condition=cache`, { method, headers });
          assert.equal(response.status, 200);
          if (method === "GET") assertServerRenderedPage(html);
          else assert.equal(body.byteLength, 0);
          for (const name of ["ETag", "Last-Modified", "Content-Length"]) assert.equal(response.headers.get(name), null, `The root shell's ${name} cannot describe rewritten HTML`);
          assert.equal(assetCalls.length - start, 1);
          assert.equal(assetCalls.at(-1)!.url, `${ORIGIN}/`);
          assert.equal(assetCalls.at(-1)!.method, "GET");
          assert.deepEqual(assetCalls.at(-1)!.conditionalHeaders, Object.fromEntries(CONDITIONAL_HEADERS.map(name => [name, null])));
        }
      }
      assertNoPrivateServices(); completedChecks.push("Conditional requests and ranges");
    });

    await t.test("sitemap publishes the fixed canonical page and works without fetching assets/accounts", async () => {
      const start = assetCalls.length;
      const { response, html: xml } = await call("/sitemap.xml?url=attacker", { headers: { Host: "malicious.example" } }, "https://foreign.example");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Content-Type"), "application/xml; charset=utf-8");
      assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
      assert.match(xml, /xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
      assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]), [`${ORIGIN}/`, CANONICAL, ...characterShareLocations()]);
      assert.equal([...xml.matchAll(/<url>/g)].length, 2 + characterShareLocations().length);
      assert.doesNotMatch(xml, /foreign|malicious|attacker|#|nsfw|porn/);
      const head = await call("/sitemap.xml", { method: "HEAD" });
      assert.equal(head.response.status, 200); assert.equal(head.body.byteLength, 0);
      const rejected = await call("/sitemap.xml", { method: "POST" });
      assert.equal(rejected.response.status, 405); assert.equal(rejected.response.headers.get("Allow"), "GET, HEAD");
      const robots = await call("/robots.txt");
      assert.equal(robots.response.status, 200); assert.match(robots.html, /Sitemap: https:\/\/xumengchat\.top\/sitemap\.xml/);
      assert.equal(assetCalls.length, start);
      assertNoPrivateServices(); completedChecks.push("Public sitemap and robots");
    });

    await t.test("an unavailable/non-HTML shell returns a truthful failure without exposing the asset body", async () => {
      for (assetMode of ["missing", "non-html"]) {
        const { response, html } = await call(PAGE_PATH);
        assert.equal(response.status, 503);
        assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
        assert.deepEqual(JSON.parse(html), { error: "公约页面暂时不可用。" });
        assert.doesNotMatch(html, /isolated missing|isolated non-HTML/);
      }
      assetMode = "html";
      assertNoPrivateServices(); completedChecks.push("Unavailable shell handling");
    });
  } finally {
    await mf.dispose();
    await mkdir(REPORT_DIRECTORY, { recursive: true });
    if (renderedHtml) await writeFile(new NodeURL("rendered-community-guidelines.html", REPORT_DIRECTORY), renderedHtml);
    await writeFile(new NodeURL("runtime-report.json", REPORT_DIRECTORY), JSON.stringify({ sampledAt: new Date().toISOString(),
      runtime: "Miniflare workerd with actual src/entry.ts and HTMLRewriter", compatibilityDate: "2026-10-02",
      scope: "Local only; synthetic ASSETS; guarded BACKEND/BILLING/model/network; no real accounts, messages, providers or payments",
      workerBundleSha256: createHash("sha256").update(compiled.outputFiles[0].text).digest("hex"), completedChecks,
      responses, assetCalls, backendCalls, billingCalls, rateLimitCalls, outboundCalls }, null, 2) + "\n");
    assertNoPrivateServices();
  }
});
