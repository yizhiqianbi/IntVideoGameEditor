import { chromium } from 'playwright';
const browser = await chromium.launch();
for (const path of ['/zh#videos','/zh-cn#videos','/zh-Hans#videos','/cn#videos','/zh#characters','/zh#vip']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const resp = await page.goto('https://xumengchat.top' + path, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => null);
  await page.waitForTimeout(2000);
  const txt = (await page.locator('body').innerText().catch(()=> '')).slice(0, 160).replace(/\n+/g,' | ');
  console.log(path, resp?.status(), page.url(), '::', txt);
  await ctx.close();
}
await browser.close();
