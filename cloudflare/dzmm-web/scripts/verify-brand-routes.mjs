import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CRITICAL_STATIC_ASSETS, matchesAssetMime } from "./asset-contract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const origin = new URL(process.argv[2] || "https://xumengchat.top").origin;
const checks = [];
let complete = false;
const report = resolve(root, process.argv[3] || "output/xumeng/branding-routes-verification.json");
async function request(path, options = {}) {
  return fetch(new URL(path, origin), { redirect: "manual", signal: AbortSignal.timeout(30000), ...options });
}
function pass(name, details = {}) { checks.push({ name, passed: true, ...details }); }
try {
  const response = await request("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>叙梦 · 角色与故事｜AI 角色卡与互动故事<\/title>/);
  assert.doesNotMatch(html, /\/dzmm|DZMM/);
  pass("canonical-root-and-own-brand");
  assert.match(html, /<meta\s+name="robots"\s+content="index,\s*follow"/);
  assert.match(html, /<link\s+rel="canonical"\s+href="https:\/\/xumengchat\.top\/"/);
  assert.equal(response.headers.get("x-robots-tag"), null);
  pass("main-site-allows-indexing-with-canonical-url");
  for (const resource of [...html.matchAll(/(?:src|href)="(\/assets\/index-[^"]+\.(?:js|css))"/g)].map(match => match[1])) {
    const result = await request(resource);
    assert.equal(result.status, 200);
    assert.ok((await result.arrayBuffer()).byteLength > 100);
    pass("current-client-asset", { path: resource });
  }
  const manifestResult = await request("/assets/xumeng/manifest.webmanifest");
  assert.equal(manifestResult.status, 200);
  const manifest = await manifestResult.json();
  assert.equal(manifest.name, "叙梦 · 角色与故事");
  assert.equal(manifest.short_name, "叙梦");
  assert.equal(manifest.id, "/"); assert.equal(manifest.start_url, "/");
  assert.deepEqual(manifest.icons.map(icon => icon.src), [192, 512].map(size => `/assets/xumeng/brand/xumeng-icon-${size}.png`));
  pass("new-install-manifest");
  for (const path of CRITICAL_STATIC_ASSETS) {
    const result = await request(`/assets/xumeng/${path}`);
    assert.equal(result.status, 200);
    assert.ok(matchesAssetMime(path, result.headers.get("content-type")), `资源类型错误：${path}`);
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), await readFile(resolve(root, "public/dzmm", path)));
    const head = await request(`/assets/xumeng/${path}`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.ok(matchesAssetMime(path, head.headers.get("content-type")), `HEAD 资源类型错误：${path}`);
    assert.equal(await head.text(), "");
    pass("new-asset-exact-bytes-and-mime", { path });
  }
  for (const [path, file, mime] of [
    ["/favicon.ico", "brand/xumeng-favicon.ico", /image\/(?:x-icon|vnd\.microsoft\.icon)/],
    ["/icon.svg", "brand/xumeng-mark.svg", /image\/svg\+xml/],
    ["/apple-touch-icon.png", "brand/xumeng-icon-192.png", /image\/png/],
    ["/apple-touch-icon-precomposed.png", "brand/xumeng-icon-192.png", /image\/png/],
    ["/manifest.webmanifest", "manifest.webmanifest", /application\/manifest\+json/],
    ["/site.webmanifest", "manifest.webmanifest", /application\/manifest\+json/],
  ]) {
    const result = await request(path);
    assert.equal(result.status, 200);
    assert.match(result.headers.get("content-type") || "", mime);
    assert.equal(result.headers.get("location"), null);
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), await readFile(resolve(root, "public/dzmm", file)));
    const head = await request(path, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.match(head.headers.get("content-type") || "", mime);
    assert.equal(await head.text(), "");
    pass("default-website-icon-or-manifest-is-real-brand-resource", { path, file });
  }
  for (const [path, target] of [
    ["/dzmm?character=3691277&view=chat", "/?character=3691277&view=chat"],
    ["/dzmm/", "/"],
    ["/dzmm/brand/icon.svg", "/assets/xumeng/brand/xumeng-mark.svg"],
    ["/dzmm/brand/icon-192.png", "/assets/xumeng/brand/xumeng-icon-192.png"],
    ["/dzmm/brand/icon-512.png", "/assets/xumeng/brand/xumeng-icon-512.png"],
    ["/dzmm/brand/favicon.ico", "/assets/xumeng/brand/xumeng-favicon.ico"],
    ["/dzmm/covers/1323657.webp", "/assets/xumeng/covers/1323657.webp"],
    ["/dzmm/manifest.webmanifest", "/assets/xumeng/manifest.webmanifest"],
  ]) {
    const result = await request(path);
    assert.equal(result.status, 308);
    assert.equal(result.headers.get("location"), `${origin}${target}`);
    pass("legacy-url-redirect", { path, target });
  }
  for (const path of ["/nsfw", "/porn", "/NSFW/", "/PoRn/", "/%6esfw", "/nsfw//"]) {
    const result = await request(path);
    assert.equal(result.status, 302);
    assert.equal(result.headers.get("location"), `${origin}/`);
    assert.equal(result.headers.get("x-robots-tag"), null);
    assert.equal(await result.text(), "");
    pass("keyword-url-redirects-to-main-site", { path });
  }
  const head = await request("/nsfw", { method: "HEAD" });
  assert.equal(head.status, 302); assert.equal(await head.text(), "");
  assert.equal(head.headers.get("location"), `${origin}/`);
  pass("keyword-head-is-empty-redirect");
  const robots = await (await request("/robots.txt")).text();
  assert.match(robots, /Allow: \//);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Disallow: \/health/);
  assert.match(robots, /User-agent: GPTBot/);
  assert.match(robots, /User-agent: OAI-SearchBot/);
  assert.match(robots, /Sitemap: https:\/\/xumengchat\.top\/sitemap\.xml/);
  pass("crawler-access-is-allowed");
  const sitemapResult = await request("/sitemap.xml");
  assert.equal(sitemapResult.status, 200);
  assert.match(sitemapResult.headers.get("content-type"), /application\/xml/);
  const sitemap = await sitemapResult.text();
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  for (const path of ["/", "/about", "/faq", "/characters", "/community-guidelines"]) {
    assert.ok(locs.includes(`https://xumengchat.top${path === "/" ? "/" : path}`), path);
  }
  assert.ok(locs.filter(loc => loc.includes("/c/")).length >= 8);
  assert.ok(locs.every(loc => loc.startsWith("https://xumengchat.top/") && !loc.includes("/api/")));
  pass("sitemap-lists-public-pages");
  for (const path of ["/nsfw", "/porn"]) {
    const result = await request(path, { headers: { "User-Agent": "Googlebot" } });
    assert.equal(result.status, 302);
    assert.equal(result.headers.get("location"), `${origin}/`);
    assert.equal(result.headers.get("x-robots-tag"), null);
    pass("crawlers-and-visitors-get-the-same-redirect", { path });
  }
  for (const path of ["/assets/xumeng/brand/icon.svg", "/assets/xumeng/covers/999999999999.webp", "/dzmm/character/private", "/api/unknown"]) {
    const result = await request(path); assert.equal(result.status, 404);
    assert.match(result.headers.get("content-type"), /application\/json/);
    pass("missing-resource-does-not-become-spa", { path });
  }
  const model = await (await request("/api/chat")).json();
  const legacyModel = await (await request("/api/dzmm/chat")).json();
  assert.equal(model.configured, true); assert.deepEqual(model, legacyModel);
  pass("model-status-new-and-legacy-api-compatible");
  const session = await request("/api/backend/v1/session");
  assert.equal(session.status, 200); assert.equal((await session.json()).authenticated, false);
  pass("new-session-api");
  const catalog = await request("/api/backend/v1/publishing/catalog");
  assert.equal(catalog.status, 200); assert.ok(Array.isArray((await catalog.json()).characters));
  pass("new-published-catalog-api");
  assert.equal((await request("/api/backend/v1/tasks")).status, 401);
  pass("new-task-api-preserves-authentication");
  for (const path of ["/api/chat", "/api/backend/v1/auth/guest"]) {
    const result = await request(path, { method: "POST", headers: { Origin: "https://example.invalid", "Content-Type": "application/json" }, body: "{}" });
    assert.equal(result.status, 403); pass("new-api-rejects-foreign-origin", { path });
  }
  complete = true;
} finally {
  await mkdir(dirname(report), { recursive: true });
  await writeFile(report, `${JSON.stringify({ verifiedAt: new Date().toISOString(), origin, readOnly: true, complete, checks }, null, 2)}\n`);
  console.log(`${checks.length} branding and route checks passed; report: ${report}`);
}
