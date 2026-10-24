import type { Shot } from "./drama";
import type { AssetCard } from "./drama-assets";
import type { ReferenceMedia } from "./drama-reference-media";

export type ReferenceSlot = {
  source: string;
  kind: "Image" | "Video" | "Audio";
  index: number;
  token: string;
  name: string;
  url: string;
};

export type DirectorMentionMedia = {
  images: { id: string; name: string; url: string }[];
  videoClips: { mediaId: string; name: string }[];
  audios: { mediaId: string; name: string }[];
};

function tokenNumber(token: string) {
  const match = token.match(/^(Image|Video|Audio)(\d+)$/);
  return match ? Number(match[2]) : 0;
}

export function nextToken(
  kind: ReferenceSlot["kind"],
  bindings: Record<string, string>,
) {
  let max = 0;
  for (const key of Object.keys(bindings)) {
    if (key.startsWith(kind)) max = Math.max(max, tokenNumber(key));
  }
  return `${kind}${max + 1}`;
}

export function slotToken(
  slot: Pick<ReferenceSlot, "kind" | "source">,
  bindings: Record<string, string> = {},
) {
  const existing = Object.entries(bindings).find(
    ([, source]) => source === slot.source,
  )?.[0];
  if (existing) return existing;
  return nextToken(slot.kind, bindings);
}

function imageSources(shot: Shot, assets: AssetCard[]) {
  const ordered = (shot.assetIds || [])
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is AssetCard => !!asset);
  const urls = Array.from(
    new Set([
      ...shot.references
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      ...ordered.map((asset) => asset.imageUrl.trim()).filter(Boolean),
    ]),
  );
  return urls.map((url) => {
    const asset = ordered.find((item) => item.imageUrl.trim() === url);
    return {
      source: asset ? `asset:${asset.id}` : `url:${url}`,
      kind: "Image" as const,
      name: asset?.title || "参考图片",
      url,
    };
  });
}

function mediaSources(shot: Shot) {
  return (shot.referenceMedia || []).map((media) => ({
    source: `media:${media.slotId || media.id}`,
    kind: (media.kind === "video" ? "Video" : "Audio") as "Video" | "Audio",
    name: media.name,
    url: media.url,
    media,
  }));
}

function allocateSlots(
  items: Array<Omit<ReferenceSlot, "token" | "index">>,
  bindings: Record<string, string>,
) {
  const allocation = { ...bindings };
  const slots: ReferenceSlot[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const aliases = [item.source];
    if (item.kind === "Image" && item.url) aliases.push(`url:${item.url}`);
    if (aliases.some((alias) => seen.has(alias))) continue;
    if (
      item.kind === "Image" &&
      item.url &&
      slots.some((slot) => slot.kind === "Image" && slot.url === item.url)
    )
      continue;
    const token = slotToken(item, allocation);
    allocation[token] = item.source;
    for (const alias of aliases) seen.add(alias);
    slots.push({
      ...item,
      token,
      index: tokenNumber(token),
    });
  }
  return slots.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.index - b.index,
  );
}

export function referenceSlots(
  shot: Shot,
  assets: AssetCard[],
): ReferenceSlot[] {
  return allocateSlots(
    [...imageSources(shot, assets), ...mediaSources(shot)],
    shot.referenceBindings || {},
  );
}

function directorMediaSource(
  mediaId: string,
  shot: Pick<Shot, "referenceMedia">,
) {
  const media = (shot.referenceMedia || []).find(
    (item) => item.id === mediaId || item.slotId === mediaId,
  );
  return `media:${media ? media.slotId || media.id : mediaId}`;
}

export function directorMentionSlots(
  shot: Shot,
  assets: AssetCard[],
  director: DirectorMentionMedia,
): ReferenceSlot[] {
  return allocateSlots(
    [
      ...imageSources(shot, assets),
      ...mediaSources(shot),
      ...director.images.map((image) => ({
        source: `asset:${image.id}`,
        kind: "Image" as const,
        name: image.name,
        url: image.url,
      })),
      ...director.videoClips.map((clip) => ({
        source: directorMediaSource(clip.mediaId, shot),
        kind: "Video" as const,
        name: clip.name,
        url: "",
      })),
      ...director.audios.map((audio) => ({
        source: directorMediaSource(audio.mediaId, shot),
        kind: "Audio" as const,
        name: audio.name,
        url: "",
      })),
    ],
    shot.referenceBindings || {},
  );
}

export function syncReferenceBindings(shot: Shot, assets: AssetCard[]) {
  return Object.fromEntries(
    referenceSlots(shot, assets).map((slot) => [slot.token, slot.source]),
  );
}

function denseIndex(
  kind: ReferenceSlot["kind"],
  token: string,
  bindings: Record<string, string>,
  slots: ReferenceSlot[],
) {
  const live = Object.keys(bindings)
    .filter((key) => {
      if (!key.startsWith(kind)) return false;
      const source = bindings[key];
      return slots.some((slot) => slot.source === source && slot.kind === kind);
    })
    .sort((a, b) => tokenNumber(a) - tokenNumber(b));
  const index = live.indexOf(token);
  return index >= 0 ? index + 1 : tokenNumber(token);
}

function packedDenseIndex(
  kind: ReferenceSlot["kind"],
  source: string,
  director: DirectorMentionMedia,
  shot?: Pick<Shot, "referenceMedia">,
) {
  if (kind === "Image") {
    return director.images.findIndex(
      (image) =>
        `asset:${image.id}` === source ||
        `director:${image.id}` === source ||
        `url:${image.url}` === source,
    );
  }
  if (kind === "Video") {
    return director.videoClips.findIndex(
      (clip) =>
        directorMediaSource(clip.mediaId, shot || {}) === source ||
        `media:${clip.mediaId}` === source,
    );
  }
  return director.audios.findIndex(
    (audio) =>
      directorMediaSource(audio.mediaId, shot || {}) === source ||
      `media:${audio.mediaId}` === source,
  );
}

export function resolveMentionText(
  text: string,
  slots: ReferenceSlot[],
  bindings: Record<string, string>,
  options?: {
    mode?: Shot["mode"];
    packed?: DirectorMentionMedia;
    shot?: Pick<Shot, "referenceMedia">;
  },
) {
  return text.replace(
    /@(Image|Video|Audio)(\d+)\b/g,
    (full, kind: ReferenceSlot["kind"], num: string) => {
      const token = `${kind}${num}`;
      const source = bindings[token];
      const slot = source
        ? slots.find((item) => item.source === source)
        : slots.find((item) => item.token === token);
      if (!slot)
        throw new Error(`引用 ${full} 的素材已移除，请重新选择参考素材`);
      if (options?.mode === "i2v")
        throw new Error("@素材引用请使用 RI2V 参考模式");
      const index = options?.packed
        ? packedDenseIndex(slot.kind, slot.source, options.packed, options.shot) +
          1
        : denseIndex(slot.kind, slot.token, bindings, slots);
      if (index < 1)
        throw new Error(`引用 ${full} 的素材已移除，请重新选择参考素材`);
      return `${slot.kind} ${index}`;
    },
  );
}

export function resolveMentions(shot: Shot, assets: AssetCard[]) {
  return resolveMentionText(
    shot.prompt,
    referenceSlots(shot, assets),
    shot.referenceBindings || {},
    { mode: shot.mode },
  );
}

export function resolveDirectorMentions(
  text: string,
  shot: Shot,
  assets: AssetCard[],
  director: DirectorMentionMedia,
) {
  return resolveMentionText(
    text,
    directorMentionSlots(shot, assets, director),
    shot.referenceBindings || {},
    { packed: director, shot },
  );
}

export function resolveDirectorState<
  T extends {
    globalPrompt: string;
    segments: Array<{ prompt: string }>;
  } & DirectorMentionMedia,
>(director: T, shot: Shot, assets: AssetCard[]): T {
  const resolve = (text: string) =>
    resolveDirectorMentions(text, shot, assets, director);
  return {
    ...director,
    globalPrompt: resolve(director.globalPrompt),
    segments: director.segments.map((segment) => ({
      ...segment,
      prompt: resolve(segment.prompt),
    })),
  };
}

export function orderedImageUrls(shot: Shot, assets: AssetCard[]) {
  const slots = referenceSlots(shot, assets).filter(
    (slot) => slot.kind === "Image" && slot.url,
  );
  return [...slots]
    .sort((a, b) => a.index - b.index)
    .map((slot) => slot.url);
}

export function orderedReferenceMedia(
  shot: Pick<Shot, "referenceMedia" | "referenceBindings">,
): ReferenceMedia[] {
  const bindings = shot.referenceBindings || {};
  return [...(shot.referenceMedia || [])].sort((a, b) => {
    const kind = Number(a.kind === "audio") - Number(b.kind === "audio");
    if (kind) return kind;
    const ia = tokenNumber(
      tokenForSource(`media:${a.slotId || a.id}`, bindings) || "",
    );
    const ib = tokenNumber(
      tokenForSource(`media:${b.slotId || b.id}`, bindings) || "",
    );
    return ia - ib;
  });
}

export function orderBoundImages<T extends { id: string; url: string }>(
  images: T[],
  bindings: Record<string, string> = {},
) {
  return images
    .map((item, order) => ({ item, order }))
    .sort((a, b) => {
      const ia =
        tokenNumber(
          tokenForSource(`asset:${a.item.id}`, bindings) ||
            tokenForSource(`url:${a.item.url}`, bindings) ||
            "",
        ) || Number.MAX_SAFE_INTEGER;
      const ib =
        tokenNumber(
          tokenForSource(`asset:${b.item.id}`, bindings) ||
            tokenForSource(`url:${b.item.url}`, bindings) ||
            "",
        ) || Number.MAX_SAFE_INTEGER;
      return ia - ib || a.order - b.order;
    })
    .map(({ item }) => item);
}

export function tokenForSource(
  source: string,
  bindings: Record<string, string> = {},
) {
  return Object.entries(bindings).find(([, value]) => value === source)?.[0];
}
