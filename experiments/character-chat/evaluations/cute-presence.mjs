// Synthetic conversations only. Loading credentials and calling a model requires --live.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureProviderCall } from './provider-capture.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_FILES = ['engine.mjs', 'characters.mjs', 'provider.mjs', 'server.mjs'];
const SCRIPTS = Object.freeze({
  yume: [
    '来啦', '嘿嘿', '你怎么这么乖', '今天想听你撒个娇，别安排小游戏', '嗯，然后呢',
    '我叫林舟，叫我阿舟，我喜欢喝乌龙茶', '别再聊吃的了，换题',
    '如果我现在不说话，你会想做什么', '这次别撒娇，把“我晚点到”改得礼貌点',
    '好了，软回来', '你记得我的称呼与饮料吗？未知的别猜', '晚安，我先睡了',
  ],
  nari: ['嗨', '想你啦', '你自己也说点，不用等我问', '嗯', '有一点无聊诶', '抱一下，就一句', '那个话题算了，别继续', '我去忙了'],
});
const hash = value => createHash('sha256').update(value).digest('hex');
const timestamp = () => new Date().toISOString();
const issue = (code, message, httpStatus) => Object.assign(new Error(message), { evaluationCode: code, ...(httpStatus ? { httpStatus } : {}) });
const safeError = error => error?.evaluationCode
  ? { code: error.evaluationCode, message: error.message, ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}) }
  : { code: 'EVALUATION_FAILED', message: '评估未完成，已保存完成步骤；检查版本模块、模型连接与输出格式。' };

export function parseArguments(args) {
  const options = { live: false, directory: ROOT, character: 'yume', scenario: 'natural' };
  for (let i = 0; i < args.length; i += 1) {
    const argument = args[i];
    if (argument === '--live') options.live = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (['--directory', '--character', '--out', '--scenario'].includes(argument)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw issue('INVALID_ARGUMENT', `${argument} 需要一个值。`);
      options[argument.slice(2)] = value;
    } else throw issue('INVALID_ARGUMENT', '包含未知选项；运行 --help 查看支持的选项。');
  }
  if (!['yume', 'nari'].includes(options.character)) throw issue('INVALID_ARGUMENT', '--character 必须为 yume 或 nari。');
  if (!['natural', 'initiative'].includes(options.scenario)) throw issue('INVALID_ARGUMENT', '--scenario 必须为 natural 或 initiative。');
  options.directory = resolve(options.directory);
  if (options.out) options.out = resolve(options.out);
  return options;
}

async function atomicSave(path, report) {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

async function loadVersion(directory) {
  let sources;
  try { sources = await Promise.all(SOURCE_FILES.map(file => readFile(join(directory, file)))); }
  catch { throw issue('VERSION_UNAVAILABLE', '版本目录必须包含 engine.mjs、characters.mjs、provider.mjs 和 server.mjs。'); }
  let engine;
  try { engine = await import(pathToFileURL(join(directory, 'engine.mjs')).href); }
  catch { throw issue('VERSION_UNAVAILABLE', '版本 engine.mjs 无法加载。'); }
  const after = await Promise.all(SOURCE_FILES.map(file => readFile(join(directory, file))));
  if (sources.some((source, index) => !source.equals(after[index]))) throw issue('VERSION_CHANGED', '版本文件在加载时改变了，请重新运行。');
  const files = Object.fromEntries(SOURCE_FILES.map((file, index) => [file, hash(sources[index])]));
  // Optional dependencies keep older single-stage snapshots comparable.
  for (const file of ['streaming.mjs', 'conversation-direction.mjs', 'planner.mjs', 'replyer-context.mjs',
    'companion-runtime.mjs', 'dialogue-state.mjs', 'memory-layer.mjs', 'proactive-runtime.mjs']) {
    try { files[file] = hash(await readFile(join(directory, file))); }
    catch (error) { if (error.code !== 'ENOENT') throw issue('VERSION_UNAVAILABLE', `版本 ${file} 无法读取。`); }
  }
  const runtime = files['companion-runtime.mjs'] ? await import(pathToFileURL(join(directory, 'companion-runtime.mjs')).href) : null;
  return { engine, runtime, metadata: { directory, files, sha256: hash(JSON.stringify(files)) } };
}

function sourceChecks(session) {
  return {
    revision: session.revision, state: session.state, style: session.style ?? null,
    closedTopics: session.closedTopics ?? null, initiative: session.initiative ?? null,
    characterBeat: session.characterBeat ?? null,
    memorySources: session.memories.map(memory => {
      const source = session.messages.find(message => message.id === memory.messageId);
      return { id: memory.id, source: memory.source, quote: memory.quote, messageId: memory.messageId,
        sourceFound: Boolean(source), quoteFoundInUserMessage: Boolean(source?.role === 'user' && memory.quote && source.text.includes(memory.quote)) };
    }),
  };
}

export async function runEvaluation(options, { fetch: doFetch = globalThis.fetch, signal = new AbortController().signal, environment } = {}) {
  const { engine, runtime, metadata } = await loadVersion(options.directory);
  if (options.scenario === 'initiative' && typeof engine.rearmInitiative !== 'function') throw issue('VERSION_UNSUPPORTED', 'initiative 场景需要支持主动计划的 engine 版本。');
  const output = options.out ?? (options.live ? join(ROOT, 'evaluations/results', `cute-${options.character}-${options.scenario}-${randomUUID()}.json`) : null);
  const start = timestamp();
  let clock = Date.parse(start);
  const at = () => new Date(clock).toISOString();
  const advance = milliseconds => { clock += milliseconds; return at(); };
  let session = engine.createSession({ characterId: options.character, mode: 'ai', now: at() });
  const report = {
    schemaVersion: 2, evaluation: 'cute-character-presence', id: randomUUID(), status: options.live ? 'running' : 'planned',
    startedAt: start, finishedAt: null, model: null, parameters: null, version: metadata,
    scenario: options.scenario, character: options.character, fixtureTime: { start, timeZone: 'Asia/Shanghai', simulatedClock: true },
    design: '原创中性脚本；只使用合成会话。主动轮推进虚拟时钟至实际计划 due，不修改历史时间、不添加用户消息、不强制模型续聊。不做自动可爱或活人感评分。',
    plannedTurns: options.scenario === 'natural' ? SCRIPTS[options.character].length : 5,
    plannedCalls: (options.scenario === 'natural' ? SCRIPTS[options.character].length : 5) * (metadata.files['planner.mjs'] ? 2 : 1),
    plannedCallsAreEstimate: true,
    actualCalls: 0, steps: [], checks: [], initialSession: structuredClone(session), finalSession: structuredClone(session), ...(output ? { output } : {}),
    plan: options.scenario === 'natural' ? SCRIPTS[options.character] : ['opening: 最多两次到期计划', 'foreground: 我来了，你想到什么也可以自己说。', 'foreground 后最多两次到期计划', '休息停止；新用户替换旧计划（不请求模型）'],
  };
  if (!options.live) {
    const first = SCRIPTS[options.character][0];
    engine.buildMessages(engine.prepareTurn(session, first, { now: at() }), first);
    await atomicSave(output, report);
    return report;
  }
  // Only the explicit live branch imports configuration loaders or reads environment files.
  const [{ loadEnvironment }, { createProvider }] = await Promise.all([
    import(pathToFileURL(join(ROOT, 'server.mjs')).href), import(pathToFileURL(join(options.directory, 'provider.mjs')).href),
  ]);
  let activeStep;
  const provider = createProvider(environment ?? await loadEnvironment(), { fetch: (url, request) => captureProviderCall({
    report, step: activeStep, url, request, fetch: doFetch, save: () => atomicSave(output, report),
  }) });
  if (!provider.publicConfig.configured) throw issue('MODEL_NOT_CONFIGURED', '没有有效模型配置；本次没有调用模型。');
  report.model = provider.publicConfig.model;
  report.reasoningEffort = provider.publicConfig.reasoningEffort ?? null;
  report.architecture = provider.publicConfig.architecture ?? 'single-replyer';
  report.plannedCalls = report.plannedTurns * (report.architecture === 'planner-replyer' ? 2 : 1);
  await atomicSave(output, report);

  const execute = async (kind, input) => {
    if (signal.aborted) throw issue('ABORTED', '运行已中断。');
    const before = structuredClone(session);
    const step = { number: report.steps.length + 1, kind, input: input ?? null, fixtureTime: at(), status: 'pending', startedAt: timestamp(), beforeSession: before };
    activeStep = step;
    report.steps.push(step);
    const prepared = kind === 'response' ? engine.prepareTurn(session, input, { now: at() }) : session;
    await atomicSave(output, report);
    const begin = performance.now();
    try {
      const result = kind === 'response'
        ? await provider.generate(prepared, input, { signal, now: at() })
        : await provider.generateInitiative(session, { signal, now: at() });
      session = kind === 'response'
        ? engine.commitTurn(prepared, input, result, { requestId: randomUUID(), now: at() })
        : engine.commitInitiative(session, result, { requestId: randomUUID(), now: at() });
      if (runtime) session = kind === 'response' ? runtime.recordDecision(session, result.control, { now: at() })
        : runtime.applyInitiativeDecision(session, before, result.control, { now: at() });
      Object.assign(step, { status: 'complete', result, session: structuredClone(session), sourceChecks: sourceChecks(session) });
      if (kind === 'initiative') {
        step.checks = {
          noFakeUser: session.messages.filter(message => message.role === 'user').length === before.messages.filter(message => message.role === 'user').length,
          memoriesUnchanged: JSON.stringify(session.memories) === JSON.stringify(before.memories),
          relationUnchanged: session.state.trust === before.state.trust && session.state.closeness === before.state.closeness && session.state.relationship === before.state.relationship,
          styleUnchanged: JSON.stringify(session.style) === JSON.stringify(before.style),
        };
        if (Object.values(step.checks).some(value => !value)) throw issue('SOURCE_CHECK_FAILED', '主动轮改变了用户来源或关系状态。');
      }
      report.finalSession = structuredClone(session);
    } catch (error) {
      step.status = 'failed'; step.error = safeError(error); throw error;
    } finally {
      step.latencyMs = Math.round(performance.now() - begin); step.finishedAt = timestamp(); await atomicSave(output, report);
    }
  };

  const twoDuePlans = async phase => {
    for (let index = 0; index < 2; index += 1) {
      const pending = session.initiative?.pending;
      if (!pending) { report.checks.push({ phase, attempt: index + 1, result: 'no-pending-plan', modelChoseStop: index > 0 }); break; }
      clock = Math.max(clock, Date.parse(pending.notBefore) + 1);
      const eligibility = engine.initiativeEligibility(session, { now: at() });
      if (!eligibility.eligible) throw issue('INITIATIVE_NOT_READY', '已到期的主动计划未满足资格条件。');
      report.checks.push({ phase, attempt: index + 1, fixtureTime: at(), eligibility });
      await execute('initiative');
    }
  };
  try {
    if (options.scenario === 'natural') {
      for (const input of SCRIPTS[options.character]) { advance(60000); await execute('response', input); }
    } else {
      session = engine.rearmInitiative(session, { now: at() });
      report.initialSession = structuredClone(session);
      await twoDuePlans('opening');
      advance(60000);
      await execute('response', '我来了，你想到什么也可以自己说。');
      await twoDuePlans('after-foreground');
      const oldPlan = structuredClone(session.initiative?.pending ?? null);
      advance(1000);
      const rest = '晚安，我先睡了。';
      const rested = engine.commitTurn(engine.prepareTurn(session, rest, { now: at() }), rest,
        { messages: ['晚安，睡好。'], emotion: 'calm', followUp: { intent: '不应在休息时执行', delaySeconds: 12 } }, { requestId: randomUUID(), now: at() });
      const rearmedRest = engine.rearmInitiative(rested, { now: advance(360000) });
      const quiet = engine.initiativeEligibility(rearmedRest, { now: at() });
      const returning = '我回来了，接着聊。';
      const returned = engine.commitTurn(engine.prepareTurn(rearmedRest, returning, { now: at() }), returning,
        { messages: ['回来啦。'], emotion: 'friendly', followUp: { intent: '一个新想法', delaySeconds: 20 } }, { requestId: randomUUID(), now: at() });
      report.checks.push({ phase: 'synthetic-stop-and-replacement', noModelCalls: true,
        oldPlanId: oldPlan?.id ?? null, quietEligibility: quiet, quietStayedPaused: quiet.reason === 'paused',
        quietHasNoPlan: !rearmedRest.initiative?.pending,
        userResetBudget: returned.initiative?.budgetUsed === 0,
        newPlanReplacedOld: Boolean(returned.initiative?.pending?.id) && returned.initiative.pending.id !== oldPlan?.id,
      });
      if (!report.checks.at(-1).quietStayedPaused || !report.checks.at(-1).quietHasNoPlan || !report.checks.at(-1).userResetBudget || !report.checks.at(-1).newPlanReplacedOld) throw issue('STOP_CHECK_FAILED', '休息或新用户计划替换回归检查失败。');
      report.syntheticCheckSessions = { rested: rearmedRest, returned };
    }
    report.status = 'complete'; report.finishedAt = timestamp(); await atomicSave(output, report); return report;
  } catch (error) {
    report.status = signal.aborted ? 'aborted' : 'failed'; report.error = safeError(error); report.finishedAt = timestamp();
    await atomicSave(output, report); throw Object.assign(issue(report.error.code, report.error.message, report.error.httpStatus), { output });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) process.stdout.write('node evaluations/cute-presence.mjs [--directory PATH] [--character yume|nari] [--scenario natural|initiative] [--out PATH] [--live]\n默认只生成计划，不加载模型凭据或调用 API。--live 每步原子保存请求正文、原始输出、usage、耗时、来源状态和模块哈希。\n');
    else {
      const report = await runEvaluation(options, { signal: controller.signal });
      process.stdout.write(`${JSON.stringify({ status: report.status, character: report.character, scenario: report.scenario, model: report.model, plannedCalls: report.plannedCalls, actualCalls: report.actualCalls, completedSteps: report.steps.filter(step => step.status === 'complete').length, output: report.output ?? null }, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ...safeError(error), ...(error.output ? { output: error.output } : {}) })}\n`);
    process.exitCode = controller.signal.aborted ? 130 : 1;
  }
}
