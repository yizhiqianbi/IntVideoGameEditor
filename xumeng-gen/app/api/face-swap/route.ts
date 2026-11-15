import { channelBody, publishReference } from "@/lib/channel";
import { editPrompt } from "@/lib/comfy-image.mjs";
import { jsonError } from "@/lib/http";
import { normalizeImage } from "@/lib/reference-image.mjs";
import { imagePixels } from "@/lib/wand-image.mjs";
import { pollSeedream, startSeedream, yunqiaoTaskId } from "@/lib/yunqiao.mjs";

export const maxDuration = 300;
export const runtime = "nodejs";

async function picture(value: unknown) {
  if (typeof value !== "string" || !value) return { ok: false as const, error: "这张图片读不了。" };
  const normalized = await normalizeImage(value);
  if (!normalized.ok || !normalized.bytes || !normalized.type) return { ok: false as const, error: normalized.error || "这张图片读不了。" };
  return { ok: true as const, image: { bytes: normalized.bytes, type: normalized.type } };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "换脸没有完成。";
  const status = message.includes("还没配上") ? 503 : 502;
  return jsonError(message, status);
}

function pending(taskId: string) {
  return Response.json({ taskId }, { status: 202, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  // if (!sameOrigin(request)) return jsonError("当前来源不能使用换脸。", 403);
  // if (request.headers.get("x-adult-confirmed") !== "1") return jsonError("需要先确认已满 18 岁。", 403);
  let body: { face?: unknown; scene?: unknown; prompt?: unknown; taskId?: unknown };
  try { body = await request.json(); } catch { return jsonError("请求格式无效。", 400); }
  if (typeof body.taskId === "string") {
    if (Object.keys(body).some(key => key !== "taskId") || !yunqiaoTaskId(body.taskId)) return jsonError("换脸任务无效。", 400);
    try {
      const rendered = await pollSeedream(body.taskId);
      if (!rendered) return pending(body.taskId);
      return channelBody(rendered.bytes, rendered.contentType);
    } catch (error) {
      return failure(error);
    }
  }
  if (typeof body.face !== "string" || typeof body.scene !== "string") return jsonError("脸和画面都要上传。", 400);
  const written = editPrompt(body.prompt);
  if (!written.ok) return jsonError(written.error || "先写下提示词。", 400);
  const scene = await picture(body.scene);
  if (!scene.ok) return jsonError(scene.error || "这张图片读不了。", 400);
  const face = await picture(body.face);
  if (!face.ok) return jsonError(face.error || "这张图片读不了。", 400);
  try {
    const sceneUrl = await publishReference(scene.image.bytes, scene.image.type);
    const faceUrl = await publishReference(face.image.bytes, face.image.type);
    const pixels = imagePixels(scene.image.bytes);
    const taskId = await startSeedream({
      prompt: written.prompt || "",
      imageUrls: [sceneUrl, faceUrl],
      clarity: "hd",
      width: pixels?.width || 0,
      height: pixels?.height || 0,
    });
    return pending(taskId);
  } catch (error) {
    return failure(error);
  }
}
