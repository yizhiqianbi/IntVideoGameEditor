import { NextResponse } from "next/server";

export function jsonError(error: string, status: number, extra?: Record<string, string>) {
  return NextResponse.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function imageBytes(value: string): { bytes: Buffer; ext: "png" | "jpg" | "webp" } | null {
  const raw = (value.includes(",") ? value.slice(value.indexOf(",") + 1) : value).replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length < 32 || raw.length > 6_000_000 || raw.length % 4 !== 0) return null;
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length < 32 || bytes.length > 4_500_000) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { bytes, ext: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { bytes, ext: "jpg" };
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return { bytes, ext: "webp" };
  return null;
}
