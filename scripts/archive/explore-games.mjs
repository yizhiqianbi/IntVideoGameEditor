import { chromium } from 'playwright';
const root='https://xumengchat.top';
const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:1440,height:900},locale:'zh-CN'});
const page=await ctx.newPage();
await page.goto(root+'/zh-cn#videos',{waitUntil:'domcontentloaded',timeout:30000});
await page.waitForTimeout(2500);
const routes=['#chat/games','#games','#play','#studio/games','#characters','#chat','#tasks','#explore'];
for (const h of routes) {
  try {
    await page.goto(root+'/xumeng'+h,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(2500);
    const txt=(await page.locator('body').innerText().catch(()=>'')).slice(0,500).replace(/\n+/g,' | ');
    console.log('\n===',h,page.url(),'===\n',txt);
    const links=await page.locator('a').evaluateAll(as=>as.map(a=>({t:(a.textContent||'').trim().slice(0,30),h:a.getAttribute('href')})).filter(x=>x.h).slice(0,30)).catch(()=>[]);
    console.log('links',JSON.stringify(links));
    await page.screenshot({path:`bp-xumeng/captures/explore-${h.replace(/[#/]/g,'_')}.png`});
  } catch(e){console.log(h,'ERR',String(e).slice(0,100));}
}
await browser.close();
