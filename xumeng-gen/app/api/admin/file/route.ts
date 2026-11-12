import { adminAllowed } from "@/lib/admin-auth";
import { jsonError } from "@/lib/http";
import { downloadHeaders, templateFile } from "@/lib/template-admin";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!adminAllowed(request)) return jsonError("先登录后台。", 401);
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const kind = url.searchParams.get("kind") ?? "";
  try {
    const file = await templateFile(id, kind);
    if (!file) return jsonError("这个模板文件没有下到。", 404);
    return new NextResponse(file.body, { headers: downloadHeaders(file.type, file.filename) });
  } catch {
    return jsonError("这个模板文件没有下到。", 502);
  }
}
