import { AiapiError, checkAiapiTask, submitAiapiTask, type AiapiRequest } from "@/lib/aiapi-channel";
import { findChannelModule } from "@/lib/channel-catalog";
import { channelCredentials } from "@/lib/channel-env";
import { moduleRequest } from "@/lib/channel-form";
import { channelBody, channelFailure, mediaOrigin, publishReference } from "@/lib/channel";
import { mediaUrlProblem } from "@/lib/channel-upload.mjs";
import { editPrompt } from "@/lib/comfy-image.mjs";
import { FACE_VIDEO_PROMPT } from "@/lib/face-video.mjs";
import { jsonError } from "@/lib/http";
import { normalizeImage } from "@/lib/reference-image.mjs";
import { imagePixels } from "@/lib/wand-image.mjs";
import { pollSeedream, startSeedream, yunqiaoTaskId } from "@/lib/yunqiao.mjs";

export const maxDuration = 300;
export const runtime = "nodejs";

const VIDEO_TASK = /^face-video-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function picture(value: unknown) {
  if (typeof value !== "string" || !value) return { ok: false as const, error: "这张图片读不了。" };
  const normalized = await normalizeImage(value);
  if (!normalized.ok || !normalized.bytes || !normalized.type) return { ok: false as const, error: normalized.error || "这张图片读不了。" };
  return { ok: true as const, image: { bytes: normalized.bytes, type: normalized.type } };
}

function failure(error: unknown) {
  const raw = error instanceof Error ? error.message : "";
  const message = /aborted due to timeout|TimeoutError/i.test(raw) ? "换脸这次等太久了。请再试一次。" : (raw || "换脸没有完成。");
  const status = message.includes("还没配上") ? 503 : message.includes("等太久了") ? 504 : 502;
  return jsonError(message, status);
}

function pending(taskId: string) {
  return Response.json({ taskId }, { status: 202, headers: { "cache-control": "no-store" } });
}

function videoPending(taskId: string, videoUrl: string, faceUrl: string) {
  return Response.json({ videoTaskId: taskId, videoUrl, faceUrl }, { status: 202, headers: { "Cache-Control": "no-store" } });
}

function videoDone(url: string) {
  return Response.json({ url, type: "video/mp4" }, { headers: { "Cache-Control": "no-store" } });
}

// 视频换脸：视频先由浏览器直传渠道素材库（不经过 Vercel 的 4.5MB 请求体），这里把地址和人脸
// 交给 huanlian。任务号和两个素材地址交回浏览器，由浏览器每 4 秒回来查一次；成片只回地址，
// 避免超过 Vercel 4.5MB 的响应上限。
export async function POST(request: Request) {
  // if (!sameOrigin(request)) return jsonError("当前来源不能使用换脸。", 403);
  // if (request.headers.get("x-adult-confirmed") !== "1") return jsonError("需要先确认已满 18 岁。", 403);
  let body: {
    face?: unknown;
    scene?: unknown;
    prompt?: unknown;
    taskId?: unknown;
    videoUrl?: unknown;
    videoTaskId?: unknown;
    faceUrl?: unknown;
  };
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

  if (typeof body.videoTaskId === "string") {
    if (!VIDEO_TASK.test(body.videoTaskId)) return jsonError("换脸任务无效。", 400);
    if (typeof body.videoUrl !== "string" || typeof body.faceUrl !== "string") return jsonError("换脸任务无效。", 400);
    const videoAddress = mediaUrlProblem(body.videoUrl, mediaOrigin());
    if (videoAddress) return jsonError(videoAddress, 400);
    const faceAddress = mediaUrlProblem(body.faceUrl, mediaOrigin());
    if (faceAddress) return jsonError(faceAddress, 400);
    const module = findChannelModule("huanlian");
    if (!module) return jsonError("视频换脸通道还没配上。", 503);
    const poll: AiapiRequest = {
      path: module.path,
      form: new URLSearchParams({ task_id: body.videoTaskId }),
      kind: "video",
      inputs: [body.videoUrl, body.faceUrl],
      timeoutMs: 0,
    };
    try {
      const checked = await checkAiapiTask(channelCredentials(), poll, body.videoTaskId);
      if (checked.phase === "failed") throw new AiapiError(checked.error || "换脸没有完成。");
      if (checked.phase === "pending") return videoPending(body.videoTaskId, body.videoUrl, body.faceUrl);
      if (!checked.url) throw new AiapiError("渠道没有返回视频。");
      return videoDone(checked.url);
    } catch (error) {
      return channelFailure(error);
    }
  }

  if (typeof body.videoUrl === "string") {
    if (typeof body.face !== "string") return jsonError("脸和视频都要上传。", 400);
    const address = mediaUrlProblem(body.videoUrl, mediaOrigin());
    if (address) return jsonError(address, 400);
    const written = editPrompt(typeof body.prompt === "string" && body.prompt.trim() ? body.prompt : FACE_VIDEO_PROMPT);
    if (!written.ok) return jsonError(written.error || "先写下提示词。", 400);
    const module = findChannelModule("huanlian");
    if (!module) return jsonError("视频换脸通道还没配上。", 503);
    const face = await picture(body.face);
    if (!face.ok) return jsonError(face.error || "这张图片读不了。", 400);
    let faceUrl: string;
    try {
      faceUrl = await publishReference(face.image.bytes, face.image.type);
    } catch (error) {
      return failure(error);
    }
    const taskId = `face-video-${crypto.randomUUID()}`;
    try {
      const started = await submitAiapiTask(channelCredentials(), moduleRequest(module, {
        video_url: body.videoUrl,
        img_url: faceUrl,
        positive_prompt: written.prompt || FACE_VIDEO_PROMPT,
      }, taskId));
      if (started.phase === "failed") throw new AiapiError(started.error || "换脸没有完成。");
      if (started.phase === "done" && started.url) return videoDone(started.url);
      return videoPending(taskId, body.videoUrl, faceUrl);
    } catch (error) {
      return channelFailure(error);
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
      clarity: "sd",
      width: pixels?.width || 0,
      height: pixels?.height || 0,
    });
    return pending(taskId);
  } catch (error) {
    return failure(error);
  }
}
