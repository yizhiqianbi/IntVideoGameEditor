import { chromium } from 'playwright';
const root='https://xumengchat.top';
const browser=await chromium.launch();
for (const p of ['/xumeng/c/xumeng-foreverse-peiyu','/zh-cn/c/xumeng-foreverse-peiyu','/c/xumeng-foreverse-peiyu']) {
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await ctx.newPage();
  await page.goto(root+p,{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
  await page.waitForTimeout(3000);
  console.log(p, '->', page.url(), (await page.locator('body').innerText()).slice(0,80).replace(/\n+/g,' | '));
  await page.screenshot({path:'bp-xumeng/captures/test-char.png'});
  await ctx.close();
}
await browser.close();
