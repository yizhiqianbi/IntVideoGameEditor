// Synthetic conversations only; no user archive is loaded. Paid model calls require --live.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureProviderCall } from './provider-capture.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_FILES = ['engine.mjs', 'characters.mjs', 'conversation-direction.mjs', 'provider.mjs', 'streaming.mjs', 'server.mjs'];
export const SCRIPTS = Object.freeze({
  yume: Object.freeze([
    '嘿嘿', '你先说点', '嗯，然后呢', '换个话题吧',
    '如果我们开一家奇怪的小店，你会怎么设计？',
    '今天组队时有人总把锅甩给队友，你怎么看？',
  ]),
  nari: Object.freeze([
    '嗯，你先说点', '再说一点', '然后呢', '换个话题吧',
    '我喜欢那种很热闹又不拥挤的街道，你觉得设计上怎么做到？',
    '如果给“没说出口的话”做一个地方，你会设计成什么？',
  ]),
});
export const REPEATED_INPUT = '有点无聊，你说点你自己的想法吧';
const hash = value => createHash('sha256').update(value).digest('hex');
const timestamp = () => new Date().toISOString();
const issue = (code, message) => Object.assign(new Error(message), { evaluationCode: code });
const safeError = error => error?.evaluationCode
  ? { code: error.evaluationCode, message: error.message }
  : { code: 'EVALUATION_FAILED', message: '评估未完成，已保留完成步骤；检查模块、模型连接与输出格式。' };

export function parseArguments(args) {
  const options = { live: false, directory: ROOT, character: 'yume' };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--live') options.live = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (['--directory', '--character', '--out'].includes(argument)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw issue('INVALID_ARGUMENT', `${argument} 需要一个值。`);
      options[argument.slice(2)] = value;
    } else throw issue('INVALID_ARGUMENT', '包含未知选项；运行 --help 查看支持的选项。');
  }
  if (!['yume', 'nari'].includes(options.character)) throw issue('INVALID_ARGUMENT', '--character 必须为 yume 或 nari。');
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
  catch { throw issue('VERSION_UNAVAILABLE', `版本目录必须包含 ${SOURCE_FILES.join('、')}。`); }
  let engine;
  try { engine = await import(pathToFileURL(join(directory, 'engine.mjs')).href); }
  catch { throw issue('VERSION_UNAVAILABLE', '版本 engine.mjs 无法加载。'); }
  const after = await Promise.all(SOURCE_FILES.map(file => readFile(join(directory, file))));
  if (sources.some((source, index) => !source.equals(after[index]))) throw issue('VERSION_CHANGED', '版本文件在加载时改变了，请使用固定快照重新运行。');
  const files = Object.fromEntries(SOURCE_FILES.map((file, index) => [file, hash(sources[index])]));
  for (const file of ['planner.mjs', 'replyer-context.mjs', 'companion-runtime.mjs', 'dialogue-state.mjs', 'memory-layer.mjs', 'proactive-runtime.mjs']) {
    try { files[file] = hash(await readFile(join(directory, file))); }
    catch (error) { if (error.code !== 'ENOENT') throw issue('VERSION_UNAVAILABLE', `版本 ${file} 无法读取。`); }
  }
  return { engine, metadata: { directory, files, sha256: hash(JSON.stringify(files)) } };
}

function sourceChecks(session) {
  return {
    revision: session.revision, state: session.state, style: session.style,
    closedTopics: session.closedTopics, characterBeat: session.characterBeat,
    memorySources: session.memories.map(memory => {
      const source = session.messages.find(message => message.id === memory.messageId);
      return { id: memory.id, source: memory.source, quote: memory.quote, messageId: memory.messageId,
        sourceFound: Boolean(source), quoteFoundInUserMessage: Boolean(source?.role === 'user' && memory.quote && source.text.includes(memory.quote)) };
    }),
  };
}

function promptDirection(messages) {
  for (const message of messages) {
    if (message.role !== 'system') continue;
    const match = message.content.match(/<context_data>([\s\S]*?)<\/context_data>/u);
    if (!match) continue;
    try { return JSON.parse(match[1]).conversationDirection ?? null; }
    catch { return null; }
  }
  return null;
}

export async function runEvaluation(options, { fetch: doFetch = globalThis.fetch, signal = new AbortController().signal, environment } = {}) {
  const { engine, metadata } = await loadVersion(options.directory);
  const output = options.out ?? (options.live ? join(ROOT, 'evaluations/results', `diversity-${options.character}-${randomUUID()}.json`) : null);
  const startedAt = timestamp();
  let clock = Date.parse(startedAt);
  const at = () => new Date(clock).toISOString();
  const make = () => engine.createSession({ characterId: options.character, mode: 'ai', now: at() });
  const report = {
    schemaVersion: 2, evaluation: 'character-conversation-diversity', id: randomUUID(),
    status: options.live ? 'running' : 'planned', startedAt, finishedAt: null,
    model: null, parameters: null, version: metadata, character: options.character,
    fixtureTime: { start: startedAt, timeZone: 'Asia/Shanghai', simulatedClock: true },
    design: '合成会话：6 轮低信息、换题与具体讨论，再独立开局重复同一个开放输入 3 次。保留完整上下文和原始输出供人工比较；不将题材标签或消息条数当作可爱/多样性评分。',
    plannedTurns: 9, plannedCalls: metadata.files['planner.mjs'] ? 18 : 9, plannedCallsAreEstimate: true,
    actualCalls: 0, steps: [], conversations: [],
    plan: { conversation: SCRIPTS[options.character], independentRepeat: { input: REPEATED_INPUT, runs: 3 } },
    ...(output ? { output } : {}),
  };
  if (!options.live) {
    const session = make();
    const input = SCRIPTS[options.character][0];
    const messages = engine.buildMessages(engine.prepareTurn(session, input, { now: at() }), input);
    report.initialSession = structuredClone(session);
    report.previewDirection = promptDirection(messages);
    report.previewPromptSha256 = hash(JSON.stringify(messages));
    await atomicSave(output, report);
    return report;
  }
  // Explicit --live is the only branch that reads model configuration or credentials.
  const [{ loadEnvironment }, { createProvider }] = await Promise.all([
    import(pathToFileURL(join(ROOT, 'server.mjs')).href),
    import(pathToFileURL(join(options.directory, 'provider.mjs')).href),
  ]);
  let activeStep;
  const provider = createProvider(environment ?? await loadEnvironment(), { fetch: async (url, request) => {
    const capturedStep = activeStep;
    const response = await captureProviderCall({ report, step: capturedStep, url, request, fetch: doFetch,
      save: () => atomicSave(output, report) });
    if (capturedStep.requestBody) capturedStep.promptDirection = promptDirection(capturedStep.requestBody.messages);
    return response;
  } });
  if (!provider.publicConfig.configured) throw issue('MODEL_NOT_CONFIGURED', '没有有效模型配置；本次没有调用模型。');
  report.model = provider.publicConfig.model;
  report.reasoningEffort = provider.publicConfig.reasoningEffort ?? null;
  report.architecture = provider.publicConfig.architecture ?? 'single-replyer';
  report.plannedCalls = report.plannedTurns * (report.architecture === 'planner-replyer' ? 2 : 1);
  await atomicSave(output, report);

  async function execute(conversation, input) {
    if (signal.aborted) throw issue('ABORTED', '运行已中断。');
    clock += 60000;
    const before = structuredClone(conversation.finalSession);
    const prepared = engine.prepareTurn(before, input, { now: at() });
    const step = { number: report.steps.length + 1, conversationId: conversation.id, input, fixtureTime: at(),
      status: 'pending', startedAt: timestamp(), beforeSession: before };
    report.steps.push(step); activeStep = step;
    await atomicSave(output, report);
    const begin = performance.now();
    try {
      const result = await provider.generate(prepared, input, { signal, now: at() });
      const session = engine.commitTurn(prepared, input, result, { requestId: randomUUID(), now: at() });
      Object.assign(step, { status: 'complete', result, session: structuredClone(session), sourceChecks: sourceChecks(session) });
      conversation.stepNumbers.push(step.number);
      conversation.finalSession = structuredClone(session);
    } catch (error) {
      step.status = 'failed'; step.error = safeError(error); throw error;
    } finally {
      step.latencyMs = Math.round(performance.now() - begin); step.finishedAt = timestamp();
      await atomicSave(output, report);
    }
  }

  const addConversation = kind => {
    const session = make();
    const conversation = { id: randomUUID(), kind, stepNumbers: [], initialSession: structuredClone(session), finalSession: structuredClone(session) };
    report.conversations.push(conversation);
    return conversation;
  };
  try {
    const continuation = addConversation('six-turn-continuation');
    for (const input of SCRIPTS[options.character]) await execute(continuation, input);
    for (let run = 0; run < 3; run += 1) await execute(addConversation('independent-same-input'), REPEATED_INPUT);
    report.status = 'complete'; report.finishedAt = timestamp();
    await atomicSave(output, report); return report;
  } catch (error) {
    report.status = signal.aborted ? 'aborted' : 'failed'; report.error = safeError(error); report.finishedAt = timestamp();
    await atomicSave(output, report); throw Object.assign(issue(report.error.code, report.error.message), { output });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) process.stdout.write('node evaluations/diversity.mjs [--directory PATH] [--character yume|nari] [--out PATH] [--live]\n默认只生成计划，不读取模型凭据。--live 每角色 9 个对话回合：6 轮连续聊天 + 3 次相同输入独立开局；默认 Planner/Replyer 两阶段预计 18 次请求，静默与重试会改变实际数量。每步分阶段保存请求、原始输出、usage、session 与模块哈希。\n');
    else {
      const report = await runEvaluation(options, { signal: controller.signal });
      process.stdout.write(`${JSON.stringify({ status: report.status, character: report.character, model: report.model,
        plannedCalls: report.plannedCalls, actualCalls: report.actualCalls, completedSteps: report.steps.filter(step => step.status === 'complete').length,
        output: report.output ?? null }, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ...safeError(error), ...(error.output ? { output: error.output } : {}) })}\n`);
    process.exitCode = controller.signal.aborted ? 130 : 1;
  }
}
