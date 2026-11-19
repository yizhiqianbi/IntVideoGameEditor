import { NextResponse } from "next/server";
import { imageLiteCredentials } from "@/lib/image-lite.mjs";
import { h3Credentials } from "@/lib/tencent-video.mjs";
import { videoLiteCredentials } from "@/lib/wand-video-lite.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const imageLite = imageLiteCredentials();
  const videoLite = videoLiteCredentials();
  const h3 = h3Credentials();
  const videoModel = process.env.TENCENT_VIDEO_PROVIDER === "h3" && h3
    ? "MiniMax H3 fast"
    : videoLite ? "WAND-Vega-Video-1.5-Lite" : h3 ? "MiniMax H3 fast" : "";
  return NextResponse.json({
    image: Boolean(imageLite),
    model: imageLite ? "WAND-Vega-Image-1.0-Lite" : "",
    video: Boolean(videoLite || h3),
    videoModel,
  }, { headers: { "Cache-Control": "no-store" } });
}
