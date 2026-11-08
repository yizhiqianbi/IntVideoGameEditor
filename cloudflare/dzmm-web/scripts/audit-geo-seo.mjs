#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const base = (valueFor("--base-url") ?? "https://xumengchat.top").replace(/\/$/, "");
const characterPath = valueFor("--character") ?? "/c/xumeng-foreverse-peiyu";
const out = valueFor("--output");

const get = async path => {
  const url = `${base}${path}`;
  const response = await fetch(url, { redirect: "manual" });
  return {
    path,
    url,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    text: await response.text(),
  };
};
const meta = (html, key, attribute = "name") => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<meta\\s+${attribute}=["']${escaped}["']\\s+content=["']([^"']*)["']`, "i"));
  return match?.[1] ?? "";
};
const link = (html, rel) => html.match(new RegExp(`<link\\s+rel=["']${rel}["']\\s+href=["']([^"']+)["']`, "i"))?.[1] ?? "";
const scripts = html => [...html.matchAll(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi)].flatMap(match => {
  try { return [JSON.parse(match[1])]; } catch { return []; }
});
const hasText = (html, pattern) => pattern.test(html);

const [home, llms, llmsFull, robots, sitemap, character, about, faq, characters, feed] = await Promise.all([
  get("/"), get("/llms.txt"), get("/llms-full.txt"), get("/robots.txt"), get("/sitemap.xml"), get(characterPath),
  get("/about"), get("/faq"), get("/characters"), get("/feed.xml"),
]);
const homeLd = scripts(home.text);
const characterLd = scripts(character.text);
const graphTypes = homeLd.flatMap(node => node?.["@graph"] ?? [node]).map(node => node?.["@type"]).flat().filter(Boolean);
const mainEntities = characterLd.flatMap(node => node?.mainEntity ? [node.mainEntity] : []);
const sitemapLocs = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(match => match[1]);
const seoChecks = {
  html: home.status === 200 && /text\/html/i.test(home.contentType),
  title: (() => { const t = home.text.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ?? ""; return t.length >= 10 && t.length <= 65; })(),
  description: meta(home.text, "description").length >= 40 && meta(home.text, "description").length <= 180,
  canonical: link(home.text, "canonical") === "https://xumengchat.top/",
  robotsIndex: /index\s*,\s*follow/i.test(meta(home.text, "robots")),
  openGraph: ["og:title", "og:description", "og:type", "og:url", "og:image"].every(key => Boolean(meta(home.text, key, "property"))),
  twitter: ["twitter:card", "twitter:title", "twitter:description", "twitter:image"].every(key => Boolean(meta(home.text, key))),
  jsonLd: homeLd.length > 0,
  mobileViewport: /<meta\s+name=["']viewport["'][^>]+width=device-width/i.test(home.text),
  sitemap: sitemap.status === 200 && sitemapLocs.length >= 10 && sitemapLocs.every(url => /^https:\/\//i.test(url)),
};
const pageLocs = [...sitemap.text.matchAll(/<url>\s*<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
const geoChecks = {
  semanticHomeCopy: hasText(home.text, /<h1>[^<]*(?:叙梦|角色卡|互动故事)/i) && hasText(home.text, /公开角色/i),
  homeGraph: ["WebSite", "Organization", "WebApplication", "ItemList"].every(type => graphTypes.includes(type)),
  characterGraph: character.status === 200 && characterLd.some(node => node?.["@type"] === "WebPage") && mainEntities.some(node => node?.["@type"] === "CreativeWork"),
  characterBreadcrumb: characterLd.some(node => node?.breadcrumb?.["@type"] === "BreadcrumbList"),
  llmsSource: llms.status === 200 && /text\/plain/i.test(llms.contentType) && /^# 叙梦/m.test(llms.text) && (llms.text.match(/\/c\/[a-z0-9-]+/g) ?? []).length >= 8,
  llmsFull: llmsFull.status === 200 && /text\/plain/i.test(llmsFull.contentType) && /可引用事实/.test(llmsFull.text) && /不要引用/.test(llmsFull.text),
  privacyBoundary: /私人会话|账号信息|余额|未公开/i.test(llms.text) && !/性虐|性奴|色情/i.test(`${llms.text}\n${llmsFull.text}`),
  crawlBoundary: /Disallow:\s*\/api\//i.test(robots.text) && /Disallow:\s*\/health/i.test(robots.text) && sitemapLocs.every(url => !/\/api\//i.test(url)),
  answerCrawlers: ["GPTBot", "OAI-SearchBot", "PerplexityBot", "ClaudeBot", "Bytespider", "Baiduspider"].every(agent => new RegExp(`User-agent:\\s*${agent}`).test(robots.text)),
  aboutPage: about.status === 200 && /<h1>叙梦是什么/.test(about.text) && about.text.includes("application/ld+json"),
  faqPage: faq.status === 200 && /FAQPage/.test(faq.text) && /叙梦是什么？/.test(faq.text),
  characterDirectory: characters.status === 200 && (characters.text.match(/\/c\/xumeng-foreverse-/g) ?? []).length >= 8,
  sitemapGuides: ["/about", "/faq", "/characters", "/community-guidelines"].every(path => pageLocs.some(url => url.endsWith(path))),
  feed: feed.status === 200 && /application\/atom\+xml/i.test(feed.contentType) && /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/.test(feed.text),
};
const count = checks => Object.values(checks).filter(Boolean).length;
const result = {
  generatedAt: new Date().toISOString(),
  base,
  characterPath,
  production: { home: { status: home.status, contentType: home.contentType }, llms: { status: llms.status, contentType: llms.contentType }, llmsFull: { status: llmsFull.status, contentType: llmsFull.contentType }, robots: { status: robots.status, contentType: robots.contentType }, sitemap: { status: sitemap.status, contentType: sitemap.contentType, urlCount: pageLocs.length }, character: { status: character.status, contentType: character.contentType }, about: { status: about.status }, faq: { status: faq.status }, characters: { status: characters.status }, feed: { status: feed.status } },
  seo: { score: Math.round(count(seoChecks) / Object.keys(seoChecks).length * 100), passed: count(seoChecks), total: Object.keys(seoChecks).length, checks: seoChecks },
  geo: { score: Math.round(count(geoChecks) / Object.keys(geoChecks).length * 100), passed: count(geoChecks), total: Object.keys(geoChecks).length, checks: geoChecks },
  note: "技术分数衡量公开可抓取信号，不代表排名、点击或回答引擎引用已经增长。",
};
console.log(JSON.stringify(result, null, 2));
if (out) {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
}
