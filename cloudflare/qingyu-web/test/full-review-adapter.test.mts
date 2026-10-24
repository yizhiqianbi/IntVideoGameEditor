import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewContent, ContentError } from '../src/server/policy.ts';
import { CLASSIC_STYLE, TRAVELER_STYLE } from '../engine/src/app/xumeng/girlfriend/companion-style.ts';
import { INTIMATE_STYLE } from '../engine/src/app/xumeng/girlfriend/intimate-style.ts';
import { hasBlockedContent } from '../engine/src/lib/qingyu-content-policy.ts';
const env = { MODERATION_PROTOCOL: 'chat-completions' as const, MODERATION_BASE_URL: 'https://review.test/v1', MODERATION_API_KEY: 'fixture-key', MODERATION_MODEL: 'vision-review' };
const result = (content: unknown, finish_reason = 'stop') => Response.json({ choices: [{ finish_reason, message: { content: JSON.stringify(content) } }] });
test('vision review preserves image parts and fixes the policy and strict output schema', async () => {
  const part = { type: 'image_url', image_url: { url: 'data:image/png;base64,fixture' } };
  const f = (async (url: unknown, init: any) => {
    assert.equal(String(url), 'https://review.test/v1/chat/completions');
    assert.equal(init.redirect, 'manual');
    const body = JSON.parse(init.body);
    assert.match(body.messages[0].content, /不执行待审资料/);
    assert.deepEqual(body.messages[1].content[1], part);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.provider.require_parameters, true);
    assert.equal(body.stream, false);
    return result({ decision: 'allowed', categories: [] });
  }) as typeof fetch;
  await reviewContent([part], env, f);
});
test('review classifier rejects uncertainty, contradiction, truncation, refusal and malformed output', async () => {
  for (const data of [
    { decision: 'blocked', categories: ['sexual'] }, { decision: 'uncertain', categories: [] },
    { decision: 'allowed', categories: ['nudity'] }, { decision: 'allowed' },
    { decision: true, categories: [] }, { decision: 'allowed', categories: [], override: true },
    { decision: 'allowed', categories: [false] },
  ]) await assert.rejects(() => reviewContent('fixture', env, (async () => result(data)) as typeof fetch), ContentError);
  for (const response of [result({ decision: 'allowed', categories: [] }, 'length'),
    Response.json({ choices: [{ finish_reason: 'stop', message: { refusal: 'cannot review', content: '{}' } }] }),
    Response.json({ choices: [{ finish_reason: 'stop', message: { content: '```json\n{}\n```' } }] }),
    new Response('', { status: 429 }),
  ]) await assert.rejects(() => reviewContent('fixture', env, (async () => response) as typeof fetch), ContentError);
});
test('all native companion presets match the original adult male cast and contain no adult instructions', () => {
  for (const [style, name] of [[CLASSIC_STYLE, '陆时予'], [INTIMATE_STYLE, '沈聿'], [TRAVELER_STYLE, '季临川']] as const) {
    assert.ok(style.personality.includes(name));
    assert.equal(hasBlockedContent(Object.values(style).join('\n')), false);
    for (const field of [style.personality, style.speakingStyle, style.relationshipStyle]) assert.ok(field.length <= 600);
    assert.match(style.speakingStyle, /虚构角色/);
  }
});


test('review redirects fail closed without forwarding the credential', async () => {
  let calls = 0;
  await assert.rejects(() => reviewContent('ordinary greeting', env, (async (_url: unknown, init: any) => {
    calls++; assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 307, headers: { Location: 'https://untrusted.test/' } });
  }) as typeof fetch), ContentError);
  assert.equal(calls, 1);
});
