import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TELEGRAM_WEBHOOK_URL = 'https://qingyu.invalid/api/backend/v1/telegram/feedback/webhook';
export const TELEGRAM_ALLOWED_UPDATES = Object.freeze(['message', 'edited_message']);
export const TELEGRAM_INPUT_MAX_BYTES = 16_384;
const MAX_RESPONSE_BYTES = 65_536;
const backendRoot = fileURLToPath(new URL('../', import.meta.url));
const messages = Object.freeze({
  INVALID_INPUT: '请通过安全输入提供有效的 Bot Token 和一个反馈群地址。',
  INVALID_GROUP: '群地址无效。请使用负数群 ID、@公开群名或 t.me 群消息链接。',
  INVITE_LINK: '邀请链接不能解析群 ID。请先把机器人加入群，再提供该群的消息链接或负数群 ID。',
  TELEGRAM_REQUEST_FAILED: 'Telegram 验证未完成，请检查 Token、群地址和机器人权限后重新绑定。',
  INVALID_BOT: 'Telegram 未返回有效的机器人身份。',
  NOT_A_GROUP: '目标不是 group/supergroup，不能绑定为反馈群。',
  GROUP_MISMATCH: 'Telegram 返回的群身份与输入不一致，绑定已停止。',
  BOT_NOT_MEMBER: '请先把机器人加入指定群，再重新绑定。',
  PRIVACY_REQUIRED: '普通 @ 提及能力尚未确认。请在 BotFather 使用 /setprivacy，选择此机器人并设为 Disable，然后移出并重新加入群；也可授予群管理员权限后重试。',
  WEBHOOK_CONFLICT: '这个机器人已绑定其他 Webhook，已停止操作。请使用专供晴屿的机器人，现有项目不会被覆盖。',
  SECRET_UPLOAD_FAILED: 'Cloudflare 配置未确认完成。部分密钥可能已保存，请保留本页状态并重新检查后绑定。',
  WEBHOOK_SET_FAILED: 'Worker 配置已保存，但 Telegram Webhook 设置未确认完成。未清除任何待处理更新。',
  WEBHOOK_VERIFY_FAILED: 'Webhook 设置已响应，但最终配置未验证通过。请检查绑定状态；未清除任何待处理更新。',
  INTERRUPTED: '绑定已中断，部分配置状态可能未知。请检查后重新打开安全绑定页。',
  LOCAL_FAILED: '本机绑定程序未确认完成，请重新打开安全绑定页后检查。',
});
const stages = new Set(['input', 'bot', 'groups', 'webhook-preflight', 'worker-secrets', 'webhook-recheck', 'webhook-set', 'webhook-verify', 'complete', 'local']);
const secretStates = new Set(['not-attempted', 'unknown', 'uploaded']);
const webhookStates = new Set(['not-attempted', 'unknown', 'set', 'verified']);
export class TelegramBindingError extends Error {
  constructor(code, stage = 'input', effects = { workerSecrets: 'not-attempted', webhook: 'not-attempted' }) {
    super(messages[code] || messages.LOCAL_FAILED);
    this.name = 'TelegramBindingError'; this.code = Object.hasOwn(messages, code) ? code : 'LOCAL_FAILED';
    this.stage = stages.has(stage) ? stage : 'local'; this.effects = { ...effects };
  }
}
export function safeBindingFailure(error) {
  const failure = error instanceof TelegramBindingError ? error : new TelegramBindingError('LOCAL_FAILED', 'local');
  return { provider: 'telegram', configured: false, stage: failure.stage, code: failure.code, error: messages[failure.code],
    effects: { workerSecrets: secretStates.has(failure.effects.workerSecrets) ? failure.effects.workerSecrets : 'unknown',
      webhook: webhookStates.has(failure.effects.webhook) ? failure.effects.webhook : 'unknown' },
    tokenStored: false, pendingUpdatesDropped: false, messagesSent: 0 };
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const negativeId = value => typeof value === 'string' && /^-[1-9]\d{0,15}$/.test(value) && Number.isSafeInteger(Number(value));
const username = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value);

/** Resolve only a group reference, never fetch arbitrary user-provided URLs. */
export function parseTelegramGroupInput(input) {
  if (typeof input !== 'string' || input.length > 512) throw new TelegramBindingError('INVALID_GROUP');
  const value = input.trim();
  if (negativeId(value)) return value;
  if (value.startsWith('@') && username(value.slice(1))) return `@${value.slice(1)}`;
  let link;
  try { link = new URL(/^t\.me\//i.test(value) ? `https://${value}` : value); } catch { throw new TelegramBindingError('INVALID_GROUP'); }
  if (link.protocol !== 'https:' || link.hostname.toLowerCase() !== 't.me' || link.port || link.username || link.password || link.hash
    || [...link.searchParams.keys()].some(key => !['single', 'thread'].includes(key))) throw new TelegramBindingError('INVALID_GROUP');
  const parts = link.pathname.split('/').filter(Boolean);
  if (parts[0]?.startsWith('+') || parts[0] === 'joinchat') throw new TelegramBindingError('INVITE_LINK');
  if (parts[0] === 'c' && parts.length >= 3 && parts.length <= 4 && parts.slice(1).every(part => /^[1-9]\d{0,15}$/.test(part))) {
    const id = `-100${parts[1]}`;
    if (negativeId(id)) return id;
  }
  if (parts.length >= 1 && parts.length <= 3 && username(parts[0])
    && parts.slice(1).every(part => /^[1-9]\d{0,15}$/.test(part))) return `@${parts[0]}`;
  throw new TelegramBindingError('INVALID_GROUP');
}

export function validateTelegramConfiguration(value) {
  if (!object(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'token')
    || typeof value.token !== 'string' || !/^[1-9]\d{4,19}:[A-Za-z0-9_-]{20,200}$/.test(value.token)
    || (Object.hasOwn(value, 'chat') === Object.hasOwn(value, 'chats'))) throw new TelegramBindingError('INVALID_INPUT');
  const inputs = Object.hasOwn(value, 'chats') ? value.chats : typeof value.chat === 'string' ? value.chat.split(/[\n,]/).map(item => item.trim()).filter(Boolean) : null;
  if (!Array.isArray(inputs) || inputs.length !== 1) throw new TelegramBindingError('INVALID_INPUT');
  return { token: value.token, chats: [...new Set(inputs.map(parseTelegramGroupInput))] };
}

export function readPrivateJson(stream, maxBytes = TELEGRAM_INPUT_MAX_BYTES, timeoutMs = 10_000) {
  return new Promise((resolveJson, reject) => {
    const chunks = []; let size = 0; let settled = false;
    const finish = error => {
      if (settled) return; settled = true; clearTimeout(timer);
      stream.removeListener('data', data); stream.removeListener('end', end); stream.removeListener('error', fail);
      let buffer;
      try { if (error) throw error; buffer = Buffer.concat(chunks); resolveJson(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer))); }
      catch { stream.on('error', () => {}); stream.resume(); reject(new TelegramBindingError('INVALID_INPUT')); }
      finally { buffer?.fill(0); for (const chunk of chunks) chunk.fill(0); chunks.length = 0; }
    };
    const data = chunk => { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length;
      if (size > maxBytes) { buffer.fill(0); finish(new Error()); } else chunks.push(buffer); };
    const end = () => finish(); const fail = () => finish(new Error());
    const timer = setTimeout(fail, timeoutMs);
    stream.on('data', data); stream.once('end', end); stream.once('error', fail);
  });
}

async function responseJson(response) {
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES || !response.body) throw new Error();
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error(); chunks.push(value); }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { await reader.cancel().catch(() => {}); }
}

/** Token appears only in the private HTTPS request required by Telegram. Never expose native errors. */
async function telegramRequest(fetchImpl, token, method, body, signal) {
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
  });
  const value = await responseJson(response);
  if (!object(value) || value.ok !== true || !Object.hasOwn(value, 'result')) throw new Error();
  return value.result;
}

/** No shell, token arguments, credential files or raw child output. */
export function uploadTelegramWorkerSecrets(secrets, { spawnImpl = spawn, signal, timeoutMs = 60_000 } = {}) {
  return new Promise((resolveUpload, reject) => {
    let child; let settled = false;
    const finish = error => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) { try { child?.kill('SIGKILL'); } catch {} reject(new Error('Secret upload not confirmed.')); } else resolveUpload(); };
    const abort = () => finish(new Error()); const timer = setTimeout(abort, timeoutMs);
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      child = spawnImpl(process.execPath, [fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)), 'secret', 'bulk', '--config', 'wrangler.production.jsonc'], {
        cwd: backendRoot, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true' }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stdout.resume(); child.stderr.resume(); child.once('error', () => finish(new Error()));
      child.stdin.once('error', () => finish(new Error())); child.once('close', code => finish(code === 0 ? undefined : new Error()));
      child.stdin.end(JSON.stringify(secrets));
    } catch { finish(new Error()); }
  });
}

export async function configureTelegram(value, { fetchImpl = fetch, uploadSecrets = uploadTelegramWorkerSecrets, signal, secretFactory = () => randomBytes(32).toString('base64url') } = {}) {
  let token = ''; let stage = 'input'; const effects = { workerSecrets: 'not-attempted', webhook: 'not-attempted' };
  const fail = code => { throw new TelegramBindingError(code, stage, effects); };
  const request = async (method, body = {}) => {
    try { return await telegramRequest(fetchImpl, token, method, body, signal); }
    catch { fail(signal?.aborted ? 'INTERRUPTED' : stage === 'webhook-set' ? 'WEBHOOK_SET_FAILED' : stage === 'webhook-verify' ? 'WEBHOOK_VERIFY_FAILED' : 'TELEGRAM_REQUEST_FAILED'); }
  };
  try {
    const inputs = validateTelegramConfiguration(value); token = inputs.token;
    stage = 'bot'; const me = await request('getMe');
    if (!object(me) || me.is_bot !== true || !Number.isSafeInteger(me.id) || me.id <= 0 || !username(me.username)) fail('INVALID_BOT');
    const botId = String(me.id), botUsername = me.username;
    stage = 'groups'; const chatIds = [];
    for (const reference of inputs.chats) {
      const chat = await request('getChat', { chat_id: reference });
      if (!object(chat) || !['group', 'supergroup'].includes(chat.type) || !Number.isSafeInteger(chat.id) || chat.id >= 0) fail('NOT_A_GROUP');
      const chatId = String(chat.id);
      if ((reference.startsWith('-') && reference !== chatId)
        || (reference.startsWith('@') && (typeof chat.username !== 'string' || chat.username.toLowerCase() !== reference.slice(1).toLowerCase()))) fail('GROUP_MISMATCH');
      const member = await request('getChatMember', { chat_id: chatId, user_id: me.id });
      if (!object(member) || !object(member.user) || member.user.id !== me.id || member.user.is_bot !== true
        || !(['member', 'administrator'].includes(member.status) || member.status === 'restricted' && member.is_member === true)) fail('BOT_NOT_MEMBER');
      if (me.can_read_all_group_messages !== true && member.status !== 'administrator') fail('PRIVACY_REQUIRED');
      chatIds.push(chatId);
    }
    const allowedChatIds = [...new Set(chatIds)];
    const checkWebhook = async () => {
      const webhook = await request('getWebhookInfo');
      if (!object(webhook) || typeof webhook.url !== 'string') fail('TELEGRAM_REQUEST_FAILED');
      if (webhook.url !== '' && webhook.url !== TELEGRAM_WEBHOOK_URL) fail('WEBHOOK_CONFLICT');
      return webhook;
    };
    stage = 'webhook-preflight'; await checkWebhook();
    const webhookSecret = secretFactory();
    if (typeof webhookSecret !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret) || webhookSecret === token) fail('INVALID_INPUT');
    stage = 'worker-secrets'; effects.workerSecrets = 'unknown';
    try { await uploadSecrets({ TELEGRAM_FEEDBACK_ENABLED: 'true', TELEGRAM_FEEDBACK_BOT_ID: botId,
      TELEGRAM_FEEDBACK_BOT_USERNAME: botUsername, TELEGRAM_FEEDBACK_ALLOWED_CHAT_IDS: allowedChatIds[0],
      TELEGRAM_FEEDBACK_WEBHOOK_SECRET: webhookSecret }, { signal }); }
    catch { fail(signal?.aborted ? 'INTERRUPTED' : 'SECRET_UPLOAD_FAILED'); }
    effects.workerSecrets = 'uploaded';
    stage = 'webhook-recheck'; await checkWebhook();
    stage = 'webhook-set'; effects.webhook = 'unknown';
    if (await request('setWebhook', { url: TELEGRAM_WEBHOOK_URL, allowed_updates: [...TELEGRAM_ALLOWED_UPDATES],
      drop_pending_updates: false, secret_token: webhookSecret }) !== true) fail('WEBHOOK_SET_FAILED');
    effects.webhook = 'set'; stage = 'webhook-verify';
    const final = await request('getWebhookInfo');
    if (!object(final) || final.url !== TELEGRAM_WEBHOOK_URL || !Array.isArray(final.allowed_updates)
      || final.allowed_updates.length !== 2 || !TELEGRAM_ALLOWED_UPDATES.every(type => final.allowed_updates.includes(type))) fail('WEBHOOK_VERIFY_FAILED');
    effects.webhook = 'verified';
    return { provider: 'telegram', configured: true, stage: 'complete', credentialsVerified: true, groupMembershipVerified: true,
      plainMentionsVerified: true, webhookVerified: true, webhookUrl: TELEGRAM_WEBHOOK_URL, botId, botUsername, allowedChatIds,
      workerSecretCount: 5, tokenStored: false, pendingUpdatesDropped: false, messagesSent: 0, deliveryTested: false, effects };
  } catch (error) {
    if (error instanceof TelegramBindingError && error.stage === 'input') throw new TelegramBindingError(error.code, stage, effects);
    if (error instanceof TelegramBindingError) throw error;
    throw new TelegramBindingError(signal?.aborted ? 'INTERRUPTED' : 'LOCAL_FAILED', stage, effects);
  } finally { token = ''; if (object(value) && Object.hasOwn(value, 'token')) value.token = ''; }
}

/** Whitelist child metadata; never relay raw stdout, provider text, Token or Webhook secret. */
export function sanitizeTelegramBindingResult(value) {
  if (!object(value) || value.provider !== 'telegram' || value.tokenStored !== false || value.pendingUpdatesDropped !== false || value.messagesSent !== 0) throw new Error('Invalid binding metadata.');
  if (value.configured === false) {
    if (!Object.hasOwn(messages, value.code) || !stages.has(value.stage) || !object(value.effects)
      || !secretStates.has(value.effects.workerSecrets) || !webhookStates.has(value.effects.webhook)) throw new Error('Invalid binding metadata.');
    return safeBindingFailure(new TelegramBindingError(value.code, value.stage, value.effects));
  }
  if (value.configured !== true || value.stage !== 'complete' || value.credentialsVerified !== true || value.groupMembershipVerified !== true
    || value.plainMentionsVerified !== true || value.webhookVerified !== true || value.webhookUrl !== TELEGRAM_WEBHOOK_URL
    || typeof value.botId !== 'string' || !/^[1-9]\d{0,15}$/.test(value.botId) || !Number.isSafeInteger(Number(value.botId)) || !username(value.botUsername)
    || !Array.isArray(value.allowedChatIds) || value.allowedChatIds.length !== 1 || !value.allowedChatIds.every(negativeId)
    || value.workerSecretCount !== 5 || value.deliveryTested !== false) throw new Error('Invalid binding metadata.');
  return { provider: 'telegram', configured: true, stage: 'complete', credentialsVerified: true, groupMembershipVerified: true,
    plainMentionsVerified: true, webhookVerified: true, webhookUrl: TELEGRAM_WEBHOOK_URL, botId: value.botId, botUsername: value.botUsername,
    allowedChatIds: [...value.allowedChatIds], workerSecretCount: 5, tokenStored: false, pendingUpdatesDropped: false, messagesSent: 0,
    deliveryTested: false, effects: { workerSecrets: 'uploaded', webhook: 'verified' } };
}

async function main() {
  let input; const controller = new AbortController(); const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    if (process.argv.length !== 2) throw new TelegramBindingError('INVALID_INPUT');
    input = await readPrivateJson(process.stdin);
    console.log(JSON.stringify(await configureTelegram(input, { signal: controller.signal })));
  } catch (error) { console.log(JSON.stringify(safeBindingFailure(error))); process.exitCode = 1; }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    if (object(input) && Object.hasOwn(input, 'token')) input.token = ''; process.stdin.destroy(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
