import { assetOrigin, noteError, stillPrompt } from "@/lib/catalog";
import { channelBody, channelFailure, ratioForPixels, publishReference, runChannel, webpPixels } from "@/lib/channel";
import { customImage, customImageBytes, imagePixels } from "@/lib/custom-templates";
import { liveImage, localCover } from "@/lib/live-edits";
import { imageBytes, jsonError, sameOrigin } from "@/lib/http";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("当前来源不能使用出图。", 403);
  let body: { templateId?: unknown; note?: unknown; image?: unknown };
  try { body = await request.json(); } catch { return jsonError("请求格式无效。", 400); }
  const templateId = typeof body.templateId === "string" ? body.templateId : "";
  const template = liveImage(templateId);
  if (!template) return jsonError("没有这个画面模板。", 400);
  if (!template.listed) return jsonError("这个模板没有上线。", 400);
  const note = typeof body.note === "string" ? body.note : "";
  const rejected = noteError(note);
  if (rejected) return jsonError(rejected, 400);
  const image = imageBytes(typeof body.image === "string" ? body.image : "");
  if (!image) return jsonError("请先上传 PNG、JPEG 或 WebP 参考图。", 400);
  try {
    let posterUrl: string;
    let poster: { width: number; height: number };
    const uploaded = template.source === "upload" ? customImage(templateId) : null;
    const replaced = uploaded ? null : localCover("image", templateId);
    const local = uploaded ? customImageBytes(uploaded) : replaced;
    if (local) {
      const size = imagePixels(local.bytes);
      if (!size) return jsonError("这个画面模板没有参考图。", 502);
      posterUrl = await publishReference(local.bytes, local.type);
      poster = size;
    } else {
      const remote = `${assetOrigin()}/assets/xumeng/krea2-actions/${template.id}.webp`;
      const posterResponse = await fetch(remote, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
      const posterBytes = new Uint8Array(await posterResponse.arrayBuffer());
      const size = posterResponse.ok ? webpPixels(posterBytes) : null;
      if (!size) return jsonError("这个画面模板没有参考图。", 502);
      posterUrl = remote;
      poster = size;
    }
    const hosted = await publishReference(image.bytes, image.ext === "jpg" ? "image/jpeg" : `image/${image.ext}`);
    const rendered = await runChannel({
      kind: "image",
      prompt: stillPrompt(template.prompt, note),
      imageUrls: [hosted, posterUrl],
      ratio: ratioForPixels(poster.width, poster.height, template.aspectRatio),
    });
    return channelBody(rendered.bytes, rendered.contentType);
  } catch (error) {
    return channelFailure(error);
  }
}
