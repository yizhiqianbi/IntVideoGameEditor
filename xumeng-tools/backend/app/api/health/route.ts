import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const ready = Boolean(process.env.AIAPI_BASE_URL?.trim() && process.env.AIAPI_APIKEY?.trim() && process.env.AIAPI_SECRETKEY?.trim());
  return NextResponse.json({
    image: ready,
    model: "Qwen Image 2.1",
    video: ready,
  }, { headers: { "Cache-Control": "no-store" } });
}
