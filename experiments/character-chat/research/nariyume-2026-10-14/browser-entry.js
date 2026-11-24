/* Older Safari (<16) has no AbortSignal.timeout and (<17.4) no AbortSignal.any;
   app, collector and pixel code call both. Load-first, guarded, spec-shaped. */
(()=>{const A=typeof AbortSignal==='function'?AbortSignal:null;if(!A||typeof AbortController!=='function')return;
 const reason=(name,msg)=>{try{return new DOMException(msg,name);}catch{const e=new Error(msg);e.name=name;return e;}};
 if(typeof A.timeout!=='function')A.timeout=ms=>{const c=new AbortController();setTimeout(()=>c.abort(reason('TimeoutError','signal timed out')),ms);return c.signal;};
 if(typeof A.any!=='function')A.any=signals=>{const c=new AbortController();for(const s of signals){if(s.aborted){c.abort(s.reason);return c.signal;}}
  for(const s of signals)s.addEventListener('abort',()=>{if(!c.signal.aborted)c.abort(s.reason);},{once:true});return c.signal;};
})();
/* Mobile social-browser doorway. No sign-in, identifiers or permission changes. */
(()=>{'use strict';
 const url=new URL(location.href),handoff=url.searchParams.get('ny_handoff');
 // Presentation-only snapshot before the collector cleans the address bar.
 // No click IDs, cookies, network calls or persisted attribution are added.
 const characterEntry=new URLSearchParams();
 for(const key of ['utm_source','utm_content','ny_entry','account','checkout','session_id','mode','oobCode','x_return','x_error','code','state','oauth_token','oauth_verifier','signin'])
  for(const value of url.searchParams.getAll(key))characterEntry.append(key,key==='ny_entry'?value.slice(0,20):['utm_source','utm_content'].includes(key)?value.slice(0,200):'1');
 window.__nyCharacterEntrySearch=characterEntry.toString();
 const arrivedAs=url.searchParams.get('ny_browser_arrived'),arrived=['1','stay','fallback','continued','share'].includes(arrivedAs);
 const knownInApp=/FBAN|FBAV|FBIOS|Instagram|TikTok|Bytedance|musical_ly|Twitter|\bwv\b/i.test(navigator.userAgent);
 // Branded in-app browsers plus generic iOS WKWebViews (no browser token):
 // an arrival marker there never proves the real browser opened.
 const embeddedUA=knownInApp||(/iPhone|iPad|iPod/.test(navigator.userAgent)||/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1)&&/AppleWebKit/i.test(navigator.userAgent)&&!/Safari|CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent);
 if(arrived){url.searchParams.delete('ny_browser_arrived');history.replaceState(history.state,'',url.pathname+url.search+url.hash);try{sessionStorage.setItem('ny.browserHere.v1',(arrivedAs==='1'||arrivedAs==='share')&&!embeddedUA?'open':'stay');}catch{}}
 // Identifier-free landing quality counters (platform + stage only), once per
 // tab. Network/visibility signals are not proof that a visitor is human.
 const trafficSource=(()=>{const p=url.searchParams,s=(p.get('utm_source')||'').toLowerCase();
  const platform=p.has('twclid')?'x':p.has('ttclid')?'tiktok':p.has('gclid')||p.has('gbraid')||p.has('wbraid')?'google':({x:'x',twitter:'x',meta:'meta',facebook:'meta',fb:'meta',instagram:'meta',ig:'meta',threads:'meta',tiktok:'tiktok',tt:'tiktok',applovin:'applovin',axon:'applovin',google:'google'})[s]||(p.has('fbclid')?'meta':null);
  let saved=null;try{saved=JSON.parse(sessionStorage.getItem('ny.traffic.v1')||'null');}catch{}
  if(platform){saved={p:platform,c:/organic/i.test(p.get('utm_medium')||'')?'organic':'paid',sent:saved?.p===platform?saved.sent||{}:{}};try{sessionStorage.setItem('ny.traffic.v1',JSON.stringify(saved));}catch{}}
  return saved&&['x','meta','tiktok','applovin','google'].includes(saved.p)?{p:saved.p,c:saved.c==='organic'?'organic':'paid',sent:saved.sent&&typeof saved.sent==='object'?saved.sent:{}}:null;})();
 const traffic=stage=>{try{if(!trafficSource||trafficSource.sent[stage])return;trafficSource.sent[stage]=1;try{sessionStorage.setItem('ny.traffic.v1',JSON.stringify(trafficSource));}catch{}
  const body=JSON.stringify({p:trafficSource.p,c:trafficSource.c,s:stage,w:navigator.webdriver===true});
  try{if(navigator.sendBeacon?.('/api/traffic',body))return;}catch{}
  void fetch('/api/traffic',{method:'POST',body,keepalive:true}).catch(()=>{});}catch{}};
 // Remove the opaque receipt before analytics/third-party scripts see the URL.
 if(handoff){window.__nyHandoffToken=/^[\w-]{43}$/.test(handoff)?handoff:null;url.searchParams.delete('ny_handoff');history.replaceState(history.state,'',url.pathname+url.search+url.hash);}
 const ua=navigator.userAgent,ios=/iPhone|iPad|iPod/.test(ua)||/Macintosh/.test(ua)&&navigator.maxTouchPoints>1;
 const mobile=ios||/Android/.test(ua);
 const social=knownInApp||ios&&/AppleWebKit/i.test(ua)&&!/Safari|CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
 // Some X browser versions expose the same UA as Safari. An X landing can
 // offer the choice without claiming the browser is embedded or blocking OAuth.
 let xLanding=/^(x|twitter)$/i.test(url.searchParams.get('utm_source')||'')||url.searchParams.has('twclid');
 try{xLanding=xLanding||/(^|\.)(t\.co|x\.com|twitter\.com)$/.test(new URL(document.referrer).hostname);}catch{}
 const standalone=navigator.standalone===true||window.matchMedia?.('(display-mode: standalone)').matches;
 let skipped=false,returning=false;
 try{skipped=arrived||document.cookie.split(';').some(value=>value.trim()==='ny_browser_entry=1')||!!sessionStorage.getItem('ny.browserHere.v1');returning=!!JSON.parse(localStorage.getItem('ny.auth.v1')||'null')?.uid||!!sessionStorage.getItem('ny.oauthReturn.v1')||!!sessionStorage.getItem('ny.xReturn.v1');}catch{}
 const authReturn=!!handoff||['x_return','x_error','code','state','oauth_token','oauth_verifier','mode','oobCode','signin','checkout','session_id'].some(key=>url.searchParams.has(key));
 window.__nyStartupRecoveryProtected=authReturn||returning;
 // TikTok hard-blocks the Safari/browser escape (owner, 2026-09-28): never
 // show the door there; its visitors go straight into the app.
 // `ny_door=off` marks a link that opens straight into the app (/t); remember it for the tab.
 const doorOff=url.searchParams.get('ny_door')==='off';
 if(doorOff){url.searchParams.delete('ny_door');history.replaceState(history.state,'',url.pathname+url.search+url.hash);try{sessionStorage.setItem('ny.browserHere.v1','stay');}catch{}}
 let tiktok=doorOff||/TikTok|Bytedance|musical_ly/i.test(ua)||url.searchParams.has('ttclid')||/^(tiktok|tt)$/i.test(url.searchParams.get('utm_source')||'');
 try{tiktok=tiktok||/(^|\.)tiktok\.com$/.test(new URL(document.referrer).hostname);}catch{}
 // X, like TikTok, never gets the choice screen (owner, 2026-09-28): the server
 // tries the hand-off once and continues in place. Where the server could not
 // (an iPad presenting a desktop UA), the app opens directly, as on desktop.
 const xTraffic=xLanding||/Twitter/i.test(ua);
 // Only the restricted iOS X/TikTok webview gets the owner's share-sheet
 // escape. A campaign tag alone never changes Safari/Chrome. Unknown iOS
 // webviews need X/TikTok entry context; known Meta/Instagram stay unchanged.
 let tiktokShare=/TikTok|Bytedance|musical_ly/i.test(ua)||url.searchParams.has('ttclid')||/^(tiktok|tt)$/i.test(url.searchParams.get('utm_source')||'');
 try{tiktokShare=tiktokShare||/(^|\.)tiktok\.com$/.test(new URL(document.referrer).hostname);}catch{}
 // TikTok (owner rule 2026-09-30): the gate ALWAYS shows on iPhone, even when
 // TikTok's webview presents a plain Safari UA, until the visitor has been
 // shared/escaped out to the real browser (our own arrival marker). Desktop never.
 let sharedOut=false;
 if(!embeddedUA){if(arrivedAs==='1'||arrivedAs==='share')sharedOut=true;else try{sharedOut=sessionStorage.getItem('ny.browserHere.v1')==='open';}catch{}}
 const shareBrowser=ios&&!standalone&&!/Instagram|FBAN|FBAV|FBIOS/i.test(ua)&&(tiktokShare?!sharedOut:social&&xTraffic);
 window.__nyEmbeddedGoogleAllowed=shareBrowser&&(/TikTok|Bytedance|musical_ly/i.test(ua)||!xTraffic&&tiktokShare)&&!/Twitter/i.test(ua);
 if(shareBrowser)window.__nyPrepareShareHandoff=()=>prepare();
 if(shareBrowser)window.__nyShareBrowser=()=>{
  if(typeof navigator.share!=='function')return Promise.reject(new Error('share_unavailable'));
  let mayLink=false;try{mayLink=navigator.globalPrivacyControl!==true&&window.__nyMeasurement?.snapshot().marketing===true;}catch{}
  const target=new URL(mayLink&&expiry>Date.now()?destination:clean);
  target.searchParams.set('ny_browser_arrived','share'); // counted on arrival; opening a sheet is NOT a confirmed escape
  const character=url.searchParams.get('ny_entry');
  if(character==='nari'||character==='yume')target.searchParams.set('ny_entry',character);
  // Only the existing consent-gated, expiring attribution handoff may link
  // the two browsers. Never share login tokens, account state or arbitrary URLs.
  // Invoke synchronously inside the real button tap (no network/SDK wait).
  const sharing=navigator.share({title:'NariYume',url:target.href});
  try{measure('pending');}catch{} // attempted, NOT completed or lost
  return sharing;
 };
 const waiting=mobile&&social&&!tiktok&&!xTraffic&&!standalone&&!skipped&&!returning&&!authReturn;
 const visible=()=>document.visibilityState==='visible'&&!document.prerendering;
 let released=false,resolveEntry;
 window.__nyBrowserEntry=new Promise(resolve=>{resolveEntry=resolve;});
 const reachedApp=()=>{if(released&&visible())traffic('rendered');};
 const release=()=>{released=true;reachedApp();resolveEntry();};
 document.addEventListener('visibilitychange',reachedApp);document.addEventListener('prerenderingchange',reachedApp);
 if(trafficSource){const engaged=e=>{if(!released||!visible()||!e.isTrusted)return;for(const t of ['pointerdown','keydown'])removeEventListener(t,engaged,true);traffic('engaged');};for(const t of ['pointerdown','keydown'])addEventListener(t,engaged,{capture:true,passive:true});}
 if(!waiting)release();
 // Preserve acquisition even when handoff creation is unavailable. Never copy
 // auth credentials or arbitrary destinations into the outgoing link.
 const base=new URL('https://nariyume.com/app/');
 for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','utm_id','fbclid','ttclid','twclid','gclid','gbraid','wbraid','ny_account_id','ny_campaign_id','ny_adgroup_id','ny_ad_id'])if(url.searchParams.has(key))base.searchParams.set(key,url.searchParams.get(key));
 base.searchParams.set('ny_browser_arrived','1');
 const clean=base.href;let destination=clean,expiry=0;
 const instagram=ios&&/Instagram/i.test(ua);
 // Instagram handles its own external-browser route; the generic Safari
 // scheme is ignored by some Instagram iOS builds. Keep this a real tap.
 const escapeUrl=()=>{
  const fallback=new URL(destination);fallback.searchParams.set('ny_browser_arrived','fallback');
  return !mobile?destination:instagram?'instagram://extbrowser/?url='+encodeURIComponent(destination):ios?destination.replace(/^https:/,'x-safari-https:'):
   'intent://'+destination.slice('https://'.length)+'#Intent;scheme=https;action=android.intent.action.VIEW;S.browser_fallback_url='+encodeURIComponent(fallback.href)+';end';
 };
 const measure=(outcome)=>{const name={active:'auth.escape_offered',pending:'auth.escape_clicked'}[outcome];if(name)window.__nyMeasurement?.event(name,{auth_browser:social?'in_app':mobile?'mobile':'desktop',auth_os:ios?'ios':/Android/.test(ua)?'android':mobile?'other':'desktop'});};
 let panel=null,link=null,preparing=null,offered=false;
 const refreshLinks=()=>{if(link)link.href=escapeUrl();};
 function prepare(){
  if(preparing)return preparing;
  const m=window.__nyMeasurement;
  if(!m?.prepareHandoff)return Promise.resolve();
  preparing=Promise.resolve().then(()=>m.prepareHandoff()).then(value=>{if(/^[\w-]{43}$/.test(value?.token||'')&&Number.isFinite(value.expires)&&value.expires>Date.now()){const next=new URL(clean);next.searchParams.set('ny_handoff',value.token);destination=next.href;expiry=value.expires;}},()=>{}).finally(()=>{preparing=null;refreshLinks();});
  return preparing;
 }
 window.__nyPrepareBrowserHandoff=()=>{if(panel){try{if(!offered&&window.__nyMeasurement?.snapshot().enabled){offered=true;measure('active');}}catch{}return prepare();}};
 function show(early=false){
  if(panel)return;
  panel=document.createElement('section');panel.id='ny-browser-door';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','ny-browser-title');
  let tapTimer;
  const cancelStuck=()=>clearTimeout(tapTimer);
  const doorVisible=()=>{if(!visible()){cancelStuck();return;}requestAnimationFrame(()=>{if(panel&&visible())traffic('door_rendered');});};
  document.addEventListener('visibilitychange',doorVisible);document.addEventListener('prerenderingchange',doorVisible);addEventListener('pagehide',cancelStuck);
  const stopObserving=()=>{cancelStuck();document.removeEventListener('visibilitychange',doorVisible);document.removeEventListener('prerenderingchange',doorVisible);removeEventListener('pagehide',cancelStuck);};
  const style=document.createElement('style');style.textContent=`
  #ny-browser-door{position:fixed;inset:0;z-index:2147483000;box-sizing:border-box;overflow:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px max(24px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom));background:radial-gradient(ellipse at 50% 35%,#ffe0eb,transparent 68%),#fff6e6;color:#513424;font-family:Nunito,system-ui,sans-serif;text-align:center}
  #ny-browser-door *{box-sizing:border-box}#ny-browser-door .ny-door-card{width:min(100%,390px);background:#fffaf1;border:3px solid #fff;border-radius:28px;padding:24px;box-shadow:0 7px 0 #e5c5b4,0 18px 40px #865a311a}
  #ny-browser-door img{width:126px;height:126px;object-fit:contain;margin:0 auto 8px}#ny-browser-door h1{font:600 27px/1.2 Fredoka,system-ui,sans-serif;margin:0 0 12px}#ny-browser-door p{font-size:16px;line-height:1.5;margin:12px 0 22px}
  #ny-browser-door a,#ny-browser-door button{font:800 17px/1.4 Nunito,system-ui,sans-serif;cursor:pointer}#ny-browser-door .ny-door-open{display:block;color:white;background:linear-gradient(#77dd29,#27a900);border:2px solid white;border-radius:17px;box-shadow:0 4px 0 #277321;padding:14px 10px;text-decoration:none}
  #ny-browser-door .ny-door-stay,#ny-browser-door .ny-door-copy{display:block;margin:20px auto 0;border:0;background:none;color:#513424;text-decoration:underline;padding:8px}#ny-browser-door .ny-door-help{font-size:14px;margin-bottom:0}#ny-browser-door [hidden]{display:none!important}#ny-browser-door :focus-visible{outline:3px solid #287cbb;outline-offset:4px}
  `;panel.append(style);
  const card=document.createElement('div');card.className='ny-door-card';
  card.innerHTML='<div style="display:flex;justify-content:center;gap:8px"><img style="max-width:44%" src="/app/assets/stickers/nari.sticker.mood.webp" alt="" width="126" height="126"><img style="max-width:44%" src="/app/assets/stickers/yume.sticker.mood.webp" alt="" width="126" height="126"></div><h1 id="ny-browser-title">Meet Nari and Yume</h1><p>Open in your browser to come back easily.</p>';
  link=document.createElement('a');link.className='ny-door-open';link.textContent=instagram?'Open in browser ↗':ios?'Open in Safari ↗':'Open in browser ↗';link.href=escapeUrl();link.rel='noreferrer';
  const launch=()=>{
    // A pending/expired attribution token must never consume the user's launch
    // gesture. The safe acquisition URL is already usable without the token.
    if(expiry&&expiry<Date.now()){destination=clean;expiry=0;refreshLinks();}
    // Navigation is synchronous in this actual tap: no awaited fetch and no
    // timed app launches. A click is not evidence the external browser opened.
    try{measure('pending');}catch{}traffic('door_open_tap');cancelStuck();
    if(visible())tapTimer=setTimeout(()=>{if(panel&&visible())traffic('door_open_stuck');},1500);
  };
  link.onclick=launch;
  card.append(link);
  // Explicit alternative, never an automatic cascade that opens two browsers.
  const stay=document.createElement('button');stay.type='button';stay.className='ny-door-stay';stay.textContent='Continue here';stay.onclick=()=>{stopObserving();try{sessionStorage.setItem('ny.browserHere.v1','stay');}catch{}traffic('door_stay');panel.remove();panel=null;link=null;release();};
  card.append(stay);panel.append(card);document.body.append(panel);doorVisible();void window.__nyPrepareBrowserHandoff();
  if(!early)link.focus();
 }
 // Owner-approved attachment experiment on the embedded Google button only.
 // One synchronous HTTPS navigation; no scheme cascade or automatic download.
 window.__nyLaunchBrowser=()=>{
  const download=new URL('/browser-download',location.origin);
  for(const [key,value]of base.searchParams)if(key!=='ny_browser_arrived')download.searchParams.set(key,value);
  // Never persist an OAuth credential or short-lived handoff token in a file.
  const direct=document.createElement('a');direct.href=download.href;direct.rel='noreferrer';direct.hidden=true;
  try{measure('pending');}catch{}traffic('door_open_tap');
  document.body.append(direct);try{direct.click();}finally{direct.remove();}
 };
 window.__nyOpenBrowserDoor=()=>show(false);
 const start=()=>{if(waiting)show(true);};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
/* Last-resort empty shell recovery. Runs after the entry door releases, never
   while a user is signing in, paying, typing, or already inside the app. */
(()=>{
 const key='ny.emptyShellRetry.v1';let timer,stopped=false,touched=false;
 const touch=()=>{touched=true;};
 for(const name of ['pointerdown','keydown','input'])addEventListener(name,touch,{capture:true,passive:true});
 const stop=()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',arm);for(const name of ['pointerdown','keydown','input'])removeEventListener(name,touch,true);};
 const arm=()=>{
  clearTimeout(timer);if(stopped||document.visibilityState!=='visible')return;
  timer=setTimeout(()=>{
   if(document.visibilityState!=='visible')return;
   const root=document.getElementById('root');
   if(!root||root.childElementCount||root.textContent.trim()){stop();return;}
   stop();
   let safe=false;
   try{
    // Only a never-used empty startup screen can reload automatically, once
    // per tab lifetime. Storage failure means no automatic reload.
    safe=!touched&&!window.__nyStartupRecoveryProtected&&!sessionStorage.getItem(key)
      &&!sessionStorage.getItem('ny.oauthReturn.v1')&&!sessionStorage.getItem('ny.xReturn.v1')
      &&!localStorage.getItem('ny.xDeletePending.v1')&&!localStorage.getItem('ny.deletedAccountCleanup.v1')
      &&!JSON.parse(localStorage.getItem('ny.auth.v1')||'null')?.uid;
    if(safe){sessionStorage.setItem(key,'1');safe=sessionStorage.getItem(key)==='1';}
   }catch{safe=false;}
   if(safe){location.reload();return;}
   const panel=document.createElement('div');panel.setAttribute('role','alert');
   panel.style.cssText='position:fixed;inset:35% 20px auto;z-index:2147483000;padding:20px;background:#fff6e6;color:#513424;border-radius:16px;text-align:center';
   const text=document.createElement('p');text.textContent='The page couldn’t finish loading.';
   const button=document.createElement('button');button.type='button';button.textContent='Reload';button.onclick=()=>location.reload();panel.append(text,button);document.body.append(panel);
   // A delayed healthy boot removes this fallback without requiring a reload.
   const observer=new MutationObserver(()=>{if(root.childElementCount||root.textContent.trim()){panel.remove();observer.disconnect();}});
   observer.observe(root,{childList:true,subtree:true,characterData:true});
  },20000);
 };
 Promise.resolve(window.__nyBrowserEntry).then(()=>{if(!stopped){document.addEventListener('visibilitychange',arm);arm();}});
})();
