import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { splitSqlStatements } from './sql-migrations.mjs';

test('ordinary SQL and transactions remain separate, and empty comments add no statement', () => {
  assert.deepEqual(splitSqlStatements(' -- introductory ;\n BEGIN; SELECT 1; COMMIT; /* trailing ; */'), [
    '-- introductory ;\n BEGIN', 'SELECT 1', 'COMMIT',
  ]);
  assert.deepEqual(splitSqlStatements('; -- only ;\n /* comment ; */ ;'), []);
});

test('quoted separators, escaped quotes, and inline comments preserve every literal byte', () => {
  const statement = 'INSERT INTO "table;name" (`column;name`, [field;name]) VALUES (\'first;it\'\'s\', "quoted;""identifier");';
  const source = statement + ' -- END; BEGIN;\n SELECT \'-- not a comment; /* literal */\'; /* ; CASE END */';
  const result = splitSqlStatements(source);
  assert.equal(result.length, 2);
  assert.equal(result[0], statement.slice(0, -1));
  assert.equal(result[1], "-- END; BEGIN;\n SELECT '-- not a comment; /* literal */'");
});

test('complete triggers retain body semicolons and nested CASE endings', () => {
  const trigger = `CREATE TRIGGER preserve_demo BEFORE UPDATE ON users BEGIN
    SELECT CASE WHEN NEW.is_demo = 1 THEN CASE WHEN NEW.role = 'super' THEN RAISE(ABORT, 'blocked; unchanged') ELSE 1 END ELSE 1 END;
    INSERT INTO audit VALUES ('END; BEGIN; CASE');
  END`;
  assert.deepEqual(splitSqlStatements(`${trigger};\nCREATE INDEX after_trigger ON users(id);`), [trigger, 'CREATE INDEX after_trigger ON users(id)']);
});

test('temporary triggers and comments around BEGIN or END do not split early', () => {
  for (const modifier of ['TEMP', 'TEMPORARY']) {
    const trigger = `create ${modifier} trigger "trigger;END" after insert on records
      /* BEGIN; CASE END; */ begin
      update records set text = 'don\'\'t; break'; -- END;\n
      select case when 1 then 2 end;
      end /* final comment ; */`;
    assert.deepEqual(splitSqlStatements(`${trigger}; SELECT 2`), [trigger, 'SELECT 2']);
  }
});

test('consecutive triggers remain independent and quoted trigger words are inert', () => {
  const first = 'CREATE TRIGGER first AFTER INSERT ON entries BEGIN SELECT 1; END';
  const second = 'CREATE TRIGGER second AFTER DELETE ON entries BEGIN SELECT 2; END';
  assert.deepEqual(splitSqlStatements(`${first}; ${second}; SELECT 'CREATE TRIGGER BEGIN; END';`), [first, second, "SELECT 'CREATE TRIGGER BEGIN; END'"]);
});

test('unfinished quoted input, block comments or trigger bodies fail rather than yielding partial migrations', () => {
  for (const sql of ["SELECT 'broken;", 'SELECT "broken;', 'SELECT `broken;', 'SELECT [broken;', 'SELECT 1; /* broken', 'CREATE TRIGGER broken AFTER INSERT ON records BEGIN SELECT 1;']) {
    assert.throws(() => splitSqlStatements(sql), /unterminated/);
  }
  assert.throws(() => splitSqlStatements(null), TypeError);
});

test('D1 executes split triggers, CASE guards and literal semicolons as one atomic migration batch', async () => {
  const store = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default { fetch() { return new Response("isolated SQL splitter"); } }', d1Databases: { DB: 'sql-splitter-tests' } }));
  try {
    const DB = await store.getD1Database('DB');
    const source = `-- migration header;\n
      CREATE TABLE "records;table" (id INTEGER PRIMARY KEY, text TEXT NOT NULL);
      CREATE TABLE audit (text TEXT);
      CREATE TRIGGER "audit;trigger" AFTER INSERT ON "records;table" BEGIN
        SELECT CASE WHEN NEW.text = 'blocked;entry' THEN RAISE(ABORT, 'guard; blocked') ELSE CASE WHEN NEW.id > 0 THEN 1 ELSE 0 END END;
        INSERT INTO audit(text) VALUES (NEW.text || ';created');
        INSERT INTO audit(text) VALUES ('literal;it''s still one value');
      END;
      INSERT INTO "records;table"(id,text) VALUES (1,'example;value');`;
    await DB.batch(splitSqlStatements(source).map(sql => DB.prepare(sql)));
    assert.deepEqual((await DB.prepare('SELECT text FROM audit ORDER BY rowid').all()).results,
      [{ text: 'example;value;created' }, { text: "literal;it's still one value" }]);
    await assert.rejects(DB.prepare('INSERT INTO "records;table"(id,text) VALUES (?,?)').bind(2, 'blocked;entry').run(), /guard; blocked/);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS count FROM "records;table"').first()).count, 1);
  } finally { await store.dispose(); }
});

test('all repository migrations create the demo trigger guards without losing existing schema', async () => {
  const store = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true,
    script: 'export default { fetch() { return new Response("isolated migration schema"); } }', d1Databases: { DB: 'sql-repository-migrations-tests' } }));
  try {
    const DB = await store.getD1Database('DB');
    const files = (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort();
    assert.ok(files.includes('0029_forum_demo_seed.sql'));
    for (const file of files) {
      const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
      await DB.batch(splitSqlStatements(sql).map(statement => DB.prepare(statement)));
    }
    const triggers = (await DB.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'forum_demo_%'").all()).results.map(item => item.name);
    for (const name of ['forum_demo_batch_expand', 'forum_demo_batch_remove', 'forum_demo_deny_sessions_insert', 'forum_demo_deny_forum_votes_update']) assert.ok(triggers.includes(name), name);
    await DB.prepare("INSERT INTO users(id,email,nickname,is_guest,created_at) VALUES('ordinary-migration-user','ordinary@example.test','普通用户',0,1)").run();
    assert.deepEqual(await DB.prepare("SELECT nickname,is_demo,demo_batch_id FROM users WHERE id='ordinary-migration-user'").first(),
      { nickname: '普通用户', is_demo: 0, demo_batch_id: null });
  } finally { await store.dispose(); }
});
