import { chromium } from 'playwright';
const base = 'https://xumengchat.top';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);
console.log('url', page.url());
// find language-ish clickable text
const texts = await page.locator('button, a, [role=button]').evaluateAll(els =>
  els.map(e => (e.textContent || '').trim()).filter(t => /語|语|English|日本語|한국어|繁體|简体|简體/.test(t)).slice(0, 20)
);
console.log('lang candidates', JSON.stringify(texts));
// list nav buttons
const navs = await page.locator('header button, header a, nav button, nav a').evaluateAll(els => els.map(e => (e.textContent || '').trim()).filter(Boolean).slice(0, 30));
console.log('navs', JSON.stringify(navs));
// try clicking 简体中文 directly if visible
try {
  const el = page.getByText('简体中文', { exact: true }).first();
  if (await el.count()) { await el.click({ timeout: 5000 }); await page.waitForTimeout(2500); console.log('clicked 简体中文 ->', page.url()); }
} catch (e) { console.log('click fail', String(e).slice(0,120)); }
const body = (await page.locator('body').innerText().catch(()=> '')).slice(0, 500).replace(/\n+/g,' | ');
console.log('body', body);
await page.screenshot({ path: 'bp-xumeng/captures/explore-after-lang.png' });
await browser.close();
