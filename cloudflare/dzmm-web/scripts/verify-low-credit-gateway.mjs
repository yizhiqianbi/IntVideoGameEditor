import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
// Own synthetic registered zero-balance account. No funds, models, sign-ins to
// an existing account, payment orders or original private history are touched.
const origin='https://xumengchat.top';
const path=new URL('../../../output/xumeng/iteration/rounds/round16-20261007-production-quote.json',import.meta.url);
const report={startedAt:new Date().toISOString(),accounts:[],checks:[],models:0,payments:0,creditGrants:0,publicPosts:0,cleanupPending:true};
let cookie='';
async function persist(){await writeFile(path,JSON.stringify(report,null,2)+'\n');}
async function call(path,method='GET',body){const response=await fetch(origin+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});const session=response.headers.getSetCookie().find(x=>x.startsWith('dzmm_session='));if(session)cookie=session.split(';')[0];return{status:response.status,value:await response.json()};}
try{
 const registered=await call('/api/backend/v1/auth/register','POST',{email:'qa-r16-'+randomUUID()+'@example.invalid',password:randomBytes(24).toString('hex'),nickname:'原创预算接口验收'});
 assert.ok([200,201].includes(registered.status));assert.equal(registered.value.user.isGuest,false);report.accounts.push(registered.value.user.id);await persist();
 const before=await call('/api/backend/v1/billing/usage');assert.equal(before.status,200);assert.equal(before.value.availableBalance,0);assert.equal(before.value.items.length,0);report.checks.push({name:'fresh-own-registered-account-has-zero-credit-and-no-usage',passed:true});
 const requests=[['/api/chat',{character:{name:'原创图书管理员'},messages:[{role:'user',content:'请核对地图。'}],world:{clockMode:'story'}}],
 ['/api/novel-generation',{operation:'outline',work:{title:'原创地图',synopsis:'核对旧地图。',type:'story',tags:[],notes:'',outline:''},model:'balanced'}],
 ['/api/memory',{messages:[{role:'user',content:'找到旧地图。'}]}]];
 for(const [endpoint,body] of requests){const result=await call(endpoint,'POST',body);assert.equal(result.status,402);assert.equal(result.value.code,'CREDIT_INSUFFICIENT');assert.match(result.value.error,/当前可用 0 Credit/);assert.match(result.value.error,/至少需要 \d+ Credit/);report.checks.push({name:'authenticated-readonly-affordability-quote-'+endpoint,status:result.status,message:result.value.error,passed:true});}
 const after=await call('/api/backend/v1/billing/usage');assert.equal(after.value.availableBalance,0);assert.equal(after.value.items.length,0);assert.equal(after.value.reservedCredits,0);assert.equal(after.value.totalSpent,0);report.checks.push({name:'rejected-quotes-create-no-reservation-or-debit',passed:true});report.complete=true;
}catch(error){report.error=error.message;throw error;}finally{if(cookie)await call('/api/backend/v1/auth/logout','POST').catch(()=>{});report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({complete:report.complete,checks:report.checks.length,accountsToDelete:report.accounts}));}
