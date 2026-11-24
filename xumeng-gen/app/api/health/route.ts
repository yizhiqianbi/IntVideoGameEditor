import { NextResponse } from "next/server";
import { imageLiteCredentials } from "@/lib/image-lite.mjs";
import { h3Credentials } from "@/lib/tencent-video.mjs";
import { upscaleCredentials } from "@/lib/video-upscale.mjs";
import { wanCredentials } from "@/lib/wan-video.mjs";
import { videoLiteCredentials } from "@/lib/wand-video-lite.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const imageLite = imageLiteCredentials();
  const h3 = h3Credentials();
  const videoLite = videoLiteCredentials();
  const wan = wanCredentials();
  const videoProvider = process.env.TENCENT_VIDEO_PROVIDER === "wand-lite" ? "wand-lite" : "h3";
  const faceProvider = process.env.FACE_VIDEO_PROVIDER === "huanlian" ? "huanlian" : process.env.FACE_VIDEO_PROVIDER === "wand-lite" ? "wand-lite" : "wan";
  const huanlianReady = Boolean(process.env.AIAPI_SECRETKEY);
  return NextResponse.json({
    image: Boolean(imageLite),
    model: imageLite ? "WAND-Vega-Image-1.0-Lite" : "",
    video: videoProvider === "h3" ? Boolean(h3) : Boolean(videoLite),
    videoModel: videoProvider === "h3" ? "MiniMax H3 fast" : "WAND-Vega-Video-1.5-Lite",
    videoUpscale: videoProvider === "h3" ? String(process.env.TENCENT_VIDEO_UPSCALE || "off").toLowerCase() === "on" && Boolean(upscaleCredentials()) : false,
    faceVideo: faceProvider === "huanlian" ? huanlianReady : faceProvider === "wand-lite" ? Boolean(videoLite) : Boolean(wan),
    faceVideoModel: faceProvider === "huanlian" ? "huanlian" : faceProvider === "wand-lite" ? "WAND-Vega-Video-1.5-Lite" : "Wan 3.0 Spicy Prime",
    faceVideoUpscale: faceProvider === "huanlian" && String(process.env.FACE_VIDEO_UPSCALE || "on").toLowerCase() !== "off",
  }, { headers: { "Cache-Control": "no-store" } });
}
