const BASE = "https://tokenhub-intl.tencentcloudmaas.com/v1/wand/vega-images";

const PRESET = {
  sd: { square: "1024x1024", portrait: "720x1280", landscape: "1280x720" },
  hd: { square: "2048x2048", portrait: "1440x2560", landscape: "2560x1440" },
  uhd: { square: "4096x4096", portrait: "2160x3840", landscape: "3840x2160" },
};

function tier(clarity) {
  if (clarity === "sd") return "sd";
  if (clarity === "uhd") return "uhd";
  return "hd";
}

export function ratioSize(ratio, clarity = "hd") {
  const shape = ratio === "square" ? "square" : ratio === "portrait" ? "portrait" : "landscape";
  return PRESET[tier(clarity)][shape];
}

export function imageSize(clarity) {
  return ratioSize("landscape", clarity);
}

export function frameSize(width, height, clarity = "hd") {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) return ratioSize("landscape", clarity);
  if (h > w * 1.05) return ratioSize("portrait", clarity);
  if (w > h * 1.05) return ratioSize("landscape", clarity);
  return ratioSize("square", clarity);
}

export function imagePixels(bytes) {
  if (!bytes || bytes.length < 24) return null;
  bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

export function imageRequest({ prompt, imageUrl, imageUrls, size, clarity }) {
  const urls = (Array.isArray(imageUrls) ? imageUrls : imageUrl ? [imageUrl] : []).filter(Boolean);
  const body = {
    model: "wand-vega-image-1.5-pro",
    prompt: String(prompt || "").slice(0, 2000),
    size: size || imageSize(clarity),
  };
  if (urls.length) {
    body.input = [{ content: urls.map(url => ({ type: "input_image", image_url: url })) }];
  }
  return body;
}

function apiKey(env) {
  const key = String(env.TENCENT_TOKENHUB_API_KEY || "").trim();
  if (!key) throw new Error("出图服务还没配上。");
  return key;
}

async function readJson(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || payload?.error || "图片没有完成。";
    throw new Error(String(message).replace(/\s+/g, " ").slice(0, 180));
  }
  return payload || {};
}

function taskId(payload) {
  return String(payload?.task_id || payload?.id || payload?.data?.task_id || "");
}

function resultUrl(payload) {
  if (typeof payload?.url === "string" && payload.url.startsWith("http")) return payload.url;
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const found = rows.find(item => typeof item?.url === "string" && item.url.startsWith("http"));
  return found ? found.url : "";
}

export function wandImageTaskId(value) {
  return /^\d+-[A-Za-z0-9_]+-[A-Za-z0-9]+$/.test(String(value || ""));
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @param {{ prompt?: string, imageUrl?: string, imageUrls?: string[], size?: string, clarity?: string }} [input]
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 */
export async function startWandImage(input = {}, options = {}) {
  const { prompt, imageUrl, imageUrls, size, clarity } = input;
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const key = apiKey(env);
  const created = await readJson(await fetchImpl(`${BASE}/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(imageRequest({ prompt, imageUrl, imageUrls, size, clarity })),
    signal: AbortSignal.timeout(30_000),
  }));
  const id = taskId(created);
  if (!id) throw new Error("出图没有提交成功。");
  return id;
}

export async function pollWandImage(id, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const key = apiKey(env);
  const task = await readJson(await fetchImpl(`${BASE}/tasks/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  }));
  const status = String(task.status || "").toLowerCase();
  if (["failed", "cancelled", "canceled", "incomplete"].includes(status)) {
    throw new Error(String(task.error?.message || task.message || "图片没有完成。").replace(/\s+/g, " ").slice(0, 180));
  }
  const url = resultUrl(task);
  if (!url || !["completed", "succeeded", "success"].includes(status)) return null;
  return downloadImage(url, fetchImpl);
}

export async function runWandImage(input = {}, options = {}) {
  const id = await startWandImage(input, options);
  const deadline = Date.now() + (options.timeoutMs || 180_000);
  while (Date.now() < deadline) {
    const rendered = await pollWandImage(id, options);
    if (rendered) return rendered;
    await delay(2000);
  }
  throw new Error("出图这次等太久了。请再试一次。");
}

async function downloadImage(url, fetchImpl) {
  const parsed = new URL(url);
  const secure = parsed.protocol === "https:" || parsed.protocol === "http:";
  if (!secure || !/(^|\.)myqcloud\.com$/.test(parsed.hostname)) throw new Error("出图结果地址无效。");
  const downloadUrl = parsed.protocol === "http:" ? `https://${parsed.host}${parsed.pathname}${parsed.search}` : url;
  const response = await fetchImpl(downloadUrl, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error("出图结果没有下载下来。");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 32) throw new Error("出图结果没有下载下来。");
  const type = String(response.headers.get("content-type") || "image/png").split(";")[0];
  return { bytes, contentType: type.startsWith("image/") ? type : "image/png" };
}
