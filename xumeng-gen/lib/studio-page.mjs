/**
 * Allowlisted text-to-image and image-to-video handler for the 3488 page.
 * Forwards only those two jobs to the local 3477 server. Credentials stay there.
 */
import { jsonError, nodeToWebRequest, readNodeBody, sameOrigin, sendWebResponse } from "./novel-request.mjs";
import { normalizeImage } from "./reference-image.mjs";

export const DRAW_TARGET = "http://127.0.0.1:3477/api/draw";
export const CHANNEL_TARGET = "http://127.0.0.1:3477/api/channel";
export const FACE_TARGET = "http://127.0.0.1:3477/api/face-swap";
export const IMAGE_TIMEOUT_MS = 230_000;
export const VIDEO_TIMEOUT_MS = 290_000;
export const UNSUPPORTED_MESSAGE = "出图渠道还没配上或暂时不可用。";

const STYLES = new Set(["anime", "photo", "comic"]);
const CLARITY = new Set(["sd", "hd", "uhd"]);
const STYLE_LABEL = { anime: "二次元", photo: "写实", comic: "动漫" };
const CLARITY_LABEL = { sd: "标清", hd: "高清", uhd: "超清" };
const VIDEO_IDS = Object.freeze({
  "8": "ai_chuangzuo_tushengshipin_8s",
  "20": "i2v_10eros",
});

const BLOCKED_NOTE = /未成年|幼态|幼女|幼童|萝莉|正太|小学生|初中生|高中生|校服|学生服|学生妹|loli|shota|underage|\bchild\b|\bteen\b|真人照片|真人脸|本人照片|明星脸|公众人物|real person|real photo/i;
const MINOR_NOTE = /未成年|幼态|幼女|幼童|萝莉|正太|小学生|初中生|高中生|校服|学生服|学生妹|loli|shota|underage|\bchild\b|\bteen\b/i;

function noteError(text) {
  if (MINOR_NOTE.test(text)) return "不能生成未成年或幼态角色。";
  if (BLOCKED_NOTE.test(text)) return "这里只生成虚构的成年角色。";
  return null;
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}

function allowedTarget(url, path) {
  try {
    const parsed = new URL(url);
    const hostOk = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    return hostOk && parsed.port === "3477" && parsed.pathname === path && parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function imageFile(value) {
  const raw = String(value ?? "");
  const base64 = (raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw).replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length < 32 || base64.length % 4 !== 0) {
    return { ok: false, error: "请上传 png、jpg 或 webp。" };
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < 32 || bytes.length > 4_500_000) return { ok: false, error: "图片太大。" };
  let type = "";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) type = "image/png";
  else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) type = "image/jpeg";
  else if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") type = "image/webp";
  if (!type) return { ok: false, error: "请上传 png、jpg 或 webp。" };
  return { ok: true, file: { type, data: base64 } };
}

export function buildTextImage(input) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : null;
  if (!body) return { ok: false, status: 400, error: "请求格式无效。" };
  const unexpected = Object.keys(body).filter(key => !["prompt", "style", "clarity"].includes(key));
  if (unexpected.length) return { ok: false, status: 400, error: "不能指定其他接口或额外字段。", code: "field-forbidden" };
  const prompt = clean(body.prompt);
  if (!prompt) return { ok: false, status: 400, error: "先写下要画的画面。" };
  const blocked = noteError(prompt);
  if (blocked) return { ok: false, status: 400, error: blocked };
  const style = body.style == null || body.style === "" ? "anime" : body.style;
  const clarity = body.clarity == null || body.clarity === "" ? "hd" : body.clarity;
  if (!STYLES.has(style) || !CLARITY.has(clarity)) return { ok: false, status: 400, error: "风格或清晰度无效。" };
  const framed = `${prompt}。风格：${STYLE_LABEL[style]}。清晰度：${CLARITY_LABEL[clarity]}。`;
  return { ok: true, prompt: framed.slice(0, 2000) };
}

export function buildImageVideo(input) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : null;
  if (!body) return { ok: false, status: 400, error: "请求格式无效。" };
  const unexpected = Object.keys(body).filter(key => !["image", "action", "seconds"].includes(key));
  if (unexpected.length) return { ok: false, status: 400, error: "不能指定其他接口或额外字段。", code: "field-forbidden" };
  const file = imageFile(body.image);
  if (!file.ok) return { ok: false, status: 400, error: file.error };
  const seconds = body.seconds == null || body.seconds === "" ? "8" : String(body.seconds);
  if (!Object.hasOwn(VIDEO_IDS, seconds)) return { ok: false, status: 400, error: "时长只能是 8 秒或 20 秒。" };
  const action = clean(body.action) || "按画面自然动起来";
  const blocked = noteError(action);
  if (blocked) return { ok: false, status: 400, error: blocked };
  const values = { positive_prompt: action.slice(0, 4000) };
  if (seconds === "20") values.duration = "20";
  return {
    ok: true,
    id: VIDEO_IDS[seconds],
    values,
    files: { img_url: file.file },
  };
}

async function forward(url, path, payload, timeoutMs, extraHeaders = {}) {
  if (!allowedTarget(url, path)) throw new Error("studio-target-forbidden");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(payload),
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const headers = new Headers();
  headers.set("Content-Type", response.headers.get("content-type") || "application/octet-stream");
  headers.set("Cache-Control", "no-store");
  return new Response(bytes, { status: response.status, headers });
}

export async function defaultForwardImage(prompt, options = {}) {
  const target = options.drawTarget || DRAW_TARGET;
  return forward(target, "/api/draw", { prompt }, options.timeoutMs || IMAGE_TIMEOUT_MS);
}

export async function defaultForwardVideo(payload, options = {}) {
  const target = options.channelTarget || CHANNEL_TARGET;
  return forward(target, "/api/channel", { id: payload.id, values: payload.values, files: payload.files }, options.timeoutMs || VIDEO_TIMEOUT_MS);
}

function adult(request) {
  return request.headers.get("x-adult-confirmed") === "1";
}

export async function handleTextImage(request, options = {}) {
  if (request.method !== "POST") return jsonError("请使用 POST。", 405);
  if (!sameOrigin(request)) return jsonError("当前来源不能使用出图。", 403);
  if (!adult(request)) return jsonError("需要先确认已满 18 岁。", 403, { code: "adult-required" });
  let body;
  try { body = await request.json(); } catch { return jsonError("请求格式无效。", 400); }
  const built = buildTextImage(body);
  if (!built.ok) return jsonError(built.error, built.status, built.code ? { code: built.code } : {});
  try {
    return await (options.forwardImage || defaultForwardImage)(built.prompt, options);
  } catch (error) {
    const name = error && typeof error === "object" ? String(error.name || "") : "";
    if (name === "TimeoutError" || name === "AbortError") return jsonError("出图这次等太久了。请再试一次。", 504, { code: "timeout" });
    return jsonError(UNSUPPORTED_MESSAGE, 502, { code: "forward-failed" });
  }
}

export async function handleImageVideo(request, options = {}) {
  if (request.method !== "POST") return jsonError("请使用 POST。", 405);
  if (!sameOrigin(request)) return jsonError("当前来源不能使用视频通道。", 403);
  if (!adult(request)) return jsonError("需要先确认已满 18 岁。", 403, { code: "adult-required" });
  let body;
  try { body = await request.json(); } catch { return jsonError("请求格式无效。", 400); }
  if (body && typeof body === "object" && typeof body.image === "string" && !imageFile(body.image).ok) {
    const normalized = await normalizeImage(body.image);
    if (!normalized.ok) return jsonError(normalized.error, 400);
    body = { ...body, image: normalized.dataUrl };
  }
  const built = buildImageVideo(body);
  if (!built.ok) return jsonError(built.error, built.status, built.code ? { code: built.code } : {});
  try {
    return await (options.forwardVideo || defaultForwardVideo)(built, options);
  } catch (error) {
    const name = error && typeof error === "object" ? String(error.name || "") : "";
    if (name === "TimeoutError" || name === "AbortError") return jsonError("视频这次等太久了。请再试一次。", 504, { code: "timeout" });
    return jsonError("视频渠道还没配上或暂时不可用。", 502, { code: "forward-failed" });
  }
}

export async function serveStudio(req, res, options = {}) {
  try {
    const path = (req.url || "").split("?")[0];
    if (path !== "/api/text-image" && path !== "/api/image-video" && path !== "/api/face-swap") return false;
    const body = await readNodeBody(req);
    const request = nodeToWebRequest(req, body);
    const response = path === "/api/face-swap"
      ? await forward(
        options.faceTarget || FACE_TARGET,
        "/api/face-swap",
        JSON.parse(body.toString("utf8") || "{}"),
        options.timeoutMs || 300_000,
        { "x-adult-confirmed": request.headers.get("x-adult-confirmed") || "" },
      )
      : path === "/api/text-image"
        ? await handleTextImage(request, options)
        : await handleImageVideo(request, options);
    await sendWebResponse(res, response);
    return true;
  } catch {
    const response = jsonError("生成服务暂时不可用。", 500);
    await sendWebResponse(res, response);
    return true;
  }
}
