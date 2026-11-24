// 浏览器把视频直传渠道素材库时用的上传凭证。
// 凭证由 Next 接口用 AIAPI_SECRETKEY 签发，channel-media worker 用同一个密钥校验，
// 这样大视频不用经过 Vercel（请求体上限 4.5MB）。
import { createHmac } from "node:crypto";
import { FACE_VIDEO_MAX_BYTES, FACE_VIDEO_MIN_BYTES } from "./face-video.mjs";

export const UPLOAD_TTL_SECONDS = 600;
export { FACE_VIDEO_MAX_BYTES };

const MEDIA_PATH = /^\/api\/studio\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function uploadSignature(secret, expires, bytes) {
  const key = String(secret || "");
  if (!key) throw new Error("渠道密钥还没配上。");
  return createHmac("sha256", key)
    .update(`studio-upload:${Math.trunc(expires)}:${Math.trunc(bytes)}`)
    .digest("hex");
}

export function uploadTicket(secret, origin, bytes, now = Date.now()) {
  const base = mediaOriginProblem(origin);
  if (base) throw new Error(base);
  const size = Number(bytes);
  if (!Number.isInteger(size) || size < FACE_VIDEO_MIN_BYTES || size > FACE_VIDEO_MAX_BYTES) {
    throw new Error("视频请控制在 64MB 以内。");
  }
  const expires = Math.floor(now / 1000) + UPLOAD_TTL_SECONDS;
  const signature = uploadSignature(secret, expires, size);
  const host = new URL(String(origin)).origin.replace(/\/+$/, "");
  return {
    url: `${host}/api/studio/upload?exp=${expires}&bytes=${size}&sig=${signature}`,
    maxBytes: FACE_VIDEO_MAX_BYTES,
    expires,
  };
}

export function mediaOriginProblem(origin) {
  let parsed;
  try {
    parsed = new URL(String(origin || ""));
  } catch {
    return "渠道素材库地址无效。";
  }
  if (parsed.username || parsed.password) return "渠道素材库地址无效。";
  if (parsed.protocol === "https:") return "";
  if (parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")) return "";
  return "渠道素材库地址无效。";
}

// worker 侧用的是同一套判断，这里保留一份给接口和测试用。
export function ticketProblem({ secret, expires, bytes, signature, now = Math.floor(Date.now() / 1000) }) {
  if (!String(secret || "").trim()) return "渠道密钥还没配上。";
  if (!Number.isInteger(expires) || expires < now) return "上传凭证已过期。";
  if (expires > now + UPLOAD_TTL_SECONDS + 60) return "上传凭证无效。";
  if (!Number.isInteger(bytes) || bytes < FACE_VIDEO_MIN_BYTES || bytes > FACE_VIDEO_MAX_BYTES) return "视频太大。";
  const expected = uploadSignature(secret, expires, bytes);
  if (String(signature || "").toLowerCase() !== expected) return "上传凭证无效。";
  return "";
}

export function mediaUrlProblem(raw, origin) {
  let url;
  try {
    url = new URL(String(raw || ""));
  } catch {
    return "视频地址无效。";
  }
  let base;
  try {
    base = new URL(String(origin || ""));
  } catch {
    return "视频地址无效。";
  }
  if (url.username || url.password) return "视频地址无效。";
  if (url.origin !== base.origin) return "视频地址无效。";
  if (!MEDIA_PATH.test(url.pathname)) return "视频地址无效。";
  return "";
}
