import test from 'node:test';
import assert from 'node:assert/strict';
import { buildH3Graph, createVideoAdapter } from '../video.mjs';

const scene = { prompt: 'The same adult protagonist enters the archive. Fixed appearance and costume.', duration: 5, seed: 42 };
const env = { SYSTEM_LIFE_COMFY_URL: 'https://gpu.example.test', SYSTEM_LIFE_GPU_SECRET: 'test-secret' };
const goodHealth = {
  ready: true, worker: true, stuck: false, gpu_holder: 'h3', queue: { running: 0, pending: 0 },
  models: Object.fromEntries(Object.entries({
    video_model: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    text_encoder: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    video_vae: 'minimax_h3_video_vae_fp16.safetensors',
    audio_vae: 'minimax_h3_audio_vae_fp32.safetensors',
    video_turbo_lora: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',
  }).map(([key, name]) => [key, { name, available: true }])),
};
const emptyQueue = { queue_running: [], queue_pending: [] };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function fixture(responses) {
  const calls = [];
  const adapter = createVideoAdapter(env, { fetch: async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, 'Unexpected fetch');
    return next;
  } });
  return { adapter, calls };
}

test('official graph preserves prompt and deterministic scene seed, with aligned 5s temporal frames', () => {
  const graph = buildH3Graph(scene);
  assert.equal(graph['7'].inputs.prompt, scene.prompt);
  assert.equal(graph['7'].inputs.length, 124);
  assert.equal(graph['7'].inputs.width, 864);
  assert.equal(graph['7'].inputs.height, 480);
  assert.equal(graph['8'].inputs.noise_seed, 42);
  assert.equal(graph['10'].inputs.steps, 8);
  assert.equal(graph['16'].inputs.filename_prefix, 'system-life/scene');
  assert.equal(graph['7'].inputs.first_frame, undefined);
  assert.deepEqual(buildH3Graph(scene, undefined, 'ref.png')['7'].inputs.first_frame, ['20', 0]);
});

test('offline404 is reported accurately and does not attempt submit or start a GPU service', async () => {
  const { adapter, calls } = fixture([json({}, 404)]);
  const health = await adapter.health();
  assert.equal(health.connected, false);
  assert.equal(health.ready, false);
  assert.match(health.error, /404/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://gpu.example.test/pencil/health');
});

test('missing configuration stays offline without any request', async () => {
  let called = false;
  const adapter = createVideoAdapter({}, { fetch: async () => { called = true; } });
  assert.equal((await adapter.health()).connected, false);
  await assert.rejects(adapter.submit(scene), (error) => error.code === 'video_not_configured');
  assert.equal(called, false);
});

test('experiment video URL overrides the inherited project service address', async () => {
  const calls = [];
  const adapter = createVideoAdapter({ ...env, SYSTEM_VIDEO_URL: 'http://127.0.0.1:6110', DRAMA_COMFY_URL: 'https://old.example.test' }, {
    fetch: async (url) => { calls.push(String(url)); return json(goodHealth); },
  });
  assert.equal((await adapter.health()).ready, true);
  assert.equal(calls[0], 'http://127.0.0.1:6110/pencil/health');
});

test('invalid scenes are rejected before touching the service', async () => {
  const { adapter, calls } = fixture([]);
  await assert.rejects(adapter.submit({ ...scene, seed: -1 }), (error) => error.status === 400);
  assert.throws(() => buildH3Graph({ ...scene, duration: 30 }));
  assert.throws(() => buildH3Graph(scene, '../untrusted.safetensors'));
  assert.equal(calls.length, 0);
});

test('unverified weights are not submitted even if service says ready', async () => {
  const { adapter, calls } = fixture([json({ ready: true })]);
  await assert.rejects(adapter.submit(scene), (error) => error.code === 'models_not_ready');
  assert.equal(calls.length, 1);
});

test('foreign GPU holder and busy queues reject generation without cancel, unload or submit', async () => {
  const owned = fixture([json({ ...goodHealth, gpu_holder: 'ltx' })]);
  await assert.rejects(owned.adapter.submit(scene), (error) => error.status === 409);
  assert.equal(owned.calls.length, 1);
  const queued = fixture([json(goodHealth), json({ ...emptyQueue, queue_pending: [[1, 'other-user-task']] })]);
  await assert.rejects(queued.adapter.submit(scene), (error) => error.status === 409);
  assert.deepEqual(queued.calls.map((call) => new URL(call.url).pathname), ['/pencil/health', '/queue']);
});

test('safe submission uses native prompt and keeps service credentials in request headers', async () => {
  const { adapter, calls } = fixture([json(goodHealth), json(emptyQueue), json({ prompt_id: 'own-task-1' })]);
  const submitted = await adapter.submit(scene);
  assert.equal(submitted.status, 'queued');
  assert.equal(submitted.taskId, 'own-task-1');
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ['/pencil/health', '/queue', '/prompt']);
  assert.ok(calls.every((call) => call.init.headers.get('Authorization') === 'Bearer test-secret'));
  const body = JSON.parse(calls[2].init.body);
  assert.equal(body.prompt['8'].inputs.noise_seed, scene.seed);
  assert.equal(body.client_id, 'system-life-experiment');
  assert.equal(JSON.stringify(submitted).includes('test-secret'), false);
});

test('first-frame upload is wired only to this scene and queue is rechecked after upload', async () => {
  const { adapter, calls } = fixture([json(goodHealth), json(emptyQueue), json({ name: 'ref.png', subfolder: '' }), json(emptyQueue), json({ prompt_id: 'own-task-2' })]);
  const png = 'data:image/png;base64,' + Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
  await adapter.submit(scene, png);
  const upload = calls[2];
  assert.equal(new URL(upload.url).pathname, '/upload/image');
  assert.equal(upload.init.body.get('overwrite'), 'false');
  assert.equal(upload.init.headers.has('Content-Type'), false);
  const graph = JSON.parse(calls[4].init.body).prompt;
  assert.equal(graph['20'].inputs.image, 'ref.png');
  assert.deepEqual(graph['7'].inputs.first_frame, ['20', 0]);
});

test('image validation rejects remote URLs and disguised or malformed data before service requests', async () => {
  const { adapter, calls } = fixture([]);
  for (const image of ['https://remote.example/a.png', 'data:image/png;base64,aGVsbG8=', 'data:image/jpeg;base64,////=']) {
    await assert.rejects(adapter.submit(scene, image), (error) => error.code === 'invalid_image');
  }
  assert.equal(calls.length, 0);
});

test('submission timeout is marked uncertain rather than automatically retried', async () => {
  const timeout = new Error('timed out'); timeout.name = 'TimeoutError';
  const { adapter, calls } = fixture([json(goodHealth), json(emptyQueue), timeout]);
  await assert.rejects(adapter.submit(scene), (error) => error.status === 504 && error.submissionUnknown === true && /重复/.test(error.message));
  assert.equal(calls.length, 3);
});

test('successful submission without a task ID and gateway server errors remain uncertain', async () => {
  for (const response of [json({ number: 1 }), json({}, 502)]) {
    const { adapter, calls } = fixture([json(goodHealth), json(emptyQueue), response]);
    await assert.rejects(adapter.submit(scene), (error) => error.submissionUnknown === true);
    assert.equal(calls.length, 3);
  }
});

test('polling identifies exact pending and running task without posting', async () => {
  const queued = fixture([json({}), json({ queue_running: [], queue_pending: [[1, 'someone-else'], [2, 'own-task']] })]);
  assert.deepEqual(await queued.adapter.status('own-task'), { status: 'queued', taskId: 'own-task', queuePosition: 2 });
  const running = fixture([json({}), json({ queue_running: [[2, 'own-task']], queue_pending: [] })]);
  assert.deepEqual(await running.adapter.status('own-task'), { status: 'running', taskId: 'own-task' });
  assert.ok([...queued.calls, ...running.calls].every((call) => !call.init.method));
});

test('completed MP4 is returned from persisted task history without new inference', async () => {
  const { adapter, calls } = fixture([json({ 'own-task': { status: { completed: true }, outputs: { '16': { videos: [{ filename: 'scene_00001_.mp4', subfolder: 'system-life', type: 'output' }] } } } })]);
  assert.deepEqual(await adapter.status('own-task'), { status: 'completed', taskId: 'own-task', file: { filename: 'scene_00001_.mp4', subfolder: 'system-life', type: 'output' } });
  assert.equal(calls.length, 1);
});

test('missing output and lost task are failed states, while unsafe output paths are rejected', async () => {
  const ended = fixture([json({ 'own-task': { status: { completed: true }, outputs: {} } })]);
  assert.equal((await ended.adapter.status('own-task')).status, 'failed');
  const lost = fixture([json({}), json(emptyQueue)]);
  assert.equal((await lost.adapter.status('own-task')).status, 'failed');
  const unsafe = fixture([json({ 'own-task': { outputs: { '16': { videos: [{ filename: '../secret.mp4', subfolder: 'system-life' }] } } } })]);
  await assert.rejects(unsafe.adapter.status('own-task'), (error) => error.code === 'invalid_media');
});

test('malformed queue entries are rejected before submitting or interpreting task state', async () => {
  const { adapter, calls } = fixture([json(goodHealth), json({ queue_running: [null], queue_pending: [] })]);
  await assert.rejects(adapter.submit(scene), (error) => error.code === 'invalid_queue');
  assert.equal(calls.length, 2);
});

test('media proxy validates path and range and strips unrelated response headers', async () => {
  const { adapter, calls } = fixture([new Response('video-bytes', { status: 206, headers: { 'Content-Type': 'text/html', 'Content-Range': 'bytes 0-10/99', 'Accept-Ranges': 'bytes', 'Set-Cookie': 'private-cookie' } })]);
  const file = { filename: 'scene_00001_.mp4', subfolder: 'system-life', type: 'output' };
  const response = await adapter.media(file, { range: 'bytes=0-10' });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Type'), 'video/mp4');
  assert.equal(response.headers.get('Content-Range'), 'bytes 0-10/99');
  assert.equal(response.headers.has('Set-Cookie'), false);
  assert.equal(calls[0].init.headers.get('Range'), 'bytes=0-10');
  assert.equal(await response.text(), 'video-bytes');
  await assert.rejects(adapter.media({ ...file, subfolder: '../' }));
  await assert.rejects(adapter.media(file, { range: 'bytes=0-10,20-30' }));
  assert.equal(calls.length, 1);
});
