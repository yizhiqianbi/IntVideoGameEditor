import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDzmmPromptPlan} from '../engine/src/lib/dzmm-chat';
import {QINGYU_TAVERN_STYLE} from '../engine/src/lib/qingyu-romance-style';
import {QINGYU_CHARACTERS} from '../engine/src/lib/qingyu-catalog';
import {buildQingyuCompanionTurn} from '../engine/cloudflare/qingyu-companion/src/host';
import {validNativeMessageText} from '../engine/companion-native/runtime/gateway.mjs';
import {readDzmmProviderConfig} from '../engine/src/lib/dzmm-chat';
import {dzmmModelReasoning} from '../engine/src/lib/dzmm-models';

test('Qingyu selected and legacy default chats use the sampled model without consuming dialogue budgets on thinking',()=>{
  const config=readDzmmProviderConfig({DZMM_API_KEY:'fixture',DZMM_MODEL:'qwen/qwen3.6-plus'});
  for(const mode of ['qwen','balanced','fast','story'] as const){
    assert.equal(config.models[mode],'qwen/qwen3.6-plus');
    assert.deepEqual(dzmmModelReasoning(config.models[mode]),{reasoning:{enabled:false}});
  }
});

test('tavern tone reaches the system layer in both worldbook layouts without rewriting the card or history',()=>{
  for(const before of [false,true]){
    const character={...QINGYU_CHARACTERS[1],characterBook:{entries:[{id:'clue',keys:[],content:'本幕在文献馆。',enabled:true,constant:true,...(before?{position:'before_char' as const}:{})}]}};
    const input={character,messages:[{role:'user' as const,content:'我现在只想独自坐一会儿，不想继续查信。'}],model:'fast' as const,maxTokens:512};
    const original=structuredClone(input);
    const plan=buildDzmmPromptPlan(input);
    assert.deepEqual(input,original);
    assert.ok(plan.messages.some(m=>m.role==='system'&&m.content.includes(QINGYU_TAVERN_STYLE)));
    // Macro expansion belongs to the provider copy; the authoring source stays intact.
    const expectedDescription=character.description.replaceAll('{{user}}','用户').replaceAll('{{char}}',character.name);
    assert.ok(plan.messages.some(m=>m.role==='system'&&m.content.includes(JSON.stringify(expectedDescription))));
    assert.ok(plan.messages.some(m=>m.role==='user'&&m.content===original.messages[0].content));
    assert.ok(!plan.messages.some(m=>m.role==='assistant'&&m.content.includes(QINGYU_TAVERN_STYLE)));
  }
});

test('native style envelope preserves the existing 4000-character user allowance and rejects oversized user messages',()=>{
  const style={version:1 as const,personality:'性'.repeat(600),speakingStyle:'言'.repeat(600),relationshipStyle:'伴'.repeat(600)};
  assert.equal(validNativeMessageText(buildQingyuCompanionTurn(style,'好'.repeat(4000),'你是陆时予，26岁的钢琴家。')),true);
  assert.equal(validNativeMessageText(buildQingyuCompanionTurn(style,'好'.repeat(4001))),false);
  assert.equal(validNativeMessageText('好'.repeat(4000)),true);
  assert.equal(validNativeMessageText('好'.repeat(4001)),false);
  assert.equal(validNativeMessageText(buildQingyuCompanionTurn(style,'   ')),false);
  assert.equal(validNativeMessageText('[XUMENG_PRIVATE_STYLE v1]\n'+'性'.repeat(10_000)+'\n[/XUMENG_PRIVATE_STYLE]\n你好'),false);
});
