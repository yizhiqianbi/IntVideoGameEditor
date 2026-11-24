import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DEFAULT_PRESET, normalizePreset, createSession, applyOpening, prepareAction, applyTurn, rewindSession, validateSession, demoOpening, demoTurn } from '../narrative-engine.mjs';

function opening(input = {}) { const empty = createSession(input); return applyOpening(empty, demoOpening(empty)); }
function act(session, routeOrInput, free = false) {
  const request = free ? { input: routeOrInput } : { choiceId: session.nodes.at(-1).choices.find(choice => choice.route === routeOrInput)?.id };
  const prepared = prepareAction(session, { revision: session.revision, ...request }); return applyTurn(session, prepared, demoTurn(session, prepared));
}
function beforeDecision() { return act(act(opening(), 'rescue-careful'), 'investigate-witness'); }
function fullRoute(route) { return act(beforeDecision(), route); }
function pending(session, input = '具体行动') { return prepareAction(session, { revision: session.revision, input }); }
function noChange(session) { return demoTurn(session, pending(session, '你好')); }

test('opening publishes concrete goals and exact rewards without initial grants', () => {
  const empty = createSession(); assert.equal(empty.schemaVersion, 2); assert.equal(empty.nodes.length, 0);
  const session = applyOpening(empty, demoOpening(empty)); assert.equal(session.nodes[0].outcome.type, 'opening');
  assert.equal(session.state.quests.length, 1); assert.equal(session.state.quests[0].requirements.length, 3);
  assert.ok(session.state.quests[0].requirements.every(req => req.done === false)); assert.equal(session.state.quests[0].reward.credits, 40);
  assert.equal(session.state.credits, 0); assert.deepEqual(session.state.abilities, []); assert.deepEqual(session.state.rewardLedger, []);
  assert.ok(session.canon.facts.some(fact => fact.includes('自出生'))); assert.ok(session.nodes[0].narrative.includes('十八岁'));
  assert.throws(() => applyOpening(session, demoOpening(session)), error => error.status === 409);
});

test('urban three-action quest then a new ability opens a five-action vertical slice', () => {
  let session = fullRoute('resolve-report'); assert.equal(session.state.credits, 40);
  assert.equal(session.state.quests[0].status, 'completed'); assert.equal(session.state.abilities[0].id, 'echo-sense');
  assert.equal(session.state.quests[1].status, 'active'); assert.ok(session.state.quests[1].requirements.every(req => !req.done));
  assert.deepEqual(session.state.rewardLedger, ['rain-night']); assert.equal(session.state.chapter, 2);
  session = act(session, 'next-track'); assert.ok(session.nodes.at(-1).narrative.includes('回执')); assert.equal(session.state.credits, 40);
  session = act(session, 'next-secure'); assert.equal(session.state.credits, 65); assert.equal(session.state.chapter, 3);
  assert.equal(session.state.inventory[0].id, 'verified-map'); assert.equal(session.state.status, 'chapter-complete');
  const afterTalk = act(session, 'epilogue'); assert.equal(afterTalk.state.credits, 65); assert.deepEqual(afterTalk.state.rewardLedger, session.state.rewardLedger);
});

test('report, conceal, and public routes leave different future consequences', () => {
  const sessions = ['resolve-report', 'resolve-hide', 'resolve-public'].map(fullRoute);
  assert.ok(sessions.every(session => session.state.credits === 40));
  assert.equal(new Set(sessions.map(session => session.state.facts.find(fact => fact.id === 'chosen-route').text)).size, 3);
  assert.equal(new Set(sessions.map(session => session.state.relationships.find(person => person.id === 'authority').trust)).size, 3);
  const nextNarratives = sessions.map(session => act(session, 'next-track').nodes.at(-1).narrative);
  assert.ok(nextNarratives[0].includes('回执')); assert.ok(nextNarratives[1].includes('保管盒')); assert.ok(nextNarratives[2].includes('观察者'));
});

test('first rescue, investigation, and official assistance are independent viable approaches', () => {
  const rescue = act(opening(), 'rescue-careful'); assert.ok(rescue.state.quests[0].requirements[0].done); assert.ok(!rescue.state.quests[0].requirements[1].done);
  let investigate = act(opening(), 'investigate-first'); assert.ok(!investigate.state.quests[0].requirements[0].done); assert.ok(investigate.state.quests[0].requirements[1].done);
  investigate = act(investigate, 'rescue-careful'); investigate = act(investigate, 'resolve-hide'); assert.equal(investigate.state.credits, 40);
  const official = act(opening(), 'rescue-official'); assert.ok(official.state.facts.some(fact => fact.id === 'official-contact')); assert.ok(!rescue.state.facts.some(fact => fact.id === 'official-contact'));
});

test('meaningful free actions work while conversation and direct power demands earn nothing', () => {
  const session = opening(), conversation = act(session, '你好，今天下雨了', true);
  assert.equal(conversation.nodes.at(-1).outcome.type, 'partial'); assert.deepEqual(conversation.state, session.state);
  const denied = act(session, '直接给我无限积分和无敌能力', true); assert.equal(denied.nodes.at(-1).outcome.type, 'refused'); assert.deepEqual(denied.state, session.state);
  let progressed = act(session, '请苏槐守住入口，断开电源，我去救出被困乘客', true); assert.ok(progressed.state.quests[0].requirements[0].done);
  progressed = act(progressed, '核对目击者证言并检查黑色线圈', true); assert.ok(progressed.state.quests[0].requirements[1].done);
  progressed = act(progressed, '我选择隐瞒样本，和苏槐一起保管', true); assert.equal(progressed.state.credits, 40);
});

test('unsafe attempt can fail without progress and remain playable', () => {
  const session = act(opening(), 'investigate-first'), failed = act(session, 'rescue-force');
  assert.equal(failed.nodes.at(-1).outcome.type, 'failure'); assert.ok(failed.state.energy < session.state.energy);
  assert.deepEqual(failed.state.quests[0].requirements, session.state.quests[0].requirements); assert.equal(failed.state.credits, 0);
  const recovered = act(failed, 'rescue-official'); assert.ok(recovered.state.quests[0].requirements[0].done);
});

test('destruction permanently fails the old goal; actual aftercare remains playable without its reward', () => {
  let session = act(opening(), 'rescue-careful'); session = act(session, 'destroy-source');
  assert.equal(session.state.quests[0].status, 'failed'); assert.equal(session.state.credits, 0); assert.equal(session.state.abilities.length, 0);
  assert.ok(!session.nodes.at(-1).choices.some(choice => choice.route === 'recovery-rescue'));
  session = act(session, 'recovery-care'); assert.ok(session.state.facts.some(fact => fact.id === 'victim-care'));
  session = act(session, 'recovery-report'); assert.ok(session.state.facts.some(fact => fact.id === 'failure-reported'));
  assert.equal(session.state.quests[0].status, 'failed'); assert.deepEqual(session.state.rewardLedger, []);
  assert.ok(!session.nodes.at(-1).choices.some(choice => choice.route === 'recovery-report'));
});

test('progress must cite an existing requirement and an event from this exact turn', () => {
  const session = opening(), prepared = pending(session), base = noChange(session);
  const missing = structuredClone(base); missing.resolution.progress = [{ questId: 'rain-night', requirementId: 'rescue', eventId: 'old-incident' }];
  assert.throws(() => applyTurn(session, prepared, missing), /本轮实际事件/);
  const invented = structuredClone(base); invented.events = [{ id: 'rescued', text: '一次实际救援事件。' }]; invented.resolution.progress = [{ questId: 'rain-night', requirementId: 'made-up', eventId: 'rescued' }];
  assert.throws(() => applyTurn(session, prepared, invented), /要求不存在/);
  const duplicate = structuredClone(invented); duplicate.resolution.progress = [0, 1].map(() => ({ questId: 'rain-night', requirementId: 'rescue', eventId: 'rescued' }));
  assert.throws(() => applyTurn(session, prepared, duplicate), /不能重复/);
  assert.ok(session.state.quests[0].requirements.every(req => !req.done));
});

test('failure and refused cannot grant progress, rewards, or silently fail a goal', () => {
  const session = beforeDecision(), prepared = pending(session), base = noChange(session);
  for (const type of ['failure', 'refused']) {
    const forged = structuredClone(base); forged.outcome.type = type; forged.events = [{ id: 'claimed', text: '声称已经完成。' }];
    forged.resolution.progress = [{ questId: 'rain-night', requirementId: 'decision', eventId: 'claimed' }]; assert.throws(() => applyTurn(session, prepared, forged), /不能推进/);
  }
  const denied = structuredClone(base); denied.outcome.type = 'refused'; denied.events = [{ id: 'denied', text: '系统拒绝了无限力量请求。' }]; denied.resolution.failures = [{ questId: 'rain-night', reason: '没有执行任何行动。', eventId: 'denied' }];
  assert.throws(() => applyTurn(session, prepared, denied), /未执行/); assert.equal(session.state.quests[0].status, 'active'); assert.equal(session.state.credits, 0);
});

test('reward authority rejects arbitrary patches, reused completion and a self-completing new quest', () => {
  const session = beforeDecision(), prepared = pending(session), base = noChange(session);
  const patch = structuredClone(base); patch.resolution.credits = 999; assert.throws(() => applyTurn(session, prepared, patch), /不支持 credits/);
  const result = fullRoute('resolve-report'), repeat = noChange(result); repeat.events = [{ id: 'repeat', text: '试图重复领取。' }]; repeat.resolution.progress = [{ questId: 'rain-night', requirementId: 'decision', eventId: 'repeat' }];
  assert.throws(() => applyTurn(result, pending(result), repeat), /已有、仍在进行/);
  const newQuest = structuredClone(base); newQuest.events = [{ id: 'new', text: '发布新目标。' }]; const nextGoal = structuredClone(session.state.quests[0]); nextGoal.id = 'fresh-goal'; nextGoal.requirements.forEach(req => { req.done = false; }); newQuest.resolution.newQuests = [nextGoal]; newQuest.resolution.progress = [{ questId: 'fresh-goal', requirementId: 'decision', eventId: 'new' }];
  assert.throws(() => applyTurn(session, prepared, newQuest), /已有、仍在进行/);
});

test('resource, relationship and goal bounds are enforced atomically', () => {
  const session = opening(), prepared = pending(session), base = noChange(session);
  for (const mutate of [
    raw => { raw.resolution.energyDelta = 31; }, raw => { raw.resolution.spendCredits = 1; }, raw => { raw.resolution.dayDelta = 3; },
    raw => { raw.resolution.relationships = [{ id: 'ally', name: session.preset.ally, trustDelta: 11, stance: '临时改变', eventId: 'one' }]; },
    raw => { raw.resolution.newQuests = ['new-one', 'new-two'].map(id => ({ ...structuredClone(session.state.quests[0]), id })); },
  ]) { const raw = structuredClone(base); raw.events = [{ id: 'one', text: '本轮发生的实际事件。' }]; mutate(raw); assert.throws(() => applyTurn(session, prepared, raw)); }
  assert.equal(session.state.energy, 100); assert.equal(session.state.quests.length, 1);
  const noEvent = structuredClone(base); noEvent.resolution.energyDelta = 10; assert.throws(() => applyTurn(session, prepared, noEvent), /没有实际事件/);
  const sameLocation = structuredClone(base); sameLocation.resolution.location = session.state.location;
  assert.deepEqual(applyTurn(session, prepared, sameLocation).state, session.state);
});

test('prepared actions cannot be forged, reused, submitted against a different session, or made stale', () => {
  const session = opening(), prepared = pending(session), raw = demoTurn(session, prepared);
  assert.throws(() => applyTurn(session, { ...prepared }, raw), error => error.status === 409);
  assert.throws(() => applyTurn(structuredClone(session), prepared, raw), error => error.status === 409);
  const next = applyTurn(session, prepared, raw); assert.throws(() => applyTurn(session, prepared, raw), error => error.status === 409);
  assert.throws(() => prepareAction(next, { revision: session.revision, input: '救人' }), error => error.status === 409);
  assert.throws(() => prepareAction(next, { revision: next.revision, choiceId: session.nodes[0].choices[0].id }), error => error.status === 409);
});

test('rewind restores reward ledger and creates a branch with monotonic revision', () => {
  const completed = fullRoute('resolve-report'), restored = rewindSession(completed, completed.nodes[1].id);
  assert.equal(restored.revision, completed.revision + 1); assert.equal(restored.nodes.length, 2); assert.equal(restored.state.credits, 0); assert.deepEqual(restored.state.rewardLedger, []);
  const next = act(act(restored, 'investigate-witness'), 'resolve-hide'); assert.equal(next.revision, restored.revision + 2); assert.equal(next.state.credits, 40); assert.deepEqual(next.state.rewardLedger, ['rain-night']);
  assert.equal(next.nodes[2].parentId, next.nodes[1].id); assert.ok(next.nodes[2].revision > next.nodes[1].revision + 1);
  assert.ok(next.state.facts.find(fact => fact.id === 'chosen-route').text.includes('隐瞒'));
});

test('v2 import preserves story and validates a server save with request IDs and revision gaps', () => {
  let saved = fullRoute('resolve-public'); saved = rewindSession(saved, saved.nodes[1].id); saved = act(saved, 'investigate-witness'); saved = act(saved, 'resolve-hide');
  const input = structuredClone(saved); input.nodes.slice(1).forEach(node => { node.requestId = randomUUID(); });
  const imported = validateSession(input); assert.notEqual(imported.id, saved.id); assert.equal(imported.revision, saved.revision); assert.deepEqual(imported.state, saved.state);
  assert.deepEqual(imported.nodes.map(node => node.revision), saved.nodes.map(node => node.revision)); assert.deepEqual(imported.nodes.map(node => node.narrative), saved.nodes.map(node => node.narrative));
  assert.ok(imported.nodes.every(node => !node.requestId)); assert.equal(act(imported, 'next-track').revision, imported.revision + 1);
});

test('import rejects forged snapshots, ledger, events, canon, unsafe keys, and old five-action saves', () => {
  const saved = fullRoute('resolve-report');
  for (const mutate of [
    input => { input.state.credits = 900; }, input => { input.nodes[1].snapshot.credits = 900; },
    input => { input.nodes.at(-1).snapshot.rewardLedger = []; }, input => { input.nodes[1].events = []; },
    input => { input.canon.facts[1] = '今天刚获得系统。'; }, input => { input.nodes[1].snapshot.inventory.push({ id: 'cheat', name: '凭空物品', description: '不是奖励。' }); },
  ]) { const input = structuredClone(saved); mutate(input); assert.throws(() => validateSession(input)); }
  const malicious = JSON.parse(JSON.stringify(saved).replace('"schemaVersion":2', '"schemaVersion":2,"__proto__":{"polluted":true}')); assert.throws(() => validateSession(malicious), /禁止/);
  assert.throws(() => validateSession({ ...structuredClone(saved), schemaVersion: 1 }), /旧版五类行动/);
});

test('alternate genres and editable names remain consistent throughout the demo', () => {
  for (const genre of ['cultivation', 'business']) {
    let session = opening({ genre, name: '江宁', ally: '黎青', location: '自定义地点', systemName: '自定义系统' });
    assert.ok(session.nodes[0].narrative.includes('江宁')); assert.ok(session.nodes[0].narrative.includes('黎青')); assert.equal(session.state.location, '自定义地点');
    session = act(act(act(session, 'rescue-careful'), 'investigate-witness'), 'resolve-report'); assert.equal(session.state.credits, 40);
    assert.ok(session.nodes.at(-1).narrative.includes('自定义系统')); assert.deepEqual(validateSession(session).state, session.state);
  }
  assert.equal(normalizePreset().genre, 'urban'); assert.equal(DEFAULT_PRESET.genre, 'urban');
});
