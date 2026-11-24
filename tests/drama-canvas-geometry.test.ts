import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {newShot} from '../src/lib/drama';
import {alignCards,canvasCoordinate} from '../src/lib/drama-canvas-geometry';
test('alignment uses actual card dimensions rather than equal-size assumptions',()=>{
 const a={...newShot(0),id:'a',position:{x:10,y:20}};
 const b={...newShot(1),id:'b',position:{x:400,y:300}};
 const dimensions=new Map([['a',{width:300,height:250}],['b',{width:200,height:400}]]);
 assert.deepEqual(alignCards([a,b],'right',dimensions).map(c=>c.position.x),[300,400]);
 assert.deepEqual(alignCards([a,b],'bottom',dimensions).map(c=>c.position.y),[450,300]);
 assert.deepEqual(alignCards([{...a,positionLocked:true},b],'left'),[]);
});
test('distribution leaves equal gaps between measured card edges',()=>{
 const cards=[0,300,900].map((x,i)=>({...newShot(i),id:String(i),position:{x,y:20}}));
 const dimensions=new Map([['0',{width:100,height:100}],['1',{width:200,height:100}],['2',{width:300,height:100}]]);
 assert.deepEqual(alignCards(cards,'horizontal',dimensions).map(c=>c.position.x),[0,400,900]);
 assert.deepEqual(alignCards(cards.slice(0,2),'horizontal',dimensions),[]);
 assert.equal(canvasCoordinate(Infinity),null);
 assert.equal(canvasCoordinate(100001),100000);
});
