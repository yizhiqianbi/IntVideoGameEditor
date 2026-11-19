// huanlian：AIAPI 渠道的像素级视频换脸（原视频画面保留，只换脸）。
const CREATE_PATH = "/api/public/huanlian";
const TASK_PATH = "/api/public/task";
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;

export const HUANLIAN_PROMPT =
  "把参考图里的人脸换到视频里的人物脸上。保留视频原有的动作、姿势、服装、场景、镜头和背景，只改五官、脸型和发型，并让新脸贴合原来的角度和光线。人物是虚构的成年人，二十一岁以上。";

export function huanlianCredentials(env = process.env) {
  const base = String(env.AIAPI_BASE_URL || "").trim().replace(/\/+$/, "");
  const apiKey = String(env.AIAPI_APIKEY || "").trim();
  const secretKey = String(env.AIAPI_SECRETKEY || "").trim();
  if (!base || !apiKey || !secretKey) return null;
  let parsed;
  try { parsed = new URL(base); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  return { base: parsed.origin + parsed.pathname.replace(/\/+$/, ""), apiKey, secretKey };
}

// 任务号由我们自己生成，方便前端轮询。
export function huanlianTaskId(value) {
  return typeof value === "string" && /^face-video-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

function bagOf(payload) {
  const data = payload && payload.data;
  if (data && typeof data === "object" && !Array.isArray(data)) return { ...payload, ...data };
  return payload || {};
}

function cleanUrl(value) {
  if (typeof value !== "string") return "";
  let url;
  try { url = new URL(value); } catch { return ""; }
  if (url.protocol !== "https:" || url.username || url.password) return "";
  return url.href;
}

export function huanlianRead(payload) {
  const bag = bagOf(payload);
  const status = Number(bag.status);
  if (status === 3) {
    const message = String(bag.failMsg || bag.error || bag.message || "").replace(/\s+/g, " ").trim().slice(0, 180);
    return { phase: "failed", url: "", error: message || "换脸没有完成。" };
  }
  if (status === 2) {
    const list = Array.isArray(bag.out_data) ? bag.out_data : [];
    const url = list.map(cleanUrl).find(Boolean)
      || cleanUrl(bag.out_data)
      || cleanUrl(bag.result_url)
      || "";
    return url ? { phase: "done", url, error: "" } : { phase: "failed", url: "", error: "换脸结果里没有视频。" };
  }
  return { phase: "pending", url: "", error: "" };
}

async function requestJson(url, options, timeoutMs, label) {
  let response;
  try {
    response = await fetch(url, { ...options, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(/timeout|aborted/i.test(String(error?.message)) ? "换脸服务等太久了。请再试一次。" : `${label}连不上。`);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object"
      ? String(payload.message || payload.error || payload.failMsg || "").replace(/\s+/g, " ").trim().slice(0, 180)
      : "";
    throw new Error(message || "换脸服务没有接单。");
  }
  return payload;
}

export async function startHuanlian({ videoUrl, faceUrl, prompt }, options = {}) {
  const env = options.env || process.env;
  const credentials = huanlianCredentials(env);
  if (!credentials) throw new Error("换脸服务还没配上。");
  const taskId = `face-video-${crypto.randomUUID()}`;
  const form = new URLSearchParams();
  form.set("task_id", taskId);
  form.set("video_url", videoUrl);
  form.set("img_url", faceUrl);
  form.set("positive_prompt", String(prompt || HUANLIAN_PROMPT).slice(0, 2000));
  form.set("video_format", "video/h264-mp4");
  const payload = await requestJson(`${credentials.base}${CREATE_PATH}`, {
    method: "POST",
    headers: {
      apikey: credentials.apiKey,
      SECRETKEY: credentials.secretKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  }, options.timeoutMs || 90_000, "换脸服务");
  const returned = payload && typeof payload === "object" ? String(payload.task_id || payload.taskId || "").trim() : "";
  return { taskId: returned || taskId };
}

export async function pollHuanlian(taskId, options = {}) {
  if (!huanlianTaskId(taskId)) throw new Error("换脸任务无效。");
  const env = options.env || process.env;
  const credentials = huanlianCredentials(env);
  if (!credentials) throw new Error("换脸服务还没配上。");
  const payload = await requestJson(`${credentials.base}${TASK_PATH}?task_id=${encodeURIComponent(taskId)}`, {
    headers: { apikey: credentials.apiKey, SECRETKEY: credentials.secretKey },
  }, options.timeoutMs || 30_000, "换脸服务");
  const view = huanlianRead(payload);
  if (view.phase === "failed") throw new Error(view.error || "换脸没有完成。");
  if (view.phase === "pending") return null;
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(view.url, { redirect: "manual", signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error("换脸视频没有下载下来。");
  const declared = Number(response.headers.get("content-length") || "0");
  if (declared > MAX_VIDEO_BYTES) throw new Error("换脸视频太大。");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1024 || bytes.byteLength > MAX_VIDEO_BYTES) throw new Error("换脸视频读不了。");
  if (!(bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70)) throw new Error("换脸视频读不了。");
  return { bytes, contentType: "video/mp4" };
}
