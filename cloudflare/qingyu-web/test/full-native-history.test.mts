import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeNativeHistory} from '../engine/companion-native/runtime/gateway.mjs';
const stamp=(offset=0)=>new Date(1_790_000_000_000+offset).toISOString();
const live=(id:string,offset=0)=>({id,nativeId:null,role:'assistant',text:'',nativeContent:'[语音]',createdAt:stamp(offset+10),media:[{kind:'voice',url:`data:audio/mpeg;base64,${id}`,qingyuSpeechReview:{signature:id}}]});
const history=(id:string,offset=0)=>({id,nativeId:id,role:'assistant',text:'[语音]',createdAt:stamp(offset)});
test('native history placeholder preserves the actual voice and proof once after restore',()=>{
 const voice=live('clip');const stored=history('native');
 const merged=mergeNativeHistory([voice],[stored]);
 assert.equal(merged.length,1);assert.equal(merged[0].id,'native');assert.equal(merged[0].text,'');assert.deepEqual(merged[0].media,voice.media);
 assert.deepEqual(mergeNativeHistory(merged,[stored]),merged);
});
test('an earlier duplicated placeholder and rich event converge without dropping reviewed audio',()=>{
 const voice=live('clip'),stored=history('native');
 const merged=mergeNativeHistory([stored,voice],[stored]);
 assert.equal(merged.length,1);assert.deepEqual(merged[0].media,voice.media);assert.equal(merged[0].text,'');
});
test('two real voice deliveries keep separate media and unrelated later placeholders are retained',()=>{
 const first=live('first'),second=live('second',20_000);
 const merged=mergeNativeHistory([first,second],[history('one'),history('two',20_000),history('later',50_000)]);
 assert.equal(merged.length,3);assert.deepEqual(merged[0].media,first.media);assert.deepEqual(merged[1].media,second.media);assert.equal(merged[2].text,'[语音]');
});
