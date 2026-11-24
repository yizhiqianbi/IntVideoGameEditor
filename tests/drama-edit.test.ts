import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {newShot} from '../src/lib/drama';
import {newAsset} from '../src/lib/drama-assets';
import {removeCards,duplicateCards,copyCards,pasteCards} from '../src/lib/drama-edit';
test('deletion removes dangling associations without changing other nodes',()=>{
 const a=newAsset('reference',0), b=newAsset('scene',1);
 const s={...newShot(0),assetIds:[a.id,b.id]};
 const result=removeCards({shots:[s],assets:[a,b]},[a.id]);
 assert.deepEqual(result.shots[0].assetIds,[b.id]);assert.equal(result.assets.length,1);assert.equal(s.assetIds.length,2);
});
test('copies remap internal references and never inherit paid generation tasks',()=>{
 const a=newAsset('reference',0);
 const s={...newShot(0),assetIds:[a.id],taskId:'paid-task',status:'COMPLETED',videoUrl:'/video.mp4'};
 const result=duplicateCards({shots:[s],assets:[a]},[s.id,a.id]);
 assert.equal(result.shots.length,2);assert.deepEqual(result.shots[1].assetIds,[result.assets[1].id]);assert.equal(result.shots[1].taskId,undefined);assert.equal(result.shots[0].taskId,'paid-task');
});
test('deleting a parent promotes children onto the grandparent',()=>{
 const a={...newShot(0),id:'a'};
 const b={...newShot(1),id:'b',parentId:'a'};
 const c={...newShot(2),id:'c',parentId:'b'};
 const result=removeCards({shots:[a,b,c],assets:[]},['b']);
 assert.equal(result.shots.length,2);
 assert.equal(result.shots.find((s)=>s.id==='c')?.parentId,'a');
});
test('copied shots remap parent links inside the selection',()=>{
 const a={...newShot(0),id:'a'};
 const b={...newShot(1),id:'b',parentId:'a'};
 const result=duplicateCards({shots:[a,b],assets:[]},['a','b']);
 const copies=result.shots.slice(2);
 assert.equal(copies[0].parentId,undefined);
 assert.equal(copies[1].parentId,copies[0].id);
 assert.equal(result.shots[1].parentId,'a');
});
test('paste after cut remaps bindings, clears runtime, and preserves relative placement',()=>{
 const a={...newAsset('reference',0),position:{x:10,y:20},positionLocked:true};
 const s={...newShot(0),position:{x:360,y:80},assetIds:[a.id],referenceBindings:{Image1:`asset:${a.id}`,Image2:'asset:missing'},taskId:'live',queuePosition:2,generationStartedAt:1};
 const clip=copyCards({shots:[s],assets:[a]},[s.id,a.id]);
 const next=pasteCards({shots:[],assets:[]},clip,{x:100,y:200});
 assert.deepEqual(next.assets[0].position,{x:100,y:200});
 assert.deepEqual(next.shots[0].position,{x:450,y:260});
 assert.deepEqual(next.shots[0].referenceBindings,{Image1:`asset:${next.assets[0].id}`});
 assert.deepEqual(next.shots[0].assetIds,[next.assets[0].id]);
 assert.equal(next.assets[0].positionLocked,false);
 assert.equal(next.shots[0].queuePosition,undefined);
 assert.equal(next.shots[0].generationStartedAt,undefined);
 next.shots[0].referenceBindings!.Image1='changed';
 assert.equal(clip.shots[0].referenceBindings!.Image1,`asset:${a.id}`);
});
test('pasting a child into a different document drops an unavailable parent',()=>{
 const s={...newShot(0),parentId:'unavailable',assetIds:['unavailable']};
 const next=pasteCards({shots:[],assets:[]},copyCards({shots:[s],assets:[]},[s.id]));
 assert.equal(next.shots[0].parentId,undefined);
 assert.deepEqual(next.shots[0].assetIds,[]);
});
test('deletion cleans binding references to deleted assets',()=>{
 const a=newAsset('reference',0),b=newAsset('scene',1);
 const s={...newShot(0),referenceBindings:{Image1:`asset:${a.id}`,Image2:`asset:${b.id}`}};
 assert.deepEqual(removeCards({shots:[s],assets:[a,b]},[a.id]).shots[0].referenceBindings,{Image2:`asset:${b.id}`});
});
