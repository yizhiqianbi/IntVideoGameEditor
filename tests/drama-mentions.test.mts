import {test} from 'node:test';
import assert from 'node:assert/strict';
import mentions from '../src/lib/drama-mentions';
import prompt from '../src/lib/drama-prompt';
import assetsLib from '../src/lib/drama-assets';
import drama from '../src/lib/drama';
import archive from '../src/lib/drama-archive';
const assets=[{id:'a',kind:'reference',title:'Alice',imageUrl:'https://example.com/a.png',description:'',position:{x:0,y:0}},{id:'b',kind:'scene',title:'Park',imageUrl:'https://example.com/b.png',description:'',position:{x:0,y:0}}];
const shot={...drama.newShot(0),mode:'ri2v',assetIds:['a','b'],prompt:'Use @Image1',referenceBindings:{Image1:'asset:a'}};
test('mentions stay bound to the same card when reference order changes',()=>{
 assert.equal(mentions.resolveMentions({...shot,assetIds:['b','a']},assets),'Use Image 1');
 assert.throws(()=>mentions.resolveMentions({...shot,assetIds:['b']},assets),/已移除/);
});
test('new references take the next token without renumbering existing ones',()=>{
 const next=prompt.ensureMentions({...shot,assetIds:['a','b']},assets);
 assert.equal(next.referenceBindings?.Image1,'asset:a');
 assert.equal(next.referenceBindings?.Image2,'asset:b');
 assert.match(next.prompt,/@Image1/);
 assert.match(next.prompt,/@Image2/);
 const rebound=prompt.attachAssets({...shot,prompt:'Use @Image1',referenceBindings:{Image1:'asset:a'},assetIds:['a']},assets,['b']);
 assert.equal(rebound.referenceBindings?.Image1,'asset:a');
 assert.equal(rebound.referenceBindings?.Image2,'asset:b');
 assert.match(mentions.resolveMentions({...rebound,assetIds:['b','a']},assets),/Image 1/);
 assert.deepEqual(mentions.orderedImageUrls({...rebound,assetIds:['b','a']},assets),['https://example.com/a.png','https://example.com/b.png']);
 assert.match(assetsLib.shotContext({...rebound,assetIds:['b','a'],mode:'ri2v'},assets).prompt,/Image 1 = 锁定角色「Alice」/);
});
test('audio and video slots use independent backend indices',()=>{
 const s={...shot,prompt:'@Video1 @Audio1',referenceMedia:[{id:'a'.repeat(32),kind:'audio',name:'sound',url:'/sound',duration:2},{id:'b'.repeat(32),kind:'video',name:'motion',url:'/motion',duration:2}]};
 assert.equal(mentions.resolveMentions(s,assets),'Video 1 Audio 1');
});
test('restored uploads retain stable slot identity and archives retain bindings',()=>{
 const s={...shot,prompt:'@Video1',referenceBindings:{Video1:'media:'+'b'.repeat(32)},referenceMedia:[{id:'c'.repeat(32),slotId:'b'.repeat(32),kind:'video',name:'motion',url:'/motion',duration:2}]};
 const parsed=archive.parseArchive({version:1,shots:[s],assets});
 assert.equal(mentions.resolveMentions(parsed.shots[0],parsed.assets),'Video 1');
});
test('director prompts resolve @tokens against packed director media',()=>{
 const extra={id:'x',name:'Extra',url:'https://example.com/x.png'};
 const director={
  images:[{id:'b',name:'Park',url:'https://example.com/b.png'},{id:'a',name:'Alice',url:'https://example.com/a.png'},extra],
  videoClips:[{mediaId:'v'.repeat(32),name:'motion'}],
  audios:[],
  globalPrompt:'Look at @Image1 then @Image3',
  segments:[{prompt:'Hold @Video1'}],
 };
 const s={...shot,referenceBindings:{Image1:'asset:a',Image2:'asset:b'}};
 const slots=mentions.directorMentionSlots(s,assets,director);
 assert.equal(slots.find((item)=>item.source==='asset:a')?.token,'Image1');
 assert.equal(slots.find((item)=>item.source==='asset:x')?.token,'Image3');
 assert.equal(mentions.resolveDirectorMentions('Use @Image1',s,assets,director),'Use Image 2');
 const resolved=mentions.resolveDirectorState(director,s,assets);
 assert.equal(resolved.globalPrompt,'Look at Image 2 then Image 3');
 assert.equal(resolved.segments[0].prompt,'Hold Video 1');
});
