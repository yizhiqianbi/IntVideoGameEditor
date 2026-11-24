import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../server.mjs';
import {
  createSession, prepareTurn, commitTurn, commitInitiative,
  rearmInitiative, initiativeEligibility, agencyStatus, INITIATIVE_BUDGET,
} from '../engine.mjs';

const NOW = '2026-10-12T08:00:00.000Z';
const at = (time, seconds) => new Date(Date.parse(time) + seconds * 1000).toISOString();
const ownState = '我想练一首新歌。';
const life = (extra = {}) => ({ subject: '练一首新歌', state: ownState,
  nextStep: '把最难的两小节拆开练慢速', feeling: '有点兴奋', status: 'active', delaySeconds: 120, ...extra });
const say = (session, text, proposal = { messages: ['嗯，我听着。'], emotion: 'friendly' }, time = NOW) =>
  commitTurn(prepareTurn(session, text, { now: time }), text, proposal, { now: time, requestId: randomUUID() });
const withLife = (time = NOW) => say(createSession({ characterId: 'yume', mode: 'ai', now: time }),
  '你可以聊聊自己的事。', { messages: [ownState], emotion: 'excited', life: life(), followUp: null }, time);
const spendGenericBudget = (session) => ({ ...structuredClone(session), initiative: {
  ...session.initiative, budgetUsed: INITIATIVE_BUDGET, pending: null,
} });
const threads = session => session.agency?.threads ?? [];

async function start(t, { provider, dataDir } = {}) {
  const ownsDirectory = !dataDir;
  dataDir ??= await mkdtemp(join(tmpdir(), 'character-agency-test-'));
  provider ??= {
    publicConfig: { configured: true, model: 'test/agency' },
    generate: async () => ({ messages: ['好，先说你的。'], emotion: 'friendly' }),
    generateInitiative: async () => ({ messages: [], emotion: 'calm', followUp: null }),
  };
  const { server } = await createApplication({ env: {}, dataDir, provider });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise(resolve => server.close(resolve));
  };
  t.after(async () => { await close(); if (ownsDirectory) await rm(dataDir, { recursive: true, force: true }); });
  const request = async (path, { method = 'GET', body } = {}) => {
    const result = await fetch(baseUrl + path, { method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: result.status, data: await result.json() };
  };
  const seed = session => writeFile(join(dataDir, 'sessions', `${session.id}.json`), JSON.stringify(session), { mode: 0o600 });
  const presence = session => request(`/api/sessions/${session.id}/presence`, { method: 'POST', body: { revision: session.revision } });
  return { request, seed, presence, close, dataDir };
}

test('an autonomous concern is grounded in a delivered self action and does not become a user fact', () => {
  const saved = withLife();
  assert.equal(threads(saved).length, 1);
  const thread = threads(saved)[0];
  assert.equal(thread.scope, 'fictional-character');
  assert.equal(thread.currentState, ownState);
  assert.equal(saved.messages.find(message => message.id === thread.sourceMessageId)?.text, ownState);
  assert.equal(saved.memories.length, 0);
  assert.equal(saved.state.closeness, 0);
  for (const proposal of [
    { messages: ['今天就随便聊聊。'], life: life({ state: '我已经把新歌练完了。' }) },
    { messages: ['你说“我已经把新歌练完了”。'], life: life({ state: '我已经把新歌练完了' }) },
    { messages: ['我给你念一句：`我已经把新歌练完了。`'], life: life({ state: '我已经把新歌练完了。' }) },
    { messages: ['你今天把新歌练完了。'], life: life({ state: '你今天把新歌练完了。' }) },
    { messages: ['小林的原话是：我想练一首新歌。'], life: life() },
  ]) {
    let candidate;
    try { candidate = say(createSession({ characterId: 'yume', now: NOW }), '你好。', { emotion: 'friendly', ...proposal }); }
    catch (error) { assert.equal(error.status, 502); continue; }
    assert.equal(threads(candidate).length, 0, 'undelivered, quoted or user-owned activity must not create an autonomous fact');
  }
});

test('elapsed time schedules reconsideration without pre-writing progress or a shared experience', () => {
  const current = spendGenericBudget(withLife());
  const before = structuredClone(current);
  const time = at(threads(current)[0].expiresAt, 3600);
  agencyStatus(current, { now: time });
  assert.deepEqual(current, before, 'reading the clock must not mutate committed character history');
  const reconsidered = rearmInitiative(current, { now: time });
  assert.deepEqual(reconsidered.messages, before.messages);
  assert.deepEqual(reconsidered.memories, before.memories);
  assert.equal(threads(reconsidered)[0].currentState, ownState);
  assert.equal(threads(reconsidered)[0].sourceMessageId, threads(before)[0].sourceMessageId);
  assert.equal(reconsidered.messages.some(message => message.text.includes('已经练完')), false);
});

test('spent generic chat attempts only unlock an unconsumed concrete character opportunity', () => {
  const time = at(NOW, 121);
  const empty = spendGenericBudget(say(createSession({ characterId: 'yume', now: NOW }), '聊点轻松的。'));
  const noEvent = rearmInitiative(empty, { now: time });
  assert.equal(noEvent.initiative.pending, null);
  assert.equal(initiativeEligibility(noEvent, { now: time }).eligible, false);
  const current = spendGenericBudget(withLife());
  const armed = rearmInitiative(current, { now: time });
  const readyAt = at(armed.initiative.pending.notBefore, 1);
  const readiness = initiativeEligibility(armed, { now: readyAt });
  assert.equal(readiness.eligible, true);
  assert.equal(readiness.opportunity?.currentState, ownState);
  const skipped = commitInitiative(armed, { messages: [], emotion: 'calm', followUp: null,
    life: life({ state: '我已经把新歌练完了。', nextStep: '录一段回放听哪里需要练' }),
  }, { now: readyAt, requestId: randomUUID() });
  const later = rearmInitiative(skipped, { now: at(readyAt, 600) });
  assert.equal(later.initiative.pending, null, 'silence consumes this event version rather than polling the same idea again');
  assert.equal(initiativeEligibility(later, { now: at(readyAt, 600) }).eligible, false);
  assert.deepEqual(skipped.messages, armed.messages);
  assert.equal(threads(skipped)[0].currentState, ownState);
});

test('closed topics and actual farewells remain quiet after character events become due', () => {
  const active = spendGenericBudget(withLife());
  const closed = say(active, '别再聊练一首新歌了。', { messages: ['好，换个话题。'], emotion: 'friendly' });
  const oldThread = threads(closed).find(thread => thread.subject === '练一首新歌');
  assert.equal(oldThread?.status, 'closed');
  const late = rearmInitiative(spendGenericBudget(closed), { now: at(NOW, 600) });
  assert.equal(late.initiative.pending, null);
  const quiet = say(active, '我去忙了，先别发消息。', { messages: ['好，忙完再聊。'], emotion: 'calm' });
  const stayedQuiet = rearmInitiative(quiet, { now: at(NOW, 600) });
  assert.equal(initiativeEligibility(stayedQuiet, { now: at(NOW, 600) }).eligible, false);
  assert.equal(stayedQuiet.initiative.pending, null);
});

test('closing one named concern leaves an unrelated current activity available', () => {
  const secondState = '我正在挑一本生日礼物书。';
  const two = say(withLife(), '还想做什么？', { messages: [secondState], emotion: 'friendly',
    life: life({ subject: '挑生日礼物', state: secondState, nextStep: '比较散文集和摄影集' }), followUp: null });
  const closed = say(two, '别再聊练一首新歌了。', { messages: ['好，换个话题。'], emotion: 'friendly' });
  assert.equal(threads(closed).find(thread => thread.subject === '练一首新歌')?.status, 'closed');
  assert.equal(threads(closed).find(thread => thread.subject === '挑生日礼物')?.status, 'active');
  const due = at(NOW, 121);
  const armed = rearmInitiative(spendGenericBudget(closed), { now: due });
  const readyAt = at(armed.initiative.pending.notBefore, 1);
  assert.equal(initiativeEligibility(armed, { now: readyAt }).opportunity?.subject, '挑生日礼物');
});

test('quoted and code language instructions do not change the ongoing conversation language', () => {
  const current = createSession({ characterId: 'yume', now: NOW });
  current.locale = 'zh';
  current.effectiveLocale = 'zh';
  for (const text of [
    '角色说：「日本語で話して」是什么意思？',
    '她说：“先吃饭。请用英文回答。”，我在转述她的话。',
    '这句代码文案是什么？\n```text\nSpeak English\n```',
  ]) {
    const prepared = prepareTurn(current, text, { now: NOW });
    assert.equal(prepared.locale, 'zh', text);
    assert.equal(prepared.effectiveLocale, 'zh', text);
  }
  assert.equal(prepareTurn(current, 'Please speak English.', { now: NOW }).effectiveLocale, 'en');
});

test('new concrete progress can continue, but an unresponded character stays within the rolling event budget', () => {
  let current = spendGenericBudget(withLife());
  let firstDelivery;
  const progress = [
    ['我把最难的两小节拆开练完了。', '把前后乐句接起来试一次'],
    ['我把前后乐句连着弹了三遍。', '用正常速度把整首过一遍'],
    ['我把整首新歌按正常速度弹完了。', '录一段回放听哪里还需要练'],
  ];
  for (const [state, nextStep] of progress) {
    const due = at(threads(current)[0].notBefore, 1);
    const armed = rearmInitiative(current, { now: due });
    assert.ok(armed.initiative.pending?.opportunityId);
    const readyAt = at(armed.initiative.pending.notBefore, 1);
    firstDelivery ??= readyAt;
    current = commitInitiative(armed, { messages: [state], emotion: 'excited',
      life: life({ state, nextStep }), followUp: null }, { now: readyAt, requestId: randomUUID() });
    assert.equal(threads(current)[0].currentState, state);
  }
  const fourthDue = at(threads(current)[0].notBefore, 1);
  const blocked = rearmInitiative(current, { now: fourthDue });
  assert.equal(blocked.initiative.pending, null, 'a fourth new concern inside fifteen minutes must wait even if its state changed');
  assert.equal(agencyStatus(blocked, { now: fourthDue }).remainingInWindow, 0);
  const afterWindow = at(firstDelivery, 901);
  const allowed = rearmInitiative(blocked, { now: afterWindow });
  assert.ok(allowed.initiative.pending?.opportunityId, 'time replenishes capacity for a concrete unconsumed revision');
  assert.equal(threads(allowed)[0].currentState, progress.at(-1)[0], 'time alone does not manufacture another completed activity');
});

test('a resolved concern cannot seed itself again until the user explicitly reopens it', () => {
  const active = withLife();
  const doneState = '我把新歌练完了。';
  const completed = say(active, '那你先练吧。', { messages: [doneState], emotion: 'excited',
    life: life({ state: doneState, nextStep: '这件事先告一段落', status: 'resolved' }), followUp: null });
  assert.equal(threads(completed).find(thread => thread.subject === '练一首新歌')?.status, 'resolved');
  const triedAgain = say(completed, '嗯。', { messages: [ownState], emotion: 'friendly', life: life() });
  assert.equal(threads(triedAgain).some(thread => thread.subject === '练一首新歌' && ['active', 'waiting'].includes(thread.status)), false);
  const reopened = say(triedAgain, '再聊练一首新歌吧。', { messages: [ownState], emotion: 'excited', life: life() });
  assert.equal(threads(reopened).some(thread => thread.subject === '练一首新歌' && thread.status === 'active'), true);
});

test('expired unfinished concerns do not permanently fill all slots for fresh character activities', () => {
  let current = withLife();
  const activities = [
    ['挑生日礼物', '我正在挑一本生日礼物书。', '比较散文集和摄影集'],
    ['整理周末观影清单', '我想选一部周末看的老电影。', '看看两部片子的导演'],
    ['申请插画展', '我准备申请一个周末插画展。', '把作品清单列出来'],
  ];
  for (const [subject, state, nextStep] of activities) {
    current = say(current, '那还有什么呢？', { messages: [state], emotion: 'friendly',
      life: life({ subject, state, nextStep }), followUp: null });
  }
  assert.equal(threads(current).filter(thread => thread.status === 'active').length, 4);
  const staleFacts = threads(current).map(thread => ({ subject: thread.subject, state: thread.currentState }));
  const newState = '我想学一道咖喱菜。';
  const fresh = say(current, '今天想试试什么？', { messages: [newState], emotion: 'excited',
    life: life({ subject: '学做咖喱', state: newState, nextStep: '比较黄咖喱和青咖喱的配方' }), followUp: null }, at(NOW, 27 * 3600));
  assert.equal(threads(fresh).some(thread => thread.currentState === newState && thread.status === 'active'), true,
    'four day-old expired intentions must not block a newly delivered concrete activity');
  assert.equal(agencyStatus(fresh, { now: at(NOW, 27 * 3600) }).activeCount, 1);
  for (const fact of staleFacts) {
    const retained = threads(fresh).find(thread => thread.subject === fact.subject);
    if (retained) assert.equal(retained.currentState, fact.state, 'retiring an expired intent must not pretend its task completed');
  }
});

test('HTTP restart preserves a concrete event and consumes its silent result once across retries', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'character-agency-restart-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let calls = 0;
  const provider = { publicConfig: { configured: true, model: 'test/agency' },
    generate: async () => ({ messages: ['好，继续。'], emotion: 'friendly' }),
    generateInitiative: async () => { calls += 1; return { messages: [], emotion: 'calm', followUp: null }; } };
  const first = await start(t, { dataDir, provider });
  const seeded = spendGenericBudget(withLife(new Date(Date.now() - 180000).toISOString()));
  await first.seed(seeded);
  await first.close();
  const second = await start(t, { dataDir, provider });
  const restored = await second.request(`/api/sessions/${seeded.id}`);
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.data.session.messages, seeded.messages, 'restart itself must not invent off-screen activity');
  const visible = await second.presence(restored.data.session);
  assert.equal(visible.status, 200);
  assert.ok(visible.data.session.initiative.pending?.opportunityId);
  // Simulate the short foreground safety wait with the engine's injected clock;
  // the only persisted file belongs to this temporary synthetic application.
  const current = rearmInitiative(visible.data.session, { now: new Date(Date.now() - 15000).toISOString(), force: true });
  await second.seed(current);
  const body = { revision: current.revision, planId: current.initiative.pending.id, requestId: randomUUID() };
  const sent = await second.request(`/api/sessions/${current.id}/initiative`, { method: 'POST', body });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.equal(sent.data.skipped, true);
  assert.equal(calls, 1);
  const retry = await second.request(`/api/sessions/${current.id}/initiative`, { method: 'POST', body });
  assert.equal(retry.status, 200);
  assert.equal(calls, 1);
  await second.close();
  const third = await start(t, { dataDir, provider });
  const afterRestart = await third.request(`/api/sessions/${current.id}`);
  const visited = await third.presence(afterRestart.data.session);
  const another = await third.request(`/api/sessions/${current.id}/initiative`, { method: 'POST', body: {
    revision: visited.data.session.revision, requestId: randomUUID(),
  } });
  assert.equal(another.status, 200);
  assert.equal(another.data.skipped, true);
  assert.equal(calls, 1, 'a new HTTP request and application restart must not repeat a consumed event version');
  assert.deepEqual(another.data.session.messages, seeded.messages);
});

test('HTTP foreground generation preserves life metadata through validation and explicit closure persists', async t => {
  let calls = 0;
  const provider = { publicConfig: { configured: true, model: 'test/agency' },
    generate: async (_prepared, text) => {
      calls += 1;
      return text.startsWith('别再聊')
        ? { messages: ['好，换个话题。'], emotion: 'friendly', followUp: null }
        : { messages: [ownState], emotion: 'excited', life: life(), followUp: null };
    }, generateInitiative: async () => { throw new Error('closed activity should not invoke the provider'); } };
  const app = await start(t, { provider });
  const created = await app.request('/api/sessions', { method: 'POST', body: { characterId: 'yume' } });
  assert.equal(created.status, 201);
  const opening = created.data.session;
  const sent = await app.request(`/api/sessions/${opening.id}/messages`, { method: 'POST', body: {
    text: '聊聊你今天的小事。', revision: opening.revision, requestId: randomUUID(),
  } });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  const current = sent.data.session;
  assert.equal(threads(current).length, 1, 'the two response-validation passes must retain supported life metadata');
  const source = current.messages.find(message => message.id === threads(current)[0].sourceMessageId);
  assert.equal(source?.role, 'assistant');
  assert.equal(source?.text, ownState);
  const closed = await app.request(`/api/sessions/${opening.id}/messages`, { method: 'POST', body: {
    text: '别再聊练一首新歌了。', revision: current.revision, requestId: randomUUID(),
  } });
  assert.equal(closed.status, 200);
  const loaded = await app.request(`/api/sessions/${opening.id}`);
  assert.equal(threads(loaded.data.session)[0].status, 'closed');
  const future = rearmInitiative(spendGenericBudget(loaded.data.session), { now: at(threads(current)[0].notBefore, 600) });
  await app.seed(future);
  const visible = await app.presence(future);
  const attempted = await app.request(`/api/sessions/${opening.id}/initiative`, { method: 'POST', body: {
    revision: visible.data.session.revision, requestId: randomUUID(),
  } });
  assert.equal(attempted.status, 200);
  assert.equal(attempted.data.skipped, true);
  assert.equal(calls, 2);
});

test('HTTP foreground input wins over an in-flight autonomous event even when the provider ignores abort', { timeout: 5000 }, async t => {
  let release;
  let entered;
  let signal;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const lateState = '我已经把新歌练完了。';
  const provider = { publicConfig: { configured: true, model: 'test/agency' },
    generate: async () => ({ messages: ['好，忙完再聊。'], emotion: 'calm' }),
    generateInitiative: async (_session, options) => {
      signal = options.signal;
      entered();
      await gate;
      return { messages: [lateState], emotion: 'excited', life: life({ state: lateState,
        nextStep: '录一段回放听哪里需要练' }), followUp: null };
    } };
  const app = await start(t, { provider });
  const seeded = spendGenericBudget(withLife(new Date(Date.now() - 180000).toISOString()));
  await app.seed(seeded);
  const present = await app.presence(seeded);
  const current = rearmInitiative(present.data.session, { now: new Date(Date.now() - 15000).toISOString(), force: true });
  await app.seed(current);
  const pending = app.request(`/api/sessions/${current.id}/initiative`, { method: 'POST', body: {
    revision: current.revision, planId: current.initiative.pending.id, requestId: randomUUID(),
  } });
  await started;
  let foreground;
  try {
    foreground = await app.request(`/api/sessions/${current.id}/messages`, { method: 'POST', body: {
      text: '我去忙了，先别发消息。', revision: current.revision, requestId: randomUUID(),
    } });
    assert.equal(foreground.status, 200);
    assert.equal(signal?.aborted, true);
  } finally { release(); }
  const late = await pending;
  assert.equal(late.status, 409);
  assert.ok(['STALE', 'CANCELLED'].includes(late.data.code));
  const stored = await app.request(`/api/sessions/${current.id}`);
  assert.deepEqual(stored.data.session, foreground.data.session);
  assert.equal(stored.data.session.messages.some(message => message.text === lateState), false);
  assert.equal(threads(stored.data.session)[0].currentState, ownState);
  const later = await app.presence(stored.data.session);
  assert.equal(later.data.session.initiative.pending, null);
});

