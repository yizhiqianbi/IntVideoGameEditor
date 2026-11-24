import { chromium } from 'playwright';
const base = 'https://xumengchat.top/xumeng';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
const shots = [
  ['home-videos', '#videos'],
  ['plaza', '#characters'],
  ['chat', '#chat'],
  ['studio', '#studio'],
  ['vip', '#vip'],
  ['recharge', '#recharge'],
  ['tasks', '#tasks'],
  ['app', '#app'],
];
for (const [name, hash] of shots) {
  try {
    await page.goto(base + hash, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `bp-xumeng/captures/${name}.png` });
    const txt = (await page.locator('body').innerText().catch(()=>'')).slice(0, 220).replace(/\n+/g,' | ');
    console.log(name, '::', txt);
  } catch (e) { console.log(name, 'ERR', String(e).slice(0, 100)); }
}
// mobile
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, locale: 'zh-CN' });
const mp = await mctx.newPage();
for (const [name, hash] of [['m-videos','#videos'],['m-plaza','#characters'],['m-vip','#vip'],['m-chat','#chat']]) {
  try {
    await mp.goto(base + hash, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await mp.waitForTimeout(2500);
    await mp.screenshot({ path: `bp-xumeng/captures/${name}.png` });
    console.log(name, 'ok');
  } catch (e) { console.log(name, 'ERR', String(e).slice(0, 100)); }
}
await browser.close();
