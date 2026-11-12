import { channelBody, channelFailure } from "@/lib/channel";
import { jsonError, sameOrigin } from "@/lib/http";
import { buildImageVideo } from "@/lib/studio-page.mjs";
import { connectImageVideo } from "@/lib/studio-connect";

export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("当前来源不能使用视频通道。", 403);
  if (request.headers.get("x-adult-confirmed") !== "1") return jsonError("需要先确认已满 18 岁。", 403);
  let body: { image?: unknown; action?: unknown; seconds?: unknown };
  try { body = await request.json(); } catch { return jsonError("请求格式无效。", 400); }
  const built = buildImageVideo(body);
  if (!built.ok || !built.values?.positive_prompt) return jsonError(built.error || "请求格式无效。", built.status || 400);
  try {
    const rendered = await connectImageVideo(
      built.values.positive_prompt,
      typeof body.image === "string" ? body.image : "",
      String(body.seconds ?? "8"),
    );
    return channelBody(rendered.bytes, rendered.contentType);
  } catch (error) {
    return channelFailure(error);
  }
}
