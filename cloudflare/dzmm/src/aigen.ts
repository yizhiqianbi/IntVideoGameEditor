import { optimizeAigenPrompt } from "../../../src/lib/xumeng-aigen-prompt";
import { rateLimit } from "./auth";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

const REF_PATH = /^\/v1\/aigen\/ref\/([a-f0-9]{32})\.(png|jpg|webp)$/;
const TASK_ID = /^\d+-wand_vega_image_1_0_lite-[A-Za-z0-9_-]{8,}$/;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES = 2;
const TASK_TTL_MS = 60 * 60 * 1000;

type ProviderView = { phase: "pending" | "done" | "failed"; url?: string; error?: string };

function tokenhub(env: Env): { base: string; key: string; model: string } | null {
  const base = String(env.TOKENHUB_BASE_URL || "https://tokenhub-intl.tencentcloudmaas.com").trim().replace(/\/+$/, "");
  const key = String(env.TOKENHUB_IMAGE_LITE_API_KEY || "").trim();
  if (!key) return null;
  if (base !== "https://tokenhub-intl.tencentcloudmaas.com") return null;
  return { base, key, model: String(env.TOKENHUB_IMAGE_LITE_MODEL || "wand-vega-image-lite").trim() || "wand-vega-image-lite" };
}

function siteOrigin(env: Env, request: Request): string {
  const candidates = [env.PAYMENTS_RETURN_ORIGIN, ...(env.APP_ORIGINS ?? "").split(/[\s,]+/)];
  for (const item of candidates) {
    if (!item) continue;
    try {
      const url = new URL(item);
      if (url.protocol === "https:" && !url.username && !url.password && !url.port) return url.origin;
    } catch { /* skip */ }
  }
  return new URL(request.url).origin;
}

function imageType(bytes: Uint8Array): "png" | "jpg" | "webp" | null {
  if (bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "png";
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP") return "webp";
  return null;
}

function imageSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] };
      }
      offset += 2 + length;
    }
  }
  return { width: 1024, height: 1024 };
}

function sizeName(width: number, height: number): string {
  const ratio = width / Math.max(1, height);
  if (ratio > 1.15) return "1536x1024";
  if (ratio < 0.87) return "1024x1536";
  return "1024x1024";
}

function decodeDataUrl(value: unknown): Uint8Array {
  if (typeof value !== "string") throw new ApiError(400, "图片数据无效。");
  const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value.trim());
  if (!match) throw new ApiError(400, "请上传 PNG / JPG / WEBP 图片。");
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(match[2].replace(/\s+/g, "")), char => char.charCodeAt(0)); }
  catch { throw new ApiError(400, "图片数据无效。"); }
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new ApiError(413, "单张图片请控制在 4MB 以内。");
  if (!imageType(bytes)) throw new ApiError(400, "请上传 PNG / JPG / WEBP 图片。");
  return bytes;
}

async function providerJson(env: Env, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const credentials = tokenhub(env);
  if (!credentials) throw new ApiError(503, "AI 生成服务暂时未配置。");
  const response = await fetch(`${credentials.base}${path}`, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(90_000),
    headers: { Authorization: `Bearer ${credentials.key}`, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = payload && typeof payload === "object" ? String((payload.error as { message?: string } | undefined)?.message || payload.message || "").slice(0, 160) : "";
    throw new ApiError(502, message || "AI 生成服务没有接单。");
  }
  return payload ?? {};
}

function parseProvider(payload: Record<string, unknown>): ProviderView {
  const bag = payload.data && typeof payload.data === "object" ? { ...payload, ...(payload.data as Record<string, unknown>) } : payload;
  const status = String(bag.status || "").toLowerCase();
  const content = bag.content && typeof bag.content === "object" ? bag.content as Record<string, unknown> : {};
  const first = Array.isArray(bag.data) ? (bag.data as Array<Record<string, unknown>>).find(item => item && typeof item.url === "string") : null;
  const url = typeof content.url === "string" ? content.url : first && typeof first.url === "string" ? first.url : "";
  if (status === "completed" || status === "succeeded" || status === "success") return url ? { phase: "done", url } : { phase: "failed", error: "图片地址没有返回。" };
  if (status === "failed" || status === "cancelled" || status === "canceled" || status === "incomplete") {
    const raw = bag.error;
    const error = typeof raw === "string" ? raw : raw && typeof raw === "object" ? String((raw as { message?: unknown }).message || (raw as { code?: unknown }).code || "") : "";
    return { phase: "failed", error: (error || String(bag.message || "生成失败。")).slice(0, 160) };
  }
  return { phase: "pending" };
}

/** Public short-lived reference images used as provider inputs. */
export async function publicAigenRef(env: Env, path: string): Promise<Response | null> {
  const match = REF_PATH.exec(path);
  if (!match) return null;
  if (!env.MEDIA) return new Response("not found", { status: 404 });
  const object = await env.MEDIA.get(`aigen-refs/${match[1]}.${match[2]}`);
  if (!object) return new Response("not found", { status: 404 });
  const expires = Number(object.customMetadata?.expiresAt || 0);
  if (expires && Date.now() > expires) return new Response("not found", { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": match[2] === "png" ? "image/png" : match[2] === "webp" ? "image/webp" : "image/jpeg", "Cache-Control": "public, max-age=900", "X-Content-Type-Options": "nosniff" } });
}

async function createTask(request: Request, env: Env, user: UserRecord): Promise<Response> {
  if (user.isGuest) throw new ApiError(403, "请先登录后再使用 AI 换脸与换造型。");
  const body = await readJson(request, 12 * 1024 * 1024);
  const rawImages = Array.isArray(body.images) ? body.images : [];
  if (rawImages.length > MAX_IMAGES) throw new ApiError(400, "最多上传 2 张图片。");
  const prompt = typeof body.prompt === "string" ? body.prompt.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200) : "";
  if (!prompt) throw new ApiError(400, "先写下想生成的效果。");
  const images = rawImages.map(decodeDataUrl);
  const origin = siteOrigin(env, request);
  if (!env.MEDIA) throw new ApiError(503, "素材存储暂时不可用。");
  const imageUrls: string[] = [];
  const expiresAt = Date.now() + TASK_TTL_MS;
  for (const bytes of images) {
    const id = crypto.randomUUID().replace(/-/g, "");
    const type = imageType(bytes)!;
    await env.MEDIA.put(`aigen-refs/${id}.${type}`, bytes, { httpMetadata: { contentType: type === "png" ? "image/png" : type === "webp" ? "image/webp" : "image/jpeg" }, customMetadata: { ownerId: user.id, expiresAt: String(expiresAt) } });
    imageUrls.push(`${origin}/api/backend/v1/aigen/ref/${id}.${type}`);
  }
  const firstSize = images.length ? imageSize(images[0]) : { width: 1024, height: 1024 };
  const credentials = tokenhub(env);
  if (!credentials) throw new ApiError(503, "AI 生成服务暂时未配置。");
  const providerBody: Record<string, unknown> = { model: credentials.model, prompt, size: sizeName(firstSize.width, firstSize.height) };
  if (imageUrls.length) providerBody.input = imageUrls.map(url => ({ content: [{ type: "input_image", image_url: url }] }));
  const payload = await providerJson(env, "/v1/wand/vega-images/generations", { method: "POST", body: JSON.stringify(providerBody) });
  const taskId = String(payload.task_id || payload.taskId || "").trim();
  if (!TASK_ID.test(taskId)) throw new ApiError(502, "AI 生成服务没有返回任务号。");
  return json({ taskId, expiresAt }, 202);
}

async function pollTask(env: Env, taskId: string): Promise<Response> {
  if (!TASK_ID.test(taskId)) throw new ApiError(400, "生成任务无效。");
  const credentials = tokenhub(env);
  if (!credentials) throw new ApiError(503, "AI 生成服务暂时未配置。");
  const payload = await providerJson(env, `/v1/wand/vega-images/tasks/${encodeURIComponent(taskId)}`);
  const view = parseProvider(payload);
  if (view.phase === "pending") return json({ status: "pending" }, 202);
  if (view.phase === "failed") throw new ApiError(502, view.error || "生成失败，请重试。");
  const url = view.url!;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".myqcloud.com")) throw new ApiError(502, "生成结果地址无效。");
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new ApiError(502, "生成结果没有下载下来。");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1024 || bytes.byteLength > MAX_IMAGE_BYTES) throw new ApiError(502, "生成结果读不了。");
  const type = imageType(bytes);
  if (!type) throw new ApiError(502, "生成结果不是有效图片。");
  return new Response(bytes, { headers: { "Content-Type": type === "png" ? "image/png" : type === "webp" ? "image/webp" : "image/jpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

async function optimizeImagePrompt(request: Request, env: Env, user: UserRecord): Promise<Response> {
  if (user.isGuest) throw new ApiError(403, "请先登录后再优化提示词。");
  if (request.headers.get("x-adult-confirmed") !== "1") throw new ApiError(403, "需要先确认已满 18 岁。");
  await rateLimit(request, env, "aigen-optimize", 30, user.id);
  const body = await readJson(request, 20_000);
  if (body.text != null && typeof body.text !== "string") throw new ApiError(400, "请求格式无效。");
  const kind = body.kind == null ? "image" : body.kind;
  if (kind !== "image" && kind !== "video") throw new ApiError(400, "优化类型无效。");
  const result = await optimizeAigenPrompt(typeof body.text === "string" ? body.text : "", {
    GENERATION_OPENROUTER_API_KEY: env.GENERATION_OPENROUTER_API_KEY,
    SEALION_API_KEY: env.SEALION_API_KEY,
    SEALION_BASE_URL: env.SEALION_BASE_URL,
  }, kind);
  if (!result.ok) throw new ApiError(result.status, result.error);
  return json({ prompt: result.prompt });
}

export async function handleAigen(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  if (path === "/v1/aigen/optimize-prompt") {
    if (request.method !== "POST") throw new ApiError(405, "仅支持 POST。");
    return optimizeImagePrompt(request, env, user);
  }
  if (path === "/v1/aigen/image-task") {
    if (request.method !== "POST") throw new ApiError(405, "仅支持 POST。");
    return createTask(request, env, user);
  }
  if (path === "/v1/aigen/video-task") {
    if (request.method !== "POST") throw new ApiError(405, "仅支持 POST。");
    return createVideoTask(request, env, user);
  }
  const videoTask = /^\/v1\/aigen\/video-task\/([^/]+)$/.exec(path);
  if (videoTask) {
    if (request.method !== "GET") throw new ApiError(405, "仅支持 GET。");
    let id = "";
    try { id = decodeURIComponent(videoTask[1]); } catch { throw new ApiError(400, "视频任务无效。"); }
    return pollVideoTask(env, id);
  }
  const task = /^\/v1\/aigen\/image-task\/([^/]+)$/.exec(path);
  if (task) {
    if (request.method !== "GET") throw new ApiError(405, "仅支持 GET。");
    let id = "";
    try { id = decodeURIComponent(task[1]); } catch { throw new ApiError(400, "生成任务无效。"); }
    return pollTask(env, id);
  }
  return null;
}

const VIDEO_TASK = /^\d+-wand_vega_video_[A-Za-z0-9_.-]{6,}$/;

function videoModel(env: Env): string {
  return String(env.TOKENHUB_VIDEO_LITE_MODEL || "wand-vega-video-1.5-lite").trim() || "wand-vega-video-1.5-lite";
}

async function createVideoTask(request: Request, env: Env, user: UserRecord): Promise<Response> {
  if (user.isGuest) throw new ApiError(403, "请先登录后再生成视频。");
  const body = await readJson(request, 12 * 1024 * 1024);
  const prompt = typeof body.prompt === "string" ? body.prompt.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 800) : "";
  if (prompt.length < 5) throw new ApiError(400, "先描述想生成的视频内容。");
  const image = decodeDataUrl(body.image);
  const seconds = [5, 10].includes(Number(body.seconds)) ? Number(body.seconds) : 5;
  const credentials = tokenhub(env);
  if (!credentials) throw new ApiError(503, "AI 视频服务暂时未配置。");
  if (!env.MEDIA) throw new ApiError(503, "素材存储暂时不可用。");
  const origin = siteOrigin(env, request);
  const id = crypto.randomUUID().replace(/-/g, "");
  const type = imageType(image)!;
  const expiresAt = Date.now() + TASK_TTL_MS;
  await env.MEDIA.put(`aigen-refs/${id}.${type}`, image, { httpMetadata: { contentType: type === "png" ? "image/png" : type === "webp" ? "image/webp" : "image/jpeg" }, customMetadata: { ownerId: user.id, expiresAt: String(expiresAt) } });
  const imageUrl = `${origin}/api/backend/v1/aigen/ref/${id}.${type}`;
  const payload = await providerJson(env, "/v1/wand/vega-videos/tasks", {
    method: "POST",
    body: JSON.stringify({
      model: videoModel(env),
      content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl }, role: "first_frame" }],
      resolution: "720P",
      duration: seconds,
    }),
  });
  const bag = payload.data && typeof payload.data === "object" ? { ...payload, ...(payload.data as Record<string, unknown>) } : payload;
  const taskId = String(bag.id || bag.task_id || "").trim();
  if (!VIDEO_TASK.test(taskId)) throw new ApiError(502, "AI 视频服务没有返回任务号。");
  return json({ taskId, expiresAt }, 202);
}

async function pollVideoTask(env: Env, taskId: string): Promise<Response> {
  if (!VIDEO_TASK.test(taskId)) throw new ApiError(400, "视频任务无效。");
  const payload = await providerJson(env, `/v1/wand/vega-videos/tasks/${encodeURIComponent(taskId)}`);
  const bag = payload.data && typeof payload.data === "object" ? { ...payload, ...(payload.data as Record<string, unknown>) } : payload;
  const status = String(bag.status || "").toLowerCase();
  const content = bag.content && typeof bag.content === "object" ? bag.content as Record<string, unknown> : {};
  const videoUrl = typeof content.video_url === "string" ? content.video_url : "";
  if (status === "failed" || status === "cancelled" || status === "canceled") throw new ApiError(502, "视频生成失败，请重试。");
  if (status !== "succeeded" && status !== "success" && status !== "completed") return json({ status: "pending" }, 202);
  if (!videoUrl) throw new ApiError(502, "视频地址没有返回。");
  const parsed = new URL(videoUrl);
  if (parsed.protocol !== "https:") throw new ApiError(502, "视频结果地址无效。");
  const response = await fetch(videoUrl, { redirect: "manual", signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new ApiError(502, "视频结果没有下载下来。");
  return new Response(response.body, { headers: { "Content-Type": "video/mp4", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Length": response.headers.get("content-length") ?? "" } });
}
