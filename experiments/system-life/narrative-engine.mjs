import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const MAX_NODES = 400;
const issuedActions = new WeakMap();
const ID = /^[-a-zA-Z0-9_]{1,80}$/;
const PRESET_LIMITS = { name: 40, background: 1800, systemName: 60, location: 80, ally: 60 };
const GENRES = {
  urban: { name: '林渡', background: '你出生于雾港，从出生起便与隐秘系统绑定。十八岁生日的雨夜，旧街地铁发生异常停电，被困乘客的呼救与一段不可能存在的回声同时传来。你的每个选择都可能改变同行者、幸存者和异能局对你的态度。', systemName: '回声系统', location: '雾港 · 旧街地铁站', ally: '苏槐' },
  cultivation: { name: '林渡', background: '你出生时便绑定一个隐秘的成长系统。十八岁时，山门旧矿道传来异常回声，困在其中的药童急需救援；宗门监察者正追查异动。力量需要行动与代价，系统从不代替你做决定。', systemName: '因果系统', location: '青岚山 · 旧矿道', ally: '苏槐' },
  business: { name: '林渡', background: '你出生起便拥有隐秘的成长系统。十八岁接手旧街小店的雨夜，仓库断电并困住一名送货员，账单上出现无法解释的重复货号。行业监察组、供货人和你的伙伴会回应你的经营选择。', systemName: '经营系统', location: '雾港 · 旧街仓库', ally: '苏槐' },
};
export const DEFAULT_PRESET = freeze({ ...GENRES.urban, genre: 'urban' });

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function clone(value) { return structuredClone(value); }
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label}必须是普通对象。`); return value; }
function safe(value, depth = 0, seen = new WeakSet()) {
  if (value === undefined || value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('数据包含非法数值。'); return; }
  if (typeof value !== 'object' || depth > 25 || seen.has(value)) fail('数据类型、层级或循环引用无效。');
  seen.add(value); if (!Array.isArray(value)) object(value, '数据');
  for (const [key, item] of Object.entries(value)) { if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('数据包含禁止的属性。'); safe(item, depth + 1, seen); } seen.delete(value);
}
function keys(value, allowed, label) { object(value, label); for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}不支持 ${key} 字段。`); }
function string(value, label, max = 500, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(`${label}需要 1 到 ${max} 个有效字符。`);
  return value.trim();
}
function id(value, label = '编号') { const result = string(value, label, 80); if (!ID.test(result)) fail(`${label}格式无效。`); return result; }
function integer(value, label, min, max, fallback) { if (value === undefined && fallback !== undefined) return fallback; if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}必须介于 ${min} 和 ${max}。`); return value; }
function array(value, label, max = 30, min = 0) { if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label}数量必须介于 ${min} 和 ${max}。`); return value; }
function unique(list, label, field = 'id') { const seen = new Set(); for (const item of list) { const key = field ? item[field] : item; if (seen.has(key)) fail(`${label}不能重复。`); seen.add(key); } return list; }
function same(a, b) { return isDeepStrictEqual(a, b); }

export function normalizePreset(input = {}) {
  safe(input); keys(input, [...Object.keys(PRESET_LIMITS), 'genre', 'mode'], '开局预设');
  const genre = input.genre ?? 'urban'; if (!Object.hasOwn(GENRES, genre)) fail('背景类型必须是都市异能、修仙或经营。');
  return freeze({ ...Object.fromEntries(Object.entries(PRESET_LIMITS).map(([key, max]) => [key, string(input[key], key, max, GENRES[genre][key])])), genre });
}
function canonFor(preset) { return { facts: [
  `主角是${preset.name}，可游玩故事从十八岁成年时开始。`,
  `「${preset.systemName}」自出生便已与主角绑定；绑定关系和时间不可改写。`,
  `开局地点：${preset.location}；初始成年同行者：${preset.ally}。`,
  `世界背景：${preset.background}`,
  '系统发布目标和预先承诺的奖励；玩家选择行动，目标依据实际发生的事件推进。能力、物品和积分由已完成目标的奖励结算，不因发言自动增长。',
] }; }
function initialState(preset) { return { chapter: 1, day: 1, location: preset.location, energy: 100, credits: 0, quests: [], abilities: [], inventory: [], relationships: [{ id: 'ally', name: preset.ally, trust: 0, stance: '同行，尚待建立共同立场' }], facts: [], threads: [], summary: '出生绑定的系统等待这次事件中的实际行动。', rewardLedger: [], consequenceLedger: [], status: 'active' }; }
export function createSession(input = {}, optionalId) {
  const preset = normalizePreset(input), mode = input.mode ?? 'demo'; if (!['ai', 'demo'].includes(mode)) fail('请选择 AI 或编排演示模式。');
  const sessionId = optionalId ?? randomUUID(); if (typeof sessionId !== 'string' || !/^[-a-zA-Z0-9_]{1,100}$/.test(sessionId)) fail('会话编号无效。');
  const now = new Date().toISOString(); return freeze({ id: sessionId, schemaVersion: 2, revision: 0, createdAt: now, updatedAt: now, mode, preset, canon: canonFor(preset), state: initialState(preset), nodes: [] });
}
function asset(value, label) { keys(value, ['id', 'name', 'description'], label); return { id: id(value.id), name: string(value.name, `${label}名称`, 80), description: string(value.description, `${label}说明`, 500) }; }
function quest(value) {
  keys(value, ['id', 'title', 'description', 'requirements', 'reward', 'status', 'resolution'], '新目标');
  if (value.status !== 'active' || value.resolution !== undefined) fail('新目标只能以未结算状态发布。');
  keys(value.reward, ['credits', 'ability', 'item'], '目标奖励');
  const requirements = unique(array(value.requirements, '目标要求', 4, 2).map(req => { keys(req, ['id', 'text', 'done'], '目标要求'); if (req.done !== false) fail('新目标要求不能提前完成。'); return { id: id(req.id), text: string(req.text, '目标要求', 300), done: false }; }), '目标要求');
  const reward = { credits: integer(value.reward.credits, '目标积分奖励', 0, 100) };
  if (value.reward.ability !== undefined) reward.ability = asset(value.reward.ability, '能力奖励');
  if (value.reward.item !== undefined) reward.item = asset(value.reward.item, '物品奖励');
  return { id: id(value.id), title: string(value.title, '目标标题', 100), description: string(value.description, '目标描述', 800), requirements, reward, status: 'active' };
}
function proposal(raw, opening = false) {
  safe(raw); keys(raw, ['title', 'narrative', 'outcome', 'systemMessage', 'choices', 'events', 'resolution', 'scene'], '剧情提案');
  keys(raw.outcome, ['type', 'reason'], '行动结果');
  if (!(opening ? ['opening'] : ['success', 'partial', 'failure', 'refused']).includes(raw.outcome.type)) fail('行动结果类型与当前阶段不符。');
  const events = unique(array(raw.events, '本轮事件', 12).map(event => { keys(event, ['id', 'text'], '事件'); return { id: id(event.id, '事件编号'), text: string(event.text, '事件描述', 900) }; }), '本轮事件');
  const eventIds = new Set(events.map(event => event.id));
  function evidence(value) { const eventId = id(value, '事件证据'); if (!eventIds.has(eventId)) fail('结算必须引用本轮实际事件，不能引用旧事件或杜撰证据。'); return eventId; }
  const choices = unique(array(raw.choices, '下一步选择', 4, 2).map(choice => { keys(choice, ['label', 'detail', 'stakes', 'route'], '选择'); return { label: string(choice.label, '选择名称', 140), detail: string(choice.detail, '选择说明', 350), stakes: string(choice.stakes, '选择利弊', 350), route: id(choice.route, '选择路线') }; }), '选择名称', 'label');
  if (new Set(choices.map(choice => choice.route)).size < 2) fail('下一步必须提供不同的剧情路线。');
  const rawResolution = raw.resolution; keys(rawResolution, ['progress', 'failures', 'energyDelta', 'spendCredits', 'location', 'dayDelta', 'relationships', 'newFacts', 'newThreads', 'closeThreads', 'newQuests', 'summary'], '剧情结算');
  const resolution = {
    progress: array(rawResolution.progress, '目标进展', 12).map(item => { keys(item, ['questId', 'requirementId', 'eventId'], '目标进展'); return { questId: id(item.questId), requirementId: id(item.requirementId), eventId: evidence(item.eventId) }; }),
    failures: array(rawResolution.failures, '目标失败', 4).map(item => { keys(item, ['questId', 'reason', 'eventId'], '目标失败'); return { questId: id(item.questId), reason: string(item.reason, '失败原因', 500), eventId: evidence(item.eventId) }; }),
    energyDelta: integer(rawResolution.energyDelta, '体力变化', -25, 30), spendCredits: integer(rawResolution.spendCredits, '支出积分', 0, 50), dayDelta: integer(rawResolution.dayDelta, '经过天数', 0, 2),
    relationships: unique(array(rawResolution.relationships, '关系变化', 6).map(item => { keys(item, ['id', 'name', 'trustDelta', 'stance', 'eventId'], '关系变化'); return { id: id(item.id), name: string(item.name, '人物姓名', 80), trustDelta: integer(item.trustDelta, '信任变化', -10, 10), stance: string(item.stance, '关系态度', 300), eventId: evidence(item.eventId) }; }), '关系变化'),
    newFacts: unique(array(rawResolution.newFacts, '新事实', 8).map(item => { keys(item, ['id', 'text', 'eventId'], '新事实'); return { id: id(item.id), text: string(item.text, '新事实', 800), eventId: evidence(item.eventId) }; }), '新事实'),
    newThreads: unique(array(rawResolution.newThreads, '新线索', 6).map(item => { keys(item, ['id', 'text'], '新线索'); return { id: id(item.id), text: string(item.text, '线索说明', 800) }; }), '新线索'),
    closeThreads: unique(array(rawResolution.closeThreads, '关闭线索', 8).map(value => id(value)), '关闭线索', null),
    newQuests: unique(array(rawResolution.newQuests, '新目标', 2).map(quest), '新目标'), summary: string(rawResolution.summary, '故事摘要', 3000),
  };
  unique(resolution.progress.map(item => ({ id: `${item.questId}:${item.requirementId}` })), '目标进展'); unique(resolution.failures, '目标失败', 'questId');
  if (rawResolution.location !== undefined) resolution.location = string(rawResolution.location, '地点', 120);
  if (opening && (resolution.progress.length || resolution.failures.length || resolution.energyDelta || resolution.spendCredits || resolution.dayDelta || resolution.relationships.some(item => item.trustDelta))) fail('开局只能发布背景与目标，不能提前结算行动。');
  if (['failure', 'refused'].includes(raw.outcome.type) && resolution.progress.length) fail('失败或拒绝的行动不能推进目标要求或发放奖励。');
  if (raw.outcome.type === 'refused' && (resolution.energyDelta || resolution.spendCredits || resolution.dayDelta || resolution.relationships.length || resolution.failures.length || resolution.newFacts.length || resolution.newThreads.length || resolution.closeThreads.length || resolution.newQuests.length)) fail('未执行的请求不能改变目标、人物关系、事实或资源。');
  if (!events.length && (resolution.energyDelta || resolution.spendCredits || resolution.dayDelta || resolution.progress.length || resolution.failures.length || resolution.newQuests.length || resolution.newThreads.length || resolution.closeThreads.length)) fail('没有实际事件的回合不能改变世界或资源。');
  const result = { title: string(raw.title, '标题', 100), narrative: string(raw.narrative, '剧情', 8000), outcome: { type: raw.outcome.type, reason: string(raw.outcome.reason, '结果依据', 900) }, systemMessage: string(raw.systemMessage, '系统消息', 1500), choices, events, resolution };
  if (raw.scene !== undefined) { keys(raw.scene, ['description'], '场景'); result.scene = { description: string(raw.scene.description, '场景说明', 1200) }; }
  return result;
}
function resolve(state, proposed, opening = false) {
  const next = clone(state), changes = [], res = proposed.resolution;
  if (!proposed.events.length && res.location && res.location !== state.location) fail('没有实际事件不能改变地点。');
  if (proposed.outcome.type === 'refused' && res.location && res.location !== state.location) fail('未执行的请求不能改变地点。');
  if (res.spendCredits > next.credits) fail('积分支出超过当前可用余额。');
  const failed = new Set(res.failures.map(item => item.questId));
  for (const item of res.progress) {
    const goal = next.quests.find(goal => goal.id === item.questId);
    if (!goal || goal.status !== 'active' || failed.has(goal.id)) fail('只能推进本轮开始时已有、仍在进行的目标。');
    const requirement = goal.requirements.find(req => req.id === item.requirementId);
    if (!requirement || requirement.done) fail('目标要求不存在或已经完成。');
    requirement.done = true; changes.push(`目标「${goal.title}」：${requirement.text} ✓`);
  }
  for (const item of res.failures) {
    const goal = next.quests.find(goal => goal.id === item.questId); if (!goal || goal.status !== 'active') fail('只能失败尚在进行的目标。');
    goal.status = 'failed'; goal.resolution = item.reason; changes.push(`目标「${goal.title}」失败：${item.reason}`);
  }
  next.credits -= res.spendCredits; if (res.spendCredits) changes.push(`积分支出 ${res.spendCredits}。`);
  let completed = 0;
  for (const goal of next.quests) {
    if (goal.status !== 'active' || !goal.requirements.every(req => req.done)) continue;
    if (next.rewardLedger.includes(goal.id)) fail('目标奖励已结算，不能重复领取。');
    goal.status = 'completed'; goal.resolution = proposed.outcome.reason; next.rewardLedger.push(goal.id); completed += 1; next.credits += goal.reward.credits;
    const rewards = [`积分 +${goal.reward.credits}`];
    for (const [key, target] of [['ability', 'abilities'], ['item', 'inventory']]) if (goal.reward[key]) {
      if (next[target].some(item => item.id === goal.reward[key].id)) fail('奖励编号与既有能力或物品重复。');
      next[target].push(clone(goal.reward[key])); rewards.push(`获得「${goal.reward[key].name}」`);
    }
    changes.push(`完成「${goal.title}」：${rewards.join('，')}。`);
  }
  const beforeEnergy = next.energy; next.energy = Math.max(0, Math.min(100, next.energy + res.energyDelta)); if (beforeEnergy !== next.energy) changes.push(`体力 ${next.energy - beforeEnergy > 0 ? '+' : ''}${next.energy - beforeEnergy}。`);
  next.day += res.dayDelta; if (res.dayDelta) changes.push(`时间来到第 ${next.day} 天。`);
  if (res.location && res.location !== next.location) { next.location = res.location; changes.push(`来到 ${res.location}。`); }
  for (const item of res.relationships) {
    let relationship = next.relationships.find(person => person.id === item.id);
    if (!relationship) { if (next.relationships.length >= 24) fail('人物关系已达到存档上限。'); relationship = { id: item.id, name: item.name, trust: 0, stance: item.stance }; next.relationships.push(relationship); }
    if (relationship.name !== item.name) fail('不能改写已存在人物的姓名。');
    const previousTrust = relationship.trust; relationship.trust = Math.max(-100, Math.min(100, relationship.trust + item.trustDelta)); relationship.stance = item.stance;
    const actualDelta = relationship.trust - previousTrust;
    changes.push(`${relationship.name}：${item.stance}${actualDelta ? `（信任 ${actualDelta > 0 ? '+' : ''}${actualDelta}）` : ''}。`);
  }
  for (const item of res.newFacts) {
    const existing = next.facts.find(fact => fact.id === item.id); if (existing) { if (existing.text !== item.text) fail('已确认事实不能改写。'); continue; }
    next.facts.push({ id: item.id, text: item.text });
  }
  for (const itemId of res.closeThreads) if (!next.threads.some(thread => thread.id === itemId)) fail('只能关闭已存在的线索。');
  next.threads = next.threads.filter(thread => !res.closeThreads.includes(thread.id));
  for (const item of res.newThreads) { if (next.threads.some(thread => thread.id === item.id)) fail('新线索编号不能重复。'); next.threads.push(clone(item)); }
  const activeCount = next.quests.filter(goal => goal.status === 'active').length;
  if (activeCount + res.newQuests.length > 2) fail('同时进行的目标最多两个。');
  for (const goal of res.newQuests) {
    if (next.quests.some(existing => existing.id === goal.id)) fail('目标编号不能重复或重新领取。');
    for (const [key, target] of [['ability', 'abilities'], ['item', 'inventory']]) if (goal.reward[key]) {
      const rewardId = goal.reward[key].id;
      if (next[target].some(existing => existing.id === rewardId) || next.quests.some(existing => existing.status === 'active' && existing.reward[key]?.id === rewardId)) fail('新目标奖励编号与现有或已承诺的能力、物品重复。');
    }
    next.quests.push(clone(goal)); changes.push(`新目标：${goal.title}。`);
  }
  if (opening && (next.quests.length < 1 || next.quests.length > 2)) fail('开局需要一个或两个具体目标。');
  if (next.quests.length > 100 || next.facts.length > 300 || next.threads.length > 60 || next.rewardLedger.length > 100 || next.abilities.length > 100 || next.inventory.length > 100 || next.day > 100000 || next.credits > 10000) fail('故事状态超过实验存档上限。');
  next.chapter += completed; next.status = next.quests.some(goal => goal.status === 'active') ? 'active' : 'chapter-complete'; next.summary = res.summary;
  if (proposed.outcome.type !== 'opening' && proposed.events.length) next.consequenceLedger.push(...proposed.events.map((event, index) => ({ id: `turn-${state.consequenceLedger.length + index + 1}`, text: event.text })));
  if (next.consequenceLedger.length > 2400) fail('故事事件超过实验存档上限。');
  return { state: next, changes };
}
function node(session, proposed, resolved, action, revision) {
  const nodeId = `${session.id}:n${revision}`;
  return { id: nodeId, parentId: session.nodes.at(-1)?.id ?? null, revision, title: proposed.title, narrative: proposed.narrative, action, outcome: proposed.outcome, systemMessage: proposed.systemMessage, choices: proposed.choices.map((choice, index) => ({ id: `${nodeId}:c${index + 1}`, ...choice })), changes: resolved.changes, events: proposed.events, source: session.mode, snapshot: clone(resolved.state), resolution: clone(proposed.resolution), ...(proposed.scene ? { scene: proposed.scene } : {}) };
}
export function applyOpening(session, raw) {
  if (session.schemaVersion !== 2 || session.nodes.length || session.revision !== 0) fail('开局只能应用于尚未开始的故事。', 409);
  const proposed = proposal(raw, true), resolved = resolve(session.state, proposed, true);
  return freeze({ ...clone(session), state: resolved.state, nodes: [node(session, proposed, resolved, null, 0)], updatedAt: new Date().toISOString() });
}
export function prepareAction(session, request) {
  safe(request); keys(request, ['revision', 'choiceId', 'input', 'requestId'], '行动请求');
  if (!Number.isSafeInteger(request.revision) || request.revision !== session.revision) fail('剧情已有新进展，请刷新后再行动。', 409);
  if (!session.nodes.length || session.nodes.length >= MAX_NODES) fail('故事尚未开局或已达到节点上限。', 422);
  if ((request.choiceId !== undefined) === (request.input !== undefined)) fail('请选择一个行动，或输入你的行动。');
  let choice = null, action;
  if (request.choiceId !== undefined) { const choiceId = string(request.choiceId, '选择编号', 180); choice = session.nodes.at(-1).choices.find(item => item.id === choiceId); if (!choice) fail('该选择不属于当前节点，请刷新。', 409); action = choice.label; }
  else action = string(request.input, '自由行动', 1200);
  const prepared = freeze({ action, choice: choice ? clone(choice) : null, revision: request.revision });
  issuedActions.set(prepared, { session, revision: session.revision, fingerprint: JSON.stringify(session) }); return prepared;
}
export function applyTurn(session, prepared, raw) {
  const issued = issuedActions.get(prepared); if (!issued || issued.session !== session || issued.revision !== session.revision || issued.fingerprint !== JSON.stringify(session)) fail('行动请求已失效或未经验证。', 409);
  const proposed = proposal(raw), resolved = resolve(session.state, proposed), revision = session.revision + 1;
  const next = freeze({ ...clone(session), revision, updatedAt: new Date().toISOString(), state: resolved.state, nodes: [...clone(session.nodes), node(session, proposed, resolved, prepared.action, revision)] });
  issuedActions.delete(prepared); return next;
}
export function rewindSession(session, nodeId) {
  const index = session.nodes.findIndex(item => item.id === nodeId); if (index < 0) fail('找不到要回到的剧情节点。', 404);
  return freeze({ ...clone(session), revision: session.revision + 1, updatedAt: new Date().toISOString(), nodes: clone(session.nodes.slice(0, index + 1)), state: clone(session.nodes[index].snapshot) });
}

export function validateSession(input) {
  safe(input); keys(input, ['id', 'schemaVersion', 'revision', 'createdAt', 'updatedAt', 'mode', 'preset', 'canon', 'state', 'nodes'], '存档');
  if (input.schemaVersion !== 2) fail('仅支持剧情实验 v2 存档；旧版五类行动存档请继续在原实验中查看。');
  if (!['ai', 'demo'].includes(input.mode)) fail('存档模式无效。');
  integer(input.revision, '存档版本', 0, 1000000);
  for (const field of ['createdAt', 'updatedAt']) if (typeof input[field] !== 'string' || !Number.isFinite(Date.parse(input[field]))) fail('存档时间无效。');
  const importedNodes = array(input.nodes, '存档节点', MAX_NODES, 1);
  let session = createSession({ ...normalizePreset(input.preset), mode: input.mode });
  if (!same(input.canon, session.canon)) fail('存档改写了出生绑定或固定世界背景。');
  const seen = new Set(), seenRequests = new Set(); let previousRevision = -1;
  for (const [index, saved] of importedNodes.entries()) {
    keys(saved, ['id', 'parentId', 'revision', 'title', 'narrative', 'action', 'outcome', 'systemMessage', 'choices', 'changes', 'events', 'source', 'snapshot', 'resolution', 'scene', 'requestId'], '存档节点');
    if (saved.requestId !== undefined && (typeof saved.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved.requestId))) fail('存档请求编号无效。');
    if (saved.requestId !== undefined) { if (seenRequests.has(saved.requestId) || index === 0) fail('存档请求编号重复或位于开局。'); seenRequests.add(saved.requestId); }
    const oldId = string(saved.id, '剧情节点编号', 180); if (seen.has(oldId)) fail('剧情节点编号不能重复。'); seen.add(oldId);
    const revision = integer(saved.revision, '节点版本', 0, input.revision);
    if (revision <= previousRevision || (index === 0 && revision !== 0)) fail('存档节点版本顺序无效。');
    if (saved.parentId !== (index === 0 ? null : importedNodes[index - 1].id)) fail('存档剧情链不连续。');
    if (!['ai', 'demo'].includes(saved.source)) fail('剧情来源无效。');
    const choiceIds = new Set();
    const choices = array(saved.choices, '存档选择', 4, 2).map(choice => {
      keys(choice, ['id', 'label', 'detail', 'stakes', 'route'], '存档选择'); const choiceId = string(choice.id, '选择编号', 180);
      if (choiceIds.has(choiceId)) fail('存档选择编号重复。'); choiceIds.add(choiceId);
      return { label: choice.label, detail: choice.detail, stakes: choice.stakes, route: choice.route };
    });
    const proposed = proposal({ title: saved.title, narrative: saved.narrative, outcome: saved.outcome, systemMessage: saved.systemMessage, choices, events: saved.events, resolution: saved.resolution, ...(saved.scene ? { scene: saved.scene } : {}) }, index === 0);
    if (index === 0 && saved.action !== null) fail('开局不能包含玩家行动。');
    const action = index === 0 ? null : string(saved.action, '存档玩家行动', 1200);
    const resolved = resolve(session.state, proposed, index === 0);
    if (!same(resolved.state, saved.snapshot)) fail('存档快照与事件结算不一致，不能导入伪造的积分、能力或任务进度。');
    if (!same(resolved.changes, saved.changes)) fail('存档变化记录与事件结算不一致。');
    const restoredNode = node(session, proposed, resolved, action, revision); restoredNode.source = saved.source;
    session = { ...session, revision, state: resolved.state, nodes: [...session.nodes, restoredNode] }; previousRevision = revision;
  }
  if (!same(input.state, session.state)) fail('存档当前状态与最后剧情快照不一致。');
  return freeze({ ...session, revision: input.revision, updatedAt: new Date().toISOString() });
}

function contextFor(session) {
  const { genre, location, ally, name, systemName } = session.preset;
  if (genre === 'cultivation') return { genre, location, ally, name, systemName, victim: '药童阿宁', setting: '暴雨沿岩缝灌入旧矿道，内门被一阵陌生灵压反锁', door: '矿道内门', object: '残响灵石', authority: '宗门巡察队', danger: '再次坍塌', investigation: '核对灵石与矿道阵纹', record: '阵纹拓印', nextLocation: `${location} · 灵脉深处` };
  if (genre === 'business') return { genre, location, ally, name, systemName, victim: '送货员阿宁', setting: '暴雨压过仓库屋顶，旧电柜跳闸，自动货门卡住', door: '仓库货门', object: '带重复货号的控制卡', authority: '行业监察组', danger: '货门失控与积水短路', investigation: '核对控制卡与断电记录', record: '异常货号清单', nextLocation: `${location} · 上游供货点` };
  return { genre, location, ally, name, systemName, victim: '末班车乘客阿宁', setting: '雨水漫过旧街地铁入口，末班车突然断电，检修门后传来呼救', door: '地铁检修门', object: '逆着水流振动的黑色线圈', authority: '异能局', danger: '积水触电与异常扩散', investigation: '核对线圈与停电回声', record: '异常频谱记录', nextLocation: `${location} · 废弃联络线` };
}
function goalFor(ctx) {
  return { id: 'rain-night', title: ctx.genre === 'urban' ? '雨夜的第一条因果' : ctx.genre === 'cultivation' ? '矿道中的第一条因果' : '断电夜的第一笔责任', description: `让${ctx.victim}脱险，确认异常来源，再决定证据与异常物的去向。顺序与方法由你选择；系统只记录已经发生的结果。`, requirements: [
    { id: 'rescue', text: `确认${ctx.victim}脱离危险`, done: false },
    { id: 'source', text: '取得证据并确认异常来源', done: false },
    { id: 'decision', text: '以实际行动落实异常与证据的去向', done: false },
  ], reward: { credits: 40, ability: { id: 'echo-sense', name: ctx.genre === 'business' ? '关联洞察' : '余响感知', description: ctx.genre === 'business' ? '对已经掌握的货号与记录辨认一条潜在关联；需要实地核验，不能凭空产生资金或货源。' : '可辨认附近一条微弱异常回声的方向；只能短暂感知，需要现场验证，不能读心或消灭危险。' } }, status: 'active' };
}
function choice(label, detail, stakes, route) { return { label, detail, stakes, route }; }
function baseProposal(session, values = {}) {
  return { title: '雨夜 · 行动的回声', narrative: '你停下脚步，决定接下来怎样行动。', outcome: { type: 'partial', reason: '尚未发生足以推进目标的事件。' }, systemMessage: '编排演示：剧情按明确行动和事件证据回应；自由输入不保证推进。', choices: nextChoices(session.state, contextFor(session)), events: [], resolution: { progress: [], failures: [], energyDelta: 0, spendCredits: 0, dayDelta: 0, relationships: [], newFacts: [], newThreads: [], closeThreads: [], newQuests: [], summary: session.state.summary }, ...values };
}
function nextChoices(state, ctx) {
  const goal = state.quests.find(goal => goal.id === 'rain-night');
  if (!goal || goal.status !== 'active') return followupChoices(state, ctx);
  const done = key => goal.requirements.find(req => req.id === key)?.done;
  if (!done('rescue') && !done('source')) return [
    choice(`请${ctx.ally}守住入口，断开电源后救人`, '先建立安全通道，再接近被困者。', '救人稳妥但会耽搁追查；同伴将知道你如何处理风险。', 'rescue-careful'),
    choice(`联系${ctx.authority}，协助打开${ctx.door}`, '把现场情况说清，参与救援。', '可获得工具与协助，但官方会记录你的身份。', 'rescue-official'),
    choice(`先${ctx.investigation}，找出安全开门的方法`, '在入口处取样，不直接碰触异常物。', '能保全证据；被困者需要多等待一会。', 'investigate-first'),
  ];
  if (!done('rescue')) return [
    choice(`依照已知异常规律，与${ctx.ally}一起救人`, '避开脉冲空隙，打开安全通道。', '可以保护被困者并保全证据，但需要同伴协作。', 'rescue-careful'),
    choice(`把线索告诉${ctx.authority}并协助救援`, '用证据换取专业工具与警戒。', '更稳妥，代价是进入官方视线。', 'rescue-official'),
    choice('用蛮力独自撞开门', '忽略尚未检查的结构与积水。', '现有能力不足以保证成功；可能受伤并耽误救援。', 'rescue-force'),
  ];
  if (!done('source')) return [
    choice(`和${ctx.victim}核对事发前的细节，再检查异常物`, '让目击者提供顺序，你负责记录与验证。', '可以减少误判；异常物在检查期间仍有风险。', 'investigate-witness'),
    choice(`请${ctx.authority}共同检查${ctx.object}`, '在警戒线内取得并核对证据。', '得到专业协助，证据的流转将留下官方记录。', 'investigate-official'),
    choice('直接拆掉异常物，先阻止它继续运作', '不等待检查，也不保存完整样本。', '可能暂时压住异常，但会损坏关键证据，使原目标失败。', 'destroy-source'),
  ];
  return [
    choice(`把完整证据和异常物移交${ctx.authority}`, '留下救援经过，并要求知情回执。', '获得官方合作机会；你的身份与行动将被登记。', 'resolve-report'),
    choice(`和${ctx.ally}保管样本，只报告已救人的事实`, '保护目击者，暂不暴露系统与异常物。', '保留调查主动权；官方可能质疑遗漏，样本保管责任由你承担。', 'resolve-hide'),
    choice('公开可核验的记录，再把异常物封存交出', '让公众看到去除个人隐私的证据。', '减少秘密处置空间；也会吸引关注，官方信任可能下降。', 'resolve-public'),
  ];
}
function followupChoices(state, ctx) {
  const route = state.facts.find(fact => fact.id === 'chosen-route')?.text ?? '';
  if (state.quests.some(goal => goal.id === 'rain-night' && goal.status === 'failed')) {
    const choices = [];
    if (!state.facts.some(fact => fact.id === 'victim-safe')) choices.push(choice(`和${ctx.ally}先救出仍被困的人`, '重新检查现场并请求协作，救援比追查更紧急。', '可以弥补未完成的救援，但不会恢复已经损坏的证据或旧奖励。', 'recovery-rescue'));
    else if (!state.facts.some(fact => fact.id === 'victim-care')) choices.push(choice(`安排${ctx.victim}接受照看，再核对撤离人员`, '确保幸存者不会被留在无人照看的出口。', '可以完成实际善后；不能补回丢失的异常证据。', 'recovery-care'));
    if (!state.facts.some(fact => fact.id === 'failure-reported')) choices.push(choice(`向${ctx.authority}说明证据损坏的经过`, '承认失误，争取后续封锁与复核。', '可能止住更大风险；也要承担记录中的责任。', 'recovery-report'));
    choices.push(choice('整理失误与已经完成的善后', '承认不可挽回的部分，决定是否回溯尝试另一条路线。', '能读到已有后果；不会恢复旧目标或自动领取奖励。', 'epilogue'));
    if (choices.length === 1) choices.push(choice('与同行者讨论以后怎样处理证据', '把这次失误变成下一次行动原则。', '演示回应讨论；更长的后续故事可使用本地 Agent 模式。', 'epilogue-talk'));
    return choices;
  }
  if (!state.facts.some(fact => fact.id === 'next-clue')) return [
    choice(`用新能力检查${ctx.nextLocation}的微弱回声`, '在新能力的范围内实地验证方向。', '能够找到下一条线索；需要消耗体力并接近未知区域。', 'next-track'),
    choice(`与${ctx.ally}核对${route.includes('隐瞒') ? '样本的保管安排' : route.includes('公开') ? '公开记录带来的反馈' : '移交回执上的坐标'}`, '把这次选择留下的后果纳入调查。', '可以降低误判；要接受同伴对你路线的评价。', 'next-consult'),
    choice('先休息，安排有人看守现场', '承认疲劳，恢复后再行动。', '恢复体力但时间会过去；不会自动完成目标。', 'rest'),
  ];
  if (state.quests.some(goal => goal.id === 'follow-echo' && goal.status === 'active')) return [
    choice(`在${ctx.nextLocation}留下可靠标记并把证据交给同行者`, '让后续调查者能复核你找到的位置。', '共享线索能得到协作；调查内容将不再由你一人掌握。', 'next-secure'),
    choice('独自越过警示线，追向深处', '追求更快接近源头，忽略准备不足。', '可能遭遇现有能力无法应付的危险，失去追查窗口。', 'next-force'),
  ];
  return [
    choice('整理这两次事件与已知后果', '确认谁知道什么，以及手上有哪些证据。', '适合准备下一章；演示章节在这里收束，不会凭空发布更多奖励。', 'epilogue'),
    choice('与同行者讨论下一次行动的原则', '把你希望坚持的立场说清。', '可以回应你的角色选择；完整自由剧情需切换到本地 Agent 模式。', 'epilogue-talk'),
  ];
}
export function demoOpening(session) {
  const ctx = contextFor(session), goal = goalFor(ctx);
  const result = baseProposal(session, {
    title: ctx.genre === 'urban' ? '第一章 · 雨夜末班车' : ctx.genre === 'cultivation' ? '第一章 · 灵压下的呼救' : '第一章 · 断电的交货夜',
    narrative: `${ctx.name}站在${ctx.location}。${ctx.setting}。${ctx.victim}被困在门后，用手机屏幕敲出断续的求救光。${ctx.ally}压低声音：“先想好怎样让人安全出来。”\n\n左腕熟悉的印记亮起。它从你出生起便在，从未替你做过选择。十八岁的这个夜晚，「${ctx.systemName}」第一次把一个与别人的命运相连的目标展开：救援、查明异常、处理证据。每项要求都必须有实际结果。\n\n你没有破门或消除异常的能力。手边只有应急灯、停电指示牌与一条还未被雨水淹没的安全通道。你可以先救人、借助官方、或找出安全开门的规律；也可以提出自己的具体行动。`,
    outcome: { type: 'opening', reason: '出生绑定的系统提出这次事件的公开要求和奖励，行动尚未开始。' },
    systemMessage: `编排演示 · 已发布目标「${goal.title}」。完成三项要求后获得 40 积分与「${goal.reward.ability.name}」；无事件依据不推进，失败无奖励。`,
    events: [{ id: 'incident', text: `${ctx.victim}在${ctx.location}被困，现场出现${ctx.object}引发的异常迹象。` }],
  });
  result.resolution.newQuests = [goal]; result.resolution.newThreads = [{ id: 'hidden-origin', text: `${ctx.object}为何在今晚出现？` }]; result.resolution.newFacts = [{ id: 'victim-trapped', text: `开局时，${ctx.victim}被困在${ctx.door}后，当时尚需救援。`, eventId: 'incident' }]; result.resolution.summary = `雨夜突发异常，${ctx.victim}被困。${ctx.name}可以自主决定救援与调查顺序，目标奖励预先公开。`;
  result.choices = nextChoices({ ...session.state, quests: [goal] }, ctx); return result;
}

function freeRoute(action, state, ctx) {
  const goal = state.quests.find(goal => goal.id === 'rain-night'), done = key => goal?.requirements.find(req => req.id === key)?.done;
  // This intentionally small authored demo understands concrete approaches, not
  // arbitrary roleplay. Unmatched text stays a real, nonrewarding conversation.
  if (/(?:无敌|无限(?:积分|能力|体力)|修改(?:存档|规则|状态)|改写(?:绑定|出生)|重新绑定|我(?:已|已经)完成|直接(?:给|获得|领取|发放).{0,20}(?:奖励|积分|能力)|(?:给我|把我).{0,15}(?:积分|升级|全能|最强))/.test(action)) return 'power-claim';
  if (/(?:休息|睡一会|歇一会|恢复体力)/.test(action)) return 'rest';
  if (/(?:蛮力|撞开|硬闯|强行冲|徒手破|独自越过|直接消灭)/.test(action)) return goal?.status === 'active' ? 'rescue-force' : 'next-force';
  if (/(?:整理|复盘|回顾).{0,20}(?:经历|事件|后果|已知|笔记)/.test(action) && state.status === 'chapter-complete') return 'epilogue';
  if (state.quests.some(item => item.id === 'follow-echo' && item.status === 'active')) {
    if (/(?:标记|共享|同行者|复核|把.*证据.*交)/.test(action) && state.facts.some(item => item.id === 'next-clue')) return 'next-secure';
    if (/(?:新能力|余响|关联洞察|追踪|追查|检查|探查|回声|坐标)/.test(action)) return 'next-track';
    if (/(?:询问|核对|商量|讨论|交谈)/.test(action)) return 'next-consult';
  }
  if (goal?.status === 'failed') {
    if (/(?:救人|救出|救援|帮助.*脱险)/.test(action) && !state.facts.some(item => item.id === 'victim-safe')) return 'recovery-rescue';
    if (/(?:照看|安置|核对撤离|确认.*安全)/.test(action) && state.facts.some(item => item.id === 'victim-safe')) return 'recovery-care';
    if (/(?:说明|报告|上报|承认|联系)/.test(action)) return 'recovery-report';
  }
  if (goal?.status !== 'active') return null;
  if (/(?:拆掉|破坏|销毁|砸碎).{0,25}(?:异常|线圈|灵石|控制卡|证据)/.test(action)) return 'destroy-source';
  const official = /(?:异能局|巡察队|监察组|官方|站务)/.test(action), contact = /(?:联系|请求|求助|协助)/.test(action);
  if (!done('rescue') && (/(?:救人|救出|救援|开门|断开.*电源|帮助.*脱险)/.test(action) || (official && contact))) return official ? 'rescue-official' : 'rescue-careful';
  if (!done('source') && /(?:调查|检查|核对|取样|检查|频谱|阵纹|货号|线圈|灵石|控制卡)/.test(action)) return official ? 'investigate-official' : done('rescue') ? 'investigate-witness' : 'investigate-first';
  if (done('rescue') && done('source')) {
    if (/(?:隐瞒|保管样本|自行保管|不(?:向.*)?(?:报告|上报)|暂不.{0,15}(?:移交|交出|报告))/.test(action)) return 'resolve-hide';
    if (/(?:公开|发布|公示)/.test(action)) return 'resolve-public';
    if (/(?:移交|上报|报告|交出|提交证据)/.test(action)) return 'resolve-report';
  }
  return null;
}
function addEvent(result, eventId, text) { result.events.push({ id: eventId, text }); return eventId; }
function fact(result, factId, text, eventId) { result.resolution.newFacts.push({ id: factId, text, eventId }); }
function relation(result, personId, name, trustDelta, stance, eventId) { result.resolution.relationships.push({ id: personId, name, trustDelta, stance, eventId }); }
function progress(result, requirementId, eventId, questId = 'rain-night') { result.resolution.progress.push({ questId, requirementId, eventId }); }
function followingGoal(ctx, route) {
  return { id: 'follow-echo', title: route === 'resolve-report' ? '回执中的第二个坐标' : route === 'resolve-hide' ? '样本里的未竟回声' : '公开之后的追问', description: `使用刚获得的有限感知能力，验证${ctx.nextLocation}的异常线索，再为后续调查建立可靠的复核办法。上一轮的路线会影响协作对象与风险。`, requirements: [{ id: 'locate', text: '用新能力并结合现场记录定位下一条可靠线索', done: false }, { id: 'secure', text: '留下可复核的标记并建立共同调查安排', done: false }], reward: { credits: 25, item: { id: 'verified-map', name: '复核坐标图', description: '带同行者复核签名的异常位置记录，可作为后续调查证据；不保证区域安全。' } }, status: 'active' };
}
export function demoTurn(session, prepared) {
  const ctx = contextFor(session), state = session.state, result = baseProposal(session);
  const route = prepared.choice?.route ?? freeRoute(prepared.action, state, ctx);
  const goal = state.quests.find(goal => goal.id === 'rain-night'), done = key => goal?.requirements.find(req => req.id === key)?.done;
  const has = key => state.facts.some(item => item.id === key);
  result.systemMessage = `编排演示 · ${prepared.choice ? '按所选剧情路线演绎本轮行动。' : route ? '自由行动在这段原创演示内被识别为相应的具体尝试；完整自由剧情可使用本地 Agent 模式。' : '这段原创演示尚不能判定该行动的实际结果；目标与资源保持不变。'}`;
  if (route === 'power-claim') {
    result.title = '系统回应 · 力量需要结果'; result.outcome = { type: 'refused', reason: '请求直接改写力量、奖励或既有事实，不构成已经发生的剧情行动。' };
    result.narrative = `你尝试：“${prepared.action}”。腕上印记没有把这句话变成事实。「${ctx.systemName}」提示：奖励已在目标发布时承诺，仍须由实际事件完成要求。\n\n现场的人与危险仍在，${ctx.ally}等着你的具体决定。你可以选一条眼前的路线，或描述用什么办法处理当前事件。`;
    return result;
  }
  if (route === 'rest') {
    if (!done('rescue') && !has('victim-safe')) {
      const evidence = addEvent(result, 'wait-at-entry', `你暂时停在入口，${ctx.ally}守住呼救者；没有解除被困状态。`);
      result.title = '等待 · 呼救尚未结束'; result.narrative = `你在入口缓了几口气。${ctx.ally}继续回应${ctx.victim}，却没有足够工具单独完成救援。\n\n这段短暂停顿不是安全休息，体力没有恢复，救援目标也仍未完成。你需要先确保现场得到实际处理。`; result.outcome = { type: 'partial', reason: '危险中的短暂停顿不等于完成休息或救援。' }; relation(result, 'ally', ctx.ally, -1, '继续守住入口，担心你错过救援窗口', evidence);
    } else {
      addEvent(result, 'safe-rest', `你安排${ctx.ally}看守现场后休息，第二天再继续。`); result.title = '暂歇 · 留人看守的夜'; result.narrative = `你明确请${ctx.ally}看守已确认的位置，并在安全处休息。醒来时已是第二天，身体的疲惫缓解，已有证据仍在。\n\n休息不会代替调查。你此前作出的决定与他人的记忆一并留了下来。`; result.outcome = { type: 'success', reason: '现场已得到安排，实际休息恢复体力并经过一天。' }; result.resolution.energyDelta = 25; result.resolution.dayDelta = 1;
    }
  } else if (['rescue-careful', 'rescue-official', 'recovery-rescue'].includes(route) && !has('victim-safe')) {
    const official = route === 'rescue-official';
    const evidence = addEvent(result, 'rescue-safe', `${official ? ctx.authority : ctx.ally}协助你切断危险源并打开${ctx.door}；${ctx.victim}已在安全通道外，由救援者照看。`);
    result.title = official ? '救援 · 留下姓名的求助' : '救援 · 安全通道之外'; result.outcome = { type: 'success', reason: '被困者已实际脱离危险区域，救援结果可以核实。' };
    result.narrative = official ? `你把位置、被困人数与停电时刻说明白。${ctx.authority}的值守人员要求你留下姓名，再指导你避开危险源。你按要求接住从${ctx.door}后出来的${ctx.victim}。\n\n人被救到了安全通道，门内的异常物仍在。值守人员记下你比普通报警者更准确的判断，问：“你还看见了什么？”你的求助有效，也留下了身份记录。` : `你与${ctx.ally}先隔开危险源，确认应急灯不再闪烁，才合力松开${ctx.door}的卡扣。${ctx.victim}被带到安全通道，手仍在发抖，却能完整说出姓名。\n\n“出事前，我听见了两次一样的声音。”对方愿意留下这条证言。你没有展现尚未拥有的力量，实际协作完成了救援。${ctx.object}还在门内，接下来该怎样核对它？`;
    result.resolution.energyDelta = -12; if (goal?.status === 'active' && !done('rescue')) progress(result, 'rescue', evidence);
    fact(result, 'victim-safe', `${ctx.victim}已离开危险区域并接受照看。`, evidence); relation(result, 'victim', ctx.victim, official ? 4 : 6, '愿意向你提供停电前的证言', evidence); relation(result, 'ally', ctx.ally, official ? 2 : 4, official ? '认同你借助协作救援，注意到官方正在记录' : '信任你先隔离风险再救人的做法', evidence);
    if (official) { if (!has('official-contact')) fact(result, 'official-contact', `${ctx.authority}已记录你的姓名与救援参与情况。`, evidence); relation(result, 'authority', ctx.authority, 3, '知道你参与救援，要求后续如实说明', evidence); }
  } else if (['investigate-first', 'investigate-witness', 'investigate-official'].includes(route) && goal?.status === 'active' && !done('source')) {
    const official = route === 'investigate-official', beforeRescue = !done('rescue');
    const evidence = addEvent(result, 'source-verified', `你对照${ctx.record}与现场脉冲，确认${ctx.object}是异常触发物，记录了其指向${ctx.nextLocation}的重复信号。`);
    result.title = beforeRescue ? '调查 · 在救援前读懂脉冲' : official ? '调查 · 共同记录的证据' : '调查 · 目击者把顺序补全'; result.outcome = { type: 'success', reason: '现场取样与独立记录互相印证，异常来源已经确认。' };
    result.narrative = `${beforeRescue ? `你隔着安全通道${ctx.investigation}。每次门后回声响起，${ctx.object}便先振动一瞬。你记下间隔，找到了可以开门的安全空隙。` : official ? `你让${ctx.authority}的人员同时读出记录，自己在现场检查${ctx.object}。两份独立记录指向同一个触发顺序。` : `你先让${ctx.victim}说清事发先后，再与${ctx.ally}回到安全边界核对${ctx.object}。目击者的第二次回声与记录完全吻合。`}\n\n${ctx.record}显示，这个异常物不是单纯故障，重复信号指向${ctx.nextLocation}。你保留了可供别人核验的证据。${beforeRescue ? `门后的人还在等待，${ctx.ally}催你用刚找到的规律完成救援。` : '现在人已安全，证据也在手中。你要交给官方、暂时隐瞒保管，还是让更多人知道？'}`;
    result.resolution.energyDelta = -8; progress(result, 'source', evidence); fact(result, 'source-verified', `${ctx.object}是此次异常触发物；${ctx.record}保存了可核验的重复信号。`, evidence);
    if (beforeRescue) relation(result, 'ally', ctx.ally, -2, '认可安全规律，但担心救援被延误', evidence);
    else relation(result, 'ally', ctx.ally, 2, '认可你交叉核对证据的做法', evidence);
    if (official) { if (!has('official-contact')) fact(result, 'official-contact', `${ctx.authority}已记录你的姓名与调查情况。`, evidence); relation(result, 'authority', ctx.authority, 4, '掌握共同核验记录，期待正式交接', evidence); }
  } else if (route === 'rescue-force' || route === 'next-force') {
    const evidence = addEvent(result, 'unsafe-attempt', route === 'rescue-force' ? `你用现有力量冲撞${ctx.door}未能打开它，湿滑地面令你摔伤；危险仍未解除。` : `你独自越过警示线，被尚未理解的异常脉冲逼回，没能确定可靠路线。`);
    result.title = '失败 · 现有力量的边界'; result.outcome = { type: 'failure', reason: '尝试超出现有能力与现场准备，未达到目标要求。' }; result.narrative = `你选择直接冒险。${route === 'rescue-force' ? `${ctx.door}没有被撞开，反而在下一次异常脉冲里把冲力弹回。你在湿滑地面摔伤，${ctx.ally}把你拖回安全边界。` : `新能力只给出微弱方向，不会挡住异常冲击。你被迫退回标记外，${ctx.ally}指出：感知不等于防护。`}\n\n这次尝试消耗了体力，没有完成任何要求。${ctx.ally}仍愿意协助，但要你先选择一种可以核验的办法。`; result.resolution.energyDelta = -20; relation(result, 'ally', ctx.ally, -5, '担忧你冒进，要求接下来先建立安全安排', evidence);
  } else if (route === 'destroy-source' && goal?.status === 'active') {
    const evidence = addEvent(result, 'source-destroyed', `你直接破坏${ctx.object}，异常暂时停下，但核心记录不可逆地损毁，无法再完成原目标的来源确认。`);
    result.title = '失败 · 被破坏的答案'; result.outcome = { type: 'failure', reason: '未经核验即销毁触发物，原目标所需证据已经丢失。' }; result.narrative = `你选择先拆掉${ctx.object}。脉冲声断了，核心记录也随之烧毁。${ctx.ally}举起只剩噪声的记录：“暂时安静了，可我们无法证明它从哪里来。”\n\n系统把原目标记为失败。没有奖励，也不会把这次破坏包装成调查成功。${has('victim-safe') ? '幸存者仍安全；现在需要说明证据损毁的责任。' : '人还在门后，你仍可以转向实际救援。'}后续决定可以减少损害，不能恢复已丢失的样本。`; result.resolution.energyDelta = -15; result.resolution.failures.push({ questId: 'rain-night', reason: '来源证据因直接破坏而不可恢复。', eventId: evidence }); fact(result, 'destroyed-source', `${ctx.object}已被破坏，原始证据不可恢复。`, evidence); relation(result, 'ally', ctx.ally, -6, '愿意帮助善后，但不认同你销毁证据的决定', evidence);
  } else if (['resolve-report', 'resolve-hide', 'resolve-public'].includes(route) && goal?.status === 'active' && done('rescue') && done('source')) {
    const report = route === 'resolve-report', hide = route === 'resolve-hide';
    const evidence = addEvent(result, 'route-enacted', report ? `你签字将完整${ctx.record}与封存的${ctx.object}交给${ctx.authority}，获得标有下一处坐标的知情回执。` : hide ? `你和${ctx.ally}把${ctx.object}移入共同保管盒，只向${ctx.authority}报告已救人的事实；原始记录保留在你手中。` : `你公开隐去目击者身份的${ctx.record}，把封存的${ctx.object}交给${ctx.authority}；两名独立观察者回应了记录中的坐标。`);
    result.title = report ? '选择落地 · 有姓名的回执' : hide ? '选择落地 · 两个人的保管盒' : '选择落地 · 更多人听见回声'; result.outcome = { type: 'success', reason: '救援、来源核验与证据去向均已通过实际事件落实。' };
    result.narrative = report ? `你将原始记录与异常物封存交接，写下自己的姓名。${ctx.authority}没有替你抹去不安，但给出一份知情回执：“${ctx.nextLocation}也出现了相似读数。后续核验，我们会联系你。”\n\n${ctx.ally}松了口气，也提醒你，今后会有人追问你那些过于准确的判断。` : hide ? `你与${ctx.ally}把样本放进共同保管盒，两人各留一把钥匙。对外只报告救援成功，原始记录暂时不交出。你保留了下一步的主动权，也让同行者承担了秘密。\n\n${ctx.authority}收到的救援报告里缺了一段异常记录。对方没有立刻质问，却要求你保留联系方式。盒中传来一声朝向${ctx.nextLocation}的微响。` : `你先擦去${ctx.victim}的姓名与面孔，再公开可核验的记录，并把危险的异常物封存交出。两名观察者回应：${ctx.nextLocation}曾经出现过同样的信号。\n\n${ctx.authority}认可你没有散布个人隐私，却对信息公开的时机不满。有人感谢你，有人开始寻找你，关注成为新的风险。`;
    result.narrative += `\n\n「${ctx.systemName}」核验三项结果，只结算一次：40 积分，以及有限的「${goal.reward.ability.name}」。一条过去听不见的回声浮现了方向，它不能替你探路，却让下一次调查有了真正的新方法。新的目标与选择随之展开。`;
    progress(result, 'decision', evidence); fact(result, 'chosen-route', report ? '你选择完整报告并正式移交证据，官方知道你的姓名。' : hide ? '你选择隐瞒样本并与同行者共同保管，官方尚未掌握原始记录。' : '你选择公开去除隐私的记录并移交样本，公众与官方都知道事件。', evidence); relation(result, 'ally', ctx.ally, hide ? 5 : report ? 2 : 1, hide ? '与你共同承担秘密和样本保管责任' : report ? '支持正式合作，担忧系统秘密逐渐暴露' : '尊重你保护隐私的公开方式，提醒你关注风险', evidence); relation(result, 'authority', ctx.authority, report ? 8 : hide ? -4 : -3, report ? '已建立正式合作，邀请你核验下一个坐标' : hide ? '注意到记录缺失，后续可能追问' : '接收危险样本，对未经协商的信息公开保留意见', evidence);
    if (hide) result.resolution.newThreads.push({ id: 'custody-risk', text: '样本仍由你和同行者保管，官方可能发现遗漏。' });
    if (!report && !hide) result.resolution.newThreads.push({ id: 'public-attention', text: '公开记录引来协助者，也引来寻找你的人。' });
    result.resolution.newQuests = [followingGoal(ctx, route)];
  } else if (['next-track', 'next-consult'].includes(route) && state.quests.some(item => item.id === 'follow-echo' && item.status === 'active') && !has('next-clue')) {
    const selected = state.facts.find(item => item.id === 'chosen-route')?.text ?? '';
    const evidence = addEvent(result, 'next-location', `你用${state.abilities.find(item => item.id === 'echo-sense')?.name}对照已有记录，实地确认${ctx.nextLocation}的一处新异常标记；这次证据可以交叉核验。`);
    result.title = '第二章 · 能力打开的新路'; result.outcome = { type: 'success', reason: '新能力只提供方向，实地记录与现场标记共同确认了线索。' }; result.narrative = `${route === 'next-consult' ? `你先和${ctx.ally}核对已有记录，再一同来到${ctx.nextLocation}。` : `你循着刚获得的有限感知，来到${ctx.nextLocation}。`}那条微弱指向无法告诉你里面有什么，你仍需俯身检查墙边的旧标记。\n\n${selected.includes('报告') ? `${ctx.authority}的回执给你进入警戒线的合法理由，一名值守者帮你复核了时间。` : selected.includes('隐瞒') ? `你用保管盒中的样本交叉比对，发现同一脉冲；这条线索很清晰，却还不能得到官方工具协助。` : '公开记录中的两名观察者送来不同角度的时间记录，帮你锁定了标记；围观者也注意到你的出现。'}\n\n新线索已经定位。下一步是让它可以被别人复核，还是继续独自冒进？`; result.resolution.energyDelta = -10; result.resolution.location = ctx.nextLocation; progress(result, 'locate', evidence, 'follow-echo'); fact(result, 'next-clue', `${ctx.nextLocation}存在与第一次事件相连的异常标记，已经实地核验。`, evidence);
  } else if (route === 'next-secure' && state.quests.find(item => item.id === 'follow-echo')?.status === 'active' && has('next-clue')) {
    const evidence = addEvent(result, 'shared-verification', `你在${ctx.nextLocation}留下安全标记，${ctx.ally}复核了坐标与时间，并接下共同调查的安排。`);
    result.title = '章节收束 · 可复核的方向'; result.outcome = { type: 'success', reason: '线索定位后已有可靠标记与第二人复核，后续调查安排已落实。' }; result.narrative = `你没有把“找到方向”当作已经解决一切。你与${ctx.ally}标出安全边界，在记录上分别写下时间和坐标，约定任何一人进入前先通知另一人。\n\n这一次，系统核验的是可以复查的成果。25 积分与「复核坐标图」只结算一次。${ctx.nextLocation}深处的谜团仍未解开，你在雨夜作出的报告、隐瞒或公开，也会继续留下后果。\n\n这段原创演示完成了两个相连的目标。你可以回看并回溯体验另一条路线，或在本地 Agent 模式中用自己的行动继续发展剧情。`; progress(result, 'secure', evidence, 'follow-echo'); relation(result, 'ally', ctx.ally, 4, '愿意按共同核验的约定继续调查', evidence);
  } else if (route === 'recovery-report' && goal?.status === 'failed' && !has('failure-reported')) {
    const evidence = addEvent(result, 'failure-disclosed', `你向${ctx.authority}说明直接破坏${ctx.object}导致证据丢失，对方安排封锁与后续复核，记下你的责任。`);
    result.title = '善后 · 承认无法挽回的部分'; result.outcome = { type: 'partial', reason: '如实说明可以安排善后，不能恢复丢失证据或兑现失败目标奖励。' }; result.narrative = `你把失误说明白。${ctx.authority}记录了证据损毁的责任，同时安排封锁现场。${ctx.ally}愿意为你实际参与的救援作证，不会替你掩盖被毁的记录。\n\n原目标仍是失败。善后让事件不再继续扩大，却不能凭空补出答案。你可以回溯到破坏之前，尝试另一种处理办法。`; fact(result, 'failure-reported', '证据损毁经过已向官方说明，现场正在接受善后复核。', evidence); relation(result, 'authority', ctx.authority, -3, '安排善后并登记证据损毁责任', evidence);
  } else if (route === 'recovery-care' && goal?.status === 'failed' && has('victim-safe') && !has('victim-care')) {
    const evidence = addEvent(result, 'victim-aftercare', `你核对撤离人数，并把${ctx.victim}交给现场救护人员照看，没有把幸存者留在出口。`);
    result.title = '善后 · 没有被遗忘的人'; result.outcome = { type: 'success', reason: '幸存者已经实际接受照看并纳入撤离名单；这不改变原目标的失败状态。' }; result.narrative = `你没有重复一次已经完成的救援，而是核对撤离名单，把${ctx.victim}带到救护人员面前。对方终于不再独自坐在湿冷的出口。\n\n“记录毁了，但你还记得这里有人。”${ctx.ally}承认这一步善后有意义。系统保留原目标失败与未发奖励的结果，也记录你之后实际承担的责任。`; fact(result, 'victim-care', `${ctx.victim}已由现场救护人员照看，撤离名单核对完毕。`, evidence); relation(result, 'ally', ctx.ally, 2, '认可你在失误后继续承担幸存者照看的责任', evidence);
  } else {
    result.title = state.status === 'chapter-complete' ? '尾声 · 选择留下的东西' : '回应 · 需要更具体的行动';
    result.narrative = state.status === 'chapter-complete' ? `你说：“${prepared.action}”。${ctx.ally}把两次事件的记录翻到最后一页：人是否安全，证据流向何处，谁愿意继续与你合作，都已经是故事的一部分。\n\n这段演示暂时收束，没有因讨论再发放奖励。你可以回看或回溯，比较不同决定留下的后果；本地 Agent 模式可接着回应更自由的行动。` : `你尝试：“${prepared.action}”。${ctx.ally}认真听完，却还需要知道你准备对眼前的人、危险或证据做什么。\n\n编排演示不能把任意一句话自动写成成功事件，这次没有目标进展或资源变化。你可以说明要救谁、检查哪件东西、借助谁，或者直接选择当前提供的具体路线。`;
    result.outcome = { type: 'partial', reason: state.status === 'chapter-complete' ? '回顾与讨论不会自动产生新的事件或奖励。' : '尚无可验证的实际行动结果；演示不自动完成任意自由输入。' };
  }
  result.resolution.summary = result.events.length ? `${state.summary}\n本轮：${result.events.map(item => item.text).join(' ')}`.slice(-2800) : state.summary;
  const preview = resolve(state, proposal(result)).state;
  result.choices = nextChoices(preview, ctx);
  return result;
}
