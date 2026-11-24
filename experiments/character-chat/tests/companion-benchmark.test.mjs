import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ANTI_PATTERN_FIXTURE,
  HEALTHY_FIXTURE,
  auditTranscript,
  lexicalSimilarity,
  parseArguments,
  runBenchmark,
} from '../evaluations/companion-benchmark.mjs';

test('benchmark catches repeated proactive bubbles and invented UI observations', () => {
  const report = auditTranscript(ANTI_PATTERN_FIXTURE);
  assert.equal(report.pass, false);
  // This trace is a near duplicate regression; the exact-duplicate gate is
  // exercised separately below by the question-loop case.
  assert.equal(report.checks.noExactDuplicates, true);
  assert.equal(report.checks.noNearDuplicateBursts, false);
  assert.equal(report.checks.noStaleProactiveBursts, false);
  assert.equal(report.checks.noUngroundedObservations, false);
  assert.ok(report.metrics.nearDuplicateCount >= 1);
  assert.ok(report.pairs.staleProactive.length >= 1);
  assert.equal(report.pairs.externalClaims[0].type, 'external-observation');
});

test('direct affection question is not an ungrounded claim by itself', () => {
  const report = auditTranscript([
    { role: 'user', text: '你有在想我吗？' },
    { role: 'assistant', text: '当然想你。刚才看到猫咪视频，第一反应是想发给你。' },
  ]);
  assert.equal(report.metrics.ungroundedClaimCount, 0);
  assert.equal(report.pass, true);
});

test('healthy varied exchange passes the hard repetition gates', () => {
  const report = auditTranscript(HEALTHY_FIXTURE);
  assert.equal(report.pass, true);
  assert.equal(report.metrics.exactDuplicateCount, 0);
  assert.equal(report.metrics.nearDuplicateCount, 0);
  assert.equal(report.metrics.staleProactiveCount, 0);
});

test('question loop is reported when the same question is repeated', () => {
  const report = auditTranscript([
    { role: 'user', text: '我有点累。' },
    { role: 'assistant', text: '你想聊聊吗？' },
    { role: 'assistant', text: '你想聊聊吗？' },
  ]);
  assert.equal(report.checks.noQuestionLoops, false);
  assert.equal(report.metrics.questionLoopCount, 1);
});

test('exact duplicate gate is independent from near-duplicate detection', () => {
  const report = auditTranscript([
    { role: 'assistant', text: '我在呢。' },
    { role: 'assistant', text: '我在呢。' },
  ]);
  assert.equal(report.checks.noExactDuplicates, false);
  assert.equal(report.metrics.exactDuplicateCount, 1);
});

test('initiative keys catch semantic bursts when wording changes', () => {
  const report = auditTranscript([
    { role: 'assistant', kind: 'initiative', intentKey: 'game_coop', text: '我刚打完一局，队友好气人。' },
    { role: 'assistant', kind: 'initiative', intentKey: 'game_coop', text: '突然想起我们可以找时间一起排位。' },
  ]);
  assert.equal(report.checks.noSameIntentBursts, false);
  assert.equal(report.metrics.sameIntentBurstCount, 1);
});

test('offline benchmark defaults to the supplied anti-pattern fixture', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'companion-benchmark-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const out = join(directory, 'report.json');
  const options = parseArguments(['--out', out]);
  const report = await runBenchmark(options);
  assert.equal(report.fixture, 'user-example');
  assert.equal(report.pass, false);
  assert.ok(report.metrics.staleProactiveCount > 0);
  assert.equal((await readFile(out, 'utf8')).includes('external-observation'), true);
  assert.throws(() => parseArguments(['--fixture', 'unknown']), /user-example/);
});

test('similarity remains deterministic for near duplicate wording', () => {
  const first = '下次组队要不要试试？我带你carry，保证不坑。';
  const second = '其实刚在想，下次组队要不要试试？我带你carry，保证不坑。';
  assert.ok(lexicalSimilarity(first, second) >= 0.62);
});
