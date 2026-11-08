import {
  userNegativePrompt,
} from "./generation-constraints";
import { DRAMA_PROMPT_LIMIT, SHOT_FIELD_LIMIT, type Shot } from "./drama";
import {
  parsePromptSettings,
  type DramaPromptSettings,
} from "./drama-prompt";
import { DEFAULT_SCRIPT_TONE, normalizeTone, type ScriptTone } from "./drama-script";
import JSZip from "jszip";
import { migrateLinearShotTree } from "./drama-tree";
import { validateReferenceMedia } from "./drama-reference-media";
import type { AssetCard } from "./drama-assets";
import { parseShotDuration } from "./drama-models";
import { directorOf } from "./drama-timeline";
export type DramaArchive = {
  version: 2;
  format: "pencil-drama";
  savedAt: string;
  title: string;
  story: string;
  ratio: string;
  provider: "comfy" | "fal";
  tone: ScriptTone;
  promptSettings?: DramaPromptSettings;
  shots: Shot[];
  assets: AssetCard[];
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const position = (v: unknown) =>
  record(v) && Number.isFinite(v.x) && Number.isFinite(v.y);
export function parseArchive(value: unknown): DramaArchive {
  if (
    !record(value) ||
    ![1, 2].includes(Number(value.version)) ||
    (value.version === 2 && value.format !== "pencil-drama") ||
    !Array.isArray(value.shots) ||
    !Array.isArray(value.assets ?? [])
  )
    throw new Error("存档格式或版本不支持");
  const assets: AssetCard[] = (
    Array.isArray(value.assets) ? value.assets : []
  ).map((a: unknown) => {
    if (
      !record(a) ||
      !["reference", "scene"].includes(String(a.kind)) ||
      !position(a.position) ||
      ["id", "title", "description", "imageUrl"].some(
        (k) => typeof a[k] !== "string",
      )
    )
      throw new Error("参考卡数据无效");
    return {
      id: a.id,
      kind: a.kind,
      title: a.title,
      description: a.description,
      negativePrompt: userNegativePrompt(a.negativePrompt).slice(0, 1600),
      imageUrl: a.imageUrl,
      position: a.position,
      positionLocked: a.positionLocked === true,
    } as AssetCard;
  });
  const shots: Shot[] = value.shots.map((s: unknown) => {
    if (
      !record(s) ||
      !["t2v", "i2v", "ri2v"].includes(String(s.mode)) ||
      !position(s.position) ||
      ["id", "title", "prompt", "firstFrame", "lastFrame", "references"].some(
        (k) => typeof s[k] !== "string",
      ) ||
      (s.assetIds !== undefined &&
        (!Array.isArray(s.assetIds) ||
          s.assetIds.some(
            (id) => typeof id !== "string" || !assets.some((a) => a.id === id),
          )))
    )
      throw new Error("镜头数据或参考关联无效");
    const clean: Record<string, unknown> = {};
    for (const k of [
      "id",
      "title",
      "prompt",
      "negativePrompt",
      "mode",
      "firstFrame",
      "lastFrame",
      "references",
      "taskId",
      "taskMode",
      "taskProvider",
      "videoModel",
      "taskVideoModel",
      "status",
      "videoUrl",
      "endStill",
      "endFrameAssetId",
      "startFrameAssetId",
      "modelPick",
      "error",
    ])
      if (typeof s[k] === "string") clean[k] = s[k];
    if (s.modelPick === "auto" || s.modelPick === "manual")
      clean.modelPick = s.modelPick;
    if (typeof s.parentId === "string" && s.parentId.trim())
      clean.parentId = s.parentId.trim();
    if (record(s.promptFields)) {
      const fields: Record<string, string> = {};
      for (const key of ["start", "action", "camera", "setting", "sound", "end"]) {
        const text = s.promptFields[key];
        if (typeof text === "string" && text.trim())
          fields[key] = text.trim().slice(
            0,
            key === "action" ? DRAMA_PROMPT_LIMIT : SHOT_FIELD_LIMIT,
          );
      }
      if (Object.keys(fields).length) clean.promptFields = fields;
    }
    for (const k of ["generationStartedAt", "generationFinishedAt", "statusUpdatedAt", "queuePosition"])
      if (typeof s[k] === "number" && Number.isFinite(s[k]) && s[k] >= 0)
        clean[k] = s[k];
    if (record(s.referenceBindings)) clean.referenceBindings = Object.fromEntries(
      Object.entries(s.referenceBindings).filter(([key,value]) => /^(Image|Video|Audio)\d+$/.test(key) && typeof value === "string" && /^(asset:|media:|url:)/.test(value)).slice(0,1000),
    );
    return {
      ...clean,
      referenceMedia: validateReferenceMedia(s.referenceMedia),
      negativePrompt: userNegativePrompt(clean.negativePrompt),
      position: s.position,
      positionLocked: s.positionLocked === true,
      assetIds: s.assetIds ?? [],
      duration: parseShotDuration(s.duration),
      status: s.status === "SUBMITTING" ? "FAILED" : clean.status,
      ...(s.timelineDirector
        ? { timelineDirector: directorOf(s.timelineDirector, parseShotDuration(s.duration)) }
        : {}),
    } as Shot;
  });
  const declaredParents = (Array.isArray(value.shots) ? value.shots : []).some(
    (item) => record(item) && typeof item.parentId === "string",
  );
  const tree = migrateLinearShotTree(shots, declaredParents);
  const ids = [...assets, ...tree].map((x) => x.id);
  if (new Set(ids).size !== ids.length) throw new Error("存档包含重复卡片 ID");
  return {
    version: 2,
    format: "pencil-drama",
    savedAt:
      typeof value.savedAt === "string"
        ? value.savedAt
        : new Date().toISOString(),
    title: typeof value.title === "string" ? value.title : "未命名悬疑短剧",
    story: typeof value.story === "string" ? value.story : "",
    ratio: ["9:16", "16:9", "1:1"].includes(String(value.ratio))
      ? String(value.ratio)
      : "9:16",
    provider: value.provider === "fal" ? "fal" : "comfy",
    tone: normalizeTone(value.tone),
    promptSettings: parsePromptSettings(value.promptSettings),
    assets,
    shots: tree,
  };
}
export function isDramaSnapshot(value: unknown): value is DramaArchive {
  return record(value) && Array.isArray(value.shots) && !Array.isArray(value.nodes);
}
export function emptyDramaArchive(title = "未命名悬疑短剧"): DramaArchive {
  return {
    version: 2,
    format: "pencil-drama",
    savedAt: new Date().toISOString(),
    title,
    story: "",
    ratio: "9:16",
    provider: "comfy",
    tone: DEFAULT_SCRIPT_TONE,
    promptSettings: parsePromptSettings(undefined),
    shots: [],
    assets: [],
  };
}
async function mapMedia(
  doc: DramaArchive,
  convert: (url: string) => Promise<string>,
) {
  for (const a of doc.assets)
    if (a.imageUrl) a.imageUrl = await convert(a.imageUrl);
  for (const s of doc.shots) {
    for (const [token, source] of Object.entries(s.referenceBindings || {})) {
      if (source.startsWith("url:") && s.references.split("\n").some(url => url.trim() === source.slice(4)))
        s.referenceBindings![token] = `url:${await convert(source.slice(4))}`;
    }
    for (const media of s.referenceMedia || []) media.url = await convert(media.url);
    for (const key of ["firstFrame", "lastFrame", "videoUrl", "endStill"] as const)
      if (s[key]) s[key] = await convert(s[key]!);
    if (s.references)
      s.references = (
        await Promise.all(
          s.references
            .split(/\n/)
            .map((url) =>
              url.trim() ? convert(url.trim()) : Promise.resolve(""),
            ),
        )
      ).join("\n");
  }
}
export async function packArchive(value: unknown) {
  const doc = parseArchive(value),
    zip = new JSZip(),
    paths = new Map<string, string>();
  await mapMedia(doc, async (url) => {
    if (paths.has(url)) return paths.get(url)!;
    const r = await fetch(url);
    if (!r.ok)
      throw new Error("素材读取失败，存档未下载。请检查图片或视频链接。");
    const blob = await r.blob();
    const path = `media/${paths.size}.${blob.type.includes("video") ? "mp4" : blob.type.includes("audio") ? (blob.type.includes("mpeg") ? "mp3" : "wav") : blob.type.includes("jpeg") ? "jpg" : "png"}`;
    paths.set(url, path);
    zip.file(path, await blob.arrayBuffer());
    return path;
  });
  zip.file("project.json", JSON.stringify(doc, null, 2));
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}
export async function unpackArchive(
  file: Blob,
): Promise<{ doc: DramaArchive; urls: string[] }> {
  if (file.size > 512 * 1024 * 1024) throw new Error("存档不能超过 512MB");
  const bytes = await file.arrayBuffer();
  if (new Uint8Array(bytes)[0] !== 0x50)
    return {
      doc: parseArchive(JSON.parse(new TextDecoder().decode(bytes))),
      urls: [],
    };
  const zip = await JSZip.loadAsync(bytes),
    entry = zip.file("project.json");
  if (!entry) throw new Error("存档缺少 project.json");
  const doc = parseArchive(JSON.parse(await entry.async("string"))),
    urls: string[] = [],
    cache = new Map<string, string>();
  try {
    await mapMedia(doc, async (path) => {
      if (!path.startsWith("media/")) return path;
      if (cache.has(path)) return cache.get(path)!;
      const entry = zip.file(path);
      if (!entry) throw new Error("存档素材缺失");
      const blob = new Blob([await entry.async("arraybuffer")], {
        type: path.endsWith("mp4")
          ? "video/mp4"
          : path.endsWith("mp3") ? "audio/mpeg"
          : path.endsWith("wav") ? "audio/wav"
          : path.endsWith("jpg")
            ? "image/jpeg"
            : "image/png",
      });
      const url = URL.createObjectURL(blob);
      urls.push(url);
      cache.set(path, url);
      return url;
    });
    return { doc, urls };
  } catch (e) {
    urls.forEach(URL.revokeObjectURL);
    throw e;
  }
}
function draftDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("pencil-drama-archives", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("drafts");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function saveDraft(value: unknown, projectId = "current") {
  const doc = parseArchive(value),
    media: Record<string, Blob> = {};
  const saved = new Map<string, string>();
  await mapMedia(doc, async (url) => {
    if (!url.startsWith("blob:")) return url;
    if (saved.has(url)) return saved.get(url)!;
    const id = `draftmedia/${Object.keys(media).length}`;
    media[id] = await (await fetch(url)).blob();
    saved.set(url, id);
    return id;
  });
  const db = await draftDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("drafts", "readwrite");
      t.objectStore("drafts").put({ doc, media }, projectId);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
  return doc;
}
export async function readDraft(projectId = "current") {
  const db = await draftDB();
  try {
    const stored = await new Promise<
      { doc: DramaArchive; media: Record<string, Blob> } | undefined
    >((resolve, reject) => {
      const r = db.transaction("drafts").objectStore("drafts").get(projectId);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (!stored) return null;
    const doc = parseArchive(stored.doc);
    const restored = new Map<string, string>();
    await mapMedia(doc, async (url) => {
      if (!url.startsWith("draftmedia/")) return url;
      if (!stored.media[url]) throw new Error("本地素材缺失");
      if (!restored.has(url)) restored.set(url, URL.createObjectURL(stored.media[url]));
      return restored.get(url)!;
    });
    return doc;
  } finally {
    db.close();
  }
}
