#!/usr/bin/env node
/**
 * Submit all sitemap URLs to IndexNow (Bing / Yandex / Naver / Seznam).
 * Run after deploying:  npm run seo:indexnow
 * Google ignores IndexNow, but Bing's index feeds ChatGPT search / Copilot.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE, PAGES } from './content.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const key = SITE.indexNowKey;
const host = new URL(SITE.origin).host;
const keyLocation = `${SITE.origin}/${key}.txt`;
const urlList = Object.values(PAGES).map((p) => `${SITE.origin}${p.path}`);

const keyFile = path.join(root, 'dist', `${key}.txt`);
if (!fs.existsSync(keyFile)) {
  console.error(`缺少 ${keyFile}，先运行 npm run build`);
  process.exit(1);
}

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key, keyLocation, urlList }),
});
console.log(`IndexNow → ${res.status} ${res.statusText} · ${urlList.length} URLs`);
if (!res.ok) {
  console.log(await res.text().catch(() => ''));
  process.exit(1);
}
