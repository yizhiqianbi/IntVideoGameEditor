#!/usr/bin/env node
/**
 * Submit all canonical URLs from the live sitemap to IndexNow (Bing / Yandex / ChatGPT Search).
 *
 * Usage:
 *   INDEXNOW_KEY=<your-key> node scripts/submit-indexnow.mjs [--base-url https://xumengchat.top]
 */

const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base-url");
const base = (baseIdx >= 0 && args[baseIdx + 1] ? args[baseIdx + 1] : "https://xumengchat.top").replace(/\/$/, "");
const key = (process.env.INDEXNOW_KEY ?? "").trim();

if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) {
  console.error("请设置合法的环境变量 INDEXNOW_KEY（8–128 位字母、数字或连字符）。");
  process.exit(1);
}

const sitemapRes = await fetch(`${base}/sitemap.xml`);
if (!sitemapRes.ok) {
  console.error(`读取 sitemap 失败：HTTP ${sitemapRes.status}`);
  process.exit(1);
}
const xml = await sitemapRes.text();
const urls = [...new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]))];
if (urls.length === 0) {
  console.error("sitemap 中未解析出任何 URL。");
  process.exit(1);
}

const submitRes = await fetch(`${base}/api/ops/indexnow`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  },
  body: JSON.stringify({ urls }),
});
const result = await submitRes.text();
console.log(`IndexNow status=${submitRes.status} urls=${urls.length} body=${result}`);
if (!submitRes.ok) process.exit(1);
