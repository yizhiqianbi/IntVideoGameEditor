import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

const MP4_BYTES = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
  0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00,
  0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d,
]);

const dir = await mkdtemp(join(tmpdir(), 'dzmm-gen-tpl-test-'));
const backendOut = join(dir, 'generation-templates.mjs');
const sharedOut = join(dir, 'xumeng-custom-templates.mjs');
const catalogOut = join(dir, 'xumeng-generation-templates.mjs');
const common = {
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['node:*', 'cloudflare:*'],
};
await Promise.all([
  esbuild.build({ ...common, entryPoints: [new URL('../src/generation-templates.ts', import.meta.url).pathname], outfile: backendOut }),
  esbuild.build({ ...common, entryPoints: [new URL('../../../src/lib/xumeng-custom-templates.ts', import.meta.url).pathname], outfile: sharedOut }),
  esbuild.build({ ...common, entryPoints: [new URL('../../../src/lib/xumeng-generation-templates.ts', import.meta.url).pathname], outfile: catalogOut }),
]);
const backend = await import(pathToFileURL(backendOut).href);
const shared = await import(pathToFileURL(sharedOut).href);
const catalog = await import(pathToFileURL(catalogOut).href);

function createMemoryR2() {
  const store = new Map();
  return {
    store,
    async put(key, value, options) {
      const bytes = value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(await value.arrayBuffer());
      store.set(key, { bytes, options });
    },
    async get(key, options) {
      const entry = store.get(key);
      if (!entry) return null;
      const size = entry.bytes.byteLength;
      if (options?.range instanceof Headers) {
        const raw = options.range.get('Range') || '';
        const match = /^bytes=(\d+)-(\d*)$/.exec(raw);
        if (match) {
          const offset = Number(match[1]);
          const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
          const slice = entry.bytes.subarray(offset, end + 1);
          return { size, range: { offset, length: slice.byteLength }, body: slice };
        }
      }
      return { size, body: entry.bytes };
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

test('custom generation templates full D1 + R2 lifecycle & frontend conversion', async (t) => {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: { DB: 'test-db' },
  }));
  t.after(async () => {
    await mf.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  const db = await mf.getD1Database('DB');
  const migrationSql = await readFile(new URL('../migrations/0099_generation_templates.sql', import.meta.url), 'utf8');
  for (const stmt of splitSqlStatements(migrationSql)) {
    await db.prepare(stmt).run();
  }
  const media = createMemoryR2();
  const env = { DB: db, MEDIA: media };
  const adminUser = { id: '00000000-0000-4000-8000-000000000001', role: 'super', isGuest: false };

  // 1. Create custom template
  const createRes = await backend.handleAdminGenerationTemplates(new Request('https://api.test/v1/admin/generation-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'video',
      label: '黑金电影慢推',
      englishLabel: 'Obsidian Cinema Push',
      description: '低照度黑金人像慢镜头推进',
      groupLabel: '后台精选',
      tags: ['黑金', '电影', '慢推'],
      aspectRatio: '9:16',
      promptPattern: '黑金质感电影人像，慢镜头平稳推进。{{keywords}}',
      sortOrder: 10,
      enabled: true,
    }),
  }), env, adminUser);
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()).template;
  assert.match(created.id, /^tpl_[a-z0-9]{6,24}$/);
  assert.equal(created.label, '黑金电影慢推');
  assert.equal(created.demoPosterUrl, null);
  assert.equal(created.demoVideoUrl, null);

  // 2. Reject invalid poster bytes
  await assert.rejects(
    backend.handleAdminGenerationTemplates(new Request(`https://api.test/v1/admin/generation-templates/${created.id}/poster`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array([1, 2, 3, 4]),
    }), env, adminUser),
    /JPG、PNG 或 WebP/,
  );

  // 3. Upload valid PNG poster & MP4 video
  const posterUpload = await backend.handleAdminGenerationTemplates(new Request(`https://api.test/v1/admin/generation-templates/${created.id}/poster`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: PNG_BYTES,
  }), env, adminUser);
  assert.equal(posterUpload.status, 200);
  const withPoster = (await posterUpload.json()).template;
  assert.match(withPoster.demoPosterUrl, new RegExp(`/api/backend/v1/generation-templates/${created.id}/poster\\?v=`));

  const videoUpload = await backend.handleAdminGenerationTemplates(new Request(`https://api.test/v1/admin/generation-templates/${created.id}/video`, {
    method: 'POST',
    headers: { 'Content-Type': 'video/mp4' },
    body: MP4_BYTES,
  }), env, adminUser);
  assert.equal(videoUpload.status, 200);
  const withVideo = (await videoUpload.json()).template;
  assert.match(withVideo.demoVideoUrl, new RegExp(`/api/backend/v1/generation-templates/${created.id}/video\\?v=`));
  assert.equal(media.store.size, 2);

  // 4. Public list & media streaming (including HTTP Range for video)
  const publicListRes = await backend.listPublicGenerationTemplates(env);
  const publicList = (await publicListRes.json()).templates;
  assert.equal(publicList.length, 1);
  assert.equal(publicList[0].id, created.id);

  const posterRes = await backend.publicGenerationTemplateMedia(
    new Request(`https://api.test/v1/generation-templates/${created.id}/poster`),
    env, created.id, 'poster',
  );
  assert.equal(posterRes.status, 200);
  assert.equal(posterRes.headers.get('Content-Type'), 'image/png');

  const rangeRes = await backend.publicGenerationTemplateMedia(
    new Request(`https://api.test/v1/generation-templates/${created.id}/video`, { headers: { Range: 'bytes=0-11' } }),
    env, created.id, 'video',
  );
  assert.equal(rangeRes.status, 206);
  assert.equal(rangeRes.headers.get('Content-Range'), `bytes 0-11/${MP4_BYTES.byteLength}`);

  // 5. Frontend conversion & optional {{keywords}} compilation
  const converted = shared.customTemplateToGenerationTemplate(publicList[0]);
  assert.equal(converted.customTemplate, true);
  assert.equal(converted.customGroup, '后台精选');
  assert.equal(converted.fields.length, 1);
  assert.equal(converted.fields[0].optional, true);
  catalog.registerCustomGenerationTemplates([converted]);
  assert.equal(catalog.getGenerationTemplate(created.id)?.label, '黑金电影慢推');
  assert.equal(catalog.fillGenerationTemplate(converted, { keywords: '' }), '黑金质感电影人像，慢镜头平稳推进。');
  assert.equal(catalog.fillGenerationTemplate(converted, { keywords: '暖金色边缘光' }), '黑金质感电影人像，慢镜头平稳推进。暖金色边缘光');
  catalog.registerCustomGenerationTemplates([]);

  // 6. Disable hides from public list but keeps in admin list
  const disableRes = await backend.handleAdminGenerationTemplates(new Request(`https://api.test/v1/admin/generation-templates/${created.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false }),
  }), env, adminUser);
  assert.equal(disableRes.status, 200);
  assert.equal((await (await backend.listPublicGenerationTemplates(env)).json()).templates.length, 0);
  assert.equal((await (await backend.handleAdminGenerationTemplates(new Request('https://api.test/v1/admin/generation-templates'), env, adminUser)).json()).templates.length, 1);

  // 7. Delete cleans up D1 row & both R2 objects
  const delRes = await backend.handleAdminGenerationTemplates(new Request(`https://api.test/v1/admin/generation-templates/${created.id}/delete`, {
    method: 'POST',
  }), env, adminUser);
  assert.equal(delRes.status, 200);
  assert.equal(media.store.size, 0);
  assert.equal((await (await backend.handleAdminGenerationTemplates(new Request('https://api.test/v1/admin/generation-templates'), env, adminUser)).json()).templates.length, 0);
});
