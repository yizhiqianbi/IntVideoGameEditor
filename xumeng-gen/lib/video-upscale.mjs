// 换脸视频超清放大：huanlian 成片（480 宽左右）再走 AI 创造 - 超清放大 - 视频，放大到 1080 宽。
// 模块在频道里被标记为 retired（不开放给通用工作台），但换脸视频内部链路可用。
const MODULE_PATH = "/api/public/ai_chuangzao_chaoqing_fangda";
const MAX_BYTES = 200 * 1024 * 1024;
const TASK_ID = /^up-[0-9a-f-]{8,}$/;

export function upscaleEnabled(env = process.env) {
  return String(env.FACE_VIDEO_UPSCALE || "on").toLowerCase() !== "off";
}

export function upscaleTaskId(value) {
  return typeof value === "string" && TASK_ID.test(value);
}

export function upscaleCredentials(env = process.env) {
  const base = String(env.AIAPI_BASE_URL || "").trim().replace(/\/+$/, "");
  const apiKey = String(env.AIAPI_APIKEY || "").trim();
  const secretKey = String(env.AIAPI_SECRETKEY || "").trim();
  if (!base || !apiKey || !secretKey) return null;
  let parsed;
  try { parsed = new URL(base); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  return { base, apiKey, secretKey };
}

export function upscaleRead(payload) {
  const bag = payload && payload.data && typeof payload.data === "object" ? { ...payload, ...payload.data } : payload;
  const status = Number(bag && bag.status);
  if (status === 2) {
    const url = (Array.isArray(bag.out_data) ? bag.out_data : []).find(item => typeof item === "string" && item.startsWith("https://"));
    return url ? { phase: "done", url, error: "" } : { phase: "failed", url: "", error: "放大结果地址没有返回。" };
  }
  if (status === 3) {
    const raw = bag && (bag.message || bag.error);
    const message = typeof raw === "string" ? raw : raw && typeof raw === "object" ? String(raw.message || raw.message_zh || "") : "";
    return { phase: "failed", url: "", error: (message || "超清放大没有完成。").slice(0, 180) };
  }
  return { phase: "pending", url: "", error: "" };
}

async function request(url, options, timeoutMs, label) {
  let response;
  try {
    response = await fetch(url, { ...options, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(/timeout|aborted/i.test(String(error?.message)) ? "超清放大等太久了。请再试一次。" : `${label}连不上。`);
  }
  if (!response.ok) throw new Error(`${label}没有接单。`);
  return response;
}

export async function startUpscale(videoUrl, options = {}) {
  const env = options.env || process.env;
  const credentials = upscaleCredentials(env);
  if (!credentials) throw new Error("超清放大还没配上。");
  const taskId = `up-${crypto.randomUUID()}`;
  const form = new URLSearchParams();
  form.set("task_id", taskId);
  form.set("video_url", videoUrl);
  form.set("video_format", "video/h264-mp4");
  await request(`${credentials.base}${MODULE_PATH}`, {
    method: "POST",
    headers: { apikey: credentials.apiKey, SECRETKEY: credentials.secretKey, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  }, options.timeoutMs || 90_000, "超清放大");
  return taskId;
}

export async function pollUpscale(taskId, options = {}) {
  if (!upscaleTaskId(taskId)) throw new Error("放大任务无效。");
  const env = options.env || process.env;
  const credentials = upscaleCredentials(env);
  if (!credentials) throw new Error("超清放大还没配上。");
  const fetchImpl = options.fetchImpl || fetch;
  const response = await request(`${credentials.base}/api/public/task?task_id=${encodeURIComponent(taskId)}`, {
    headers: { apikey: credentials.apiKey, SECRETKEY: credentials.secretKey },
  }, options.timeoutMs || 30_000, "超清放大");
  const payload = await response.json().catch(() => null);
  const view = upscaleRead(payload);
  if (view.phase === "failed") throw new Error(view.error || "超清放大没有完成。");
  if (view.phase === "pending") return null;
  let url;
  try { url = new URL(view.url); } catch { throw new Error("放大结果地址无效。"); }
  if (url.protocol !== "https:") throw new Error("放大结果地址无效。");
  const video = await fetchImpl(view.url, { redirect: "manual", signal: AbortSignal.timeout(120_000) });
  if (!video.ok || !video.body) throw new Error("放大视频没有下载下来。");
  const bytes = new Uint8Array(await video.arrayBuffer());
  if (bytes.byteLength < 1024 || bytes.byteLength > MAX_BYTES) throw new Error("放大视频结果读不了。");
  if (!(bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70)) throw new Error("放大视频结果读不了。");
  return { bytes, contentType: "video/mp4" };
}
