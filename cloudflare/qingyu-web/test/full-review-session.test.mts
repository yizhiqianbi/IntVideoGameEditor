import test from 'node:test';
import assert from 'node:assert/strict';
import {requireReviewSession} from '../src/server/review-session.ts';
const request=(cookie?:string)=>new Request('https://qingyu.test/api/backend/v1/forum/posts',{headers:cookie?{Cookie:cookie}:{}});
test('paid content review requires a backend-verified session, guest sessions included',async()=>{
 let calls=0;
 const session=async(r:Request)=>{calls++;assert.equal(r.headers.get('Cookie'),'qingyu_session=owned');assert.equal(r.headers.get('Authorization'),null);return Response.json({user:{id:'account',isGuest:true}});};
 await assert.rejects(()=>requireReviewSession(request(),session),{status:401});assert.equal(calls,0);
 await requireReviewSession(request('other=ignored; qingyu_session=owned'),session);
 await requireReviewSession(request('qingyu_session=owned'),async()=>Response.json({user:{id:'account',isGuest:false}}));
 for(const response of [new Response(null,{status:401}),new Response(null,{status:500}),Response.json({})]){
  await assert.rejects(()=>requireReviewSession(request('qingyu_session=owned'),async()=>response));
 }
});
