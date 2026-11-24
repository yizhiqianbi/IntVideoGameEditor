// WAND-Vega-Image-1.0-Lite（TokenHub 国际站），请求 model 名 wand-vega-image-lite。
const TOKENHUB_HOST = "tokenhub-intl.tencentcloudmaas.com";
const CREATE_PATH = "/v1/wand/vega-images/generations";
const QUERY_PATH = "/v1/wand/vega-images/tasks";
const MODEL = "wand-vega-image-lite";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const IMAGE_LITE_SIZES = {
  portrait: "1024x1536",
  landscape: "1536x1024",
  square: "1024x1024",
};

export function imageLiteCredentials(env = process.env) {
  const key = String(env.TOKENHUB_IMAGE_LITE_API_KEY || "").trim();
  const base = String(env.TOKENHUB_BASE_URL || `https://${TOKENHUB_HOST}`).trim().replace(/\/+$/, "");
  let parsed;
  try { parsed = new URL(base); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.hostname !== TOKENHUB_HOST) return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") return null;
  if (!key) return null;
  return { key, base: `https://${TOKENHUB_HOST}`, model: String(env.TOKENHUB_IMAGE_LITE_MODEL || MODEL).trim() || MODEL };
}

export function imageLiteTaskId(value) {
  return typeof value === "string" && /^\d+-wand_vega_image_1_0_lite-[A-Za-z0-9_-]{8,}$/.test(value);
}

export function imageLiteSize(ratio) {
  return IMAGE_LITE_SIZES[ratio] || IMAGE_LITE_SIZES.square;
}

// 图片版换脸提示词沿用了 <image1>/<image2> 占位符，Image Lite 不认占位符，这里换成中文指代。
export function imageLitePrompt(value) {
  return String(value || "")
    .replace(/<image1>/gi, "第一张参考图")
    .replace(/<image2>/gi, "第二张参考图")
    .replace(/<image3>/gi, "第三张参考图")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function imageLiteSizeForPixels(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) return IMAGE_LITE_SIZES.square;
  const ratio = w / h;
  if (ratio > 1.15) return IMAGE_LITE_SIZES.landscape;
  if (ratio < 0.87) return IMAGE_LITE_SIZES.portrait;
  return IMAGE_LITE_SIZES.square;
}

export function imageLiteBody({ prompt, imageUrls = [], size }) {
  const text = String(prompt || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 8000);
  if (!text) throw new Error("先写下出图提示词。");
  const urls = (Array.isArray(imageUrls) ? imageUrls : []).filter(Boolean).slice(0, 10);
  const body = { model: MODEL, prompt: text, size: imageLiteSize(size) };
  if (urls.length) {
    body.input = urls.map(url => ({ content: [{ type: "input_image", image_url: url }] }));
  }
  return body;
}

export function imageLiteRead(payload) {
  const status = String((payload && payload.status) || "").toLowerCase();
  const first = payload && Array.isArray(payload.data) ? payload.data.find(item => item && typeof item.url === "string") : null;
  const url = first ? first.url : "";
  if (status === "completed" || status === "succeeded" || status === "success") {
    return url ? { phase: "done", url, error: "" } : { phase: "failed", url: "", error: "图片地址没有返回。" };
  }
  if (status === "failed" || status === "cancelled" || status === "incomplete") {
    return { phase: "failed", url: "", error: String((payload && (payload.error || payload.message)) || "图片没有完成。").slice(0, 180) };
  }
  return { phase: "pending", url: "", error: "" };
}

export function imageResultUrlAllowed(raw) {
  let url;
  try { url = new URL(String(raw || "")); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return host.endsWith(".myqcloud.com") || host === "cos.ap-singapore.myqcloud.com";
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
      ? String(payload.message || payload.error || "").slice(0, 180)
      : "";
    throw new Error(message || "图片通道没有接单。");
  }
  return payload;
}

export async function startImageLite(input = {}, options = {}) {
  const env = options.env || process.env;
  const credentials = imageLiteCredentials(env);
  if (!credentials) throw new Error("图片通道还没配上。");
  const body = { ...imageLiteBody(input), model: credentials.model };
  const payload = await requestJson(`${credentials.base}${CREATE_PATH}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, options.timeoutMs || 120_000);
  const taskId = payload && typeof payload === "object"
    ? String(payload.task_id || payload.taskId || "").trim()
    : "";
  if (!imageLiteTaskId(taskId)) throw new Error("图片没有提交成功。");
  return taskId;
}

export async function pollImageLite(taskId, options = {}) {
  if (!imageLiteTaskId(taskId)) throw new Error("图片任务无效。");
  const env = options.env || process.env;
  const credentials = imageLiteCredentials(env);
  if (!credentials) throw new Error("图片通道还没配上。");
  const fetchImpl = options.fetchImpl || fetch;
  const payload = await requestJson(`${credentials.base}${QUERY_PATH}/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${credentials.key}` },
  }, options.timeoutMs || 60_000);
  const view = imageLiteRead(payload);
  if (view.phase === "failed") throw new Error(view.error || "图片没有完成。");
  if (view.phase === "pending") return null;
  if (!imageResultUrlAllowed(view.url)) throw new Error("图片结果地址无效。");
  const response = await fetchImpl(view.url, { redirect: "manual", signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error("图片没有下载下来。");
  const declared = Number(response.headers.get("content-length") || "0");
  if (declared > MAX_IMAGE_BYTES) throw new Error("图片太大。");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES || bytes.byteLength < 1024) throw new Error("图片结果读不了。");
  const type = bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : "";
  if (!type) throw new Error("图片结果读不了。");
  return { bytes, contentType: type };
}
