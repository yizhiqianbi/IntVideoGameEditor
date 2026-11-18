import { channelBody, publishReference } from "@/lib/channel";
import { adultAsk } from "@/lib/channel-env";
import { imageLiteTaskId, pollImageLite, startImageLite } from "@/lib/image-lite.mjs";
import { jsonError, sameOrigin } from "@/lib/http";
import { normalizeImage } from "@/lib/reference-image.mjs";
import { buildTextImage, imageFile } from "@/lib/studio-page.mjs";
import { pollSeedream, startSeedream, yunqiaoTaskId } from "@/lib/yunqiao.mjs";

export const maxDuration = 300;
export const runtime = "nodejs";

function failure(error: unknown) {
  const raw = error instanceof Error ? error.message : "";
  const message = /aborted due to timeout|TimeoutError/i.test(raw) ? "出图这次等太久了。请再试一次。" : (raw || "图片没有完成。");
  const status = message.includes("还没配上") ? 503 : message.includes("等太久了") ? 504 : 502;
  return jsonError(message, status);
}

function pending(taskId: string) {
  return Response.json({ taskId }, { status: 202, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("当前来源不能使用出图。", 403);
  if (request.headers.get("x-adult-confirmed") !== "1") return jsonError("需要先确认已满 18 岁。", 403);
  let body: { image?: unknown; images?: unknown; taskId?: unknown } | null = null;
  try { body = await request.json(); } catch { return jsonError("请求格式无效。", 400); }
  if (body && typeof body.taskId === "string") {
    if (Object.keys(body).some(key => key !== "taskId")) return jsonError("出图任务无效。", 400);
    try {
      if (imageLiteTaskId(body.taskId)) {
        const rendered = await pollImageLite(body.taskId);
        if (!rendered) return pending(body.taskId);
        return channelBody(rendered.bytes, rendered.contentType);
      }
      if (!yunqiaoTaskId(body.taskId)) return jsonError("出图任务无效。", 400);
      const rendered = await pollSeedream(body.taskId);
      if (!rendered) return pending(body.taskId);
      return channelBody(rendered.bytes, rendered.contentType);
    } catch (error) {
      return failure(error);
    }
  }
  if (body && typeof body.image === "string" && body.image && !imageFile(body.image).ok) {
    const normalized = await normalizeImage(body.image);
    if (!normalized.ok) return jsonError(normalized.error || "这张图片读不了。", 400);
    body = { ...body, image: normalized.dataUrl };
  }
  const built = buildTextImage(body);
  if (!built.ok || !built.prompt) return jsonError(built.error || "请求格式无效。", built.status || 400);
  const sources = Array.isArray(built.images) && built.images.length ? built.images : (built.image ? [built.image] : []);
  const imageUrls: string[] = [];
  for (const source of sources) {
    const normalized = await normalizeImage(typeof source === "string" ? source : "");
    if (!normalized.ok || !normalized.bytes || !normalized.type) return jsonError(normalized.error || "这张图片读不了。", 400);
    try {
      imageUrls.push(await publishReference(normalized.bytes, normalized.type));
    } catch (error) {
      const message = error instanceof Error ? error.message : "参考图没有传上去。";
      return jsonError(message, message.includes("还没配上") ? 503 : 502);
    }
  }
  try {
    const prompt = built.prompt.includes("二十一岁") ? built.prompt : adultAsk(built.prompt);
    const taskId = await startImageLite({
      prompt,
      imageUrls,
      size: built.ratio,
    });
    return pending(taskId);
  } catch (error) {
    return failure(error);
  }
}
