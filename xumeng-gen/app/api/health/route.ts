import { NextResponse } from "next/server";
import { imageLiteCredentials } from "@/lib/image-lite.mjs";
import { h3Credentials } from "@/lib/tencent-video.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const imageLite = imageLiteCredentials();
  const h3 = h3Credentials();
  return NextResponse.json({
    image: Boolean(imageLite),
    model: imageLite ? "WAND-Vega-Image-1.0-Lite" : "",
    video: Boolean(h3),
    videoModel: h3 ? "MiniMax H3 fast" : "",
  }, { headers: { "Cache-Control": "no-store" } });
}
