import { channelBody, channelFailure } from "@/lib/channel";
import { connectTextVideo } from "@/lib/studio-connect";
import { jsonError, sameOrigin } from "@/lib/http";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("当前来源不能使用视频通道。", 403);
  let body: { prompt?: unknown };
  try { body = await request.json(); } catch { return jsonError("请求格式无效。", 400); }
  try {
    const rendered = await connectTextVideo(typeof body.prompt === "string" ? body.prompt : "");
    return channelBody(rendered.bytes, rendered.contentType);
  } catch (error) {
    return channelFailure(error);
  }
}
