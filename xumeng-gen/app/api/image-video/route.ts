import { channelBody, publishReference, storeVideo } from "@/lib/channel";
import { adultAsk } from "@/lib/channel-env";
import { jsonError, sameOrigin } from "@/lib/http";
import { fitVideoFrame, normalizeImage } from "@/lib/reference-image.mjs";
import { buildImageVideo } from "@/lib/studio-page.mjs";
import { h3Duration, h3TaskId, pollH3Video, startH3Video } from "@/lib/tencent-video.mjs";
import { pollVideoLite, startVideoLite, videoLiteTaskId } from "@/lib/wand-video-lite.mjs";
import { pollWandVideo } from "@/lib/wand-video.mjs";

export const maxDuration = 300;
export const runtime = "nodejs";

function wandTaskId(value: string) {
  return /^\d+-AigcVideoTask-[A-Za-z0-9]+$/.test(value);
}

function failure(error: unknown) {
  const raw = error instanceof Error ? error.message : "";
  const message = /aborted due to timeout|TimeoutError/i.test(raw) ? "视频这次等太久了。请再试一次。" : (raw || "视频没有完成。");
  const status = message.includes("还没配上") ? 503 : message.includes("等太久") ? 504 : message.includes("太大") ? 413 : 502;
  return jsonError(message, status);
}

function pending(taskId: string) {
  return Response.json({ taskId }, { status: 202, headers: { "cache-control": "no-store" } });
}

function done(url: string) {
  return Response.json({ url, type: "video/mp4" }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("当前来源不能使用视频通道。", 403);
  if (request.headers.get("x-adult-confirmed") !== "1") return jsonError("需要先确认已满 18 岁。", 403);
  let body: { image?: unknown; action?: unknown; seconds?: unknown; taskId?: unknown };
  try { body = await request.json(); } catch { return jsonError("请求格式无效。", 400); }
  if (typeof body.taskId === "string") {
    if (Object.keys(body).some(key => key !== "taskId")) return jsonError("视频任务无效。", 400);
    try {
      if (videoLiteTaskId(body.taskId)) {
        const rendered = await pollVideoLite(body.taskId);
        if (!rendered) return pending(body.taskId);
        const url = await storeVideo(rendered.bytes, rendered.contentType);
        return done(url);
      }
      if (h3TaskId(body.taskId)) {
        const rendered = await pollH3Video(body.taskId);
        if (!rendered) return pending(body.taskId);
        const url = await storeVideo(rendered.bytes, rendered.contentType);
        return done(url);
      }
      if (!wandTaskId(body.taskId)) return jsonError("视频任务无效。", 400);
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
  const imageUrls: string[] = [];
  for (const source of sources) {
    const normalized = await normalizeImage(typeof source === "string" ? source : "");
    if (!normalized.ok || !normalized.bytes || !normalized.type) return jsonError(normalized.error || "这张图片读不了。", 400);
    // 首帧模式裁成标准画幅；参考模式保留原图。
    const fitted = built.mode === "first" ? await fitVideoFrame(normalized.bytes).catch(() => null) : null;
    try {
      imageUrls.push(await publishReference(fitted?.bytes || normalized.bytes, fitted?.type || normalized.type));
    } catch (error) {
      const message = error instanceof Error ? error.message : "参考图没有传上去。";
      return jsonError(message, message.includes("还没配上") ? 503 : 502);
    }
  }
  const prompt = built.values.positive_prompt.includes("二十一岁") ? built.values.positive_prompt : adultAsk(built.values.positive_prompt);
  try {
    // 默认走上一版：MiniMax H3 fast；设 TENCENT_VIDEO_PROVIDER=wand-lite 切到 WAND 1.5 Lite。
    if (process.env.TENCENT_VIDEO_PROVIDER === "wand-lite") {
      const taskId = await startVideoLite({
        prompt,
        firstFrame: built.mode === "first" ? imageUrls[0] : "",
        imageUrls: built.mode === "reference" ? imageUrls : [],
        duration: built.seconds,
        resolution: "720P",
        ratio: built.mode === "reference" ? "adaptive" : undefined,
      });
      return pending(taskId);
    }
    const taskId = await startH3Video({
      prompt,
      firstFrame: built.mode === "first" ? imageUrls[0] : "",
      imageUrls: built.mode === "reference" ? imageUrls : [],
      duration: h3Duration(built.seconds),
      resolution: "720P",
      ratio: built.mode === "reference" ? "adaptive" : undefined,
      removeAudio: false,
    });
    return pending(taskId);
  } catch (error) {
    return failure(error);
  }
}
