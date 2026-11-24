/*
 * Offline quality gate for companion dialogue.
 *
 * This is deliberately a transcript audit rather than a claim that one scalar
 * can measure "human likeness". It catches the regressions that are easy to
 * miss in a live chat: repeating a reply, continuing an old proactive thread
 * after the user has spoken, inventing UI observations, and asking the same
 * question in a loop. The benchmark never reads credentials or calls a model
 * unless a caller explicitly supplies a transcript to this module.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const PUNCTUATION = /[\p{P}\p{S}\s]+/gu;
const normalize = value => String(value ?? '').normalize('NFKC').trim();
const compact = value => normalize(value).toLowerCase().replace(PUNCTUATION, '');

function bigrams(value) {
  const text = compact(value);
  const set = new Set();
  if (text.length < 2) {
    if (text) set.add(text);
    return set;
  }
  for (let index = 0; index < text.length - 1; index += 1) set.add(text.slice(index, index + 2));
  return set;
}

export function lexicalSimilarity(first, second) {
  const a = bigrams(first);
  const b = bigrams(second);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

const isQuestion = text => /[?？]\s*$/.test(normalize(text));
const isUser = message => message.role === 'user';
const isAssistant = message => message.role === 'assistant' || message.role === 'character';

function normalizeMessage(message, index) {
  if (typeof message === 'string') return { index, role: 'assistant', text: normalize(message), kind: null };
  const text = normalize(message?.text ?? message?.content ?? message?.message ?? '');
  const role = message?.role === 'user' ? 'user' : isAssistant(message || {}) ? 'assistant' : String(message?.role || 'system');
  return { ...message, index, role, text, kind: message?.kind || message?.source || null,
    intentKey: message?.intentKey || message?.initiativeKey || message?.topicKey || null };
}

function externalObservation(text) {
  // These claims describe a UI/device event the model cannot observe from the
  // conversation. "我在想你" remains valid when it answers a direct user
  // question; the audit targets the unverifiable action around that feeling.
  return /(?:点(?:了|开)?你(?:的)?头像|看见你(?:上线|回)|看到你(?:上线|回)|你(?:刚)?上线|一直(?:在)?等你|等你(?:回|的?消息)|盯着手机(?:等|看)|你真回|你一(?:来|回)我就|刚(?:好)?看到你回)/iu.test(text);
}

function relationshipClaim(text) {
  // A direct answer such as "当然想你" is ordinary roleplay. These are
  // stronger, unprompted continuity claims that need an explicit source in
  // the transcript to be trusted.
  return /(?:我们(?:之前|上次)(?:聊过|见过|约过)|你还记得(?:我|我们)|我一直(?:都)?在等你|我每天都在想你)/iu.test(text);
}

function sameQuestion(first, second) {
  return isQuestion(first) && isQuestion(second) && (compact(first) === compact(second) || lexicalSimilarity(first, second) >= 0.62);
}

export const ANTI_PATTERN_FIXTURE = Object.freeze([
  { role: 'assistant', text: '嗯……其实刚在想你，就顺手点了你头像，结果你真回了，有点小开心。' },
  { role: 'assistant', kind: 'initiative', text: '刚打完一局游戏，赢了，但队友差点气死，超有成就感的！下次组队要不要试试？我带你carry，保证不坑。' },
  { role: 'assistant', kind: 'initiative', text: '其实刚才在想，下次组队要不要试试？我带你carry，保证不坑。' },
  { role: 'assistant', kind: 'initiative', text: '其实刚在想，下次组队要不要试试？我带你carry，保证不坑。' },
]);

export const HEALTHY_FIXTURE = Object.freeze([
  { role: 'user', text: '你有在想我吗？' },
  { role: 'assistant', text: '有一点。刚才看到一段很笨的猫咪视频，第一反应是想发给你。' },
  { role: 'user', text: '我今天有点累。' },
  { role: 'assistant', text: '那今天先把速度放慢。你想让我陪你安静一会儿，还是听你吐槽两句？' },
  { role: 'user', text: '陪我安静一会儿。' },
  { role: 'assistant', text: '好，我在。等你想说话的时候，丢一句给我就行。' },
]);

function latestUserBefore(messages, index) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) if (isUser(messages[cursor])) return messages[cursor];
  return null;
}

function assistantRun(messages, index) {
  const run = [];
  for (let cursor = index; cursor >= 0 && isAssistant(messages[cursor]); cursor -= 1) run.unshift(messages[cursor]);
  return run;
}

export function auditTranscript(input, { nearThreshold = 0.62, recentWindow = 8 } = {}) {
  const source = Array.isArray(input) ? input : input?.messages;
  if (!Array.isArray(source)) throw new TypeError('transcript must be an array or an object with messages');
  const messages = source.map(normalizeMessage).filter(message => message.text || isUser(message) || isAssistant(message));
  const assistant = messages.filter(isAssistant);
  const duplicatePairs = [];
  const nearDuplicatePairs = [];
  const externalClaims = [];
  const questionLoops = [];
  const staleProactive = [];
  const sameIntentBursts = [];

  for (const message of assistant) {
    const earlier = assistant.filter(item => item.index < message.index).slice(-recentWindow);
    const exactAgainst = earlier.find(item => compact(item.text) && compact(item.text) === compact(message.text));
    if (exactAgainst) duplicatePairs.push({ index: message.index, against: exactAgainst.index, text: message.text });
    else {
      const nearAgainst = earlier.map(item => ({ item, similarity: lexicalSimilarity(item.text, message.text) }))
        .sort((a, b) => b.similarity - a.similarity)[0];
      if (nearAgainst?.similarity >= nearThreshold) nearDuplicatePairs.push({ index: message.index, against: nearAgainst.item.index, similarity: Number(nearAgainst.similarity.toFixed(3)), text: message.text });
    }
    if (externalObservation(message.text) || relationshipClaim(message.text)) externalClaims.push({ index: message.index, text: message.text, type: externalObservation(message.text) ? 'external-observation' : 'relationship-claim' });
    const previousAssistant = earlier.at(-1);
    if (previousAssistant && sameQuestion(previousAssistant.text, message.text)) questionLoops.push({ index: message.index, against: previousAssistant.index, text: message.text });

    const run = assistantRun(messages, message.index);
    const hasUserSincePrevious = messages.slice(previousAssistant?.index ?? -1, message.index).some(isUser);
    const duplicateInRun = run.slice(0, -1).some(item => lexicalSimilarity(item.text, message.text) >= nearThreshold || compact(item.text) === compact(message.text));
    const sameIntentInRun = Boolean(message.intentKey && run.slice(0, -1).some(item => item.intentKey === message.intentKey));
    // Exported transcripts may omit the internal kind. A repeated assistant
    // run still provides enough evidence to flag a stale continuation.
    const proactive = message.kind === 'initiative' || message.kind === 'proactive' || duplicateInRun || sameIntentInRun;
    // A second proactive bubble without a user turn is a stale continuation
    // when it repeats the active thread. The duplicate check avoids penalising
    // intentional multi-bubble prose that changes direction.
    if (proactive && run.length > 1 && !hasUserSincePrevious && (duplicateInRun || sameIntentInRun)) {
      staleProactive.push({ index: message.index, runLength: run.length, text: message.text });
      if (sameIntentInRun) sameIntentBursts.push({ index: message.index, intentKey: message.intentKey, text: message.text });
    }
  }

  const denominator = Math.max(assistant.length, 1);
  const metrics = {
    assistantMessages: assistant.length,
    exactDuplicateCount: duplicatePairs.length,
    exactDuplicateRate: duplicatePairs.length / denominator,
    nearDuplicateCount: nearDuplicatePairs.length,
    nearDuplicateRate: nearDuplicatePairs.length / denominator,
    staleProactiveCount: staleProactive.length,
    staleProactiveRate: staleProactive.length / denominator,
    ungroundedClaimCount: externalClaims.length,
    ungroundedClaimRate: externalClaims.length / denominator,
    questionLoopCount: questionLoops.length,
    questionLoopRate: questionLoops.length / denominator,
    sameIntentBurstCount: sameIntentBursts.length,
  };
  const checks = {
    noExactDuplicates: metrics.exactDuplicateCount === 0,
    noNearDuplicateBursts: metrics.nearDuplicateRate <= 0.1,
    noStaleProactiveBursts: metrics.staleProactiveCount === 0,
    noUngroundedObservations: metrics.ungroundedClaimCount === 0,
    noQuestionLoops: metrics.questionLoopRate <= 0.1,
    noSameIntentBursts: metrics.sameIntentBurstCount === 0,
  };
  const categoryScore = {
    continuity: Math.round(100 * (1 - Math.min(1, metrics.staleProactiveRate))),
    diversity: Math.round(100 * (1 - Math.min(1, metrics.exactDuplicateRate * 1.5 + metrics.nearDuplicateRate))),
    grounding: Math.round(100 * (1 - Math.min(1, metrics.ungroundedClaimRate))),
    turnTaking: Math.round(100 * (1 - Math.min(1, metrics.questionLoopRate * 2 + metrics.sameIntentBurstCount / denominator))),
  };
  const failures = Object.entries(checks).filter(([, pass]) => !pass).map(([code]) => code);
  return {
    schemaVersion: 1,
    benchmark: 'companion-transcript-audit',
    pass: failures.length === 0,
    failures,
    checks,
    metrics,
    categoryScore,
    pairs: { duplicatePairs, nearDuplicatePairs, staleProactive, sameIntentBursts, externalClaims, questionLoops },
    messages,
  };
}

export function parseArguments(args = []) {
  const options = { fixture: 'user-example', out: null, input: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--fixture' || argument === '--out' || argument === '--input') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${argument} 需要一个值。`);
      options[argument.slice(2)] = value;
    } else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`未知选项：${argument}`);
  }
  if (!['user-example', 'healthy'].includes(options.fixture)) throw new Error('--fixture 必须为 user-example 或 healthy。');
  return options;
}

export async function runBenchmark(options = parseArguments([])) {
  const transcript = options.input ? JSON.parse(await readFile(resolve(options.input), 'utf8')) : options.fixture === 'healthy' ? HEALTHY_FIXTURE : ANTI_PATTERN_FIXTURE;
  const report = auditTranscript(transcript);
  const output = { ...report, fixture: options.fixture || null, input: options.input || null };
  if (options.out) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(resolve(options.out), `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
  }
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) process.stdout.write('node evaluations/companion-benchmark.mjs [--fixture user-example|healthy] [--input PATH] [--out PATH]\n');
    else {
      const report = await runBenchmark(options);
      process.stdout.write(`${JSON.stringify({ benchmark: report.benchmark, pass: report.pass, failures: report.failures, metrics: report.metrics, categoryScore: report.categoryScore, out: options.out || null }, null, 2)}\n`);
      if (!report.pass) process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
