import { NextResponse } from "next/server";
import { AiapiError, aiapiImageFrame, runAiapiJob, type AiapiJob } from "./aiapi-channel";
import { jsonError } from "./http";

export function channelRequested(value: unknown): boolean {
  return value === "channel";
}

export async function publishAsset(bytes: Buffer, type: string): Promise<string> {
  const secret = process.env.AIAPI_SECRETKEY?.trim() ?? "";
  const origin = (process.env.CREATE_MEDIA_ORIGIN || "https://channel-media.xumengchat.top").replace(/\/$/, "");
  if (!secret) throw new AiapiError("渠道密钥还没配上。", 503);
  const response = await fetch(`${origin}/api/studio/channel-reference`, {
    method: "POST",
    headers: { "Content-Type": type, "x-aiapi-relay": secret },
    body: new Uint8Array(bytes),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null) as { url?: unknown; error?: unknown } | null;
  if (!response.ok || typeof payload?.url !== "string" || !payload.url.startsWith("https://")) {
    const error = typeof payload?.error === "string" ? payload.error.slice(0, 160) : "文件没有放到渠道能打开的地址。";
    throw new AiapiError(error, response.status === 503 ? 503 : 502);
  }
  return payload.url;
}

export async function publishReference(bytes: Buffer, type: string): Promise<string> {
  return publishAsset(bytes, type);
}

export function channelImageRatio(value: string): string {
  return aiapiImageFrame(value) ? value : "3:4";
}

const IMAGE_RATIOS: [string, number][] = [
  ["9:16", 9 / 16],
  ["3:4", 3 / 4],
  ["1:1", 1],
  ["4:3", 4 / 3],
  ["16:9", 16 / 9],
];

export function ratioForPixels(width: number, height: number, fallback: string): string {
  if (width < 8 || height < 8) return channelImageRatio(fallback);
  const ratio = width / height;
  let best = channelImageRatio(fallback);
  let gap = Number.POSITIVE_INFINITY;
  for (const [name, value] of IMAGE_RATIOS) {
    const next = Math.abs(value - ratio);
    if (next < gap) {
      gap = next;
      best = name;
    }
  }
  return best;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

export function webpPixels(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WEBP") return null;
  const kind = ascii(bytes, 12, 16);
  if (kind === "VP8 ") {
    return {
      width: bytes[26] | ((bytes[27] & 0x3f) << 8),
      height: bytes[28] | ((bytes[29] & 0x3f) << 8),
    };
  }
  if (kind === "VP8X") {
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    };
  }
  if (kind === "VP8L" && bytes.byteLength >= 25) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

export async function runChannel(job: AiapiJob): Promise<{ bytes: Uint8Array; contentType: string }> {
  return runAiapiJob({
    baseUrl: process.env.AIAPI_BASE_URL,
    apiKey: process.env.AIAPI_APIKEY,
    secretKey: process.env.AIAPI_SECRETKEY,
  }, job);
}

export function channelBody(bytes: Uint8Array, contentType: string): NextResponse {
  return new NextResponse(new Blob([new Uint8Array(bytes)]), {
    headers: { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export function channelFailure(error: unknown): NextResponse {
  const message = error instanceof AiapiError ? error.message : "渠道生成没有完成。";
  const status = error instanceof AiapiError && error.status >= 400 && error.status < 600 ? error.status : 502;
  return jsonError(message, status);
}
