import { adminAllowed } from "@/lib/admin-auth";
import { jsonError } from "@/lib/http";
import { templateCatalog } from "@/lib/template-admin";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!adminAllowed(request)) return jsonError("先登录后台。", 401);
  const body = JSON.stringify(templateCatalog(), null, 2);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"xumeng-templates.json\"",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
