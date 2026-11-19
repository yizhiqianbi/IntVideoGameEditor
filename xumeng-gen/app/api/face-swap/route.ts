import { AiapiError, checkAiapiTask, submitAiapiTask, type AiapiRequest } from "@/lib/aiapi-channel";
import { findChannelModule } from "@/lib/channel-catalog";
import { channelCredentials } from "@/lib/channel-env";
import { moduleRequest } from "@/lib/channel-form";
import { channelBody, channelFailure, mediaOrigin, publishReference, storeVideo } from "@/lib/channel";
import { mediaUrlProblem } from "@/lib/channel-upload.mjs";
import { editPrompt } from "@/lib/comfy-image.mjs";
import { FACE_VIDEO_PROMPT } from "@/lib/face-video.mjs";
import { HUANLIAN_PROMPT, huanlianTaskId, pollHuanlian, startHuanlian } from "@/lib/huanlian.mjs";
import { imageLitePrompt, imageLiteSizeForPixels, imageLiteTaskId, pollImageLite, startImageLite } from "@/lib/image-lite.mjs";
import { jsonError } from "@/lib/http";
import { normalizeImage } from "@/lib/reference-image.mjs";
import { h3TaskId, pollH3Video } from "@/lib/tencent-video.mjs";
import { imagePixels } from "@/lib/wand-image.mjs";
import { pollSeedream, yunqiaoTaskId } from "@/lib/yunqiao.mjs";

export const maxDuration = 300;
export const runtime = "nodejs";

const LEGACY_VIDEO_TASK = /^face-video-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

function videoFailure(error: unknown) {
  const raw = error instanceof Error ? error.message : "";
  const message = /aborted due to timeout|TimeoutError/i.test(raw) ? "换脸视频这次等太久了。请再试一次。" : (raw || "换脸视频没有完成。");
  const status = message.includes("还没配上") ? 503 : message.includes("等太久") ? 504 : message.includes("太大") ? 413 : 502;
  return jsonError(message, status);
}

function pending(taskId: string) {
  return Response.json({ taskId }, { status: 202, headers: { "cache-control": "no-store" } });
}

function videoPending(taskId: string) {
  return Response.json({ videoTaskId: taskId }, { status: 202, headers: { "Cache-Control": "no-store" } });
}

function videoDone(url: string) {
  return Response.json({ url, type: "video/mp4" }, { headers: { "Cache-Control": "no-store" } });
}

// 图片换脸：WAND Image Lite 两图参考（第一张是原画面，第二张是脸），返回 202 任务号。
async function startImageSwap(face: { bytes: Buffer; type: string }, body: { scene?: unknown; prompt?: unknown }) {
  const written = editPrompt(body.prompt);
  if (!written.ok) return jsonError(written.error || "先写下提示词。", 400);
  const scene = await picture(body.scene);
  if (!scene.ok) return jsonError(scene.error || "这张图片读不了。", 400);
  try {
    const sceneUrl = await publishReference(scene.image.bytes, scene.image.type);
    const faceUrl = await publishReference(face.bytes, face.type);
    const pixels = imagePixels(scene.image.bytes);
    const taskId = await startImageLite({
      prompt: imageLitePrompt(written.prompt),
      imageUrls: [sceneUrl, faceUrl],
      size: imageLiteSizeForPixels(pixels?.width, pixels?.height),
    });
    return pending(taskId);
  } catch (error) {
    return failure(error);
  }
}

// 视频换脸：huanlian 像素换脸（原视频画面保留，只换脸）。
async function startVideoSwap(face: { bytes: Buffer; type: string }, body: { videoUrl?: unknown; prompt?: unknown; seconds?: unknown }) {
  const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl : "";
  const address = mediaUrlProblem(videoUrl, mediaOrigin());
  if (address) return jsonError(address, 400);
  const written = editPrompt(typeof body.prompt === "string" && body.prompt.trim() ? body.prompt : (HUANLIAN_PROMPT || FACE_VIDEO_PROMPT));
  if (!written.ok) return jsonError(written.error || "先写下提示词。", 400);
  try {
    const faceUrl = await publishReference(face.bytes, face.type);
    const started = await startHuanlian({ videoUrl, faceUrl, prompt: written.prompt });
    return videoPending(started.taskId);
  } catch (error) {
    return videoFailure(error);
  }
}

export async function POST(request: Request) {
  // if (!sameOrigin(request)) return jsonError("当前来源不能使用换脸。", 403);
  // if (request.headers.get("x-adult-confirmed") !== "1") return jsonError("需要先确认已满 18 岁。", 403);
  let body: {
    face?: unknown;
    scene?: unknown;
    prompt?: unknown;
    seconds?: unknown;
    taskId?: unknown;
    videoUrl?: unknown;
    videoTaskId?: unknown;
    faceUrl?: unknown;
  };
  try { body = await request.json(); } catch { return jsonError("请求格式无效。", 400); }

  if (typeof body.taskId === "string") {
    if (Object.keys(body).some(key => key !== "taskId")) return jsonError("换脸任务无效。", 400);
    try {
      if (imageLiteTaskId(body.taskId)) {
        const rendered = await pollImageLite(body.taskId);
        if (!rendered) return pending(body.taskId);
        return channelBody(rendered.bytes, rendered.contentType);
      }
      if (!yunqiaoTaskId(body.taskId)) return jsonError("换脸任务无效。", 400);
      const rendered = await pollSeedream(body.taskId);
      if (!rendered) return pending(body.taskId);
      return channelBody(rendered.bytes, rendered.contentType);
    } catch (error) {
      return failure(error);
    }
  }

  if (typeof body.videoTaskId === "string") {
    if (huanlianTaskId(body.videoTaskId)) {
      try {
        const rendered = await pollHuanlian(body.videoTaskId);
        if (!rendered) return videoPending(body.videoTaskId);
        const url = await storeVideo(rendered.bytes, rendered.contentType);
        return videoDone(url);
      } catch (error) {
        return videoFailure(error);
      }
    }
    if (h3TaskId(body.videoTaskId)) {
      try {
        const rendered = await pollH3Video(body.videoTaskId);
        if (!rendered) return videoPending(body.videoTaskId);
        const url = await storeVideo(rendered.bytes, rendered.contentType);
        return videoDone(url);
      } catch (error) {
        return videoFailure(error);
      }
    }
    // 旧的 huanlian 任务号还按老逻辑查完，避免部署切换时丢掉正在跑的任务。
    if (!LEGACY_VIDEO_TASK.test(body.videoTaskId)) return jsonError("换脸任务无效。", 400);
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
      if (checked.phase === "pending") return Response.json({ videoTaskId: body.videoTaskId, videoUrl: body.videoUrl, faceUrl: body.faceUrl }, { status: 202, headers: { "Cache-Control": "no-store" } });
      if (!checked.url) throw new AiapiError("渠道没有返回视频。");
      return videoDone(checked.url);
    } catch (error) {
      return channelFailure(error);
    }
  }

  if (typeof body.videoUrl === "string") {
    if (typeof body.face !== "string") return jsonError("脸和视频都要上传。", 400);
    const face = await picture(body.face);
    if (!face.ok) return jsonError(face.error || "这张图片读不了。", 400);
    return startVideoSwap(face.image, body);
  }

  if (typeof body.face !== "string" || typeof body.scene !== "string") return jsonError("脸和画面都要上传。", 400);
  const face = await picture(body.face);
  if (!face.ok) return jsonError(face.error || "这张图片读不了。", 400);
  return startImageSwap(face.image, body);
}
