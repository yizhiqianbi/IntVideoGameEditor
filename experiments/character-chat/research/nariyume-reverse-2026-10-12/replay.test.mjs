import test from 'node:test';
import assert from 'node:assert/strict';
import { wordUnits, joinSentences, groupReplySentences, replayPlan } from './replay-core.mjs';

test('a very short first reaction is grouped up to four language units', () => {
  assert.deepEqual(groupReplySentences(['诶。', '先别笑我。', '我有一个主意。', '开一家夜里卖早餐的店。']),
    ['诶。先别笑我。', '我有一个主意。开一家夜里卖早餐的店。']);
  assert.deepEqual(groupReplySentences(['Oh!', 'Wait a second.', 'I have an idea.', 'Let us try it.', 'Here we go.']),
    ['Oh! Wait a second.', 'I have an idea. Let us try it.', 'Here we go.']);
});
test('units count CJK characters and ordinary whitespace-separated words', () => {
  assert.equal(wordUnits('先别笑我。'), 4);
  assert.equal(wordUnits('wait a second'), 3);
  assert.equal(wordUnits('嗯，hi'), 1);
  assert.equal(wordUnits('！？'), 0);
  assert.equal(joinSentences(['你好。', '你来了。']), '你好。你来了。');
  assert.equal(joinSentences(['Hello.', 'Welcome.']), 'Hello. Welcome.');
});
test('no three-bubble quota and no split storage message is implied', () => {
  assert.deepEqual(groupReplySentences([]), []);
  assert.deepEqual(groupReplySentences(['就一句。']), ['就一句。']);
  assert.equal(groupReplySentences(Array(9).fill('这是新句子。')).length, 5);
});
test('text-only timeline uses the observed character reading rates', () => {
  const text = '这是第一句话。后面有另一个主意。最后才补充一句。';
  const yume = replayPlan(text, 'Yume');
  const nari = replayPlan(text, 'Nari');
  assert.equal(yume.cps, 21);
  assert.equal(nari.cps, 19.1);
  assert.equal(yume.chunks[0].startMs, 0);
  assert.ok(nari.durationMs > yume.durationMs);
  assert.equal(yume.simplifiedSentenceLexer, true);
});
