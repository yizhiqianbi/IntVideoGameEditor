import test from 'node:test';
import assert from 'node:assert/strict';
import {editionBoundary} from '../src/server/edition-boundary';

test('closed commerce cannot reach providers or ledger handlers through either backend alias or callbacks',async()=>{
  const routes=['payments/checkout','payments/wallet','payments/webhook','nowpayments/checkout','subscriptions/checkout','subscriptions/checkin','dream-coin/exchange','dream-coin/withdrawals','referral','referrals','admin/users/account/credits','admin/orders','admin/subscriptions'];
  for(const prefix of ['/api/backend/v1/','/api/dzmm/backend/v1/'])for(const route of routes)for(const method of ['GET','POST','DELETE']){
    const response=await editionBoundary(new Request(`https://qingyu.test${prefix}${route}`,{method}));
    assert.equal(response?.status,404,`${method} ${prefix}${route}`);
    assert.equal((await response!.json() as {code:string}).code,'FEATURE_UNAVAILABLE');
    assert.equal(response!.headers.get('Cache-Control'),'no-store');
  }
  for(const path of ['/api/payments/stripe/webhook','/api/payments/nowpayments/ipn','/api/payments/guagua/notify','/api/payments/zpay/subscription/checkout/order']){
    assert.equal((await editionBoundary(new Request(`https://qingyu.test${path}`,{method:'POST'})))?.status,404);
  }
});
test('ordinary account, chat and authoring requests still pass with their body intact',async()=>{
  for(const path of ['/api/backend/v1/auth/register','/api/backend/v1/state','/api/dzmm/backend/v1/publishing/submissions','/api/chat','/api/qingyu/companion/messages']){
    const request=new Request(`https://qingyu.test${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname:'晴屿体验员',content:'今夜的海风很温柔。'})});
    assert.equal(await editionBoundary(request),null,path);
    assert.equal((await request.json() as {nickname:string}).nickname,'晴屿体验员');
  }
});
test('registration cannot award a referral through stale links or direct requests',async()=>{
  for(const prefix of ['/api/backend/v1/','/api/dzmm/backend/v1/'])for(const key of ['referralCode','inviteCode']){
    const request=new Request(`https://qingyu.test${prefix}auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'qa@local.invalid',[key]:'OLD-CODE'})});
    assert.equal((await editionBoundary(request))?.status,404);
    assert.equal((await request.json() as Record<string,string>)[key],'OLD-CODE');
  }
});
test('deferred phone and video services do not open sessions before their APIs are supplied',async()=>{
  for(const path of ['/api/phone/status','/api/phone/ws','/api/live','/api/live/sessions']){
    assert.equal((await editionBoundary(new Request(`https://qingyu.test${path}`,{method:'POST'})))?.status,404);
  }
});
