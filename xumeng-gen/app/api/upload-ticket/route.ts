import { mediaOrigin } from "@/lib/channel";
import { uploadTicket } from "@/lib/channel-upload.mjs";
import { jsonError, sameOrigin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 大视频不经过 Vercel 的 4.5MB 请求体，浏览器拿这张凭证直接传到渠道素材库。
export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("当前来源不能上传视频。", 403);
  const secret = process.env.AIAPI_SECRETKEY?.trim() ?? "";
  if (!secret) return jsonError("渠道密钥还没配上。", 503);
  let body: { bytes?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("请求格式无效。", 400);
  }
  try {
    const ticket = uploadTicket(secret, mediaOrigin(), Number(body?.bytes));
    return Response.json(ticket, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "视频上传没有开始。";
    return jsonError(message, message.includes("太大") || message.includes("64MB") ? 413 : 400);
  }
}
