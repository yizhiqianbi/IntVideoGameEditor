import { adminConfigured, adminCookie, passwordMatches } from "@/lib/admin-auth";
import { jsonError, sameOrigin } from "@/lib/http";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("当前来源不能登录后台。", 403);
  if (!adminConfigured()) return jsonError("后台口令还没配上。", 503);
  let body: { password?: unknown };
  try { body = await request.json(); } catch { return jsonError("请求格式无效。", 400); }
  const password = typeof body.password === "string" ? body.password : "";
  if (!passwordMatches(password)) return jsonError("口令不对。", 401);
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", adminCookie(true));
  return response;
}
