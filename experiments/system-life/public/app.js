const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const GENRES = { urban: '都市异能', cultivation: '修仙', business: '逆向经营' };
const OUTCOMES = { opening: '系统觉醒', success: '行动成功', partial: '有所进展', failure: '行动受挫', refused: '行动未执行' };
const SESSION_KEY = 'system-life:v2:last-story';
const PENDING_KEY = 'system-life:v2:pending-turn';
const PRESETS = {
  urban: { name: '林渡', systemName: '演进系统', location: '雾港 · 旧街屋顶', ally: '苏槐', background: '你出生在雾港，出生时便与一个只有你能感知的演进系统绑定。系统伴随你长大，却从不替你做决定。十八岁生日的清晨，港口潮汐出现异常，守夜人苏槐留下了一枚旧罗盘。你必须通过实际行动找出异常来源，并决定自己与这座城市的关系。' },
  cultivation: { name: '林渡', systemName: '问道系统', location: '青岚山 · 外门药庐', ally: '沈青禾', background: '你生来与问道系统绑定，是青岚宗一名尚未入道的外门弟子。山下灵脉忽然枯竭，药庐里出现来历不明的病人。系统发布目标与既定奖励，你必须依靠调查、修行与和人的往来解决事情。没有凭空获得的修为，每条道路都有代价。' },
  business: { name: '林渡', systemName: '逆向经营系统', location: '雾港 · 巷尾小店', ally: '许知夏', background: '你生来与逆向经营系统绑定，刚刚接手一家濒临停业的巷尾小店。系统会提出看似反直觉但必须真实执行的经营目标，并提前约定奖励。店员许知夏发现账目有一笔异常。你需要决定怎样处理顾客、成本与人情，每次行动都可能改变小店的未来。' },
};
let session = null;
let selectedNodeId = null;
let busy = false;
let busyKind = '';
let health = null;
let sessions = [];
let toastTimer;
let thinkingTimer;
let pendingByStory = readStored(PENDING_KEY) || {};
let pendingTurn = null;
let turnError = '';

function readStored(key) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function storeValue(key, value) { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function element(tag, className, content) { const node = document.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = String(content); return node; }
function setText(id, value) { $(id).textContent = value == null ? '' : String(value); }
function show(id, visible = true) { $(id).hidden = !visible; }
function currentNode() { return session?.nodes?.find((node) => node.id === selectedNodeId) || latestNode(); }
function latestNode() { return session?.nodes?.at(-1); }
function isCurrent() { return Boolean(session && currentNode()?.id === latestNode()?.id); }
function storyPath(id = session?.id) { return `/api/sessions/${encodeURIComponent(id)}`; }
function relevantPending() { return pendingTurn?.sessionId === session?.id && pendingTurn?.body?.revision === session?.revision; }

async function api(path, data) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), data === undefined ? 20000 : 210000);
  try {
    let response;
    try { response = await fetch(path, data === undefined ? { cache: 'no-store', signal: controller.signal } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: controller.signal }); }
    catch (error) { const problem = new Error(error.name === 'AbortError' ? '推演等待时间较长，暂时没有收到结果。你的行动已保留，可以安全重试。' : '暂时无法连接本地故事服务。你的行动已保留，请在连接恢复后重试。'); problem.uncertain = true; throw problem; }
    let body;
    try { body = await response.json(); } catch { const problem = new Error('收到的故事结果暂时无法读取。可以重试同一次行动。'); problem.uncertain = true; throw problem; }
    if (!response.ok) { const error = new Error(body.error || `请求未完成（${response.status}）`); error.status = response.status; error.uncertain = response.status === 409 && /正在|进行|处理|busy|flight/i.test(error.message); throw error; }
    return body;
  } finally { clearTimeout(timer); }
}

function toast(message, success = false) { clearTimeout(toastTimer); setText('toast-text', message); $('toast').classList.toggle('success', success); show('toast'); if (success) toastTimer = setTimeout(() => show('toast', false), 5500); }
function inlineError(id, message = '') { setText(id, message); show(id, Boolean(message)); }
function savePending() { if (pendingTurn) pendingByStory[pendingTurn.sessionId] = pendingTurn; storeValue(PENDING_KEY, pendingByStory); }
function clearPending() { if (pendingTurn) delete pendingByStory[pendingTurn.sessionId]; pendingTurn = null; turnError = ''; storeValue(PENDING_KEY, pendingByStory); show('turn-error', false); }

function setBusy(value, kind = '', message = '') {
  busy = value; busyKind = value ? kind : '';
  document.querySelector('.narrative-column').setAttribute('aria-busy', String(value));
  for (const id of ['new-button', 'library-button', 'quick-start', 'customize-start', 'create-session', 'rewind-button', 'return-current', 'retry-turn', 'change-action', 'library-new']) $(id).disabled = value;
  document.querySelectorAll('.close-dialog').forEach((button) => { button.disabled = value; });
  $('create-session').querySelector('span').textContent = value && kind === 'create' ? '故事正在展开…' : '开启第一章';
  $('quick-start').querySelector('span').textContent = value && kind === 'create' ? '故事正在展开…' : '开启都市异能故事';
  show('setup-status', value && kind === 'create'); setText('setup-status', message);
  if (!$('welcome').hidden) setText('welcome-mode', value ? message : welcomeMode());
  clearInterval(thinkingTimer);
  show('thinking', value && kind === 'turn');
  show('story-article', !(value && kind === 'turn'));
  if (value && kind === 'turn') {
    const started = Date.now();
    setText('thinking-title', session.mode === 'ai' ? 'Agent 正在推演你的行动' : '你的行动正在成为故事');
    setText('thinking-detail', '正在考虑事件后果、任务进展与下一次抉择…');
    setText('thinking-time', '0 秒');
    thinkingTimer = setInterval(() => { const elapsed = Math.floor((Date.now() - started) / 1000); setText('thinking-time', `${elapsed} 秒`); if (elapsed >= 30) setText('thinking-detail', '仍在推演。人物关系和已经发生的事会一起纳入判断。'); }, 1000);
    renderAction();
    requestAnimationFrame(() => $('thinking').scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }
  updateControls();
}

function updateControls() {
  const blocked = busy || !isCurrent() || relevantPending();
  document.querySelectorAll('.choice-button').forEach((button) => { button.disabled = blocked; });
  document.querySelectorAll('.history-item,.session-button').forEach((button) => { button.disabled = busy; });
  $('action-input').disabled = blocked;
  $('send-action').disabled = blocked || !$('action-input').value.trim();
  $('rewind-button').disabled = busy || isCurrent();
  $('import-session-file').disabled = busy;
  show('turn-error', Boolean(turnError && relevantPending() && isCurrent()));
}

function acceptSession(next, { goToLatest = false } = {}) {
  if (next?.schemaVersion !== 2 || !Array.isArray(next.nodes) || !next.nodes.length) throw new Error('这不是当前版本的交互故事存档，请打开或导入新版故事。');
  if (session?.id !== next.id) { selectedNodeId = null; turnError = ''; pendingTurn = pendingByStory[next.id] || null; }
  session = next;
  if (pendingTurn?.sessionId === next.id && next.revision > pendingTurn.body.revision) clearPending();
  if (goToLatest || !next.nodes.some((node) => node.id === selectedNodeId)) selectedNodeId = latestNode().id;
  storeValue(SESSION_KEY, next.id);
  show('loading', false); show('welcome', false); show('player');
  render();
}

function renderAction() {
  const pendingAction = busyKind === 'turn' && relevantPending() ? pendingTurn.label : null;
  const action = pendingAction || currentNode()?.action;
  setText('player-action-text', action || ''); show('player-action', Boolean(action));
}

function render() {
  if (!session) return;
  const node = currentNode();
  const index = session.nodes.findIndex((item) => item.id === node.id);
  const state = node.snapshot || session.state;
  const preset = session.preset;
  setText('story-name', `${preset.name}的故事`);
  setText('chapter-eyebrow', `CHAPTER ${pad(state.chapter)} / ${GENRES[preset.genre] || '交互故事'}`);
  setText('location-label', state.location); setText('day-label', `第 ${state.day} 天`);
  setText('source-label', node.source === 'demo' ? '内置分支演示' : 'AI Agent 推演');
  $('source-label').classList.toggle('demo', node.source === 'demo');
  setText('node-kicker', `第 ${pad(index + 1)} 幕 / ${node.action ? '行动之后' : '系统觉醒'}`);
  setText('node-title', node.title);
  setText('system-name', preset.systemName); setText('system-text', node.systemMessage); show('system-message', Boolean(node.systemMessage));
  $('narrative').replaceChildren(...String(node.narrative || '').split(/\n+/).filter(Boolean).map((paragraph) => element('p', '', paragraph)));
  $('changes').replaceChildren(...(node.changes || []).map((change) => element('span', '', change)));
  setText('outcome-label', OUTCOMES[node.outcome?.type] || '本轮结果'); setText('outcome-reason', node.outcome?.reason);
  $('outcome').dataset.type = node.outcome?.type || ''; show('outcome', Boolean(node.action && node.outcome));
  $('events-list').replaceChildren(...(node.events || []).map((event) => element('li', '', event.text))); show('events-section', Boolean(node.events?.length));
  renderAction(); renderChoices(node); renderState(state, preset); renderHistory();
  show('history-banner', !isCurrent()); show('decision-area', isCurrent());
  if (relevantPending() && !busy && !turnError) turnError = '上一次行动还没有确认结果。你可以重试，系统会核对它是否已经完成。';
  setText('turn-error-text', turnError);
  $('change-action').hidden = Boolean(pendingTurn?.uncertain);
  $('action-input').placeholder = `我先去找${preset.ally || '关键人物'}，问清楚眼前发生的事…`;
  updateControls();
}

function renderChoices(node) {
  $('choices').replaceChildren(...(node.choices || []).map((choice, index) => {
    const button = element('button', 'choice-button'); button.type = 'button'; button.dataset.choice = choice.id;
    const text = element('span', 'choice-text');
    text.append(element('strong', 'choice-title', choice.label));
    if (choice.detail) text.append(element('small', 'choice-detail', choice.detail));
    if (choice.stakes) text.append(element('small', 'choice-stakes', `取舍 · ${choice.stakes}`));
    if (choice.route) text.append(element('small', 'choice-route', `路线 · ${choice.route}`));
    button.append(element('span', 'choice-number', pad(index + 1)), text, element('span', 'choice-arrow', '↗'));
    button.addEventListener('click', () => turn({ choiceId: choice.id }, choice.label));
    return button;
  }));
}

function questElement(quest) {
  const item = element('div', `quest ${quest.status}`);
  item.append(element('h5', '', quest.title), element('p', 'quest-description', quest.description));
  const list = element('ul', 'requirements');
  list.append(...(quest.requirements || []).map((requirement) => { const line = element('li', requirement.done ? 'done' : ''); const mark = element('span', 'requirement-check', requirement.done ? '✓' : ''); mark.setAttribute('aria-label', requirement.done ? '已完成' : '未完成'); line.append(mark, element('span', '', requirement.text)); return line; }));
  item.append(list);
  const reward = quest.reward || {};
  const rewards = [];
  if (Number(reward.credits) > 0) rewards.push(`${reward.credits} 系统点数`);
  if (reward.ability) rewards.push(`能力 · ${reward.ability.name}`);
  if (reward.item) rewards.push(`物品 · ${reward.item.name}`);
  if (rewards.length) { const block = element('div', 'reward'); block.append(element('span', '', quest.status === 'completed' ? '奖励已结算' : quest.status === 'failed' ? '目标未完成 · 不发放奖励' : '完成后获得 · 既定奖励'), element('p', '', rewards.join(' / '))); item.append(block); }
  if (quest.status !== 'active') item.append(element('p', 'quest-resolution', `${quest.status === 'completed' ? '✓ 已完成' : '目标失败'}${quest.resolution ? ` · ${quest.resolution}` : ''}`));
  return item;
}

function renderList(id, items, mapper, empty = '尚无记录') {
  $(id).replaceChildren(...items.map(mapper));
  if (!items.length) $(id).append(element('li', 'empty-message', empty));
}

function resourceElement(resource) { const li = element('li'); li.append(element('strong', '', resource.name), element('small', '', resource.description)); return li; }
function renderState(state, preset) {
  setText('character-name', preset.name); setText('character-initial', Array.from(preset.name)[0] || '你');
  setText('character-context', `${GENRES[preset.genre] || '交互故事'} · 系统持有者`); setText('inspector-system', preset.systemName);
  setText('energy-label', `${state.energy} / 100`); $('energy-meter').style.width = `${Math.max(0, Math.min(100, Number(state.energy) || 0))}%`; setText('credits-label', state.credits);
  const active = (state.quests || []).filter((quest) => quest.status === 'active'); const resolved = (state.quests || []).filter((quest) => quest.status !== 'active');
  setText('active-goal-count', active.length ? `${active.length} 项` : ''); setText('resolved-goal-count', resolved.length);
  $('quests').replaceChildren(...active.map(questElement)); if (!active.length) $('quests').append(element('p', 'empty-message', '当前目标已结算。继续行动，迎接下一件事。'));
  $('resolved-quests').replaceChildren(...resolved.map(questElement)); if (!resolved.length) $('resolved-quests').append(element('p', 'empty-message', '尚无已结算目标'));
  setText('ability-count', state.abilities?.length || 0); setText('inventory-count', state.inventory?.length || 0); setText('relationship-count', state.relationships?.length || 0);
  setText('fact-count', (state.facts?.length || 0) + (state.consequenceLedger?.length || 0));
  renderList('abilities-list', state.abilities || [], resourceElement, '能力将在完成目标后获得');
  renderList('inventory-list', state.inventory || [], resourceElement, '暂无随身物品');
  renderList('relationships-list', state.relationships || [], (person) => { const li = element('li'); li.append(element('strong', '', `${person.name} · 信任 ${person.trust}`), element('small', '', person.stance)); return li; }, '人物关系会随事件改变');
  renderList('canon-facts', session.canon?.facts || [], (text) => element('li', '', text));
  renderList('facts-list', state.facts || [], (fact) => element('li', '', fact.text), '尚无新增事实');
  renderList('consequences-list', state.consequenceLedger || [], (fact) => element('li', '', fact.text), '尚无持续后果');
  renderList('threads-list', state.threads || [], (thread) => element('li', '', thread.text), '尚无未解线索');
}

function renderHistory() {
  setText('history-count', `${session.nodes.length} 幕`);
  $('history-list').replaceChildren(...session.nodes.map((node, index) => {
    const button = element('button', `history-item${node.id === selectedNodeId ? ' active' : ''}`); button.type = 'button'; button.setAttribute('aria-current', node.id === selectedNodeId ? 'step' : 'false');
    button.append(element('span', '', `第 ${pad(index + 1)} 幕`), element('strong', '', node.title), element('span', 'history-source', `${node.source === 'demo' ? '内置分支' : 'AI 推演'}${node.action ? ` · ${OUTCOMES[node.outcome?.type] || '行动之后'}` : ''}`));
    button.addEventListener('click', () => { if (!busy) { selectedNodeId = node.id; render(); $('story-article').scrollIntoView({ behavior: 'smooth', block: 'start' }); } }); return button;
  }));
}

async function turn(action, label) {
  if (busy || !session || !isCurrent() || relevantPending()) return;
  pendingTurn = { sessionId: session.id, body: { ...action, revision: session.revision, requestId: crypto.randomUUID() }, label: label || action.input, uncertain: true };
  savePending(); turnError = '';
  await submitPending();
}

async function submitPending() {
  if (busy || !relevantPending()) return;
  const packet = pendingTurn;
  show('turn-error', false); setBusy(true, 'turn');
  try {
    const result = await api(`${storyPath(packet.sessionId)}/turn`, packet.body);
    if (result.session?.schemaVersion !== 2 || !result.session.nodes?.length) { const error = new Error('故事结果暂时无法确认。请重试同一次行动。'); error.uncertain = true; throw error; }
    acceptSession(result.session, { goToLatest: true }); clearPending(); $('action-input').value = '';
    requestAnimationFrame(() => $('player-action').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  } catch (error) {
    packet.uncertain = Boolean(error.uncertain); pendingTurn = packet; savePending(); turnError = error.message;
    if (error.status === 409) {
      const refreshed = await refreshSession(packet.sessionId);
      if (refreshed && session.revision > packet.body.revision) { clearPending(); toast('故事已更新，已为你打开最新结果。', true); }
    }
  } finally { setBusy(false); render(); }
}

async function refreshSession(id) { try { const result = await api(storyPath(id)); if (session?.id === id) acceptSession(result.session); return true; } catch { return false; } }
function welcomeMode() { return health?.story?.configured ? '默认由 AI Agent 推演 · 可以设定背景，也可以直接开始' : health ? '故事模型尚未配置 · 可立即体验内置分支演示' : '暂时无法连接本地服务，请检查故事推演状态'; }

async function createStory(presetOverride) {
  if (busy || !$('setup-form').reportValidity()) return;
  const preset = presetOverride || Object.fromEntries(new FormData($('setup-form')).entries());
  if (preset.mode === 'ai' && !health?.story?.configured) { inlineError('setup-error', '故事模型尚未配置。请选择内置分支演示，或配置后重新检查。'); return; }
  inlineError('setup-error'); setBusy(true, 'create', preset.mode === 'ai' ? 'Agent 正在准备世界、目标与第一次抉择，通常需要一些时间…' : '正在准备世界与第一次抉择…');
  try { const result = await api('/api/sessions', preset); acceptSession(result.session, { goToLatest: true }); $('setup-dialog').close(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  catch (error) { inlineError('setup-error', error.message); if (!$('setup-dialog').open) $('setup-dialog').showModal(); }
  finally { setBusy(false); }
}

function openSetup() { if (busy) return; inlineError('setup-error'); $('setup-dialog').showModal(); }
function useGenre(genre) { const preset = PRESETS[genre] || PRESETS.urban; for (const [field, value] of Object.entries(preset)) $('setup-form').elements.namedItem(field).value = value; }

async function checkHealth() {
  try {
    health = await api('/api/health'); const configured = health.story?.configured === true;
    setText('health-label', configured ? 'Agent 已配置' : '演示可玩'); $('health-button').querySelector('.status-dot').classList.toggle('active', configured); $('health-button').querySelector('.status-dot').classList.toggle('warn', !configured);
    setText('story-engine-label', configured ? health.story.model || '故事模型已配置' : '故事模型尚未配置'); setText('story-engine-detail', configured ? '可以由 AI Agent 推演每次行动的结果。' : '内置分支演示可以立即试玩。');
    setText('ai-mode-status', configured ? '已配置' : '未配置'); const ai = $('setup-form').querySelector('[name="mode"][value="ai"]'); ai.disabled = !configured;
    if (!configured && ai.checked) $('setup-form').querySelector('[name="mode"][value="demo"]').checked = true;
  } catch (error) { health = null; setText('health-label', '服务未连接'); setText('story-engine-label', '连接失败'); setText('story-engine-detail', error.message); setText('ai-mode-status', '未连接'); $('setup-form').querySelector('[name="mode"][value="ai"]').disabled = true; }
  if (!busy) setText('welcome-mode', welcomeMode()); updateControls();
}

async function listStories() {
  if (busy) return; $('library-dialog').showModal(); $('sessions-list').replaceChildren(element('p', 'empty-message', '正在寻找你的故事…'));
  try {
    const result = await api('/api/sessions'); sessions = result.sessions || [];
    $('sessions-list').replaceChildren(...sessions.map((story, index) => { const button = element('button', 'session-button'); button.type = 'button'; const description = element('div'); const date = new Date(story.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); description.append(element('strong', '', `${story.name} · ${story.title}`), element('small', '', `${date} · ${story.mode === 'demo' ? '内置分支演示' : 'AI Agent 推演'}`)); button.append(element('span', 'session-number', pad(index + 1)), description, element('span', 'session-current', story.id === session?.id ? '当前' : '↗')); button.addEventListener('click', () => openStory(story.id)); return button; }));
    if (!sessions.length) $('sessions-list').append(element('p', 'empty-message', '你的第一段故事，还在等待一个起点。'));
  } catch (error) { $('sessions-list').replaceChildren(element('p', 'inline-error', error.message)); }
}

async function openStory(id) {
  if (busy) return; setBusy(true, 'open');
  try { const result = await api(storyPath(id)); acceptSession(result.session, { goToLatest: true }); if ($('library-dialog').open) $('library-dialog').close(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  catch (error) { toast(error.message); } finally { setBusy(false); }
}

async function rewind() {
  if (busy || !session || isCurrent()) return; setBusy(true, 'rewind');
  try { const result = await api(`${storyPath()}/rewind`, { nodeId: selectedNodeId, revision: session.revision }); clearPending(); acceptSession(result.session, { goToLatest: true }); toast('已回到这一幕，后续剧情已移除。现在可以重新选择。', true); }
  catch (error) { toast(error.message); if (error.status === 409) await refreshSession(session.id); } finally { setBusy(false); }
}

async function importStory(file) {
  if (busy || !file) return; if (file.size > 8 * 1024 * 1024) { toast('存档文件过大，请选择 8 MB 以内的 JSON。'); return; } setBusy(true, 'import');
  try { let parsed; try { parsed = JSON.parse(await file.text()); } catch { throw new Error('无法读取这个存档，请选择有效的 JSON 文件。'); } const result = await api('/api/sessions/import', { session: parsed.session || parsed }); acceptSession(result.session, { goToLatest: true }); $('library-dialog').close(); toast(result.notice || '故事已导入，原存档会保留。', true); }
  catch (error) { toast(error.message); } finally { $('import-session-file').value = ''; setBusy(false); }
}

$('setup-form').addEventListener('submit', (event) => { event.preventDefault(); createStory(); });
$('setup-form').querySelectorAll('[name="genre"]').forEach((radio) => radio.addEventListener('change', () => useGenre(radio.value)));
$('action-form').addEventListener('submit', (event) => { event.preventDefault(); const input = $('action-input').value.trim(); if (input) turn({ input }, input); });
$('action-input').addEventListener('input', updateControls);
$('action-input').addEventListener('keydown', (event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) { event.preventDefault(); $('action-form').requestSubmit(); } });
$('action-input').addEventListener('focus', () => { if (matchMedia('(max-width: 650px)').matches) setTimeout(() => $('action-form').scrollIntoView({ behavior: 'smooth', block: 'center' }), 220); });
$('retry-turn').addEventListener('click', submitPending);
$('change-action').addEventListener('click', () => { if (!busy && !pendingTurn?.uncertain) { clearPending(); render(); $('action-input').focus(); } });
$('import-session-file').addEventListener('change', () => importStory($('import-session-file').files[0]));
$('new-button').addEventListener('click', openSetup); $('customize-start').addEventListener('click', openSetup);
$('quick-start').addEventListener('click', () => createStory({ ...PRESETS.urban, genre: 'urban', mode: health?.story?.configured ? 'ai' : 'demo' }));
$('library-button').addEventListener('click', listStories); $('library-new').addEventListener('click', () => { $('library-dialog').close(); openSetup(); });
$('health-button').addEventListener('click', () => $('health-dialog').showModal());
$('refresh-health').addEventListener('click', async () => { $('refresh-health').disabled = true; await checkHealth(); $('refresh-health').disabled = false; });
$('rewind-button').addEventListener('click', rewind); $('return-current').addEventListener('click', () => { selectedNodeId = latestNode().id; render(); });
$('export-session').addEventListener('click', () => { if (session) { const link = element('a'); link.href = `${storyPath()}/export`; link.download = `system-life-story-${session.id}.json`; document.body.append(link); link.click(); link.remove(); } });
$('toast-close').addEventListener('click', () => show('toast', false));
document.querySelectorAll('.close-dialog').forEach((button) => button.addEventListener('click', () => { if (!busy) button.closest('dialog').close(); }));
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); }));
document.addEventListener('keydown', (event) => { if (busy || relevantPending() || !session || !isCurrent() || document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return; const index = Number(event.key) - 1; const choice = currentNode().choices?.[index]; if (choice && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); turn({ choiceId: choice.id }, choice.label); } });

async function initialize() {
  if (typeof pendingByStory !== 'object' || Array.isArray(pendingByStory)) pendingByStory = {};
  for (const [id, packet] of Object.entries(pendingByStory)) if (!/^[a-f0-9-]{36}$/.test(id) || packet?.sessionId !== id || !packet.body || typeof packet.body.requestId !== 'string' || !Number.isInteger(packet.body.revision)) delete pendingByStory[id];
  storeValue(PENDING_KEY, pendingByStory);
  await checkHealth(); if (health?.story?.configured) $('setup-form').querySelector('[name="mode"][value="ai"]').checked = true;
  try { const result = await api('/api/sessions'); sessions = result.sessions || []; if (sessions.length) { const remembered = readStored(SESSION_KEY); const target = sessions.find((story) => story.id === remembered) || sessions.find((story) => pendingByStory[story.id]) || sessions[0]; const opened = await api(storyPath(target.id)); acceptSession(opened.session, { goToLatest: true }); } else { show('loading', false); show('welcome'); } }
  catch (error) { show('loading', false); show('welcome'); toast(error.message); }
}

initialize();
