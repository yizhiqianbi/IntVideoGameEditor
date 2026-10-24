import test from 'node:test';
import assert from 'node:assert/strict';
import {compileDzmmPrivateWorldBook,omitBlankDzmmBookDraftEntries} from '../engine/src/lib/dzmm-character-draft';
import {parseCharacterImport,parseCharacterDraftImport,exportCharacterDraftJson,exportCharacterJson} from '../engine/src/lib/dzmm-characters';
import {buildDzmmPromptPlan} from '../engine/src/lib/dzmm-chat';

const entries=[
 {id:'rule',name:'调查边界',keysText:'',secondaryText:'',content:'未核实的线索保持疑问。',constant:true,position:'before_char'},
 {id:'clue',name:'蓝色邮戳',keysText:'蓝色邮戳',secondaryText:'',content:'档案馆保存着邮务登记册。',position:'after_char'},
];
test('private save and editable export preserve worldbook placement and real prompt ordering',()=>{
 const saved=compileDzmmPrivateWorldBook({version:1,characterBook:{entries}});
 const card=parseCharacterImport({name:'林砚',description:'地图修复师',characterBook:saved.characterBook});
 const restored=parseCharacterImport(exportCharacterJson(card),card.id);
 assert.deepEqual(restored.characterBook?.entries.map(e=>e.position),['before_char','after_char']);
 const plan=buildDzmmPromptPlan({character:restored,model:'fast',maxTokens:512,messages:[{role:'user',content:'我们先核对蓝色邮戳。'}]});
 const sources=plan.diagnostics.segments.map(s=>s.source);
 assert.ok(sources.indexOf('platform-rules')<sources.indexOf('worldbook-before-character'));
 assert.ok(sources.indexOf('worldbook-before-character')<sources.indexOf('character'));
 assert.ok(sources.indexOf('character')<sources.indexOf('worldbook'));
});
test('an unfinished positioned entry survives private draft export and reimport',()=>{
 const saved=compileDzmmPrivateWorldBook({version:1,characterBook:{entries:[...entries,{id:'unfinished',keysText:'',secondaryText:'',content:'',position:'before_char'}]}});
 assert.equal(saved.authoringDraft?.characterBook.entries.at(-1)?.position,'before_char');
 const card={...parseCharacterImport({name:'林砚',description:'地图修复师',characterBook:saved.characterBook}),authoringDraft:saved.authoringDraft};
 const restored=parseCharacterDraftImport(exportCharacterDraftJson(card),card.id);
 assert.equal(restored.authoringDraft?.characterBook.entries.at(-1)?.position,'before_char');
 assert.deepEqual(restored.characterBook?.entries.map(e=>e.position),['before_char','after_char']);
});
test('position-only editing remains a private draft instead of being silently discarded',()=>{
 const row={entry:{keys:[],content:'',position:'before_char' as const},keysText:'',secondaryText:''};
 assert.deepEqual(omitBlankDzmmBookDraftEntries([row]),[row]);
});
test('invalid private placement cannot reach the public card or prompt',()=>{
 for(const position of ['platform-rules','system',1,null])assert.throws(()=>compileDzmmPrivateWorldBook({version:1,characterBook:{entries:[{...entries[0],position}]}}),/世界书位置/);
});
