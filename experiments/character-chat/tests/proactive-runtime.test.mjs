import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgency, applyLifeProposal, agencyStatus, consumeAgencyOpportunity, closeAgencyThreads,
  reopenAgencyThreads, refreshAgency, parseLifeProposal, AGENCY_MIN_DELAY_MS, AGENCY_WINDOW_MS } from '../proactive-runtime.mjs';
import { createSession, buildMessages, buildInitiativeMessages } from '../engine.mjs';

const NOW = '2026-10-12T00:00:00.000Z';
const at = seconds => new Date(Date.parse(NOW) + seconds * 1000).toISOString();
const life = (state = '我想练一首新歌。', nextStep = '把最难的两小节拆开练慢速') => ({
  scope: 'fictional-character', subject: '练一首新歌', state, nextStep, feeling: '有点期待', status: 'active', delaySeconds: 120,
});
const apply = (agency, proposal, seconds = 0) => applyLifeProposal(agency, proposal, {
  messages: [{ id: `message-${seconds}`, role: 'assistant', text: proposal.state }], now: at(seconds), id: 'activity-1',
});

test('empty agency has no timer-driven fictional activity', () => {
  const agency = createAgency();
  assert.equal(agencyStatus(agency, { now: at(100000) }).nextAt, null);
  assert.deepEqual(refreshAgency(agency, { now: at(100000) }), agency);
});

test('time opens a consideration window without changing the expressed state', () => {
  const agency = apply(createAgency(), life());
  const before = structuredClone(agency);
  assert.equal(agency.nextAt, at(120));
  assert.equal(agencyStatus(agency, { now: at(119) }).ready, false);
  const status = agencyStatus(agency, { now: at(120) });
  assert.equal(status.ready, true);
  assert.equal(status.opportunity.currentState, '我想练一首新歌。');
  assert.equal(status.opportunity.nextStep, '把最难的两小节拆开练慢速');
  assert.equal(status.opportunity.sourceMessageId, 'message-0');
  assert.deepEqual(agency, before);
});

test('only actually expressed first-person character content can create an activity', () => {
  for (const text of ['我没有说这件事。', '你说“我想练一首新歌。”', '```我想练一首新歌。```']) {
    const agency = applyLifeProposal(createAgency(), life(), { messages: [{ id: 'm', role: 'assistant', text }], now: NOW, id: 'a' });
    assert.equal(agency.threads.length, 0, text);
  }
  for (const state of ['她想练一首新歌。', '你已经完成了练习。', '我们一起练完这首歌了。']) {
    assert.equal(apply(createAgency(), life(state)).threads.length, 0, state);
  }
  const fromUser = applyLifeProposal(createAgency(), life(), { messages: [{ id: 'm', role: 'user', text: life().state }], now: NOW, id: 'a' });
  assert.equal(fromUser.threads.length, 0);
});

test('sentence-internal first person preserves a ten-minute expressed action', () => {
  const state = '这十分钟我想把刚存的那首广告歌循环听完，听完跟你说洗没洗脑。';
  const agency = apply(createAgency(), { ...life(state, '听完后判断副歌是不是还留在脑子里'), delaySeconds: 600 });
  assert.equal(agency.threads.length, 1);
  assert.equal(agency.threads[0].currentState, state);
  assert.equal(agency.nextAt, at(600));
  assert.equal(agencyStatus(agency, { now: at(599) }).ready, false);
  for (const state of ['小林的原话是：这十分钟我想把歌听完。', '她说这十分钟我想把歌听完。']) {
    assert.equal(apply(createAgency(), life(state)).threads.length, 0, state);
  }
});

test('implicit Chinese self action advances an expressed activity without forcing a pronoun', () => {
  const first = { ...life('我想把一部旧片的配乐再听一遍。', '找出那张原声，把弦乐那段完整听完'), subject: '听完旧片配乐' };
  let agency = apply(createAgency(), first);
  const op = agencyStatus(agency, { now: at(120) }).opportunity;
  agency = consumeAgencyOpportunity(agency, op.id, { now: at(120), outcome: 'sent' });
  const state = '原声翻出来了，弦乐正从头过，这次不准备中途停。';
  const next = { ...first, state, nextStep: '把这段弦乐听到结束', delaySeconds: 900 };
  const progressed = applyLifeProposal(agency, next, { messages: [{ id: 'actual-nari-reply', role: 'assistant', text: `${state}你叫我去做自己的小事，这一点我挺喜欢。` }], now: at(132), id: 'ignored-new-id' });
  assert.equal(progressed.threads[0].revision, 2);
  assert.equal(progressed.threads[0].currentState, state);
  assert.equal(progressed.threads[0].sourceMessageId, 'actual-nari-reply');
  assert.equal(progressed.nextAt, at(1032));
  for (const state of ['你把原声翻出来了，正准备从头听。', '她正在把原声从头听完。', '小林把原声翻出来了，准备听到结束。', '朋友准备把弦乐听到结束。', '假如原声翻出来了，准备从头听。', '例如原声翻出来了，正从头听。']) {
    assert.equal(apply(agency, { ...next, state }, 132).threads[0].revision, 1, state);
  }
});

test('an action substring inherits the explicit first-person subject of its actual source clause', () => {
  const state = '想把一部老电影里配角刚出场的那段配乐，自己轻轻哼一遍';
  const proposal = { ...life(state, '哼完后决定留下哪一句旋律'), subject: '哼一段老电影配乐' };
  const original = '有啊。我想把一部老电影里配角刚出场的那段配乐，自己轻轻哼一遍。';
  const applySource = text => applyLifeProposal(createAgency(), proposal, {
    messages: [{ id: 'source-clause', role: 'assistant', text }], now: NOW, id: 'humming',
  });
  const agency = applySource(original);
  assert.equal(agency.threads.length, 1);
  assert.equal(agency.threads[0].currentState, state);
  assert.equal(agency.threads[0].sourceMessageId, 'source-clause');
  for (const prefix of ['小林', '你', '她', '朋友', '据说小林', '我听说小林', '小林说：我']) {
    assert.equal(applySource(`有啊。${prefix}${state}。`).threads.length, 0, prefix);
  }
});

test('both writer contracts expose life directly instead of only the legacy beat schema', () => {
  const session = createSession({ characterId: 'yume', now: NOW });
  for (const messages of [buildMessages(session, '给自己留十分钟做件想做的事。'), buildInitiativeMessages(session, { now: at(15) })]) {
    const note = messages.at(-1).content;
    const mainSchema = JSON.parse(note.match(/排列：(\{.*?\})。/u)[1]);
    assert.equal(mainSchema.life.scope, 'fictional-character');
    assert.equal(mainSchema.life.status, 'active');
    assert.ok(mainSchema.life.state);
    assert.ok(mainSchema.life.nextStep);
    assert.ok(note.includes('必须') && note.includes('beat 不能替代 life'));
  }
});

test('activity proposals have bounded fields, valid steps and a fixed fictional scope', () => {
  for (const proposal of [{ ...life(), scope: 'user' }, { ...life(), nextStep: '' }, { ...life(), state: '字'.repeat(161) }, { ...life(), status: 'completed' }]) {
    assert.throws(() => parseLifeProposal(proposal), error => error.status === 502);
  }
  assert.equal(parseLifeProposal({ ...life(), delaySeconds: 1 }).delaySeconds * 1000, AGENCY_MIN_DELAY_MS);
});

test('a delivered version cannot repeat or refresh just through a changed feeling', () => {
  let agency = apply(createAgency(), life());
  const opportunity = agencyStatus(agency, { now: at(120) }).opportunity;
  agency = consumeAgencyOpportunity(agency, opportunity.id, { now: at(120), outcome: 'sent' });
  assert.equal(agency.threads[0].status, 'waiting');
  assert.equal(agency.threads[0].lastDeliveredRevision, 1);
  assert.equal(agencyStatus(agency, { now: at(900) }).ready, false);
  const changedFeeling = apply(agency, { ...life(), feeling: '更期待了' }, 121);
  assert.equal(changedFeeling.threads[0].revision, 1);
  assert.equal(changedFeeling.nextAt, null);
  assert.deepEqual(consumeAgencyOpportunity(agency, opportunity.id, { now: at(900) }), agency);
});

test('an expressed substantive advance gives the same activity a new version', () => {
  let agency = apply(createAgency(), life());
  const first = agencyStatus(agency, { now: at(120) }).opportunity;
  agency = consumeAgencyOpportunity(agency, first.id, { now: at(120), outcome: 'sent' });
  agency = apply(agency, life('我把最难的两小节拆开慢慢唱顺了。', '把这两小节接回完整的一段'), 121);
  assert.equal(agency.threads.length, 1);
  assert.equal(agency.threads[0].revision, 2);
  assert.equal(agency.threads[0].lastDeliveredRevision, 1);
  assert.equal(agency.nextAt, at(241));
  assert.notEqual(agencyStatus(agency, { now: at(241) }).opportunity.id, first.id);
});

test('silent consideration consumes a version without inventing progress', () => {
  let agency = apply(createAgency(), life());
  const before = agency.threads[0].currentState;
  agency = consumeAgencyOpportunity(agency, agencyStatus(agency, { now: at(120) }).opportunity.id, { now: at(120), outcome: 'silent' });
  assert.equal(agency.threads[0].currentState, before);
  assert.equal(agency.ledger[0].outcome, 'silent');
  assert.equal(agency.nextAt, null);
});

test('closing or resolving a topic prevents model-driven reopening', () => {
  const original = apply(createAgency(), life());
  for (let agency of [closeAgencyThreads(original, { topic: '练一首新歌', now: at(1) }),
    apply(original, { ...life('我已经完整唱完这首新歌了。'), status: 'resolved', nextStep: '' }, 1)]) {
    const status = agency.threads[0].status;
    agency = apply(agency, life('我又开始练这首新歌了。', '再录一个新版本'), 10);
    assert.equal(agency.threads[0].status, status);
    assert.equal(agency.nextAt, null);
    agency = reopenAgencyThreads(agency, { topic: '我们重新聊练一首新歌', now: at(11) });
    agency = apply(agency, life('我决定把这首新歌再练一遍。', '换一种节拍练开头'), 12);
    assert.equal(agency.threads[0].status, 'active');
  }
});

test('three considerations share a rolling window, with no automatic budget reset', () => {
  let agency = apply(createAgency(), life());
  const states = ['我先把第一段的旋律唱顺了。', '我把中间的换气位置重新安排好了。', '我给最后的副歌换了更轻的一种节奏。'];
  for (let i = 0; i < 3; i++) {
    const seconds = 120 * (i + 1);
    const op = agencyStatus(agency, { now: at(seconds) }).opportunity;
    assert.ok(op);
    agency = consumeAgencyOpportunity(agency, op.id, { now: at(seconds), outcome: 'sent' });
    agency = apply(agency, life(states[i], `试试第${i + 1}种不同的唱法`), seconds);
  }
  const blocked = agencyStatus(agency, { now: at(480) });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.remainingInWindow, 0);
  assert.equal(blocked.nextAt, at(120 + AGENCY_WINDOW_MS / 1000));
  assert.equal(agencyStatus(agency, { now: at(1020) }).ready, true);
});

test('a lapsed opportunity expires without becoming a completed action', () => {
  const agency = apply(createAgency(), life());
  const expired = refreshAgency(agency, { now: new Date(Date.parse(agency.threads[0].expiresAt) + 1).toISOString() });
  assert.equal(expired.nextAt, null);
  assert.equal(expired.threads[0].currentState, agency.threads[0].currentState);
  assert.equal(expired.threads[0].status, 'active');
});
