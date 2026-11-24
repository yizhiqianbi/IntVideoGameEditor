const PROMPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OUTPUT_FILE = /h3_r2v_[a-f0-9]{32}_\d{1,8}_?\.mp4/;
const CHUNK = 3 * 1024 * 1024;

function encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function pieces(bytes: Uint8Array): string[] {
  const parts: string[] = [];
  for (let index = 0; index < bytes.length; index += CHUNK) parts.push(encode(bytes.subarray(index, index + CHUNK)));
  return parts;
}

function outputFile(value: unknown): string | null {
  if (typeof value === "string") return value.match(OUTPUT_FILE)?.[0] ?? null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = outputFile(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = outputFile(item);
      if (found) return found;
    }
  }
  return null;
}

function graph(imageFile: string, videoFile: string, prompt: string, mediaId: string, seed: number) {
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

async function postJson(root: string, token: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${root}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (response.status >= 300 && response.status < 400) throw new Error("视频通道返回了无效响应。");
  if (!response.ok || !payload) throw new Error("视频通道没有接受这次出片。");
  return payload;
}

export function videoConfigured(): boolean {
  const base = process.env.H3_COMFY_URL ?? "";
  const token = process.env.H3_COMFY_TOKEN ?? "";
  return base.startsWith("https://") && token.length >= 32;
}

export async function runReferenceVideo(input: { prompt: string; image: Buffer; ext: "png" | "jpg" | "webp"; templateVideo: Uint8Array }): Promise<Uint8Array> {
  const base = (process.env.H3_COMFY_URL ?? "").replace(/\/$/, "");
  const token = process.env.H3_COMFY_TOKEN ?? "";
  if (!base.startsWith("https://") || token.length < 32) throw new Error("视频通道还没有接上。");
  if (input.templateVideo.length < 32) throw new Error("这个动作模板没有参考视频。");
  const mediaId = crypto.randomUUID().replaceAll("-", "");
  const videoId = crypto.randomUUID().replaceAll("-", "");
  const imageParts = pieces(input.image);
  let uploaded: Record<string, unknown> = {};
  for (let index = 0; index < imageParts.length; index += 1) {
    uploaded = await postJson(base, token, "/pencil/input-image", { id: mediaId, ext: input.ext, index, total: imageParts.length, data: imageParts[index] });
  }
  const imageFile = typeof uploaded.file === "string" ? uploaded.file : "";
  if (!/^pencil_stills\/[a-f0-9]{32}\.(png|jpg|webp)$/.test(imageFile)) throw new Error("参考图没有上传成功。");
  const videoParts = pieces(input.templateVideo);
  for (let index = 0; index < videoParts.length; index += 1) {
    await postJson(base, token, "/pencil/references", { id: videoId, kind: "video", index, total: videoParts.length, data: videoParts[index] });
  }
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
  const accepted = await postJson(base, token, "/pencil/h3/prompt", {
    prompt: graph(imageFile, `pencil_refs/${videoId}.mp4`, input.prompt, mediaId, seed),
    client_id: mediaId,
  });
  const promptId = typeof accepted.prompt_id === "string" ? accepted.prompt_id : "";
  const nodeErrors = accepted.node_errors;
  if (!PROMPT_ID.test(promptId) || (nodeErrors && typeof nodeErrors === "object" && Object.keys(nodeErrors).length > 0)) throw new Error("视频没有开始。");
  const deadline = Date.now() + 220_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 4_000));
    const historyResponse = await fetch(`${base}/history/${promptId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    const history = await historyResponse.json().catch(() => null) as Record<string, { status?: { status_str?: string; completed?: boolean } }> | null;
    const row = history?.[promptId];
    if (!historyResponse.ok || !row) continue;
    if (row.status?.status_str === "error") throw new Error("视频没有完成。");
    if (!row.status?.completed) continue;
    const filename = outputFile(row);
    if (!filename) throw new Error("视频没有完成。");
    const view = await fetch(`${base}/view?filename=${filename}&subfolder=pencil&type=output`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "video/mp4" },
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    const bytes = new Uint8Array(await view.arrayBuffer());
    const mp4 = bytes.length > 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
    if (!view.ok || !(view.headers.get("Content-Type")?.includes("video/mp4") || mp4)) throw new Error("成片没有取回来。");
    return bytes;
  }
  throw new Error("出片还在进行，请过几分钟再试。");
}
