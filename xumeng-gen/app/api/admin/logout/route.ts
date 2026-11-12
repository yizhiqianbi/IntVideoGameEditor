import { adminCookie } from "@/lib/admin-auth";
import { sameOrigin, jsonError } from "@/lib/http";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("当前来源不能退出后台。", 403);
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", adminCookie(false));
  return response;
}
