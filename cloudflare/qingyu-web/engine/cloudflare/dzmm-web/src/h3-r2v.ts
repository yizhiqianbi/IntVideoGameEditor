import { H3_ACTION_TEMPLATES } from "../../../src/lib/xumeng-h3-actions";

const TEMPLATE_ID = /^h3-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROMPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OUTPUT_FILE = /h3_r2v_[a-f0-9]{32}_\d{1,8}_?\.mp4/;
const CHUNK = 3 * 1024 * 1024;

function supplement(pattern: string, extra: string): string {
  const cleaned = extra.replace(/[<>\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  const marker = "补充要求：";
  const at = cleaned.lastIndexOf(marker);
  if (at >= 0) return cleaned.slice(at + marker.length).trim().slice(0, 400);
  const flat = pattern.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned === flat || flat.startsWith(cleaned)) return "";
  return cleaned.slice(0, 400);
}

export function h3R2vPrompt(templateId: string, extra: string): string | null {
  if (!TEMPLATE_ID.test(templateId)) return null;
  const template = H3_ACTION_TEMPLATES.find(item => item.id === templateId);
  if (!template) return null;
  const action = /动作：(.+?)一个连贯镜头/.exec(template.pattern)?.[1] ?? template.description;
  const note = supplement(template.pattern, extra);
  return [
    "规格：5秒 | 24fps | 写实连续单镜头 | 9:16。",
    "时间轴：",
    "0–2秒：沿用 <Video 1> 开头的姿势、服装、房间和镜头。把 <Video 1> 里的人换成 <Picture 1> 中的成年人物，脸、发型和人物身份来自 <Picture 1>。",
    `中间：${action}动作、服装、房间和镜头跟随 <Video 1>，人物始终是 <Picture 1>。`,
    "末1–2秒：停在 <Video 1> 结束的姿势，人物仍是 <Picture 1>。",
    "镜头：跟随 <Video 1>，连续单镜头，不切镜。",
    "场景：沿用 <Video 1> 的房间、服装和光线。",
    "声音：自然现场声，没有旁白。",
    "风格：写实真人，21岁以上成年人。",
    "光线：沿用 <Video 1>。",
    `连续性：把 <Picture 1> 的人放进 <Video 1>，替换模板里原来的人。不要把参考图当成第一帧。不要保留模板原人物的脸。${note ? `补充：${note}。` : ""}无字幕，无水印。`,
  ].join("\n");
}

export function h3R2vGraph(imageFile: string, videoFile: string, prompt: string, mediaId: string, seed: number): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "minimax_h3_ref2va_pruned_int8_convrot.safetensors", weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" } },
    "4": { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" } },
    "5": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors", strength_model: 1 } },
    "7": { class_type: "MiniMaxH3ReferenceToVideo", inputs: {
      clip: ["2", 0], vae: ["3", 0], audio_vae: ["4", 0], prompt, width: 480, height: 736, length: 124, ref_image_size: "match",
      "ref_images.ref_image_0": ["20", 0], "ref_videos.ref_video_0": ["60", 0],
    } },
    "8": { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    "9": { class_type: "KSamplerSelect", inputs: { sampler_name: "res_multistep" } },
    "10": { class_type: "BasicScheduler", inputs: { model: ["5", 0], scheduler: "simple", steps: 4, denoise: 1 } },
    "11": { class_type: "BasicGuider", inputs: { model: ["5", 0], conditioning: ["7", 0] } },
    "12": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["8", 0], guider: ["11", 0], sampler: ["9", 0], sigmas: ["10", 0], latent_image: ["7", 1] } },
    "13": { class_type: "VAEDecode", inputs: { samples: ["12", 0], vae: ["3", 0] } },
    "14": { class_type: "VAEDecodeAudio", inputs: { samples: ["12", 0], vae: ["4", 0] } },
    "15": { class_type: "CreateVideo", inputs: { images: ["13", 0], audio: ["14", 0], fps: 24, bit_depth: 8 } },
    "16": { class_type: "SaveVideo", inputs: { video: ["15", 0], filename_prefix: `pencil/h3_r2v_${mediaId}`, format: "mp4", codec: "h264" } },
    "20": { class_type: "LoadImage", inputs: { image: imageFile } },
    "60": { class_type: "PencilLoadReferenceVideo", inputs: { file: videoFile } },
  };
}

function jsonResponse(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function imageBytes(value: string): { bytes: Uint8Array; ext: "png" | "jpg" | "webp" } | null {
  if (!/^[A-Za-z0-9+/=]+$/.test(value) || value.length < 32 || value.length % 4 !== 0) return null;
  let binary: string;
  try { binary = atob(value); } catch { return null; }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { bytes, ext: "png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { bytes, ext: "jpg" };
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { bytes, ext: "webp" };
  return null;
}

function pieces(bytes: Uint8Array): string[] {
  const parts: string[] = [];
  for (let index = 0; index < bytes.length; index += CHUNK) parts.push(encode(bytes.subarray(index, index + CHUNK)));
  return parts;
}

function publicError(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 && value.length <= 80 && !/[\\/\n]/.test(value) ? value : fallback;
}

function outputFile(value: unknown): string | null {
  if (typeof value === "string") return value.match(OUTPUT_FILE)?.[0] ?? null;
  if (Array.isArray(value)) {
    for (const item of value) { const found = outputFile(item); if (found) return found; }
    return null;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) { const found = outputFile(item); if (found) return found; }
  }
  return null;
}

async function postJson(fetchImpl: typeof fetch, url: string, token: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (response.status >= 300 && response.status < 400) throw new Error("视频通道返回了无效响应。");
  if (!response.ok || !payload) throw new Error(publicError(payload?.error, "视频通道没有接受这次出片。"));
  return payload;
}

export async function runH3ReferenceVideo(input: {
  base: string; token: string; templateId: string; extra: string; image: string; templateVideo: Uint8Array;
  fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number;
}): Promise<Response> {
  const prompt = h3R2vPrompt(input.templateId, input.extra);
  if (!prompt) return jsonResponse("没有这个动作模板。", 400);
  const image = imageBytes(input.image.includes(",") ? input.image.slice(input.image.indexOf(",") + 1) : input.image);
  if (!image) return jsonResponse("请先上传参考图。", 400);
  if (!input.base.startsWith("https://") || input.token.length < 32) return jsonResponse("视频通道还没有接上。", 503);
  if (input.templateVideo.length < 32) return jsonResponse("这个动作模板没有参考视频。", 502);
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = input.now ?? Date.now;
  const mediaId = crypto.randomUUID().replaceAll("-", "");
  const videoId = crypto.randomUUID().replaceAll("-", "");
  const root = input.base.replace(/\/$/, "");
  try {
    const imageParts = pieces(image.bytes);
    let uploaded: Record<string, unknown> = {};
    for (let index = 0; index < imageParts.length; index += 1) {
      uploaded = await postJson(fetchImpl, `${root}/pencil/input-image`, input.token, { id: mediaId, ext: image.ext, index, total: imageParts.length, data: imageParts[index] });
    }
    const imageFile = typeof uploaded.file === "string" ? uploaded.file : "";
    if (!/^pencil_stills\/[a-f0-9]{32}\.(png|jpg|webp)$/.test(imageFile)) return jsonResponse("参考图没有上传成功。", 502);
    const videoParts = pieces(input.templateVideo);
    for (let index = 0; index < videoParts.length; index += 1) {
      await postJson(fetchImpl, `${root}/pencil/references`, input.token, { id: videoId, kind: "video", index, total: videoParts.length, data: videoParts[index] });
    }
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
    const accepted = await postJson(fetchImpl, `${root}/pencil/h3/prompt`, input.token, {
      prompt: h3R2vGraph(imageFile, `pencil_refs/${videoId}.mp4`, prompt, mediaId, seed),
      client_id: mediaId,
    });
    const promptId = typeof accepted.prompt_id === "string" ? accepted.prompt_id : "";
    const nodeErrors = accepted.node_errors;
    if (!PROMPT_ID.test(promptId) || (nodeErrors && typeof nodeErrors === "object" && Object.keys(nodeErrors).length > 0)) return jsonResponse("视频没有开始。", 502);
    const deadline = now() + 240_000;
    while (now() < deadline) {
      await sleep(4_000);
      const historyResponse = await fetchImpl(`${root}/history/${promptId}`, {
        headers: { Authorization: `Bearer ${input.token}`, Accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
      const history = await historyResponse.json().catch(() => null) as Record<string, { status?: { status_str?: string; completed?: boolean } }> | null;
      const row = history?.[promptId];
      if (!historyResponse.ok || !row) continue;
      if (row.status?.status_str === "error") return jsonResponse("视频没有完成。", 502);
      if (!row.status?.completed) continue;
      const filename = outputFile(row);
      if (!filename) return jsonResponse("视频没有完成。", 502);
      const view = await fetchImpl(`${root}/view?filename=${filename}&subfolder=pencil&type=output`, {
        headers: { Authorization: `Bearer ${input.token}`, Accept: "video/mp4" },
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
      });
      const bytes = new Uint8Array(await view.arrayBuffer());
      const mp4 = bytes.length > 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
      if (!view.ok || !(view.headers.get("Content-Type")?.includes("video/mp4") || mp4)) return jsonResponse("成片没有取回来。", 502);
      return new Response(bytes, {
        headers: { "Content-Type": "video/mp4", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      });
    }
  } catch (error) {
    return jsonResponse(error instanceof Error ? publicError(error.message, "视频通道暂时连不上。") : "视频通道暂时连不上。", 502);
  }
  return jsonResponse("出片还在进行，请过几分钟再试。", 504);
}
