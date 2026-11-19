import { NextResponse } from "next/server";
import { imageLiteCredentials } from "@/lib/image-lite.mjs";
import { h3Credentials } from "@/lib/tencent-video.mjs";
import { upscaleEnabled, upscaleCredentials } from "@/lib/video-upscale.mjs";
import { videoLiteCredentials } from "@/lib/wand-video-lite.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const imageLite = imageLiteCredentials();
  const h3 = h3Credentials();
  const videoLite = videoLiteCredentials();
  const videoProvider = process.env.TENCENT_VIDEO_PROVIDER === "wand-lite" ? "wand-lite" : "h3";
  const faceWand = process.env.FACE_VIDEO_PROVIDER === "wand-lite";
  const upscale = Boolean(upscaleEnabled() && upscaleCredentials());
  return NextResponse.json({
    image: Boolean(imageLite),
    model: imageLite ? "WAND-Vega-Image-1.0-Lite" : "",
    video: videoProvider === "h3" ? Boolean(h3) : Boolean(videoLite),
    videoModel: videoProvider === "h3" ? "MiniMax H3 fast" : "WAND-Vega-Video-1.5-Lite",
    faceVideo: faceWand ? Boolean(videoLite) : Boolean(process.env.AIAPI_SECRETKEY),
    faceVideoModel: faceWand ? "WAND-Vega-Video-1.5-Lite" : "huanlian",
    faceVideoUpscale: faceWand ? false : upscale,
  }, { headers: { "Cache-Control": "no-store" } });
}
