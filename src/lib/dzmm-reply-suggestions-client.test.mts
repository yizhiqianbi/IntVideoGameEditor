import test from 'node:test';
import assert from 'node:assert/strict';
import module from './dzmm-reply-suggestions-client';
import storage from './dzmm-storage';
import character from './dzmm-characters';
const {dzmmReplySuggestionPrefixKeys,dzmmReplySuggestionSettingsKey,insertDzmmReplySuggestion,prepareDzmmReplySuggestionsRequest,fetchDzmmReplySuggestions} = module as typeof import('./dzmm-reply-suggestions-client');
const { DZMM_INITIAL_STATE } = storage as typeof import('./dzmm-storage');
const {parseCharacterImport} = character as typeof import('./dzmm-characters');
const card=parseCharacterImport({name:'原创钟馆',description:'乔岚，30岁，检查钟摆刻度。',firstMessage:'看看这份原图。'},'local-reply-test');
const conversation={id:'own-test',characterId:card.id,title:card.name,updatedAt:1,messages:[{id:'a',role:'assistant' as const,content:'看看这份原图。'},{id:'u',role:'user' as const,content:'先查刻度。'},{id:'b',role:'assistant' as const,content:'有一处不合刻度，请看左侧。'},{id:'u2',role:'user' as const,content:'后来到了广场。'},{id:'c',role:'assistant' as const,content:'未来场景秘密：正在广场。'}]};
test('selected reply request contains exactly its real prefix and request-only helper, never future scene',()=>{
 const before=structuredClone(conversation);const request=prepareDzmmReplySuggestionsRequest(card,conversation,'b',DZMM_INITIAL_STATE.preferences);
 assert.deepEqual(conversation,before);assert.equal(request.model,DZMM_INITIAL_STATE.preferences.model);assert.equal(request.maxTokens,512);
 assert.equal(request.messages.at(-2)?.content,conversation.messages[2].content);assert.equal(request.messages.at(-1)?.role,'user');assert.equal(JSON.stringify(request).includes('未来场景秘密'),false);
});
test('assistant opening without a user turn supports suggestions',()=>{const request=prepareDzmmReplySuggestionsRequest(card,conversation,'a',DZMM_INITIAL_STATE.preferences);assert.equal(request.messages.length,2);assert.equal(request.messages[0].content,card.firstMessage);});
test('earlier edit invalidates following suggestion keys but adding a turn preserves prior keys',()=>{
 const keys=dzmmReplySuggestionPrefixKeys(conversation.messages);const edited=structuredClone(conversation.messages);edited[1].content='改为先查轴径。';const next=dzmmReplySuggestionPrefixKeys(edited);assert.equal(keys[0],next[0]);assert.notEqual(keys[1],next[1]);assert.notEqual(keys[2],next[2]);
 assert.deepEqual(dzmmReplySuggestionPrefixKeys([...conversation.messages,{id:'new',role:'user',content:'新的选择'}]).slice(0,keys.length),keys);
});
test('combined legal settings over the per-message limit render safely and changes at the end invalidate suggestions',()=>{
 const settings: unknown[]=[{description:'设'.repeat(6000),personality:'性'.repeat(6000)}, {snapshots:Array.from({length:5},(_,index)=>({fact:'钟'.repeat(5000),index}))}];
 const key=dzmmReplySuggestionSettingsKey(settings);assert.equal(dzmmReplySuggestionSettingsKey(structuredClone(settings)),key);
 const changed=structuredClone(settings);changed.push({ending:'尾部新事实'});assert.notEqual(dzmmReplySuggestionSettingsKey(changed),key);
 assert.doesNotThrow(()=>dzmmReplySuggestionSettingsKey([' '.repeat(24000)]));
});
test('insertion preserves exact draft, alternate choice replaces only prior untouched suggestion, manual edits survive',()=>{
 const before='我自己写的开头  \n';const first=insertDzmmReplySuggestion(before,'先量轴径。');assert.equal(first.before,before);assert.equal(first.after,before+'\n先量轴径。');
 const second=insertDzmmReplySuggestion(first.after,'先问图纸来源。',first);assert.equal(second.after,before+'\n先问图纸来源。');
 const edited=second.after+'手动修改';assert.equal(insertDzmmReplySuggestion(edited,'稍作休息。',second).before,edited);assert.throws(()=>insertDzmmReplySuggestion('字'.repeat(12000),'建议'),/字数上限/);
});
test('dedicated fetch has separate request id, same-origin credentials and rejects fewer than three options',async()=>{
 const original=globalThis.fetch;let headers:Headers|undefined;
 try {globalThis.fetch=async(url,init)=>{assert.equal(url,'/api/reply-suggestions');assert.equal(init?.credentials,'same-origin');headers=new Headers(init?.headers);return Response.json({options:[{direction:'交流了解',title:'询问来源',reply:'这份原图从哪里找到的？'}]});};
 await assert.rejects(()=>fetchDzmmReplySuggestions(prepareDzmmReplySuggestionsRequest(card,conversation,'b',DZMM_INITIAL_STATE.preferences),new AbortController().signal));assert.match(headers!.get('X-Xumeng-Request-Id')!,/^[a-f0-9-]{36}$/);
 }finally{globalThis.fetch=original;}
});


test('reply suggestions follow the selected role model rather than a separate fixed fast route',()=>{
 for(const model of ['grok','gemini','claude','gpt','deepseek','qwen','story'] as const){
  assert.equal(prepareDzmmReplySuggestionsRequest(card,conversation,'b',{...DZMM_INITIAL_STATE.preferences,model}).model,model);
 }
});
