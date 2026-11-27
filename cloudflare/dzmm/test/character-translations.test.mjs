import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { splitSqlStatements } from './sql-migrations.mjs';

async function loadDep(name, fallbackRel) {
  try { return await import(name); }
  catch { return await import(new URL(fallbackRel, import.meta.url).href); }
}

const { Miniflare, convertV4MiniflareOptions } = await loadDep('miniflare', '../../dzmm-web/node_modules/miniflare/dist/src/index.js');
const esbuild = await loadDep('esbuild', '../../../node_modules/esbuild/lib/main.js');

async function loadWorkerModules() {
  const dir = await mkdtemp(join(tmpdir(), 'dzmm-translations-test-'));
  const appOut = join(dir, 'app.mjs');
  const trOut = join(dir, 'translations.mjs');
  const common = {
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    external: ['node:*', 'cloudflare:*', '@elevenlabs/elevenlabs-js'],
  };
  await Promise.all([
    esbuild.build({ ...common, entryPoints: [new URL('../src/app.ts', import.meta.url).pathname], outfile: appOut }),
    esbuild.build({ ...common, entryPoints: [new URL('../src/character-translations.ts', import.meta.url).pathname], outfile: trOut }),
  ]);
  const [appMod, trMod] = await Promise.all([
    import(pathToFileURL(appOut).href),
    import(pathToFileURL(trOut).href),
  ]);
  return { appMod, trMod, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const { appMod, trMod, cleanup: cleanupBundles } = await loadWorkerModules();
const { fetchRequest } = appMod;
const {
  detectCharacterSourceLocale,
  ensureCharacterTranslations,
  parseTranslationBatchOutput,
  readCharacterTranslations,
  readSitemapLocalizedTitles,
  targetTranslationLocales,
} = trMod;

async function createMigratedD1() {
  const options = {
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: ['DB'],
  };
  const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
  const db = await mf.getD1Database('DB');
  const migrationsDir = new URL('../migrations/', import.meta.url);
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  assert.ok(files.includes('0097_character_translations.sql'));
  for (const file of files) {
    if (file === '0090_guagua_first_half.sql') continue;
    const sql = await readFile(new URL(file, migrationsDir), 'utf8');
    const stmts = splitSqlStatements(sql).filter((part) => part.trim());
    if (stmts.length) await db.batch(stmts.map((stmt) => db.prepare(stmt)));
  }
  return { mf, db };
}

test('detectCharacterSourceLocale and targetTranslationLocales detect all 5 supported languages', () => {
  assert.equal(detectCharacterSourceLocale({
    name: '沈砚',
    tags: ['都市', '破镜重圆'],
    description: '八年前在雨夜里离开的人，如今重新出现在你的画展上。',
    personality: '',
    scenario: '',
    firstMessage: '',
  }), 'zh-Hans');
  assert.deepEqual(targetTranslationLocales({
    name: '沈砚',
    tags: ['都市'],
    description: '一个关于重逢的都市故事。',
    personality: '',
    scenario: '',
    firstMessage: '',
  }), ['en', 'zh-Hant', 'ja', 'ko']);

  assert.equal(detectCharacterSourceLocale({
    name: 'Caleb Vance',
    tags: ['Mystery', 'Modern'],
    description: 'An investigative archivist who tracks vanished ships along the northern coast.',
    personality: '',
    scenario: '',
    firstMessage: '',
  }), 'en');
  assert.deepEqual(targetTranslationLocales({
    name: 'Caleb Vance',
    tags: ['Mystery'],
    description: 'An investigative archivist along the northern coast.',
    personality: '',
    scenario: '',
    firstMessage: '',
  }), ['zh-Hans', 'zh-Hant', 'ja', 'ko']);

  assert.equal(detectCharacterSourceLocale({
    name: '神崎レン',
    tags: ['現代', 'ミステリー'],
    description: '雨の夜にだけ開く古書店の店主。失われた記憶を探している。',
    personality: '',
    scenario: '',
    firstMessage: '',
  }), 'ja');

  assert.equal(detectCharacterSourceLocale({
    name: '한서진',
    tags: ['현대', '로맨스'],
    description: '오래된 미술관의 큐레이터. 잃어버린 편지를 기다리고 있다.',
    personality: '',
    scenario: '',
    firstMessage: '',
  }), 'ko');

  assert.equal(detectCharacterSourceLocale({
    name: '聽雨樓主',
    tags: ['古風', '懸疑'],
    description: '這是一座只在深夜開門的書閣，記錄著無數說不出口的秘密與過往。',
    personality: '',
    scenario: '',
    firstMessage: '',
  }), 'zh-Hant');
});

test('parseTranslationBatchOutput handles markdown fences, preserves placeholders, and validates tags', () => {
  const source = {
    name: '星河档案馆长',
    tags: ['奇幻', '治愈'],
    description: '守护{{user}}遗忘记忆的星海馆长。',
    personality: '温柔沉静',
    scenario: '深夜档案馆',
    firstMessage: '欢迎回到这里，{{user}}。',
  };
  const raw = '```json\n' + JSON.stringify({
    en: {
      name: 'Starlight Archivist',
      tags: ['Fantasy', 'Healing'],
      description: 'An archivist guarding {{user}}\'s forgotten memories.',
      personality: 'Gentle and calm',
      scenario: 'Late-night archive',
      firstMessage: 'Welcome back, {{user}}.',
    },
    ja: {
      name: '星河の司書',
      tags: ['ファンタジー'],
      description: '{{user}}の忘れられた記憶を守る司書。',
      personality: '穏やか',
      scenario: '深夜の書庫',
      firstMessage: 'おかえりなさい、{{user}}。',
    },
  }) + '\n```';

  const parsed = parseTranslationBatchOutput(raw, source, ['en', 'zh-Hant', 'ja', 'ko']);
  assert.equal(parsed.en?.name, 'Starlight Archivist');
  assert.deepEqual(parsed.en?.tags, ['Fantasy', 'Healing']);
  assert.equal(parsed.en?.firstMessage, 'Welcome back, {{user}}.');
  assert.equal(parsed.ja?.name, '星河の司書');
  assert.equal(parsed.ja?.tags, undefined);
  assert.equal(parsed.ko, undefined);
});

test('submit and approve automatically trigger background silent translation, persist in D1, and expose via catalog and sitemap', async () => {
  const { mf, db } = await createMigratedD1();
  const origin = 'http://127.0.0.1:3010';
  const originalFetch = globalThis.fetch;
  let llmCalls = 0;

  globalThis.fetch = (async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://openrouter.ai/api/v1/chat/completions') {
      llmCalls += 1;
      return Response.json({
        choices: [{
          message: {
            content: JSON.stringify({
              en: {
                name: 'Harbor Archivist',
                tags: ['Original', 'General'],
                description: 'Helps adult travelers organize coastal archives.',
                personality: 'Patient and meticulous',
                scenario: 'A quiet coastal library',
                firstMessage: 'Which sea chart would you like to inspect today?',
              },
              'zh-Hant': {
                name: '海港檔案館員',
                tags: ['原創', '一般向'],
                description: '協助成年旅人整理海港檔案。',
                personality: '耐心細緻',
                scenario: '寧靜的海港圖書館',
                firstMessage: '今天想研究哪張海圖？',
              },
              ja: {
                name: '港の図書館司書',
                tags: ['オリジナル', '一般向け'],
                description: '旅人のために港の古文書を整理する司書。',
                personality: '穏やかで丁寧',
                scenario: '静かな海辺の図書館',
                firstMessage: '今日はどの海図を調べますか？',
              },
              ko: {
                name: '항구 도서관 사서',
                tags: ['오리지널', '일반향'],
                description: '여행자들을 위해 항구 기록을 정리하는 사서.',
                personality: '차분하고 꼼꼼함',
                scenario: '고요한 바닷가 도서관',
                firstMessage: '오늘은 어떤 해도를 살펴볼까요?',
              },
            }),
          },
        }],
      });
    }
    return originalFetch(input, init);
  });

  try {
    const env = {
      DB: db,
      APP_ORIGINS: origin,
      GENERATION_OPENROUTER_API_KEY: 'sk-or-v1-test-key-0123456789abcdef',
    };
    const pendingTasks = [];
    const ctx = { waitUntil(promise) { pendingTasks.push(promise); } };

    const makeUser = async (email, nickname, role = 'user') => {
      const res = await fetchRequest(new Request(`${origin}/v1/auth/register`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'Password123!', nickname }),
      }), env, ctx);
      assert.equal(res.status, 201);
      const cookie = res.headers.get('set-cookie').split(';')[0];
      const data = await res.json();
      if (role === 'super') {
        await db.prepare("UPDATE users SET role = 'super' WHERE id = ?").bind(data.user.id).run();
      }
      return { cookie, user: data.user };
    };

    const creator = await makeUser(`creator-${randomUUID().slice(0, 8)}@example.com`, '创作者甲');
    const reviewer = await makeUser(`super-${randomUUID().slice(0, 8)}@example.com`, '审核员', 'super');

    // 1. Creator submits a Chinese character card -> returns 201 immediately & queues background translation
    const submitRes = await fetchRequest(new Request(`${origin}/v1/publishing/submissions`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: creator.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: creator.user.id,
        character: {
          id: `draft-${randomUUID()}`,
          name: '海港档案馆员',
          description: '帮助成年旅人整理海港档案。',
          personality: '耐心细致',
          scenario: '宁静的海港图书馆',
          firstMessage: '今天想研究哪张海图？',
          cover: '/dzmm/covers/1323657.webp',
          tags: ['原创', '一般向'],
          translations: { en: { name: 'SPOOFED' } },
        },
      }),
    }), env, ctx);
    assert.equal(submitRes.status, 201);
    const submitted = await submitRes.json();
    assert.equal(pendingTasks.length, 1, 'submit must schedule background translation via waitUntil');

    await Promise.all(pendingTasks.splice(0));
    assert.equal(llmCalls, 1);

    const pubId = submitted.publication.id;
    const storedAfterSubmit = await readCharacterTranslations(env, pubId, 1);
    assert.equal(storedAfterSubmit.en?.name, 'Harbor Archivist');
    assert.equal(storedAfterSubmit['zh-Hant']?.name, '海港檔案館員');
    assert.equal(storedAfterSubmit.ja?.name, '港の図書館司書');
    assert.equal(storedAfterSubmit.ko?.name, '항구 도서관 사서');

    // 2. Super approves submission -> waitUntil runs idempotent check with 0 extra LLM calls
    const reviewRes = await fetchRequest(new Request(`${origin}/v1/publishing/submissions/${submitted.submission.id}/review`, {
      method: 'PATCH',
      headers: { Origin: origin, Cookie: reviewer.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: reviewer.user.id,
        version: submitted.publication.version,
        decision: 'approved',
      }),
    }), env, ctx);
    assert.equal(reviewRes.status, 200);
    assert.equal(pendingTasks.length, 1, 'approve must schedule idempotent translation check via waitUntil');
    await Promise.all(pendingTasks.splice(0));
    assert.equal(llmCalls, 1, 'approve must not re-call LLM when submit-time translation already matched source_hash');

    // 3. Public detail API exposes full translations
    const detailRes = await fetchRequest(new Request(`${origin}/v1/publishing/catalog/${pubId}`), env, ctx);
    assert.equal(detailRes.status, 200);
    const detail = await detailRes.json();
    assert.equal(detail.character.translations.en.name, 'Harbor Archivist');
    assert.equal(detail.character.translations.en.firstMessage, 'Which sea chart would you like to inspect today?');
    assert.deepEqual(detail.character.translations.ja.tags, ['オリジナル', '一般向け']);

    // 4. Public catalog card view exposes slim translations (name/tags/description, no firstMessage)
    const listRes = await fetchRequest(new Request(`${origin}/v1/publishing/catalog?view=card&ids=${pubId}`), env, ctx);
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    assert.equal(list.characters.length, 1);
    assert.equal(list.characters[0].translations.en.name, 'Harbor Archivist');
    assert.equal(list.characters[0].translations.en.firstMessage, undefined);

    // 5. Public sitemap API exposes localizedTitles for SEO sitemap sync
    const sitemapRes = await fetchRequest(new Request(`${origin}/v1/publishing/sitemap`), env, ctx);
    assert.equal(sitemapRes.status, 200);
    const sitemap = await sitemapRes.json();
    const entry = sitemap.characters.find((row) => row.id === pubId);
    assert.ok(entry);
    assert.deepEqual(entry.localizedTitles, {
      en: 'Harbor Archivist',
      'zh-Hant': '海港檔案館員',
      ja: '港の図書館司書',
      ko: '항구 도서관 사서',
    });
    const sitemapMap = await readSitemapLocalizedTitles(env);
    assert.equal(sitemapMap.get(pubId)?.ko, '항구 도서관 사서');

    // 6. Workers AI fallback backfills missing locales & Super translate-backfill endpoint works
    await db.prepare("DELETE FROM character_translations WHERE publication_id = ? AND locale IN ('ja', 'ko')").bind(pubId).run();
    let workersAiCalls = 0;
    const fallbackEnv = {
      DB: db,
      APP_ORIGINS: origin,
      AI: {
        async run() {
          workersAiCalls += 1;
          return {
            response: JSON.stringify({
              ja: { name: '港の司書AI', tags: ['オリジナル', '一般向け'], description: '港の記録を守る。', personality: '', scenario: '', firstMessage: '' },
              ko: { name: '항구 사서 AI', tags: ['오리지널', '일반향'], description: '항구 기록을 지킨다.', personality: '', scenario: '', firstMessage: '' },
            }),
          };
        },
      },
    };
    const backfillRes = await fetchRequest(new Request(`${origin}/v1/publishing/translate-backfill`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: reviewer.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: reviewer.user.id, publicationId: pubId }),
    }), fallbackEnv, ctx);
    assert.equal(backfillRes.status, 200);
    const backfill = await backfillRes.json();
    assert.equal(backfill.translated, 1);
    assert.equal(workersAiCalls, 1);
    assert.deepEqual(backfill.results[0].translatedLocales.sort(), ['ja', 'ko']);
    assert.deepEqual(backfill.results[0].existingLocales.sort(), ['en', 'zh-Hant']);

    // Verify direct ensureCharacterTranslations reports up-to-date now
    const upToDate = await ensureCharacterTranslations(fallbackEnv, {
      publicationId: pubId,
      revision: 1,
      character: detail.character,
    });
    assert.equal(upToDate.status, 'up-to-date');
    assert.equal(workersAiCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
    await cleanupBundles();
  }
});
