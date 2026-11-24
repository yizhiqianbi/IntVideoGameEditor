// Synthetic local evaluation. Model requests require the explicit --live flag.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../server.mjs';
import { createProvider } from '../provider.mjs';
import { createSession, prepareTurn, commitTurn, initiativeEligibility, commitInitiative } from '../engine.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const args = process.argv.slice(2);
if (args.some(value => !['--live', '--out'].includes(value) && args[args.indexOf(value) - 1] !== '--out')) throw new Error('支持 --live 和 --out PATH。');
const live = args.includes('--live');
const targetIndex = args.indexOf('--out');
if (targetIndex >= 0 && !args[targetIndex + 1]) throw new Error('--out 需要路径。');
const output = resolve(targetIndex >= 0 ? args[targetIndex + 1] : join(ROOT, 'evaluations/results', `initiative-${randomUUID()}.json`));
const files = Object.fromEntries(await Promise.all(['engine.mjs', 'characters.mjs', 'provider.mjs', 'server.mjs'].map(async file => [file, hash(await readFile(join(ROOT, file)))])));
const report = { status: live ? 'running' : 'planned', model: null, reasoningEffort: null, files,
  startedAt: new Date().toISOString(), plannedCalls: 6, actualCalls: 0, steps: [],
  design: '原创中性脚本；正常轮与主动轮分开记录。模拟空闲15秒，无用户存档。角色可以主动保持安静；不做自动活人感评分。' };
let activeStep;
const provider = createProvider(await loadEnvironment(), { fetch: async (url, options) => {
  report.actualCalls += 1;
  activeStep.request = JSON.parse(options.body);
  const response = await globalThis.fetch(url, options);
  if (response.ok) {
    const data = await response.clone().json();
    activeStep.rawContent = data.choices?.[0]?.message?.content;
    activeStep.usage = data.usage ?? null;
  }
  return response;
} });
report.model = provider.publicConfig.model;
report.reasoningEffort = provider.publicConfig.reasoningEffort;
const save = async () => {
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const temporary = `${output}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, output);
};
await save();
if (!live) {
  console.log(JSON.stringify({ status: report.status, model: report.model, reasoningEffort: report.reasoningEffort, plannedCalls: report.plannedCalls, output }, null, 2));
} else {
  if (!provider.publicConfig.configured) throw new Error('模型未配置，本次没有调用。');
  try {
    const normal = async (session, input) => {
      activeStep = { characterId: session.characterId, kind: 'response', input, status: 'pending' };
      report.steps.push(activeStep);
      const begin = performance.now();
      const result = await provider.generate(prepareTurn(session, input), input);
      session = commitTurn(prepareTurn(session, input), input, result, { requestId: randomUUID() });
      Object.assign(activeStep, { status: 'complete', latencyMs: Math.round(performance.now() - begin), result, session });
      await save();
      return session;
    };
    const proactive = async session => {
      // A fixture represents 15 seconds of inactivity; the production browser actually waits.
      session.updatedAt = new Date(Date.parse(session.updatedAt) - 15000).toISOString();
      session.messages.forEach(message => { message.createdAt = new Date(Date.parse(message.createdAt) - 15000).toISOString(); });
      activeStep = { characterId: session.characterId, kind: 'initiative', eligibility: initiativeEligibility(session), status: 'pending' };
      report.steps.push(activeStep);
      if (!activeStep.eligibility.eligible) throw new Error('模拟主动条件未成立。');
      const begin = performance.now();
      const result = await provider.generateInitiative(session);
      const previous = { userCount: session.messages.filter(message => message.role === 'user').length, memories: structuredClone(session.memories), trust: session.state.trust, closeness: session.state.closeness };
      session = commitInitiative(session, result, { requestId: randomUUID() });
      Object.assign(activeStep, { status: 'complete', latencyMs: Math.round(performance.now() - begin), result, session,
        checks: { noFakeUser: session.messages.filter(message => message.role === 'user').length === previous.userCount,
          memoriesUnchanged: JSON.stringify(session.memories) === JSON.stringify(previous.memories),
          relationUnchanged: session.state.trust === previous.trust && session.state.closeness === previous.closeness,
          consumedAnchor: !initiativeEligibility(session).eligible } });
      await save();
      return session;
    };
    let yume = createSession({ characterId: 'yume', mode: 'ai' });
    yume = await normal(yume, '我回来了，刚忙完。今天想听你随便聊点自己的小念头。');
    yume = await proactive(yume);
    yume = await normal(yume, '刚才听着还有点像在完成任务。我想听你自己会冒出来的小情绪，不要分析我。');
    yume = await normal(yume, '叫我阿舟。这次就一句话，不要追问，我先躺一会儿。');
    let nari = createSession({ characterId: 'nari', mode: 'ai' });
    nari = await normal(nari, '你不用等我提问题才聊天。想到什么小事可以自己告诉我，像手机聊天那样说就好。');
    nari = await proactive(nari);
    report.status = 'complete';
  } catch (error) {
    report.status = 'failed';
    report.error = { status: Number.isInteger(error.status) ? error.status : null, message: '评估未完成，已保存完成步骤；检查模型连接、格式与主动条件。' };
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ status: report.status, model: report.model, reasoningEffort: report.reasoningEffort, actualCalls: report.actualCalls, completedSteps: report.steps.filter(step => step.status === 'complete').length, output }, null, 2));
}
