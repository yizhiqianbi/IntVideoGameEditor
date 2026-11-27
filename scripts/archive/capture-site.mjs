import { chromium } from 'playwright';
const base = 'https://xumengchat.top';
const routes = [
  ['home', '/'],
  ['plaza-female', '/#female'],
  ['plaza-male', '/#male'],
  ['chat', '/#chat'],
  ['studio', '/#studio'],
  ['novels', '/#novels'],
  ['vip', '/#vip'],
  ['recharge', '/#recharge'],
  ['drama', '/#drama'],
  ['drama-page', '/drama'],
  ['pricing', '/pricing'],
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
const results = [];
for (const [name, path] of routes) {
  try {
    const resp = await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3500);
    const title = await page.title();
    const url = page.url();
    const text = (await page.locator('body').innerText().catch(() => '')).slice(0, 300).replace(/\n+/g, ' | ');
    await page.screenshot({ path: `bp-xumeng/captures/${name}.png`, fullPage: false });
    results.push({ name, path, status: resp?.status(), title, url, text });
  } catch (e) {
    results.push({ name, path, error: String(e).slice(0, 160) });
  }
}
// nav links from home
await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2500);
const links = await page.locator('a').evaluateAll(as => as.map(a => ({ t: (a.textContent || '').trim().slice(0, 30), h: a.getAttribute('href') })).filter(x => x.h && !x.h.startsWith('http') && x.h !== '#').slice(0, 60)).catch(() => []);
await browser.close();
console.log(JSON.stringify({ results, links }, null, 1).slice(0, 12000));
