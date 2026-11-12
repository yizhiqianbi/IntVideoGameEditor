import { channelBody, channelFailure } from "@/lib/channel";
import { jsonError, sameOrigin } from "@/lib/http";
import { connectAnimeFace } from "@/lib/studio-connect";

export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(request: Request) {
  // if (!sameOrigin(request)) return jsonError("当前来源不能使用换脸。", 403);
  // if (request.headers.get("x-adult-confirmed") !== "1") return jsonError("需要先确认已满 18 岁。", 403);
  let body: { face?: unknown; scene?: unknown };
  try { body = await request.json(); } catch { return jsonError("请求格式无效。", 400); }
  if (typeof body.face !== "string" || typeof body.scene !== "string") return jsonError("脸和画面都要上传。", 400);
  try {
    const rendered = await connectAnimeFace(body.face, body.scene);
    return channelBody(rendered.bytes, rendered.contentType);
  } catch (error) {
    return channelFailure(error);
  }
}
