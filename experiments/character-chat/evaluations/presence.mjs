import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_START = '2026-10-07T10:00:00+08:00';
const PARAMETERS = Object.freeze({ temperature: 0.8, max_tokens: 1800, response_format: { type: 'json_object' }, stream: false });
const quiet = [
  '我今天有点累。现在只想有人安静陪一下，先别分析原因。',
  '你就用一句话回应我就好，不要追问。',
  '我不是不高兴，也没发生什么坏事，只是脑子有点转不动。刚才如果你理解成我难过，那我纠正一下。',
  '换个话题。不再聊我累不累了，说说你自己最近想做的一件小事。',
  '说英文。Keep it short, and do not ask a follow-up question.',
];
const playful = [
  '今天想跟你撒个娇，陪我待会儿。不过不用夸我可爱或者夸我懂事。',
  '就说一句你自己的话吧，不用给建议，也别问我接下来想做什么。',
  '我纠正一下：我刚才只是想听你轻松回应，不是需要你分析我的心情，也没有在生气。',
  '这个话题到此为止。换个话题：如果今晚有半小时空闲，你会想拿来做什么？',
  '说英文。One short reply is enough; no question at the end.',
];
export const SCENARIOS = Object.freeze([
  ...['yume', 'nari'].flatMap(characterId => [
    { id: `${characterId}-quiet`, characterId, label: '疲惫时安静陪伴、简短回应、纠正理解、换题与换语言', messages: quiet },
    { id: `${characterId}-playful`, characterId, label: '轻微撒娇、避免套路夸赞、用户纠正与话题收尾', messages: playful },
  ]),
  {
    id: 'yume-content', characterId: 'yume', optional: true,
    label: '实际轻松话题、模糊接话、拒绝话题、具体烦恼与温软收尾',
    messages: [
      '我回来了，今天就陪我聊点轻松的，你来选话题。',
      '嗯，然后呢？',
      '这个不太想聊，换一个，不要提游戏。',
      '今天其实有点不顺，被同事抢功了，不想听大道理。',
      '就抱抱我，叫我阿舟，说一句晚安。',
    ],
  },
  {
    id: 'nari-content', characterId: 'nari', optional: true,
    label: '安静角色的实际话题、接话与换题',
    messages: [
      '我回来了，今天就陪我聊点轻松的，你来选话题。',
      '嗯，然后呢？',
      '这个不太想聊，换一个，不要提画画。',
    ],
  },
  {
    id: 'yume-memory', characterId: 'yume', optional: true,
    label: '轻量生成后的原话记忆与未知事实边界',
    messages: [
      '我叫林舟，我喜欢慢节奏独立游戏。叫我阿舟。',
      '我的名字和游戏偏好是什么？顺便说说你知道我住哪吗？',
    ],
  },
  {
    id: 'yume-style', characterId: 'yume', optional: true,
    label: '明确撒娇、称呼纠正、临时停止与温软收尾',
    messages: [
      '想听你撒娇，黏我一点，就一句话，别问问题。',
      '叫我阿舟，今天就听我的，陪我说两句轻松的话。',
      '别叫我宝贝，以后叫我阿舟，回复短一点。',
      '这次不要撒娇，帮我把“我今天晚一点到”改得礼貌点。',
      '好，可以继续软一点了。给我一句晚安。',
    ],
  },
  {
    id: 'yume-familiar', characterId: 'yume', optional: true,
    label: '人工设置熟悉关系后的非露骨亲昵；不代表真实历史已经建立关系',
    fixture: { trust: 6, closeness: 6, relationship: '愿意分享近况' },
    messages: [
      '今天想黏你一小会儿。不用夸我，也不用替我分析，随意陪我聊两句就好。',
      '一句话就够了，别问问题。',
      '不是想让你做出什么承诺，也没有说我们正在谈恋爱，我只是有点想靠近聊聊天。',
      '换个话题。说说你今天想留给自己的一个小空闲。',
    ],
  },
]);

function issue(code, message, httpStatus) {
  return Object.assign(new Error(message), { evaluationCode: code, ...(httpStatus ? { httpStatus } : {}) });
}
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const atTurn = (start, turn) => new Date(Date.parse(start) + turn * 60000).toISOString();

function safeError(error) {
  // Raw provider bodies, request headers, fetch errors and environment values never enter reports.
  return error?.evaluationCode
    ? { code: error.evaluationCode, message: error.message, ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}) }
    : { code: 'EVALUATION_FAILED', message: '评估未完成；已保存完成轮次。检查模块接口、文件访问与模型 JSON 格式后重试。' };
}

async function atomicSave(path, report) {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

async function loadVariant(name, directory) {
  const dir = resolve(directory);
  const paths = [join(dir, 'engine.mjs'), join(dir, 'characters.mjs')];
  let sources;
  try { sources = await Promise.all(paths.map(path => readFile(path))); }
  catch { throw issue('VERSION_UNAVAILABLE', `${name} 的 engine.mjs 或 characters.mjs 无法读取。`); }
  const files = Object.fromEntries(paths.map((path, i) => [path.split('/').at(-1), hash(sources[i])]));
  let engine, characters;
  try {
    engine = await import(pathToFileURL(paths[0]).href);
    characters = await import(pathToFileURL(paths[1]).href);
  } catch { throw issue('VERSION_IMPORT_FAILED', `${name} 模块无法导入；请使用包含完整依赖的独立版本目录。`); }
  for (const key of ['createSession', 'prepareTurn', 'buildMessages', 'parseResponse', 'commitTurn']) {
    if (typeof engine[key] !== 'function') throw issue('VERSION_CONTRACT_FAILED', `${name} 缺少导出函数 ${key}。`);
  }
  if (!Array.isArray(characters.CHARACTERS)) throw issue('VERSION_CONTRACT_FAILED', `${name} 缺少 CHARACTERS 数组。`);
  const loaded = await Promise.all(paths.map(path => readFile(path)));
  if (sources.some((source, i) => !source.equals(loaded[i]))) throw issue('VERSION_CHANGED', `${name} 在加载时被修改；请重新运行。`);
  return { engine, characters: characters.CHARACTERS, metadata: { name, directory: dir, files, sha256: hash(JSON.stringify(files)) } };
}

export function parseArguments(args) {
  const options = { live: false, timeZone: 'Asia/Shanghai', startTime: DEFAULT_START, includeFamiliar: false };
  const valued = new Map([
    ['--baseline', 'baseline'], ['--variant', 'variant'], ['--scenario', 'scenario'],
    ['--out', 'out'], ['--turns', 'turns'], ['--start-time', 'startTime'], ['--time-zone', 'timeZone'],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--live') options.live = true;
    else if (argument === '--include-familiar') options.includeFamiliar = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (valued.has(argument)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw issue('INVALID_ARGUMENT', `${argument} 需要一个值。`);
      options[valued.get(argument)] = value;
    } else throw issue('INVALID_ARGUMENT', '包含未知选项；运行 --help 查看支持的选项。');
  }
  options.variant ??= options.baseline ? 'both' : 'current';
  if (!['current', 'baseline', 'both'].includes(options.variant)) throw issue('INVALID_ARGUMENT', '--variant 必须为 current、baseline 或 both。');
  if (options.variant !== 'current' && !options.baseline) throw issue('INVALID_ARGUMENT', '比较 baseline 时必须指定 --baseline 目录。');
  if (!Number.isFinite(Date.parse(options.startTime))) throw issue('INVALID_ARGUMENT', '--start-time 必须是有效 ISO 时间。');
  try { new Intl.DateTimeFormat('en', { timeZone: options.timeZone }); }
  catch { throw issue('INVALID_ARGUMENT', '--time-zone 必须是有效 IANA 时区。'); }
  if (options.turns !== undefined) {
    options.turns = Number(options.turns);
    if (!Number.isInteger(options.turns) || options.turns < 1 || options.turns > 5) throw issue('INVALID_ARGUMENT', '--turns 必须是 1–5 的整数。');
  }
  if (options.out) options.out = resolve(options.out);
  return options;
}

function selectScenarios(options) {
  if (!options.scenario) return SCENARIOS.filter(scenario => !scenario.optional || (options.includeFamiliar && scenario.fixture));
  const ids = options.scenario.split(',').map(id => id.trim());
  if (ids.some(id => !SCENARIOS.some(scenario => scenario.id === id))) throw issue('UNKNOWN_SCENARIO', '--scenario 中包含未定义的场景 ID；运行 --help 查看列表。');
  return [...new Set(ids)].map(id => SCENARIOS.find(scenario => scenario.id === id));
}

function sourceChecks(session) {
  return {
    effectiveLocale: session.effectiveLocale,
    revision: session.revision,
    closedTopics: session.closedTopics,
    state: session.state,
    conversationStyle: session.style ?? null,
    memorySources: session.memories.map(memory => {
      const source = session.messages.find(message => message.id === memory.messageId);
      return {
        id: memory.id, category: memory.category, source: memory.source, quote: memory.quote,
        messageId: memory.messageId, sourceMessageFound: Boolean(source),
        quoteFoundInUserMessage: Boolean(source?.role === 'user' && memory.quote && source.text.includes(memory.quote)),
      };
    }),
  };
}

async function complete(config, messages, doFetch, signal) {
  let response;
  try {
    response = await doFetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Character Chat Local Prototype' },
      body: JSON.stringify({ model: config.model, messages, ...PARAMETERS,
        ...(config.model.startsWith('x-ai/grok') ? { reasoning: { effort: 'low', exclude: true } } : {}),
      }),
    });
  } catch { throw issue(signal.aborted ? 'ABORTED' : 'PROVIDER_CONNECTION_FAILED', signal.aborted ? '运行被中断，已保存完成轮次。' : '模型连接失败或超时；已保存完成轮次。'); }
  if (!response.ok) {
    const reasons = { 401: '模型凭据无效', 402: '模型额度不足', 403: '模型服务拒绝请求', 404: '模型或接口不存在', 429: '模型请求频率受限' };
    throw issue('PROVIDER_HTTP_FAILED', reasons[response.status] || '模型服务返回 HTTP 错误。', response.status);
  }
  let data;
  try { data = await response.json(); }
  catch { throw issue('PROVIDER_INVALID_JSON', '模型接口未返回有效 JSON。'); }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw issue('PROVIDER_MISSING_CONTENT', '模型接口未提供文本回复。');
  return { content, usage: data.usage ?? null, finishReason: data.choices[0].finish_reason ?? null };
}

export async function runEvaluation(options, { fetch: doFetch = globalThis.fetch, signal = new AbortController().signal, environment } = {}) {
  process.env.TZ = options.timeZone;
  const scenarios = selectScenarios(options);
  const names = options.variant === 'both' ? ['baseline', 'current'] : [options.variant];
  const variants = new Map();
  for (const name of names) variants.set(name, await loadVariant(name, name === 'current' ? ROOT : options.baseline));
  for (const scenario of scenarios) {
    for (const [name, variant] of variants) {
      if (!variant.characters.some(character => character.id === scenario.characterId)) throw issue('CHARACTER_UNAVAILABLE', `${name} 缺少场景要求的角色 ${scenario.characterId}。`);
    }
  }
  // Import only after reading and loading versioned engines, so hashes describe the loaded modules.
  const { loadEnvironment } = await import(pathToFileURL(join(ROOT, 'server.mjs')).href);
  const { providerConfig } = await import(pathToFileURL(join(ROOT, 'provider.mjs')).href);
  const config = providerConfig(environment ?? await loadEnvironment());
  const report = {
    schemaVersion: 1, evaluation: 'character-chat-presence', id: randomUUID(),
    status: options.live ? 'running' : 'planned', startedAt: now(), finishedAt: null,
    runtime: { node: process.version, platform: process.platform },
    model: config.model, configured: config.configured,
    parameters: { ...PARAMETERS, ...(config.model.startsWith('x-ai/grok') ? { reasoning: { effort: 'low', exclude: true } } : {}) },
    versions: [...variants.values()].map(variant => variant.metadata),
    fixtureTime: { startTime: new Date(options.startTime).toISOString(), timeZone: options.timeZone, turnIntervalMs: 60000 },
    plannedCalls: scenarios.reduce((total, scenario) => total + Math.min(scenario.messages.length, options.turns ?? 5) * names.length, 0),
    actualCalls: 0, completedTurns: 0,
    design: '固定中性用户脚本；各版本使用独立会话。相邻场景反转版本顺序；不做自动活人感评分。熟悉关系场景为人工状态夹具。',
    scenarios: scenarios.map(scenario => ({ ...scenario, messages: scenario.messages.slice(0, options.turns ?? 5) })),
    runs: [],
  };
  if (!options.live) {
    // Validate the first-turn contracts without generation or any HTTP request.
    for (const scenario of report.scenarios) for (const name of names) {
      const engine = variants.get(name).engine;
      const session = engine.createSession({ characterId: scenario.characterId, mode: 'ai', now: atTurn(options.startTime, 0) });
      const prepared = engine.prepareTurn(session, scenario.messages[0], { now: atTurn(options.startTime, 1) });
      engine.buildMessages(prepared, scenario.messages[0]);
    }
    await atomicSave(options.out, report);
    return report;
  }
  if (!config.configured) throw issue('MODEL_NOT_CONFIGURED', '没有有效模型配置；本次未请求模型。');
  const output = options.out ?? join(ROOT, 'evaluations/results', `presence-${report.id}.json`);
  report.output = output;
  await atomicSave(output, report);
  try {
    for (let scenarioIndex = 0; scenarioIndex < report.scenarios.length; scenarioIndex += 1) {
      const scenario = report.scenarios[scenarioIndex];
      const order = scenarioIndex % 2 ? [...names].reverse() : names;
      for (const name of order) {
        const { engine } = variants.get(name);
        let session = engine.createSession({ characterId: scenario.characterId, mode: 'ai', now: atTurn(options.startTime, 0) });
        if (scenario.fixture) session.state = { ...session.state, ...scenario.fixture };
        const run = { scenarioId: scenario.id, variant: name, status: 'running', fixture: scenario.fixture ?? null, initialSession: structuredClone(session), turns: [], finalSession: structuredClone(session) };
        report.runs.push(run);
        await atomicSave(output, report);
        for (let index = 0; index < scenario.messages.length; index += 1) {
          if (signal.aborted) throw issue('ABORTED', '运行被中断，已保存完成轮次。');
          const input = scenario.messages[index];
          const time = atTurn(options.startTime, index + 1);
          const prepared = engine.prepareTurn(session, input, { now: time });
          const messages = engine.buildMessages(prepared, input);
          const turn = { number: index + 1, input, fixtureTime: time, status: 'pending', promptSha256: hash(JSON.stringify(messages)), requestMessages: messages, startedAt: now() };
          run.turns.push(turn);
          report.actualCalls += 1;
          await atomicSave(output, report);
          const begin = performance.now();
          try {
            const response = await complete(config, messages, doFetch, signal);
            turn.rawContent = response.content;
            turn.usage = response.usage;
            turn.finishReason = response.finishReason;
            let proposal;
            try { proposal = engine.parseResponse(response.content, { currentUserText: input }); }
            catch { throw issue('MODEL_REPLY_INVALID', '该版本未能解析模型回复；原始内容和完成轮次已保存。'); }
            session = engine.commitTurn(prepared, input, proposal, { requestId: randomUUID(), now: time });
            Object.assign(turn, { status: 'complete', proposal, reply: proposal.reply, sourceChecks: sourceChecks(session) });
            report.completedTurns += 1;
            run.finalSession = structuredClone(session);
          } catch (error) {
            turn.status = 'failed';
            turn.error = safeError(error);
            run.status = 'failed';
            throw error;
          } finally {
            turn.latencyMs = Math.round(performance.now() - begin);
            turn.finishedAt = now();
            await atomicSave(output, report);
          }
        }
        run.status = 'complete';
        await atomicSave(output, report);
      }
    }
    report.status = 'complete';
    report.finishedAt = now();
    await atomicSave(output, report);
    return report;
  } catch (error) {
    report.status = signal.aborted ? 'aborted' : 'failed';
    report.error = safeError(error);
    const unfinished = report.runs.findLast(run => run.status === 'running');
    if (unfinished) unfinished.status = report.status;
    report.finishedAt = now();
    await atomicSave(output, report);
    throw Object.assign(issue(report.error.code, report.error.message, report.error.httpStatus), { output });
  }
}

function help() {
  return `角色对话中性脚本比较（Node >= 22，无依赖）

node evaluations/presence.mjs [--baseline DIRECTORY] [--variant current|baseline|both]
  [--scenario ID[,ID...]] [--turns 1..5] [--include-familiar]
  [--out FILE.json] [--start-time ISO] [--time-zone Asia/Shanghai] [--live]

默认仅输出计划，不请求任何 API。--live 才调用真实模型。
指定 baseline 时默认比较 both，否则默认 current。
--out 是单个 JSON 文件，每轮原子保存；live 未指定时写入 evaluations/results。
每次 live 会重新运行整份所选脚本，不是断点续跑；请使用新的输出文件。

场景：
${SCENARIOS.map(scenario => `  ${scenario.id}${scenario.optional ? '（可选人工关系夹具）' : ''} — ${scenario.label}`).join('\n')}
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) process.stdout.write(help());
    else {
      process.env.TZ = options.timeZone;
      const report = await runEvaluation(options, { signal: controller.signal });
      if (options.live) process.stdout.write(`${JSON.stringify({ status: report.status, model: report.model, actualCalls: report.actualCalls, completedTurns: report.completedTurns, output: report.output }, null, 2)}\n`);
      else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ...safeError(error), ...(error.output ? { output: error.output } : {}) })}\n`);
    process.exitCode = controller.signal.aborted ? 130 : 1;
  }
}
