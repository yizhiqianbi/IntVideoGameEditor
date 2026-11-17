import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDzmmPublishingMine, fetchDzmmSubmissions, normalizeDzmmReviewSearch, DzmmPublishingError } from './dzmm-publishing.ts';

const page = { publications: [], total: 0, offset: 0, limit: 20, hasMore: false };
test('existing unfiltered callers remain compatible with a backend without status echo', async () => {
  const original = globalThis.fetch; let url = '';
  globalThis.fetch = (async (input: RequestInfo | URL) => { url = String(input); return Response.json({ ...page, offset: 20 }); }) as typeof fetch;
  try { const value = await fetchDzmmPublishingMine(20); assert.equal(value.offset, 20); assert.equal(url, '/api/backend/v1/publishing/mine?limit=20&offset=20'); }
  finally { globalThis.fetch = original; }
});
test('filtered caller refuses an unfiltered or differently filtered response', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [undefined, 'all', 'rejected']) {
      globalThis.fetch = (async () => Response.json({ ...page, ...(status ? { status } : {}) })) as typeof fetch;
      await assert.rejects(fetchDzmmPublishingMine(0, 'pending'), (error: unknown) => error instanceof DzmmPublishingError && error.status === 502);
    }
    globalThis.fetch = (async (input: RequestInfo | URL) => { const url = new URL(String(input), 'https://example.test'); assert.equal(url.searchParams.get('status'), 'archived'); assert.equal(url.searchParams.get('offset'), '20'); return Response.json({ ...page, offset: 20, status: 'archived' }); }) as typeof fetch;
    assert.equal((await fetchDzmmPublishingMine(20, 'archived')).status, 'archived');
  } finally { globalThis.fetch = original; }
});
test('review search trims a query and keeps it with the status filter', () => {
  assert.equal(normalizeDzmmReviewSearch('  雪梨  '), '雪梨');
  assert.equal(normalizeDzmmReviewSearch('   '), '');
  assert.throws(() => normalizeDzmmReviewSearch('a'.repeat(121)), /搜索词无效/);
  assert.throws(() => normalizeDzmmReviewSearch('bad\nquery'), /搜索词无效/);
  assert.throws(() => normalizeDzmmReviewSearch('bad\0query'), /搜索词无效/);
});
test('review queue request refuses a page that did not apply the search', async () => {
  const original = globalThis.fetch;
  const page = { submissions: [], total: 0, offset: 0, limit: 20, hasMore: false };
  try {
    let url = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      url = String(input);
      return Response.json({ ...page, total: 1, q: '雪梨' });
    }) as typeof fetch;
    assert.equal((await fetchDzmmSubmissions({ status: 'approved', offset: 20, q: '  雪梨  ' })).q, '雪梨');
    const parsed = new URL(url, 'https://example.test');
    assert.equal(parsed.pathname, '/api/backend/v1/publishing/submissions');
    assert.equal(parsed.searchParams.get('status'), 'approved');
    assert.equal(parsed.searchParams.get('q'), '雪梨');
    assert.equal(parsed.searchParams.get('offset'), '20');
    globalThis.fetch = (async () => Response.json(page)) as typeof fetch;
    await assert.rejects(fetchDzmmSubmissions({ status: 'approved', q: '雪梨' }), (error: unknown) => error instanceof DzmmPublishingError && error.status === 502);
    globalThis.fetch = (async () => Response.json({ ...page, q: '别人' })) as typeof fetch;
    await assert.rejects(fetchDzmmSubmissions({ status: 'approved', q: '雪梨' }), (error: unknown) => error instanceof DzmmPublishingError && error.status === 502);
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      assert.equal(new URL(String(input), 'https://example.test').searchParams.get('q'), null);
      return Response.json({ ...page, total: 3 });
    }) as typeof fetch;
    assert.equal((await fetchDzmmSubmissions({ status: 'approved', q: '   ' })).total, 3);
  } finally { globalThis.fetch = original; }
});
test('malformed success responses cannot erase a retained publishing snapshot', async () => {
  const original = globalThis.fetch;
  try {
    for (const value of [null, {}, { ...page, publications: null }, { ...page, total: -1 }, { ...page, offset: '0' }, { ...page, limit: 0 }, { ...page, hasMore: null }]) {
      globalThis.fetch = (async () => Response.json(value)) as typeof fetch;
      await assert.rejects(fetchDzmmPublishingMine(), (error: unknown) => error instanceof DzmmPublishingError && error.status === 502);
    }
  } finally { globalThis.fetch = original; }
});
