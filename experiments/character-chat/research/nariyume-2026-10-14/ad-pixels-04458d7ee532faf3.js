/* AppLovin/X use the landing page; other providers remain isolated. */
(()=>{'use strict';
 const ORIGIN='https://go.nariyume.com',MARK='ny-pixel-v1',hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
 const X_PIXEL='rfoad',X_EVENTS={page_view:'tw-rfoad-rf8ph',view_item:'tw-rfoad-rfa4d',add_to_cart:'tw-rfoad-rfa4e',begin_checkout:'tw-rfoad-rfa4f',sign_up:'tw-rfoad-rfa4b',purchase:'tw-rfoad-rfa4a'},X_DELIVERY='ny.xpixel.delivery.v1';
 const inApp=location.pathname==='/app'||location.pathname.startsWith('/app/');
 // Automated browsers and self-declared bots never load pixels or send
 // conversions, so ad networks do not learn from non-human sessions.
 const automated=(()=>{try{const n=globalThis.navigator,ua=String(n?.userAgent||'').replace(/cubot/gi,'');return n?.webdriver===true||/bot\b|bot\/|crawl|spider|headless|phantom|puppeteer|playwright|selenium|lighthouse|facebookexternalhit|meta-external|bytespider|google-read-aloud|preview/i.test(ua)||(!!ua&&!/^Mozilla\//.test(ua));}catch{return false;}})();
 const qaExcluded=()=>automated||new URLSearchParams(location.search).get('ny_qa')==='1';
 // The account router removes checkout parameters once access resolves. Keep
 // only this local intent flag; server-verified invoice data still authorizes
 // every purchase event. A URL alone never proves a purchase.
 const checkoutReturn=inApp&&new URLSearchParams(location.search).get('checkout')==='success';
 let frame=null,ready=false,pending=[],excluded=qaExcluded(),generation=0,checking=false,xEnabled=false,xScript=null;const purchases=new Set();
 let viewedPlan=null,checkoutIntent=0,begunIntent=-1,signedIn=false,axonEnabled=false,axonScript=null,automaticRegion=false,frameMode=null,checkoutStarted=false;
 const explicit=()=>{const state=window.__nyMeasurement?.snapshot();return state?.marketing===true&&state.advertisingBasis==='choice';};
 const automaticCandidate=()=>inApp&&window.__nyMeasurement?.snapshot().applovinDefaultAllowed===true;
 const allowed=()=>!excluded&&(explicit()||(automaticCandidate()&&automaticRegion));
 const mayStart=()=>!excluded&&(explicit()||automaticCandidate());
 // X's documented base pixel must run on the actual landing page; the old
 // oct.js tag inside a cross-origin iframe did not establish first-party visits.
 // Keep the campaign-selected custom site-visit event on the real page, alongside
 // the bounded product events. The base config also supplies X's automatic visits.

 // Axon runs on the real landing URL so click IDs and its helper are visible.
 // Only the bounded product events below are sent; never chat or account data.
 let cookiePending=false,cookieState='not_started';
 let axonUserId=null,pendingLogin=null,sessionResolved=false,advertisingMatch=null;
 function cookieFailure(reason){cookieState=reason;console.warn('[NariYume AppLovin] axwrt setup failed: '+reason);}
 function mirrorAxonCookie(finalAttempt=false){if(!allowed()||!axonEnabled||cookiePending)return;
  const id=document.cookie?.match(/(?:^|;\s*)_axwrt=([a-f0-9-]{36})(?:;|$)/i)?.[1];
  if(!id){if(finalAttempt)cookieFailure('sdk_cookie_missing');return;}
  const saved=document.cookie?.match(/(?:^|;\s*)axwrt=([a-f0-9-]{36})(?:;|$)/i)?.[1];
  if(saved===id){cookieState='verified';return;}
  const g=generation;cookiePending=true;cookieState='setting';
  void fetch('/api/ads-cookie',{method:'POST',credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(5000)})
   .then(r=>{if(g!==generation||!allowed())return;if(!r.ok){cookieFailure('http_'+r.status);return;}
    const received=document.cookie?.match(/(?:^|;\s*)axwrt=([a-f0-9-]{36})(?:;|$)/i)?.[1];
    if(received!==id)cookieFailure('cookie_not_stored');else cookieState='verified';})
   .catch(()=>{if(g===generation&&allowed())cookieFailure('network_or_timeout');})
   .finally(()=>{cookiePending=false;if(g!==generation||!allowed())clearCookies();});
 }
 // AppLovin/Axon removed (owner 2026-09-28): never loads s.axon.ai, so sendAxon and
 // mirrorAxonCookie (both gated on axonEnabled) never run. Everything else is 607f6ee3.
 function startAxon(){return;if(axonEnabled||!allowed())return;axonEnabled=true;
  if(!window.axon){const a=window.axon=function(){a.performOperation?a.performOperation.apply(a,arguments):a.operationQueue.push(arguments);};a.operationQueue=[];a.ts=Date.now();a.eventKey='a2585625-5b59-4146-9e59-4a03ea432611';a('init');}
  if(!axonScript){axonScript=document.createElement('script');axonScript.async=true;axonScript.src='https://s.axon.ai/pixel.js';
   axonScript.onload=()=>{mirrorAxonCookie();for(const delay of [100,500,2000,6000])setTimeout(()=>mirrorAxonCookie(delay===6000),delay);};
   axonScript.onerror=()=>{axonEnabled=false;axonScript?.remove();axonScript=null;cookieFailure('sdk_load_failed');};document.head.append(axonScript);}
 }
 function sendAxon(m){if(!allowed()||m.name==='free_cap')return;startAxon();if(!axonEnabled)return;
  const {receipt_at,...data}=m.data;
  // Account matching uses the same permitted advertising purpose, with a
  // verified signedIn session. Anonymous visits never get this ID.
  if(signedIn&&hash(axonUserId)&&((explicit()&&window.__nyMeasurement?.snapshot().advertisingScope===4)||(automaticCandidate()&&automaticRegion)))data.user_data={...data.user_data,user_id:axonUserId};
  try{window.axon('track',m.name,data,m.id?{dedupe_id:m.id}:{});}catch{console.warn('[NariYume AppLovin] event enqueue failed: '+m.name);}
 }
 function flushLogin(){if(!pendingLogin||!sessionResolved)return;const event=pendingLogin;pendingLogin=null;post('login',{method:event.method},event.id);}
 function startX(){if(xEnabled||!allowed()||frameMode!=='all')return;xEnabled=true;
  if(!window.twq){const q=window.twq=function(){q.exe?q.exe.apply(q,arguments):q.queue.push(arguments);};q.version='1.1';q.queue=[];}
  if(!xScript){xScript=document.createElement('script');xScript.async=true;xScript.src='https://static.ads-twitter.com/uwt.js';
   xScript.onerror=()=>{xEnabled=false;xScript?.remove();xScript=null;};document.head.append(xScript);}
  window.twq('config',X_PIXEL);
 }
 function sendX(m){if(!allowed()||frameMode!=='all')return;startX();if(!xEnabled||!window.twq)return;
  const event=X_EVENTS[m.name];if(!event)return;
  const id=hash(m.id)?m.id:null,key=id?m.name+':'+id:null;
  let delivered={};try{delivered=JSON.parse(localStorage.getItem(X_DELIVERY)||'{}');}catch{}
  if(!delivered||typeof delivered!=='object'||Array.isArray(delivered))delivered={};
  delivered=Object.fromEntries(Object.entries(delivered).filter(([k,v])=>/^(sign_up|purchase):[a-f0-9]{64}$/.test(k)&&Number.isSafeInteger(v)&&v>Date.now()-7*86400000&&v<=Date.now()).slice(-128));
  if(key&&delivered[key])return;
  const data=m.name==='purchase'?{value:m.data.value,currency:m.data.currency,conversion_id:id}:
   m.name==='sign_up'?{conversion_id:id}:
   {};
  // X documents twclid as an event parameter for redirects where the original
  // landing URL/cookie is gone. Use only the bounded first-party click handoff.
  const twclid=window.__nyMeasurement?.adClickParams?.()?.twclid;
  if(m.name==='begin_checkout'&&id)data.conversion_id=id;
  if(typeof twclid==='string'&&/^[A-Za-z0-9_.~-]{1,500}$/.test(twclid))data.twclid=twclid;
  try{window.twq('event',event,data);if(key){delivered[key]=Date.now();try{localStorage.setItem(X_DELIVERY,JSON.stringify(delivered));}catch{}}}catch{}
 }
 function post(name,data={},id){if(!mayStart())return;const m={channel:MARK,name,data,...(id?{id}:{}),...(signedIn&&advertisingMatch&&['sign_up','purchase'].includes(name)?{matching:advertisingMatch}:{})};if(ready){if(allowed()){frame?.contentWindow?.postMessage(m,ORIGIN);sendAxon(m);sendX(m);}}else if(pending.length<20)pending.push(m);}
 function start(){const state=window.__nyMeasurement?.snapshot(),mode=explicit()||automaticCandidate()&&state?.marketing===true&&state.advertisingBasis==='automatic'?'all':'applovin';if(frame&&frameMode!==mode)stop();if(frame||!mayStart())return;frameMode=mode;const u=new URL('/pixel-frame',ORIGIN),saved=window.__nyMeasurement?.adClickParams?.()||{};
  // Only explicit bounded ad click IDs, never the parent URL, UID or auth token.
  for(const k of ['aleid','alart','twclid','fbclid','ttclid'])if(/^[A-Za-z0-9_.~-]{1,500}$/.test(saved[k]||''))u.searchParams.set(k,saved[k]);
  frame=document.createElement('iframe');frame.hidden=true;frame.title='Optional advertising measurement';frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox','allow-scripts allow-same-origin');frame.src=u.href;document.body.append(frame);post('page_view');
 }
 function clearCookies(){for(const k of ['_axwrt','_axwrt_ts','axwrt','ax_visitor','_fbp','_fbc','_twsid','_twpid','_ttp','_tt_enable_cookie','ttcsid','ttcsid_DAK6ICJC77U9SE5QODB0'])for(const domain of ['', '; Domain=.nariyume.com'])document.cookie=k+'=; Max-Age=0; Path=/'+domain+'; SameSite=Lax; Secure';try{localStorage.removeItem(X_DELIVERY);}catch{}}
 function stop(){generation++;checking=false;ready=false;pending=[];advertisingMatch=null;viewedPlan=null;checkoutIntent=0;begunIntent=-1;xEnabled=false;axonEnabled=false;
  if(axonScript){axonScript.remove();axonScript=null;}if(window.axon?.operationQueue)window.axon.operationQueue.length=0;
  if(xScript){xScript.remove();xScript=null;}if(window.twq?.queue)window.twq.queue.length=0;
  if(frame){frame.contentWindow?.postMessage({channel:MARK,name:'stop'},ORIGIN);const old=frame;frame=null;setTimeout(()=>{old.remove();clearCookies();},50);}clearCookies();}
 window.addEventListener('message',e=>{if(e.origin!==ORIGIN||e.source!==frame?.contentWindow||e.data?.channel!==MARK||!mayStart())return;if(e.data.ready===true){automaticRegion=e.data.automaticEligible===true;ready=true;if(!allowed()){pending=[];return;}frame.contentWindow.postMessage({channel:MARK,name:'start',data:{mode:frameMode,externalAxon:true}},ORIGIN);startX();for(const m of pending){frame.contentWindow.postMessage(m,ORIGIN);sendAxon(m);sendX(m);}pending=[];if(lastSession)void purchase(...lastSession);}});
 let lastSession=null;
 let checkingCap=false;
 async function refreshCap(){
  if(checkingCap||!allowed()||!signedIn||typeof lastSession?.[0]!=='string'||typeof lastSession?.[1]!=='function')return;
  checkingCap=true;const g=generation,[auth,fetcher]=lastSession;
  try{const r=await fetcher('/api/session',{headers:{authorization:auth,'x-nariyume-timezone':String(new Date().getTimezoneOffset())},cache:'no-store',signal:AbortSignal.timeout(10000)});
   if(!r.ok)return;const s=await r.json();if(g!==generation||!allowed())return;
   window.__nyAdPixels.session(s,auth,fetcher);
  }catch{console.warn('[NariYume ads] free-cap verification unavailable');}finally{checkingCap=false;}
 }
 // Intent is not money. Exact amounts come only from verified paid receipts.
 const product=plan=>{if(!['weekly','monthly','annual'].includes(plan))return null;return {items:[{item_id:plan,item_name:'NariYume Premium',quantity:1}]};};
 async function purchase(auth,fetcher){if(!allowed()||checking||purchases.size||(!checkoutReturn&&!checkoutStarted))return;checking=true;const g=generation;
  try{const r=await fetcher('/api/stripe/conversion',{method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});if(!r.ok)return;const body=await r.json(),p=body.purchase;
   if(g!==generation||!allowed()||body.excluded||!p||p.firstAcquisition!==true||!hash(p.eventId)||p.transaction_id!==p.eventId)return;
   if(purchases.has(p.eventId)||!(window.__nyMeasurement?.snapshot().advertisingScope===4||(automaticCandidate()&&automaticRegion))||!hash(p.user_data?.email))return;
   post('purchase',{currency:p.currency,value:p.value,tax:p.tax,shipping:p.shipping,transaction_id:p.transaction_id,items:p.items,user_data:{email:p.user_data.email},...(Number.isSafeInteger(p.at)?{receipt_at:p.at}:{})},p.eventId);
   // Keep retries possible on a later visit; provider dedupe_id is stable.
   purchases.add(p.eventId);
  }catch{}finally{if(g===generation)checking=false;}}
 window.__nyAdPixels={start,stop,diagnostics:()=>({axonCookie:cookieState}),reset(){axonUserId=null;pendingLogin=null;sessionResolved=false;signedIn=false;checkoutStarted=false;lastSession=null;purchases.clear();checking=false;excluded=qaExcluded();stop();},exclude(){axonUserId=null;pendingLogin=null;sessionResolved=false;excluded=true;signedIn=false;checkoutStarted=false;lastSession=null;checking=false;stop();},event(name,props={}){if(!inApp||!mayStart())return;start();
  // The shipping paywall exposes a monthly selection on mount. The existing
  // plan_selected producer is checkout intent, not a mere plan-card click.
  if(name==='commerce.paywall_exposed'){const plan=props.plan||'monthly',p=product(plan);if(p){viewedPlan=plan;post('view_item',p);}void refreshCap();}
  if(name==='commerce.plan_selected'){const p=product(props.plan);if(p){if(viewedPlan!==props.plan){post('view_item',p);viewedPlan=props.plan;}checkoutIntent++;post('add_to_cart',p);}}
  if(name==='auth.client_resolved'&&props.outcome==='success'&&['google','apple','x','email'].includes(props.provider)){pendingLogin={method:props.provider,id:(crypto.randomUUID()+crypto.randomUUID()).replaceAll('-','')};flushLogin();}},
  session(s,auth,fetcher){if(s?.entitlement?.sources?.includes('testing')||s?.measurement?.excluded){this.exclude();return;}if(!inApp)return;
   signedIn=Boolean(s?.account?.uid);lastSession=[auth,fetcher];
   axonUserId=hash(s?.measurement?.axonUserId)?s.measurement.axonUserId:null;sessionResolved=true;
   if(!mayStart()){axonUserId=null;pendingLogin=null;stop();return;}start();
   const match=s?.measurement?.advertisingMatch;
   advertisingMatch=signedIn&&match&&hash(match.external_id)&&(!match.email||hash(match.email))&&Object.keys(match).every(k=>['email','external_id'].includes(k))?{external_id:match.external_id,...(match.email?{email:match.email}:{})}:null;
   flushLogin();const id=s?.measurement?.registrationReceipt;if(signedIn&&hash(id))post('sign_up',{method:'unknown'},id);
   const cap=s?.measurement?.capReceipt;if(signedIn&&!s?.entitlement?.active&&hash(cap?.id)&&Number.isSafeInteger(cap.resetAt)&&cap.resetAt>Date.now()&&cap.resetAt<=Date.now()+86400000)post('free_cap',{},cap.id);
   void purchase(auth,fetcher);},
  checkout(plan,id){if(!inApp||!hash(id))return;const p=product(plan);if(!p)return;checkoutStarted=true;if(!mayStart())return;if(begunIntent!==id){begunIntent=id;post('begin_checkout',p,id);}}};
})();
