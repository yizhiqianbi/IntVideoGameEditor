// MiniMax H3 fast（EdgeOne Makers Model Pro 网关）视频生成。
// 文档：腾讯云 AI 接入包 H3fast 部分；路径固定 /minimax/v2/video_generation/fast。
const H3_HOST = "gateway-bd8c6097a942.edgeone-aigateway-intl.com";
const QUERY_PATH = "/minimax/query";
const CREATE_PATH = "/minimax/v2/video_generation/fast";
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const RESOLUTIONS = new Set(["768P", "720P", "480P"]);

export function h3Credentials(env = process.env) {
  const key = String(env.H3_API_KEY || "").trim();
  const base = String(env.H3_BASE_URL || `https://${H3_HOST}`).trim().replace(/\/+$/, "");
  let parsed;
  try { parsed = new URL(base); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.hostname !== H3_HOST) return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") return null;
  if (!key) return null;
  return { key, base: `https://${H3_HOST}` };
}

const OTHER_TASK = /wand_vega|AigcVideoTask|^face-video-/;

export function h3TaskId(value) {
  return typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value)
    && !OTHER_TASK.test(value);
}

export function h3Duration(value) {
  const seconds = Math.round(Number(value));
  if (!Number.isFinite(seconds)) return 5;
  return Math.min(15, Math.max(4, seconds));
}

function imageEntry(url, role) {
  return { type: "image_url", image_url: { url }, role };
}

function videoEntry(url) {
  return { type: "video_url", video_url: { url }, role: "reference_video" };
}

// 首帧/首尾帧由输入图片决定画幅，按官方说明不传 ratio；参考模式传 adaptive。
export function h3Body({ prompt, firstFrame, lastFrame, imageUrls = [], videoUrls = [], audioUrls = [], duration, resolution, ratio, removeAudio = false }) {
  const text = String(prompt || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
  if (!text) throw new Error("先写下视频提示词。");
  const frames = [];
  if (firstFrame) frames.push(imageEntry(firstFrame, "first_frame"));
  if (lastFrame) frames.push(imageEntry(lastFrame, "last_frame"));
  const references = (Array.isArray(imageUrls) ? imageUrls : []).filter(Boolean).slice(0, 9);
  const videos = (Array.isArray(videoUrls) ? videoUrls : []).filter(Boolean).slice(0, 3);
  const audios = (Array.isArray(audioUrls) ? audioUrls : []).filter(Boolean).slice(0, 3);
  if (!frames.length && !references.length && !videos.length && !audios.length) {
    // 纯文生视频也需要至少一个内容项，text 已经满足；这里不报错。
  }
  const content = [{ type: "text", text }];
  content.push(...frames, ...references.map(url => imageEntry(url, "reference_image")), ...videos.map(videoEntry));
  for (const url of audios) content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" });
  const body = {
    content,
    duration: h3Duration(duration),
    resolution: RESOLUTIONS.has(String(resolution)) ? String(resolution) : "720P",
    remove_audio: removeAudio === true,
  };
  if (frames.length) {
    // 首帧/首尾帧：画幅跟输入图片走。
  } else {
    body.ratio = String(ratio || "adaptive");
  }
  return body;
}

export function h3Read(payload) {
  const task = payload && typeof payload === "object" && payload.task && typeof payload.task === "object" ? payload.task : payload;
  const status = String((task && task.status) || "").toLowerCase();
  const url = task && task.content && typeof task.content.url === "string" ? task.content.url : "";
  if (status === "succeeded" || status === "success" || status === "completed") {
    return url ? { phase: "done", url, error: "" } : { phase: "failed", url: "", error: "成片地址没有返回。" };
  }
  if (status === "failed" || status === "cancelled" || status === "canceled") {
    return { phase: "failed", url: "", error: String(task?.fail_reason || task?.error || "视频没有完成。").slice(0, 180) };
  }
  return { phase: "pending", url: "", error: "" };
}

async function requestJson(url, options, timeoutMs = 90_000) {
  const response = await fetch(url, {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object"
      ? String(payload.message || payload.error || payload.fail_reason || "").slice(0, 180)
      : "";
    throw new Error(message || "视频通道没有接单。");
  }
  return payload;
}

export async function startH3Video(input = {}, options = {}) {
  const env = options.env || process.env;
  const credentials = h3Credentials(env);
  if (!credentials) throw new Error("视频通道还没配上。");
  const body = h3Body(input);
  const payload = await requestJson(`${credentials.base}${CREATE_PATH}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, options.timeoutMs || 120_000);
  const taskId = payload && typeof payload === "object"
    ? String(payload.task_id || payload.taskId || (payload.task && payload.task.id) || "").trim()
    : "";
  if (!h3TaskId(taskId)) throw new Error("视频没有提交成功。");
  return taskId;
}

export function resultUrlAllowed(raw) {
  let url;
  try { url = new URL(String(raw || "")); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return host === "predictor-artifacts.edgeone-ai.com" || host.endsWith(".edgeone-ai.com");
}

export async function pollH3Video(taskId, options = {}) {
  if (!h3TaskId(taskId)) throw new Error("视频任务无效。");
  const env = options.env || process.env;
  const credentials = h3Credentials(env);
  if (!credentials) throw new Error("视频通道还没配上。");
  const fetchImpl = options.fetchImpl || fetch;
  const payload = await requestJson(`${credentials.base}${QUERY_PATH}/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${credentials.key}` },
  }, options.timeoutMs || 60_000);
  const view = h3Read(payload);
  if (view.phase === "failed") throw new Error(view.error || "视频没有完成。");
  if (view.phase === "pending") return null;
  if (!resultUrlAllowed(view.url)) throw new Error("视频结果地址无效。");
  const response = await fetchImpl(view.url, { redirect: "manual", signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error("视频没有下载下来。");
  const declared = Number(response.headers.get("content-length") || "0");
  if (declared > MAX_VIDEO_BYTES) throw new Error("视频太大。");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const item = await reader.read();
    if (item.done) break;
    total += item.value.byteLength;
    if (total > MAX_VIDEO_BYTES) { await reader.cancel().catch(() => undefined); throw new Error("视频太大。"); }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (bytes.byteLength < 1024 || !(bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70)) {
    throw new Error("视频结果读不了。");
  }
  return { bytes, contentType: "video/mp4" };
}
