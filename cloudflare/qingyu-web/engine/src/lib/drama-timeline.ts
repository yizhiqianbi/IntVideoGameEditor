import { DRAMA_PROMPT_LIMIT } from "./drama";
import { orderBoundImages } from "./drama-mentions";
import type { ReferenceMedia } from "./drama-reference-media";

export const H3_FPS = 24;
export const DIRECTOR_DURATION_MIN = 3;
export const DIRECTOR_DURATION_MAX = 60;
export const DIRECTOR_MAX_SEGMENTS = 8;
export const CONTINUATION_OVERLAP = 39;
export const REFERENCE_MODES = ["guide", "edit", "boundary"] as const;
export const AUDIO_MODES = ["reference", "locked"] as const;

export type TimelineReferenceMode = (typeof REFERENCE_MODES)[number];
export type TimelineAudioMode = (typeof AUDIO_MODES)[number];

export type TimelineVideoClip = {
  id: string;
  mediaId: string;
  name: string;
  sourceDuration: number;
  start: number;
  trimStart: number;
  duration: number;
  hasAudio: boolean;
  referenceMode: TimelineReferenceMode;
};

export type TimelineImage = {
  id: string;
  name: string;
  url: string;
  file?: string;
};

export type TimelineAudio = {
  id: string;
  mediaId: string;
  name: string;
  sourceDuration: number;
  trimStart: number;
  duration: number;
  audioMode: TimelineAudioMode;
};

export type TimelineSegment = {
  startFrame: number;
  endFrame: number;
  prompt: string;
  imageIds: string[];
  audioIds: string[];
};

export type TimelineDirectorState = {
  enabled: boolean;
  videoAudioEnabled: boolean;
  globalPrompt: string;
  videoClips: TimelineVideoClip[];
  images: TimelineImage[];
  audios: TimelineAudio[];
  segments: TimelineSegment[];
};

export function alignedLength(frames: number, minimum = 5) {
  const lower = 5 + 17 * Math.max(0, Math.ceil((minimum - 5) / 17));
  return Math.min(
    3592,
    Math.max(lower, 5 + 17 * Math.max(0, Math.round((frames - 5) / 17))),
  );
}

export function nearestOverlap(frames: number, maximum: number) {
  const choices = [
    0,
    1,
    ...Array.from(
      { length: Math.max(0, Math.floor((maximum - 5) / 17) + 1) },
      (_, i) => 5 + 17 * i,
    ),
  ].filter((n) => n <= maximum);
  return choices.reduce(
    (best, n) => (Math.abs(n - frames) < Math.abs(best - frames) ? n : best),
    0,
  );
}

export function framesForSeconds(seconds: number) {
  return alignedLength(Math.max(5, Math.round(seconds * H3_FPS)));
}

export function parseDirectorDuration(value: unknown) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < DIRECTOR_DURATION_MIN)
    return 15;
  return Math.min(DIRECTOR_DURATION_MAX, n);
}

export function emptyDirector(seconds = 15): TimelineDirectorState {
  const length = framesForSeconds(parseDirectorDuration(seconds));
  return {
    enabled: false,
    videoAudioEnabled: true,
    globalPrompt: "",
    videoClips: [],
    images: [],
    audios: [],
    segments: [{ startFrame: 0, endFrame: length, prompt: "", imageIds: [], audioIds: [] }],
  };
}

export function directorOf(value: unknown, seconds = 15): TimelineDirectorState {
  const fallback = emptyDirector(seconds);
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Record<string, unknown>;
  if (raw.enabled !== true && raw.enabled !== false) return fallback;
  return {
    enabled: raw.enabled === true,
    videoAudioEnabled: raw.videoAudioEnabled !== false,
    globalPrompt:
      typeof raw.globalPrompt === "string"
        ? raw.globalPrompt.slice(0, DRAMA_PROMPT_LIMIT)
        : "",
    videoClips: Array.isArray(raw.videoClips)
      ? raw.videoClips.map(readVideoClip).filter((c): c is TimelineVideoClip => !!c)
      : [],
    images: Array.isArray(raw.images)
      ? raw.images.map(readImage).filter((c): c is TimelineImage => !!c)
      : [],
    audios: Array.isArray(raw.audios)
      ? raw.audios.map(readAudio).filter((c): c is TimelineAudio => !!c)
      : [],
    segments: normalizeSegments(
      Array.isArray(raw.segments) ? raw.segments : [],
      seconds,
    ),
  };
}

export function isDirectorEnabled(value: unknown): value is TimelineDirectorState {
  return !!value && typeof value === "object" && (value as TimelineDirectorState).enabled === true;
}

export function directorOutputSeconds(director: TimelineDirectorState) {
  const last = director.segments.at(-1);
  const frames = last?.endFrame || framesForSeconds(15);
  return Math.max(DIRECTOR_DURATION_MIN, Math.round(frames / H3_FPS));
}

export function setDirectorDuration(
  director: TimelineDirectorState,
  seconds: number,
): TimelineDirectorState {
  const length = framesForSeconds(parseDirectorDuration(seconds));
  if (director.segments.length <= 1) {
    return {
      ...director,
      segments: [
        {
          ...(director.segments[0] || {
            prompt: "",
            imageIds: [],
            audioIds: [],
          }),
          startFrame: 0,
          endFrame: length,
        },
      ],
    };
  }
  return {
    ...director,
    segments: editDirectorWindow(
      director.segments,
      director.segments.length - 1,
      "right",
      length,
    ),
  };
}

export function editDirectorWindow(
  windows: TimelineSegment[],
  index: number,
  mode: "move" | "left" | "right",
  frame: number,
): TimelineSegment[] {
  const result = windows.map((segment) => ({ ...segment }));
  const current = result[index];
  const prev = result[index - 1];
  const next = result[index + 1];
  if (!current) return result;
  const oldEnd = current.endFrame;
  const oldLength = current.endFrame - current.startFrame;
  const outgoing = next ? Math.max(0, current.endFrame - next.startFrame) : 0;
  const maxIncoming = prev
    ? Math.max(0, Math.min(prev.endFrame - prev.startFrame, oldLength) - 1)
    : 0;
  const desired = Math.round(frame);
  if (mode === "move") {
    const incoming = prev
      ? nearestOverlap(prev.endFrame - desired, maxIncoming)
      : 0;
    current.startFrame = prev ? prev.endFrame - incoming : 0;
    current.endFrame = current.startFrame + oldLength;
  } else if (mode === "left") {
    const incoming = prev
      ? nearestOverlap(prev.endFrame - desired, maxIncoming)
      : 0;
    current.startFrame = prev ? prev.endFrame - incoming : 0;
    const length = alignedLength(
      oldEnd - current.startFrame,
      Math.max(incoming, outgoing) + 1,
    );
    current.endFrame = current.startFrame + length;
  } else {
    const incoming = prev ? Math.max(0, prev.endFrame - current.startFrame) : 0;
    current.endFrame =
      current.startFrame +
      alignedLength(
        desired - current.startFrame,
        Math.max(incoming, outgoing) + 1,
      );
  }
  const delta = current.endFrame - oldEnd;
  for (let i = index + 1; i < result.length; i++) {
    result[i].startFrame += delta;
    result[i].endFrame += delta;
  }
  return result;
}

export function moveDirectorClip(clip: TimelineVideoClip, start: number): TimelineVideoClip {
  return { ...clip, start: Math.max(0, Number(start) || 0) };
}

export function removeDirectorClip(
  director: TimelineDirectorState,
  id: string,
): TimelineDirectorState {
  return {
    ...director,
    videoClips: director.videoClips.filter((clip) => clip.id !== id),
  };
}

export const DIRECTOR_CLIP_TOP = 60;
export const DIRECTOR_CLIP_HEIGHT = 42;
export const DIRECTOR_CLIP_GAP = 6;
export const DIRECTOR_TRACK_MIN = 112;

export function directorClipLanes(clips: TimelineVideoClip[]) {
  const order = [...clips].sort(
    (a, b) => a.start - b.start || b.duration - a.duration,
  );
  const ends: number[] = [];
  const lanes = new Map<string, number>();
  for (const clip of order) {
    const end = clip.start + clip.duration;
    let lane = ends.findIndex((value) => value <= clip.start + 0.05);
    if (lane < 0) {
      lane = ends.length;
      ends.push(end);
    } else {
      ends[lane] = end;
    }
    lanes.set(clip.id, lane);
  }
  return { lanes, count: Math.max(ends.length, 1) };
}

export function directorTrackHeight(clips: TimelineVideoClip[]) {
  const { count } = directorClipLanes(clips);
  return Math.max(
    DIRECTOR_TRACK_MIN,
    DIRECTOR_CLIP_TOP + count * (DIRECTOR_CLIP_HEIGHT + DIRECTOR_CLIP_GAP) + 8,
  );
}

export function addDirectorSegment(director: TimelineDirectorState) {
  if (director.segments.length >= DIRECTOR_MAX_SEGMENTS)
    throw new Error(`导演台最多 ${DIRECTOR_MAX_SEGMENTS} 段`);
  const prev = director.segments.at(-1);
  const length = prev
    ? prev.endFrame - prev.startFrame
    : framesForSeconds(15);
  const overlap = prev
    ? nearestOverlap(
        CONTINUATION_OVERLAP,
        Math.min(length, prev.endFrame - prev.startFrame) - 1,
      )
    : 0;
  const start = prev ? prev.endFrame - overlap : 0;
  return {
    ...director,
    segments: [
      ...director.segments,
      {
        startFrame: start,
        endFrame: start + length,
        prompt: "",
        imageIds: director.images.map((image) => image.id).slice(0, 9),
        audioIds: director.audios.map((audio) => audio.id).slice(0, 3),
      },
    ],
  };
}

export function removeDirectorSegment(director: TimelineDirectorState, index: number) {
  if (director.segments.length <= 1) return director;
  const segments = director.segments.filter((_, i) => i !== index);
  if (!segments[0]) return director;
  const shift = segments[0].startFrame;
  return {
    ...director,
    segments: segments.map((segment) => ({
      ...segment,
      startFrame: segment.startFrame - shift,
      endFrame: segment.endFrame - shift,
    })),
  };
}

export function clipFromMedia(
  media: Pick<ReferenceMedia, "id" | "name" | "duration" | "kind">,
  start = 0,
): TimelineVideoClip {
  return {
    id: crypto.randomUUID(),
    mediaId: media.id,
    name: media.name,
    sourceDuration: media.duration,
    start,
    trimStart: 0,
    duration: media.duration,
    hasAudio: true,
    referenceMode: "edit",
  };
}

export function audioFromMedia(
  media: Pick<ReferenceMedia, "id" | "name" | "duration">,
): TimelineAudio {
  return {
    id: crypto.randomUUID(),
    mediaId: media.id,
    name: media.name,
    sourceDuration: media.duration,
    trimStart: 0,
    duration: media.duration,
    audioMode: "reference",
  };
}

export function assignDirectorRefs(
  director: TimelineDirectorState,
): TimelineDirectorState {
  const imageIds = director.images.map((image) => image.id).slice(0, 9);
  const audioIds = director.audios.map((audio) => audio.id).slice(0, 3);
  return {
    ...director,
    segments: director.segments.map((segment) => ({
      ...segment,
      imageIds: segment.imageIds.length
        ? segment.imageIds.filter((id) => imageIds.includes(id))
        : imageIds,
      audioIds: segment.audioIds.length
        ? segment.audioIds.filter((id) => audioIds.includes(id))
        : audioIds,
    })),
  };
}

export function addDirectorImage(
  director: TimelineDirectorState,
  image: TimelineImage,
) {
  if (director.images.some((item) => item.id === image.id || item.url === image.url))
    return assignDirectorRefs(director);
  if (director.images.length >= 9) throw new Error("导演台图片最多 9 张");
  return assignDirectorRefs({
    ...director,
    enabled: true,
    images: [...director.images, image],
  });
}

export function removeDirectorImage(director: TimelineDirectorState, id: string) {
  return assignDirectorRefs({
    ...director,
    images: director.images.filter((image) => image.id !== id),
  });
}

export function mergeDirectorReferences(
  director: TimelineDirectorState,
  shot: {
    assetIds?: string[];
    referenceMedia?: ReferenceMedia[];
    referenceBindings?: Record<string, string>;
  },
  assets: { id: string; title: string; imageUrl: string }[],
): TimelineDirectorState {
  let images = [...director.images];
  for (const id of shot.assetIds || []) {
    const asset = assets.find((item) => item.id === id);
    const url = asset?.imageUrl.trim() || "";
    if (!asset || !url) continue;
    if (images.some((image) => image.id === asset.id || image.url === url)) continue;
    images.push({ id: asset.id, name: asset.title, url });
  }
  images = orderBoundImages(images, shot.referenceBindings);
  let videoClips = [...director.videoClips];
  let audios = [...director.audios];
  for (const media of shot.referenceMedia || []) {
    if (media.kind === "video") {
      if (videoClips.some((clip) => clip.mediaId === media.id)) continue;
      const start = videoClips.reduce(
        (max, clip) => Math.max(max, clip.start + clip.duration),
        0,
      );
      videoClips.push(clipFromMedia(media, start));
    } else if (!audios.some((audio) => audio.mediaId === media.id)) {
      audios.push(audioFromMedia(media));
    }
  }
  return assignDirectorRefs({
    ...director,
    images: images.slice(0, 9),
    videoClips: videoClips.slice(0, 8),
    audios: audios.slice(0, 3),
  });
}

function bulkyImageUrl(url: string) {
  return url.startsWith("data:") || url.startsWith("blob:");
}

export function slimDirectorForSubmit(
  director: TimelineDirectorState,
): TimelineDirectorState {
  return {
    ...director,
    images: director.images.map((image) => {
      const file =
        image.file ||
        (image.url.startsWith("comfy-input:")
          ? image.url.slice("comfy-input:".length)
          : undefined);
      if ((bulkyImageUrl(image.url) || !image.url) && !file)
        throw new Error("参考图尚未传到 GPU，请稍后再点生成。");
      return {
        id: image.id,
        name: image.name,
        url: file ? `comfy-input:${file}` : image.url,
        ...(file ? { file } : {}),
      };
    }),
  };
}

export function validateTimelineDirector(value: unknown): TimelineDirectorState {
  const director = directorOf(value);
  if (!director.enabled) return { ...emptyDirector(), enabled: false };
  if (director.videoClips.length > 8) throw new Error("导演台视频最多 8 段");
  if (director.images.length > 9) throw new Error("导演台图片最多 9 张");
  if (director.audios.length > 3) throw new Error("导演台音频最多 3 段");
  if (director.segments.length < 1 || director.segments.length > DIRECTOR_MAX_SEGMENTS)
    throw new Error("导演台分段数量无效");
  const hasLocal = director.segments.some((s) => s.prompt.trim());
  if (hasLocal && director.segments.some((s) => !s.prompt.trim()))
    throw new Error("启用分段提示词后，每一段都要写完整");
  return director;
}

export function directorPrompt(
  director: TimelineDirectorState,
  fallback: string,
) {
  const locals = director.segments.map((s) => s.prompt.trim());
  if (locals.some(Boolean)) {
    if (locals.some((p) => !p))
      throw new Error("启用分段提示词后，每一段都要写完整");
    return locals[0];
  }
  const global = director.globalPrompt.trim() || fallback.trim();
  if (!global) throw new Error("导演台需要全局提示词，或为每一段填写提示词");
  return global;
}

export function seedDirectorPrompt(
  director: TimelineDirectorState,
  fallback: string,
): TimelineDirectorState {
  if (director.globalPrompt.trim() || director.segments.some((item) => item.prompt.trim()))
    return director;
  return { ...director, globalPrompt: fallback.trim().slice(0, DRAMA_PROMPT_LIMIT) };
}

export function toTimelineData(
  director: TimelineDirectorState,
  files: Record<string, string>,
  imageFiles: Record<string, string>,
  globalPrompt: string,
) {
  const seconds = directorOutputSeconds(director);
  const multi = director.segments.length > 1;
  const packedImages = director.images
    .map((image) => ({
      id: image.id,
      file: image.file || imageFiles[image.id],
      name: image.name,
    }))
    .filter((image) => image.file);
  const imageIds = packedImages.map((image) => image.id);
  const audioIds = director.audios.map((audio) => audio.id);
  return JSON.stringify({
    videoClips: director.videoClips.map((clip) => ({
      id: clip.id,
      file: files[clip.mediaId],
      name: clip.name,
      start: clip.start,
      duration: clip.duration,
      trimStart: clip.trimStart,
      hasAudio: clip.hasAudio,
      referenceMode: clip.referenceMode,
    })),
    images: packedImages,
    audios: director.audios.map((audio) => ({
      id: audio.id,
      file: files[audio.mediaId],
      name: audio.name,
      trimStart: audio.trimStart,
      duration: audio.duration,
      audioMode: audio.audioMode,
    })),
    selection: {
      start: director.segments[0]?.startFrame / H3_FPS || 0,
      duration: seconds,
    },
    videoAudioEnabled: director.videoAudioEnabled,
    globalPrompt: (director.globalPrompt.trim() || globalPrompt)
      .trim()
      .slice(0, DRAMA_PROMPT_LIMIT),
    segmentConfig: multi
      ? {
          mode: "timeline",
          count: director.segments.length,
          activeIndex: 0,
          segments: director.segments.map((segment) => ({
            startFrame: segment.startFrame,
            endFrame: segment.endFrame,
            prompt: segment.prompt.trim().slice(0, DRAMA_PROMPT_LIMIT),
            images: segment.imageIds.length
              ? segment.imageIds.filter((id) => imageIds.includes(id))
              : imageIds,
            audios: segment.audioIds.length
              ? segment.audioIds.filter((id) => audioIds.includes(id))
              : audioIds,
          })),
        }
      : { count: 0, segments: [] },
  });
}

function readVideoClip(value: unknown): TimelineVideoClip | null {
  if (!value || typeof value !== "object") return null;
  const clip = value as Record<string, unknown>;
  if (
    typeof clip.id !== "string" ||
    !/^[a-f0-9]{32}$/.test(String(clip.mediaId)) ||
    typeof clip.name !== "string" ||
    !Number.isFinite(Number(clip.sourceDuration)) ||
    !Number.isFinite(Number(clip.start)) ||
    !Number.isFinite(Number(clip.duration))
  )
    return null;
  return {
    id: clip.id,
    mediaId: String(clip.mediaId),
    name: clip.name.slice(0, 200),
    sourceDuration: Number(clip.sourceDuration),
    start: Math.max(0, Number(clip.start)),
    trimStart: Math.max(0, Number(clip.trimStart) || 0),
    duration: Math.max(0.21, Number(clip.duration)),
    hasAudio: clip.hasAudio !== false,
    referenceMode: REFERENCE_MODES.includes(clip.referenceMode as TimelineReferenceMode)
      ? (clip.referenceMode as TimelineReferenceMode)
      : "edit",
  };
}

function readImage(value: unknown): TimelineImage | null {
  if (!value || typeof value !== "object") return null;
  const image = value as Record<string, unknown>;
  if (typeof image.id !== "string" || typeof image.name !== "string" || typeof image.url !== "string")
    return null;
  return {
    id: image.id,
    name: image.name.slice(0, 200),
    url: image.url,
    ...(typeof image.file === "string" ? { file: image.file } : {}),
  };
}

function readAudio(value: unknown): TimelineAudio | null {
  if (!value || typeof value !== "object") return null;
  const audio = value as Record<string, unknown>;
  if (
    typeof audio.id !== "string" ||
    !/^[a-f0-9]{32}$/.test(String(audio.mediaId)) ||
    typeof audio.name !== "string"
  )
    return null;
  return {
    id: audio.id,
    mediaId: String(audio.mediaId),
    name: audio.name.slice(0, 200),
    sourceDuration: Number(audio.sourceDuration) || 0,
    trimStart: Math.max(0, Number(audio.trimStart) || 0),
    duration: Math.max(0.21, Number(audio.duration) || Number(audio.sourceDuration) || 1),
    audioMode: AUDIO_MODES.includes(audio.audioMode as TimelineAudioMode)
      ? (audio.audioMode as TimelineAudioMode)
      : "reference",
  };
}

function normalizeSegments(raw: unknown[], seconds: number): TimelineSegment[] {
  const fallback = emptyDirector(seconds).segments;
  const items = raw
    .map((value) => {
      if (!value || typeof value !== "object") return null;
      const segment = value as Record<string, unknown>;
      const start = Number(segment.startFrame);
      const end = Number(segment.endFrame);
      if (!Number.isInteger(start) || !Number.isInteger(end) || end - start < 5)
        return null;
      return {
        startFrame: start,
        endFrame: end,
        prompt: typeof segment.prompt === "string" ? segment.prompt.slice(0, DRAMA_PROMPT_LIMIT) : "",
        imageIds: Array.isArray(segment.imageIds)
          ? segment.imageIds.filter((id): id is string => typeof id === "string").slice(0, 9)
          : [],
        audioIds: Array.isArray(segment.audioIds)
          ? segment.audioIds.filter((id): id is string => typeof id === "string").slice(0, 3)
          : [],
      } satisfies TimelineSegment;
    })
    .filter((item): item is TimelineSegment => !!item);
  return items.length ? items.slice(0, DIRECTOR_MAX_SEGMENTS) : fallback;
}
