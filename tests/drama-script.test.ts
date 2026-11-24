import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {scriptConnection, scriptTone, normalizeTone, TONE_OPTIONS} from '../src/lib/drama-script';
test('general genres replace retired presets without breaking old archives', () => {
  assert.equal(normalizeTone(undefined), 'standard');
  for (const retired of ['explicit','sensual','mature']) {
    assert.equal(normalizeTone(retired), 'standard');
    assert.equal(scriptTone(retired), scriptTone('standard'));
  }
  assert.deepEqual(TONE_OPTIONS.map(option=>option.id), ['standard','suspense','comedy']);
  assert.match(scriptTone(undefined), /通用影视/);
  assert.match(scriptTone('suspense'), /悬疑推理/);
  assert.match(scriptTone('comedy'), /轻松喜剧/);
  assert.doesNotMatch(JSON.stringify(TONE_OPTIONS), /NSFW|情欲|裸露|成人向/);
  assert.throws(() => scriptTone('nsfw'), /剧情风格无效/);
});
test('Grok routes browser credentials exclusively to the selected official provider', () => {
  const env = {OPENROUTER_API_KEY:'server-test', OPENROUTER_BASE_URL:'https://proxy.example/v1', OPENROUTER_MODEL:'another-model'};
  const fallback = scriptConnection({}, env);
  assert.equal(fallback.model,'x-ai/grok-4.6');
  assert.equal(fallback.url,'https://proxy.example/v1/chat/completions');
  const c = scriptConnection({scriptKey:'browser-test', scriptModel:'grok-4.3'},env);
  assert.equal(c.url,'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(c.model,'x-ai/grok-4.3');
  assert.equal(c.key,'browser-test');
  const x = scriptConnection({scriptProvider:'xai',scriptModel:'grok-4.6',scriptKey:'xai-test'},env);
  assert.equal(x.model,'grok-4.6'); assert.equal(x.url,'https://api.x.ai/v1/chat/completions');
  assert.throws(() => scriptConnection({scriptProvider:'xai'},env), /API Key/);
  assert.throws(() => scriptConnection({scriptModel:'other'},env), /Grok/);
});
test('Claude and Codex keep their provider IDs and cannot leak keys to xAI', () => {
  for (const model of ['anthropic/claude-sonnet-5.5', 'openai/gpt-5.3-codex']) {
    const c = scriptConnection({scriptModel:model, scriptKey:'test-key'}, {});
    assert.equal(c.model, model);
    assert.equal(c.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.throws(() => scriptConnection({scriptProvider:'xai',scriptModel:model,scriptKey:'test-key'}, {}), /仅支持 Grok/);
  }
});
