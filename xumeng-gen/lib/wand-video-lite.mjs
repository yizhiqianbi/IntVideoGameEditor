// WAND-Vega-Video-1.5-Lite（腾讯云 TokenHub），文生视频 / 首帧 / 参考视频。
// 文档：https://www.tencentcloud.com/zh/document/product/1300/84930（1.0 版接口同构，1.5-lite 实测可用）
const TOKENHUB_HOST = "tokenhub-intl.tencentcloudmaas.com";
const CREATE_PATH = "/v1/wand/vega-videos/tasks";
const MODEL = "wand-vega-video-1.5-lite";
const MAX_VIDEO_BYTES = 120 * 1024 * 1024;
const RESOLUTIONS = new Set(["480P", "720P", "1080P", "2K"]);
const RATIOS = new Set(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"]);

export function videoLiteCredentials(env = process.env) {
  const base = String(env.TOKENHUB_BASE_URL || `https://${TOKENHUB_HOST}`).trim().replace(/\/+$/, "");
  const key = String(env.TOKENHUB_VIDEO_LITE_API_KEY || env.TOKENHUB_IMAGE_LITE_API_KEY || "").trim();
  let parsed;
  try { parsed = new URL(base); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.hostname !== TOKENHUB_HOST) return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") return null;
  if (!key) return null;
  return { base: `https://${TOKENHUB_HOST}`, key, model: String(env.TOKENHUB_VIDEO_LITE_MODEL || MODEL).trim() || MODEL };
}

export function videoLiteTaskId(value) {
  return typeof value === "string" && /^\d+-wand_vega_video_[A-Za-z0-9_.-]{6,}$/.test(value);
}

export function videoLiteDuration(value) {
  const seconds = Math.round(Number(value));
  if (!Number.isFinite(seconds)) return 5;
  return Math.min(15, Math.max(4, seconds));
}

function imageEntry(url, role) {
  return { type: "image_url", image_url: { url }, role };
}

// 首帧/首尾帧由输入图片决定画幅；参考模式用 adaptive。
export function videoLiteBody({ prompt, firstFrame, lastFrame, imageUrls = [], videoUrls = [], audioUrls = [], duration, resolution, ratio }) {
  const text = String(prompt || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
  if (!text) throw new Error("先写下视频提示词。");
  const content = [{ type: "text", text }];
  const frames = [];
  if (firstFrame) frames.push(imageEntry(firstFrame, "first_frame"));
  if (lastFrame) frames.push(imageEntry(lastFrame, "last_frame"));
  content.push(...frames);
  for (const url of (Array.isArray(imageUrls) ? imageUrls : []).filter(Boolean).slice(0, 9)) content.push(imageEntry(url, "reference_image"));
  for (const url of (Array.isArray(videoUrls) ? videoUrls : []).filter(Boolean).slice(0, 3)) {
    content.push({ type: "video_url", video_url: { url }, role: "reference_video" });
  }
  for (const url of (Array.isArray(audioUrls) ? audioUrls : []).filter(Boolean).slice(0, 3)) {
    content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" });
  }
  const body = {
    content,
    resolution: RESOLUTIONS.has(String(resolution)) ? String(resolution) : "720P",
    duration: videoLiteDuration(duration),
  };
  if (!frames.length) body.ratio = RATIOS.has(String(ratio)) ? String(ratio) : "adaptive";
  return body;
}

export function videoLiteRead(payload) {
  const bag = payload && payload.data && typeof payload.data === "object" ? { ...payload, ...payload.data } : payload;
  const status = String((bag && bag.status) || "").toLowerCase();
  const content = bag && bag.content && typeof bag.content === "object" ? bag.content : {};
  const url = typeof content.video_url === "string" ? content.video_url : "";
  if (status === "succeeded" || status === "success" || status === "completed") {
    return url ? { phase: "done", url, error: "" } : { phase: "failed", url: "", error: "视频地址没有返回。" };
  }
  if (status === "failed" || status === "cancelled" || status === "canceled") {
    return { phase: "failed", url: "", error: String((bag && (bag.error || bag.message)) || "视频没有完成。").slice(0, 180) };
  }
  return { phase: "pending", url: "", error: "" };
}

export function videoResultUrlAllowed(raw) {
  let url;
  try { url = new URL(String(raw || "")); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  return true;
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
    const message = payload && typeof payload === "object" && payload.error && typeof payload.error === "object"
      ? String(payload.error.message_zh || payload.error.message || "").slice(0, 180)
      : payload && typeof payload === "object" ? String(payload.message || payload.error || "").slice(0, 180) : "";
    throw new Error(message || "视频服务没有接单。");
  }
  return payload;
}

export async function startVideoLite(input = {}, options = {}) {
  const env = options.env || process.env;
  const credentials = videoLiteCredentials(env);
  if (!credentials) throw new Error("视频服务还没配上。");
  const body = { model: credentials.model, ...videoLiteBody(input) };
  const payload = await requestJson(`${credentials.base}${CREATE_PATH}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, options.timeoutMs || 120_000, "视频服务");
  const taskId = payload && typeof payload === "object" ? String(payload.id || payload.task_id || "").trim() : "";
  if (!videoLiteTaskId(taskId)) throw new Error("视频没有提交成功。");
  return taskId;
}

export async function pollVideoLite(taskId, options = {}) {
  if (!videoLiteTaskId(taskId)) throw new Error("视频任务无效。");
  const env = options.env || process.env;
  const credentials = videoLiteCredentials(env);
  if (!credentials) throw new Error("视频服务还没配上。");
  const fetchImpl = options.fetchImpl || fetch;
  const payload = await requestJson(`${credentials.base}${CREATE_PATH}/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${credentials.key}` },
  }, options.timeoutMs || 60_000, "视频服务");
  const view = videoLiteRead(payload);
  if (view.phase === "failed") throw new Error(view.error || "视频没有完成。");
  if (view.phase === "pending") return null;
  if (!videoResultUrlAllowed(view.url)) throw new Error("视频结果地址无效。");
  const response = await fetchImpl(view.url, { redirect: "manual", signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error("视频没有下载下来。");
  const declared = Number(response.headers.get("content-length") || "0");
  if (declared > MAX_VIDEO_BYTES) throw new Error("视频太大。");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1024 || bytes.byteLength > MAX_VIDEO_BYTES) throw new Error("视频结果读不了。");
  if (!(bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70)) throw new Error("视频结果读不了。");
  return { bytes, contentType: "video/mp4" };
}
