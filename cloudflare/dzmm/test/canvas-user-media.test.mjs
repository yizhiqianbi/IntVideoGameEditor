import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';

const { handleCanvasUserMedia } = await tsImport('../src/canvas-user-media.ts', import.meta.url);
const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

let store;
let DB;

before(async () => {
  store = new Miniflare(
    convertV4MiniflareOptions({
      compatibilityDate: '2026-10-01',
      modules: true,
      script: 'export default {fetch(){return new Response("canvas media")}}',
      d1Databases: { DB: 'canvas-user-media' },
    }),
  );
  DB = await store.getD1Database('DB');
  for (const file of (await readdir(new URL('../migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await DB.batch(splitSqlStatements(sql).filter((statement) => statement.trim()).map((statement) => DB.prepare(statement)));
  }
});

after(async () => {
  await store?.dispose();
});

async function user(guest = false) {
  const id = randomUUID();
  const now = Date.now();
  await DB.prepare(
    "INSERT INTO users(id,nickname,is_guest,role,created_at) VALUES(?,? ,?,'user',?)",
  ).bind(id, guest ? '游客' : '素材用户', Number(guest), now).run();
  return { id, email: null, nickname: guest ? '游客' : '素材用户', isGuest: guest, role: 'user', version: 0 };
}

function request(path, { method = 'GET', body } = {}) {
  return new Request(`https://xumengchat.top${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json', Origin: 'https://xumengchat.top' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function call(account, path, options) {
  const incoming = request(path, options);
  try {
    const response = await handleCanvasUserMedia(incoming, { DB }, account);
    assert.ok(response);
    return { status: response.status, data: await response.json() };
  } catch (error) {
    if (!error.status) throw error;
    return { status: error.status, data: { error: error.message } };
  }
}

function row(id, hash, extra = {}) {
  return {
    id,
    kind: 'image',
    source: 'upload',
    name: '雨后窗边',
    mimeType: 'image/png',
    byteLength: 1200,
    contentHash: hash,
    ...extra,
  };
}

test('keeps uploads, references and generated media on the account that created them', async () => {
  const owner = await user();
  const other = await user();
  const firstId = randomUUID();
  const created = await call(owner, '/v1/canvas/media', { method: 'POST', body: row(firstId, HASH) });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.reused, false);
  assert.equal(created.data.media.id, firstId);
  assert.equal(created.data.media.name, '雨后窗边');
  assert.equal(created.data.media.contentHash, undefined);

  const duplicate = await call(owner, '/v1/canvas/media', {
    method: 'POST',
    body: row(randomUUID(), HASH, { name: '同一张图' }),
  });
  assert.equal(duplicate.status, 200, JSON.stringify(duplicate.data));
  assert.equal(duplicate.data.reused, true);
  assert.equal(duplicate.data.media.id, firstId);

  const generated = await call(owner, '/v1/canvas/media', {
    method: 'POST',
    body: row(randomUUID(), OTHER_HASH, { source: 'generation', kind: 'video', mimeType: 'video/mp4', name: '   ' }),
  });
  assert.equal(generated.status, 201, JSON.stringify(generated.data));
  assert.equal(generated.data.media.name, '生成的视频');
  assert.equal(generated.data.media.source, 'generation');

  const reference = await call(owner, '/v1/canvas/media', {
    method: 'POST',
    body: row(randomUUID(), 'c'.repeat(64), { source: 'reference', kind: 'audio', mimeType: 'audio/mpeg', name: '' }),
  });
  assert.equal(reference.status, 201);
  assert.equal(reference.data.media.name, '参考音频');

  const list = await call(owner, '/v1/canvas/media');
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.items.map((item) => item.id), [reference.data.media.id, generated.data.media.id, firstId]);
  assert.equal((await call(other, '/v1/canvas/media')).data.items.length, 0);

  const hidden = await call(other, `/v1/canvas/media/${firstId}`, { method: 'DELETE' });
  assert.equal(hidden.status, 404);
  const removed = await call(owner, `/v1/canvas/media/${firstId}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.deleted, true);
  assert.equal((await call(owner, '/v1/canvas/media')).data.items.some((item) => item.id === firstId), false);

  assert.equal((await call(await user(true), '/v1/canvas/media', { method: 'POST', body: row(randomUUID(), 'd'.repeat(64)) })).status, 401);
  assert.equal((await call(owner, '/v1/canvas/media', { method: 'POST', body: row(randomUUID(), HASH, { mimeType: 'image/gif' }) })).status, 400);
  assert.equal((await call(owner, '/v1/canvas/media', { method: 'POST', body: row(randomUUID(), 'e'.repeat(64), { byteLength: 80_000_001 }) })).status, 400);
  assert.equal((await call(owner, '/v1/canvas/media', { method: 'POST', body: row('not-a-uuid', 'f'.repeat(64)) })).status, 400);
  assert.equal(await handleCanvasUserMedia(request('/v1/session'), { DB }, owner), null);
});
