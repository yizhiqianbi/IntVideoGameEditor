// A small, deterministic runtime for the fictional character's own unfinished
// activities. Time creates an opportunity to reconsider; it never invents an
// action, a completed outcome, or something the user has done.
export const AGENCY_MIN_DELAY_MS = 120000;
export const AGENCY_WINDOW_MS = 15 * 60000;
export const AGENCY_WINDOW_LIMIT = 3;
const MAX_THREADS = 12;
const MAX_LEDGER = 40;
const MAX_ACTIVE = 4;
const MAX_DELAY_MS = 6 * 3600000;
const THREAD_TTL_MS = 24 * 3600000;
const STATUSES = new Set(['active', 'waiting', 'resolved', 'closed']);
const iso = value => new Date(value).toISOString();
const clock = value => {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new TypeError('A valid runtime timestamp is required.');
  return ms;
};
const short = (value, max = 160) => typeof value === 'string' && value.trim() && value.length <= max;
const compact = value => String(value || '').toLowerCase().normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '');
const outsideQuotes = value => String(value || '').replace(/```[\s\S]*?```|`[^`]*`|“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"]*"|(?<![\p{L}\p{N}])'[^']*'(?![\p{L}\p{N}])/gu, '');

function terms(value) {
  const text = compact(value).replace(/我(?:现在|刚才|已经|终于|还是|又)?|一点|有点|稍微|感觉|觉得|开心|高兴|紧张|害羞|温柔|认真|决定/gu, '');
  const items = new Set(text.match(/[a-z0-9]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2}/gu) || []);
  for (let i = 0; i < text.length - 2; i++) if (/\p{Script=Han}/u.test(text[i])) items.add(text.slice(i, i + 3));
  return items;
}

export function sameSubject(first, second) {
  const a = compact(first), b = compact(second);
  if (a === b || Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return true;
  const one = terms(a), two = terms(b);
  const overlap = [...one].filter(term => two.has(term)).length;
  return overlap >= 2 && overlap / Math.max(1, Math.min(one.size, two.size)) >= 0.5;
}

function substantiveChange(previous, proposal) {
  if (compact(previous.currentState) === compact(proposal.state)) return false;
  // A feeling or renamed next step cannot, by itself, buy another opportunity.
  if (compact(previous.nextStep) === compact(proposal.nextStep)) return false;
  const before = terms(previous.currentState), after = terms(proposal.state);
  const overlap = [...before].filter(term => after.has(term)).length;
  return overlap / Math.max(1, Math.max(before.size, after.size)) < 0.8;
}

export function createAgency() {
  return { version: 1, threads: [], ledger: [], nextAt: null };
}

export function readAgency(value) {
  if (!value || value.version !== 1) return createAgency();
  const threads = (Array.isArray(value.threads) ? value.threads : []).filter(thread => thread
    && thread.scope === 'fictional-character' && short(thread.id, 100) && short(thread.subject, 120)
    && short(thread.currentState) && typeof thread.nextStep === 'string' && thread.nextStep.length <= 160
    && typeof thread.feeling === 'string' && thread.feeling.length <= 100 && STATUSES.has(thread.status)
    && Number.isInteger(thread.revision) && thread.revision >= 1 && short(thread.sourceMessageId, 100)
    && ['updatedAt', 'notBefore', 'expiresAt'].every(key => Number.isFinite(Date.parse(thread[key]))))
    .slice(-MAX_THREADS).map(thread => ({
      id: thread.id, scope: 'fictional-character', subject: thread.subject, currentState: thread.currentState,
      nextStep: thread.nextStep, feeling: thread.feeling, status: thread.status, revision: thread.revision,
      lastDeliveredRevision: Number.isInteger(thread.lastDeliveredRevision) ? Math.min(thread.revision, Math.max(0, thread.lastDeliveredRevision)) : 0,
      sourceMessageId: thread.sourceMessageId, updatedAt: thread.updatedAt, notBefore: thread.notBefore, expiresAt: thread.expiresAt,
    }));
  const ledger = (Array.isArray(value.ledger) ? value.ledger : []).filter(item => item
    && short(item.opportunityId, 160) && short(item.threadId, 100) && Number.isInteger(item.revision)
    && Number.isFinite(Date.parse(item.sentAt)) && ['sent', 'silent'].includes(item.outcome))
    .slice(-MAX_LEDGER).map(item => ({ opportunityId: item.opportunityId, threadId: item.threadId, revision: item.revision, sentAt: item.sentAt, outcome: item.outcome }));
  return { version: 1, threads, ledger, nextAt: typeof value.nextAt === 'string' && Number.isFinite(Date.parse(value.nextAt)) ? value.nextAt : null };
}

export function parseLifeProposal(value) {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.scope !== undefined && value.scope !== 'fictional-character'
    || !short(value.subject, 120) || !short(value.state)
    || !['active', 'resolved'].includes(value.status)
    || value.status === 'active' && !short(value.nextStep)
    || value.nextStep !== undefined && (typeof value.nextStep !== 'string' || value.nextStep.length > 160)
    || value.feeling !== undefined && (typeof value.feeling !== 'string' || value.feeling.length > 100)
    || value.delaySeconds !== undefined && (typeof value.delaySeconds !== 'number' || !Number.isFinite(value.delaySeconds))) {
    throw Object.assign(new Error('角色生活事项格式无效，请重试。'), { status: 502 });
  }
  return { scope: 'fictional-character', subject: value.subject.trim(), state: value.state.trim(),
    nextStep: value.status === 'active' ? value.nextStep.trim() : '', feeling: value.feeling?.trim() || '', status: value.status,
    delaySeconds: Math.max(AGENCY_MIN_DELAY_MS / 1000, Math.min(MAX_DELAY_MS / 1000, value.delaySeconds ?? 180)) };
}

function sourceFor(proposal, messages) {
  // Quotes of another speaker and code are context, not character activity.
  // Chinese may omit its already established speaker. In that case require an
  // actual action/intention marker and reject explicit other-speaker subjects.
  const firstPerson = proposal.state.match(/我(?!们)|\bI\b|私/iu);
  const omittedSelfAction = /(?:准备|打算|决定|正(?:在|从)|开始|继续|翻(?:出|出来)|收(?:好|起来)|写(?:好|完)|画(?:好|完)|唱(?:完|顺)|听(?:完|到)|练(?:完|顺)|读(?:完|到)|做(?:好|完)|整理(?:好|完))/u.test(proposal.state);
  const explicitOtherSubject = /(?:^|[，,。.!?！？\s])(?:你|您|他|她|他们|她们|用户|对方|朋友|同学|同事|姐姐|妹妹|哥哥|弟弟)(?!好|的好)|(?:^|[，,。.!?！？\s])(?!这次|这会|现在|刚才|今天|明天|接下来|马上|稍后|终于|已经|正在|不|还)[\p{Script=Han}]{2,4}(?=把|已经|刚刚|正在|准备|打算|决定)|(?:^|[，,。.!?！？\s])(?:小|老)[\p{Script=Han}]{1,2}(?=的|翻|听|唱|做|写|收|读)/u.test(proposal.state);
  if (/(?:(?:你|他|她|用户)(?:已|刚|去|做|完成)|我们(?:一起|刚刚|已经)|\b(?:you|she|he|they) (?:have|did|went|finished)|\bwe (?:did|went|finished))/iu.test(proposal.state)) return null;
  return messages.find(message => {
    if (message.role !== 'assistant' || typeof message.text !== 'string') return false;
    const text = outsideQuotes(message.text), index = text.indexOf(proposal.state);
    if (index < 0) return false;
    const sourcePrefix = text.slice(0, index).split(/[。.!?！？\n]/u).at(-1);
    // A model may quote only the action substring, omitting the adjacent 我/I.
    // Read ownership from that actual source clause, rather than requiring the
    // state slice to repeat its subject or growing a verb whitelist for it.
    const ownedSourceClause = /^(?:我(?!们)|I\b|私)/iu.test(sourcePrefix.trim());
    if (!firstPerson && !ownedSourceClause && (!omittedSelfAction || explicitOtherSubject
      || /(?:你|您|他|她|用户|朋友|对方|同学|同事)|(?:小|老)[\p{Script=Han}]{1,2}/u.test(sourcePrefix))) return false;
    const prefix = (sourcePrefix + proposal.state.slice(0, firstPerson?.index ?? 0)).split(/[。.!?！？\n]/u).at(-1);
    const attributed = /(?:原话|转述|引用|举例|例如|比如|假如|假设|如果|听说|据说|(?:你|他|她|用户|朋友|小林|对方).{0,20}(?:说|写|讲|问)|(?:said|says|wrote|quoted|example|suppose|imagine))/iu;
    const reportedWithinState = /(?:原话|转述|引用|举例|例如|比如|假如|假设|如果|(?:^|[，,。.!?！？\s])(?:你|他|她|用户|朋友|小林|对方).{0,20}(?:说|写|讲|问)|(?:said|says|wrote|quoted|example|suppose|imagine))/iu;
    return !attributed.test(prefix) && !reportedWithinState.test(proposal.state);
  }) || null;
}

function opportunity(thread) {
  return { id: `${thread.id}:${thread.revision}`, threadId: thread.id, revision: thread.revision,
    subject: thread.subject, currentState: thread.currentState, nextStep: thread.nextStep,
    feeling: thread.feeling, sourceMessageId: thread.sourceMessageId, reason: 'character-next-step' };
}

export function agencyStatus(value, { now } = {}) {
  const agency = readAgency(value), ms = clock(now);
  const recent = agency.ledger.filter(item => ms - Date.parse(item.sentAt) < AGENCY_WINDOW_MS && Date.parse(item.sentAt) <= ms);
  const last = agency.ledger.at(-1);
  const cooldown = last ? Date.parse(last.sentAt) + AGENCY_MIN_DELAY_MS : 0;
  const windowAt = recent.length >= AGENCY_WINDOW_LIMIT ? Date.parse(recent[recent.length - AGENCY_WINDOW_LIMIT].sentAt) + AGENCY_WINDOW_MS : 0;
  const candidates = agency.threads.filter(thread => thread.status === 'active' && thread.nextStep
    && thread.lastDeliveredRevision < thread.revision && ms < Date.parse(thread.expiresAt)
    && !agency.ledger.some(item => item.opportunityId === `${thread.id}:${thread.revision}`))
    .map(thread => ({ thread, at: Math.max(Date.parse(thread.notBefore), cooldown, windowAt) }))
    .filter(item => item.at < Date.parse(item.thread.expiresAt)).sort((a, b) => a.at - b.at || a.thread.updatedAt.localeCompare(b.thread.updatedAt));
  const next = candidates[0];
  return { activeCount: agency.threads.filter(thread => thread.status === 'active' && ms < Date.parse(thread.expiresAt)).length,
    ready: Boolean(next && next.at <= ms), nextAt: next ? iso(next.at) : null,
    opportunity: next && next.at <= ms ? opportunity(next.thread) : null,
    cooldownUntil: cooldown > ms ? iso(cooldown) : null,
    remainingInWindow: Math.max(0, AGENCY_WINDOW_LIMIT - recent.length) };
}

function refresh(agency, now) {
  agency.nextAt = agencyStatus(agency, { now }).nextAt;
  return agency;
}

export function applyLifeProposal(value, life, { messages = [], now, id } = {}) {
  const agency = readAgency(value);
  const proposal = parseLifeProposal(life);
  if (!proposal) return refresh(agency, now);
  const source = sourceFor(proposal, messages);
  if (!source) return refresh(agency, now);
  const previous = agency.threads.find(thread => sameSubject(thread.subject, proposal.subject));
  if (previous && ['closed', 'resolved'].includes(previous.status)) return refresh(agency, now);
  if (previous && proposal.status === 'active' && !substantiveChange(previous, proposal)) return refresh(agency, now);
  if (!previous && proposal.status === 'resolved') return refresh(agency, now);
  const ms = clock(now);
  if (!previous && agency.threads.filter(thread => ['active', 'waiting'].includes(thread.status) && ms < Date.parse(thread.expiresAt)).length >= MAX_ACTIVE) return refresh(agency, now);
  if (!previous && !short(id, 100)) throw new TypeError('New activity needs an application-assigned id.');
  const thread = { id: previous?.id || id, scope: 'fictional-character', subject: previous?.subject || proposal.subject,
    currentState: proposal.state, nextStep: proposal.nextStep, feeling: proposal.feeling, status: proposal.status,
    revision: (previous?.revision || 0) + 1, lastDeliveredRevision: previous?.lastDeliveredRevision || 0,
    sourceMessageId: source.id, updatedAt: iso(ms), notBefore: iso(ms + proposal.delaySeconds * 1000),
    expiresAt: iso(ms + proposal.delaySeconds * 1000 + THREAD_TTL_MS) };
  agency.threads = [...agency.threads.filter(item => item.id !== thread.id), thread].slice(-MAX_THREADS);
  return refresh(agency, now);
}

export function closeAgencyThreads(value, { topic, now, all = false } = {}) {
  const agency = readAgency(value);
  agency.threads = agency.threads.map(thread => ['active', 'waiting'].includes(thread.status)
    && (all || sameSubject(thread.subject, topic) || sameSubject(thread.currentState, topic))
    ? { ...thread, status: 'closed', updatedAt: iso(clock(now)) } : thread);
  return refresh(agency, now);
}

export function reopenAgencyThreads(value, { topic, now } = {}) {
  const agency = readAgency(value);
  // Reopening permits the next expressed model proposal; it does not itself
  // resume an old due event or claim the old activity is happening again.
  agency.threads = agency.threads.filter(thread => !(['closed', 'resolved'].includes(thread.status)
    && (sameSubject(thread.subject, topic) || sameSubject(thread.currentState, topic))));
  return refresh(agency, now);
}

export function consumeAgencyOpportunity(value, id, { now, outcome = 'silent' } = {}) {
  const agency = readAgency(value), ms = clock(now);
  const thread = agency.threads.find(item => `${item.id}:${item.revision}` === id);
  if (!thread || agency.ledger.some(item => item.opportunityId === id)) return refresh(agency, now);
  agency.ledger = [...agency.ledger, { opportunityId: id, threadId: thread.id, revision: thread.revision, sentAt: iso(ms), outcome: outcome === 'sent' ? 'sent' : 'silent' }].slice(-MAX_LEDGER);
  thread.lastDeliveredRevision = thread.revision;
  if (thread.status === 'active') thread.status = 'waiting';
  return refresh(agency, now);
}

export function refreshAgency(value, { now } = {}) {
  return refresh(readAgency(value), now);
}
