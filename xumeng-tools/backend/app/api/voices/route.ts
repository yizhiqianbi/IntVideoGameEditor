import { jsonError, sameOrigin } from "@/lib/http";
import { listVoices } from "@/lib/voices";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!sameOrigin(request)) return jsonError("当前来源不能读取音色。", 403);
  const voices = await listVoices();
  return NextResponse.json({ voices }, { headers: { "Cache-Control": "no-store" } });
}
