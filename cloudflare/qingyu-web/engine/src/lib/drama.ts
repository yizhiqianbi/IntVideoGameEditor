import type { GpuVideoModel } from "./drama-models";
import type { TimelineDirectorState } from "./drama-timeline";
import { validateReferenceMedia, type ReferenceMedia } from "./drama-reference-media";
export type DramaMode = "t2v" | "i2v" | "ri2v";
/** GPU / local H3 has no 7000-char product cap; keep a sanity bound. */
export const DRAMA_PROMPT_LIMIT = 32_000;
/** MiniMax / fal.ai documented prompt cap. */
export const FAL_PROMPT_LIMIT = 7_000;
export const SHOT_FIELD_LIMIT = 8_000;
export function promptCharLimit(provider?: unknown) {
  return provider === "fal" ? FAL_PROMPT_LIMIT : DRAMA_PROMPT_LIMIT;
}
export const DRAMA_MODELS = {
  t2v: "minimax/h3-max-turbo/text-to-video",
  i2v: "minimax/h3-max-turbo/image-to-video",
  ri2v: "minimax/h3-max/reference-to-video",
} as const;
export type Shot = {
  id: string;
  title: string;
  prompt: string;
  promptFields?: {
    start?: string;
    action?: string;
    camera?: string;
    setting?: string;
    sound?: string;
    end?: string;
  };
  modelPick?: "auto" | "manual";
  negativePrompt?: string;
  mode: DramaMode;
  firstFrame: string;
  lastFrame: string;
  references: string;
  referenceMedia?: ReferenceMedia[];
  timelineDirector?: TimelineDirectorState;
  referenceBindings?: Record<string, string>;
  duration?: number;
  parentId?: string;
  assetIds?: string[];
  taskId?: string;
  taskMode?: DramaMode;
  videoModel?: GpuVideoModel;
  taskVideoModel?: GpuVideoModel;
  taskProvider?: "fal" | "comfy";
  status?: string;
  generationStartedAt?: number;
  generationFinishedAt?: number;
  statusUpdatedAt?: number;
  queuePosition?: number;
  videoUrl?: string;
  endStill?: string;
  endFrameAssetId?: string;
  startFrameAssetId?: string;
  error?: string;
  position: { x: number; y: number };
  positionLocked?: boolean;
};
export function newShot(
  index: number,
  title = `镜头 ${index + 1}`,
  prompt = "",
): Shot {
  return {
    id: crypto.randomUUID(),
    title,
    prompt,
    promptFields: prompt ? { action: prompt } : undefined,
    modelPick: "auto",
    negativePrompt: "",
    mode: "t2v",
    firstFrame: "",
    lastFrame: "",
    references: "",
    position: { x: (index % 3) * 350, y: Math.floor(index / 3) * 320 },
  };
}
export function buildDramaInput(b: Record<string, unknown>) {
  const media = validateReferenceMedia(b.referenceMedia);
  if (media.length && (b.provider !== "comfy" || b.videoModel !== "h3" || b.mode !== "ri2v"))
    throw new Error("音视频参考请使用自有 GPU 的 H3 参考模式");
  if (media.length && (b.firstFrame || b.lastFrame)) throw new Error("音视频参考不能与首尾帧混用，请清空首尾帧");
  const promptLimit = promptCharLimit(b.provider);
  if (
    typeof b.prompt !== "string" ||
    !b.prompt.trim() ||
    b.prompt.length > promptLimit
  )
    throw new Error(
      b.provider === "fal"
        ? "镜头描述（含角色卡拼装）需要 1–7000 个字符"
        : `镜头描述需要 1–${DRAMA_PROMPT_LIMIT} 个字符`,
    );
  const input: Record<string, unknown> = {
    prompt: b.prompt,
    duration: 15,
    resolution: "480P",
    prompt_expansion_mode: "balanced",
    enable_safety_checker: false,
  };
  const url = (v: unknown) => {
    if (typeof v !== "string") throw new Error("图片链接无效");
    if (v.startsWith("comfy-input:")) {
      if (!/^comfy-input:pencil_stills\/[a-f0-9]{32}\.(png|jpg|jpeg|webp)$/.test(v))
        throw new Error("GPU 参考图文件名无效");
      return v;
    }
    if (
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) &&
      v.length <= 3 * 1024 * 1024
    )
      return v;
    if (v.startsWith("/api/drama/")) return v;
    const u = new URL(v);
    if (!["https:", "http:"].includes(u.protocol))
      throw new Error("请填写公开 HTTP(S) 图片链接");
    return v;
  };
  if (b.mode === "i2v") {
    if (!b.firstFrame) throw new Error("请填写首帧图片链接");
    input.image_url = url(b.firstFrame);
    if (b.lastFrame) input.end_image_url = url(b.lastFrame);
  } else {
    if (!["9:16", "16:9", "1:1"].includes(String(b.aspectRatio)))
      throw new Error("画幅无效");
    input.aspect_ratio = b.aspectRatio;
    if (b.mode === "ri2v") {
      if (
        !Array.isArray(b.references) ||
        (!b.references.length && !media.some(m => m.kind === "video")) ||
        b.references.length > 9
      )
        throw new Error("请提供参考图片或视频；独立音频需搭配图片或视频");
      input.reference_image_urls = b.references.map(url);
    } else if (b.mode !== "t2v") throw new Error("生成模式无效");
  }
  return input;
}
