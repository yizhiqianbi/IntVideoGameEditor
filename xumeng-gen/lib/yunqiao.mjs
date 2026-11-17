const HOST = "la-sealion.inaiai.com";

const SEEDREAM_RATIOS = [
  ["21:9", 21 / 9],
  ["16:9", 16 / 9],
  ["3:2", 3 / 2],
  ["4:3", 4 / 3],
  ["1:1", 1],
  ["3:4", 3 / 4],
  ["2:3", 2 / 3],
  ["9:16", 9 / 16],
];

const WAN_RATIOS = [
  ["16:9", 16 / 9],
  ["4:3", 4 / 3],
  ["1:1", 1],
  ["3:4", 3 / 4],
  ["9:16", 9 / 16],
];

export function yunqiaoCredentials(env = process.env) {
  const key = String(env.YUNQIAO_API_KEY || "").trim();
  const base = String(env.YUNQIAO_API_BASE || `https://${HOST}`).trim().replace(/\/+$/, "");
  let parsed;
  try { parsed = new URL(base); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.hostname !== HOST || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") return null;
  if (!key) return null;
  return { key, base: `https://${HOST}` };
}

export function yunqiaoTaskId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value);
}

export function seedreamQuality(clarity) {
  return clarity === "sd" ? "basic" : "high";
}

export function nearestRatio(width, height, table, fallback) {
  if (!(Number(width) > 0) || !(Number(height) > 0)) return fallback;
  const ratio = Number(width) / Number(height);
  let best = fallback;
  let gap = Number.POSITIVE_INFINITY;
  for (const [name, value] of table) {
    const next = Math.abs(Math.log(ratio / value));
    if (next < gap) {
      gap = next;
      best = name;
    }
  }
  return best;
}

export function seedreamBody({ prompt, imageUrls, clarity, width, height, aspectRatio }) {
  const urls = (Array.isArray(imageUrls) ? imageUrls : []).filter(Boolean).slice(0, 10);
  const input = {
    prompt: String(prompt || "").slice(0, 5000),
    aspect_ratio: aspectRatio || nearestRatio(width, height, SEEDREAM_RATIOS, "16:9"),
    quality: seedreamQuality(clarity),
  };
  if (urls.length) input.image_urls = urls;
  return {
    model: urls.length ? "seedream/5-pro-image-to-image" : "seedream/5-pro-text-to-image",
    input,
  };
}

export function wanBody({ prompt, seconds, mode, imageUrl, imageUrls, width, height }) {
  const duration = Math.min(30, Math.max(2, Math.round(Number(seconds) || 8)));
  const body = {
    model: "w3.0-video-prime-spicy",
    prompt: String(prompt || "").slice(0, 8192),
    duration,
    enable_audio: true,
    metadata: {
      resolution: "720p",
      ratio: nearestRatio(width, height, WAN_RATIOS, "16:9"),
      prompt_extend: true,
    },
  };
  if (mode === "reference") {
    const refs = (Array.isArray(imageUrls) ? imageUrls : []).filter(Boolean).slice(0, 10);
    if (refs.length) body.reference_images = refs;
  } else if (imageUrl) {
    body.image_url = imageUrl;
  }
  return body;
}

function readTaskId(payload) {
  const bags = [payload, payload?.data].filter(item => item && typeof item === "object");
  for (const bag of bags) {
    const id = bag.taskId || bag.task_id || bag.id;
    if (yunqiaoTaskId(id)) return id;
  }
  return "";
}

function phase(state) {
  const value = String(state || "").toLowerCase();
  if (value === "success" || value === "succeeded" || value === "succeed") return "done";
  if (value === "fail" || value === "failed" || value === "failure" || value === "error" || value === "cancelled" || value === "canceled") return "failed";
  if (value === "waiting" || value === "queued" || value === "pending" || value === "running" || value === "processing" || value === "in_progress") return "pending";
  return "unknown";
}

function bagOf(payload) {
  const data = payload?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) return { ...payload, ...data };
  return payload || {};
}

function cleanMessage(value, fallback) {
  const message = String(value || fallback).replace(/\s+/g, " ").trim();
  return message.slice(0, 180) || fallback;
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host.includes(":") && (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:"))) return true;
  const parts = host.split(".").map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function publicHttps(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return ""; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || isPrivateHost(parsed.hostname)) return "";
  return parsed.toString();
}

function isTimeout(error) {
  const name = error && typeof error === "object" ? String(error.name || "") : "";
  return name === "TimeoutError" || name === "AbortError" || /aborted due to timeout/i.test(String(error?.message || ""));
}

async function api(path, options, env, fetchImpl) {
  const credentials = yunqiaoCredentials(env);
  if (!credentials) throw new Error(options.missing || "出图服务还没配上。");
  let response;
  try {
    response = await fetchImpl(`${credentials.base}${path}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${credentials.key}`,
        "User-Agent": "Mozilla/5.0",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs || 60_000),
    });
  } catch (error) {
    if (isTimeout(error)) throw new Error("出图这次等太久了。请再试一次。");
    throw error;
  }
  const payload = await response.json().catch(() => null);
  if (response.status >= 300 && response.status < 400) throw new Error("云桥没有返回任务结果。");
  if (!response.ok) {
    const message = payload?.failMsg || payload?.error?.message || payload?.message || payload?.error;
    throw new Error(cleanMessage(message, "没有完成。"));
  }
  return payload || {};
}

async function downloadMedia(url, kind, fetchImpl) {
  let current = url;
  for (let hop = 0; hop < 3; hop += 1) {
    const target = publicHttps(current);
    if (!target) throw new Error(kind === "video" ? "视频结果地址无效。" : "出图结果地址无效。");
    let response;
    try {
      response = await fetchImpl(target, { redirect: "manual", signal: AbortSignal.timeout(120_000) });
    } catch (error) {
      if (isTimeout(error)) throw new Error("出图结果下载等太久了。请再试一次。");
      throw error;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(kind === "video" ? "视频结果地址无效。" : "出图结果地址无效。");
      current = new URL(location, target).toString();
      continue;
    }
    if (!response.ok) throw new Error(kind === "video" ? "视频没有下载下来。" : "出图结果没有下载下来。");
    const bytes = Buffer.from(await response.arrayBuffer());
    const type = (response.headers.get("content-type") || "").split(";")[0].trim();
    return { bytes, contentType: type || (kind === "video" ? "video/mp4" : "image/png") };
  }
  throw new Error(kind === "video" ? "视频结果地址无效。" : "出图结果地址无效。");
}

export async function startSeedream(input = {}, options = {}) {
  const payload = await api("/lithovas/api/generate", {
    method: "POST",
    body: seedreamBody(input),
    missing: "出图服务还没配上。",
    timeoutMs: 90_000,
  }, options.env || process.env, options.fetchImpl || fetch);
  const taskId = readTaskId(payload);
  if (!taskId) throw new Error("出图没有提交成功。");
  return taskId;
}

export async function pollSeedream(taskId, options = {}) {
  if (!yunqiaoTaskId(taskId)) throw new Error("出图任务无效。");
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  let payload;
  try {
    payload = await api(`/lithovas/api/generate/${encodeURIComponent(taskId)}`, {
      missing: "出图服务还没配上。",
      timeoutMs: 20_000,
    }, env, fetchImpl);
  } catch (error) {
    if (isTimeout(error) || /等太久了/.test(String(error?.message || ""))) return null;
    throw error;
  }
  const bag = bagOf(payload);
  const state = phase(bag.state || bag.status);
  if (state === "failed") throw new Error(cleanMessage(bag.failMsg || bag.message, "出图没有完成。"));
  if (state !== "done") return null;
  const urls = bag.resultUrls || bag.result_urls || [];
  const url = (Array.isArray(urls) ? urls : [urls]).find(item => typeof item === "string" && item.startsWith("https://"));
  if (!url) throw new Error("出图结果里没有图片。");
  try {
    return await downloadMedia(url, "image", fetchImpl);
  } catch (error) {
    if (isTimeout(error) || /等太久了/.test(String(error?.message || ""))) return null;
    throw error;
  }
}

export async function startWan(input = {}, options = {}) {
  const payload = await api("/v1/tasks/wan3-0-video", {
    method: "POST",
    body: wanBody(input),
    missing: "视频服务还没配上。",
  }, options.env || process.env, options.fetchImpl || fetch);
  const taskId = readTaskId(payload);
  if (!taskId) throw new Error("视频没有提交成功。");
  return taskId;
}

function artifactUrl(payload) {
  const lists = [];
  for (const bag of [payload, payload?.data]) {
    if (Array.isArray(bag)) lists.push(bag);
    if (Array.isArray(bag?.artifacts)) lists.push(bag.artifacts);
  }
  for (const list of lists) {
    const video = list.find(item => item && (item.type === "video" || item.key === "video") && (item.content_url || item.url));
    const chosen = video || list.find(item => item && (item.content_url || item.url));
    if (chosen) return String(chosen.content_url || chosen.url);
  }
  return "";
}

export async function pollWan(taskId, options = {}) {
  if (!yunqiaoTaskId(taskId)) throw new Error("视频任务无效。");
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const payload = await api(`/v1/tasks/${encodeURIComponent(taskId)}`, {
    missing: "视频服务还没配上。",
  }, env, fetchImpl);
  const bag = bagOf(payload);
  const state = phase(bag.status || bag.state);
  if (state === "failed") throw new Error(cleanMessage(bag.failMsg || bag.error || bag.message, "视频没有完成。"));
  if (state !== "done") return null;
  const artifacts = await api(`/v1/tasks/${encodeURIComponent(taskId)}/artifacts`, {
    missing: "视频服务还没配上。",
  }, env, fetchImpl);
  const url = artifactUrl(artifacts);
  if (!url.startsWith("https://")) throw new Error("视频结果里没有文件。");
  return downloadMedia(url, "video", fetchImpl);
}
