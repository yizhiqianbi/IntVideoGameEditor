// Revalidate recorded provider text against the current character runtime.
// This script does not import a provider, start a server, or generate new text.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSession, prepareTurn, commitTurn, parseResponse, rearmInitiative,
  initiativeEligibility, commitInitiative, agencyStatus, INITIATIVE_BUDGET,
} from '../engine.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const startedAt = new Date().toISOString();
const sources = [
  'evaluations/results/agency-2026-10-11T18-32-17-904Z.json',
  'evaluations/results/agency-2026-10-11T18-40-28-174Z.json',
];
const codeFiles = ['engine.mjs', 'proactive-runtime.mjs', 'characters.mjs',
  'conversation-direction.mjs', 'provider.mjs', 'evaluations/replay-agency.mjs'];
const hash = value => createHash('sha256').update(value).digest('hex');
const hashes = async paths => Object.fromEntries(await Promise.all(paths.map(async path =>
  [path, hash(await readFile(join(ROOT, path)))])));
const timeAfter = (time, milliseconds) => new Date(Date.parse(time) + milliseconds).toISOString();
const relationship = session => ({ relationship: session.state.relationship,
  trust: session.state.trust, closeness: session.state.closeness });
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error('Network access is disabled for recorded-output replay.');
};
const report = {
  status: 'running', startedAt, actualCalls: 0, networkCalls: 0,
  mode: 'recorded raw model output replay, not a fresh model evaluation',
  design: '两位角色各 normal → 旧续聊预算=3 → 到期具体机会 → initiative → 告别。全部时间由已记录时间和 engine 的 now 注入模拟；时间不证明现实动作或离线送达。另重放一个省略相邻第一人称的历史失败输出。',
  codeHashes: await hashes(codeFiles), sourceCaptureHashes: await hashes(sources),
  originalCaptures: [], steps: [], assertions: [],
};
const check = (label, work) => {
  work();
  report.assertions.push({ label, passed: true });
};
const checkLife = (session, proposal, added, label) => {
  const own = session.agency.threads.find(thread => thread.subject === proposal.life.subject);
  check(`${label}: life accepted`, () => assert.ok(own));
  check(`${label}: own state preserved`, () => assert.equal(own.currentState, proposal.life.state));
  check(`${label}: fictional character scope`, () => assert.equal(own.scope, 'fictional-character'));
  const source = added.find(message => message.id === own.sourceMessageId);
  check(`${label}: state comes from this delivered assistant turn`, () => {
    assert.equal(source?.role, 'assistant');
    assert.ok(source.text.includes(own.currentState));
  });
  return own;
};
const capturedProposal = (step, allowEmpty = false) => {
  assert.equal(step.status, 'complete');
  assert.equal(typeof step.rawContent, 'string');
  return parseResponse(step.rawContent, { currentUserText: step.input, allowEmpty });
};

try {
  const captures = await Promise.all(sources.map(async path => JSON.parse(await readFile(join(ROOT, path), 'utf8'))));
  captures.forEach((capture, index) => report.originalCaptures.push({ path: sources[index],
    model: capture.model, reasoningEffort: capture.reasoningEffort,
    actualCallsInOriginalCapture: capture.actualCalls, recordedSteps: capture.steps.length,
    originalCodeHashes: capture.files }));
  const main = captures[0];
  check('source capture contains exactly six recorded outputs', () => assert.equal(main.steps.length, 6));
  for (const characterId of ['yume', 'nari']) {
    const rows = main.steps.filter(step => step.characterId === characterId);
    check(`${characterId}: recorded three-stage order`, () => assert.deepEqual(rows.map(row => row.kind), ['response', 'life-initiative', 'response']));
    const [normal, initiative, goodbye] = rows;
    const normalProposal = capturedProposal(normal);
    let session = createSession({ characterId, mode: 'ai', now: normal.simulatedTime });
    const openingCount = session.messages.length;
    const openingFacts = { memories: structuredClone(session.memories), relationship: relationship(session) };
    session = commitTurn(prepareTurn(session, normal.input, { now: normal.simulatedTime }),
      normal.input, normalProposal, { now: normal.simulatedTime, requestId: randomUUID() });
    const own = checkLife(session, normalProposal, session.messages.slice(openingCount), `${characterId} normal`);
    check(`${characterId} normal: only the captured user input was added`, () => {
      assert.deepEqual(session.messages.filter(message => message.role === 'user').map(message => message.text), [normal.input]);
    });
    check(`${characterId} normal: no user facts or relationship points were manufactured`, () => {
      assert.deepEqual(session.memories, openingFacts.memories);
      assert.deepEqual(relationship(session), openingFacts.relationship);
    });
    report.steps.push({ characterId, kind: 'normal', sourceCapture: sources[0],
      simulatedTime: normal.simulatedTime, messages: normalProposal.messages,
      life: structuredClone(own), accepted: true });

    // This fixture isolates the independent concrete-event budget. No generic
    // model attempts are made or presented as real history.
    session.initiative = { ...session.initiative, budgetUsed: INITIATIVE_BUDGET, pending: null };
    const beforeClock = structuredClone(session);
    const armAt = timeAfter(own.notBefore, 1);
    agencyStatus(session, { now: armAt });
    check(`${characterId}: reading due time does not fabricate completed progress`, () => assert.deepEqual(session, beforeClock));
    session = rearmInitiative(session, { now: armAt });
    const readyAt = timeAfter(session.initiative.pending.notBefore, 1);
    check(`${characterId}: replay clock matches captured initiative time`, () => assert.equal(readyAt, initiative.simulatedTime));
    const eligible = initiativeEligibility(session, { now: readyAt });
    check(`${characterId}: concrete opportunity works after generic budget is spent`, () => {
      assert.equal(session.initiative.budgetUsed, INITIATIVE_BUDGET);
      assert.equal(eligible.eligible, true);
      assert.equal(eligible.opportunity?.subject, own.subject);
      assert.equal(eligible.opportunity?.revision, own.revision);
      assert.equal(eligible.opportunity?.currentState, own.currentState);
    });
    const baseline = { messageCount: session.messages.length,
      users: session.messages.filter(message => message.role === 'user'),
      memories: structuredClone(session.memories), relationship: relationship(session) };
    const initiativeProposal = capturedProposal(initiative, true);
    session = commitInitiative(session, initiativeProposal, { now: readyAt, requestId: randomUUID() });
    const added = session.messages.slice(baseline.messageCount);
    const progressed = checkLife(session, initiativeProposal, added, `${characterId} initiative`);
    check(`${characterId}: captured progress updates the existing concern`, () => {
      assert.equal(progressed.id, own.id);
      assert.equal(progressed.revision, own.revision + 1);
      assert.notEqual(progressed.currentState, own.currentState);
    });
    check(`${characterId}: opportunity is consumed once`, () => {
      const entries = session.agency.ledger.filter(item => item.opportunityId === eligible.opportunity.id);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].outcome, 'sent');
      assert.equal(progressed.lastDeliveredRevision, own.revision);
    });
    check(`${characterId} initiative: no fake user, user memory, or relationship gain`, () => {
      assert.deepEqual(session.messages.filter(message => message.role === 'user'), baseline.users);
      assert.deepEqual(session.memories, baseline.memories);
      assert.deepEqual(relationship(session), baseline.relationship);
      assert.ok(added.every(message => message.role === 'assistant' && message.kind === 'initiative'));
    });
    report.steps.push({ characterId, kind: 'initiative', sourceCapture: sources[0],
      fixture: 'generic budget=3; no synthetic generic messages or provider calls', armAt,
      simulatedTime: readyAt, opportunity: eligible.opportunity,
      messages: initiativeProposal.messages, life: structuredClone(progressed),
      consumedLedgerEntry: session.agency.ledger.find(item => item.opportunityId === eligible.opportunity.id) });

    const farewellTime = timeAfter(readyAt, 1000);
    check(`${characterId}: replay clock matches captured farewell time`, () => assert.equal(farewellTime, goodbye.simulatedTime));
    const farewellProposal = capturedProposal(goodbye);
    const beforeFarewellCount = session.messages.length;
    session = commitTurn(prepareTurn(session, goodbye.input, { now: farewellTime }),
      goodbye.input, farewellProposal, { now: farewellTime, requestId: randomUUID() });
    const farewellMessages = session.messages.slice(beforeFarewellCount).filter(message => message.role === 'assistant');
    check(`${characterId}: farewell is one bubble without a follow-up question`, () => {
      assert.equal(farewellMessages.length, 1);
      assert.equal(farewellMessages[0].text, '再见。');
    });
    check(`${characterId}: actual farewell pauses contact and removes pending work`, () => {
      assert.equal(session.initiative.pausedUntilUser, true);
      assert.equal(session.initiative.pending, null);
      const later = rearmInitiative(session, { now: timeAfter(farewellTime, 3600000) });
      assert.equal(later.initiative.pending, null);
      assert.equal(initiativeEligibility(later, { now: timeAfter(farewellTime, 3600000) }).reason, 'paused');
    });
    report.steps.push({ characterId, kind: 'quiet-close', sourceCapture: sources[0],
      simulatedTime: farewellTime, input: goodbye.input, messages: farewellMessages.map(message => message.text),
      pausedUntilUser: session.initiative.pausedUntilUser, pending: session.initiative.pending,
      agency: structuredClone(session.agency) });
  }

  const regression = captures[1].steps[0];
  const regressionProposal = capturedProposal(regression);
  let corrected = createSession({ characterId: regression.characterId, mode: 'ai', now: regression.simulatedTime });
  const beforeCount = corrected.messages.length;
  corrected = commitTurn(prepareTurn(corrected, regression.input, { now: regression.simulatedTime }),
    regression.input, regressionProposal, { now: regression.simulatedTime, requestId: randomUUID() });
  const repairedLife = checkLife(corrected, regressionProposal, corrected.messages.slice(beforeCount), 'clipped first-person historical output');
  check('historical clipped-subject output used to be rejected', () => assert.equal(captures[1].steps[0].agency.threads.length, 0));
  report.steps.push({ characterId: regression.characterId, kind: 'clipped-subject-regression',
    sourceCapture: sources[1], simulatedTime: regression.simulatedTime,
    messages: regressionProposal.messages, originalAccepted: false,
    acceptedByCurrentEngine: true, life: repairedLife });

  // Explicitly labeled synthetic attribution controls reuse the captured state
  // but change its speaker. They are not counted as recorded model outputs.
  for (const prefix of ['小林的原话是：', '你的原话是：']) {
    const state = regressionProposal.life.state;
    const fresh = createSession({ characterId: 'nari', mode: 'ai', now: regression.simulatedTime });
    const foreign = commitTurn(prepareTurn(fresh, '我在转述一句话。', { now: regression.simulatedTime }),
      '我在转述一句话。', { messages: [prefix + state], emotion: 'friendly', life: regressionProposal.life },
      { now: regression.simulatedTime, requestId: randomUUID() });
    check(`synthetic ownership boundary ${prefix}`, () => {
      assert.equal(foreign.agency.threads.length, 0);
      assert.equal(foreign.memories.length, 0);
      assert.deepEqual(relationship(foreign), relationship(fresh));
    });
  }
  check('recorded replay makes zero network calls', () => assert.equal(networkCalls, 0));
  const sourceHashesAfter = await hashes(sources);
  check('source captures remain unchanged', () => assert.deepEqual(sourceHashesAfter, report.sourceCaptureHashes));
  const codeHashesAfter = await hashes(codeFiles);
  check('code hashes remain frozen throughout replay', () =>
    assert.deepEqual(codeHashesAfter, report.codeHashes, 'runtime changed during replay; rerun against a frozen build'));
  report.status = 'complete';
  report.recordedOutputsReplayed = 7;
  report.primaryRecordedOutputsReplayed = 6;
  report.networkCalls = networkCalls;
  report.assertionsPassed = report.assertions.length;
  report.finishedAt = new Date().toISOString();
} catch (error) {
  report.status = 'failed';
  report.networkCalls = networkCalls;
  report.error = { name: error.name, message: error.message, stack: error.stack };
  report.finishedAt = new Date().toISOString();
  process.exitCode = 1;
}
const output = join(ROOT, 'evaluations', 'results', `agency-replay-${startedAt.replace(/[:.]/g, '-')}.json`);
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ status: report.status, recordedOutputsReplayed: report.recordedOutputsReplayed ?? 0,
  assertionsPassed: report.assertionsPassed ?? 0, actualCalls: report.actualCalls,
  networkCalls: report.networkCalls, output: relative(ROOT, output), error: report.error?.message }, null, 2));
