import {test} from 'node:test';
import assert from 'node:assert/strict';
import assets from '../src/lib/drama-assets';
import drama from '../src/lib/drama';
import direction from '../src/lib/drama-direction';
test('generation carries single-shot direction for 3–15 seconds',()=>{
 const shot=drama.newShot(0,'Opening','A person waits');
 assert.ok(assets.shotContext(shot,[]).prompt.includes(direction.SINGLE_SHOT_DIRECTION));
 assert.match(assets.shotContext({...shot,duration:8},[]).prompt, /规格：8秒/);
 assert.ok(assets.shotContext({...shot,duration:30},[]).prompt.includes(direction.SINGLE_SHOT_DIRECTION));
 assert.equal(assets.shotContext(shot,[], 'explicit').prompt, assets.shotContext(shot,[]).prompt);
});
test('director brief retains structured filmmaking without adult presets',()=>{
 assert.match(direction.DRAMA_DIRECTION, /影视短剧编剧/);
 assert.doesNotMatch(direction.DRAMA_DIRECTION, /情欲|裸露|呻吟|成人向|成人悬疑|性器官/);
 assert.match(direction.DRAMA_DIRECTION, /主要动作/);
 assert.match(direction.DRAMA_DIRECTION, /重量/);
 assert.match(direction.DRAMA_DIRECTION, /"camera"/);
 assert.match(direction.DRAMA_DIRECTION, /价值必须转折/);
 assert.match(direction.DRAMA_DIRECTION, /对白是行动/);
 assert.match(direction.DRAMA_DIRECTION, /可观察指令/);
 assert.match(direction.DRAMA_DIRECTION, /无多余手指/);
});
