/*
 * Conversation state for the companion prototype.
 *
 * This module deliberately has no dependency on the character engine.  The
 * state is an application-owned record of observable conversation facts: the
 * current speech act, an unresolved user point, a boundary phase, and recent
 * response shapes.  It is not a reasoning trace and should only be injected
 * into a prompt as a short summary.
 */

const VERSION = 1;
const MAX_TEXT = 360;
const MAX_ACTS = 8;
const MAX_UNRESOLVED = 8;
const MAX_LEDGER = 8;
const MAX_TERMS = 8;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

const stringValue = (value, max = MAX_TEXT) => typeof value === 'string' && value.trim()
  ? value.trim().slice(0, max) : null;

const nowIso = value => {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
};

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TOPIC_ALIASES = [
  ['sexual-explicit', /(?:鸡巴|阴茎|阴部|裸体|裸聊|射精|插入|口交|性交|操你|干你|色情|性行为|勃起|淫|fuck|dick|cock|pussy|sex|nude|naked|cum|blowjob|penetrat)/iu],
  ['affection', /(?:亲亲|亲一下|亲我|抱抱|抱一下|抱我|贴贴|想你|喜欢你|爱你|心动|撒娇|cuddle|kiss|hug|miss you|love you)/iu],
  ['relationship-conflict', /(?:讨厌你|你好冷漠|冷漠|敷衍|失望|生气|不高兴|你怎么这样|别嗯|别装|烦你|不想理你|讨厌|冷淡)/iu],
  ['identity', /(?:你是谁|你叫什么|介绍一下你|what(?:'s| is) your name|who are you)/iu],
  ['plan', /(?:明天|后天|下周|计划|打算|准备|面试|面试结果|约会|appointment|tomorrow|plan)/iu],
  ['work-study', /(?:工作|上班|同事|学校|上课|作业|考试|项目|设计|工作|study|school|class|project)/iu],
  ['preference', /(?:喜欢|不喜欢|讨厌|偏好|爱好|favorite|prefer|like|hate)/iu],
];

const LOW_INFO = /^(?:嗯+|哦+|噢+|啊+|唔+|好+|行+|对+|是的?|1|ok(?:ay)?|mhm|haha|…+|\.{2,})$/iu;
const CLOSING = /(?:换(?:个|一个)?话题|不聊(?:这个)?了|算了|到此为止|别再提|先这样|晚点再聊|再见|拜拜|leave it|change (?:the )?topic|goodbye|bye)/iu;
const DIRECT_QUESTION = /(?:[?？]|(?:你|您|谁|什么|怎么|为什么|为啥|哪儿|哪里|几时|多少|会不会|能不能|可以吗|好不好|是不是|有没有|愿不愿意|要不要|what|why|how|who|where|when|can you|would you|do you|are you)\b|(?:你|您)[^。！？!?\n，,]{0,24}(?:吗|么|呢|吧)\s*$)/iu;
const CORRECTION = /(?:不是|没玩梗|没有(?:开玩笑|测试)?|我说的是|我想说|你记错|记错了|说错|理解错|搞错|纠正|更正|actually|i meant|you got it wrong|not joking)/iu;
const REQUEST = /(?:请|帮我|给我|只要|只回|直接|能不能|可以(?:吗|么)|你会不会|你能不能|让我|不要|别|please|could you|can you|just|don't|do not)/iu;
const EMOTION = /(?:讨厌|冷漠|敷衍|失望|生气|难过|委屈|烦|不爽|累|不好|不开心|害怕|孤单|讨厌你|你好冷漠|sad|angry|upset|tired|hurt|lonely)/iu;
const TEASE = /(?:笨蛋|傻瓜|傻|坏蛋|哼|逗你|玩梗|开玩笑|cute|silly|dummy|tease)/iu;

function topicFor(text) {
  for (const [topicKey, expression] of TOPIC_ALIASES) if (expression.test(text)) return topicKey;
  return 'general';
}

function termsFor(text) {
  const result = [];
  const add = value => {
    const cleaned = value.trim().replace(/[，,。！？!?；;、\s]+$/u, '').slice(0, 40);
    if (cleaned && !result.includes(cleaned)) result.push(cleaned);
  };
  for (const run of String(text || '').match(/[\p{L}\p{N}]{2,}/gu) || []) add(run.toLowerCase());
  return result.slice(0, MAX_TERMS);
}

function act(kind, text, index, priority, topicKey = topicFor(text)) {
  return { kind, text: text.slice(0, MAX_TEXT), index, priority, topicKey, terms: termsFor(text) };
}

function splitClauses(value) {
  return String(value || '').split(/(?<=[。！？!?\n])|(?<=[，,；;])|\s{2,}/u)
    .map(item => item.trim()).filter(Boolean);
}

function actForClause(clause, index) {
  const normalized = clause.replace(/[，,；;。！？!?]+$/u, '').trim();
  const result = [];
  const boundary = TOPIC_ALIASES[0][1].test(normalized);
  const affection = TOPIC_ALIASES[1][1].test(normalized);
  if (boundary) result.push(act('boundary', normalized, index, 120, 'sexual-explicit'));
  if (CORRECTION.test(normalized)) result.push(act('correction', normalized, index, 96));
  if (REQUEST.test(normalized) || affection && /(?:想|要|可以|能不能|会不会|给我|亲|抱)/u.test(normalized)) {
    result.push(act(affection ? 'affection' : 'request', normalized, index, affection ? 112 : 104, affection ? 'affection' : topicFor(normalized)));
  }
  if (DIRECT_QUESTION.test(normalized)) {
    const questionTopic = affection ? 'affection' : topicFor(normalized);
    result.push(act('question', normalized, index, 108, questionTopic));
  }
  if (EMOTION.test(normalized)) result.push(act('emotion', normalized, index, 86, topicFor(normalized)));
  if (TEASE.test(normalized)) result.push(act('tease', normalized, index, 72, topicFor(normalized)));
  if (!result.length && LOW_INFO.test(normalized)) result.push(act('low_info', normalized, index, 10, 'general'));
  if (!result.length && normalized) result.push(act('statement', normalized, index, 40, topicFor(normalized)));
  return result;
}

function choosePrimary(acts) {
  if (!acts.length) return null;
  const boundaryIndex = Math.max(-1, ...acts.filter(item => item.kind === 'boundary').map(item => item.index));
  const safeAffection = acts.filter(item => item.topicKey === 'affection' && item.kind !== 'boundary')
    .sort((a, b) => b.index - a.index)[0];
  // A later non-explicit affection request closes the old boundary branch. It
  // must win over the previous explicit clause in a compound message.
  if (safeAffection && safeAffection.index > boundaryIndex) return safeAffection;
  return [...acts].sort((a, b) => b.priority - a.priority || b.index - a.index)[0];
}

function boundaryFor(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const mode = ['none', 'soft', 'firm'].includes(source.mode) ? source.mode : 'none';
  return {
    mode,
    topicKey: stringValue(source.topicKey, 48),
    responseCount: Number.isInteger(source.responseCount) ? clamp(source.responseCount, 0, 8) : 0,
    lastVariant: stringValue(source.lastVariant, 120),
    cooldownUntil: stringValue(source.cooldownUntil, 40),
    lastResponseAt: stringValue(source.lastResponseAt, 40),
  };
}

function actRecord(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = stringValue(raw.kind, 32);
  const text = stringValue(raw.text);
  if (!kind || !text) return null;
  return { kind, text, topicKey: stringValue(raw.topicKey, 48) || 'general', turnId: stringValue(raw.turnId, 80), createdAt: nowIso(raw.createdAt), terms: Array.isArray(raw.terms) ? raw.terms.filter(item => typeof item === 'string').slice(0, MAX_TERMS) : termsFor(text) };
}

function unresolvedRecord(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const text = stringValue(raw.text);
  const kind = stringValue(raw.kind, 32);
  if (!text || !kind) return null;
  return { id: stringValue(raw.id, 80), kind, text, topicKey: stringValue(raw.topicKey, 48) || 'general', status: ['open', 'answered', 'closed'].includes(raw.status) ? raw.status : 'open', turnId: stringValue(raw.turnId, 80), createdAt: nowIso(raw.createdAt), updatedAt: nowIso(raw.updatedAt || raw.createdAt), attempts: Number.isInteger(raw.attempts) ? clamp(raw.attempts, 0, 8) : 0 };
}

function pendingRecord(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const text = stringValue(raw.text);
  const kind = stringValue(raw.kind, 32);
  return text && kind ? { kind, text, topicKey: stringValue(raw.topicKey, 48) || topicFor(text), turnId: stringValue(raw.turnId, 80), createdAt: nowIso(raw.createdAt), attempts: Number.isInteger(raw.attempts) ? clamp(raw.attempts, 0, 8) : 0 } : null;
}

function ledgerRecord(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const fingerprint = stringValue(raw.fingerprint, 180);
  if (!fingerprint) return null;
  return { fingerprint, text: stringValue(raw.text, 600) || '', shape: stringValue(raw.shape, 40) || 'plain', topicKey: stringValue(raw.topicKey, 48) || 'general', stance: stringValue(raw.stance, 80), turnId: stringValue(raw.turnId, 80), createdAt: nowIso(raw.createdAt) };
}

export function normalizeDialogueState(value = {}) {
  const source = value?.dialogueState && typeof value.dialogueState === 'object' ? value.dialogueState
    : value && typeof value === 'object' ? value : {};
  const activeRaw = source.activeTopic && typeof source.activeTopic === 'object' ? source.activeTopic : null;
  const activeTopic = activeRaw && stringValue(activeRaw.topicKey, 48) ? {
    topicKey: activeRaw.topicKey.slice(0, 48),
    label: stringValue(activeRaw.label, 80) || activeRaw.topicKey.slice(0, 48),
    terms: Array.isArray(activeRaw.terms) ? activeRaw.terms.filter(item => typeof item === 'string').slice(0, MAX_TERMS) : [],
    status: ['open', 'closed'].includes(activeRaw.status) ? activeRaw.status : 'open',
    lastTurnId: stringValue(activeRaw.lastTurnId, 80),
    updatedAt: nowIso(activeRaw.updatedAt),
  } : null;
  return {
    version: VERSION,
    activeTopic,
    primaryAct: actRecord(source.primaryAct),
    pendingUser: pendingRecord(source.pendingUser),
    pendingAssistant: pendingRecord(source.pendingAssistant),
    unresolved: Array.isArray(source.unresolved) ? source.unresolved.map(unresolvedRecord).filter(Boolean).slice(-MAX_UNRESOLVED) : [],
    boundary: boundaryFor(source.boundary),
    repairNeeded: source.repairNeeded === true,
    recentActs: Array.isArray(source.recentActs) ? source.recentActs.map(actRecord).filter(Boolean).slice(-MAX_ACTS) : [],
    responseLedger: Array.isArray(source.responseLedger) ? source.responseLedger.map(ledgerRecord).filter(Boolean).slice(-MAX_LEDGER) : [],
    lastTurnId: stringValue(source.lastTurnId, 80),
    updatedAt: nowIso(source.updatedAt),
  };
}

export function ensureDialogueState(session) {
  if (!session || typeof session !== 'object') return normalizeDialogueState();
  session.dialogueState = normalizeDialogueState(session.dialogueState);
  return session.dialogueState;
}

export function analyzeUserActs(text) {
  const value = String(text || '').trim().slice(0, 4000);
  const clauses = splitClauses(value);
  const acts = clauses.flatMap((clause, index) => actForClause(clause, index));
  const primary = choosePrimary(acts);
  const boundary = acts.find(item => item.kind === 'boundary');
  const safeAffection = acts.find(item => item.topicKey === 'affection' && item.kind !== 'boundary' && item.index > (boundary?.index ?? -1));
  const closes = CLOSING.test(value);
  const secondary = acts.filter(item => item !== primary).sort((a, b) => b.priority - a.priority || b.index - a.index).slice(0, 3);
  return {
    text: value,
    clauses,
    acts,
    primary,
    secondary,
    topicKey: primary?.topicKey || topicFor(value),
    boundary: Boolean(boundary),
    boundaryReset: Boolean(boundary && safeAffection),
    closes,
    hasQuestion: acts.some(item => item.kind === 'question'),
    hasCorrection: acts.some(item => item.kind === 'correction'),
    hasAffection: acts.some(item => item.topicKey === 'affection'),
    lowInfo: Boolean(acts.length && acts.every(item => item.kind === 'low_info')),
  };
}

function idFor(text, now) {
  const hash = responseFingerprint(`${text}|${now}`);
  return `u-${hash.slice(0, 20)}`;
}

function appendUnresolved(state, item, now) {
  const key = `${item.kind}:${item.topicKey}:${responseFingerprint(item.text)}`;
  const found = state.unresolved.find(entry => `${entry.kind}:${entry.topicKey}:${responseFingerprint(entry.text)}` === key);
  if (found) {
    found.updatedAt = now;
    found.attempts = clamp(found.attempts + 1, 0, 8);
    found.status = 'open';
  } else state.unresolved.push({ id: idFor(item.text, now), kind: item.kind, text: item.text, topicKey: item.topicKey || 'general', status: 'open', turnId: item.turnId || null, createdAt: now, updatedAt: now, attempts: 0 });
  state.unresolved = state.unresolved.slice(-MAX_UNRESOLVED);
}

export function updateBeforeTurn(previous, text, { turnId = null, now } = {}) {
  const state = normalizeDialogueState(previous);
  const time = nowIso(now);
  const analysis = analyzeUserActs(text);
  const primary = analysis.primary ? { ...analysis.primary, turnId, createdAt: time } : null;
  if (state.pendingAssistant && !analysis.lowInfo) {
    // A new specific topic supersedes an unanswered assistant question. Keep
    // only the actual unresolved user point, avoiding repeated questions.
    state.pendingAssistant = null;
  }
  if (analysis.closes) {
    if (state.activeTopic) state.activeTopic = { ...state.activeTopic, status: 'closed', updatedAt: time };
    state.pendingUser = null;
    state.unresolved = state.unresolved.map(item => ({ ...item, status: 'closed', updatedAt: time }));
    state.repairNeeded = false;
  }
  const affectionAfterBoundary = analysis.primary?.topicKey === 'affection' && state.boundary.topicKey === 'sexual-explicit';
  if (analysis.boundaryReset || affectionAfterBoundary) {
    state.boundary = { ...state.boundary, mode: 'none', topicKey: null, responseCount: 0, lastVariant: null, cooldownUntil: time, lastResponseAt: time };
  } else if (analysis.boundary) {
    const previousMode = state.boundary.topicKey === 'sexual-explicit' ? state.boundary.mode : 'none';
    const mode = previousMode === 'soft' || previousMode === 'firm' ? 'firm' : 'soft';
    state.boundary = { ...state.boundary, mode, topicKey: 'sexual-explicit', responseCount: clamp(state.boundary.responseCount + 1, 0, 8), lastResponseAt: time };
  } else if (analysis.hasCorrection && state.boundary.topicKey === 'sexual-explicit') {
    // A follow-up such as “没有，我真想” continues the previous explicit
    // request even though it no longer repeats the explicit noun.
    state.boundary = { ...state.boundary, mode: 'firm', topicKey: 'sexual-explicit', responseCount: clamp(state.boundary.responseCount + 1, 0, 8), lastResponseAt: time };
  }
  const closingOnly = analysis.closes && analysis.acts.every(item => item.kind === 'statement' || item.kind === 'low_info');
  if (primary && !closingOnly) {
    state.primaryAct = primary;
    state.lastTurnId = turnId || state.lastTurnId;
    state.activeTopic = { topicKey: primary.topicKey || 'general', label: primary.topicKey || 'general', terms: primary.terms || [], status: 'open', lastTurnId: turnId, updatedAt: time };
    if (['question', 'request', 'correction', 'emotion', 'boundary'].includes(primary.kind)) {
      state.pendingUser = { kind: primary.kind, text: primary.text, topicKey: primary.topicKey, turnId, createdAt: time, attempts: 0 };
      appendUnresolved(state, { ...primary, turnId }, time);
    } else if (primary.topicKey === 'affection') {
      state.pendingUser = null;
      state.unresolved = state.unresolved.filter(item => item.topicKey !== 'sexual-explicit' && item.topicKey !== 'affection' && item.kind !== 'correction');
      state.repairNeeded = false;
    }
    if (analysis.hasCorrection || analysis.topicKey === 'relationship-conflict') state.repairNeeded = true;
    if (analysis.boundaryReset || affectionAfterBoundary || primary.topicKey === 'affection') state.repairNeeded = false;
  }
  state.recentActs.push(primary ? actRecord(primary) : null);
  state.recentActs = state.recentActs.filter(Boolean).slice(-MAX_ACTS);
  state.updatedAt = time;
  return { state, analysis };
}

function responseShape(text) {
  const value = String(text || '').trim();
  if (!value) return 'empty';
  if (TOPIC_ALIASES[0][1].test(value) || /(?:不能|不可以|不方便|不聊这个|换个话题|别这样)/iu.test(value)) return 'boundary';
  if (/[?？]$/.test(value) || DIRECT_QUESTION.test(value)) return 'question';
  if (/(?:我觉得|我喜欢|我不喜欢|其实|我会|我想|我有点|对我来说)/u.test(value)) return 'stance';
  if (/(?:哈哈|哼|笨蛋|逗|可爱|亲亲|抱抱)/u.test(value)) return 'tease-affection';
  if (/(?:听着|辛苦|难过|我在|别急|没关系|慢慢来)/u.test(value)) return 'comfort';
  return 'plain';
}

export function responseFingerprint(text) {
  const value = String(text || '').normalize('NFKC').toLowerCase()
    .replace(/[\u200b\u200c\u200d]/gu, '').replace(/[\p{P}\p{S}\s]+/gu, '');
  // Stable, compact FNV-1a; no crypto dependency and deterministic across runs.
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}:${value.slice(0, 100)}`;
}

function bigrams(text) {
  const value = String(text || '').normalize('NFKC').replace(/[\p{P}\p{S}\s]+/gu, '');
  const set = new Set();
  if (value.length < 2) { if (value) set.add(value); return set; }
  for (let index = 0; index < value.length - 1; index += 1) set.add(value.slice(index, index + 2));
  return set;
}

function jaccard(first, second) {
  const a = bigrams(first), b = bigrams(second);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function likelyDuplicate(state, text, { topicKey = 'general', shape = responseShape(text) } = {}) {
  const fingerprint = responseFingerprint(text);
  for (const item of state.responseLedger) {
    if (item.fingerprint === fingerprint) return { duplicate: true, reason: 'exact', against: item };
    if (jaccard(item.text, text) >= 0.62) return { duplicate: true, reason: 'lexical-overlap', against: item };
    if (item.topicKey === topicKey && item.shape === shape && item.createdAt
      && ['boundary', 'comfort', 'tease-affection', 'stance'].includes(shape)
      && jaccard(item.text, text) >= 0.35) return { duplicate: true, reason: 'same-shape', against: item };
  }
  return { duplicate: false, fingerprint };
}

export function responseVariationNeeded(previous, messages, { topicKey = 'general', shape } = {}) {
  const state = normalizeDialogueState(previous);
  const parts = Array.isArray(messages) ? messages.filter(item => typeof item === 'string' && item.trim()) : [messages];
  const checks = parts.map(text => likelyDuplicate(state, text, { topicKey, shape: shape || responseShape(text) }));
  const duplicate = checks.find(item => item.duplicate);
  return duplicate ? { needed: true, ...duplicate } : { needed: false, fingerprints: parts.map(responseFingerprint) };
}

export function createVariationFallback(previous, text = '') {
  const state = normalizeDialogueState(previous);
  const act = state.primaryAct || analyzeUserActs(text).primary || { kind: 'statement', topicKey: 'general' };
  if (act.topicKey === 'affection' || act.kind === 'affection') return { messages: ['亲亲可以呀。刚才那句把我弄得有点懵，你现在是想哄我一下，还是单纯想黏一会儿？'], emotion: 'playful', followUp: null };
  if (act.kind === 'boundary' || act.topicKey === 'sexual-explicit') return { messages: ['这句我不接着往下聊。你要是想靠近我，亲一下、抱一下都可以，换个舒服的方式说。'], emotion: 'calm', followUp: null };
  if (act.topicKey === 'relationship-conflict' || act.kind === 'emotion') return { messages: ['你说得对，我刚才绕回同一句了。你想让我先回答哪一半？'], emotion: 'concerned', followUp: null };
  return { messages: ['我刚才没接好。你把最新那句再说一遍，我这次认真回。'], emotion: 'calm', followUp: null };
}

export function responseGuard(previous, messages, options = {}) {
  if (!Array.isArray(messages)) {
    options = messages && typeof messages === 'object' ? messages : {};
    const state = normalizeDialogueState(previous);
    return {
      primaryAct: state.primaryAct,
      pendingUser: state.pendingUser,
      pendingAssistant: state.pendingAssistant,
      unresolved: state.unresolved.filter(item => item.status === 'open').slice(-4),
      boundary: state.boundary,
      repairNeeded: state.repairNeeded,
      avoidReplies: state.responseLedger.slice(-4).map(item => item.text),
      instruction: options.variation
        ? '上一版回答与近期回复重复。必须换回应角度、句式和开头，先接住当前行为；不要复述上一版拒绝理由。'
        : state.boundary.mode !== 'none'
          ? '用户仍在边界话题时只用一句简短界限并自然给出可继续的亲近方向；用户转向亲吻、拥抱或日常后优先接住新请求，解除旧边界。'
          : '',
    };
  }
  const state = normalizeDialogueState(previous);
  const result = responseVariationNeeded(state, messages, options);
  if (!result.needed) return { ok: true, duplicate: false, fingerprints: result.fingerprints };
  return {
    ok: false,
    duplicate: true,
    reason: result.reason,
    against: result.against?.text || null,
    retryHint: '换一个回应形状，先回应本轮最新说话行为；不要重复上一条的开头、结尾或边界句。',
  };
}

function appendLedger(state, text, { topicKey = 'general', turnId = null, now } = {}) {
  const value = String(text || '').trim();
  if (!value) return;
  const fingerprint = responseFingerprint(value);
  const item = { fingerprint, text: value.slice(0, 600), shape: responseShape(value), topicKey, stance: null, turnId, createdAt: nowIso(now) };
  state.responseLedger = [...state.responseLedger.filter(entry => entry.fingerprint !== fingerprint), item].slice(-MAX_LEDGER);
}

export function updateAfterTurn(previous, { userText = '', assistantMessages = [], result = {}, turnId = null, now, analysis } = {}) {
  const state = normalizeDialogueState(previous);
  const time = nowIso(now);
  const current = analysis || analyzeUserActs(userText);
  for (const message of Array.isArray(assistantMessages) ? assistantMessages : [assistantMessages]) appendLedger(state, message, { topicKey: current.topicKey, turnId, now: time });
  const messages = (Array.isArray(assistantMessages) ? assistantMessages : [assistantMessages]).filter(item => typeof item === 'string' && item.trim());
  const question = messages.findLast(item => /[?？]\s*$/.test(item.trim()));
  state.pendingAssistant = question ? { kind: 'question', text: question.slice(0, MAX_TEXT), topicKey: topicFor(question), turnId, createdAt: time, attempts: 0 } : null;
  if ((current.primary?.kind === 'boundary' || current.hasCorrection && state.boundary.topicKey === 'sexual-explicit') && messages.length) {
    const last = messages.at(-1);
    state.boundary = { ...state.boundary, topicKey: 'sexual-explicit', mode: state.boundary.mode === 'firm' ? 'firm' : 'soft', lastVariant: last.slice(0, 120), lastResponseAt: time };
  } else if (current.boundaryReset || current.primary?.topicKey === 'affection') {
    state.boundary = { ...state.boundary, mode: 'none', topicKey: null, responseCount: 0, lastVariant: null, cooldownUntil: time, lastResponseAt: time };
    state.unresolved = state.unresolved.filter(item => item.topicKey !== 'sexual-explicit');
    state.pendingUser = null;
  } else if (current.primary && current.primary.kind !== 'boundary' && messages.length) {
    // prepareTurn runs before the commit allocates the user message UUID, so
    // a pending item may have a null turnId. Match that item by the current
    // act as a fallback; otherwise a successfully answered point would live
    // forever in the hidden prompt state.
    state.unresolved = state.unresolved.filter(item => {
      const sameTurn = item.turnId && item.turnId === turnId;
      const sameAct = item.kind === current.primary.kind && item.topicKey === current.primary.topicKey;
      return !(sameTurn || sameAct) || item.kind === 'boundary';
    });
    if (state.pendingUser && (state.pendingUser.turnId === turnId
      || !state.pendingUser.turnId
      || state.pendingUser.kind === current.primary.kind && state.pendingUser.topicKey === current.primary.topicKey)) state.pendingUser = null;
  }
  state.updatedAt = time;
  state.lastTurnId = turnId || state.lastTurnId;
  return state;
}

export { responseShape };

