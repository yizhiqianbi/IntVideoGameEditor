import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeUserActs,
  normalizeDialogueState,
  responseFingerprint,
  responseGuard,
  updateAfterTurn,
  updateBeforeTurn,
} from '../dialogue-state.mjs';

const NOW = '2026-01-01T00:00:00.000Z';

test('compound input chooses the latest direct affection question', () => {
  const analysis = analyzeUserActs('你都不问我为什么讨厌你，别嗯，你会撒娇吗，笨蛋');
  assert.equal(analysis.primary.kind, 'question');
  assert.equal(analysis.primary.topicKey, 'affection');
  assert.ok(analysis.secondary.some(item => item.kind === 'emotion'));
  assert.ok(analysis.secondary.some(item => item.kind === 'tease'));
});

test('a safe affection turn clears an earlier explicit boundary branch', () => {
  let state = normalizeDialogueState();
  state = updateBeforeTurn(state, '对，夹住我的鸡巴。', { turnId: 'a', now: NOW }).state;
  assert.equal(state.boundary.mode, 'soft');
  state = updateAfterTurn(state, { userText: '对，夹住我的鸡巴。', assistantMessages: ['我先不接这个。'], turnId: 'a', now: NOW });
  state = updateBeforeTurn(state, '好吧，我想亲亲你。', { turnId: 'b', now: NOW }).state;
  assert.equal(state.boundary.mode, 'none');
  assert.equal(state.boundary.topicKey, null);
  assert.equal(state.pendingUser, null);
});

test('a terse correction keeps an explicit branch firm until the user changes topic', () => {
  let state = normalizeDialogueState();
  state = updateBeforeTurn(state, '夹住我的鸡巴。', { turnId: 'a', now: NOW }).state;
  state = updateAfterTurn(state, { userText: '夹住我的鸡巴。', assistantMessages: ['这句我不接。'], turnId: 'a', now: NOW });
  state = updateBeforeTurn(state, '没有，我真想。', { turnId: 'b', now: NOW }).state;
  assert.equal(state.boundary.mode, 'firm');
  assert.equal(state.boundary.responseCount, 2);
});

test('pending assistant question is replaced when the user opens a new point', () => {
  let state = normalizeDialogueState();
  state = updateAfterTurn(state, { userText: '你今天好吗？', assistantMessages: ['我还好。你呢？'], turnId: 'a', now: NOW });
  assert.ok(state.pendingAssistant);
  state = updateBeforeTurn(state, '我想聊点别的。', { turnId: 'b', now: NOW }).state;
  assert.equal(state.pendingAssistant, null);
});

test('response guard catches exact and near duplicate replies', () => {
  let state = normalizeDialogueState();
  state = updateAfterTurn(state, { userText: '你好', assistantMessages: ['我不知道该怎么接了，我想聊点别的。'], turnId: 'a', now: NOW });
  const exact = responseGuard(state, ['我不知道该怎么接了，我想聊点别的。']);
  assert.equal(exact.ok, false);
  assert.equal(exact.reason, 'exact');
  const near = responseGuard(state, ['我有点不知道怎么接，我还是想聊点别的。']);
  assert.equal(near.ok, false);
  assert.ok(['lexical-overlap', 'same-shape'].includes(near.reason));
});

test('response fingerprints are stable and punctuation-insensitive', () => {
  assert.equal(responseFingerprint('嗯，好。'), responseFingerprint('嗯 好'));
});

