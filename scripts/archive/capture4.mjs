import { chromium } from 'playwright';
const root = 'https://xumengchat.top';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await page.goto(root + '/zh-cn#videos', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);
// tabs
for (const [name, label] of [['tab-manju','漫剧'],['tab-duanju','短剧'],['tab-tuijian','推荐']]) {
  try {
    const el = page.getByText(label, { exact: true }).first();
    if (await el.count()) { await el.click({ timeout: 4000 }); await page.waitForTimeout(2500); }
    await page.screenshot({ path: `bp-xumeng/captures/${name}.png` });
    console.log(name, 'ok', (await page.locator('body').innerText()).slice(0,100).replace(/\n+/g,' | '));
  } catch(e) { console.log(name, 'ERR', String(e).slice(0,100)); }
}
// swipe several videos and capture
for (let i=1;i<=6;i++) {
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `bp-xumeng/captures/feed-${i}.png` });
}
// click watch full drama
try {
  await page.getByText('观看完整短剧', { exact: false }).first().click({ timeout: 4000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'bp-xumeng/captures/unlock.png' });
  console.log('unlock', (await page.locator('body').innerText()).slice(0,300).replace(/\n+/g,' | '));
} catch(e) { console.log('unlock fail', String(e).slice(0,100)); }
// character page simplified
for (const [n,p] of [['sch-peiyu','/c/xumeng-foreverse-peiyu'],['sch-tangtuantuan','/c/xumeng-foreverse-tangtuantuan']]) {
  await page.goto(root + p, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `bp-xumeng/captures/${n}.png` });
  console.log(n, (await page.locator('body').innerText()).slice(0,80).replace(/\n+/g,' | '));
}
await browser.close();
console.log('done');
