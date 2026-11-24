import mossGraph from "../data/comfy/moss-text2image.api.json" with { type: "json" };
import qwenGraph from "../data/comfy/qwen-edit.api.json" with { type: "json" };
import { crc32, deflateSync } from "node:zlib";

const MOSS = mossGraph;
const QWEN = qwenGraph;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

export function blankCanvas() {
  const size = 64;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    raw.fill(128, row + 1, row + 1 + size * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function comfyBase(env = process.env) {
  return String(env.COMFY_BASE_URL || "").trim().replace(/\/+$/, "");
}

export function mossWorkflow(prompt, seed) {
  const graph = clone(MOSS);
  graph["6"].inputs.text = String(prompt || "").slice(0, 4000);
  graph["7"].inputs.text = "";
  graph["9"].inputs.seed = seed;
  return graph;
}

export function editPrompt(value) {
  const prompt = String(value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  if (!prompt) return { ok: false, error: "先写下提示词。" };
  if (prompt.length > 2000) return { ok: false, error: "提示词太长。" };
  return { ok: true, prompt };
}

export function qwenWorkflow(prompt, filename, seed, extras = "") {
  const graph = clone(QWEN);
  graph["6"].inputs.prompt = String(prompt || "").slice(0, 4000);
  graph["7"].inputs.prompt = "";
  graph["8"].inputs.image = filename;
  graph["9"].inputs.seed = seed;
  const names = (Array.isArray(extras) ? extras : extras ? [extras] : []).filter(Boolean).slice(0, 2);
  names.forEach((name, index) => {
    const loadId = String(15 + index * 2);
    const scaleId = String(16 + index * 2);
    const slot = index === 0 ? "image2" : "image3";
    graph[loadId] = { class_type: "LoadImage", inputs: { image: name } };
    graph[scaleId] = {
      class_type: "ImageScaleToTotalPixels",
      inputs: {
        image: [loadId, 0],
        upscale_method: "lanczos",
        megapixels: 1.0,
        resolution_steps: 16,
      },
    };
    graph["6"].inputs[slot] = [scaleId, 0];
    graph["7"].inputs[slot] = [scaleId, 0];
  });
  return graph;
}

function comfyFailure(item) {
  const messages = Array.isArray(item?.status?.messages) ? item.status.messages : [];
  const error = messages.findLast(entry => entry?.[0] === "execution_error");
  const detail = String(error?.[1]?.exception_message || "").replace(/\s+/g, " ").trim().slice(0, 160);
  return detail ? `出图没有完成。${detail}` : "出图没有完成。";
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function uploadImage(base, image, fetchImpl) {
  const ext = image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg";
  const form = new FormData();
  form.set("image", new Blob([image.bytes], { type: image.type || "image/jpeg" }), `ref-${crypto.randomUUID()}.${ext}`);
  form.set("type", "input");
  form.set("overwrite", "true");
  const response = await fetchImpl(`${base}/upload/image`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.name) throw new Error("参考图没有上传成功。");
  return payload.subfolder ? `${payload.subfolder}/${payload.name}` : payload.name;
}

async function downloadImage(base, image, fetchImpl) {
  const query = new URLSearchParams({
    filename: image.filename,
    type: image.type || "output",
    subfolder: image.subfolder || "",
  });
  const response = await fetchImpl(`${base}/view?${query}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error("出图结果没有下载下来。");
  const bytes = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get("content-type") || "image/png";
  return { bytes, contentType: type.split(";")[0] };
}

/**
 * @param {{ prompt?: string, image?: { bytes: Uint8Array, type?: string } | null, images?: { bytes: Uint8Array, type?: string }[] | null, reference?: { bytes: Uint8Array, type?: string } | null }} [input]
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, seed?: number, timeoutMs?: number, intervalMs?: number }} [options]
 */
export async function runComfyImage(input = {}, options = {}) {
  const prompt = input.prompt || "";
  const listed = Array.isArray(input.images) ? input.images.filter(item => item?.bytes) : [];
  const primary = listed[0] || input.image || null;
  const extras = listed.length ? listed.slice(1) : (input.reference?.bytes ? [input.reference] : []);
  const base = comfyBase(options.env || process.env);
  if (!base) throw new Error("出图服务还没配上。");
  const fetchImpl = options.fetchImpl || fetch;
  const seed = Number.isInteger(options.seed) ? options.seed : Math.floor(Math.random() * 1_000_000_000);
  const filename = primary?.bytes ? await uploadImage(base, primary, fetchImpl) : await uploadImage(base, { bytes: blankCanvas(), type: "image/png" }, fetchImpl);
  const extraNames = [];
  for (const image of extras.slice(0, 2)) extraNames.push(await uploadImage(base, image, fetchImpl));
  const graph = qwenWorkflow(prompt, filename, seed, extraNames);
  const created = await fetchImpl(`${base}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: crypto.randomUUID() }),
    signal: AbortSignal.timeout(30_000),
  });
  const job = await created.json().catch(() => null);
  if (!created.ok || !job?.prompt_id) throw new Error("出图没有提交成功。");
  const deadline = Date.now() + (options.timeoutMs || 240_000);
  while (Date.now() < deadline) {
    await delay(options.intervalMs || 2000);
    const response = await fetchImpl(`${base}/history/${job.prompt_id}`, { signal: AbortSignal.timeout(20_000) });
    const history = await response.json().catch(() => null);
    const item = history?.[job.prompt_id];
    if (!item) continue;
    if (item.status?.status_str === "error") throw new Error(comfyFailure(item));
    const view = item.outputs?.["11"]?.images?.[0];
    if (view?.filename) return downloadImage(base, view, fetchImpl);
    if (item.status?.completed) throw new Error("出图结果里没有图片。");
  }
  throw new Error("出图这次等太久了。请再试一次。");
}
