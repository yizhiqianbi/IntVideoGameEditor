import { chromium } from 'playwright';
const root = 'https://xumengchat.top';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
// set simplified via entering zh-cn
await page.goto(root + '/zh-cn#videos', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2500);
for (const [n,p] of [['c-peiyu','/c/xumeng-foreverse-peiyu'],['c-tangtuantuan','/c/xumeng-foreverse-tangtuantuan'],['c-wangushi','/c/xumeng-foreverse-wangushi']]) {
  await page.goto(root + p, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `bp-xumeng/captures/${n}.png` });
  console.log(n, page.url(), (await page.locator('body').innerText()).slice(0,60).replace(/\n+/g,' | '));
}
await browser.close();
