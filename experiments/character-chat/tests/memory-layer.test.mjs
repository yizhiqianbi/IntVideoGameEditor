import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, commitTurn, prepareTurn } from '../engine.mjs';
import { ensureMemoryState, recordMemoryEvidence, retrieveMemory, timeDecay, closeOpenLoops } from '../memory-layer.mjs';

const NOW = '2026-10-16T12:00:00.000Z';

test('EbbingFlow-lite keeps source evidence and creates an open loop for plans', () => {
  const session = createSession({ characterId: 'nari', mode: 'ai', now: NOW });
  ensureMemoryState(session);
  const userMessage = { id: 'user-1', role: 'user', text: '我明天要去面试。', createdAt: NOW };
  session.messages.push(userMessage);
  const memory = { id: 'memory-1', text: '我明天要去面试', category: 'plan', source: 'user', quote: '我明天要去面试', messageId: userMessage.id, createdAt: NOW, updatedAt: NOW };
  session.memories.push(memory);
  recordMemoryEvidence(session, { text: userMessage.text, message: userMessage, memories: [memory], now: NOW });

  assert.equal(session.memoryEvents.length, 1);
  assert.equal(session.memoryEvents[0].sourceMessageId, userMessage.id);
  assert.equal(session.memoryEvents[0].memoryClass, 'plan');
  assert.equal(session.openLoops[0].status, 'open');
  assert.equal(session.openLoops[0].sourceMessageId, userMessage.id);
  const recalled = retrieveMemory(session, '明天面试怎么样？', { now: NOW });
  assert.equal(recalled[0].sourceMessageId, userMessage.id);
  assert.equal(recalled[0].memoryClass, 'plan');
  closeOpenLoops(session, '面试回来啦，结果还不错。', '2026-10-17T12:00:00.000Z');
  assert.equal(session.openLoops[0].status, 'resolved');
});

test('high-confidence facts decay slowly while low-confidence observations can disappear', () => {
  const now = '2026-10-16T12:00:00.000Z';
  const old = '2026-04-19T12:00:00.000Z';
  const stable = timeDecay({ memoryClass: 'identity', confidence: 0.95, createdAt: old }, now);
  const uncertain = timeDecay({ memoryClass: 'conversation', confidence: 0.4, createdAt: old }, now);
  assert.ok(stable >= 0.25);
  assert.ok(uncertain < stable);
});

test('committing a turn persists memory evidence without changing the dialogue contract', () => {
  const session = createSession({ characterId: 'nari', mode: 'ai', now: NOW });
  const text = '我喜欢雨天，明天要去面试。';
  const prepared = prepareTurn(session, text, { now: NOW });
  const committed = commitTurn(prepared, text, {
    messages: ['那你面试回来告诉我一声。'],
    emotion: 'friendly',
    memories: [
      { text: '我喜欢雨天', category: 'preference', quote: '我喜欢雨天' },
      { text: '明天要去面试', category: 'plan', quote: '明天要去面试' },
    ],
  }, { now: NOW });
  assert.equal(committed.memoryEvents.length, 2);
  assert.equal(committed.openLoops.length, 1);
  assert.equal(committed.memoryEvents.every(item => item.sourceMessageId), true);
  assert.equal(committed.messages.at(-1).text, '那你面试回来告诉我一声。');
});
