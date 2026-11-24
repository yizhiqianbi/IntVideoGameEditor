import { chromium } from 'playwright';
const root = 'https://xumengchat.top';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
const chars = [
  ['char-peiyu', '/c/xumeng-foreverse-peiyu'],
  ['char-tangtuantuan', '/c/xumeng-foreverse-tangtuantuan'],
  ['char-wangushi', '/c/xumeng-foreverse-wangushi'],
  ['about-xumeng', '/xumeng-about'],
];
for (const [n,p] of chars) {
  try {
    const r = await page.goto(root + p, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `bp-xumeng/captures/${n}.png` });
    console.log(n, r?.status(), page.url(), (await page.title()));
  } catch(e) { console.log(n, 'ERR', String(e).slice(0,80)); }
}
await browser.close();
