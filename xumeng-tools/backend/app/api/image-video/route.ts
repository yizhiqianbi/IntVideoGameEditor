import { channelBody, publishReference } from "@/lib/channel";
import { adultAsk } from "@/lib/channel-env";
import { jsonError, sameOrigin } from "@/lib/http";
import { fitVideoFrame, normalizeImage } from "@/lib/reference-image.mjs";
import { buildImageVideo } from "@/lib/studio-page.mjs";
import { pollWandVideo, startWandVideo } from "@/lib/wand-video.mjs";

export const maxDuration = 300;
export const runtime = "nodejs";

function wandTaskId(value: string) {
  return /^\d+-AigcVideoTask-[A-Za-z0-9]+$/.test(value);
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "视频没有完成。";
  const status = message.includes("还没配上") ? 503 : 502;
  return jsonError(message, status);
}

function pending(taskId: string) {
  return Response.json({ taskId }, { status: 202, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("当前来源不能使用视频通道。", 403);
  if (request.headers.get("x-adult-confirmed") !== "1") return jsonError("需要先确认已满 18 岁。", 403);
  let body: { image?: unknown; action?: unknown; seconds?: unknown; taskId?: unknown };
  try { body = await request.json(); } catch { return jsonError("请求格式无效。", 400); }
  if (typeof body.taskId === "string") {
    if (Object.keys(body).some(key => key !== "taskId") || !wandTaskId(body.taskId)) return jsonError("视频任务无效。", 400);
    try {
      const rendered = await pollWandVideo(body.taskId);
      if (!rendered) return pending(body.taskId);
      return channelBody(rendered.bytes, rendered.contentType);
    } catch (error) {
      return failure(error);
    }
  }
  const built = buildImageVideo(body);
  if (!built.ok || !built.values?.positive_prompt) return jsonError(built.error || "请求格式无效。", built.status || 400);
  const sources = Array.isArray(built.images) ? built.images : [];
  const imageUrls = [];
  for (const source of sources) {
    const normalized = await normalizeImage(typeof source === "string" ? source : "");
    if (!normalized.ok || !normalized.bytes || !normalized.type) return jsonError(normalized.error || "这张图片读不了。", 400);
    const fitted = await fitVideoFrame(normalized.bytes).catch(() => null);
    const bytes = fitted?.bytes || normalized.bytes;
    const type = fitted?.type || normalized.type;
    try {
      imageUrls.push(await publishReference(bytes, type));
    } catch (error) {
      const message = error instanceof Error ? error.message : "参考图没有传上去。";
      return jsonError(message, message.includes("还没配上") ? 503 : 502);
    }
  }
  const prompt = built.values.positive_prompt.includes("二十一岁") ? built.values.positive_prompt : adultAsk(built.values.positive_prompt);
  try {
    const taskId = await startWandVideo({
      prompt,
      imageUrl: imageUrls[0],
      imageUrls,
      seconds: built.seconds,
      mode: built.mode,
    });
    return pending(taskId);
  } catch (error) {
    return failure(error);
  }
}
