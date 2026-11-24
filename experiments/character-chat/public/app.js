const $ = (id) => document.getElementById(id);
const storageKey = 'character-chat:last-session';
const pendingKey = 'character-chat:pending-turn';
const outboxKey = 'character-chat:outbox';
const draftsKey = 'character-chat:drafts';
const INPUT_SETTLE_MS = 700;
const shell = document.querySelector('.app-shell');
const smallInspector = window.matchMedia('(max-width: 1150px)');
const mobile = window.matchMedia('(max-width: 720px)');
const state = { health: null, sessions: [], session: null, sending: false, starting: false, mutating: false, reconciling: false, pending: null, outbox: [], inputTimer: null, outboxReadyAt: 0, foregroundTask: null, stream: null, editingMemory: null, drawer: null, playback: null, playbackVersion: 0, viewVersion: 0, initiativeTimer: null, agencyTimer: null, initiativeCandidate: null, initiativeTask: null, presenceTask: null, composing: false };
const dirtySessions = new Set();
const sessionReads = new Map();
const drafts = new Map();
const initiativeAttempts = new Set();
const initiativeFailures = new Set();
const emotionNames = { friendly: '亲切', playful: '有点俏皮', calm: '平静', concerned: '挂念', hurt: '有些低落', excited: '雀跃' };
const categoryNames = { profile: '关于你', preference: '你的偏好', plan: '你的计划' };

function readStorage(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeStorage(key, value) { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* Local storage is optional. */ } }
function icon(name) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `#i-${name}`); svg.append(use); svg.setAttribute('aria-hidden', 'true'); return svg; }
function el(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
function currentCharacter() { return state.health?.characters.find((item) => item.id === state.session?.characterId) || state.health?.characters[0]; }
function isBusy() { return state.sending || state.starting || state.mutating || state.reconciling || Boolean(state.pending) || state.outbox.some((item) => item.sessionId === state.session?.id); }
function timeLabel(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date); }
function dateLabel(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date); }
function recentLabel(value) { const date = new Date(value); const now = new Date(); if (Number.isNaN(date.getTime())) return ''; return date.toDateString() === now.toDateString() ? '今天' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date); }

async function api(path, options = {}) {
  let response;
  try { response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } }); }
  catch (cause) { if (options.signal?.aborted || cause.name === 'AbortError') throw new DOMException('已停止等待', 'AbortError'); const error = new Error('连接中断了。可以重试，继续这次发送。'); error.ambiguous = true; throw error; }
  let data;
  try { data = await response.json(); }
  catch { if (options.signal?.aborted) throw new DOMException('已停止等待', 'AbortError'); const error = new Error('没有收到完整回复，请重试这次发送。'); error.ambiguous = response.ok; error.status = response.status; throw error; }
  if (!response.ok) { const error = new Error(typeof data.error === 'string' ? data.error : '暂时无法完成，请稍后再试。'); error.status = response.status; error.code = data.code; throw error; }
  return data;
}

async function sendStreamingTurn(pending, onMessage, signal) {
  let response;
  try {
    response = await fetch(`/api/sessions/${pending.sessionId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: pending.text, requestId: pending.requestId, revision: pending.revision, locale: pending.locale, stream: true }), signal });
  } catch { if (signal?.aborted) throw new DOMException('正在接着听你说', 'AbortError'); const error = new Error('连接中断了。你的消息还在，可以继续这次发送。'); error.ambiguous = true; throw error; }
  if (!response.ok || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
    let data;
    try { data = await response.json(); }
    catch { const error = new Error('没有收到完整回复，请检查这次发送。'); error.ambiguous = response.ok; throw error; }
    if (!response.ok) { const error = new Error(data.error || '暂时没有收到回复，请稍后重试。'); error.code = data.code; error.status = response.status; throw error; }
    return data;
  }
  const reader = response.body?.getReader();
  if (!reader) { const error = new Error('没有收到完整回复，请检查这次发送。'); error.ambiguous = true; throw error; }
  const decoder = new TextDecoder(); let buffer = '';
  const consume = (line) => {
    if (!line.trim()) return null;
    let event;
    try { event = JSON.parse(line); } catch { const error = new Error('回复连接中断了，请检查这次发送。'); error.ambiguous = true; throw error; }
    if (event.type === 'message') {
      if (!Number.isInteger(event.index) || event.index < 0 || event.index > 2 || typeof event.text !== 'string' || !event.text.trim() || event.text.length > 3000) { const error = new Error('回复没有完整到达，请检查这次发送。'); error.ambiguous = true; throw error; }
      onMessage(event.index, event.text);
    } else if (event.type === 'done' && event.session) return { session: event.session };
    else if (event.type === 'error') { const error = new Error(typeof event.error === 'string' ? event.error : '这次回复没有完成，可以重试。'); error.code = event.code; throw error; }
    return null;
  };
  try {
    while (true) {
      let chunk;
      try { chunk = await reader.read(); } catch { if (signal?.aborted) throw new DOMException('正在接着听你说', 'AbortError'); const error = new Error('连接中断了，请检查这次发送。'); error.ambiguous = true; throw error; }
      if (signal?.aborted) throw new DOMException('正在接着听你说', 'AbortError');
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
      if (buffer.length > 1000000) { const error = new Error('回复连接异常，请检查这次发送。'); error.ambiguous = true; throw error; }
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        const result = consume(line); if (result) return result;
      }
      if (chunk.done) { const result = consume(buffer); if (result) return result; const error = new Error('没有收到完整回复，请检查这次发送。'); error.ambiguous = true; throw error; }
    }
  } finally { reader.releaseLock(); }
}

function feedback(message, retry = false) { $('feedback-text').textContent = message || ''; $('feedback').hidden = !message; $('retry-send').hidden = !retry; $('check-send').hidden = !retry; }
function setPending(value) { state.pending = value; writeStorage(pendingKey, value ? JSON.stringify(value) : null); }
function persistOutbox() { writeStorage(outboxKey, state.outbox.length ? JSON.stringify(state.outbox) : null); }
function saveDraft() { if (state.session) setDraft(state.session.id, $('message-input').value); }
function setDraft(id, value) {
  // The current session is the natural target for composer updates. Keep the
  // two-argument form for session restoration, but also accept setDraft(text)
  // so typing helpers and the UI harness cannot accidentally leave the field
  // unchanged while testing initiative suppression.
  if (value === undefined) { value = id; id = state.session?.id; }
  if (!id) return;
  value ? drafts.set(id, value) : drafts.delete(id);
  writeStorage(draftsKey, drafts.size ? JSON.stringify(Object.fromEntries(drafts)) : null);
  if (state.session?.id === id && $('message-input').value !== value) $('message-input').value = value;
}
function restoreDraft(id) { $('message-input').value = drafts.get(id) || ''; }
function clearDraft(id) { setDraft(id, ''); }
function restoreFailedDraft(pending) { if (!(drafts.get(pending.sessionId) || '').trim()) { setDraft(pending.sessionId, pending.text); if (state.pending?.requestId === pending.requestId) setPending({ ...state.pending, restoredDraft: true }); } }
function clearRecoveredDraft(pending) { if (state.pending?.restoredDraft && drafts.get(pending.sessionId)?.trim() === pending.text) clearDraft(pending.sessionId); }
function updateControls() {
  const locked = isBusy();
  shell.classList.toggle('busy', locked);
  $('message-input').disabled = !state.session || state.mutating;
  $('message-input').readOnly = false;
  // Generation never locks the composer: a new sent segment interrupts it.
  const sendLocked = state.mutating || (state.reconciling && !state.starting && !state.sending) || (Boolean(state.pending) && !state.sending && !state.starting);
  $('send-message').disabled = !state.session || sendLocked || !$('message-input').value.trim();
  $('new-chat').disabled = locked || !state.health;
  $('language-select').disabled = !state.session || locked;
  $('initiative-toggle').disabled = !state.session || locked;
  $('retry-send').disabled = state.sending || state.mutating;
  $('check-send').disabled = state.sending || state.mutating;
  const initiativeThinking = state.initiativeTask && !state.initiativeTask.cancelled && state.initiativeTask.sessionId === state.session?.id;
  $('thinking').hidden = !(state.sending || state.playback?.typing || initiativeThinking);
  $('thinking-label').textContent = `${currentCharacter()?.name || ''} 正在输入`;
  document.querySelectorAll('.character-button,.session-button,.memory-tools button').forEach((button) => { button.disabled = locked; });
  $('composer-hint').textContent = state.outbox.some((item) => item.sessionId === state.session?.id) ? '接着说吧，她会一起看' : state.sending ? '可以继续发，她会接着你的新消息说' : state.starting ? '正在接着听，你可以继续发' : state.pending ? '上句还没确认，草稿还在' : 'Enter 发送 · 可以连续发几句';
}

function scrollTimeline(force = false) {
  const timeline = $('timeline');
  if (force || timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 140) requestAnimationFrame(() => { timeline.scrollTop = timeline.scrollHeight; });
}

function cancelPlayback({ flush = false } = {}) {
  if (state.playback?.timer) clearTimeout(state.playback.timer);
  state.playback = null; state.playbackVersion += 1;
  if (flush && state.session) renderMessages(false);
  updateControls();
}

function sameBurst(first, second) {
  return first?.role === 'assistant' && second?.role === 'assistant' && Boolean(first.turnId) && first.turnId === second.turnId;
}

function appendMessage(message, pending = false) {
  const existing = [...$('messages').children].some((row) => row.dataset.messageId === (message.id || 'pending'));
  if (existing) return;
  const previousRow = $('messages').lastElementChild;
  const previous = state.session.messages.find((item) => item.id === previousRow?.dataset.messageId) || state.stream?.messages.find((item) => item.id === previousRow?.dataset.messageId);
  const continuation = sameBurst(previous, message);
  if (continuation) previousRow.classList.add('burst-before');
  $('messages').append(renderMessage(message, pending, continuation));
}

function advancePlayback(version) {
  const playback = state.playback;
  if (!playback || playback.version !== version || playback.sessionId !== state.session?.id || document.hidden) return;
  const id = playback.remaining.shift();
  const message = state.session.messages.find((item) => item.id === id);
  const atBottom = $('timeline').scrollHeight - $('timeline').scrollTop - $('timeline').clientHeight < 140;
  playback.hidden.delete(id);
  if (message) appendMessage(message);
  if (!playback.remaining.length) { state.playback = null; updateControls(); scrollTimeline(atBottom); scheduleInitiative(); return; }
  updateControls(); scrollTimeline(atBottom);
  playback.timer = setTimeout(() => advancePlayback(version), Math.min(900, 500 + (message?.text.length || 0) * 4));
}

function acceptSession(session, { animate = false, scroll = true, presentedParts = 0 } = {}) {
  const previousIds = new Set(state.session?.id === session.id ? state.session.messages.map((message) => message.id) : []);
  cancelPlayback(); state.session = session; adoptInitiativePlan(session);
  const added = session.messages.filter((message) => message.role === 'assistant' && !previousIds.has(message.id));
  const visibleCount = Math.max(1, presentedParts);
  if (animate && added.length > visibleCount && !document.hidden) {
    const version = state.playbackVersion;
    state.playback = { version, sessionId: session.id, hidden: new Set(added.slice(visibleCount).map((message) => message.id)), remaining: added.slice(visibleCount).map((message) => message.id), typing: true, timer: null };
    renderSession({ scroll });
    state.playback.timer = setTimeout(() => advancePlayback(version), Math.min(900, 500 + added[visibleCount - 1].text.length * 4));
  } else renderSession({ scroll });
  scheduleInitiative();
}

function showStreamingMessage(pending, index, text) {
  const stream = state.stream;
  if (!stream || stream.requestId !== pending.requestId || stream.sessionId !== state.session?.id || stream.viewVersion !== state.viewVersion) return;
  const existing = stream.messages.find((message) => message.partIndex === index);
  if (existing) {
    if (existing.text !== text) { const error = new Error('这次回复需要重新确认，请检查发送结果。'); error.ambiguous = true; throw error; }
    return;
  }
  if (index !== stream.messages.length) { const error = new Error('回复没有完整到达，请检查发送结果。'); error.ambiguous = true; throw error; }
  const atBottom = $('timeline').scrollHeight - $('timeline').scrollTop - $('timeline').clientHeight < 140;
  const message = { id: `stream:${pending.requestId}:${index}`, role: 'assistant', text, createdAt: new Date().toISOString(), turnId: pending.requestId, partIndex: index, provisional: true };
  stream.messages.push(message); appendMessage(message); updateControls(); scrollTimeline(atBottom);
}

function cancelInitiativeTimer() { if (state.initiativeTimer) clearTimeout(state.initiativeTimer); state.initiativeTimer = null; }

async function rereadSession(id, { clearDirty = false } = {}) {
  const viewVersion = state.viewVersion;
  let promise = sessionReads.get(id);
  if (!promise) {
    promise = api(`/api/sessions/${id}`);
    sessionReads.set(id, promise);
    promise.finally(() => { if (sessionReads.get(id) === promise) sessionReads.delete(id); }).catch(() => {});
  }
  const data = await promise;
  if (clearDirty) dirtySessions.delete(id);
  if (viewVersion === state.viewVersion && state.session?.id === id && data.session.revision >= state.session.revision) acceptSession(data.session, { scroll: false });
  return data.session;
}

function cancelInitiative({ clearCandidate = false, reread = true } = {}) {
  cancelInitiativeTimer();
  if (state.agencyTimer) clearTimeout(state.agencyTimer);
  state.agencyTimer = null;
  if (clearCandidate) state.initiativeCandidate = null;
  const task = state.initiativeTask;
  if (task && !task.cancelled) {
    task.cancelled = true; task.controller.abort(); dirtySessions.add(task.sessionId); updateControls();
    if (reread && !document.hidden) task.promise.finally(() => {
      if (state.session?.id === task.sessionId) rereadSession(task.sessionId, { clearDirty: true }).then(scheduleInitiative).catch(() => {});
    }).catch(() => {});
  }
  const presence = state.presenceTask;
  if (presence && !presence.cancelled) {
    presence.cancelled = true; presence.controller.abort(); dirtySessions.add(presence.sessionId);
    if (reread && !document.hidden) presence.promise.finally(() => {
      if (state.session?.id === presence.sessionId) rereadSession(presence.sessionId, { clearDirty: true }).then(scheduleInitiative).catch(() => {});
    }).catch(() => {});
  }
}

async function prepareForegroundAction() {
  const id = state.session?.id;
  cancelInitiative({ reread: false }); cancelPlayback({ flush: true });
  if (!id || !dirtySessions.has(id)) return true;
  state.reconciling = true; updateControls();
  try {
    if (state.initiativeTask?.sessionId === id) await state.initiativeTask.promise;
    if (state.presenceTask?.sessionId === id) await state.presenceTask.promise;
    if (sessionReads.has(id)) await sessionReads.get(id).catch(() => {});
    await rereadSession(id, { clearDirty: true });
    return state.session?.id === id;
  } catch { feedback('暂时没能读取最新对话。你的草稿还在，稍后再发就好。'); return false; }
  finally { state.reconciling = false; updateControls(); }
}

const presenceAttempts = new Set();
function deadline(value) { return typeof value === 'number' ? value : Date.parse(value); }
function planKey(candidate) { return `${candidate.sessionId}:${candidate.planId}`; }
function adoptInitiativePlan(session) {
  const plan = session.initiative?.pending;
  state.initiativeCandidate = plan?.id && plan.kind === 'reconsider' && Number.isFinite(deadline(plan.notBefore)) && Number.isFinite(deadline(plan.expiresAt)) ? { sessionId: session.id, planId: plan.id, notBefore: deadline(plan.notBefore), expiresAt: deadline(plan.expiresAt) } : null;
}
function canConsiderInitiative() {
  return Boolean(state.session && !document.hidden && state.session.initiative?.enabled !== false && !state.session.initiative?.pausedUntilUser && !dirtySessions.has(state.session.id) && !isBusy() && !state.composing && !state.playback && !state.initiativeTask && !state.presenceTask && !state.drawer && !$('new-chat-dialog').open && !$('edit-memory-dialog').open && !$('message-input').value.length && !state.outbox.some(item => item.sessionId === state.session.id));
}
function initiativeEligible(candidate = state.initiativeCandidate) {
  return Boolean(candidate && canConsiderInitiative() && state.session.initiative?.noReplyNudgeUsed !== true && (state.session.initiative?.budgetUsed < 3 || state.session.initiative?.pending?.opportunityId) && candidate.sessionId === state.session.id && candidate.planId === state.session.initiative?.pending?.id && candidate.expiresAt > Date.now() && !initiativeAttempts.has(planKey(candidate)) && !initiativeFailures.has(planKey(candidate)));
}

function scheduleInitiative() {
  cancelInitiativeTimer();
  scheduleAgencyPresence();
  const candidate = state.initiativeCandidate;
  if (candidate && canConsiderInitiative() && candidate.expiresAt <= Date.now()) { announcePresence(); return; }
  if (!initiativeEligible(candidate)) return;
  const delay = Math.max(2000, candidate.notBefore - Date.now());
  state.initiativeTimer = setTimeout(() => {
    state.initiativeTimer = null;
    if (candidate.expiresAt <= Date.now()) { if (canConsiderInitiative()) announcePresence(); return; }
    if (initiativeEligible(candidate)) requestInitiative(candidate);
  }, Math.min(delay, 2147483647));
}

// Time wakes a cheap local state check. Only an eligible, concrete opportunity
// can wake the model; a spent follow-up budget does not end her ongoing life.
function scheduleAgencyPresence() {
  if (state.agencyTimer) clearTimeout(state.agencyTimer);
  state.agencyTimer = null;
  if (!canConsiderInitiative()) return;
  const nextAt = deadline(state.session.agency?.nextAt);
  if (!Number.isFinite(nextAt)) return;
  const sessionId = state.session.id;
  state.agencyTimer = setTimeout(() => {
    state.agencyTimer = null;
    if (state.session?.id === sessionId && canConsiderInitiative()) announcePresence();
  }, Math.min(2147483647, Math.max(15000, nextAt - Date.now())));
}

async function announcePresence({ retry = false } = {}) {
  const session = state.session;
  if (!canConsiderInitiative()) return;
  const candidateKey = state.initiativeCandidate && planKey(state.initiativeCandidate);
  if (retry && candidateKey) initiativeFailures.delete(candidateKey);
  const key = `${session.id}:${session.revision}:${session.initiative?.pending?.id || 'none'}:${Math.floor(Date.now() / 30000)}`;
  if (retry) presenceAttempts.delete(key);
  if (presenceAttempts.has(key)) { scheduleInitiativeIfFresh(); return; }
  presenceAttempts.add(key);
  if (presenceAttempts.size > 128) presenceAttempts.delete(presenceAttempts.values().next().value);
  cancelInitiativeTimer();
  const task = { sessionId: session.id, viewVersion: state.viewVersion, controller: new AbortController(), cancelled: false, promise: null };
  state.presenceTask = task;
  task.promise = (async () => {
    try {
      const data = await api(`/api/sessions/${task.sessionId}/presence`, { method: 'POST', signal: task.controller.signal, body: JSON.stringify({ revision: session.revision }) });
      if (task.cancelled || task.viewVersion !== state.viewVersion || state.session?.id !== task.sessionId || document.hidden) { dirtySessions.add(task.sessionId); return; }
      if (data.session.revision >= state.session.revision) { dirtySessions.delete(task.sessionId); acceptSession(data.session, { scroll: false }); }
    } catch (error) {
      if (!task.cancelled && (error.code === 'STALE' || error.ambiguous)) {
        dirtySessions.add(task.sessionId);
        try { await rereadSession(task.sessionId, { clearDirty: true }); } catch { /* Re-entry can retry a presence read. */ }
      }
    } finally {
      if (state.presenceTask === task) state.presenceTask = null;
      updateControls(); scheduleInitiativeIfFresh();
    }
  })();
  return task.promise;
}
function scheduleInitiativeIfFresh() { scheduleAgencyPresence(); if (state.initiativeCandidate?.expiresAt > Date.now()) scheduleInitiative(); }

async function requestInitiative(candidate) {
  if (!initiativeEligible(candidate)) return;
  const key = planKey(candidate); initiativeAttempts.add(key);
  const task = { sessionId: candidate.sessionId, planId: candidate.planId, viewVersion: state.viewVersion, controller: new AbortController(), cancelled: false, promise: null };
  state.initiativeTask = task;
  task.promise = (async () => {
    let needsRead = false; let succeeded = false;
    try {
      const data = await api(`/api/sessions/${task.sessionId}/initiative`, { method: 'POST', signal: task.controller.signal, body: JSON.stringify({ requestId: crypto.randomUUID(), planId: candidate.planId, revision: state.session.revision }) });
      if (task.cancelled || task.viewVersion !== state.viewVersion || state.session?.id !== task.sessionId || document.hidden || $('message-input').value.length) { dirtySessions.add(task.sessionId); return; }
      const atBottom = $('timeline').scrollHeight - $('timeline').scrollTop - $('timeline').clientHeight < 140;
      acceptSession(data.session, { animate: !data.skipped, scroll: atBottom });
      succeeded = true;
      refreshSessions().catch(() => {});
    } catch (error) {
      if (!task.cancelled && error.name !== 'AbortError' && error.code !== 'CANCELLED') initiativeFailures.add(key);
      if (error.ambiguous || error.code === 'STALE' || error.code === 'BUSY') { dirtySessions.add(task.sessionId); needsRead = true; }
      // Quiet continuations never interrupt a conversation with an error banner.
    } finally {
      if (!succeeded) initiativeAttempts.delete(key);
      if (state.initiativeTask === task) state.initiativeTask = null;
      if (needsRead && !task.cancelled && task.viewVersion === state.viewVersion && state.session?.id === task.sessionId) { try { await rereadSession(task.sessionId, { clearDirty: true }); } catch { /* Foreground sending will re-read. */ } }
      updateControls(); scheduleInitiative();
    }
  })();
  updateControls();
  await task.promise;
}

function renderCharacters() {
  $('character-list').replaceChildren();
  for (const character of state.health.characters) {
    const button = el('button', `character-button${character.id === state.session?.characterId ? ' active' : ''}`);
    button.type = 'button'; button.setAttribute('aria-label', `和 ${character.name} 聊天`); button.setAttribute('aria-pressed', String(character.id === state.session?.characterId));
    button.append(el('span', 'character-avatar', character.initials || character.name[0]));
    const info = el('span', 'character-info'); info.append(el('strong', '', character.name), el('small', '', character.subtitle)); button.append(info);
    if (character.id === state.session?.characterId) button.append(el('span', 'character-dot'));
    button.addEventListener('click', () => chooseCharacter(character.id)); $('character-list').append(button);
  }
  updateControls();
}

function renderHistory() {
  $('session-list').replaceChildren(); $('history-count').textContent = String(state.sessions.length); $('history-empty').hidden = state.sessions.length > 0;
  for (const session of state.sessions) {
    const character = state.health.characters.find((item) => item.id === session.characterId);
    const button = el('button', `session-button${session.id === state.session?.id ? ' active' : ''}`); button.type = 'button'; button.setAttribute('aria-current', session.id === state.session?.id ? 'true' : 'false');
    button.append(el('span', 'session-title', session.title || '新的对话'));
    const meta = el('span', 'session-meta'); meta.append(el('span', '', character?.name || session.characterId), el('span', '', '·'), el('span', '', recentLabel(session.updatedAt)));
    if (session.mode === 'demo') meta.append(el('span', '', '演示')); button.append(meta);
    button.addEventListener('click', () => loadSession(session.id)); $('session-list').append(button);
  }
  updateControls();
}

function renderMessage(message, pending = false, continuation = false) {
  const isUser = message.role === 'user'; const character = currentCharacter();
  const row = el('article', `message-row${isUser ? ' user' : ' assistant'}${pending ? ' pending' : ''}${message.provisional ? ' provisional' : ''}${continuation ? ' continuation' : ''}`); row.dataset.messageId = message.id || 'pending'; if (message.turnId) row.dataset.turnId = message.turnId; row.setAttribute('aria-label', isUser ? '你的消息' : `${character.name}的回复`);
  if (!isUser) row.append(el('span', 'message-avatar', character.initials || character.name[0]));
  const content = el('div', 'message-content'); const heading = el('div', 'message-heading'); heading.append(el('strong', '', isUser ? '你' : character.name), el('span', 'message-time', timeLabel(message.createdAt)));
  content.append(heading, el('div', 'message-text', message.text)); row.append(content); return row;
}

function renderMessages(scroll = true) {
  $('messages').replaceChildren();
  for (const message of state.session.messages) {
    if (state.playback?.sessionId === state.session.id && state.playback.hidden.has(message.id)) continue;
    appendMessage(message);
  }
  if (state.pending?.sessionId === state.session.id && !state.session.receipts?.some((receipt) => receipt.requestId === state.pending.requestId)) appendMessage({ role: 'user', text: state.pending.text }, true);
  for (const item of state.outbox) {
    if (item.sessionId === state.session.id) appendMessage({ id: `queued:${item.id}`, role: 'user', text: item.text, createdAt: item.createdAt }, true);
  }
  if (state.stream?.sessionId === state.session.id) for (const message of state.stream.messages) appendMessage(message);
  $('conversation-date').textContent = dateLabel(state.session.createdAt);
  if (scroll) requestAnimationFrame(() => { $('timeline').scrollTop = $('timeline').scrollHeight; });
}

function renderMemories() {
  $('memory-list').replaceChildren();
  const memories = state.session.memories || []; $('memory-count').textContent = String(memories.length); $('memory-empty').hidden = memories.length > 0;
  for (const memory of memories) {
    const item = el('article', 'memory-item'); item.append(el('p', 'memory-category', categoryNames[memory.category] || '记忆'), el('p', 'memory-text', memory.text));
    const tools = el('div', 'memory-tools'); tools.append(el('span', 'memory-source', memory.source === 'manual' ? '由你修改' : '来自你说的话'));
    const edit = el('button', 'icon-button'); edit.type = 'button'; edit.append(icon('edit')); edit.setAttribute('aria-label', `修改记忆：${memory.text}`); edit.title = '修改记忆'; edit.addEventListener('click', () => openMemoryEditor(memory));
    const remove = el('button', 'icon-button'); remove.type = 'button'; remove.append(icon('trash')); remove.setAttribute('aria-label', `删除记忆：${memory.text}`); remove.title = '删除记忆'; remove.addEventListener('click', () => deleteMemory(memory)); tools.append(edit, remove); item.append(tools);
    if (memory.source === 'user' && memory.quote) { const details = el('details'); details.append(el('summary', '', '查看来源'), el('blockquote', '', memory.quote)); item.append(details); }
    $('memory-list').append(item);
  }
}

function renderLife() {
  const threads = (state.session.agency?.threads || [])
    .filter(thread => thread.scope === 'fictional-character' && thread.status !== 'closed')
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 2);
  $('life-section').hidden = !threads.length;
  $('life-list').replaceChildren();
  for (const thread of threads) {
    const item = el('article', `life-item${thread.status === 'resolved' ? ' resolved' : ''}`);
    const heading = el('div', 'life-heading');
    heading.append(el('strong', '', thread.subject), el('span', 'life-status', thread.status === 'resolved' ? '告一段落' : '还在继续'));
    item.append(heading, el('p', 'life-state', thread.currentState));
    if (thread.status !== 'resolved' && thread.nextStep) item.append(el('p', 'life-next', `接下来想 · ${thread.nextStep}`));
    $('life-list').append(item);
  }
  const paused = state.session.initiative?.pausedUntilUser;
  $('initiative-hint').textContent = state.session.initiative?.enabled === false ? '先安静待着。打开后，有值得说的新内容才会开口。' : paused ? '你说想安静，她会收住。等你再开口。' : '有新进展或新念头时，她会来告诉你。你在打字时，她会先收住。';
}

function renderSession({ scroll = true } = {}) {
  const character = currentCharacter(); const session = state.session;
  adoptInitiativePlan(session);
  document.title = `${character.name} · 叙梦心动陪伴`;
  $('character-name').textContent = character.name; $('character-subtitle').textContent = character.subtitle; $('header-avatar').textContent = character.initials || character.name[0];
  $('thinking-avatar').textContent = character.initials || character.name[0]; $('thinking-label').textContent = `${character.name} 正在想怎么回答`;
  $('mode-label').hidden = false; $('mode-label').textContent = session.mode === 'demo' ? '演示模式' : 'AI 角色'; $('mode-label').classList.toggle('demo', session.mode === 'demo');
  $('about-name').textContent = character.name; $('about-description').textContent = character.description;
  $('mood-value').textContent = emotionNames[session.state.mood] || session.state.mood; $('relationship-value').textContent = session.state.relationship; $('mood-reason').textContent = session.state.moodReason || '';
  $('relationship-row').hidden = !session.state.relationship || !(session.state.trust || session.state.closeness);
  const genericReasons = ['刚见面，愿意了解你。', '根据刚才的对话自然回应。', '接着刚才的话，补充一个自己的想法。'];
  $('mood-reason').hidden = !session.state.moodReason || genericReasons.includes(session.state.moodReason);
  const beat = session.characterBeat?.scope === 'fictional-character' && typeof session.characterBeat.focus === 'string' ? session.characterBeat.focus.trim() : '';
  $('character-beat').hidden = !beat || Boolean(session.agency?.threads?.some(thread => thread.status === 'active' || thread.status === 'waiting')); $('character-beat-value').textContent = beat;
  $('language-select').value = session.locale; const locales = { zh: '中文', en: 'English', ja: '日本語' }; $('language-hint').textContent = session.locale === 'auto' ? `当前回复：${locales[session.effectiveLocale] || '中文'} · 也可以说「说英文」。` : '从下一条回复开始使用所选语言。';
  $('initiative-toggle').checked = session.initiative?.enabled !== false;
  $('export-session').href = `/api/sessions/${session.id}/export`; $('export-session').setAttribute('download', `叙梦-${character.name}.json`);
  renderCharacters(); renderHistory(); renderMessages(scroll); renderMemories(); renderLife(); updateControls();
}

async function refreshSessions() { const data = await api('/api/sessions'); state.sessions = data.sessions; renderHistory(); }
async function loadSession(id, { preserveDraft = false, presence = true } = {}) {
  if (isBusy()) return;
  const previousId = state.session?.id; saveDraft(); state.composing = false;
  cancelInitiative({ clearCandidate: true, reread: false }); cancelPlayback(); state.viewVersion += 1;
  state.mutating = true; updateControls();
  try {
    await Promise.allSettled([state.initiativeTask, state.presenceTask].filter(Boolean).map((task) => task.promise));
    const data = await api(`/api/sessions/${id}`); dirtySessions.delete(id); writeStorage(storageKey, id); if (!preserveDraft || previousId !== data.session.id) restoreDraft(data.session.id); feedback(''); acceptSession(data.session); closeDrawer();
  }
  catch (error) { feedback(error.message); }
  finally { state.mutating = false; resizeComposer(); updateControls(); scheduleOutbox({ settle: true }); if (presence) announcePresence({ retry: true }); }
}

async function chooseCharacter(characterId) {
  if (isBusy()) return;
  if (state.session?.characterId === characterId) { closeDrawer(); return; }
  const latest = state.sessions.find((item) => item.characterId === characterId);
  if (latest) await loadSession(latest.id); else await createConversation(characterId, state.health.provider.defaultMode);
}

async function createConversation(characterId, mode) {
  if (isBusy()) return;
  saveDraft(); state.composing = false;
  cancelInitiative({ clearCandidate: true, reread: false }); cancelPlayback(); state.viewVersion += 1;
  state.mutating = true; $('create-conversation').disabled = true; updateControls();
  try {
    await Promise.allSettled([state.initiativeTask, state.presenceTask].filter(Boolean).map((task) => task.promise));
    const data = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ characterId, mode }) }); writeStorage(storageKey, data.session.id); drafts.delete(data.session.id); restoreDraft(data.session.id); feedback(''); acceptSession(data.session); await refreshSessions(); $('new-chat-dialog').close(); closeDrawer();
  }
  catch (error) { if ($('new-chat-dialog').open) $('mode-hint').textContent = error.message; else feedback(error.message); }
  finally { state.mutating = false; $('create-conversation').disabled = false; resizeComposer(); updateControls(); announcePresence({ retry: true }); if (!mobile.matches) $('message-input').focus(); }
}

function openNewDialog() {
  if (isBusy() || !state.health) return;
  cancelInitiative(); cancelPlayback({ flush: true });
  $('new-character-options').replaceChildren();
  for (const character of state.health.characters) {
    const label = el('label', 'new-character-option'); const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'character'; radio.value = character.id; radio.checked = character.id === (state.session?.characterId || state.health.characters[0].id); radio.required = true;
    label.append(el('span', 'character-avatar', character.initials || character.name[0])); const info = el('span'); info.append(el('strong', '', character.name), el('small', '', character.subtitle)); label.append(info, radio); $('new-character-options').append(label);
  }
  $('new-chat-mode').querySelector('[value="ai"]').disabled = !state.health.provider.configured; $('new-chat-mode').value = state.health.provider.defaultMode; updateModeHint(); closeDrawer(); $('new-chat-dialog').showModal();
}

function updateModeHint() { $('mode-hint').textContent = $('new-chat-mode').value === 'demo' ? '演示回复由本地规则生成，可以体验界面与记忆。' : '由服务端配置的模型回复。'; }

function scheduleOutbox({ settle = false } = {}) {
  if (state.inputTimer) clearTimeout(state.inputTimer);
  state.inputTimer = null;
  if (!state.outbox.some((item) => item.sessionId === state.session?.id)) return;
  if (settle) state.outboxReadyAt = Date.now() + INPUT_SETTLE_MS;
  if (state.sending || state.starting || state.pending || state.mutating || state.reconciling) return;
  state.inputTimer = setTimeout(() => { state.inputTimer = null; void flushOutbox(); }, Math.max(0, state.outboxReadyAt - Date.now()));
}

function enqueueSegment(text) {
  const value = String(text || '').trim();
  if (!state.session || !value) return;
  cancelInitiative({ reread: false }); cancelPlayback({ flush: true });
  state.outbox.push({ id: crypto.randomUUID(), sessionId: state.session.id, text: value, createdAt: new Date().toISOString() });
  persistOutbox(); clearDraft(state.session.id);
  const task = state.foregroundTask;
  if (task && !task.superseded) {
    task.superseded = true;
    setPending({ ...state.pending, superseded: true });
    task.controller.abort();
    state.stream = null;
  }
  renderMessages(); resizeComposer(); updateControls();
  scheduleOutbox({ settle: true });
}

// The interrupt endpoint waits for the previous server task to stop. A plain
// GET could otherwise race a final commit after the browser aborts its fetch.
async function reconcileInterruptedTurn(pending) {
  const { session } = await api(`/api/sessions/${pending.sessionId}/interrupt`, { method: 'POST', body: JSON.stringify({ requestId: pending.requestId }) });
  if (!session.receipts?.some((receipt) => receipt.requestId === pending.requestId)) {
    const recovered = pending.segments?.length ? pending.segments : [{ id: pending.requestId, sessionId: pending.sessionId, text: pending.text, createdAt: pending.createdAt || new Date().toISOString() }];
    const ids = new Set(state.outbox.map((item) => item.id));
    state.outbox.unshift(...recovered.filter((item) => !ids.has(item.id)));
    persistOutbox();
  }
  clearRecoveredDraft(pending); setPending(null);
  acceptSession(session, { animate: false }); feedback('');
}

async function flushOutbox() {
  if (!state.session || state.sending || state.starting || state.pending || state.mutating || state.reconciling) return;
  if (!state.outbox.some((item) => item.sessionId === state.session.id)) return;
  state.starting = true; updateControls();
  let dispatched = false;
  try {
    if (!await prepareForegroundAction()) {
      feedback('暂时没能读取最新对话。消息还在，点重试继续。', true); $('check-send').hidden = true; return;
    }
    // Select after reconciliation so segments entered during the read join
    // this same turn. Keep complete segments within the server's text limit.
    const segments = []; let length = 0;
    for (const item of state.outbox.filter((entry) => entry.sessionId === state.session.id)) {
      const nextLength = length + (segments.length ? 1 : 0) + item.text.length;
      if (nextLength > 4000) break;
      segments.push(item); length = nextLength;
    }
    if (!segments.length) return;
    const pending = { sessionId: state.session.id, text: segments.map((item) => item.text).join('\n'), segments, requestId: crypto.randomUUID(), revision: state.session.revision, locale: state.session.locale, createdAt: segments[0].createdAt };
    setPending(pending);
    const sentIds = new Set(segments.map((item) => item.id));
    state.outbox = state.outbox.filter((item) => !sentIds.has(item.id)); persistOutbox();
    dispatched = true; await dispatchTurn(pending);
  } finally {
    state.starting = false; resizeComposer(); updateControls(); if (dispatched) scheduleOutbox(); scheduleInitiative();
  }
}

async function sendTurn(retry = false) {
  if (!state.session || state.mutating) return;
  if (!retry) {
    if (state.pending && !state.sending && !state.starting) return;
    const text = $('message-input').value.trim();
    if (text) enqueueSegment(text);
    return;
  }
  if (state.sending || state.starting || state.reconciling) return;
  if (!state.pending) { await flushOutbox(); return; }
  const pending = state.pending;
  state.starting = true; updateControls();
  try {
    if (!await prepareForegroundAction()) return;
    if (pending.superseded) {
      await reconcileInterruptedTurn(pending);
    } else {
      if (pending.restoredDraft && $('message-input').value.trim() === pending.text) clearDraft(pending.sessionId);
      await dispatchTurn(pending);
    }
  } catch (error) { feedback(error.message, true); }
  finally { state.starting = false; resizeComposer(); updateControls(); scheduleOutbox(); scheduleInitiative(); }
}

async function dispatchTurn(pending) {
  const task = { controller: new AbortController(), superseded: false, requestId: pending.requestId };
  state.foregroundTask = task;
  state.initiativeCandidate = null; state.sending = true;
  setPending({ ...pending, restoredDraft: false });
  state.stream = { sessionId: pending.sessionId, requestId: pending.requestId, viewVersion: state.viewVersion, messages: [] };
  feedback(''); renderMessages(); resizeComposer(); updateControls();
  try {
    const data = await sendStreamingTurn(pending, (index, text) => {
      if (!task.superseded) showStreamingMessage(pending, index, text);
    }, task.controller.signal);
    // Abort may race a JSON replay/done event; always reconcile through the
    // receipt before accepting any response to an interrupted turn.
    if (task.superseded) { await reconcileInterruptedTurn(pending); return; }
    const presentedParts = state.stream?.messages.length || 0; state.stream = null;
    setPending(null); feedback(''); acceptSession(data.session, { animate: true, presentedParts });
    if (!state.outbox.some((item) => item.sessionId === state.session?.id)) refreshSessions().catch(() => {});
  } catch (error) {
    state.stream = null;
    if (task.superseded) {
      try { await reconcileInterruptedTurn(pending); }
      catch (reconcileError) { renderMessages(); feedback(reconcileError.message, true); }
    } else if (error.code === 'STALE') {
      try { const data = await api(`/api/sessions/${pending.sessionId}`); acceptSession(data.session); setPending({ ...state.pending, revision: data.session.revision }); restoreFailedDraft(pending); renderMessages(); feedback('对话已更新。上句还在，点重试继续发送。', true); }
      catch { feedback('暂时无法读取最新对话，请重试这次发送。', true); }
    } else if (error.ambiguous || error.code === 'BUSY') {
      try {
        const data = await api(`/api/sessions/${pending.sessionId}`);
        if (data.session.receipts?.some((receipt) => receipt.requestId === pending.requestId)) { setPending(null); acceptSession(data.session); feedback(''); }
        else { restoreFailedDraft(pending); renderMessages(); feedback(error.message, true); }
      } catch { restoreFailedDraft(pending); renderMessages(); feedback(error.message, true); }
    } else { restoreFailedDraft(pending); renderMessages(); feedback(error.message, true); }
  } finally {
    state.foregroundTask = null; state.sending = false;
    resizeComposer(); updateControls();
    if (!mobile.matches) $('message-input').focus();
  }
}

async function changeLocale() {
  if (!state.session || isBusy()) return;
  const locale = $('language-select').value;
  if (!await prepareForegroundAction()) { $('language-select').value = state.session.locale; return; }
  if (isBusy()) return;
  state.mutating = true; updateControls();
  try { const data = await api(`/api/sessions/${state.session.id}/settings`, { method: 'PATCH', body: JSON.stringify({ locale, revision: state.session.revision }) }); state.session = data.session; renderSession({ scroll: false }); feedback(''); }
  catch (error) { await handleMutationError(error); }
  finally { state.mutating = false; $('language-select').value = state.session.locale; updateControls(); scheduleInitiative(); }
}

async function changeInitiative() {
  if (!state.session || isBusy()) return;
  const initiative = $('initiative-toggle').checked;
  if (!await prepareForegroundAction()) { $('initiative-toggle').checked = state.session.initiative?.enabled !== false; return; }
  if (isBusy()) return;
  state.mutating = true; updateControls();
  try { const data = await api(`/api/sessions/${state.session.id}/settings`, { method: 'PATCH', body: JSON.stringify({ initiative, revision: state.session.revision }) }); acceptSession(data.session, { scroll: false }); feedback(''); }
  catch (error) { await handleMutationError(error); }
  finally { state.mutating = false; $('initiative-toggle').checked = state.session.initiative?.enabled !== false; updateControls(); if ($('initiative-toggle').checked) announcePresence({ retry: true }); else scheduleInitiative(); }
}

async function checkPendingResult() {
  if (!state.pending || state.sending || state.mutating) return;
  const pending = state.pending; state.mutating = true; updateControls();
  try {
    if (pending.superseded) { await reconcileInterruptedTurn(pending); return; }
    const data = await api(`/api/sessions/${pending.sessionId}`);
    state.session = data.session;
    if (state.session.receipts?.some((receipt) => receipt.requestId === pending.requestId)) {
      clearRecoveredDraft(pending); setPending(null); acceptSession(data.session); feedback('回复已找回。');
      try { await refreshSessions(); } catch { /* The recovered turn is already shown. */ }
    } else { renderSession(); feedback('这次发送还没有完成。稍后检查，或继续重试。', true); }
  } catch (error) { feedback(error.message, true); }
  finally { state.mutating = false; resizeComposer(); updateControls(); scheduleOutbox(); scheduleInitiative(); }
}

function openMemoryEditor(memory) { if (isBusy()) return; cancelInitiative(); cancelPlayback({ flush: true }); state.editingMemory = memory.id; $('memory-input').value = memory.text; $('edit-memory-dialog').showModal(); $('memory-input').focus(); }
async function saveMemory(event) {
  event.preventDefault(); if (isBusy() || !state.editingMemory) return;
  const text = $('memory-input').value.trim(); if (!text) { $('memory-input').setCustomValidity('请输入记忆内容。'); $('memory-input').reportValidity(); return; }
  if (!await prepareForegroundAction() || isBusy()) return;
  state.mutating = true; $('save-memory').disabled = true; updateControls();
  try { const data = await api(`/api/sessions/${state.session.id}/memories/${state.editingMemory}`, { method: 'PATCH', body: JSON.stringify({ text, revision: state.session.revision }) }); state.session = data.session; renderSession({ scroll: false }); $('edit-memory-dialog').close(); feedback('记忆已修改。'); }
  catch (error) { $('edit-memory-dialog').close(); await handleMutationError(error); }
  finally { state.mutating = false; $('save-memory').disabled = false; updateControls(); scheduleInitiative(); }
}

async function deleteMemory(memory) {
  if (isBusy()) return;
  if (!await prepareForegroundAction() || isBusy()) return;
  state.mutating = true; updateControls();
  try { const data = await api(`/api/sessions/${state.session.id}/memories/${memory.id}`, { method: 'DELETE', body: JSON.stringify({ revision: state.session.revision }) }); state.session = data.session; renderSession({ scroll: false }); feedback('这条记忆已删除。'); }
  catch (error) { await handleMutationError(error); }
  finally { state.mutating = false; updateControls(); scheduleInitiative(); }
}

async function handleMutationError(error) {
  if (error.code === 'STALE') { try { const data = await api(`/api/sessions/${state.session.id}`); state.session = data.session; renderSession({ scroll: false }); feedback('对话已更新，请再试一次。'); } catch { feedback(error.message); } }
  else feedback(error.message);
}

function resizeComposer() { const input = $('message-input'); input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 170)}px`; $('character-count').textContent = `${input.value.length} / 4000`; }
function closeDrawer() {
  const oldDrawer = state.drawer; state.drawer = null; shell.classList.remove('sidebar-open', 'inspector-open'); $('drawer-backdrop').hidden = true; $('workspace').inert = false; $('sidebar').inert = false; $('inspector').inert = false;
  $('toggle-inspector').setAttribute('aria-expanded', String(!smallInspector.matches && !shell.classList.contains('inspector-hidden')));
  if (oldDrawer === 'sidebar') $('open-sidebar').focus(); if (oldDrawer === 'inspector') $('toggle-inspector').focus();
  scheduleInitiative();
}
function openDrawer(which) {
  closeDrawer(); cancelInitiative(); state.drawer = which; shell.classList.add(`${which}-open`); $('drawer-backdrop').hidden = false; $('workspace').inert = true; $('sidebar').inert = which !== 'sidebar'; $('inspector').inert = which !== 'inspector';
  $('toggle-inspector').setAttribute('aria-expanded', String(which === 'inspector')); (which === 'sidebar' ? $('close-sidebar') : $('close-inspector')).focus();
}
function toggleInspector() { if (smallInspector.matches) state.drawer === 'inspector' ? closeDrawer() : openDrawer('inspector'); else { shell.classList.toggle('inspector-hidden'); $('toggle-inspector').setAttribute('aria-expanded', String(!shell.classList.contains('inspector-hidden'))); } }

$('composer-form').addEventListener('submit', (event) => { event.preventDefault(); sendTurn(); });
$('message-input').addEventListener('input', () => { if (state.pending?.restoredDraft) setPending({ ...state.pending, restoredDraft: false }); saveDraft(); cancelInitiative(); resizeComposer(); updateControls(); scheduleInitiative(); });
$('message-input').addEventListener('compositionstart', () => { saveDraft(); state.composing = true; cancelInitiative(); });
$('message-input').addEventListener('compositionend', () => { saveDraft(); state.composing = false; scheduleInitiative(); });
$('message-input').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendTurn(); } });
$('retry-send').addEventListener('click', () => sendTurn(true));
$('check-send').addEventListener('click', checkPendingResult);
$('new-chat').addEventListener('click', openNewDialog);
$('close-new-dialog').addEventListener('click', () => $('new-chat-dialog').close());
$('new-chat-dialog').addEventListener('close', () => { announcePresence({ retry: true }); scheduleInitiative(); });
$('new-chat-form').addEventListener('submit', (event) => { event.preventDefault(); const selected = $('new-character-options').querySelector('input:checked'); if (selected) createConversation(selected.value, $('new-chat-mode').value); });
$('new-chat-mode').addEventListener('change', updateModeHint);
$('language-select').addEventListener('change', changeLocale);
$('initiative-toggle').addEventListener('change', changeInitiative);
$('edit-memory-form').addEventListener('submit', saveMemory);
$('memory-input').addEventListener('input', () => $('memory-input').setCustomValidity(''));
$('close-memory-dialog').addEventListener('click', () => $('edit-memory-dialog').close());
$('edit-memory-dialog').addEventListener('close', () => { announcePresence({ retry: true }); scheduleInitiative(); });
$('open-sidebar').addEventListener('click', () => openDrawer('sidebar'));
$('close-sidebar').addEventListener('click', closeDrawer);
$('toggle-inspector').addEventListener('click', toggleInspector);
$('close-inspector').addEventListener('click', () => { if (smallInspector.matches) closeDrawer(); else toggleInspector(); });
$('drawer-backdrop').addEventListener('click', closeDrawer);
smallInspector.addEventListener('change', closeDrawer); mobile.addEventListener('change', closeDrawer);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelInitiative({ reread: false }); cancelPlayback({ flush: true }); return; }
  const id = state.session?.id;
  if (id && dirtySessions.has(id)) {
    const tasks = [state.initiativeTask, state.presenceTask].filter((task) => task?.sessionId === id).map((task) => task.promise);
    Promise.allSettled(tasks).then(() => rereadSession(id, { clearDirty: true })).then(() => announcePresence({ retry: true })).catch(() => {});
  } else announcePresence({ retry: true });
});
window.addEventListener('pagehide', () => { saveDraft(); if (state.inputTimer) clearTimeout(state.inputTimer); state.inputTimer = null; cancelInitiative({ clearCandidate: true, reread: false }); cancelPlayback(); state.viewVersion += 1; });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.drawer) { event.preventDefault(); closeDrawer(); return; }
  if (event.key === 'Tab' && state.drawer) {
    const drawer = state.drawer === 'sidebar' ? $('sidebar') : $('inspector'); const focusable = [...drawer.querySelectorAll('button:not(:disabled),a[href],select:not(:disabled),input:not(:disabled),summary,[tabindex="0"]')].filter((item) => item.getClientRects().length);
    if (!focusable.length) return; const first = focusable[0]; const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  if (event.key.toLowerCase() === 'n' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.target.closest('input,textarea,select,dialog') && !state.drawer) { event.preventDefault(); openNewDialog(); }
});

async function boot() {
  try {
    try { for (const [id, text] of Object.entries(JSON.parse(readStorage(draftsKey) || '{}'))) if (typeof text === 'string' && text.length <= 4000) drafts.set(id, text); } catch { writeStorage(draftsKey, null); }
    state.health = await api('/api/health'); const provider = state.health.provider;
    const modelLabel = provider.configured ? `${provider.model}${provider.reasoningEffort ? ` · ${provider.reasoningEffort}` : ''}` : '服务端尚未配置模型';
    $('provider-status').textContent = provider.configured ? '模型已配置' : '演示模式可用'; $('provider-model').textContent = modelLabel; $('provider-model').title = provider.configured ? modelLabel : ''; $('connection-dot').classList.toggle('ready', provider.configured);
    renderCharacters(); await refreshSessions();
    let pending = null; try { pending = JSON.parse(readStorage(pendingKey) || 'null'); } catch { writeStorage(pendingKey, null); }
    let savedOutbox = [];
    try {
      const saved = JSON.parse(readStorage(outboxKey) || '[]');
      const validSessions = new Set(state.sessions.map((item) => item.id));
      savedOutbox = Array.isArray(saved) ? saved.filter((item) => item && typeof item.id === 'string' && validSessions.has(item.sessionId) && typeof item.text === 'string' && item.text.trim() && item.text.length <= 4000) : [];
    } catch { /* Ignore invalid local queue data. */ }
    const remembered = readStorage(storageKey);
    const id = state.sessions.find((item) => item.id === pending?.sessionId)?.id || savedOutbox[0]?.sessionId || state.sessions.find((item) => item.id === remembered)?.id || state.sessions[0]?.id;
    if (id) {
      await loadSession(id, { presence: false });
      if (pending?.sessionId === state.session?.id && typeof pending.text === 'string' && typeof pending.requestId === 'string') {
        if (state.session.receipts?.some((receipt) => receipt.requestId === pending.requestId)) writeStorage(pendingKey, null);
        else {
          const draft = drafts.get(pending.sessionId) || '';
          if (!draft) setDraft(pending.sessionId, pending.text);
          setPending({ ...pending, restoredDraft: !draft || draft === pending.text });
          renderMessages(); feedback(pending.superseded ? '上次补充的话还在，点重试接着发送。' : '上次发送还没有确认结果，重试会继续同一次发送。', true);
        }
      } else writeStorage(pendingKey, null);
    } else await createConversation(state.health.characters[0].id, provider.defaultMode);
    const pendingIds = new Set(pending?.segments?.map((item) => item.id) || []);
    state.outbox = savedOutbox.filter((item) => !pendingIds.has(item.id));
    persistOutbox(); renderMessages(); updateControls(); resizeComposer(); scheduleOutbox({ settle: true }); announcePresence({ retry: true });
  } catch (error) { $('provider-status').textContent = '连接未完成'; $('provider-model').textContent = '请确认本地服务正在运行'; feedback(error.message); }
}

boot();
