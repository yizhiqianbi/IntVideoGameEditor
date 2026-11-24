// Bounded synthetic evaluation; simulated time is not background delivery.
// No user's stored session is loaded. Model calls require --live.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../server.mjs';
import { createProvider } from '../provider.mjs';
import { createSession, prepareTurn, commitTurn, rearmInitiative, initiativeEligibility, commitInitiative } from '../engine.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const live = process.argv.includes('--live');
const characterIndex = process.argv.indexOf('--character');
const characters = characterIndex < 0 ? ['yume', 'nari'] : [process.argv[characterIndex + 1]];
if (characters.some(id => !['yume', 'nari'].includes(id))) throw new Error('--character 仅支持 yume 或 nari。');
const output = join(root, 'evaluations/results', `agency-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const report = {
  status: live ? 'running' : 'planned', startedAt: new Date().toISOString(), plannedCalls: characters.length * 3, actualCalls: 0,
  design: '两位角色各一次自主事项、一次具体主动机会、一次告别。模拟时间及旧续聊预算耗尽；不证明真实离线送达。不自动打可爱分。',
  steps: [], files: {},
};
for (const file of ['engine.mjs', 'proactive-runtime.mjs', 'provider.mjs', 'characters.mjs']) {
  report.files[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex');
}
let step;
const provider = createProvider(await loadEnvironment(), { fetch: async (url, options) => {
  if (++report.actualCalls > report.plannedCalls) throw new Error('评估请求预算已用尽。');
  const request = JSON.parse(options.body);
  step.parameters = { model: request.model, temperature: request.temperature, reasoning: request.reasoning };
  const response = await fetch(url, options);
  if (response.ok) {
    const data = await response.clone().json();
    step.rawContent = data.choices?.[0]?.message?.content;
    step.usage = data.usage || null;
  }
  return response;
} });
Object.assign(report, { model: provider.publicConfig.model, reasoningEffort: provider.publicConfig.reasoningEffort });
const save = async () => {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
};
const normal = async (session, text, now) => {
  step = { characterId: session.characterId, kind: 'response', input: text, simulatedTime: now, status: 'running' };
  report.steps.push(step);
  const prepared = prepareTurn(session, text, { now });
  const begin = performance.now();
  const result = await provider.generate(prepared, text);
  const committed = commitTurn(prepared, text, result, { requestId: randomUUID(), now });
  Object.assign(step, { status: 'complete', latencyMs: Math.round(performance.now() - begin), result,
    agency: committed.agency, pausedUntilUser: committed.initiative.pausedUntilUser });
  await save();
  return committed;
};
await save();
if (live) {
  if (!provider.publicConfig.configured) throw new Error('模型未配置，没有调用。');
  try {
    for (const characterId of characters) {
      const start = new Date().toISOString();
      let session = createSession({ characterId, mode: 'ai', now: start });
      const input = characterId === 'yume'
        ? '我想听你自己的事。给自己留十分钟，挑件你真想做的小事去做呀；待会有变化再告诉我，别把决定都丢给我。'
        : '今天你有没有什么自己想做的？不用一直围着我，挑个小小的愿望去做，待会有进展再告诉我就好。';
      session = await normal(session, input, start);
      const thread = session.agency?.threads?.find(item => item.status === 'active' || item.status === 'waiting');
      if (!thread) throw new Error(`${characterId} 没建立有对白来源的生活事项。`);
      // Isolate the new event layer from the old three delayed continuations.
      session.initiative = { ...session.initiative, budgetUsed: 3, pending: null };
      let now = new Date(Math.max(Date.parse(thread.notBefore) + 1, Date.parse(start) + 121000)).toISOString();
      session = rearmInitiative(session, { now });
      let eligibility = initiativeEligibility(session, { now });
      if (!eligibility.eligible && eligibility.reason === 'waiting') {
        now = new Date(Date.parse(eligibility.nextAt) + 1).toISOString();
        eligibility = initiativeEligibility(session, { now });
      }
      step = { characterId, kind: 'life-initiative', status: 'running', simulatedTime: now, opportunityId: session.initiative.pending?.opportunityId,
        eligibility, beforeAgency: structuredClone(session.agency), fixture: '旧续聊budget=3，仅隔离验证具体生活机会' };
      report.steps.push(step);
      if (!eligibility.eligible || !session.initiative.pending?.opportunityId) throw new Error(`${characterId} 的具体生活机会未被选中。`);
      const before = { users: session.messages.filter(item => item.role === 'user').length,
        memories: JSON.stringify(session.memories), trust: session.state.trust, closeness: session.state.closeness };
      const begin = performance.now();
      const result = await provider.generateInitiative(session, { now });
      session = commitInitiative(session, result, { requestId: randomUUID(), now });
      Object.assign(step, { status: 'complete', latencyMs: Math.round(performance.now() - begin), result,
        afterAgency: session.agency, checks: {
          noFakeUser: before.users === session.messages.filter(item => item.role === 'user').length,
          memoriesUnchanged: before.memories === JSON.stringify(session.memories),
          relationshipUnchanged: before.trust === session.state.trust && before.closeness === session.state.closeness,
          consumedOpportunity: session.agency.ledger.some(item => item.opportunityId === step.opportunityId),
          lifeProgressRecorded: !result.life || result.messages.length === 0 || session.agency.threads.some(item =>
            item.currentState === result.life.state && session.messages.some(message => message.id === item.sourceMessageId && message.turnId === session.receipts.at(-1)?.requestId)),
        }, humanReview: '查看是否沿自身事项贡献新一步、语气自然，未用催回复填充。' });
      await save();
      if (Object.values(step.checks).some(value => value !== true)) throw new Error(`${characterId} 的主动提交检查失败；查看保存的 checks。`);
      const closeAt = new Date(Date.parse(now) + 1000).toISOString();
      session = await normal(session, '好，这件事先不聊了。我去忙了，这次只说一句再见，不要追问。', closeAt);
      step.checks = { paused: session.initiative.pausedUntilUser === true, oneBubble: step.result.messages.length === 1,
        noPending: session.initiative.pending === null };
      await save();
      if (Object.values(step.checks).some(value => value !== true)) throw new Error(`${characterId} 的告别检查失败。`);
    }
    report.status = 'complete';
  } catch (error) {
    report.status = 'failed';
    report.error = { message: String(error.message).slice(0, 250) };
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  await save();
}
console.log(JSON.stringify({ status: report.status, model: report.model, reasoningEffort: report.reasoningEffort,
  actualCalls: report.actualCalls, completedSteps: report.steps.filter(item => item.status === 'complete').length, output }, null, 2));
