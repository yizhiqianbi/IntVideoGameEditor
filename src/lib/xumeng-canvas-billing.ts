/** Canvas generation prices. ¥1 = 100 Credit. One image is 1 毛 (10 Credit). */
export const CANVAS_IMAGE_CREDITS = 10;
export const CANVAS_VIDEO_CREDITS_PER_SECOND = 10;
/** wan3.0 retail prices. ¥1 = 100 Credit. 1080P is ¥1.50/s, and 720P is half of that. */
export const CANVAS_WAN_MODEL = "wan3.0";
/** w3.0 is the slower stand channel. It uses the same resolution prices as wan3.0. */
export const CANVAS_W3_MODEL = "w3.0";

export function canvasResolutionVideo(model: unknown): boolean {
  return model === CANVAS_WAN_MODEL || model === CANVAS_W3_MODEL;
}

/**
 * WhatsToken retail for the 720P request this canvas sends.
 * Sale USD × ¥7.2 × 1.5, rounded up to the next Credit. ¥1 = 100 Credit.
 * Checked 2026-11-03. Sound stays off, and reference video is not sent.
 * Seedance is per token: 720p is 21600 tokens/second, no reference video.
 * MiniMax H3 has no 720p tier, so this uses its 768p rate.
 */
export const CANVAS_TOKEN_VIDEOS = {
  "wan3.0-prime": { name: "wan3.0 Prime", creditsPerSecond: 134 },
  "kling-omni": { name: "可灵 Omni", creditsPerSecond: 76 },
  "kling-o1": { name: "可灵 O1", creditsPerSecond: 98 },
  "kling-v3": { name: "可灵 V3", creditsPerSecond: 76 },
  "kling-turbo": { name: "可灵 Turbo", creditsPerSecond: 133 },
  "seedance-2.0": { name: "Seedance 2.0", creditsPerSecond: 234 },
  "seedance-2.5": { name: "Seedance 2.5", creditsPerSecond: 357 },
  "minimax-h3": { name: "MiniMax H3", creditsPerSecond: 84 },
  "vidu-q4": { name: "Vidu Q4", creditsPerSecond: 103 },
} as const;

/** WhatsToken stills. Per-image sale USD × ¥7.2 × 1.5, one charge per picture. */
export const CANVAS_TOKEN_IMAGES = {
  "seedream-4.5": { name: "Seedream 4.5", credits: 40 },
  "seedream-5.0": { name: "Seedream 5.0", credits: 35 },
  "gpt-image-flare": { name: "GPT Image Flare", credits: 34 },
  "gpt-image-sunburst": { name: "GPT Image Sunburst", credits: 34 },
} as const;

export type CanvasTokenVideoModel = keyof typeof CANVAS_TOKEN_VIDEOS;
export type CanvasTokenImageModel = keyof typeof CANVAS_TOKEN_IMAGES;

export function canvasTokenVideo(model: unknown): model is CanvasTokenVideoModel {
  return typeof model === "string" && Object.prototype.hasOwnProperty.call(CANVAS_TOKEN_VIDEOS, model);
}

export function canvasTokenImage(model: unknown): model is CanvasTokenImageModel {
  return typeof model === "string" && Object.prototype.hasOwnProperty.call(CANVAS_TOKEN_IMAGES, model);
}

export function canvasAsyncVideo(model: unknown): boolean {
  return canvasResolutionVideo(model) || canvasTokenVideo(model);
}
export const CANVAS_WAN_SECONDS_MIN = 2;
export const CANVAS_WAN_RESOLUTIONS = ["480P", "720P", "1080P"] as const;
export const CANVAS_WAN_DEFAULT_RESOLUTION = "720P";
export const CANVAS_WAN_CREDITS_PER_SECOND = {
  "480P": 38,
  "720P": 75,
  "1080P": 150,
} as const;
/** MiniMax H3 canvas clip: chosen seconds at 24 fps, plus the two-frame H3 tail. */
export const CANVAS_VIDEO_FPS = 24;
export const CANVAS_VIDEO_SECONDS_MIN = 1;
export const CANVAS_VIDEO_SECONDS_MAX = 15;
export const CANVAS_VIDEO_SECONDS_DEFAULT = 5;
export const CANVAS_VIDEO_FRAMES = CANVAS_VIDEO_SECONDS_DEFAULT * CANVAS_VIDEO_FPS + 2;

export function canvasVideoDuration(value: unknown = CANVAS_VIDEO_SECONDS_DEFAULT): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < CANVAS_VIDEO_SECONDS_MIN ||
    value > CANVAS_VIDEO_SECONDS_MAX
  ) {
    throw new Error("视频时长无效。");
  }
  return value;
}

export function canvasVideoFramesFor(seconds: number): number {
  return canvasVideoDuration(seconds) * CANVAS_VIDEO_FPS + 2;
}

export function canvasVideoSeconds(frames = CANVAS_VIDEO_FRAMES, fps = CANVAS_VIDEO_FPS): number {
  if (!Number.isInteger(frames) || !Number.isInteger(fps) || frames < 1 || fps < 1) {
    throw new Error("视频时长无效。");
  }
  return Math.max(1, Math.round(frames / fps));
}

export function canvasVideoCredits(frames = CANVAS_VIDEO_FRAMES, fps = CANVAS_VIDEO_FPS): number {
  return canvasVideoSeconds(frames, fps) * CANVAS_VIDEO_CREDITS_PER_SECOND;
}

export function canvasVideoCreditsFor(seconds: unknown = CANVAS_VIDEO_SECONDS_DEFAULT): number {
  return canvasVideoDuration(seconds) * CANVAS_VIDEO_CREDITS_PER_SECOND;
}

export function canvasWanVideoDuration(value: unknown = CANVAS_VIDEO_SECONDS_DEFAULT): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < CANVAS_WAN_SECONDS_MIN ||
    value > CANVAS_VIDEO_SECONDS_MAX
  ) {
    throw new Error("视频时长无效。");
  }
  return value;
}

export function canvasWanResolution(value: unknown): keyof typeof CANVAS_WAN_CREDITS_PER_SECOND {
  if (value === "480P" || value === "720P" || value === "1080P") return value;
  throw new Error("视频分辨率无效。");
}

export function canvasWanVideoCreditsFor(seconds: unknown, resolution: unknown): number {
  return canvasWanVideoDuration(seconds) * CANVAS_WAN_CREDITS_PER_SECOND[canvasWanResolution(resolution)];
}

export function canvasTokenVideoCreditsFor(seconds: unknown, model: unknown): number {
  if (!canvasTokenVideo(model)) throw new Error("视频模型无效。");
  return canvasWanVideoDuration(seconds) * CANVAS_TOKEN_VIDEOS[model].creditsPerSecond;
}

export function canvasTokenImageCredits(model: unknown): number {
  if (!canvasTokenImage(model)) throw new Error("出图模型无效。");
  return CANVAS_TOKEN_IMAGES[model].credits;
}
