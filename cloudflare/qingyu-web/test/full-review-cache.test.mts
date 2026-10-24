import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewContent} from '../src/server/policy';
const env={MODERATION_BASE_URL:'https://review-cache.test/v1',MODERATION_API_KEY:'cache-fixture',MODERATION_MODEL:'fixture'};
test('unchanged transcript polling and concurrent requests share an exact successful review',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;await new Promise(done=>setTimeout(done,5));return Response.json({results:[{flagged:false}]});};
 try{await Promise.all([reviewContent('same transcript',env),reviewContent('same transcript',env)]);await reviewContent('same transcript',env);assert.equal(calls,1);
  await reviewContent('changed transcript',env);assert.equal(calls,2);
  await reviewContent('same transcript',{...env,MODERATION_MODEL:'different-policy-model'});assert.equal(calls,3);
 }finally{globalThis.fetch=original;}
});
test('mutable remote images and unsuccessful reviews never reuse an approval',async()=>{
 const original=globalThis.fetch;let calls=0,blocked=false;
 globalThis.fetch=async()=>{calls++;return Response.json({results:[{flagged:blocked}]});};
 try{
  const image=[{type:'image_url',image_url:{url:'https://mutable-image.test/photo.png'}}];
  await reviewContent(image,env);await reviewContent(image,env);assert.equal(calls,2);
  blocked=true;for(let i=0;i<2;i++)await assert.rejects(()=>reviewContent('rejected transcript',env));assert.equal(calls,4);
 }finally{globalThis.fetch=original;}
});
