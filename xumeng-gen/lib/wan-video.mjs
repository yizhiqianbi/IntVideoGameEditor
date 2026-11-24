// 云桥 Wan3.0 Spicy Prime（w3.0-video-prime-spicy）视频生成/参考视频。
// 资料：云桥 Seedream5.0Pro 与 Wan3.0SpicyPrime 接入包；提交 /v1/tasks/wan3-0-video，
// 查询 /v1/tasks/{id}，产物 /v1/tasks/{id}/artifacts（content_url）。
const HOST = "la-sealion.inaiai.com";
const CREATE_PATH = "/v1/tasks/wan3-0-video";
const RESOLUTIONS = new Set(["480p", "720p", "1080p"]);
const RATIOS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4"]);
const MAX_BYTES = 200 * 1024 * 1024;
const TASK_ID = /^task_[A-Za-z0-9]{8,}$/;

export function wanCredentials(env = process.env) {
  const base = String(env.YUNQIAO_API_BASE || `https://${HOST}`).trim().replace(/\/+$/, "");
  const key = String(env.YUNQIAO_API_KEY || "").trim();
  let parsed;
  try { parsed = new URL(base); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.hostname !== HOST) return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") return null;
  if (!key) return null;
  return { base: `https://${HOST}`, key };
}

export function wanTaskId(value) {
  return typeof value === "string" && TASK_ID.test(value);
}

export function wanDuration(value) {
  const seconds = Math.round(Number(value));
  if (!Number.isFinite(seconds)) return 5;
  return Math.min(30, Math.max(2, seconds));
}

function cleanPrompt(prompt) {
  const text = String(prompt || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
  if (!text) throw new Error("先写下视频提示词。");
  return text;
}

export function wanBody({ prompt, firstFrame, imageUrls = [], videoUrls = [], audioUrls = [], duration, resolution, ratio }) {
  const body = {
    model: "w3.0-video-prime-spicy",
    prompt: cleanPrompt(prompt),
    duration: wanDuration(duration),
    enable_audio: true,
    metadata: {
      resolution: RESOLUTIONS.has(String(resolution)) ? String(resolution) : "1080p",
      ratio: RATIOS.has(String(ratio)) ? String(ratio) : "9:16",
      prompt_extend: true,
    },
  };
  if (firstFrame) body.image_url = firstFrame;
  const images = (Array.isArray(imageUrls) ? imageUrls : []).filter(Boolean).slice(0, 10);
  const videos = (Array.isArray(videoUrls) ? videoUrls : []).filter(Boolean).slice(0, 5);
  const audios = (Array.isArray(audioUrls) ? audioUrls : []).filter(Boolean).slice(0, 5);
  if (images.length) body.reference_images = images;
  if (videos.length) body.reference_videos = videos;
  if (audios.length) body.reference_audios = audios;
  return body;
}

export function wanRead(payload) {
  const status = String((payload && (payload.status || payload.state)) || "").toUpperCase();
  if (["SUCCESS", "SUCCEEDED", "COMPLETED"].includes(status)) return { phase: "done", error: "" };
  if (["FAILURE", "FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(status)) {
    const reason = payload && (payload.fail_reason || payload.error);
    const message = typeof reason === "string" ? reason : reason && typeof reason === "object" ? String(reason.message || reason.msg || "") : "";
    return { phase: "failed", error: (message || "视频没有完成。").slice(0, 180) };
  }
  return { phase: "pending", error: "" };
}

export function wanArtifactUrl(payload) {
  const bag = payload && payload.data && typeof payload.data === "object" ? { ...payload, ...payload.data } : payload;
  const items = bag && (Array.isArray(bag.artifacts) ? bag.artifacts : Array.isArray(bag.data) ? bag.data : []);
  const video = items.find(item => item && typeof item === "object" && (item.type === "video" || /video/i.test(String(item.key || ""))));
  const url = video && (typeof video.content_url === "string" ? video.content_url : typeof video.url === "string" ? video.url : "");
  return url && url.startsWith("https://") ? url : "";
}

export function wanResultAllowed(raw) {
  try {
    const url = new URL(String(raw || ""));
    if (url.protocol !== "https:" || url.username || url.password) return false;
    return Boolean(url.hostname) && url.hostname !== "localhost";
  } catch { return false; }
}

async function requestJson(url, options, timeoutMs, label) {
  let response;
  try {
    response = await fetch(url, { ...options, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(/timeout|aborted/i.test(String(error?.message)) ? "视频服务等太久了。请再试一次。" : `${label}连不上。`);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" ? String(payload.message || payload.error || payload.fail_reason || "").slice(0, 180) : "";
    throw new Error(message || `${label}没有接单。`);
  }
  return payload;
}

export async function startWanVideo(input = {}, options = {}) {
  const env = options.env || process.env;
  const credentials = wanCredentials(env);
  if (!credentials) throw new Error("视频服务还没配上。");
  const payload = await requestJson(`${credentials.base}${CREATE_PATH}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(wanBody(input)),
  }, options.timeoutMs || 90_000, "视频服务");
  const taskId = payload && typeof payload === "object" ? String(payload.task_id || payload.id || "").trim() : "";
  if (!wanTaskId(taskId)) throw new Error("视频没有提交成功。");
  return taskId;
}

export async function pollWanVideo(taskId, options = {}) {
  if (!wanTaskId(taskId)) throw new Error("视频任务无效。");
  const env = options.env || process.env;
  const credentials = wanCredentials(env);
  if (!credentials) throw new Error("视频服务还没配上。");
  const headers = { Authorization: `Bearer ${credentials.key}` };
  const state = await requestJson(`${credentials.base}/v1/tasks/${encodeURIComponent(taskId)}`, { headers }, options.timeoutMs || 45_000, "视频服务");
  const view = wanRead(state);
  if (view.phase === "failed") throw new Error(view.error || "视频没有完成。");
  if (view.phase === "pending") return null;
  const listing = await requestJson(`${credentials.base}/v1/tasks/${encodeURIComponent(taskId)}/artifacts`, { headers }, options.timeoutMs || 45_000, "视频服务");
  const url = wanArtifactUrl(listing);
  if (!wanResultAllowed(url)) throw new Error("视频结果地址无效。");
  const fetchImpl = options.fetchImpl || fetch;
  const video = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(120_000) });
  if (!video.ok || !video.body) throw new Error("视频没有下载下来。");
  const declared = Number(video.headers.get("content-length") || "0");
  if (declared > MAX_BYTES) throw new Error("视频太大。");
  const bytes = new Uint8Array(await video.arrayBuffer());
  if (bytes.byteLength < 1024 || bytes.byteLength > MAX_BYTES) throw new Error("视频结果读不了。");
  if (!(bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70)) throw new Error("视频结果读不了。");
  return { bytes, contentType: "video/mp4" };
}
