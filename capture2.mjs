import { chromium } from 'playwright';
const root = 'https://xumengchat.top';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
// set simplified language via zh-cn entry
await page.goto(root + '/zh-cn#videos', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3500);
console.log('lang url', page.url());
const base = root + '/xumeng';
async function shot(name, hash, wait = 2500) {
  await page.goto(base + hash, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `bp-xumeng/captures/${name}.png` });
  const t = (await page.locator('body').innerText().catch(()=>'')).slice(0, 120).replace(/\n+/g,' | ');
  console.log(name, '::', t);
}
await shot('v2-videos', '#videos', 3500);
// try next videos
for (let i = 1; i <= 2; i++) {
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `bp-xumeng/captures/v2-videos-${i+1}.png` });
}
await shot('v2-studio', '#studio');
await shot('v2-vip', '#vip');
await shot('v2-recharge', '#recharge');
await shot('v2-tasks', '#tasks');
await shot('v2-app', '#app');
await shot('v2-chat', '#chat');
await page.goto(root + '/characters', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(()=>{});
await page.waitForTimeout(2500);
await page.screenshot({ path: 'bp-xumeng/captures/v2-characters.png' });
// mobile
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, locale: 'zh-CN' });
const mp = await mctx.newPage();
await mp.goto(root + '/zh-cn#videos', { waitUntil: 'domcontentloaded', timeout: 30000 });
await mp.waitForTimeout(3000);
await mp.screenshot({ path: 'bp-xumeng/captures/v2-m-videos.png' });
for (const [n,h] of [['v2-m-studio','#studio'],['v2-m-vip','#vip'],['v2-m-chat','#chat']]) {
  await mp.goto(root + '/xumeng' + h, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await mp.waitForTimeout(2200);
  await mp.screenshot({ path: `bp-xumeng/captures/${n}.png` });
}
await browser.close();
console.log('done');
