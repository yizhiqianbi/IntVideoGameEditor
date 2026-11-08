import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// LIVE verifier. Run only after deployment is confirmed and execution authorized:
// node cloudflare/dzmm-web/scripts/verify-chat-media-live.mjs --live
// Narrow authorized runs: --live --audio-diagnostic or --live --image-only.
// One initial audio request and one initial image request; no generation retries,
// LLM requests, payments, subscription checkout, VIP periods or credit check-ins.
// Only fresh guests created by this invocation are promoted, queried or deleted.
// Cookies, account IDs, synthetic emails and R2 object keys stay in memory.
const modeArgument = process.argv[3];
const audioDiagnostic = modeArgument === '--audio-diagnostic';
const imageOnly = modeArgument === '--image-only';
if (process.argv[2] !== '--live' || process.argv.length < 3 || process.argv.length > 4
  || (modeArgument !== undefined && !audioDiagnostic && !imageOnly)) {
  console.error('After release confirmation, use --live, optionally followed by --audio-diagnostic or --image-only.');
  process.exit(2);
}
assert.ok(Number(process.versions.node.split('.')[0]) >= 22, 'Native Node 22+ is required.');

const base = 'https://xumengchat.top';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const startedAt = new Date().toISOString();
const stamp = startedAt.replace(/[:.]/g, '-');
const outputDir = new URL('../../../output/xumeng/', import.meta.url);
const reportUrl = new URL(`chat-media-live-${stamp}.json`, outputDir);
const backendRoot = fileURLToPath(new URL('../../dzmm/', import.meta.url));
const wrangler = fileURLToPath(new URL('../../dzmm/node_modules/wrangler/bin/wrangler.js', import.meta.url));
const run = promisify(execFile);
const accounts = [];
const maxAccounts = audioDiagnostic ? 1 : 2;
const initialAssets = new Map();
const generationAttempts = { audio: 0, image: 0 };
const cacheAttempts = { audio: 0, image: 0 };
const cancellation = new AbortController();
let unsettledGenerationUntil = 0;
let owner, other;
const report = {
  startedAt, baseUrl: base, mode: audioDiagnostic ? 'audio-diagnostic' : imageOnly ? 'image-only' : 'full-verification',
  stage: 'configuration', completed: false, cleanupCompleted: false,
  checks: [], requests: [], outputs: {}, generationAttempts, cacheAttempts,
  llmRequests: 0, paymentsPerformed: 0, subscriptionOrdersCreated: 0,
  vipPeriodsCreated: 0, dailyCreditClaimsCreated: 0,
  humanReview: { status: 'pending', criteria: [
    ...(!imageOnly ? ['中文语音可播放且自然朗读原创书店正文。'] : []),
    ...(!audioDiagnostic ? ['图片呈现安全的书店场景、窗光、木桌和旧地图。'] : []),
  ] },
};
const publicErrorCodes = new Map([
  ['生成结果格式无效，请稍后重试。', 'invalid-format'],
  ['生成结果不是有效的语音或图片，请稍后重试。', 'invalid-media'],
  ['生成结果大小无效，请稍后重试。', 'invalid-size'],
  ['素材生成失败，请稍后重试。', 'generation-failed'],
]);
async function safeErrorCode(response, label) {
  // Parse in memory and persist only our own exact-message whitelist mapping.
  // Unknown service messages, external text and raw response bodies are omitted.
  let code = null;
  try {
    const body = await response.json();
    if (typeof body?.error === 'string') code = publicErrorCodes.get(body.error) ?? null;
  } catch { /* Invalid or non-JSON bodies are intentionally omitted. */ }
  const trace = report.requests.findLast(item => item.label === label);
  if (trace) trace.errorCode = code;
  report.lastServiceFailure = { request: label, status: response.status, errorCode: code };
  console.log(JSON.stringify({ request: label, status: response.status, errorCode: code }));
  return code;
}

function passed(name, evidence = {}) { report.checks.push({ name, passed: true, ...evidence }); }
function progress(stage) {
  report.stage = stage;
  console.log(JSON.stringify({ at: new Date().toISOString(), stage }));
}
function literal(value) { return `'${value.replaceAll("'", "''")}'`; }
function accountIdsSql() {
  assert.ok(accounts.length > 0 && accounts.length <= maxAccounts);
  for (const account of accounts) assert.match(account.id, UUID);
  return accounts.map(account => literal(account.id)).join(',');
}
async function command(args) {
  // Never print child output or raw errors: Wrangler may include configuration.
  return run(process.execPath, [wrangler, ...args, '--config', 'wrangler.production.jsonc'], {
    cwd: backendRoot, timeout: 90_000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true' },
  });
}
async function database(sql) {
  const { stdout } = await command(['d1', 'execute', 'DB', '--remote', '--json', '--command', sql]);
  const result = JSON.parse(stdout);
  assert.ok(Array.isArray(result) && result.every(item => item.success === true));
  return result;
}
async function rows(sql) { return (await database(sql)).at(-1).results; }
function interrupt() {
  report.interrupted = true;
  cancellation.abort();
}
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

class Client {
  id = '';
  cookie = '';
  previewEmail = '';
  promoted = false;
  async request(label, path, { method = 'GET', body, headers: suppliedHeaders, timeoutMs = 30_000, intent } = {}) {
    const url = new URL(path, base);
    assert.equal(url.origin, base);
    assert.ok(url.pathname.startsWith('/api/backend/v1/'), 'Only backend APIs are allowed; no LLM API is reachable.');
    const allowedReads = /^\/api\/backend\/v1\/(?:subscriptions\/config|state|chat-media(?:\/assets\/[a-f0-9-]{36})?|conversations\/[A-Za-z0-9_-]+)$/;
    const allowedWrites = new Set(['/api/backend/v1/auth/guest', '/api/backend/v1/characters', '/api/backend/v1/conversations', '/api/backend/v1/chat-media/generate']);
    assert.ok(method === 'GET' ? allowedReads.test(url.pathname) : method === 'POST' && allowedWrites.has(url.pathname));
    if (url.pathname === '/api/backend/v1/auth/guest') assert.ok(!this.cookie && !this.id && accounts.length < maxAccounts);
    else if (method === 'POST') assert.ok(accounts.includes(this) && this.id && this.cookie);
    if (url.pathname === '/api/backend/v1/chat-media/generate') {
      assert.equal(method, 'POST');
      assert.deepEqual(Object.keys(body).sort(), ['accountId', 'conversationId', 'kind', 'messageId']);
      assert.equal(body.accountId, this.id);
      assert.equal(body.conversationId, fixture.conversation.id);
      assert.equal(body.messageId, fixture.message.id);
      assert.ok(body.kind === 'audio' || body.kind === 'image');
      if (audioDiagnostic) assert.ok(body.kind === 'audio' && intent === 'initial', 'Diagnostic mode permits only one initial audio POST.');
      if (imageOnly) assert.equal(body.kind, 'image', 'Image-only mode cannot request audio, including permission or cache checks.');
      if (intent === 'initial') {
        assert.equal(this, owner);
        assert.equal(this.promoted, true);
        assert.equal(generationAttempts[body.kind], 0, 'No second initial request or retry is permitted.');
        generationAttempts[body.kind]++;
        assert.ok(generationAttempts.audio + generationAttempts.image <= 2);
        // If transport fails while the Worker still runs, cleanup waits beyond
        // its fixed provider timeout before deleting R2 objects and D1 rows.
        unsettledGenerationUntil = Date.now() + (body.kind === 'audio' ? 90_000 : 120_000) + 35_000;
      } else if (intent === 'cache' || intent === 'cross-origin-cache') {
        assert.equal(this, owner);
        assert.ok(initialAssets.has(body.kind), 'A confirmed ready asset is required before any repeated POST.');
        if (intent === 'cache') {
          assert.equal(cacheAttempts[body.kind], 0);
          cacheAttempts[body.kind]++;
        } else assert.equal(suppliedHeaders?.Origin, 'https://example.invalid');
      } else {
        assert.equal(intent, 'guest-denied');
        assert.equal(this, other);
        assert.equal(this.promoted, false);
      }
    }
    const headers = new Headers(suppliedHeaders);
    if (!headers.has('Origin')) headers.set('Origin', base);
    if (this.cookie) headers.set('Cookie', this.cookie);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const trace = { label, method, requestStartedAt: new Date().toISOString() };
    report.requests.push(trace);
    const response = await fetch(url, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error',
      signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(timeoutMs)]),
    });
    trace.responseCompletedAt = new Date().toISOString();
    trace.status = response.status;
    console.log(JSON.stringify({ at: trace.responseCompletedAt, request: label, method, status: response.status }));
    return response;
  }
  async json(label, path, options = {}, status = 200) {
    const response = await this.request(label, path, options);
    if (response.status !== status) await safeErrorCode(response, label);
    assert.equal(response.status, status, `${label} returned an unexpected status.`);
    assert.match(response.headers.get('Content-Type') ?? '', /application\/json/);
    return response.json();
  }
}

const scene = '午后的书店里，阳光从高窗落在木桌上，旧地图铺在桌面，墙边的书架整齐安静。成年店员穿着蓝色长袖衬衫，将一盏小台灯移到地图旁，笑着说：“我们就在这里慢慢查看灯塔的标记，先喝杯温茶吧。”窗外的梧桐叶轻轻摇动，室内温暖而明亮。';
const fixture = {
  character: { id: `media-verify-${randomUUID()}`, name: '书店地图修复员', author: '原创媒体验证',
    heat: '0', likes: '0', cover: '/assets/xumeng/brand/xumeng-mark.svg', tags: ['自定义', '一般向'],
    description: '一名成年书店店员，在安静的书店里修复旧地图。', personality: '友善沉静，乐于讨论书籍与地图。',
    scenario: '下午的书店，木桌、书架、高窗和旧地图。所有人物均为成年人。', firstMessage: scene,
    createdAt: startedAt, sourceUrl: '', sourceKind: 'original', promptOrigin: 'original' },
  conversation: { id: `media-live-${randomUUID()}`, title: '原创书店媒体验证', updatedAt: Date.now() },
  message: { id: `media-message-${randomUUID()}`, role: 'assistant', content: scene },
};
fixture.conversation.characterId = fixture.character.id;
fixture.conversation.messages = [fixture.message];
const sourceHash = createHash('sha256').update(scene).digest('hex');
const generationBody = (client, kind) => ({ accountId: client.id, conversationId: fixture.conversation.id, messageId: fixture.message.id, kind });
const mediaPath = `/api/backend/v1/chat-media?conversationId=${encodeURIComponent(fixture.conversation.id)}`;

async function freshGuest(label) {
  const client = new Client();
  const response = await client.request(`${label}-create`, '/api/backend/v1/auth/guest', { method: 'POST', body: {} });
  assert.equal(response.status, 200);
  const session = await response.json();
  assert.match(session.user?.id ?? '', UUID);
  client.id = session.user.id;
  // Track the new ID before any further assertion so finally can clean it.
  accounts.push(client);
  assert.equal(session.user.isGuest, true);
  assert.equal(session.user.role, 'user');
  assert.equal(session.user.email, null);
  assert.ok(!accounts.some(account => account !== client && account.id === client.id));
  const issuedCookie = response.headers.getSetCookie().find(value => value.startsWith('dzmm_session='));
  assert.ok(typeof issuedCookie === 'string');
  assert.match(issuedCookie, /HttpOnly/i);
  assert.match(issuedCookie, /Secure/i);
  assert.match(issuedCookie, /SameSite=Lax/i);
  client.cookie = issuedCookie.split(';', 1)[0];
  const state = await client.json(`${label}-empty-state`, '/api/backend/v1/state');
  assert.equal(state.user.id, client.id);
  assert.equal(state.user.isGuest, true);
  assert.equal(state.version, 0);
  assert.deepEqual(state.state.custom, []);
  assert.deepEqual(state.state.conversations, []);
  passed(`${label}-fresh-isolated-guest`);
  return client;
}
function assertAsset(asset, kind) {
  assert.match(asset?.id ?? '', UUID);
  assert.equal(asset.conversationId, fixture.conversation.id);
  assert.equal(asset.messageId, fixture.message.id);
  assert.equal(asset.kind, kind);
  assert.equal(asset.url, `/api/backend/v1/chat-media/assets/${asset.id}`);
  assert.equal(asset.sourceHash, sourceHash);
  assert.ok(Number.isSafeInteger(asset.createdAt) && asset.createdAt > 0);
  if (kind === 'audio') {
    assert.ok(['audio/mpeg', 'audio/wav'].includes(asset.mimeType));
    assert.equal(asset.totalTextChars, Array.from(scene).length);
    assert.equal(asset.audioTextChars, Array.from(scene).length);
  } else assert.ok(['image/png', 'image/jpeg'].includes(asset.mimeType));
}
async function mediaState(label, expectedUsage) {
  const state = await owner.json(label, mediaPath);
  assert.equal(state.accountId, owner.id);
  assert.equal(state.conversationId, fixture.conversation.id);
  assert.deepEqual(state.vip, { active: false, expiresAt: null, adminPreview: true });
  assert.deepEqual(state.features, { audio: true, image: true });
  assert.deepEqual(state.limits, { audio: 20, image: 5, maxVoiceChars: 800 });
  assert.deepEqual(state.usage, expectedUsage);
  assert.equal(state.assets.length, initialAssets.size);
  for (const [kind, asset] of initialAssets) {
    assertAsset(state.assets.find(item => item.kind === kind), kind);
    assert.deepEqual(state.assets.find(item => item.kind === kind), asset);
  }
  passed(label, { vip: state.vip, features: state.features, limits: state.limits, usage: state.usage, assetCount: state.assets.length });
  return state;
}
async function accounting() {
  const idSql = literal(owner.id);
  const assets = await rows(`SELECT id,user_id,conversation_id,message_id,kind,source_hash,status,processing_token,object_key,mime_type,byte_length
    FROM chat_media_assets WHERE user_id=${idSql} ORDER BY kind,id;`);
  const usage = await rows(`SELECT id,asset_id,kind,day_key,status,created_at,expires_at
    FROM chat_media_usage WHERE user_id=${idSql} ORDER BY kind,id;`);
  assert.equal(assets.length, initialAssets.size);
  assert.equal(usage.length, initialAssets.size);
  for (const [kind, asset] of initialAssets) {
    const matches = assets.filter(item => item.kind === kind);
    const claims = usage.filter(item => item.kind === kind);
    assert.equal(matches.length, 1);
    assert.equal(claims.length, 1);
    const row = matches[0], claim = claims[0];
    assert.equal(row.id, asset.id);
    assert.equal(row.user_id, owner.id);
    assert.equal(row.conversation_id, fixture.conversation.id);
    assert.equal(row.message_id, fixture.message.id);
    assert.equal(row.source_hash, sourceHash);
    assert.equal(row.status, 'ready');
    assert.equal(row.mime_type, asset.mimeType);
    assert.ok(Number.isSafeInteger(row.byte_length) && row.byte_length > 20);
    assert.match(row.processing_token, UUID);
    const keyPrefix = `chat-media/${owner.id}/${asset.id}/${row.processing_token}.`;
    assert.ok(kind === 'audio'
      ? [keyPrefix + 'audio', keyPrefix + 'mp3'].includes(row.object_key)
      : row.object_key === keyPrefix + 'image');
    assert.equal(claim.id, row.processing_token);
    assert.equal(claim.asset_id, asset.id);
    assert.equal(claim.status, 'ready');
    assert.equal(claim.day_key, new Date(claim.created_at + 8 * 3600_000).toISOString().slice(0, 10));
  }
  assert.ok(new Set(usage.map(item => item.day_key)).size <= 1, 'Both generations must occur on the same Shanghai day.');
  return { assets, usage };
}
function mediaFormat(bytes, kind, mimeType) {
  assert.ok(bytes.length > 20);
  if (kind === 'audio') {
    if (mimeType === 'audio/wav') {
      assert.ok(bytes.length >= 44);
      assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
      assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WAVE');
      assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, 'WAV RIFF length must match the complete file.');
      let format, dataBytes = 0;
      for (let offset = 12; offset + 8 <= bytes.length;) {
        const name = bytes.subarray(offset, offset + 4).toString('ascii');
        const length = bytes.readUInt32LE(offset + 4), start = offset + 8;
        assert.ok(start + length <= bytes.length, 'WAV chunks must remain inside the file.');
        if (name === 'fmt ') {
          assert.ok(length >= 16);
          format = { formatTag: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2),
            sampleRate: bytes.readUInt32LE(start + 4), byteRate: bytes.readUInt32LE(start + 8),
            blockAlign: bytes.readUInt16LE(start + 12), bitsPerSample: bytes.readUInt16LE(start + 14) };
          assert.ok([1, 3, 65534].includes(format.formatTag));
          assert.ok(format.channels > 0 && format.sampleRate > 0 && format.byteRate > 0 && format.blockAlign > 0);
          assert.ok([8, 16, 24, 32, 64].includes(format.bitsPerSample));
        }
        if (name === 'data') dataBytes += length;
        offset = start + length + (length % 2);
      }
      assert.ok(format && dataBytes > 0, 'WAV requires a valid format and nonempty audio data.');
      assert.equal(dataBytes % format.blockAlign, 0);
      return { format: 'wav', header: 'RIFF/WAVE', ...format, dataBytes,
        durationSeconds: Math.round(dataBytes / format.byteRate * 1000) / 1000 };
    }
    assert.equal(mimeType, 'audio/mpeg');
    const id3 = bytes.subarray(0, 3).toString('ascii') === 'ID3' && bytes[3] <= 4;
    const frame = bytes[0] === 255 && (bytes[1] & 224) === 224 && (bytes[1] & 24) !== 8
      && (bytes[1] & 6) !== 0 && (bytes[2] & 240) !== 0 && (bytes[2] & 240) !== 240 && (bytes[2] & 12) !== 12;
    assert.ok(id3 || frame, 'Audio must have a valid MP3 ID3 or MPEG frame header.');
    return { format: 'mp3', header: id3 ? 'ID3' : 'MPEG-frame' };
  }
  if (mimeType === 'image/png') {
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(8), 13);
    assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    assert.ok(width > 0 && height > 0);
    return { format: 'png', width, height };
  }
  assert.equal(mimeType, 'image/jpeg');
  assert.deepEqual([...bytes.subarray(0, 3)], [255, 216, 255]);
  assert.deepEqual([...bytes.subarray(-2)], [255, 217]);
  return { format: 'jpeg' };
}
function assertNoStore(response) {
  // The web gateway sets no-store; the backend also marks assets private.
  assert.match(response.headers.get('Cache-Control') ?? '', /(?:^|,\s*)no-store(?:,|$)/);
  assert.doesNotMatch(response.headers.get('Cache-Control') ?? '', /(?:^|,\s*)(?:public|max-age|s-maxage)\b/i);
}
async function download(kind, asset) {
  const response = await owner.request(`${kind}-download`, asset.url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), asset.mimeType);
  assertNoStore(response);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  const bytes = Buffer.from(await response.arrayBuffer());
  report.outputs[kind].downloadCompletedAt = new Date().toISOString();
  assert.equal(Number(response.headers.get('Content-Length')), bytes.length);
  assert.ok(bytes.length <= (kind === 'audio' ? 12 : 10) * 1024 * 1024);
  const format = mediaFormat(bytes, kind, asset.mimeType);
  const extension = kind === 'audio' ? format.format : format.format === 'png' ? 'png' : 'jpg';
  const outputUrl = new URL(`chat-media-live-${stamp}-${kind}.${extension}`, outputDir);
  await writeFile(outputUrl, bytes);
  Object.assign(report.outputs[kind], { bytes: bytes.length, path: fileURLToPath(outputUrl), ...format });
  if (kind === 'audio') {
    assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
    const range = await owner.request('audio-range-20-bytes', asset.url, { headers: { Range: 'bytes=0-19' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('Content-Type'), asset.mimeType);
    assertNoStore(range);
    assert.equal(range.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(range.headers.get('Content-Range'), `bytes 0-19/${bytes.length}`);
    assert.equal(range.headers.get('Content-Length'), '20');
    const partial = Buffer.from(await range.arrayBuffer());
    assert.equal(partial.length, 20);
    assert.deepEqual(partial, bytes.subarray(0, 20));
    report.outputs.audio.range = { status: 206, bytes: 20, cacheControl: range.headers.get('Cache-Control') };
  }
  passed(`${kind}-download-valid-private-format`, { bytes: bytes.length, ...format });
}

async function cleanup() {
  report.cleanup = { startedAt: new Date().toISOString(), createdAccounts: accounts.length, objectsDeleted: 0, accountsRemaining: null };
  if (!accounts.length) {
    report.cleanup.accountsRemaining = 0;
    report.cleanupCompleted = true;
    return;
  }
  // On an uncertain initial request, wait until its Worker cannot still put an
  // object after our deletion. This performs no HTTP or provider retry.
  while (unsettledGenerationUntil > Date.now()) {
    progress('cleanup-waiting-for-unsettled-generation');
    await sleep(Math.min(45_000, unsettledGenerationUntil - Date.now()));
  }
  progress('cleanup-reading-owned-r2-keys-before-cascade');
  const ids = accountIdsSql();
  const objects = await rows(`SELECT id,user_id,conversation_id,message_id,kind,status,object_key FROM chat_media_assets WHERE user_id IN (${ids});`);
  for (const object of objects) {
    assert.ok(accounts.some(account => account.id === object.user_id));
    assert.match(object.id, UUID);
    assert.equal(object.conversation_id, fixture.conversation.id);
    assert.equal(object.message_id, fixture.message.id);
    assert.ok(object.kind === 'audio' || object.kind === 'image');
    // Provider timeouts do not cover subsequent D1/R2 calls. A reservation
    // still pending after the wait must retain its user and recoverable key.
    assert.ok(object.status === 'ready' || object.status === 'failed', 'Do not cascade-delete a generation still pending.');
    const prefix = `chat-media/${object.user_id}/${object.id}/`;
    assert.ok(object.object_key.startsWith(prefix));
    const suffix = object.object_key.slice(prefix.length);
    const extension = (object.kind === 'audio' ? ['.audio', '.mp3'] : ['.image']).find(value => suffix.endsWith(value));
    assert.ok(extension);
    assert.match(suffix.slice(0, -extension.length), UUID);
  }
  // Delete every owned object before deleting users; failed deletion leaves D1
  // keys discoverable for recovery instead of silently creating R2 orphans.
  let deletionFailed = false;
  for (const key of new Set(objects.map(object => object.object_key))) {
    try {
      const deletion = await command(['r2', 'object', 'delete', `dzmm-media/${key}`, '--remote']);
      assert.match(deletion.stdout, /Delete complete\./);
      report.cleanup.objectsDeleted++;
    } catch { deletionFailed = true; }
  }
  assert.equal(deletionFailed, false, 'Owned R2 objects must be deleted before D1 cascades.');
  progress('cleanup-deleting-only-created-accounts');
  const guards = accounts.map(account => `id=${literal(account.id)} AND (${account.previewEmail
    ? `email=${literal(account.previewEmail)} OR ` : ''}(is_guest=1 AND email IS NULL AND password_hash IS NULL))`).join(' OR ');
  const result = await database(`DELETE FROM users WHERE id IN (${ids}) AND (${guards});
    SELECT COUNT(*) AS remaining FROM users WHERE id IN (${ids});`);
  report.cleanup.accountsRemaining = result.at(-1).results[0].remaining;
  assert.equal(report.cleanup.accountsRemaining, 0);
  const leftovers = await rows(`SELECT
    (SELECT COUNT(*) FROM chat_media_assets WHERE user_id IN (${ids})) AS assets,
    (SELECT COUNT(*) FROM chat_media_usage WHERE user_id IN (${ids})) AS usage,
    (SELECT COUNT(*) FROM sessions WHERE user_id IN (${ids})) AS sessions,
    (SELECT COUNT(*) FROM characters WHERE user_id IN (${ids})) AS characters,
    (SELECT COUNT(*) FROM conversations WHERE user_id IN (${ids})) AS conversations,
    (SELECT COUNT(*) FROM messages WHERE user_id IN (${ids})) AS messages;`);
  assert.deepEqual(leftovers[0], { assets: 0, usage: 0, sessions: 0, characters: 0, conversations: 0, messages: 0 });
  report.cleanupCompleted = true;
  passed('only-this-invocation-r2-objects-and-created-accounts-cleaned', { createdAccounts: accounts.length, objectsDeleted: report.cleanup.objectsDeleted, remaining: 0 });
}

try {
  progress('configuration');
  const config = await new Client().json('public-vip-config', '/api/backend/v1/subscriptions/config');
  assert.equal(config.enabled, true);
  assert.equal(config.renewal, 'manual');
  assert.equal(config.autoRenew, false);
  assert.equal(config.provider, 'zpay');
  assert.equal(config.mode, 'live');
  assert.equal(config.testMode, false);
  assert.equal(config.modelBillingLinked, false);
  assert.equal(config.currency, 'cny');
  assert.equal(config.timezone, 'Asia/Shanghai');
  assert.equal(config.plans.length, 1);
  assert.deepEqual(config.plans[0], { id: 'vip_monthly', label: '叙梦 VIP', revision: 1,
    amountMinor: 2800, currency: 'cny', durationDays: 30, dailyCredits: 100, maxClaims: 30, timezone: 'Asia/Shanghai' });
  report.subscriptionConfiguration = { enabled: true, renewal: 'manual', autoRenew: false, plan: config.plans[0] };
  passed('vip-monthly-public-configuration-exact-manual-terms');
  await mkdir(outputDir, { recursive: true });
  const fixtureUrl = new URL(`chat-media-live-${stamp}-fixture.json`, outputDir);
  await writeFile(fixtureUrl, `${JSON.stringify(fixture, null, 2)}\n`);
  report.outputs.fixture = { path: fileURLToPath(fixtureUrl), sourceHash, textChars: Array.from(scene).length };

  progress('fresh-guests-and-guarded-admin-preview');
  owner = await freshGuest('owner');
  if (!audioDiagnostic) other = await freshGuest('other');
  owner.previewEmail = `media-verify-${randomUUID()}@example.invalid`;
  const promoted = await rows(`UPDATE users SET is_guest=0,role='super',email=${literal(owner.previewEmail)}
    WHERE id=${literal(owner.id)} AND is_guest=1 AND email IS NULL AND password_hash IS NULL AND role='user' AND version=0
    AND NOT EXISTS(SELECT 1 FROM characters WHERE user_id=${literal(owner.id)})
    AND NOT EXISTS(SELECT 1 FROM conversations WHERE user_id=${literal(owner.id)}) RETURNING id,is_guest,role,email;`);
  assert.equal(promoted.length, 1);
  assert.deepEqual(promoted[0], { id: owner.id, is_guest: 0, role: 'super', email: owner.previewEmail });
  owner.promoted = true;
  passed('guarded-fresh-guest-admin-preview-without-vip-period');

  progress('save-original-private-character-and-assistant-message');
  const characterSaved = await owner.json('private-character-create', '/api/backend/v1/characters', {
    method: 'POST', body: { accountId: owner.id, version: 0, character: fixture.character },
  });
  const conversationSaved = await owner.json('private-conversation-create', '/api/backend/v1/conversations', {
    method: 'POST', body: { accountId: owner.id, version: characterSaved.version, conversation: fixture.conversation },
  });
  assert.equal(conversationSaved.user.id, owner.id);
  const restored = await owner.json('saved-original-conversation', `/api/backend/v1/conversations/${fixture.conversation.id}`);
  assert.equal(restored.conversation.characterId, fixture.character.id);
  assert.deepEqual(restored.conversation.messages, [fixture.message]);
  passed('original-private-bookshop-assistant-message-persisted');
  await mediaState('admin-preview-enabled-empty-media', { audio: 0, image: 0 });

  if (!audioDiagnostic) {
    progress('guest-generation-permission');
    const guestDenied = await other.request('guest-generation-denied', '/api/backend/v1/chat-media/generate', {
      method: 'POST', body: generationBody(other, imageOnly ? 'image' : 'audio'), intent: 'guest-denied',
    });
    assert.equal(guestDenied.status, 403);
    await guestDenied.body?.cancel();
    passed('fresh-other-guest-generation-rejected-403');
  }

  for (const kind of audioDiagnostic ? ['audio'] : imageOnly ? ['image'] : ['audio', 'image']) {
    progress(`single-${kind}-generation`);
    const output = report.outputs[kind] = { requestStartedAt: new Date().toISOString(), sourceHash };
    const label = `${kind}-initial-generation`;
    const response = await owner.request(label, '/api/backend/v1/chat-media/generate', {
      method: 'POST', body: generationBody(owner, kind), intent: 'initial', timeoutMs: 160_000,
    });
    output.responseCompletedAt = new Date().toISOString();
    output.status = response.status;
    if (audioDiagnostic) {
      const errorCode = [200, 201].includes(response.status) ? null : await safeErrorCode(response, label);
      report.diagnostic = { completed: true, status: response.status, errorCode, generated: false };
      output.errorCode = errorCode;
      passed('single-audio-diagnostic-safe-response-captured', { status: response.status, errorCode });
      if (![200, 201].includes(response.status)) break;
    } else {
      if (response.status !== 201) await safeErrorCode(response, label);
      assert.equal(response.status, 201, 'Initial generation returned an unexpected status.');
    }
    const generated = await response.json();
    assert.equal(generated.accountId, owner.id);
    assertAsset(generated.asset, kind);
    initialAssets.set(kind, generated.asset);
    output.mimeType = generated.asset.mimeType;
    await download(kind, generated.asset);
    const expectedUsage = { audio: imageOnly ? 0 : 1, image: kind === 'image' ? 1 : 0 };
    await mediaState(`${kind}-refresh-persisted-asset-and-usage`, expectedUsage);

    progress(`${kind}-confirmed-ready-cache-post`);
    const beforeCache = await accounting();
    // A gateway error can arrive before the backend finishes. Clear the wait
    // only after D1 confirms the exact ready asset and completed reservation.
    unsettledGenerationUntil = 0;
    if (audioDiagnostic) {
      report.diagnostic.generated = true;
      break;
    }
    const cached = await owner.json(`${kind}-cache-post`, '/api/backend/v1/chat-media/generate', {
      method: 'POST', body: generationBody(owner, kind), intent: 'cache',
    });
    assert.equal(cached.accountId, owner.id);
    assert.deepEqual(cached.asset, generated.asset);
    assert.deepEqual(await accounting(), beforeCache, 'A cache POST must preserve the exact asset, processing token and usage rows.');
    await mediaState(`${kind}-cached-refresh-no-additional-usage`, expectedUsage);
    passed(`${kind}-repeat-post-cached-without-new-reservation`, { status: 200, usage: expectedUsage });
  }

  if (audioDiagnostic) {
    report.completed = report.diagnostic?.completed === true;
    progress('single-audio-diagnostic-complete');
  } else {
  progress('private-asset-isolation-and-cross-origin');
  for (const [kind, asset] of initialAssets) {
    const isolated = await other.request(`${kind}-other-account-isolation`, asset.url);
    assert.equal(isolated.status, 404);
    await isolated.body?.cancel();
    passed(`${kind}-private-asset-other-guest-404`);
  }
  const foreignConversation = await other.request('other-conversation-media-isolation', mediaPath);
  assert.equal(foreignConversation.status, 404);
  await foreignConversation.body?.cancel();
  const beforeCrossOrigin = await accounting();
  const crossOriginKind = imageOnly ? 'image' : 'audio';
  const crossOrigin = await owner.request(`cross-origin-ready-${crossOriginKind}-cache-rejected`, '/api/backend/v1/chat-media/generate', {
    method: 'POST', body: generationBody(owner, crossOriginKind), headers: { Origin: 'https://example.invalid', 'Sec-Fetch-Site': 'cross-site' },
    intent: 'cross-origin-cache',
  });
  assert.equal(crossOrigin.status, 403);
  await crossOrigin.body?.cancel();
  assert.deepEqual(await accounting(), beforeCrossOrigin);
  passed('cross-origin-generation-rejected-403-without-new-reservation');
  const expectedGenerations = { audio: imageOnly ? 0 : 1, image: 1 };
  await mediaState(imageOnly ? 'final-refresh-image-one-audio-zero' : 'final-refresh-audio-one-image-one', expectedGenerations);
  assert.deepEqual(generationAttempts, expectedGenerations);
  assert.deepEqual(cacheAttempts, expectedGenerations);
  const ids = accountIdsSql();
  const financialRows = await rows(`SELECT
    (SELECT COUNT(*) FROM payment_orders WHERE user_id IN (${ids})) AS paymentOrders,
    (SELECT COUNT(*) FROM zpay_orders WHERE user_id IN (${ids})) AS zpayOrders,
    (SELECT COUNT(*) FROM subscription_orders WHERE user_id IN (${ids})) AS subscriptionOrders,
    (SELECT COUNT(*) FROM subscription_periods WHERE user_id IN (${ids})) AS vipPeriods,
    (SELECT COUNT(*) FROM subscription_daily_claims WHERE user_id IN (${ids})) AS dailyClaims;`);
  assert.deepEqual(financialRows[0], { paymentOrders: 0, zpayOrders: 0, subscriptionOrders: 0, vipPeriods: 0, dailyClaims: 0 });
  passed('created-accounts-have-zero-payment-orders-vip-periods-and-daily-claims');
  report.verifiedProviderReservations = expectedGenerations;
  report.completed = true;
  progress('checks-complete-awaiting-human-media-review');
  }
} catch (error) {
  // Assertion diagnostics can contain account IDs or response values. Persist
  // only the stage and safe error class, never the raw message or stack.
  report.failure = { stage: report.stage, kind: ['AssertionError', 'TimeoutError', 'AbortError', 'TypeError', 'Error'].includes(error?.name) ? error.name : 'UnknownError' };
  process.exitCode = 1;
} finally {
  try { await cleanup(); }
  catch (error) {
    report.cleanupCompleted = false;
    report.cleanupFailure = { stage: report.stage, kind: error instanceof assert.AssertionError ? 'AssertionError' : 'CleanupError' };
    process.exitCode = 1;
  }
  for (const account of accounts) { account.cookie = ''; account.id = ''; account.previewEmail = ''; }
  initialAssets.clear();
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  report.cleanup.finishedAt = new Date().toISOString();
  report.finishedAt = new Date().toISOString();
  report.automatedChecksPassed = !audioDiagnostic && report.completed && report.cleanupCompleted && !report.failure;
  await mkdir(outputDir, { recursive: true });
  await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath: fileURLToPath(reportUrl), automatedChecksPassed: report.automatedChecksPassed,
    generationAttempts, diagnostic: report.diagnostic, cleanupCompleted: report.cleanupCompleted, humanReview: report.humanReview.status,
    outputs: Object.fromEntries(Object.entries(report.outputs).map(([kind, output]) => [kind, { path: output.path, bytes: output.bytes }])) }));
}
