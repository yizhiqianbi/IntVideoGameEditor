import { channelBody, channelFailure } from "@/lib/channel";
import { jsonError, sameOrigin } from "@/lib/http";
import { buildTextImage } from "@/lib/studio-page.mjs";
import { connectTextImage } from "@/lib/studio-connect";

export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("当前来源不能使用出图。", 403);
  if (request.headers.get("x-adult-confirmed") !== "1") return jsonError("需要先确认已满 18 岁。", 403);
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("请求格式无效。", 400); }
  const built = buildTextImage(body);
  if (!built.ok || !built.prompt) return jsonError(built.error || "请求格式无效。", built.status || 400);
  try {
    const rendered = await connectTextImage(built.prompt);
    return channelBody(rendered.bytes, rendered.contentType);
  } catch (error) {
    return channelFailure(error);
  }
}
