import { randomUUID } from 'node:crypto';

// A small, dependency-free slice of EbbingFlow's memory model.  The full
// project uses SQL + graph + vector stores; the prototype keeps the same
// evidence semantics inside the session document so we can validate behavior
// before adding infrastructure.

const HALF_LIFE_DAYS = Object.freeze({
  identity: 365,
  preference: 120,
  plan: 45,
  relationship: 180,
  episode: 30,
  conversation: 7,
});

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function parseTime(value, fallback = Date.now()) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function timeDecay(item, now) {
  const halfLife = Number(item?.halfLifeDays) > 0
    ? Number(item.halfLifeDays)
    : HALF_LIFE_DAYS[item?.memoryClass] || HALF_LIFE_DAYS.conversation;
  const ageDays = Math.max(0, (parseTime(now) - parseTime(item?.updatedAt || item?.createdAt)) / 86400000);
  const raw = Math.exp(-Math.LN2 * ageDays / halfLife);
  const confidence = Number.isFinite(Number(item?.confidence)) ? clamp(Number(item.confidence), 0, 1) : 1;
  // High-confidence facts get a small long-term floor. Low-confidence
  // observations should be allowed to disappear completely.
  return confidence >= 0.7 ? Math.max(0.25, raw) : raw;
}

export function inferMemoryIntent(text) {
  const value = String(text || '').toLowerCase();
  if (/(?:多少|哪里|什么时候|哪天|谁|是什么|有没有|是否|生日|名字|住在|电话|地址|when|where|who|what is)/iu.test(value)) return 'fact';
  if (/(?:最近|这几轮|这段时间|总结|回顾|发生了什么|进展|recap|what happened)/iu.test(value)) return 'summary';
  if (/(?:一直|以来|长期|关系|阶段|以后|将来|长期目标|long[- ]term|over time)/iu.test(value)) return 'long_term';
  return 'semantic';
}

function overlap(query, candidate) {
  const normalize = (value) => String(value || '').toLowerCase().normalize('NFKC');
  const q = normalize(query);
  const c = normalize(candidate);
  if (!q || !c) return 0;
  const latin = q.match(/[a-z][a-z'-]{2,}/g) || [];
  const han = q.match(/[\u3400-\u9fff]{2,}/gu) || [];
  const terms = new Set([...latin, ...han.flatMap(run => Array.from({ length: Math.max(0, run.length - 1) }, (_, i) => run.slice(i, i + 2))) ]);
  if (!terms.size) return c.includes(q) ? 1 : 0;
  let hits = 0;
  for (const term of terms) if (c.includes(term)) hits += 1;
  return hits / terms.size;
}

function memoryState(session) {
  return {
    events: Array.isArray(session?.memoryEvents) ? session.memoryEvents : [],
    episodes: Array.isArray(session?.memoryEpisodes) ? session.memoryEpisodes : [],
    openLoops: Array.isArray(session?.openLoops) ? session.openLoops : [],
  };
}

export function retrieveMemory(session, query, { now, limit = 6 } = {}) {
  const { events, episodes, openLoops } = memoryState(session);
  const activeMemoryIds = new Set((session?.memories || []).map(item => item.id));
  const closedTopics = (session?.closedTopics || []).filter(item => item?.text && item.text !== '上一段话题').map(item => item.text);
  const closedAll = (session?.closedTopics || []).some(item => item?.text === '上一段话题');
  const explicitlyReopened = /(?:再聊|回到|重新(?:聊|谈)|继续(?:聊|谈)|revisit|back to|talk about .{0,40} again)/iu.test(String(query || ''));
  const intent = inferMemoryIntent(query);
  const candidates = [
    ...events.filter(item => !item.memoryId || activeMemoryIds.has(item.memoryId)).map(item => ({ ...item, source: 'event', content: item.content || item.text })),
    ...episodes.map(item => ({ ...item, source: 'episode', content: item.summary })),
    ...openLoops.filter(item => item.status !== 'resolved').map(item => ({ ...item, source: 'open_loop', content: item.text })),
  ].filter(item => {
    if (typeof item.content !== 'string' || !item.content.trim()) return false;
    if (closedAll && !explicitlyReopened) return false;
    // Match the existing conversation rule: a closed subject stays out of
    // memory context until the user explicitly brings it back.
    return !closedTopics.some(topic => {
      const content = String(item.content).normalize('NFKC');
      const closed = String(topic).normalize('NFKC');
      const mentioned = content.includes(closed) || overlap(item.content, topic) >= 0.35 || overlap(topic, item.content) >= 0.35;
      return mentioned && overlap(query, topic) < 0.35;
    });
  });

  return candidates
    .map(item => {
      const lexical = overlap(query, item.content);
      const intentBoost = intent === 'fact' && item.source === 'event' ? 0.25
        : intent === 'summary' && item.source === 'episode' ? 0.25
          : intent === 'long_term' && item.source === 'episode' ? 0.15 : 0;
      const importance = clamp((Number(item.impact) || 1) / 10, 0, 1);
      const score = lexical * 0.55 + timeDecay(item, now) * 0.2 + importance * 0.15 + intentBoost;
      return { item, score };
    })
    .filter(({ item, score }) => {
      const lexical = overlap(query, item.content);
      const narrativeIntent = intent === 'summary' || intent === 'long_term';
      return score >= 0.16 && (lexical > 0 || item.source === 'open_loop' || narrativeIntent && item.source === 'episode');
    })
    .sort((a, b) => b.score - a.score || parseTime(b.item.updatedAt) - parseTime(a.item.updatedAt))
    .slice(0, limit)
    .map(({ item, score }) => ({
      source: item.source,
      text: item.content,
      score: Number(score.toFixed(4)),
      memoryClass: item.memoryClass,
      sourceMessageId: item.sourceMessageId,
      confidence: item.confidence,
      impact: item.impact,
      evidence: item.evidence,
      createdAt: item.createdAt,
    }));
}

function relationshipSignal(text) {
  const value = String(text || '');
  if (/(?:讨厌|冷漠|敷衍|失望|生气|别嗯|不理我|别理我|讨厌你|你好冷)/u.test(value)) return { kind: 'relationship', impact: 8 };
  if (/(?:喜欢你|想你|抱抱|谢谢你|对不起|抱歉|理解你|在乎你)/u.test(value)) return { kind: 'relationship', impact: 7 };
  return null;
}

export function ensureMemoryState(session) {
  if (!Array.isArray(session.memoryEvents)) session.memoryEvents = [];
  if (!Array.isArray(session.memoryEpisodes)) session.memoryEpisodes = [];
  if (!Array.isArray(session.openLoops)) session.openLoops = [];
  return session;
}

export function recordMemoryEvidence(session, { text, message, memories = [], now } = {}) {
  ensureMemoryState(session);
  const time = new Date(parseTime(now)).toISOString();
  const sourceMessageId = message?.id || null;
  const signal = relationshipSignal(text);

  if (signal) {
    session.memoryEvents.push({
      id: randomUUID(), memoryClass: 'relationship', kind: signal.kind,
      content: String(text).trim().slice(0, 240), text: String(text).trim().slice(0, 240),
      impact: signal.impact, confidence: 0.9, sourceMessageId, evidence: String(text).trim().slice(0, 240),
      createdAt: time, updatedAt: time,
    });
  }

  for (const memory of memories) {
    const memoryClass = memory.category === 'profile' ? 'identity' : memory.category === 'preference' ? 'preference' : 'plan';
    const existing = session.memoryEvents.find(item => item.memoryId === memory.id || item.content === memory.text);
    if (existing) {
      existing.updatedAt = time;
      existing.sourceMessageId = sourceMessageId || existing.sourceMessageId;
      continue;
    }
    session.memoryEvents.push({
      id: randomUUID(), memoryId: memory.id, memoryClass, kind: 'fact',
      content: memory.text, text: memory.text, impact: memoryClass === 'plan' ? 7 : 6,
      confidence: memory.source === 'manual' ? 1 : 0.95,
      sourceMessageId: memory.messageId || sourceMessageId, evidence: memory.quote || text,
      createdAt: memory.createdAt || time, updatedAt: memory.updatedAt || time,
    });
    if (memoryClass === 'plan') {
      const existingLoop = session.openLoops.find(item => item.text === memory.text && item.status !== 'resolved');
      if (!existingLoop) session.openLoops.push({ id: randomUUID(), text: memory.text, status: 'open', sourceMessageId: memory.messageId || sourceMessageId, createdAt: time, updatedAt: time, impact: 7, confidence: 0.95, memoryClass: 'plan' });
    }
  }

  const userMessages = session.messages.filter(item => item.role === 'user');
  if (userMessages.length > 0 && userMessages.length % 5 === 0) {
    const recent = session.messages.slice(-10).filter(item => item.kind !== 'opening');
    const summary = recent.map(item => `${item.role === 'user' ? '用户' : '角色'}：${item.text}`).join('；').slice(0, 900);
    const sourceIds = recent.map(item => item.id).filter(Boolean);
    session.memoryEpisodes.push({
      id: randomUUID(), memoryClass: 'episode', summary, sourceMessageIds: sourceIds,
      impact: signal ? 7 : 4, confidence: 0.8, createdAt: time, updatedAt: time,
    });
    session.memoryEpisodes = session.memoryEpisodes.slice(-12);
  }

  session.memoryEvents = session.memoryEvents.slice(-80);
  session.openLoops = session.openLoops.slice(-24);
  return session;
}

export function closeOpenLoops(session, text, now) {
  ensureMemoryState(session);
  const query = String(text || '').trim();
  if (!query) return session;
  for (const loop of session.openLoops) {
    if (loop.status === 'open' && (query.includes(loop.text) || overlap(query, loop.text) >= 0.12)) {
      loop.status = 'resolved';
      loop.updatedAt = new Date(parseTime(now)).toISOString();
    }
  }
  return session;
}

export function memorySnapshot(session, query, options = {}) {
  ensureMemoryState(session);
  return retrieveMemory(session, query, options);
}

