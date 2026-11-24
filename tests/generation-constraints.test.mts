import {test} from 'node:test';
import assert from 'node:assert/strict';
import constraints from '../src/lib/generation-constraints';
import assets from '../src/lib/drama-assets';
import archives from '../src/lib/drama-archive';
import route from '../src/app/api/image/generate/route';
const {withNegativePrompt, formatNegativePrompt}=constraints;
test('empty constraints preserve prompts and invalid inputs are rejected',()=>{
 assert.equal(withNegativePrompt('Lake','  '),'Lake');assert.throws(()=>withNegativePrompt('Lake',{}));assert.throws(()=>withNegativePrompt('Lake','a'.repeat(1601)));
});
test('negative clauses use no/无 instead of bare artifact nouns',()=>{
 assert.equal(formatNegativePrompt('boats, flicker'),'no boats、no flicker');
 assert.equal(formatNegativePrompt('手指粘连、未成年人'),'无手指粘连、无未成年人');
 assert.equal(formatNegativePrompt('无油腻皮肤、no extra fingers'),'无油腻皮肤、no extra fingers');
 assert.match(constraints.HUMAN_NEGATIVE_PROMPT, /^无/);
 assert.match(constraints.HUMAN_NEGATIVE_PROMPT, /无多余手指/);
 assert.match(constraints.HUMAN_NEGATIVE_PROMPT, /无畸形生殖器/);
 assert.match(constraints.VIDEO_NEGATIVE_PROMPT, /无口型错位/);
 assert.match(constraints.VIDEO_NEGATIVE_PROMPT, /无油腻皮肤/);
 assert.match(constraints.VIDEO_NEGATIVE_PROMPT, /无手指粘连/);
});
test('reference and shot constraints survive archives and reach video prompts',()=>{
 const doc=archives.parseArchive({version:1,assets:[{id:'a',kind:'scene',title:'Lake',description:'Morning',negativePrompt:'boats',imageUrl:'',position:{x:0,y:0}}],shots:[{id:'s',title:'Opening',prompt:'Camera pan',negativePrompt:'flicker',mode:'t2v',firstFrame:'',lastFrame:'',references:'',assetIds:['a'],position:{x:0,y:0}}]});
 const result=assets.shotContext(doc.shots[0],doc.assets);assert.match(result.prompt,/负面：no boats/);assert.match(result.prompt,/负面：no flicker/);
});
test('Grok receives constraints inside prompt, without an unsupported API parameter',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async(_url,init)=>{const body=JSON.parse(init?.body as string);assert.match(body.prompt,/负面：no text/);assert.equal(body.negative_prompt,undefined);return Response.json({data:[{b64_json:'aGVsbG8=',media_type:'image/png'}]});};
 try{const r=await route.POST(new Request('http://localhost/api/image/generate',{method:'POST',body:JSON.stringify({model:'x-ai/grok-imagine-image-2.0',apiKey:'test',prompt:'Lake',negativePrompt:'text'})}));assert.equal(r.status,200);}finally{globalThis.fetch=original;}
});

test('new cards get anatomy defaults; clearing remains empty across archives',()=>{
 const a=assets.newAsset('reference',0);
 assert.match(a.negativePrompt!,/无多余手指/);
 assert.match(a.negativePrompt!,/无未成年人/);
 assert.notEqual(assets.newAsset('scene',0).negativePrompt,a.negativePrompt);
 const d=archives.parseArchive({version:1,assets:[{...a,negativePrompt:''}],shots:[]});
 assert.equal(d.assets[0].negativePrompt,'');
 const old=archives.parseArchive({version:1,assets:[{...a,negativePrompt:undefined}],shots:[]});
 assert.equal(old.assets[0].negativePrompt,constraints.HUMAN_NEGATIVE_PROMPT);
});
