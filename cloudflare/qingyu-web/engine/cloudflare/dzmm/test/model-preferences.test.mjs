import { splitSqlStatements } from './sql-migrations.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';
const { readState } = await tsImport('../src/data.ts', import.meta.url);
const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);
const cookies = new Map();
const { DZMM_INITIAL_STATE } = await tsImport('../../../src/lib/dzmm-storage.ts', import.meta.url);
const { DZMM_MODEL_OPTIONS } = await tsImport('../../../src/lib/dzmm-models.ts', import.meta.url);
const files = (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort();
async function migrate(DB, migrations) {
  for (const file of migrations) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await DB.batch(splitSqlStatements(sql).filter(statement => statement.trim()).map(statement => DB.prepare(statement)));
  }
}
async function account(DB, nickname) {
  const user = { id: randomUUID(), email: `${randomUUID()}@models.example.test`, nickname, isGuest: false, role: 'user', version: 0 };
  await DB.prepare('INSERT INTO users(id,email,nickname,is_guest,created_at) VALUES(?,?,?,0,?)').bind(user.id, user.email, nickname, Date.now()).run();
  const token=randomBytes(32).toString('hex'); cookies.set(user.id,`qingyu_session=${token}`);
  await DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(createHash('sha256').update(token).digest('hex'),user.id,Date.now()+3600000,Date.now()).run();
  return user;
}

test('model migration preserves every old preference byte and permits authenticated HTTP save/reload of six choices and legacy modes', async () => {
  const store = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default {fetch(){return new Response("isolated model preferences")}}', d1Databases: { DB: 'model-preferences' } }));
  try {
    const DB = await store.getD1Database('DB');
    await migrate(DB, files.filter(file => file < '0025_preferences_models.sql'));
    const owners = [];
    for (const model of ['fast', 'balanced', 'story']) {
      const owner = await account(DB, `原有账号-${model}`); owners.push(owner);
      const extras = `{"bio":"原创作者 ${model}","presets":[{"id":"old","name":"旧预设","content":"保留原文"}],"maxTokens":2048,"unknown_future":"原样保留 🗺️"}`;
      await DB.prepare('INSERT INTO preferences(user_id,nickname,persona,preset,model,dark,extra_json) VALUES(?,?,?,?,?,1,?)')
        .bind(owner.id, owner.nickname, '保留玩家资料', '保留旧角色预设', model, extras).run();
    }
    const before = (await DB.prepare('SELECT * FROM preferences ORDER BY user_id').all()).results;
    await migrate(DB, files.filter(file => file >= '0025_preferences_models.sql'));
    assert.deepEqual((await DB.prepare('SELECT * FROM preferences ORDER BY user_id').all()).results, before);
    const untouchedId = owners[1].id, untouched = before.find(row => row.user_id === untouchedId);
    for (const owner of [owners[0], await account(DB, '全新模型账号')]) {
      let loaded = await readState(DB, owner);
      if (owner.id !== owners[0].id) assert.equal(loaded.state.preferences.model, 'qwen');
      for (const model of [...DZMM_MODEL_OPTIONS.map(option => option.id), 'fast', 'balanced', 'story']) {
        const response = await fetchRequest(new Request('https://models.example.test/v1/preferences', { method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Origin:'https://models.example.test', Cookie:cookies.get(owner.id) }, body: JSON.stringify({ preferences: { model, nickname: `选择-${model}` }, version: loaded.version }) }), { DB, APP_ORIGINS:'https://models.example.test' });
        assert.equal(response.status, 200); loaded = await response.json(); assert.equal(loaded.state.preferences.model, model);
        assert.equal((await readState(DB, owner)).state.preferences.model, model);
        assert.equal((await DB.prepare('SELECT model FROM preferences WHERE user_id=?').bind(owner.id).first()).model, model);
      }
      const next = structuredClone(DZMM_INITIAL_STATE); next.preferences.nickname = owner.nickname;
      const saved = await fetchRequest(new Request('https://models.example.test/v1/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin:'https://models.example.test', Cookie:cookies.get(owner.id) },
        body: JSON.stringify({ accountId: owner.id, version: loaded.version, state: next }) }), { DB, APP_ORIGINS:'https://models.example.test' });
      assert.equal(saved.status, 200); assert.equal((await saved.json()).state.preferences.model, 'qwen');
    }
    assert.deepEqual(await DB.prepare('SELECT * FROM preferences WHERE user_id=?').bind(untouchedId).first(), untouched);
    await assert.rejects(DB.prepare('UPDATE preferences SET model=? WHERE user_id=?').bind('untrusted/arbitrary-model', owners[0].id).run());
    // The rebuilt table retains its account cascade and does not affect others.
    await DB.prepare('DELETE FROM users WHERE id=?').bind(owners[2].id).run();
    assert.equal(await DB.prepare('SELECT user_id FROM preferences WHERE user_id=?').bind(owners[2].id).first(), null);
    assert.deepEqual(await DB.prepare('SELECT * FROM preferences WHERE user_id=?').bind(untouchedId).first(), untouched);
  } finally { await store.dispose(); }
});
