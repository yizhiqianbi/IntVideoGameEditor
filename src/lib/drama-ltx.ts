import { DRAMA_PROMPT_LIMIT } from "./drama";
import { comfyFetch } from "./drama-comfy";
import {
  clampLtxDuration,
  ltxCheckpoint,
  ltxFrameCount,
  type LtxVideoModel,
  validateGpuModel,
} from "./drama-models";

function ltxSize(aspectRatio: unknown) {
  return aspectRatio === "16:9"
    ? [896, 512]
    : aspectRatio === "1:1"
      ? [512, 512]
      : [512, 896];
}

function ltxError(detail: unknown, fallback: string) {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item)
          return String((item as { msg: unknown }).msg);
        return "";
      })
      .filter(Boolean);
    if (msgs.length) return msgs.join("；");
  }
  return fallback;
}

function checkpointPath(model: string) {
  return `?checkpoint=${ltxCheckpoint(model)}`;
}

function requirePrompt(prompt: unknown) {
  if (
    typeof prompt !== "string" ||
    !prompt.trim() ||
    prompt.length > DRAMA_PROMPT_LIMIT
  )
    throw new Error(`镜头描述需要1–${DRAMA_PROMPT_LIMIT}字。`);
  return prompt;
}

function requireLtxDuration(duration: unknown) {
  return clampLtxDuration(duration);
}

export async function ltxHealth() {
  const r = await comfyFetch("/pencil/ltx/health");
  if (!r.ok) throw new Error("LTX 服务未连接");
  return r.json();
}

export async function ltxGenerate(b: Record<string, unknown>) {
  const model =
    b.videoModel === undefined
      ? "ltx-10eros"
      : validateGpuModel(b.videoModel);
  if (model === "ltx-sulphur") return sulphurGenerate(b);
  if (model === "ltx-pinkcherry25") {
    const hasFrame = Boolean(resolveLtxFrame(b));
    if (b.mode === "t2v" || (!b.mode && !hasFrame))
      return ltxT2v(b, "ltx-pinkcherry25", "PinkCherry · LTX-2.5");
    return ltxI2v(b, "ltx-pinkcherry25", "PinkCherry · LTX-2.5");
  }
  if (model !== "ltx-10eros") throw new Error("LTX 任务必须使用独立适配器");
  return ltxI2v(b, "ltx-10eros", "10Eros");
}

function isLtxImageUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/.test(value)
  );
}

function resolveLtxFrame(b: Record<string, unknown>) {
  if (isLtxImageUrl(b.firstFrame)) return b.firstFrame;
  if (Array.isArray(b.references)) return b.references.find(isLtxImageUrl);
}

async function ltxI2v(
  b: Record<string, unknown>,
  videoModel: LtxVideoModel,
  name: string,
) {
  if (b.mode === "ri2v")
    throw new Error(`${name} 当前不支持 RI2V，请改用 H3 Max 参考模式。`);
  if (b.mode !== undefined && b.mode !== "i2v")
    throw new Error(`${name} 图生视频需要单张首帧。`);
  const seconds = requireLtxDuration(b.duration);
  if (b.lastFrame) throw new Error(`${name} 当前不支持尾帧，请清空尾帧图片。`);
  const prompt = requirePrompt(b.prompt);
  const frame = resolveLtxFrame(b);
  if (!frame) throw new Error("请提供首帧图片。");
  const image = await fetch(frame, {
    signal: AbortSignal.timeout(20000),
  });
  if (!image.ok) throw new Error("首帧读取失败");
  const blob = await image.blob();
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(blob.type) ||
    blob.size > 10 * 1024 * 1024
  )
    throw new Error("首帧需为10MB以内的PNG、JPEG或WebP。");
  const [width, height] = ltxSize(b.aspectRatio);
  const form = new FormData();
  form.set(
    "image",
    blob,
    "reference." +
      (blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1]),
  );
  form.set("prompt", prompt);
  form.set("width", String(width));
  form.set("height", String(height));
  form.set("num_frames", String(ltxFrameCount(seconds)));
  form.set("frame_rate", "24");
  form.set("seed", String(Math.floor(Math.random() * 2147483647)));
  const r = await comfyFetch(`/pencil/ltx/i2v${checkpointPath(videoModel)}`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(90000),
  });
  const d = await r.json();
  if (!r.ok)
    throw new Error(ltxError(d.detail, "LTX 提交失败"));
  return {
    taskId: d.id,
    status: "IN_QUEUE" as const,
    videoModel,
    provider: "comfy" as const,
    model: `${name} · I2V`,
  };
}

async function ltxT2v(
  b: Record<string, unknown>,
  videoModel: "ltx-sulphur" | "ltx-pinkcherry25",
  name: string,
) {
  if (b.mode !== undefined && b.mode !== "t2v")
    throw new Error(`${name} 当前支持文生视频。`);
  const seconds = requireLtxDuration(b.duration);
  if (b.lastFrame) throw new Error(`${name} 当前不支持尾帧，请清空尾帧图片。`);
  const prompt = requirePrompt(b.prompt);
  const [width, height] = ltxSize(b.aspectRatio);
  const r = await comfyFetch(`/pencil/ltx/t2v${checkpointPath(videoModel)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      width,
      height,
      num_frames: ltxFrameCount(seconds),
      frame_rate: 24,
      seed: Math.floor(Math.random() * 2147483647),
    }),
    signal: AbortSignal.timeout(90000),
  });
  const d = await r.json();
  if (!r.ok)
    throw new Error(ltxError(d.detail, `${name} 提交失败`));
  return {
    taskId: d.id,
    status: "IN_QUEUE" as const,
    videoModel,
    provider: "comfy" as const,
    model: `${name} · T2V`,
  };
}

export async function sulphurGenerate(b: Record<string, unknown>) {
  return ltxT2v(b, "ltx-sulphur", "Sulphur 2");
}

export async function ltxCancel(taskId?: string) {
  const r = await comfyFetch("/pencil/generate/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      family: "ltx",
      prompt_id: typeof taskId === "string" ? taskId : "",
    }),
  });
  if (r.status === 404) return { ok: true };
  if (!r.ok) throw new Error("LTX 终止失败");
  return { ok: true };
}

export async function ltxStatus(id: string) {
  if (!/^[a-f0-9]{12}$/.test(id)) throw new Error("LTX 任务ID无效");
  const r = await comfyFetch(`/pencil/ltx/jobs/${id}`);
  if (!r.ok) throw new Error("LTX 任务不存在或服务已重启");
  const d = await r.json();
  const status = (
    {
      queued: "IN_QUEUE",
      running: "IN_PROGRESS",
      succeeded: "COMPLETED",
      failed: "FAILED",
    } as Record<string, string>
  )[d.status];
  if (!status) throw new Error("LTX 返回未知任务状态");
  return {
    status,
    error: d.error,
    videoUrl:
      status === "COMPLETED" ? `/api/drama/ltx-media?id=${id}` : undefined,
  };
}
