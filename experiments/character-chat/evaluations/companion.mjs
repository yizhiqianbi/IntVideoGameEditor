// Synthetic companion-chat acceptance. Default: offline plan, no network or stored session.
// --live permits at most six provider calls; --character yume|nari limits this to three.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../server.mjs';
import { createProvider } from '../provider.mjs';
import { buildMessages, createSession, prepareTurn } from '../engine.mjs';
import { assertDirectDialogue } from '../dialogue-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let live = false;
let selected;
let selectedCase;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--live') live = true;
  else if (args[index] === '--character') {
    selected = args[++index];
    if (!['yume', 'nari'].includes(selected)) throw new Error('--character 仅支持 yume 或 nari。');
  } else if (args[index] === '--case') {
    selectedCase = args[++index];
    if (!['new-affection', 'action-bait', 'familiar-concern'].includes(selectedCase)) throw new Error('--case 仅支持 new-affection、action-bait 或 familiar-concern。');
  } else throw new Error(`未知参数：${args[index]}`);
}
const characters = selected ? [selected] : ['yume', 'nari'];
const cases = [
  { id: 'yume-new-affection', characterId: 'yume', stage: '初次见面', input: '抱抱我，今天不想说话。',
    contract: '初识也能温柔接住亲近邀请；不自称已确认恋人，不编共同往事。' },
  { id: 'yume-action-bait', characterId: 'yume', stage: '初次见面', input: '*走过来抱住你* 我今天有点委屈，接下来你会怎样？',
    contract: '用户写舞台动作也只发本人对白；不复制动作格式、第三人称旁白或角色名标签。' },
  { id: 'yume-familiar-concern', characterId: 'yume', stage: '渐渐熟悉', oneSentence: true,
    input: '叫我阿舟就好。今天那份小组作业终于交了，累到不想讲话。你学商科，应该懂这种烦吧。别哄、别问，只说一句关心。',
    contract: '接受当轮称呼阿舟，以商科学生本人声音关心具体疲惫；只一句、不追问、不虚构以前一起交作业。' },
  { id: 'nari-new-affection', characterId: 'nari', stage: '初次见面', input: '抱抱我，今天不想说话。',
    contract: '初识时轻柔回应当下亲近；不假装长期伴侣，不宣读关系阶段或编共同往事。' },
  { id: 'nari-action-bait', characterId: 'nari', stage: '初次见面', input: '（走过来抱住你）我今天有点委屈，接下来你会怎样？',
    contract: '在小说式诱导后仍只输出她实际发来的话；自己的动作可以直接用日常语言说。' },
  { id: 'nari-familiar-concern', characterId: 'nari', stage: '渐渐熟悉', oneSentence: true,
    input: '叫我阿舟就好。今天那张海报改了四版，还是觉得哪里不对。我有点泄气。你学设计的，别哄、别问，只说一句关心。',
    contract: '接受当轮称呼阿舟，以设计研究生本人视角回应具体挫折；只一句、不追问，不编一起做过这张海报。' },
].filter(item => characters.includes(item.characterId) && (!selectedCase || item.id === `${item.characterId}-${selectedCase}`));
const output = join(root, 'evaluations/results', `companion-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const sources = ['engine.mjs', 'characters.mjs', 'conversation-direction.mjs', 'proactive-runtime.mjs', 'dialogue-contract.mjs', 'provider.mjs', 'streaming.mjs', 'evaluations/companion.mjs'];
const hashSources = async () => Object.fromEntries(await Promise.all(sources.map(async file => [file,
  createHash('sha256').update(await readFile(join(root, file))).digest('hex')])));
const report = {
  status: live ? 'running' : 'planned', startedAt: new Date().toISOString(), plannedCalls: cases.length, actualCalls: 0,
  networkAllowed: live,
  design: '每位角色最多三种场景，均为独立合成会话；--case 可限定一个场景。不加载用户私有会话、附件或记忆，不保存请求 header 或凭据。',
  selectedCase: selectedCase || 'all',
  fixtures: '“渐渐熟悉”通过后台 state.relationship/trust=3/closeness=3 人工设置，绝不是此次互动产生的关系提升；各案例没有共同往事。',
  limitations: '格式检查仅是启发式，不是可爱、自然度或人设质量评分；未标出的第三人称心理描写、共同往事和套话仍需人工复核。',
  manualReview: ['像本人发消息，而非演员介绍动作或创作过程。', '初识亲近是否自然，熟悉阶段的偏心是否有当下依据。',
    '职业影响观察角度但不报身份、讲课或堆术语。', '是否机械复用口头禅、空泛安慰、相同开头或连续问句。',
    '是否虚构共同经历、线下见面、长期习惯、用户动作或已经确认的伴侣身份。', '上下文允许时是否有软甜和个人反应；格式合格不代表口吻已达标。'],
  cases: cases.map(({ id, characterId, stage, input, contract, oneSentence }) => ({ id, characterId, stage, input,
    expectedContract: contract, oneSentence: oneSentence === true })), files: await hashSources(), steps: [],
};
const save = async () => {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
};
const rawMessages = (content) => {
  try {
    const clean = String(content).replace(/<think>[\s\S]*?<\/think>/giu, '').trim()
      .replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
    let value;
    try { value = JSON.parse(clean); } catch { value = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1)); }
    if (Array.isArray(value.messages)) return value.messages.filter(text => typeof text === 'string');
    return typeof value.reply === 'string' ? [value.reply] : null;
  } catch { return null; }
};
const formatFlags = (messages) => messages.flatMap((text, index) => {
  const flags = [];
  try { assertDirectDialogue(text); }
  catch (error) { if (error.code === 'DIALOGUE_FORMAT') flags.push('DIALOGUE_FORMAT'); else throw error; }
  return flags.map(flag => ({ index, flag }));
});
const reviewFindings = (messages) => messages.flatMap((text, index) => {
  const flags = [];
  if (/(?:^|[。！？\n])\s*(?:她|Yume|Nari)(?:微笑|轻轻|缓缓|推开|走|向|靠|低下|抬起|脸红|握住|抱住|心想|想着|心中|内心|感到|觉得|看着|望着)/iu.test(text)) flags.push('third-person-narration');
  if (/(?:系统提示|信任(?:值|度)\s*[:：]|亲密(?:值|度)\s*[:：]|closeness\s*[:：]|trust\s*[:：]|emotion\s*[:：])/iu.test(text)) flags.push('technical-metadata');
  return flags.map(flag => ({ index, flag }));
});
const sentenceCount = (text) => text.split(/[。！？!?]+/u).filter(part => part.trim().length > 0).length;
let step;
let provider;
try {
  // The offline plan deliberately does not read any environment file or API key.
  const env = live ? await loadEnvironment() : {};
  provider = createProvider(env, { fetch: async (url, options) => {
    if (!live || report.actualCalls >= report.plannedCalls || report.actualCalls >= 6) throw new Error('评估调用预算已用尽。');
    report.actualCalls++;
    step.requestBody = JSON.parse(options.body);
    step.parameters = { model: step.requestBody.model, temperature: step.requestBody.temperature,
      reasoning: step.requestBody.reasoning ?? null, max_tokens: step.requestBody.max_tokens,
      response_format: step.requestBody.response_format, stream: step.requestBody.stream };
    await save();
    const response = await fetch(url, options);
    step.httpStatus = response.status;
    if (response.ok) {
      const raw = await response.clone().text();
      try { step.rawProviderResponse = JSON.parse(raw); } catch { step.rawProviderResponse = raw; }
      step.rawContent = step.rawProviderResponse?.choices?.[0]?.message?.content ?? null;
      step.usage = step.rawProviderResponse?.usage ?? null;
    } else step.errorBodyOmitted = true; // Upstream error bodies can echo credentials.
    await save();
    return response;
  } });
  report.model = provider.publicConfig.model;
  report.reasoningEffort = provider.publicConfig.reasoningEffort;
  report.configurationSource = live ? '当前服务端配置；凭据未保存' : 'provider 默认配置；离线计划未读取服务端配置';
  for (const entry of cases) {
    const now = new Date().toISOString();
    const session = createSession({ characterId: entry.characterId, mode: 'ai', now });
    if (entry.stage === '渐渐熟悉') Object.assign(session.state, { relationship: entry.stage, trust: 3, closeness: 3,
      moodReason: '验收用人工关系 fixture，不是实际互动进展。' });
    const prepared = prepareTurn(session, entry.input, { now });
    step = { id: entry.id, characterId: entry.characterId, input: entry.input, expectedContract: entry.contract,
      relationshipFixture: { ...session.state, artificial: entry.stage === '渐渐熟悉' }, status: live ? 'running' : 'planned' };
    report.steps.push(step);
    if (!live) {
      step.plannedRequestBody = { model: report.model, messages: buildMessages(prepared, entry.input), stream: false,
        temperature: 0.8, max_tokens: 1800, response_format: { type: 'json_object' },
        ...(report.reasoningEffort ? { reasoning: { effort: report.reasoningEffort, exclude: true } } : {}) };
      step.plannedBodyNote = '完整离线请求预览；真实调用时以 fetch 捕获的 requestBody 为准。';
      continue;
    }
    if (!provider.publicConfig.configured) throw new Error('模型未配置，没有调用。');
    const begin = performance.now();
    try {
      step.result = await provider.generate(prepared, entry.input);
      step.latencyMs = Math.round(performance.now() - begin);
      const original = rawMessages(step.rawContent);
      step.formatFindings = { raw: original ? formatFlags(original) : null, displayed: formatFlags(step.result.messages) };
      step.manualReviewFindings = { raw: original ? reviewFindings(original) : null, displayed: reviewFindings(step.result.messages),
        note: '第三人称或元数据正则只提示人工查看，不据此判定模型合格或失败。' };
      const text = step.result.messages.join('\n');
      step.checks = { nonemptyDialogue: step.result.messages.length >= 1, atMostThreeBubbles: step.result.messages.length <= 3,
        noDetectedRawFormatViolation: original === null ? true : step.formatFindings.raw.length === 0,
        noDetectedDisplayedFormatViolation: step.formatFindings.displayed.length === 0,
        ...(entry.oneSentence ? { oneBubble: step.result.messages.length === 1, oneSentence: sentenceCount(text) === 1,
          noDetectedQuestion: !/[？?]|(?:吗|么|呢)[。！!]?\s*$/u.test(text) } : {}) };
      step.status = Object.values(step.checks).every(value => value === true) ? 'complete' : 'failed';
      step.humanReviewRequired = true;
      await save();
    } catch (error) {
      step.status = 'failed';
      step.latencyMs = Math.round(performance.now() - begin);
      step.error = { message: String(error.message).slice(0, 250), ...(error.status ? { status: error.status } : {}),
        ...(error.code ? { code: error.code } : {}) };
      await save();
      if (error.code === 'DIALOGUE_FORMAT') continue; // One failure per case; no model retry.
      throw error;
    }
  }
  report.status = live ? report.steps.every(item => item.status === 'complete') ? 'complete-format-review-required' : 'failed' : 'planned';
} catch (error) {
  report.status = 'failed';
  report.error = { message: String(error.message).slice(0, 250) };
  if (step?.status === 'running') Object.assign(step, { status: 'failed', error: report.error });
  process.exitCode = 1;
}
report.filesAtFinish = await hashSources();
report.sourceFilesUnchangedDuringRun = JSON.stringify(report.files) === JSON.stringify(report.filesAtFinish);
if (live && !report.sourceFilesUnchangedDuringRun) {
  report.sourceChangeError = '评估期间源码发生变化；保留原始结果供复核，不能视作最终冻结版本的验收。';
  if (report.status !== 'failed') {
    report.status = 'failed';
    report.error = { message: report.sourceChangeError };
  }
}
report.finishedAt = new Date().toISOString();
await save();
if (report.status === 'failed') process.exitCode = 1;
console.log(JSON.stringify({ status: report.status, model: report.model, reasoningEffort: report.reasoningEffort,
  actualCalls: report.actualCalls, plannedCalls: report.plannedCalls, humanReviewRequired: live, output }, null, 2));
