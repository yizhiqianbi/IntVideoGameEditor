import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "xumeng_admin";

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD?.trim());
}

function sealFor(password: string): Buffer {
  return createHmac("sha256", password).update("xumeng-gen-admin").digest();
}

export function passwordMatches(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD?.trim() ?? "";
  if (!expected || !password) return false;
  const given = sealFor(password);
  const seal = sealFor(expected);
  return timingSafeEqual(given, seal);
}

export function adminAllowed(request: Request): boolean {
  const expected = process.env.ADMIN_PASSWORD?.trim() ?? "";
  if (!expected) return false;
  const header = request.headers.get("cookie") ?? "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match?.[1]) return false;
  let raw = match[1];
  try { raw = decodeURIComponent(match[1]); } catch { return false; }
  if (!/^[0-9a-f]+$/i.test(raw) || raw.length % 2 !== 0) return false;
  const given = Buffer.from(raw, "hex");
  const seal = sealFor(expected);
  if (given.length !== seal.length) return false;
  return timingSafeEqual(given, seal);
}

export function adminCookie(present: boolean): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const value = present ? sealFor(process.env.ADMIN_PASSWORD?.trim() ?? "").toString("hex") : "";
  const age = present ? "Max-Age=1209600" : "Max-Age=0";
  return `${COOKIE}=${value}; HttpOnly; Path=/; SameSite=Lax; ${age}${secure}`;
}
