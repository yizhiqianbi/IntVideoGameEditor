import { DEFAULT_PROMPTS } from "@/components/modules/prompt-defaults.js";
import { channelBody, publishReference } from "@/lib/channel";
import { editPrompt } from "@/lib/comfy-image.mjs";
import { jsonError, sameOrigin } from "@/lib/http";
import { normalizeImage } from "@/lib/reference-image.mjs";
import { pollSeedream, startSeedream, yunqiaoTaskId } from "@/lib/yunqiao.mjs";

export const maxDuration = 300;
export const runtime = "nodejs";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "去外套没有完成。";
  const status = message.includes("还没配上") ? 503 : 502;
  return jsonError(message, status);
}

function pending(taskId: string) {
  return Response.json({ taskId }, { status: 202, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("当前来源不能使用去外套。", 403);
  if (request.headers.get("x-adult-confirmed") !== "1") return jsonError("需要先确认已满 18 岁。", 403);
  let body: { image?: unknown; prompt?: unknown; references?: unknown; ratio?: unknown; taskId?: unknown };
  try { body = await request.json(); } catch { return jsonError("请求格式无效。", 400); }
  if (typeof body.taskId === "string") {
    if (Object.keys(body).some(key => key !== "taskId") || !yunqiaoTaskId(body.taskId)) return jsonError("去外套任务无效。", 400);
    try {
      const rendered = await pollSeedream(body.taskId);
      if (!rendered) return pending(body.taskId);
      return channelBody(rendered.bytes, rendered.contentType);
    } catch (error) {
      return failure(error);
    }
  }
  if (typeof body.image !== "string" || !body.image) return jsonError("先上传一张人物图。", 400);
  const typed = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const written = typed ? editPrompt(typed) : { ok: true as const, prompt: DEFAULT_PROMPTS.coat };
  if (!written.ok) return jsonError(written.error || "先写下提示词。", 400);
  const normalized = await normalizeImage(body.image);
  if (!normalized.ok || !normalized.bytes || !normalized.type) return jsonError(normalized.error || "这张图片读不了。", 400);
  const references = Array.isArray(body.references) ? body.references.slice(0, 2) : [];
  try {
    const imageUrls = [];
    const sources = [normalized, ...await Promise.all(references.filter(item => typeof item === "string" && item).map(item => normalizeImage(item)))];
    for (const source of sources) {
      if (!source.ok || !source.bytes || !source.type) return jsonError(source.error || "这张图片读不了。", 400);
      imageUrls.push(await publishReference(source.bytes, source.type));
    }
    const aspect = body.ratio === "landscape" ? "16:9" : body.ratio === "square" ? "1:1" : "9:16";
    const taskId = await startSeedream({
      prompt: written.prompt || "",
      imageUrls,
      clarity: "hd",
      aspectRatio: aspect,
    });
    return pending(taskId);
  } catch (error) {
    return failure(error);
  }
}
