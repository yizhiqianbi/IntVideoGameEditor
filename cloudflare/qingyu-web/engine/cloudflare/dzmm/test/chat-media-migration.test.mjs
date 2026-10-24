import { splitSqlStatements } from './sql-migrations.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const BASE = Date.parse('2026-10-06T02:00:00Z');
const userId = 'migration-owner', conversationId = 'migration-bookshop', messageId = 'migration-message';
const sourceHash = createHash('sha256').update('窗边的灯光照亮了书店里的旧书。').digest('hex');

async function applySql(DB, sql) {
  const statements = splitSqlStatements(sql).filter(statement => statement.trim());
  await DB.batch(statements.map(statement => DB.prepare(statement)));
}

test('0018 preserves existing media and usage, permits WAV and retains quota after message deletion', async () => {
  const store = new Miniflare(convertV4MiniflareOptions({
    compatibilityDate: '2026-10-01',
    modules: true,
    script: 'export default {fetch(){return new Response("isolated media migration test")}}',
    d1Databases: { DB: 'chat-media-migration-test' },
  }));
  try {
    const DB = await store.getD1Database('DB');
    // Only the schema needed by 0017 is present. The unrelated ledger proves
    // the migration does not rebuild or alter existing application data.
    await applySql(DB, `
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE messages (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL,
        id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        PRIMARY KEY(user_id, conversation_id, id)
      );
      CREATE TABLE test_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        note TEXT NOT NULL
      );
    `);
    await applySql(DB, await readFile(new URL('../migrations/0017_chat_media.sql', import.meta.url), 'utf8'));
    await DB.batch([
      DB.prepare('INSERT INTO users(id) VALUES(?)').bind(userId),
      DB.prepare('INSERT INTO messages(user_id,conversation_id,id,role,content) VALUES(?,?,?,?,?)')
        .bind(userId, conversationId, messageId, 'assistant', '窗边的灯光照亮了书店里的旧书。'),
      DB.prepare(`INSERT INTO chat_media_assets(
        id,user_id,conversation_id,message_id,kind,source_hash,status,processing_token,
        object_key,mime_type,byte_length,audio_text_chars,total_text_chars,created_at,updated_at
      ) VALUES(?,?,?,?,'image',?,'ready',?,?,'image/jpeg',12345,NULL,NULL,?,?)`)
        .bind('legacy-jpeg', userId, conversationId, messageId, sourceHash,
          'legacy-processing-token', 'chat-media/legacy/original.jpeg', BASE, BASE + 850),
      DB.prepare(`INSERT INTO chat_media_usage(
        id,user_id,asset_id,kind,day_key,status,created_at,expires_at
      ) VALUES(?,?,?,'image','2026-10-06','ready',?,?)`)
        .bind('legacy-processing-token', userId, 'legacy-jpeg', BASE, BASE + 120000),
      DB.prepare('INSERT INTO test_ledger(user_id,amount,note) VALUES(?,?,?)')
        .bind(userId, 2800, 'existing credit grant'),
      DB.prepare('INSERT INTO test_ledger(user_id,amount,note) VALUES(?,?,?)')
        .bind(userId, -100, 'existing credit debit'),
    ]);
    const before = {
      assets: (await DB.prepare('SELECT * FROM chat_media_assets ORDER BY id').all()).results,
      usage: (await DB.prepare('SELECT * FROM chat_media_usage ORDER BY id').all()).results,
      columns: (await DB.prepare('PRAGMA table_info(chat_media_assets)').all()).results,
      ledger: (await DB.prepare('SELECT * FROM test_ledger ORDER BY id').all()).results,
      sequence: await DB.prepare("SELECT seq FROM sqlite_sequence WHERE name='test_ledger'").first(),
    };
    assert.equal(before.assets.length, 1);
    assert.equal(before.usage.length, 1);
    await assert.rejects(DB.prepare(`INSERT INTO chat_media_assets(
      id,user_id,conversation_id,message_id,kind,source_hash,status,processing_token,
      object_key,mime_type,byte_length,audio_text_chars,total_text_chars,created_at,updated_at
    ) VALUES(?,?,?,?,'audio',?,'ready',?,?,'audio/wav',244,18,18,?,?)`)
      .bind('wav-before-migration', userId, conversationId, messageId, sourceHash,
        'pre-migration-token', 'chat-media/not-yet-supported.wav', BASE, BASE).run(),
    /CHECK constraint failed/i);

    const migrations = (await readdir(new URL('../migrations/', import.meta.url)))
      .filter(file => /^0018_.+\.sql$/.test(file));
    assert.equal(migrations.length, 1, 'exactly one 0018 WAV migration must be present');
    await applySql(DB, await readFile(new URL(`../migrations/${migrations[0]}`, import.meta.url), 'utf8'));

    // Compare every old column and value, including nullable image fields,
    // the object key, processing token and both timestamps.
    assert.deepEqual((await DB.prepare('SELECT * FROM chat_media_assets ORDER BY id').all()).results, before.assets);
    assert.deepEqual((await DB.prepare('SELECT * FROM chat_media_usage ORDER BY id').all()).results, before.usage);
    assert.deepEqual((await DB.prepare('PRAGMA table_info(chat_media_assets)').all()).results, before.columns);
    assert.deepEqual((await DB.prepare('SELECT * FROM test_ledger ORDER BY id').all()).results, before.ledger);
    assert.deepEqual(await DB.prepare("SELECT seq FROM sqlite_sequence WHERE name='test_ledger'").first(), before.sequence);

    await DB.batch([
      DB.prepare(`INSERT INTO chat_media_assets(
        id,user_id,conversation_id,message_id,kind,source_hash,status,processing_token,
        object_key,mime_type,byte_length,audio_text_chars,total_text_chars,created_at,updated_at
      ) VALUES(?,?,?,?,'audio',?,'ready',?,?,'audio/wav',244,18,18,?,?)`)
        .bind('new-wav', userId, conversationId, messageId, sourceHash,
          'wav-processing-token', 'chat-media/new/audio.wav', BASE + 1000, BASE + 1500),
      DB.prepare(`INSERT INTO chat_media_usage(
        id,user_id,asset_id,kind,day_key,status,created_at,expires_at
      ) VALUES(?,?,?,'audio','2026-10-06','ready',?,?)`)
        .bind('wav-processing-token', userId, 'new-wav', BASE + 1000, BASE + 121000),
    ]);
    const wav = await DB.prepare("SELECT * FROM chat_media_assets WHERE id='new-wav'").first();
    assert.equal(wav.mime_type, 'audio/wav');
    assert.equal(wav.status, 'ready');
    assert.equal(wav.byte_length, 244);
    assert.equal(wav.audio_text_chars, 18);
    assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results, []);

    const usageBeforeDeletion = (await DB.prepare('SELECT * FROM chat_media_usage ORDER BY id').all()).results;
    assert.equal(usageBeforeDeletion.length, 2);
    await DB.prepare('DELETE FROM messages WHERE user_id=? AND conversation_id=? AND id=?')
      .bind(userId, conversationId, messageId).run();
    assert.deepEqual((await DB.prepare('SELECT * FROM chat_media_assets').all()).results, []);
    assert.deepEqual((await DB.prepare('SELECT * FROM chat_media_usage ORDER BY id').all()).results, usageBeforeDeletion);
    assert.deepEqual((await DB.prepare('SELECT * FROM test_ledger ORDER BY id').all()).results, before.ledger);
    assert.deepEqual(await DB.prepare("SELECT seq FROM sqlite_sequence WHERE name='test_ledger'").first(), before.sequence);
    assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally {
    await store.dispose();
  }
});
