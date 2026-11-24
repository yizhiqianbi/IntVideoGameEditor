export const AIAPI_QWEN_IMAGE_MODEL = "aiapi-qwen-image";
export const AIAPI_H3_REFERENCE_MODEL = "aiapi-h3-ref";

const IMAGE_PATH = "/api/public/qwen_image21_multi_image_edit";
const VIDEO_PATH = "/api/public/minimax/v2/h3_i2v_reference";
const TASK_PATH = "/api/public/task";

export type AiapiCredentials = {
  baseUrl?: string;
  apiKey?: string;
  secretKey?: string;
};

export type AiapiJob = {
  kind: "image" | "video";
  prompt: string;
  imageUrls: string[];
  audioUrls?: string[];
  videoUrls?: string[];
  ratio: string;
  seconds?: number;
};

const IMAGE_FRAMES: Record<string, { width: number; height: number }> = {
  "9:16": { width: 1088, height: 1920 },
  "3:4": { width: 1088, height: 1440 },
  "1:1": { width: 1024, height: 1024 },
  "4:3": { width: 1440, height: 1088 },
  "16:9": { width: 1920, height: 1088 },
};

const VIDEO_FRAMES: Record<string, { width: number; height: number }> = {
  "9:16": { width: 540, height: 960 },
  "3:4": { width: 540, height: 720 },
  "1:1": { width: 540, height: 540 },
  "4:3": { width: 720, height: 540 },
  "16:9": { width: 960, height: 540 },
};

export class AiapiError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export function aiapiReady(env: AiapiCredentials): boolean {
  return Boolean(env.baseUrl?.trim() && env.apiKey?.trim() && env.secretKey?.trim());
}

export function aiapiImageFrame(ratio: string): { width: number; height: number } | null {
  return IMAGE_FRAMES[ratio] ?? null;
}

export function aiapiVideoFrame(ratio: string): { width: number; height: number } | null {
  return VIDEO_FRAMES[ratio] ?? null;
}

export function aiapiForm(job: AiapiJob, taskId: string): URLSearchParams {
  const prompt = job.prompt.trim().slice(0, 4000);
  if (!prompt) throw new AiapiError("请先写提示词。", 400);
  if (!job.imageUrls.length || job.imageUrls.length > 9) throw new AiapiError("参考图需要 1 到 9 张。", 400);
  const form = new URLSearchParams();
  form.set("task_id", taskId);
  form.set("image_urls", JSON.stringify(job.imageUrls));
  if (job.kind === "image") {
    const frame = aiapiImageFrame(job.ratio);
    if (!frame) throw new AiapiError("画面比例需要是 9:16、3:4、1:1、4:3 或 16:9。", 400);
    form.set("positive_prompt", prompt);
    form.set("width", String(frame.width));
    form.set("height", String(frame.height));
    return form;
  }
  const frame = aiapiVideoFrame(job.ratio);
  if (!frame) throw new AiapiError("画面比例需要是 9:16、3:4、1:1、4:3 或 16:9。", 400);
  const seconds = job.seconds ?? 8;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 15) throw new AiapiError("视频时长需要在 1 到 15 秒之间。", 400);
  const audios = job.audioUrls ?? [];
  const videos = job.videoUrls ?? [];
  if (audios.length > 3 || videos.length > 3) throw new AiapiError("参考音频和参考视频各自最多 3 段。", 400);
  form.set("audio_urls", JSON.stringify(audios));
  form.set("video_urls", JSON.stringify(videos));
  form.set("text", prompt);
  form.set("duration", String(seconds));
  form.set("width", String(frame.width));
  form.set("height", String(frame.height));
  form.set("video_format", "video/h264-mp4");
  return form;
}

export function aiapiEndpoint(kind: AiapiJob["kind"]): string {
  return kind === "image" ? IMAGE_PATH : VIDEO_PATH;
}

type TaskView = { phase: "pending" | "done" | "failed"; taskId: string; url: string; error: string };

export function readAiapiTask(payload: unknown, inputs: string[] = []): TaskView {
  const taskId = findString(payload, ["task_id", "taskId"]);
  const status = findStatus(payload);
  const code = findString(payload, ["error_code", "errorCode"]).toUpperCase();
  const url = preferResultUrl(collectUrls(payload), inputs);
  if (status === 3 || code === "FAILED" || code === "TIMEOUT") {
    return { phase: "failed", taskId, url, error: findString(payload, ["message", "detail", "error"]) || "渠道生成失败。" };
  }
  if (status === 2 || code === "SUCCESS") {
    return url
      ? { phase: "done", taskId, url, error: "" }
      : { phase: "failed", taskId, url, error: "渠道结果里没有资源地址。" };
  }
  return { phase: "pending", taskId, url, error: "" };
}

export function sniffAiapiBytes(bytes: Uint8Array, kind: AiapiJob["kind"]): string | null {
  if (kind === "video") {
    return bytes.byteLength >= 12 && ascii(bytes, 4, 8) === "ftyp" ? "video/mp4" : null;
  }
  if (bytes.byteLength >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return "image/png";
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.byteLength >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function runAiapiJob(
  env: AiapiCredentials,
  job: AiapiJob,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
  wait: (ms: number) => Promise<void> = delay,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const base = env.baseUrl?.trim().replace(/\/+$/, "") ?? "";
  const apiKey = env.apiKey?.trim() ?? "";
  const secretKey = env.secretKey?.trim() ?? "";
  if (!base || !apiKey || !secretKey) throw new AiapiError("渠道试接还没配上密钥。", 503);
  let root: URL;
  try { root = new URL(base); } catch { throw new AiapiError("渠道地址无效。", 503); }
  if (root.protocol !== "https:") throw new AiapiError("渠道地址无效。", 503);
  const taskId = `aiapi-${crypto.randomUUID()}`;
  const form = aiapiForm(job, taskId);
  const headers = { apikey: apiKey, SECRETKEY: secretKey };
  const inputs = [...job.imageUrls, ...(job.audioUrls ?? []), ...(job.videoUrls ?? [])];
  const created = await fetchImpl(new URL(aiapiEndpoint(job.kind), root), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    redirect: "manual",
  });
  const createdBody = await created.json().catch(() => null);
  if (!created.ok) throw new AiapiError(errorText(createdBody, "渠道没有接单。"));
  let view = readAiapiTask(createdBody, inputs);
  if (!view.taskId) view = { ...view, taskId };
  const deadline = now() + (job.kind === "image" ? 220_000 : 240_000);
  while (view.phase === "pending") {
    if (now() > deadline) throw new AiapiError("渠道这次等太久了。请再生成一次。", 504);
    await wait(3_000);
    const polled = await fetchImpl(new URL(`${TASK_PATH}?task_id=${encodeURIComponent(view.taskId)}`, root), {
      headers,
      redirect: "manual",
    });
    const polledBody = await polled.json().catch(() => null);
    if (!polled.ok) throw new AiapiError(errorText(polledBody, "渠道任务查询失败。"));
    const next = readAiapiTask(polledBody, inputs);
    view = { ...next, taskId: next.taskId || view.taskId };
  }
  if (view.phase === "failed") throw new AiapiError(view.error || "渠道生成失败。");
  const bytes = await downloadPublic(fetchImpl, view.url, job.kind === "image" ? 20_000_000 : 40_000_000);
  const contentType = sniffAiapiBytes(bytes, job.kind);
  if (!contentType) throw new AiapiError(job.kind === "image" ? "渠道没有返回图片。" : "渠道没有返回 MP4。");
  return { bytes, contentType };
}

async function downloadPublic(fetchImpl: typeof fetch, start: string, maximum: number): Promise<Uint8Array> {
  let current = publicHttps(start);
  if (!current) throw new AiapiError("渠道返回的资源地址无效。");
  for (let hop = 0; hop < 4; hop += 1) {
    const response = await fetchImpl(current, {
      redirect: "manual",
      headers: { Accept: "image/png,image/jpeg,image/webp,video/mp4,*/*", "User-Agent": "Mozilla/5.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      const next = publicHttps(new URL(response.headers.get("location") || "", current).href);
      await response.body?.cancel();
      if (!next) throw new AiapiError("渠道结果没有下载下来。");
      current = next;
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new AiapiError("渠道结果没有下载下来。");
    }
    return readLimited(response, maximum);
  }
  throw new AiapiError("渠道结果没有下载下来。");
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function readLimited(response: Response, maximum: number): Promise<Uint8Array> {
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maximum) throw new AiapiError("渠道结果太大。");
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function errorText(payload: unknown, fallback: string): string {
  const text = findString(payload, ["message", "detail", "error"]);
  return text.slice(0, 160) || fallback;
}

function findStatus(value: unknown, depth = 0): number | null {
  if (depth > 6 || !value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStatus(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["status", "task_status", "taskStatus"]) {
    const raw = record[key];
    const status = typeof raw === "number" ? raw : typeof raw === "string" && /^\d$/.test(raw) ? Number(raw) : null;
    if (status !== null) return status;
  }
  for (const item of Object.values(record)) {
    const found = findStatus(item, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function findString(value: unknown, keys: string[], depth = 0): string {
  if (depth > 6 || !value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findString(item, keys, depth + 1);
      if (found) return found;
    }
    return "";
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const item = record[key];
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  for (const item of Object.values(record)) {
    const found = findString(item, keys, depth + 1);
    if (found) return found;
  }
  return "";
}

function collectUrls(value: unknown, into: string[] = [], depth = 0): string[] {
  if (depth > 8) return into;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length < 200_000) {
      try { collectUrls(JSON.parse(trimmed), into, depth + 1); return into; } catch { /* plain text */ }
    }
    for (const match of trimmed.matchAll(/https:\/\/[^\s"',\\\],]+/g)) {
      const url = match[0];
      if (url.length < 2000 && !into.includes(url)) into.push(url);
    }
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, into, depth + 1);
    return into;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectUrls(item, into, depth + 1);
  }
  return into;
}

function preferResultUrl(urls: string[], inputs: string[]): string {
  const known = new Set(inputs);
  const fresh = urls.filter(url => !known.has(url));
  return fresh.find(url => /\.(?:png|jpe?g|webp|mp4)(?:\?|$)/i.test(url)) ?? fresh[0] ?? "";
}

export function aiapiPublicUrl(raw: string): boolean {
  return publicHttps(raw) !== null;
}

function publicHttps(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)) return null;
  }
  return url.href;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
