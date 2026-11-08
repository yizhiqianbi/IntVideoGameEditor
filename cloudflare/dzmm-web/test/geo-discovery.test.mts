import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { characterShareGEOEntries, renderCharacterSharePage } from "../src/character-share";
import { CHARACTER_SHARE_INDEX } from "../src/character-share-index";
import {
  GEO_BOUNDARY,
  GEO_DEFINITION,
  GEO_META_DESCRIPTION,
  GEO_UPDATED,
  geoAnswers,
  publicAtomFeed,
  publicLlmsFullTxt,
  publicLlmsTxt,
  publicRobotsTxt,
  publicSitemapLocations,
  publicSitemapXml,
  publishedSitemapCharacters,
} from "../src/geo-discovery";
import { XUMENG_PAYMENT_INFO_PAGES } from "../../../src/lib/xumeng-payment-info";
import { fetchRequest, type Env } from "../src/worker";

const ORIGIN = "https://xumengchat.top";
const root = dirname(fileURLToPath(import.meta.url));
const env = {
  ASSETS: { fetch: async () => { throw new Error("公开发现页面不能回退到应用壳"); } },
  BACKEND: { fetch: async () => { throw new Error("公开发现页面不能读取账号"); } },
  CHAT_RATE_LIMITER: { limit: async () => { throw new Error("公开发现页面不能进入限流"); } },
} as Env;

function pageLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
}

test("discovery documents cite the same public facts and stay inside the privacy boundary", async () => {
  const llms = publicLlmsTxt();
  const full = publicLlmsFullTxt();
  const featured = characterShareGEOEntries();
  assert.match(llms, /^# 叙梦/m);
  assert.match(llms, new RegExp(GEO_BOUNDARY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(featured.length, 8);
  for (const card of featured) {
    assert.match(llms, new RegExp(`/c/${card.id}`));
    assert.match(full, new RegExp(card.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(`${llms}\n${full}\n${publicAtomFeed()}`, /性虐|性奴|色情|\/api\/|\/health/);
  assert.match(full, /公开角色地址以 https:\/\/xumengchat\.top\/sitemap\.xml 为准，地图包含当前已上架的公开角色。精选可引用角色：8。/);
  assert.match(llms, /https:\/\/video\.xumengchat\.top\/sitemap\.xml/);
  assert.match(full, new RegExp(GEO_UPDATED));
  for (const item of geoAnswers()) {
    assert.match(full, new RegExp(item.question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(full, new RegExp(item.answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("robots names answer-engine crawlers without opening private routes", () => {
  const robots = publicRobotsTxt();
  const groups = robots.split(/\n\n/).filter(group => group.startsWith("User-agent:"));
  assert.ok(groups.length >= 20);
  for (const agent of ["*", "Googlebot", "Baiduspider", "Bytespider", "GPTBot", "ChatGPT-User", "OAI-SearchBot", "PerplexityBot", "ClaudeBot", "Applebot"]) {
    assert.match(robots, new RegExp(`User-agent: ${agent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
  for (const group of groups) {
    assert.match(group, /Allow: \/\n/);
    assert.match(group, /Allow: \/c\/\n/);
    assert.match(group, /Allow: \/assets\/xumeng\/share\/\n/);
    assert.match(group, /Disallow: \/api\//);
    assert.match(group, /Disallow: \/health/);
    for (const page of XUMENG_PAYMENT_INFO_PAGES) assert.match(group, new RegExp(`Disallow: ${page.path}`));
  }
  assert.match(robots, /Sitemap: https:\/\/xumengchat\.top\/sitemap\.xml/);
  assert.match(robots, /Content-Signal: search=yes, ai-input=yes, ai-train=yes/);
});

test("sitemap lists editorial pages and public characters without private or draft urls", () => {
  const xml = publicSitemapXml();
  const locs = pageLocs(xml);
  assert.deepEqual(locs, publicSitemapLocations());
  assert.deepEqual(locs.slice(0, 5), [
    `${ORIGIN}/`,
    `${ORIGIN}/about`,
    `${ORIGIN}/faq`,
    `${ORIGIN}/characters`,
    `${ORIGIN}/community-guidelines`,
  ]);
  assert.equal(locs.filter(loc => loc.includes("/c/")).length, CHARACTER_SHARE_INDEX.length);
  for (const page of XUMENG_PAYMENT_INFO_PAGES) assert.equal(locs.includes(`${ORIGIN}${page.path}`), false);
  assert.doesNotMatch(xml, /#|nsfw|porn|\/api\/|foreign|malicious/);
  assert.match(xml, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/);
  assert.match(xml, /<image:loc>https:\/\/xumengchat\.top\/assets\/xumeng\/share\/xumeng-foreverse-peiyu\.jpg<\/image:loc>/);
});

test("sitemap adds listed publication urls and keeps their covers off /api/", () => {
  const first = "published-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const second = "published-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  assert.equal(publishedSitemapCharacters({ user: { id: first } }), null);
  assert.deepEqual(publishedSitemapCharacters({ characters: [
    { id: first, updatedAt: Date.UTC(2026, 10, 3), revision: 2, coverExtension: "png", title: "港口夜航" },
    { id: first, updatedAt: Date.UTC(2026, 10, 3), revision: 2, coverExtension: "png", title: "港口夜航" },
    { id: "not-a-publication", updatedAt: 1, revision: 1, coverExtension: "jpg" },
    { id: second, updatedAt: Date.UTC(2026, 10, 4), revision: 1, coverExtension: "webp", title: "  " },
  ] }), [
    { id: first, updatedAt: Date.UTC(2026, 10, 3), revision: 2, coverExtension: "png", title: "港口夜航 - AI角色聊天" },
    { id: second, updatedAt: Date.UTC(2026, 10, 4), revision: 1, coverExtension: null },
  ]);
  const xml = publicSitemapXml([
    { id: second, updatedAt: Date.UTC(2026, 10, 4), revision: 1, coverExtension: null, title: "无封面样本 - AI角色聊天" },
    { id: first, updatedAt: Date.UTC(2026, 10, 3), revision: 2, coverExtension: "png", title: "港口夜航 - AI角色聊天" },
    { id: "xumeng-foreverse-peiyu", updatedAt: Date.UTC(2026, 10, 3), revision: 1, coverExtension: "jpg" },
  ]);
  const locs = pageLocs(xml);
  assert.equal(locs.filter(loc => loc === `${ORIGIN}/c/xumeng-foreverse-peiyu`).length, 1);
  assert.ok(locs.indexOf(`${ORIGIN}/c/${first}`) < locs.indexOf(`${ORIGIN}/c/${second}`));
  assert.match(xml, new RegExp(`<loc>${ORIGIN}/c/${first}</loc><lastmod>2026-11-03</lastmod>`));
  assert.match(xml, new RegExp(`/assets/xumeng/share/${first}-2\\.png`));
  assert.match(xml, new RegExp(`<image:title>港口夜航 - AI角色聊天</image:title>`));
  const bare = xml.match(new RegExp(`<url><loc>${ORIGIN}/c/${second}</loc>.*?</url>`))?.[0] ?? "";
  assert.doesNotMatch(bare, /image:loc|image:title/);
  assert.doesNotMatch(xml, /\/api\/|#|nsfw|porn/);
});

test("served sitemap reads the listed catalog and falls back without it", async () => {
  const id = "published-cccccccc-cccc-cccc-cccc-cccccccccccc";
  const seen = { method: "", url: "", cookie: "" };
  const listed = {
    ...env,
    BACKEND: { fetch: async (input: RequestInfo | URL) => {
      const upstream = new Request(input);
      seen.method = upstream.method;
      seen.url = upstream.url;
      seen.cookie = upstream.headers.get("cookie") ?? "";
      return Response.json({ characters: [{ id, updatedAt: Date.UTC(2026, 10, 3), revision: 4, coverExtension: "jpg" }] });
    } },
  } as Env;
  const response = await fetchRequest(new Request(`${ORIGIN}/sitemap.xml`), listed);
  const xml = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=300");
  assert.equal(seen.method, "GET");
  assert.equal(new URL(seen.url).pathname, "/v1/publishing/sitemap");
  assert.equal(seen.cookie, "");
  assert.match(xml, new RegExp(`/assets/xumeng/share/${id}-4\\.jpg`));
  const failing = { ...env, BACKEND: { fetch: async () => { throw new Error("catalog down"); } } } as Env;
  const fallback = await (await fetchRequest(new Request(`${ORIGIN}/sitemap.xml?url=attacker`, { headers: { Cookie: "dzmm_session=hidden" } }), failing)).text();
  assert.deepEqual(pageLocs(fallback), publicSitemapLocations());
  assert.doesNotMatch(fallback, /attacker|hidden/);
});

test("answer pages, feeds and aliases are served without the app shell", async () => {
  for (const path of ["/llms.txt", "/llms-full.txt", "/.well-known/llms.txt", "/about", "/faq", "/characters", "/feed.xml"]) {
    const response = await fetchRequest(new Request(`https://foreign.example${path}?utm=1`), env);
    const body = await response.text();
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.doesNotMatch(body, /foreign\.example|utm=1|\/api\//);
    const head = await fetchRequest(new Request(`${ORIGIN}${path}`, { method: "HEAD" }), env);
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const rejected = await fetchRequest(new Request(`${ORIGIN}${path}`, { method: "POST" }), env);
    assert.equal(rejected.status, 405);
    assert.equal(rejected.headers.get("allow"), "GET, HEAD");
  }
  const about = await (await fetchRequest(new Request(`${ORIGIN}/about`), env)).text();
  assert.match(about, /<h1>叙梦是什么<\/h1>/);
  assert.match(about, /https:\/\/candy\.ai\//);
  assert.match(about, /AI成人短剧/);
  assert.doesNotMatch(about, /三上悠|新垣结|橋本環奈|木村拓哉|泷泽萝拉|桃乃木/);
  assert.match(about, /AboutPage/);
  assert.match(about, new RegExp(GEO_DEFINITION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const faq = await (await fetchRequest(new Request(`${ORIGIN}/FAQ/`), env));
  assert.equal(faq.status, 308);
  assert.equal(faq.headers.get("location"), `${ORIGIN}/faq`);
  const faqPage = await (await fetchRequest(new Request(`${ORIGIN}/faq`), env)).text();
  const faqLd = JSON.parse(faqPage.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "{}") as { "@type"?: string; mainEntity?: { name?: string; acceptedAnswer?: { text?: string } }[] };
  assert.equal(faqLd["@type"], "FAQPage");
  assert.deepEqual(faqLd.mainEntity?.map(item => item.name), geoAnswers().map(item => item.question));
  assert.deepEqual(faqLd.mainEntity?.map(item => item.acceptedAnswer?.text), geoAnswers().map(item => item.answer));
  const characters = await (await fetchRequest(new Request(`${ORIGIN}/characters`), env)).text();
  assert.equal([...characters.matchAll(/<h2>/g)].length, 8);
  const feed = await fetchRequest(new Request(`${ORIGIN}/feed.xml`), env);
  assert.match(feed.headers.get("content-type") ?? "", /application\/atom\+xml/);
  const mirror = await (await fetchRequest(new Request(`${ORIGIN}/.well-known/llms.txt`), env)).text();
  assert.equal(mirror, publicLlmsTxt());
});

test("homepage html repeats the citable definition and featured catalog", async () => {
  const html = await readFile(resolve(root, "../index.html"), "utf8");
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
  assert.equal(title, "叙梦官网｜AI 角色卡与互动故事");
  assert.ok(title.length >= 10 && title.length <= 65);
  assert.equal(description, GEO_META_DESCRIPTION);
  assert.ok(description.length >= 40 && description.length <= 180);
  assert.match(html, /name="robots" content="index, follow"/);
  assert.match(html, /name="googlebot" content="index, follow, max-image-preview:large/);
  assert.ok(html.includes(GEO_DEFINITION));
  assert.ok(html.includes(GEO_BOUNDARY));
  assert.match(html, /href="\/llms-full\.txt"/);
  assert.match(html, /href="\/feed\.xml"/);
  assert.match(html, /href="\/sitemap\.xml"/);
  assert.match(html, /href="https:\/\/huangguo\.chat\/"/);
  assert.match(html, /href="https:\/\/candy\.ai\/"/);
  assert.match(html, />角色卡</);
  assert.doesNotMatch(html, /三上悠|新垣结|橋本環奈|木村拓哉|泷泽萝拉|桃乃木/);
  assert.doesNotMatch(html, /\/dzmm|DZMM/);
  const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "{}") as { "@graph"?: { "@type"?: string }[] };
  const types = graph["@graph"]?.map(node => node["@type"]);
  for (const type of ["WebSite", "Organization", "WebApplication", "WebPage", "ItemList"]) assert.ok(types?.includes(type), type);
  for (const card of characterShareGEOEntries()) {
    assert.ok(html.includes(card.id));
    assert.ok(html.includes(card.title));
    assert.ok(html.includes(card.description.slice(0, 24)));
  }
});

test("a character page is a quotable creative work with a breadcrumb", () => {
  const card = CHARACTER_SHARE_INDEX.find(item => item.id === "xumeng-foreverse-peiyu");
  assert.ok(card);
  const html = renderCharacterSharePage({ ...card, url: `${ORIGIN}/assets/xumeng/share/${card.id}.jpg`, type: "image/jpeg", width: 1200, height: 630 });
  const structured = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "") as {
    breadcrumb?: { itemListElement?: { item?: string }[] };
    mainEntity?: { "@type"?: string; genre?: string };
  };
  assert.equal(structured.mainEntity?.["@type"], "CreativeWork");
  assert.equal(structured.mainEntity?.genre, "互动角色卡");
  assert.deepEqual(structured.breadcrumb?.itemListElement?.map(item => item.item), [
    `${ORIGIN}/`,
    `${ORIGIN}/characters`,
    `${ORIGIN}/c/${card.id}`,
  ]);
  assert.match(html, /私人会话、账号信息、余额与未公开内容不会出现在本页/);
  assert.doesNotMatch(html, /xumeng-icon-512|content="512"/);
  assert.doesNotMatch(html, new RegExp('content="summary"'));
});
