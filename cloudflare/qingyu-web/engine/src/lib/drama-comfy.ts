import { isDramaTimeoutError } from "./drama-api";
import { h3FrameCount, parseShotDuration, validateGpuModel } from "./drama-models";
import { buildDramaInput, type DramaMode } from "./drama";
import { validateReferenceMedia } from "./drama-reference-media";
import {
  directorOutputSeconds,
  directorPrompt,
  isDirectorEnabled,
  toTimelineData,
  validateTimelineDirector,
} from "./drama-timeline";
export const COMFY_BASE =
  process.env.DRAMA_COMFY_URL || "http://127.0.0.1:6106";
export const H3_EROS_MAX_UNET =
  "10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors";
export const H3_FL2V_TURBO_LORA =
  "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors";
export const H3_REF2V_TURBO_LORA =
  "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors";
type Graph = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;
export function h3UnetFromHealth(health: {
  models?: Record<string, { name?: string; available?: boolean }>;
}, mode: DramaMode = "t2v") {
  if (health.models?.eros_max_turbo_hybrid_int8?.available) return H3_EROS_MAX_UNET;
  const key = mode === "ri2v" ? "reference_model" : "video_model";
  const name = health.models?.[key]?.name;
  return name && health.models?.[key]?.available ? name : H3_EROS_MAX_UNET;
}

function h3TurboBakedIn(unetName: string) {
  return unetName.includes("TURBO-hybrid");
}

function turboLoraFor(unetName: string, mode: DramaMode | "director") {
  if (unetName.includes("minimax_h3_fl2va")) return H3_FL2V_TURBO_LORA;
  if (unetName.includes("minimax_h3_ref2va")) return H3_REF2V_TURBO_LORA;
  return mode === "ri2v" || mode === "director"
    ? "pencil_h3_ref2va_turbo_curve.safetensors"
    : "pencil_h3_fl2va_turbo_curve.safetensors";
}

export function buildComfyGraph(
  mode: DramaMode,
  prompt: string,
  ratio: string,
  images: string[] = [],
  seed = 1,
  duration = 15,
  media: { kind: "video" | "audio"; file: string }[] = [],
  unetName = H3_EROS_MAX_UNET,
): Graph {
  const seconds = parseShotDuration(duration);
  const [width, height] =
    ratio === "16:9" ? [864, 480] : ratio === "1:1" ? [480, 480] : [480, 864];
  const bakedTurbo = h3TurboBakedIn(unetName);
  const graph: Graph = {
    "1": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: unetName,
        weight_dtype: "default",
      },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
        type: "minimax",
        device: "default",
      },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" },
    },
    "4": {
      class_type: "VAELoader",
      inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" },
    },
    ...(bakedTurbo
      ? {}
      : {
          "5": {
            class_type: "LoraLoaderModelOnly",
            inputs: {
              model: ["1", 0],
              lora_name: turboLoraFor(unetName, mode),
              strength_model: 1,
            },
          },
        }),
    "6": {
      class_type: "PathchSageAttentionKJ",
      inputs: {
        model: bakedTurbo ? ["1", 0] : ["5", 0],
        sage_attention: "auto",
        allow_compile: false,
      },
    },
    "7": {
      class_type:
        mode === "ri2v" ? "MiniMaxH3ReferenceToVideo" : "MiniMaxH3ImageToVideo",
      inputs: {
        clip: ["2", 0],
        vae: ["3", 0],
        prompt:
          mode === "ri2v"
            ? prompt.replace(/Image\s*(\d+)/gi, "<Picture $1>").replace(/(?<!<)Video\s*(\d+)/gi, "<Video $1>").replace(/(?<!<)Audio\s*(\d+)/gi, "<Audio $1>")
            : prompt,
        width,
        height,
        length: h3FrameCount(seconds),
      },
    },
    "8": { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    "9": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "10": {
      class_type: "BasicScheduler",
      inputs: { model: ["6", 0], scheduler: "beta", steps: 8, denoise: 1 },
    },
    "11": {
      class_type: "BasicGuider",
      inputs: { model: ["6", 0], conditioning: ["7", 0] },
    },
    "12": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["8", 0],
        guider: ["11", 0],
        sampler: ["9", 0],
        sigmas: ["10", 0],
        latent_image: ["7", 1],
      },
    },
    "13": {
      class_type: "VAEDecode",
      inputs: { samples: ["12", 0], vae: ["3", 0] },
    },
    "14": {
      class_type: "VAEDecodeAudio",
      inputs: { samples: ["12", 0], vae: ["4", 0] },
    },
    "15": {
      class_type: "CreateVideo",
      inputs: { images: ["13", 0], audio: ["14", 0], fps: 24, bit_depth: 8 },
    },
    "16": {
      class_type: "SaveVideo",
      inputs: {
        video: ["15", 0],
        filename_prefix: "pencil/drama",
        format: "mp4",
        codec: "h264",
      },
    },
  };
  images.forEach((image, i) => {
    graph[String(20 + i)] = { class_type: "LoadImage", inputs: { image } };
  });
  if (mode === "i2v") {
    graph["7"].inputs.first_frame = ["20", 0];
    if (images[1]) graph["7"].inputs.last_frame = ["21", 0];
  }
  if (mode === "ri2v") {
    graph["7"].inputs.audio_vae = ["4", 0];
    graph["7"].inputs.ref_image_size = "match";
    images.forEach((_, i) => {
      graph["7"].inputs[`ref_images.ref_image_${i}`] = [String(20 + i), 0];
    });
    for (const kind of ["video", "audio"] as const) {
      media.filter(m => m.kind === kind).forEach((m, i) => {
        const id = String((kind === "video" ? 60 : 70) + i);
        graph[id] = kind === "video"
          ? {class_type:"PencilLoadReferenceVideo", inputs:{file:m.file}}
          : {class_type:"LoadAudio", inputs:{audio:m.file}};
        graph["7"].inputs[`ref_${kind}s.ref_${kind}_${i}`] = [id, 0];
      });
    }
  }
  return graph;
}

export function buildDirectorGraph(
  prompt: string,
  ratio: string,
  seed = 1,
  duration = 15,
  timelineData = "{}",
  unetName = H3_EROS_MAX_UNET,
): Graph {
  const seconds = Math.max(0.21, Number(duration) || 15);
  const [width, height] =
    ratio === "16:9" ? [864, 480] : ratio === "1:1" ? [480, 480] : [480, 864];
  const bakedTurbo = h3TurboBakedIn(unetName);
  return {
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: unetName, weight_dtype: "default" },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
        type: "minimax",
        device: "default",
      },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" },
    },
    "4": {
      class_type: "VAELoader",
      inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" },
    },
    ...(bakedTurbo
      ? {}
      : {
          "5": {
            class_type: "LoraLoaderModelOnly",
            inputs: {
              model: ["1", 0],
              lora_name: turboLoraFor(unetName, "director"),
              strength_model: 1,
            },
          },
        }),
    "6": {
      class_type: "PathchSageAttentionKJ",
      inputs: {
        model: bakedTurbo ? ["1", 0] : ["5", 0],
        sage_attention: "auto",
        allow_compile: false,
      },
    },
    "7": {
      class_type: "MiniMaxH3TimelinePlanner",
      inputs: {
        width,
        height,
        generation_seconds: seconds,
        timeline_data: timelineData,
      },
    },
    "9": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "10": {
      class_type: "BasicScheduler",
      inputs: { model: ["6", 0], scheduler: "beta", steps: 8, denoise: 1 },
    },
    "8": {
      class_type: "MiniMaxH3FiniteSegmentSampler",
      inputs: {
        model: ["6", 0],
        clip: ["2", 0],
        vae: ["3", 0],
        audio_vae: ["4", 0],
        finite_plan: ["7", 2],
        sampler: ["9", 0],
        sigmas: ["10", 0],
        seed,
        continue_audio_latent: true,
        ref_image_size: "match",
      },
    },
    "15": {
      class_type: "CreateVideo",
      inputs: { images: ["8", 1], audio: ["8", 2], fps: 24, bit_depth: 8 },
    },
    "16": {
      class_type: "SaveVideo",
      inputs: {
        video: ["15", 0],
        filename_prefix: "pencil/drama",
        format: "mp4",
        codec: "h264",
      },
    },
  };
}
function withTimeout(signal: AbortSignal | null | undefined, ms: number) {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  const any = (
    AbortSignal as typeof AbortSignal & {
      any?: (signals: AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (any) return any([signal, timeout]);
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  if (signal.aborted || timeout.aborted) abort();
  else {
    signal.addEventListener("abort", abort, { once: true });
    timeout.addEventListener("abort", abort, { once: true });
  }
  return ctrl.signal;
}

export async function comfyFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
) {
  const { timeoutMs, ...rest } = init;
  const cap = timeoutMs ?? (rest.signal ? 120000 : 30000);
  try {
    return await fetch(`${COMFY_BASE}${path}`, {
      ...rest,
      cache: "no-store",
      signal: withTimeout(rest.signal, cap),
    });
  } catch (error) {
    if (isDramaTimeoutError(error) || isDramaTimeoutError((error as { cause?: unknown }).cause)) {
      const timeout = new Error("GPU 响应超时，请再点一次生成。");
      timeout.name = "TimeoutError";
      throw timeout;
    }
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    )
      throw error;
    throw new Error("GPU 连接失败，请检查 GPU 服务后重试");
  }
}
export async function comfyHealth() {
  const r = await comfyFetch("/pencil/health");
  if (!r.ok) throw new Error("GPU 服务尚未就绪");
  return r.json();
}
function resolveFetchUrl(value: string, origin = "") {
  if (value.startsWith("/") && origin) return `${origin}${value}`;
  return value;
}

async function uploadComfyImage(
  value: string,
  signal?: AbortSignal,
  origin = "",
) {
  if (value.startsWith("comfy-input:")) return value.slice("comfy-input:".length);
  let blob: Blob;
  let mime = "";
  if (value.startsWith("data:image/")) {
    const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!match) throw new Error("参考图格式无效");
    mime = match[1];
    blob = new Blob([Buffer.from(match[2], "base64")], { type: mime });
  } else {
    const image = await fetch(resolveFetchUrl(value, origin), {
      signal: withTimeout(signal, 20000),
    });
    if (!image.ok) throw new Error("参考图片下载失败");
    mime = image.headers.get("content-type")?.split(";")[0] || "";
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime))
      throw new Error("参考图需为 JPEG、PNG 或 WebP");
    if (Number(image.headers.get("content-length")) > 20 * 1024 * 1024)
      throw new Error("参考图不能超过 20MB");
    blob = await image.blob();
  }
  if (blob.size > 20 * 1024 * 1024) throw new Error("参考图不能超过 20MB");
  const form = new FormData();
  form.set(
    "image",
    blob,
    `pencil-${crypto.randomUUID()}.${mime.split("/")[1] || "png"}`,
  );
  form.set("type", "input");
  const r = await comfyFetch("/upload/image", { method: "POST", body: form, signal });
  if (!r.ok) throw new Error("图片上传到 GPU 失败");
  const d = await r.json();
  return d.subfolder ? `${d.subfolder}/${d.name}` : d.name;
}

export async function comfyGenerate(
  b: Record<string, unknown>,
  signal?: AbortSignal,
  origin = "",
) {
  if (validateGpuModel(b.videoModel) !== "h3")
    throw new Error("LTX 任务必须使用独立适配器");
  const director = isDirectorEnabled(b.timelineDirector)
    ? validateTimelineDirector(b.timelineDirector)
    : null;
  const input = director
    ? { prompt: directorPrompt(director, String(b.prompt || "")) }
    : buildDramaInput(b);
  const media = director ? [] : validateReferenceMedia(b.referenceMedia);
  const resolved: {kind:"video"|"audio"; file:string; duration:number; id?: string}[] = [];
  for (const item of media) {
    const r = await comfyFetch(`/pencil/references/${item.id}?metadata=1`, { signal });
    if (!r.ok) throw new Error("参考素材已失效，请重新上传或导入存档");
    const d = await r.json();
    if (d.kind !== item.kind || !/^pencil_refs\/[a-f0-9]{32}\.(mp4|mp3|wav)$/.test(d.file)) throw new Error("参考素材类型无效");
    resolved.push(d);
  }
  if (!director) {
    for (const kind of ["video", "audio"]) {
      if (resolved.filter(m => m.kind === kind).reduce((n,m)=>n+m.duration,0) > 15.05) throw new Error("同类参考素材总时长不能超过 15 秒");
    }
  }
  const seconds = director
    ? directorOutputSeconds(director)
    : parseShotDuration(b.duration);
  const health = await comfyHealth();
  if (director && !health.director)
    throw new Error("GPU 尚未加载时间线导演台，请重启 ComfyUI 后再试。");
  const unetName = h3UnetFromHealth(health, director ? "ri2v" : (b.mode as DramaMode));
  const requiredMode = director ? "ri2v" : (b.mode as DramaMode);
  const required = [
    requiredMode === "ri2v" ? "reference_model" : "video_model",
    "text_encoder",
    "video_vae",
    "audio_vae",
    ...(h3TurboBakedIn(unetName)
      ? []
      : [requiredMode === "ri2v" ? "reference_turbo_lora" : "video_turbo_lora"]),
  ];
  const missing = required
    .filter((k) => !health.models[k]?.available)
    .map((k) => health.models[k]?.name || k);
  if (missing.length)
    throw new Error(`GPU 已连接，但模型权重未就绪：${missing.join("、")}`);
  const created = input as Record<string, unknown>;
  const urls = director
    ? []
    : b.mode === "i2v"
      ? [created.image_url, created.end_image_url].filter(Boolean)
      : b.mode === "ri2v"
        ? (created.reference_image_urls as string[])
        : [];
  const images: string[] = [];
  for (const value of urls as string[]) {
    images.push(await uploadComfyImage(String(value), signal, origin));
  }
  let prompt: Graph;
  if (director) {
    const files: Record<string, string> = {};
    for (const id of new Set([
      ...director.videoClips.map((clip) => clip.mediaId),
      ...director.audios.map((audio) => audio.mediaId),
    ])) {
      const r = await comfyFetch(`/pencil/references/${id}?metadata=1`, { signal });
      if (!r.ok) throw new Error("导演台素材已失效，请重新上传");
      const d = await r.json();
      if (!/^pencil_refs\/[a-f0-9]{32}\.(mp4|mp3|wav)$/.test(d.file))
        throw new Error("导演台素材类型无效");
      files[id] = d.file;
    }
    const imageFiles: Record<string, string> = {};
    for (const image of director.images) {
      imageFiles[image.id] = image.file || (await uploadComfyImage(image.url, signal, origin));
    }
    prompt = buildDirectorGraph(
      String(input.prompt),
      String(b.aspectRatio || "9:16"),
      Math.floor(Math.random() * 2 ** 48),
      seconds,
      toTimelineData(director, files, imageFiles, String(input.prompt)),
      unetName,
    );
  } else {
    prompt = buildComfyGraph(
      b.mode as DramaMode,
      b.prompt as string,
      String(b.aspectRatio || "9:16"),
      images,
      Math.floor(Math.random() * 2 ** 48),
      seconds,
      resolved,
      unetName,
    );
  }
  const r = await comfyFetch("/pencil/h3/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, client_id: "pencil-drama" }),
    signal,
    timeoutMs: 120000,
  });
  const d = await r.json();
  if (!r.ok || d.error)
    throw new Error(d.error?.message || "ComfyUI 工作流校验失败");
  return {
    taskId: d.prompt_id,
    videoModel: "h3",
    status: "IN_QUEUE",
    model: h3TurboBakedIn(unetName)
      ? "10Eros-Max beta5 · 自有 GPU · TURBO-hybrid"
      : "MiniMax H3 · 自有 GPU · 8步 LoRA",
    provider: "comfy",
  };
}
export async function comfyStatus(id: string) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(id))
    throw new Error("任务 ID 无效");
  const response = await comfyFetch(`/history/${id}`);
  if (!response.ok) throw new Error("GPU 历史查询失败");
  const history = (await response.json())[id];
  if (history) {
    if (history.status?.status_str === "error")
      return {
        status: "FAILED",
        error:
          history.status.messages?.find(
            (m: unknown[]) => m[0] === "execution_error",
          )?.[1]?.exception_message || "GPU 推理失败",
      };
    const outputs = Object.values(history.outputs || {}) as Record<
      string,
      unknown
    >[];
    for (const output of outputs) {
      for (const value of Object.values(output)) {
        if (Array.isArray(value)) {
          const file = value.find((f: { filename?: string }) =>
            /\.mp4$/i.test(f?.filename || ""),
          );
          if (file)
            return {
              status: "COMPLETED",
              videoUrl: `/api/drama/media?${new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || "", type: "output" })}`,
            };
        }
      }
    }
    if (history.status?.completed)
      return { status: "FAILED", error: "工作流完成但未返回 MP4" };
  }
  const q = await comfyFetch("/queue");
  if (!q.ok) throw new Error("GPU 队列查询失败");
  const queue = await q.json();
  if (queue.queue_running?.some((x: unknown[]) => x[1] === id))
    return { status: "IN_PROGRESS" };
  const pendingIndex = queue.queue_pending?.findIndex((x: unknown[]) => x[1] === id) ?? -1;
  if (pendingIndex >= 0)
    return { status: "IN_QUEUE", queuePosition: pendingIndex + 1 };
  throw new Error("GPU 中未找到任务；服务可能重启，请检查 ComfyUI 历史。");
}

export async function comfyCancel(taskId?: string) {
  const id =
    typeof taskId === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(taskId)
      ? taskId
      : "";
  const guarded = await comfyFetch("/pencil/generate/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ family: "h3", prompt_id: id }),
  });
  if (guarded.ok) return { ok: true };
  if (id) {
    const q = await comfyFetch("/queue");
    const queue = q.ok ? await q.json() : {};
    const running = queue.queue_running?.some((x: unknown[]) => x[1] === id);
    await comfyFetch("/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete: [id] }),
    });
    if (running) await comfyFetch("/interrupt", { method: "POST" });
  } else {
    await comfyFetch("/interrupt", { method: "POST" });
    await comfyFetch("/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clear: true }),
    });
  }
  return { ok: true };
}
