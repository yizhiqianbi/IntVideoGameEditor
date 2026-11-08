import {
  isDramaTimeoutError,
  isRetryableNetworkError,
  readApiJson,
  translateDramaNetworkError,
} from "./drama-api";

const CHUNK = 1024 * 1024;
const INSPECTOR_VIDEO_MB = 50;
const INSPECTOR_AUDIO_MB = 15;
const TIMELINE_VIDEO_MB = 200;
const TIMELINE_AUDIO_MB = 40;

export type ReferenceMedia = {
  id: string;
  slotId?: string;
  kind: "video" | "audio";
  name: string;
  url: string;
  duration: number;
  prompt?: string;
};

export function validateReferenceMedia(value: unknown): ReferenceMedia[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 6)
    throw new Error("音视频参考数量无效");
  const items = value.map((m): ReferenceMedia => {
    if (
      !m ||
      !/^[a-f0-9]{32}$/.test(m.id) ||
      !["video", "audio"].includes(m.kind) ||
      typeof m.url !== "string" ||
      typeof m.name !== "string" ||
      !Number.isFinite(m.duration) ||
      m.duration < 2 ||
      m.duration > 15.05
    )
      throw new Error("音视频参考数据无效");
    const prompt =
      typeof m.prompt === "string" ? m.prompt.trim().slice(0, 500) : "";
    return {
      id: m.id,
      ...(typeof m.slotId === "string" && /^[a-f0-9]{32}$/.test(m.slotId)
        ? { slotId: m.slotId }
        : {}),
      kind: m.kind,
      url: m.url,
      name: m.name.slice(0, 200),
      duration: m.duration,
      ...(prompt ? { prompt } : {}),
    };
  });
  for (const kind of ["video", "audio"] as const) {
    const group = items.filter((m) => m.kind === kind);
    if (group.length > 3) throw new Error("每类参考最多 3 段");
    if (group.reduce((n, m) => n + m.duration, 0) > 15.05)
      throw new Error("同类参考素材总时长不能超过 15 秒");
  }
  return items;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestSignal(signal?: AbortSignal, ms = 120000) {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  const any = (
    AbortSignal as typeof AbortSignal & {
      any?: (signals: AbortSignal[]) => AbortSignal;
    }
  ).any;
  return any ? any([signal, timeout]) : timeout;
}

async function postReferenceChunk(body: unknown, signal?: AbortSignal) {
  try {
    const response = await fetch("/api/drama/reference-media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: requestSignal(signal, 120000),
    });
    return await readApiJson(response);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (isDramaTimeoutError(error))
      throw new Error("参考视频上传超时，请再试一次");
    throw new Error(translateDramaNetworkError(error, "reference-media"));
  }
}

async function uploadOnce(
  bytes: Uint8Array,
  kind: ReferenceMedia["kind"],
  timeline: boolean,
  progress: (value: number) => void,
  signal?: AbortSignal,
) {
  const id = crypto.randomUUID().replaceAll("-", "");
  const total = Math.ceil(bytes.length / CHUNK);
  let result: { duration?: number } = {};
  for (let index = 0; index < total; index++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const slice = bytes.subarray(index * CHUNK, (index + 1) * CHUNK);
    let binary = "";
    for (let i = 0; i < slice.length; i += 8192)
      binary += String.fromCharCode(...slice.subarray(i, i + 8192));
    result = await postReferenceChunk(
      {
        id,
        kind,
        index,
        total,
        data: btoa(binary),
        ...(timeline ? { timeline: true } : {}),
      },
      signal,
    );
    progress(Math.round(((index + 1) / total) * 100));
  }
  if (!result.duration) throw new Error("参考素材上传未完成");
  return { id, duration: result.duration };
}

export async function uploadReferenceMedia(
  file: Blob,
  name: string,
  kind: ReferenceMedia["kind"],
  progress: (value: number) => void,
  options?: { timeline?: boolean; signal?: AbortSignal },
): Promise<ReferenceMedia> {
  const timeline = options?.timeline === true;
  const limit = timeline
    ? kind === "video"
      ? TIMELINE_VIDEO_MB
      : TIMELINE_AUDIO_MB
    : kind === "video"
      ? INSPECTOR_VIDEO_MB
      : INSPECTOR_AUDIO_MB;
  if (!file.size || file.size > limit * 1024 * 1024)
    throw new Error(
      kind === "video" ? `视频不能超过 ${limit}MB` : `音频不能超过 ${limit}MB`,
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const uploaded = await uploadOnce(
        bytes,
        kind,
        timeline,
        progress,
        options?.signal,
      );
      return {
        id: uploaded.id,
        slotId: uploaded.id,
        kind,
        name,
        duration: uploaded.duration,
        url: `/api/drama/reference-media?id=${uploaded.id}`,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("上传失败");
      if (
        lastError.name === "AbortError" ||
        (!isRetryableNetworkError(error) &&
          !/上传中断|上传超时/.test(lastError.message))
      )
        throw lastError;
      await delay(400 * 2 ** attempt);
    }
  }
  throw lastError;
}
