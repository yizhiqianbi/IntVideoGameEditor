import test from 'node:test';
import assert from 'node:assert/strict';
import module from './dzmm-reply-suggestions-cache';
const { readDzmmSuggestionCache: read, writeDzmmSuggestionCache: write, dzmmSuggestionCacheStorageKey: name } = module as typeof import('./dzmm-reply-suggestions-cache');
const values = new Map<string,string>();
const storage = { getItem: (key:string) => values.get(key) ?? null, setItem: (key:string,value:string) => { values.set(key,value); } };
const options = [{direction:'交流了解',title:'先问来源',reply:'你是从哪里找到这份原图的？'}, {direction:'行动探索',title:'一起核对',reply:'我先把清单拿过来，一起核对。'}, {direction:'调整节奏',title:'休息片刻',reply:'先休息一下，等准备好再检查。'}];
test('account, prefix/settings identity and prompt revision isolate cached suggestions',()=>{
 write('owner-a',{key:'message:prefix:settings:v1',updatedAt:1,status:'ready',options},storage);
 assert.equal(read('owner-a','message:prefix:settings:v1',storage)?.options?.length,3);
 assert.equal(read('owner-b','message:prefix:settings:v1',storage),null);
 assert.equal(read('owner-a','message:edited:settings:v1',storage),null);
 assert.equal(read('owner-a','message:prefix:settings:v2',storage),null);
});
test('pending and failure cache prevent automatic retries and explicit retry replaces same job',()=>{
 write('pending-owner',{key:'x',updatedAt:1,status:'pending'},storage);
 assert.equal(read('pending-owner','x',storage)?.status,'pending');
 write('pending-owner',{key:'x',updatedAt:2,status:'error',error:'供应商暂不可用'},storage);
 assert.equal(read('pending-owner','x',storage)?.status,'error');
 write('pending-owner',{key:'x',updatedAt:3,status:'ready',options},storage);
 assert.equal(read('pending-owner','x',storage)?.status,'ready');
 assert.equal(JSON.parse(values.get(name('pending-owner'))!).length,1);
});
test('bounded persistence evicts oldest only and contains no history',()=>{
 for(let index=0;index<85;index++) write('bounded',{key:`job${index}`,updatedAt:index,status:'ready',options},storage);
 assert.equal(read('bounded','job0',storage),null);assert.equal(read('bounded','job84',storage)?.status,'ready');
 const rows=JSON.parse(values.get(name('bounded'))!);assert.equal(rows.length,80);assert.equal('messages' in rows[0],false);
});
test('corrupt and incomplete stored options are ignored, ordinary pending retained',()=>{
 values.set(name('corrupt'),JSON.stringify([{key:'bad',updatedAt:1,status:'ready',options:options.slice(0,2)},{key:'ok',updatedAt:2,status:'pending'}]));
 assert.equal(read('corrupt','bad',storage),null);assert.equal(read('corrupt','ok',storage)?.status,'pending');
});
test('full storage still retains once-attempted status in current document',()=>{
 const blocked={getItem:()=>null,setItem:()=>{throw new Error('Quota');}};
 write('quota-owner',{key:'x',updatedAt:1,status:'pending'},blocked);
 assert.equal(read('quota-owner','x',blocked)?.status,'pending');
});

test('malformed error entries never leak unvalidated options into rendering',()=>{
 values.set(name('malformed-error'),JSON.stringify([{key:'bad',updatedAt:1,status:'error',error:'retry',options:'not-array'}]));
 assert.deepEqual(read('malformed-error','bad',storage),{key:'bad',updatedAt:1,status:'error',error:'retry'});
});
