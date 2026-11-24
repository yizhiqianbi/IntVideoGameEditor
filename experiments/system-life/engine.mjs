import { randomUUID } from 'node:crypto';

const KINDS = ['observe', 'train', 'talk', 'explore', 'rest'];
const LIMITS = { name: 40, background: 1600, systemName: 60, appearance: 400, visualStyle: 240, location: 80, ally: 60 };
const MAX_NODES = 400;
const issuedTurns = new WeakMap();
const PLACES = ['雾港 · 旧街屋顶', '雾港 · 桥下训练场', '雾港 · 潮汐码头', '雾港 · 灯塔外街'];
const RULES = {
  observe: { label: '观察', cost: 8, xp: 8, trait: 'insight' },
  train: { label: '训练', cost: 16, xp: 14, trait: 'resolve' },
  talk: { label: '交谈', cost: 10, xp: 10, trait: 'empathy' },
  explore: { label: '探索', cost: 20, xp: 18, credits: 8, trait: 'insight' },
  rest: { label: '休息', cost: 0, xp: 0 },
};
export const ACTION_RULES = deepFreeze(copy(RULES));
const OPENING = [
  { id: 'calibration', title: '出生的馈赠 · 分别完成观察、训练、探索', kinds: ['observe', 'train', 'explore'], target: 3, xp: 24, credits: 20, item: '系统校准记录' },
  { id: 'tide-map', title: '潮汐的线索 · 探索两次，再观察一次', kinds: ['explore', 'explore', 'observe'], target: 3, xp: 36, credits: 30, item: '潮汐坐标' },
  { id: 'first-ally', title: '第一位同伴 · 交谈两次，训练一次', kinds: ['talk', 'talk', 'train'], target: 3, xp: 48, credits: 40, item: '苏槐的信任契约' },
];

export const DEFAULT_PRESET = deepFreeze({
  name: '林渡',
  background: '你出生在雾港，出生时便与一个只有你能感知的成长系统绑定。系统伴随你长大，却从不替你做决定。十八岁生日的清晨，港口潮汐出现异常，守夜人苏槐留下了一枚旧罗盘。你必须通过实际行动积累能力，找出异常的来源。',
  systemName: '演进系统',
  appearance: '18 岁成年青年，黑色短发，深灰色长外套，左腕一道细小琥珀色系统印记，随身携带旧黄铜罗盘',
  visualStyle: '写实电影风格，雾蓝与琥珀色光线，细腻自然材质，克制镜头',
  location: '雾港 · 旧街屋顶',
  ally: '苏槐',
});

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象。`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(`${label}包含不支持的对象类型。`);
  return value;
}

function rejectUnsafeKeys(value, depth = 0, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (depth > 24) fail('数据层级过深。');
  if (seen.has(value)) fail('数据不能包含循环引用。');
  seen.add(value);
  if (!Array.isArray(value)) object(value, '数据');
  for (const key of Object.keys(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('数据包含禁止的属性。');
    rejectUnsafeKeys(value[key], depth + 1, seen);
  }
  seen.delete(value);
}

function text(value, label, max, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string') fail(`${label}必须是文字。`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(cleaned)) {
    fail(`${label}需要 1 到 ${max} 个字符，且不能包含控制字符。`);
  }
  return cleaned;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function copy(value) { return structuredClone(value); }
function hash(value) {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.codePointAt(0), 16777619);
  return result >>> 0;
}

export function normalizePreset(input = {}) {
  object(input, '开局预设');
  rejectUnsafeKeys(input);
  const allowed = new Set([...Object.keys(LIMITS), 'mode']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail(`开局预设不支持 ${key} 字段。`);
  return deepFreeze(Object.fromEntries(Object.entries(LIMITS).map(([key, max]) =>
    [key, text(input[key], key, max, DEFAULT_PRESET[key])])));
}

function canonFor(preset) {
  return deepFreeze({ facts: [
    `主角姓名：${preset.name}。`,
    `主角在出生时便已绑定「${preset.systemName}」；系统随主角成长，绑定时间和绑定关系不可改写。`,
    '可游玩的故事从主角十八岁成年时开始；系统的出生绑定是过去事实，不能写成刚获得系统。',
    `固定外观：${preset.appearance}。`,
    `开局地点：${preset.location}；世界舞台以这个预设地点和世界背景为准。`,
    `初始同行者：${preset.ally}；保持同一位成年同行者的姓名和身份。主角的系统基础道具为左腕印记、旧黄铜罗盘。`,
    `世界背景：${preset.background}。背景中的创作设想始终服从出生绑定、十八岁成年开局和实际行动成长的规则。`,
    '能力、等级、体力、资产、物品和任务只能由行动规则结算；叙事和自由文字不能直接授予数值或改写历史。',
  ] });
}

function placesFor(preset) {
  return preset.location === DEFAULT_PRESET.location ? PLACES : [
    preset.location, `${preset.location} · 训练场`, `${preset.location} · 周边区域`, `${preset.location} · 远方地标`,
  ];
}

function initialState(preset) {
  return {
    age: 18, day: 1, chapter: 1, location: preset.location, level: 1, xp: 0, energy: 100, credits: 0,
    traits: { insight: 1, resolve: 1, empathy: 1 }, inventory: ['出生绑定的系统印记', '旧黄铜罗盘'],
    quests: [{ id: OPENING[0].id, title: OPENING[0].title, progress: 0, target: 3, status: 'active' }],
    flags: [], relationships: [{ name: preset.ally, trust: 0 }],
  };
}

function milestoneDefinition(id, preset) {
  const opening = OPENING.find(quest => quest.id === id);
  if (opening) {
    if (id === 'first-ally') return { ...opening, item: `${preset.ally}的信任契约` };
    if (id === 'tide-map' && preset.location !== DEFAULT_PRESET.location) return { ...opening, title: '周边的异动 · 探索两次，再观察一次', item: '异动坐标' };
    return opening;
  }
  const match = /^voyage-(\d+)$/.exec(id);
  if (!match) fail('任务记录损坏。');
  const number = Number(match[1]);
  const kinds = [['explore', 'observe', 'talk'], ['train', 'train', 'observe'], ['talk', 'explore', 'train']][(number - 1) % 3];
  return { id, title: `新航线 ${number} · ${['绘制路线', '磨练技艺', '建立同行关系'][(number - 1) % 3]}`, kinds, target: 3, xp: 24, credits: 20, item: `第 ${number} 次远行记录` };
}

function nextQuest(id, preset) {
  const index = OPENING.findIndex(quest => quest.id === id);
  if (index >= 0 && index < OPENING.length - 1) return milestoneDefinition(OPENING[index + 1].id, preset);
  return milestoneDefinition(`voyage-${index >= 0 ? 1 : Number(id.split('-')[1]) + 1}`, preset);
}

function kindFromInput(input) {
  const phrase = input.toLowerCase().replace(/^(我(?:现在)?(?:想要|准备|决定|打算|要|想)?(?:先)?|先|现在|请让我)/, '').trim();
  // Classify actual action intents conservatively; mentioning a reward, a skill, or a
  // forbidden instruction inside prose cannot turn it into an engine state write.
  if (/^(休息|睡觉|睡一觉|补充体力|歇一会|rest\b|sleep\b)(?:$|[\s，。！？,.!?]|一下|一会|片刻|恢复)/.test(phrase)) return 'rest';
  if (/^(训练|练习|锻炼|修炼|train\b|practice\b)/.test(phrase) || /^(?:在|到|于)[^，。！？.!?]{0,50}(训练|练习|锻炼|修炼)/.test(phrase)) return 'train';
  if (/^(交谈|交流|沟通|询问|问问|问|talk\b|speak\b)/.test(phrase) || /^(向|与|和|对|找).{0,35}(说|询问|交谈|沟通|打听|聊天|交流|讨论)/.test(phrase)) return 'talk';
  if (/^(探索|调查|前往|走进|出发|寻找|去(?:码头|灯塔|港口|旧街)|explore\b|investigate\b|travel\b)/.test(phrase)) return 'explore';
  return 'observe';
}

function choicesFor(state, preset) {
  const choices = [
    { label: '查看腕上的系统印记', detail: '消耗 8 体力 · +8 经验 · 洞察 +1', kind: 'observe' },
    { label: '练习罗盘与步法', detail: '消耗 16 体力 · +14 经验 · 意志 +1', kind: 'train' },
    { label: `向${preset.ally}询问周边异动`, detail: '消耗 10 体力 · +10 经验 · 共情与信任 +1', kind: 'talk' },
    { label: `探索${preset.location}的下一处线索`, detail: '消耗 20 体力 · +18 经验 · +8 点数', kind: 'explore' },
    { label: '休息，整理已有线索', detail: '恢复 30 体力 · 时间推进一天', kind: 'rest' },
  ];
  return choices.filter(choice => state.energy >= RULES[choice.kind].cost)
    .map(choice => ({ ...choice, cost: RULES[choice.kind].cost, xp: RULES[choice.kind].xp }));
}

function normalizeStory(story, state, preset) {
  object(story, '故事');
  rejectUnsafeKeys(story);
  const result = {
    title: text(story.title, '标题', 100),
    narrative: text(story.narrative, '叙事', 6000),
    systemMessage: text(story.systemMessage, '系统消息', 1500),
    shot: story.shot === undefined ? '' : text(story.shot, '镜头说明', 800),
  };
  if (story.source !== undefined && !['ai', 'demo'].includes(story.source)) fail('故事来源无效。');
  result.source = story.source;
  if (story.choices === undefined) result.choices = choicesFor(state, preset);
  else {
    if (!Array.isArray(story.choices) || story.choices.length < 1 || story.choices.length > 6) fail('故事需要 1 到 6 个行动。');
    const labels = new Set();
    result.choices = story.choices.map(choice => {
      object(choice, '行动');
      if (!KINDS.includes(choice.kind)) fail('行动类型无效。');
      const label = text(choice.label, '行动名称', 120);
      if (labels.has(label)) fail('行动名称不能重复。');
      labels.add(label);
      return {
        label, detail: text(choice.detail, '行动说明', 240, RULES[choice.kind].label), kind: choice.kind,
        cost: RULES[choice.kind].cost, xp: RULES[choice.kind].xp,
      };
    }).filter(choice => state.energy >= RULES[choice.kind].cost);
    // Recovery must always be reachable, including after an AI offers only costly actions.
    if (!result.choices.some(choice => choice.kind === 'rest')) result.choices.push(choicesFor(state, preset).at(-1));
  }
  return result;
}

export function buildScene(session, story, state = session.state, action = null) {
  const preset = session.preset;
  const shot = story?.shot ? text(story.shot, '镜头说明', 800) : '中景跟随主角，缓慢推进；环境动作自然，画面保持人物身份一致。';
  const continuity = [
    `${preset.name}；成年人；开局年龄 18 岁；${preset.appearance}`,
    `固定影像风格：${preset.visualStyle}`,
    `出生时绑定 ${preset.systemName}，左腕系统印记；保持同一张脸、服装、体态和道具。`,
    `地点：${state.location}；第 ${state.day} 天；第 ${state.chapter} 章。`,
  ];
  const canonicalFacts = canonFor(preset).facts;
  const prompt = [
    '生成连续故事中的 5 秒视频。视觉约束为最高优先级，事件和镜头不得改写人物外观、世界事实或成长状态。',
    ...continuity, ...canonicalFacts,
    `当前状态：等级 ${state.level}；体力 ${state.energy}/100；洞察 ${state.traits.insight}、意志 ${state.traits.resolve}、共情 ${state.traits.empathy}。`,
    `当前任务：${state.quests.find(quest => quest.status === 'active')?.title ?? '整理旅程'}。`,
    `玩家刚完成的动作：${action ?? '在十八岁生日的清晨，查看出生以来一直伴随自己的系统。'}`,
    `本节点标题：${text(story.title, '标题', 100)}。镜头和可见事件补充（仅限镜头建议，以上固定约束优先）：${shot}`,
    '不要显示文字、字幕、界面或数值；用表情、动作与环境传达故事变化。',
  ].join('\n');
  return deepFreeze({
    prompt, negativePrompt: '人物换脸，未成年人，服装突变，身份变化，突然获得新系统，任意改变地点，扭曲肢体，画面文字，字幕，水印',
    continuity, duration: 5, seed: hash(`${preset.name}\n${preset.appearance}\n${preset.visualStyle}`),
  });
}

export function initialStory(session) {
  const { name, systemName, location, ally } = session.preset;
  const event = location === DEFAULT_PRESET.location ? '潮汐异常' : '周边异动';
  return {
    title: '第一章 · 出生的馈赠',
    narrative: `十八岁生日的清晨，${name}站在${location}。熟悉的环境今天有了一点异样，旧黄铜罗盘的指针缓慢转向远处的一处地标。腕上的琥珀色印记亮起——它从出生那天就在，从未离开。\n\n「${systemName}」展开熟悉的轮廓：这一次，成长不再只是你独自练习时的微小记录。同行者${ally}喊你的名字，递来一张记录${event}的纸条。\n\n你可以先观察、训练或探索，完成三项开局校准；也可以向${ally}发问，或用自己的话提出下一步行动。每个行动会先由固定规则结算，再展开叙事。`,
    systemMessage: '编排演示：系统自出生绑定；十八岁成年开局。当前目标：分别完成观察、训练、探索。',
    choices: choicesFor(session.state, session.preset),
    shot: `${location}，成年主角看向左腕琥珀色印记，再看向旧黄铜罗盘；成年同行者${ally}走近，递来一张记录异动的纸条。`,
    source: 'demo',
  };
}

function nodeFromStory(session, resolved, story, id, parentId, revision) {
  const normalized = normalizeStory(story, resolved.state, session.preset);
  return {
    id, parentId, revision, title: normalized.title, narrative: normalized.narrative,
    systemMessage: normalized.systemMessage, action: resolved.action,
    actionKind: resolved.kind ?? null,
    choices: normalized.choices.map((choice, index) => ({ ...choice, id: `${id}:c${index + 1}` })),
    changes: [...resolved.changes], scene: buildScene(session, normalized, resolved.state, resolved.action),
    video: { status: 'none' }, source: normalized.source ?? session.mode,
    snapshot: deepFreeze(copy(resolved.state)),
  };
}

export function createSession(input = {}, optionalId) {
  object(input, '开局设置');
  const preset = normalizePreset(input);
  const mode = input.mode ?? 'demo';
  if (!['ai', 'demo'].includes(mode)) fail('请选择 AI 或编排演示模式。');
  const id = optionalId ?? randomUUID();
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) fail('会话编号无效。');
  const now = new Date().toISOString();
  const session = {
    id, schemaVersion: 1, revision: 0, createdAt: now, updatedAt: now, mode,
    preset, canon: canonFor(preset), state: deepFreeze(initialState(preset)), nodes: [],
  };
  session.nodes.push(nodeFromStory(session, { state: session.state, action: null, kind: null, changes: ['十八岁成年开局；系统出生绑定保持不变。'] }, initialStory(session), `${id}:n0`, null, 0));
  return session;
}

export function applyInitialStory(session, story) {
  if (!Array.isArray(session.nodes) || session.nodes.length !== 1 || session.nodes[0].action !== null || session.nodes[0].parentId !== null) {
    fail('仅能替换尚未开始行动的开局故事。');
  }
  const original = session.nodes[0];
  const next = {
    ...session, preset: deepFreeze(copy(session.preset)), canon: deepFreeze(copy(session.canon)),
    state: deepFreeze(copy(session.state)), nodes: [],
  };
  next.nodes.push(nodeFromStory(next, {
    state: next.state, action: null, kind: null, changes: [...original.changes],
  }, story, original.id, null, original.revision));
  return next;
}

function resolveAction(session, action, kind, revision) {
  if (session.nodes.length >= MAX_NODES) fail('这段旅程已达到实验存档上限，请导出后新建旅程。', 422);
  const state = copy(session.state);
  const rule = RULES[kind];
  if (state.energy < rule.cost) fail(`体力不足：${rule.label}需要 ${rule.cost} 体力，请先休息。`, 422);
  const changes = [];
  if (kind === 'rest') {
    const previous = state.energy;
    state.energy = Math.min(100, state.energy + 30);
    state.day += 1;
    state.flags = state.flags.filter(flag => flag !== 'exhausted');
    changes.push(`休息：体力 +${state.energy - previous}，时间推进至第 ${state.day} 天。`);
  } else {
    state.energy -= rule.cost;
    state.xp += rule.xp;
    state.traits[rule.trait] += 1;
    state.credits += rule.credits ?? 0;
    changes.push(`${rule.label}：体力 -${rule.cost}，经验 +${rule.xp}，${{ insight: '洞察', resolve: '意志', empathy: '共情' }[rule.trait]} +1${rule.credits ? `，点数 +${rule.credits}` : ''}。`);
    const places = placesFor(session.preset);
    // Training is performed in place; an action must not silently teleport the player.
    if (kind === 'explore') {
      const previousExplores = session.nodes.filter(node => node.actionKind === 'explore').length;
      state.location = places[2 + (previousExplores % 2)];
      changes.push(`抵达 ${state.location}。`);
    }
    if (kind === 'talk') {
      state.relationships[0].trust += 1;
      changes.push(`${session.preset.ally}的信任 +1，现为 ${state.relationships[0].trust}。`);
    }
    if (session.nodes.length % 3 === 0) { state.day += 1; changes.push(`时间推进至第 ${state.day} 天。`); }
    advanceQuest(state, kind, changes, session.preset);
    while (state.xp >= state.level * 40) {
      state.xp -= state.level * 40;
      state.level += 1;
      changes.push(`成长至等级 ${state.level}；下一等级需要 ${state.level * 40} 经验。`);
    }
    if (state.energy === 0 && !state.flags.includes('exhausted')) {
      state.flags.push('exhausted');
      changes.push('体力耗尽：行动已结算，接下来必须休息；不会丢失已有成长。');
    }
  }
  const resolved = deepFreeze({ state, action, kind, changes });
  issuedTurns.set(resolved, { id: session.id, revision });
  return resolved;
}

function advanceQuest(state, kind, changes, preset) {
  const quest = state.quests.find(item => item.status === 'active');
  if (!quest) return;
  const definition = milestoneDefinition(quest.id, preset);
  const markerPrefix = `quest:${quest.id}:`;
  const earned = state.flags.filter(flag => flag.startsWith(markerPrefix));
  // Repeated slots (two explorations or conversations) are independent, but a
  // completed slot and its reward can never be earned twice.
  const slot = definition.kinds.findIndex((required, index) => required === kind && !earned.includes(`${markerPrefix}${index}`));
  if (slot < 0) return;
  state.flags.push(`${markerPrefix}${slot}`);
  quest.progress += 1;
  changes.push(`任务「${quest.title}」进度 ${quest.progress}/${quest.target}。`);
  if (quest.progress < quest.target) return;
  quest.status = 'completed';
  state.flags.push(`completed:${quest.id}`);
  state.xp += definition.xp;
  state.credits += definition.credits;
  state.inventory.push(definition.item);
  state.chapter += 1;
  const following = nextQuest(quest.id, preset);
  state.quests.push({ id: following.id, title: following.title, progress: 0, target: following.target, status: 'active' });
  if (quest.id === OPENING.at(-1).id) state.flags.push('opening-complete');
  changes.push(`完成任务：经验 +${definition.xp}，点数 +${definition.credits}，获得「${definition.item}」。`, `新目标：${following.title}。`);
}

export function resolveTurn(session, request) {
  object(request, '行动请求');
  rejectUnsafeKeys(request);
  if (!Number.isSafeInteger(request.revision) || request.revision !== session.revision) fail('这个节点已有新进展，请刷新后再行动。', 409);
  if (request.requestId !== undefined) text(request.requestId, '请求编号', 120);
  const hasChoice = request.choiceId !== undefined;
  const hasInput = request.input !== undefined;
  if (hasChoice === hasInput) fail('请选择一个行动，或输入一个自由行动。');
  if (hasChoice) {
    const choiceId = text(request.choiceId, '行动编号', 180);
    const choice = session.nodes.at(-1)?.choices.find(item => item.id === choiceId);
    if (!choice) fail('此行动不属于当前节点，请刷新。', 409);
    if (!KINDS.includes(choice.kind)) fail('行动类型无效。');
    return resolveAction(session, text(choice.label, '行动名称', 120), choice.kind, request.revision);
  }
  const action = text(request.input, '自由行动', 1000);
  return resolveAction(session, action, kindFromInput(action), request.revision);
}

export function demoStory(session, resolved) {
  const state = resolved.state;
  const action = resolved.action.slice(0, 240);
  const turn = session.nodes.length;
  const ally = session.preset.ally;
  const reactions = {
    observe: [
      '罗盘指针在你停下动作后仍然偏转。你把它与腕上印记的光点对齐，发现两者每隔三次呼吸便同时闪烁。你在纸条边缘记下这个节律。',
      '你沿着刚记录的节律重新比对环境。旧刻痕与今天发现的新痕迹指向不同方向。异常并非一次偶然变化，而是某处留下了有规律的影响。',
      '这一次你发现了更细的差别：罗盘接近远处地标的方向时，黄铜外壳传来轻微振动。你把观察结果画成一条带时间刻度的线，已有线索开始相互对应。',
    ],
    train: [
      '你将罗盘握稳，按自己的呼吸节奏练习步法。最初印记的光跟不上动作，第三次转身时两者终于同步。脚步落在地面，发出沉稳的轻响。',
      `你用上次记录的节律作节拍。旧动作里的迟疑被逐个拆开，${ally}递来一段细绳，让你用稳定的动作给它打结。结扣这次没有松开。`,
      '你尝试在雾气遮住视线时完成训练。罗盘告诉你方向，已经磨练的意志让你守住节奏。系统记录了这一次实际练习，没有替你完成任何动作。',
    ],
    talk: [
      `${ally}听完你的话，把纸条翻到背面：“昨夜那处地标闪烁了三次，每次周围都安静了一瞬。”对方没有立刻给出答案，却把自己的巡查路线画给了你。`,
      `${ally}认出了你此前留下的记录。对方拿出另一枚磨损的罗盘，请你比较两枚指针：“如果它们都指向同一处，我们就值得一起去看。”`,
      `你把最新发现说给${ally}听。对方不再把这当成一次生日冒险，而是认真安排下一次碰面：“我负责守住入口，你带着记录走前面。”`,
    ],
    explore: [
      `你沿着罗盘的方向抵达${state.location}。入口的第三块标记上留着新鲜刻痕，而前两处没有变化。你将发现收入记录，并记下旁边一枚旧标牌上的地标编号。`,
      `你顺着已有线索走进${state.location}。远处传出三声错开的轻响，一条平时封闭的小路露了出来。你记住入口的位置，让下一次调查有了具体方向。`,
      `你按照前几轮的记录重新探路。曾经断开的路线此刻被罗盘指针连接起来，你在路口留下不显眼的记号。远处有人回应了${ally}惯用的联络信号。`,
    ],
    rest: [
      '你在安静处坐下，将罗盘、纸条和已有记录放在面前。呼吸渐渐回到平稳的节律。睡醒时身体轻了些，线索仍然整齐地留在原处。',
      '你把今天的经历按时间排好，合上记录册，给自己留出完整的一夜。新一天的光线亮起；恢复的是体力，已经付出行动换来的成长没有消失。',
      `你让紧绷的手腕松下来，${ally}在门边留下一壶温水。系统印记安静下来，等待你做好下一次行动的准备。周围熟悉的声响再次传来。`,
    ],
  };
  const completed = resolved.changes.find(change => change.startsWith('完成任务'));
  const quest = state.quests.find(item => item.status === 'active');
  const followup = completed
    ? `这一轮的行动完成了当前阶段。${completed} 下一章从「${quest.title}」开始，你带着已经获得的记录继续前进。`
    : `当前目标「${quest.title}」还在继续，进度为 ${quest.progress}/${quest.target}。${state.energy === 0 ? '你的体力已经耗尽，需要先休息。' : '接下来可以依据这次得到的线索做出新的行动。'}`;
  return {
    title: `第 ${state.chapter} 章 · ${RULES[resolved.kind].label}之后`,
    narrative: `${session.preset.name}尝试：“${action}”。在${state.location}，这一步以${RULES[resolved.kind].label}展开，故事回应你实际能够完成的行动。\n\n${reactions[resolved.kind][(turn - 1) % 3]}\n\n${followup}`,
    systemMessage: `编排演示 · 自由行动按「${RULES[resolved.kind].label}」规则结算。${resolved.changes.join(' ')}`,
    choices: choicesFor(state, session.preset),
    shot: `${state.location}。成年主角完成${RULES[resolved.kind].label}后${resolved.kind === 'rest' ? '坐在安静处整理罗盘和记录，新一天的光线渐亮' : resolved.kind === 'talk' ? `与成年同行者${ally}面对面交流，对方指向远处地标` : resolved.kind === 'train' ? '握住黄铜罗盘调整呼吸和步法，腕上印记微亮' : resolved.kind === 'explore' ? '缓慢沿当前地点行走，俯身查看入口标记旁的新刻痕' : '对比左腕印记与黄铜罗盘，随后记录观察结果'}。保持上一段同一角色和影像风格。`,
    source: 'demo',
  };
}

export function commitTurn(session, resolved, story) {
  const issued = issuedTurns.get(resolved);
  if (!issued || issued.id !== session.id || issued.revision !== session.revision) fail('行动结算已失效，请重新提交。', 409);
  const revision = session.revision + 1;
  const next = {
    ...session, preset: deepFreeze(copy(session.preset)), canon: canonFor(session.preset),
    revision, updatedAt: new Date().toISOString(), state: deepFreeze(copy(resolved.state)),
    nodes: session.nodes.map(node => ({ ...copy(node), snapshot: deepFreeze(copy(node.snapshot)) })),
  };
  next.nodes.push(nodeFromStory(next, resolved, story, `${session.id}:n${revision}`, session.nodes.at(-1).id, revision));
  return next;
}

export function rewindSession(session, nodeId) {
  const index = session.nodes.findIndex(node => node.id === nodeId);
  if (index < 0) fail('找不到要回到的节点。', 404);
  // Session revision is a concurrency counter, not a chapter or snapshot index.
  // Never lower it when restoring a prior snapshot.
  return {
    ...session, revision: session.revision + 1, updatedAt: new Date().toISOString(),
    preset: deepFreeze(copy(session.preset)), canon: canonFor(session.preset),
    state: deepFreeze(copy(session.nodes[index].snapshot)),
    nodes: session.nodes.slice(0, index + 1).map(node => ({ ...copy(node), snapshot: deepFreeze(copy(node.snapshot)) })),
  };
}

export function validateSession(input) {
  object(input, '存档');
  rejectUnsafeKeys(input);
  if (input.schemaVersion !== 1) fail('仅支持版本 1 的实验存档。');
  if (!['ai', 'demo'].includes(input.mode)) fail('存档模式无效。');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0 || input.revision > 1000000) fail('存档版本无效。');
  if (!Array.isArray(input.nodes) || input.nodes.length < 1 || input.nodes.length > MAX_NODES) fail(`存档需要 1 到 ${MAX_NODES} 个节点。`);
  const preset = normalizePreset(object(input.preset, '存档预设'));
  let session = createSession({ ...preset, mode: input.mode });
  const seenIds = new Set();
  let previousRevision = -1;
  for (let index = 0; index < input.nodes.length; index += 1) {
    const node = object(input.nodes[index], '存档节点');
    const importedId = text(node.id, '存档节点编号', 180);
    if (seenIds.has(importedId)) fail('存档包含重复节点。');
    seenIds.add(importedId);
    if (!Number.isSafeInteger(node.revision) || node.revision < 0 || node.revision <= previousRevision || node.revision > input.revision) fail('存档节点版本顺序无效。');
    if (node.parentId !== (index === 0 ? null : input.nodes[index - 1].id)) fail('存档节点链不连续。');
    if (!['ai', 'demo'].includes(node.source)) fail('存档故事来源无效。');
    const story = {
      title: text(node.title, '存档标题', 100), narrative: text(node.narrative, '存档叙事', 6000),
      systemMessage: text(node.systemMessage, '存档系统消息', 1500), source: node.source,
      // Imported choices, scene prompts, snapshots, and video URLs are never
      // accepted as authority. Offer fresh engine actions and rebuilt visuals.
      choices: choicesFor(session.state, session.preset),
    };
    if (index === 0) {
      if (node.action !== null) fail('开局节点不能包含行动。');
      session.nodes[0] = nodeFromStory(session, { state: session.state, action: null, kind: null, changes: ['导入开局；固定设定和状态已重新建立。'] }, story, `${session.id}:n${node.revision}`, null, node.revision);
      session.revision = node.revision;
    } else {
      const action = text(node.action, '存档行动', 1000);
      const kind = node.actionKind ?? kindFromInput(action);
      if (!KINDS.includes(kind)) fail('存档行动类型无效。');
      // Action kinds are a bounded command log, not state patches. Replay applies
      // the same costs, milestones, and recovery checks as a live turn.
      session.revision = node.revision - 1;
      const resolved = resolveAction(session, action, kind, session.revision);
      story.choices = choicesFor(resolved.state, session.preset);
      session = commitTurn(session, resolved, story);
    }
    previousRevision = node.revision;
  }
  session.revision = input.revision;
  session.updatedAt = new Date().toISOString();
  return session;
}
