import { runAiapiRequest, textImageForm, textVideoForm, TEXT_IMAGE_PATH, TEXT_VIDEO_PATH, AiapiError } from "@/lib/aiapi-channel";
import { findChannelModule } from "@/lib/channel-catalog";
import { moduleRequest } from "@/lib/channel-form";
import { publishAsset, publishReference, runChannel } from "@/lib/channel";
import { adultAsk, channelCredentials } from "@/lib/channel-env";
import { assetOrigin, channelVideoPrompt, noteError } from "@/lib/catalog";
import { liveVideo } from "@/lib/live-edits";
import { engineeredImagePrompt } from "@/lib/image-prompt";
import { readAnimeFaces } from "./face-lock.mjs";
import { normalizeImage } from "./reference-image.mjs";

export type Connected = { bytes: Uint8Array; contentType: string };

function refuse(note: string) {
  const rejected = noteError(note);
  if (rejected) throw new AiapiError(rejected, 400);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function runModule(id: string, values: Record<string, string>): Promise<Connected> {
  const module = findChannelModule(id);
  if (!module) throw new AiapiError("没有这个渠道能力。", 400);
  const job = moduleRequest(module, values, `studio-${crypto.randomUUID()}`);
  return runAiapiRequest(channelCredentials(), job);
}

async function hostedImage(image: string): Promise<string> {
  const parsed = await normalizeImage(image);
  if (!parsed.ok || !parsed.bytes || !parsed.type) throw new AiapiError(parsed.error ?? "这张图片读不了。", 400);
  return publishReference(parsed.bytes, parsed.type);
}

export async function connectTextImage(prompt: string): Promise<Connected> {
  refuse(prompt);
  if (!prompt.replace(/\s+/g, " ").trim()) throw new AiapiError("先写一句想画的内容。", 400);
  let engineered = "";
  try {
    engineered = await engineeredImagePrompt(prompt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "提示词设计没有完成。";
    const status = message.includes("还没配上") || message.includes("地址无效") ? 503 : 502;
    throw new AiapiError(message, status);
  }
  refuse(engineered);
  const framed = `${engineered}, fictional adult aged 21 or older`.slice(0, 2000);
  return runAiapiRequest(channelCredentials(), {
    path: TEXT_IMAGE_PATH,
    form: textImageForm(framed, `aiapi-${crypto.randomUUID()}`),
    kind: "image",
    timeoutMs: 220_000,
  });
}

export async function connectTextVideo(prompt: string): Promise<Connected> {
  refuse(prompt);
  if (!prompt.replace(/\s+/g, " ").trim()) throw new AiapiError("先写一句想看的动作。", 400);
  const rendered = await runAiapiRequest(channelCredentials(), {
    path: TEXT_VIDEO_PATH,
    form: textVideoForm(adultAsk(prompt), `aiapi-${crypto.randomUUID()}`),
    kind: "video",
    timeoutMs: 240_000,
  });
  return { bytes: rendered.bytes, contentType: "video/mp4" };
}

export async function connectTemplateVideo(templateId: string, note: string, image: string): Promise<Connected> {
  const template = liveVideo(templateId);
  if (!template) throw new AiapiError("没有这个动作模板。", 400);
  if (!template.listed) throw new AiapiError("这个模板没有上线。", 400);
  refuse(note);
  const videoUrl = `${assetOrigin()}/assets/xumeng/h3-actions/${template.id}.mp4`;
  const asset = await fetch(videoUrl, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
  await asset.body?.cancel();
  if (!asset.ok) throw new AiapiError("这个动作模板没有参考视频。", 502);
  const hosted = await hostedImage(image);
  const rendered = await runChannel({
    kind: "video",
    prompt: channelVideoPrompt(template.action, note),
    imageUrls: [hosted],
    videoUrls: [videoUrl],
    seconds: 8,
    ratio: "9:16",
  });
  return { bytes: rendered.bytes, contentType: "video/mp4" };
}

export async function connectRedraw(prompt: string, image: string): Promise<Connected> {
  refuse(prompt);
  if (!prompt.replace(/\s+/g, " ").trim()) throw new AiapiError("先写下要怎么改。", 400);
  const imgUrl = await hostedImage(image);
  return runModule("tushengtu", { img_url: imgUrl, positive_prompt: prompt });
}

export async function connectImageVideo(prompt: string, image: string, seconds: string): Promise<Connected> {
  refuse(prompt);
  if (!prompt.replace(/\s+/g, " ").trim()) throw new AiapiError("先写一句这一镜的动作。", 400);
  const imgUrl = await hostedImage(image);
  if (seconds === "20") {
    return runModule("i2v_10eros", { img_url: imgUrl, positive_prompt: prompt, duration: "20" });
  }
  return runModule("ai_chuangzuo_tushengshipin_8s", { img_url: imgUrl, positive_prompt: prompt });
}

export async function connectNovel(
  description: string,
  characterSetting = "",
  count = "",
  locationScene = "",
  details = "",
): Promise<Connected> {
  refuse([description, characterSetting, locationScene, details].join("\n"));
  if (!description.replace(/\s+/g, " ").trim()) throw new AiapiError("先写剧情。", 400);
  const values: Record<string, string> = { description };
  if (characterSetting.trim()) values.character_setting = characterSetting;
  if (locationScene.trim()) values.location_scene = locationScene;
  if (details.trim()) values.details = details;
  if (count.trim()) values.count = count;
  return runModule("generate-novel", values);
}

export async function connectNovelContinue(source: string, count = "", extra: Record<string, string> = {}): Promise<Connected> {
  refuse([source, extra.character_setting, extra.location_scene, extra.details, extra.plot_direction].filter(Boolean).join("\n"));
  if (!source.replace(/\s+/g, " ").trim()) throw new AiapiError("先贴上已有正文。", 400);
  const bytes = Buffer.from(source, "utf8");
  if (bytes.length > 1_000_000) throw new AiapiError("上传的文件太大。", 413);
  const fileUrl = await publishAsset(bytes, "text/plain; charset=utf-8");
  const values: Record<string, string> = { file_url: fileUrl };
  if (count.trim()) values.count = count;
  for (const key of ["character_setting", "location_scene", "details", "plot_direction", "continuation_type"] as const) {
    const value = extra[key]?.trim();
    if (value) values[key] = value;
  }
  return runModule("continue-novel", values);
}

export async function connectAnimeFace(face: string, scene: string): Promise<Connected> {
  // const verdict = await readAnimeFaces(face, scene);
  // if (!verdict.ok) throw new AiapiError(verdict.error || "检测没有通过，换脸已锁定。", verdict.status || 422);
  const faceUrl = await hostedImage(face);
  const sceneUrl = await hostedImage(scene);
  return runModule("generate-face-swap", { source_path: faceUrl, target_path: sceneUrl });
}

export async function connectStudio(kind: string, body: Record<string, unknown>): Promise<Connected> {
  if (kind === "text-image") return connectTextImage(text(body.prompt));
  if (kind === "text-video") return connectTextVideo(text(body.prompt));
  if (kind === "template-video") return connectTemplateVideo(text(body.templateId), text(body.note), text(body.image));
  if (kind === "redraw") return connectRedraw(text(body.prompt), text(body.image));
  if (kind === "image-video") return connectImageVideo(text(body.prompt), text(body.image), text(body.seconds));
  if (kind === "novel") return connectNovel(text(body.description), text(body.characterSetting), text(body.count));
  if (kind === "novel-continue") return connectNovelContinue(text(body.source), text(body.count));
  throw new AiapiError("没有这个接法。", 400);
}
