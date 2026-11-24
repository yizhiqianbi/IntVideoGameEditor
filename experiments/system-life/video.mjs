import { randomUUID } from 'node:crypto';

const MODEL = 'minimax_h3_fl2va_pruned_int8_convrot.safetensors';
const LORA = 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors';
const ENCODER = 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors';
const VIDEO_VAE = 'minimax_h3_video_vae_fp16.safetensors';
const AUDIO_VAE = 'minimax_h3_audio_vae_fp32.safetensors';
const LABEL = 'MiniMax H3 · 自部署 · 480P';
const IMAGE_LIMIT = 8 * 1024 * 1024;

function failure(message, status = 503, code = 'video_unavailable') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateScene(scene) {
  if (!record(scene) || typeof scene.prompt !== 'string' || !scene.prompt.trim()
      || scene.prompt.length > 12000 || !Number.isSafeInteger(scene.seed)
      || scene.seed < 0 || scene.seed > 2 ** 48 - 1 || scene.duration !== 5) {
    throw failure('镜头需包含有效描述、固定种子及 5 秒时长。', 400, 'invalid_scene');
  }
}

/** Independent, official H3 graph; scene seed makes prompt construction reproducible. */
export function buildH3Graph(scene, modelName = MODEL, firstFrame) {
  validateScene(scene);
  if (modelName !== MODEL) throw failure('实验只使用已核验的官方 H3 权重。', 503, 'unknown_model');
  if (firstFrame !== undefined && !/^[\w-]+\.(png|jpg|jpeg|webp)$/.test(firstFrame)) {
    throw failure('首帧上传返回了无效文件名。', 502, 'invalid_upload');
  }
  const node = (class_type, inputs) => ({ class_type, inputs });
  const graph = {
    '1': node('UNETLoader', { unet_name: MODEL, weight_dtype: 'default' }),
    '2': node('CLIPLoader', { clip_name: ENCODER, type: 'minimax', device: 'default' }),
    '3': node('VAELoader', { vae_name: VIDEO_VAE }),
    '4': node('VAELoader', { vae_name: AUDIO_VAE }),
    '5': node('LoraLoaderModelOnly', { model: ['1', 0], lora_name: LORA, strength_model: 1 }),
    '7': node('MiniMaxH3ImageToVideo', {
      clip: ['2', 0], vae: ['3', 0], prompt: scene.prompt, width: 864, height: 480,
      // Official H3 groups time into 17-frame windows: a 5s request renders 124 frames.
      length: Math.ceil((scene.duration * 24 - 5) / 17) * 17 + 5,
      ...(firstFrame ? { first_frame: ['20', 0] } : {}),
    }),
    '8': node('RandomNoise', { noise_seed: scene.seed }),
    '9': node('KSamplerSelect', { sampler_name: 'euler' }),
    '10': node('BasicScheduler', { model: ['5', 0], scheduler: 'beta', steps: 8, denoise: 1 }),
    '11': node('BasicGuider', { model: ['5', 0], conditioning: ['7', 0] }),
    '12': node('SamplerCustomAdvanced', {
      noise: ['8', 0], guider: ['11', 0], sampler: ['9', 0], sigmas: ['10', 0], latent_image: ['7', 1],
    }),
    '13': node('VAEDecode', { samples: ['12', 0], vae: ['3', 0] }),
    '14': node('VAEDecodeAudio', { samples: ['12', 0], vae: ['4', 0] }),
    '15': node('CreateVideo', { images: ['13', 0], audio: ['14', 0], fps: 24, bit_depth: 8 }),
    '16': node('SaveVideo', { video: ['15', 0], filename_prefix: 'system-life/scene', format: 'mp4', codec: 'h264' }),
  };
  if (firstFrame) graph['20'] = node('LoadImage', { image: firstFrame });
  return graph;
}

function validateImage(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > Math.ceil(IMAGE_LIMIT * 4 / 3) + 100) {
    throw failure('首帧图片需为小于 8MB 的 PNG、JPEG 或 WebP。', 400, 'invalid_image');
  }
  const match = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[3].length % 4 !== 0) {
    throw failure('首帧只接受本地 PNG、JPEG 或 WebP 图片。', 400, 'invalid_image');
  }
  const bytes = Buffer.from(match[3], 'base64');
  if (!bytes.length || bytes.length > IMAGE_LIMIT || bytes.toString('base64') !== match[3]) {
    throw failure('首帧图片编码无效或超过 8MB。', 400, 'invalid_image');
  }
  const validSignature = match[2] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : match[2] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!validSignature) throw failure('首帧图片格式与实际内容不符。', 400, 'invalid_image');
  return { bytes, mime: match[1], extension: match[2] === 'jpeg' ? 'jpg' : match[2] };
}

function validateTaskId(taskId) {
  if (typeof taskId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(taskId)) {
    throw failure('视频任务编号无效。', 400, 'invalid_task');
  }
}

function validateFile(file) {
  if (!record(file) || typeof file.filename !== 'string' || file.filename.length > 200
      || !/^[\w.-]+\.mp4$/i.test(file.filename) || file.filename.includes('..')
      || typeof file.subfolder !== 'string' || !/^system-life(?:\/[\w-]+)*$/.test(file.subfolder)
      || file.subfolder.length > 200 || (file.type !== undefined && file.type !== 'output')) {
    throw failure('视频文件路径无效。', 400, 'invalid_media');
  }
  return { filename: file.filename, subfolder: file.subfolder, type: 'output' };
}

function modelsReady(data) {
  const required = { video_model: MODEL, text_encoder: ENCODER, video_vae: VIDEO_VAE, audio_vae: AUDIO_VAE, video_turbo_lora: LORA };
  return data.ready === true && record(data.models)
    && Object.entries(required).every(([key, name]) => data.models[key]?.available === true && data.models[key]?.name === name);
}

function queueBusy(queue) {
  if (!record(queue) || !Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) {
    throw failure('GPU 队列状态无法确认，请稍后重试。', 503, 'invalid_queue');
  }
  if ([...queue.queue_running, ...queue.queue_pending].some((entry) => !Array.isArray(entry) || typeof entry[1] !== 'string')) {
    throw failure('GPU 队列状态无法确认，请稍后重试。', 503, 'invalid_queue');
  }
  return queue.queue_running.length > 0 || queue.queue_pending.length > 0;
}

/** No GPU boot, cancel, release, unload or bridge calls. All credentials stay server-side. */
export function createVideoAdapter(env = {}, options = {}) {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 20000;
  const secret = (env.SYSTEM_LIFE_GPU_SECRET || env.FRAMECRAFT_GPU_SERVICE_SECRET || '').trim();
  const configuredBase = env.SYSTEM_VIDEO_URL || env.SYSTEM_LIFE_COMFY_URL || env.FRAMECRAFT_GPU_BASE_URL || env.DRAMA_COMFY_URL;
  let base;
  let configError;
  try {
    if (!configuredBase) throw new Error();
    base = new URL(configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`);
    if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash || /[\r\n]/.test(secret)) throw new Error();
  } catch {
    configError = failure('尚未配置有效的 H3 服务地址，可先导入视频。', 503, 'video_not_configured');
  }

  async function request(path, init = {}) {
    if (configError) throw configError;
    const headers = new Headers(init.headers);
    if (secret) headers.set('Authorization', `Bearer ${secret}`);
    if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
    try {
      return await fetchFn(new URL(path, base), { ...init, headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw failure(timeout ? 'H3 服务响应超时，请稍后检查任务状态。' : '无法连接 H3 服务，可先导入视频。', timeout ? 504 : 503, timeout ? 'video_timeout' : 'video_network');
    }
  }

  async function json(path, init) {
    const response = await request(path, init);
    if (!response.ok) {
      throw failure(response.status === 404 ? 'H3 接口返回 404，当前地址不可用，可先导入视频。' : `H3 服务返回 HTTP ${response.status}。`, 503, `gpu_http_${response.status}`);
    }
    let data;
    try {
      const text = await response.text();
      if (text.length > 2 * 1024 * 1024) throw new Error();
      data = JSON.parse(text);
    } catch { throw failure('H3 服务返回了无效响应。', 502, 'invalid_response'); }
    if (!record(data) || data.error) throw failure('H3 服务未接受该请求，请检查 GPU 状态。', 502, 'gpu_error');
    return data;
  }

  async function healthData() {
    const data = await json('pencil/health');
    if (data.worker === false || data.stuck === true) throw failure('H3 推理进程尚未就绪。');
    return data;
  }

  return {
    async health() {
      try {
        const data = await healthData();
        const ready = modelsReady(data);
        const busy = (data.queue?.running ?? 0) > 0 || (data.queue?.pending ?? 0) > 0;
        return { connected: true, ready, model: LABEL, busy, ...(!ready ? { error: 'GPU 已连接，但尚未核验官方 H3 所需权重。' } : {}) };
      } catch (error) { return { connected: false, ready: false, model: LABEL, error: error.message }; }
    },

    async submit(scene, referenceImage) {
      validateScene(scene);
      const image = validateImage(referenceImage);
      const health = await healthData();
      if (!modelsReady(health)) throw failure('GPU 权重尚未核验，未提交生成。', 503, 'models_not_ready');
      if (health.gpu_holder !== undefined && health.gpu_holder !== null && health.gpu_holder !== 'h3') {
        throw failure('GPU 正在供其他模型使用，请稍后生成或导入视频。', 409, 'gpu_busy');
      }
      if ((health.queue?.running ?? 0) > 0 || (health.queue?.pending ?? 0) > 0
          || queueBusy(await json('queue'))) {
        throw failure('GPU 已有任务，本次未提交，请稍后再试。', 409, 'gpu_busy');
      }
      let filename;
      if (image) {
        const form = new FormData();
        form.set('image', new Blob([image.bytes], { type: image.mime }), `system-life-${randomUUID()}.${image.extension}`);
        form.set('type', 'input');
        form.set('overwrite', 'false');
        const uploaded = await json('upload/image', { method: 'POST', body: form });
        if (uploaded.subfolder || !/^[\w-]+\.(png|jpg|jpeg|webp)$/.test(uploaded.name)) {
          throw failure('首帧上传返回了无效文件路径。', 502, 'invalid_upload');
        }
        filename = uploaded.name;
        // Recheck after upload; native submission queues safely without interrupting existing jobs.
        if (queueBusy(await json('queue'))) throw failure('GPU 已有新任务，本次未提交。', 409, 'gpu_busy');
      }
      let created;
      try {
        created = await json('prompt', { method: 'POST', body: JSON.stringify({ prompt: buildH3Graph(scene, MODEL, filename), client_id: 'system-life-experiment' }) });
      } catch (error) {
        if (error.code === 'video_timeout' || error.code === 'video_network' || error.code === 'invalid_response'
            || /^gpu_http_5\d\d$/.test(error.code ?? '')) {
          error.submissionUnknown = true;
          error.message = '提交结果尚未确认，GPU 可能已接收任务。请检查 GPU 历史后再重试，避免重复生成。';
        }
        throw error;
      }
      try { validateTaskId(created.prompt_id); }
      catch {
        const error = failure('提交响应缺少任务编号，GPU 可能已接收。请检查 GPU 历史后再重试。', 502, 'invalid_submission');
        error.submissionUnknown = true;
        throw error;
      }
      return { status: 'queued', taskId: created.prompt_id, model: LABEL };
    },

    async status(taskId) {
      validateTaskId(taskId);
      const history = await json(`history/${taskId}`);
      const item = history[taskId];
      if (record(item)) {
        if (item.status?.status_str === 'error') return { status: 'failed', taskId, error: 'H3 推理失败，可检查 GPU 日志或导入视频。' };
        for (const output of Object.values(item.outputs ?? {})) {
          if (!record(output)) continue;
          for (const entries of Object.values(output)) {
            if (!Array.isArray(entries)) continue;
            for (const entry of entries) {
              if (!record(entry) || !/\.mp4$/i.test(entry.filename ?? '')) continue;
              const file = validateFile({ ...entry, subfolder: entry.subfolder ?? '' });
              return { status: 'completed', taskId, file };
            }
          }
        }
        if (item.status?.completed) return { status: 'failed', taskId, error: 'H3 已结束，但未返回 MP4 视频。' };
      }
      const queue = await json('queue');
      queueBusy(queue);
      if (queue.queue_running.some((entry) => entry[1] === taskId)) return { status: 'running', taskId };
      const index = queue.queue_pending.findIndex((entry) => entry[1] === taskId);
      if (index >= 0) return { status: 'queued', taskId, queuePosition: index + 1 };
      return { status: 'failed', taskId, error: 'GPU 中未找到此任务，服务可能已重启。' };
    },

    async media(file, { range } = {}) {
      const normalized = validateFile(file);
      if (range !== undefined && (typeof range !== 'string' || !/^bytes=(?:\d+-\d*|-\d+)$/.test(range))) {
        throw failure('视频范围请求无效。', 400, 'invalid_range');
      }
      const response = await request(`view?${new URLSearchParams(normalized)}`, { headers: range ? { Range: range } : {} });
      if (response.status !== 200 && response.status !== 206 && response.status !== 416) throw failure('H3 视频文件暂时无法读取。', 502, 'media_unavailable');
      const headers = new Headers();
      for (const name of ['content-length', 'content-range', 'accept-ranges']) {
        const value = response.headers.get(name);
        if (value) headers.set(name, value);
      }
      headers.set('Content-Type', 'video/mp4');
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, { status: response.status, headers });
    },
  };
}
