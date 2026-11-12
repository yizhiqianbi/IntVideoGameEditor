import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  IMAGE_GROUPS,
  IMAGE_TEMPLATES,
  STUDIO_IMAGE_TEMPLATES,
  VIDEO_TEMPLATES,
  assetOrigin,
  imageTemplate,
  noteError,
  studioImageListed,
  videoTemplate,
  type ImageTemplate,
  type VideoTemplate,
} from "./catalog";
import { customImage, customImages, imagePixels, updateCustomImage, type CustomImageTemplate } from "./custom-templates";

type CoverExt = "png" | "jpg" | "webp";
type ImageEdit = {
  label?: string;
  group?: string;
  frame?: string;
  prompt?: string;
  listed?: boolean;
  aspectRatio?: string;
  coverExt?: CoverExt;
};
type VideoEdit = {
  label?: string;
  description?: string;
  action?: string;
  listed?: boolean;
  coverExt?: CoverExt;
};
type Store = { images: Record<string, ImageEdit>; videos: Record<string, VideoEdit> };

export type LiveImage = ImageTemplate & { listed: boolean; prompt: string; cover: string; source: "library" | "upload" };
export type LiveVideo = VideoTemplate & { listed: boolean; cover: string };

const ROOT = path.join(process.cwd(), "data");
const FILE = path.join(ROOT, "live-edits.json");
const COVERS = path.join(ROOT, "covers");
const ID_RE = /^[a-z0-9-]{1,80}$/i;

function clean(value: string, limit: number): string {
  return value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function knownExt(value: unknown): value is CoverExt {
  return value === "png" || value === "jpg" || value === "webp";
}

function textField(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = clean(value, limit);
  return text || undefined;
}

function imageEdit(value: unknown): ImageEdit | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as ImageEdit;
  const edit: ImageEdit = {};
  const label = textField(raw.label, 40);
  const group = textField(raw.group, 40);
  const frame = textField(raw.frame, 500);
  const prompt = textField(raw.prompt, 500);
  const aspectRatio = textField(raw.aspectRatio, 8);
  if (label) edit.label = label;
  if (group && IMAGE_GROUPS.some(item => item.id === group)) edit.group = group;
  if (frame) edit.frame = frame;
  if (prompt) edit.prompt = prompt;
  if (aspectRatio) edit.aspectRatio = aspectRatio;
  if (raw.listed === true || raw.listed === false) edit.listed = raw.listed;
  if (knownExt(raw.coverExt)) edit.coverExt = raw.coverExt;
  return edit;
}

function videoEdit(value: unknown): VideoEdit | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as VideoEdit;
  const edit: VideoEdit = {};
  const label = textField(raw.label, 40);
  const description = textField(raw.description, 500);
  const action = textField(raw.action, 500);
  if (label) edit.label = label;
  if (description) edit.description = description;
  if (action) edit.action = action;
  if (raw.listed === true || raw.listed === false) edit.listed = raw.listed;
  if (knownExt(raw.coverExt)) edit.coverExt = raw.coverExt;
  return edit;
}

let cache: Store | null = null;

function readStore(): Store {
  if (cache) return cache;
  cache = loadStore();
  return cache;
}

function loadStore(): Store {
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as { images?: unknown; videos?: unknown };
    const images: Record<string, ImageEdit> = {};
    const videos: Record<string, VideoEdit> = {};
    if (parsed.images && typeof parsed.images === "object") {
      for (const [id, value] of Object.entries(parsed.images)) {
        const edit = ID_RE.test(id) ? imageEdit(value) : null;
        if (edit) images[id] = edit;
      }
    }
    if (parsed.videos && typeof parsed.videos === "object") {
      for (const [id, value] of Object.entries(parsed.videos)) {
        const edit = ID_RE.test(id) ? videoEdit(value) : null;
        if (edit) videos[id] = edit;
      }
    }
    return { images, videos };
  } catch {
    return { images: {}, videos: {} };
  }
}

function writeStore(store: Store) {
  mkdirSync(ROOT, { recursive: true });
  const next = path.join(ROOT, "live-edits.json.tmp");
  writeFileSync(next, `${JSON.stringify(store, null, 2)}\n`);
  renameSync(next, FILE);
  cache = store;
}

function coverPath(kind: "image" | "video", id: string, ext: CoverExt): string {
  if (!ID_RE.test(id)) throw new Error("没有这个模板。");
  const root = path.resolve(COVERS, kind);
  const full = path.resolve(root, `${id}.${ext}`);
  if (!full.startsWith(`${root}${path.sep}`)) throw new Error("没有这个模板。");
  return full;
}

function aspectFor(width: number, height: number): string {
  const ratio = width / height;
  const choices: [string, number][] = [["9:16", 9 / 16], ["3:4", 3 / 4], ["1:1", 1], ["4:3", 4 / 3], ["16:9", 16 / 9]];
  return choices.reduce((best, item) => Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best)[0];
}

function sniff(bytes: Buffer): CoverExt | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export function localCover(kind: "image" | "video", id: string): { bytes: Buffer; type: string } | null {
  const store = readStore();
  const ext = kind === "image" ? store.images[id]?.coverExt : store.videos[id]?.coverExt;
  if (!knownExt(ext) || !ID_RE.test(id)) return null;
  try {
    const bytes = readFileSync(coverPath(kind, id, ext));
    const type = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    return { bytes, type };
  } catch {
    return null;
  }
}

function imageCover(id: string, source: "library" | "upload", edit: ImageEdit | undefined): string {
  if (source === "upload" || knownExt(edit?.coverExt)) return `/api/template-media/${id}`;
  return `${assetOrigin()}/assets/xumeng/krea2-actions/${id}.webp`;
}

function videoCover(id: string, edit: VideoEdit | undefined): string {
  if (knownExt(edit?.coverExt)) return `/api/template-media/${id}`;
  return `${assetOrigin()}/assets/xumeng/h3-actions/${id}.webp`;
}

function presentImage(item: ImageTemplate, source: "library" | "upload", edit: ImageEdit | undefined): LiveImage {
  const frame = edit?.frame || item.frame;
  const listed = typeof edit?.listed === "boolean" ? edit.listed : source === "upload" || studioImageListed(item.id);
  return {
    ...item,
    label: edit?.label || item.label,
    group: edit?.group || item.group,
    frame,
    aspectRatio: edit?.aspectRatio || item.aspectRatio,
    prompt: edit?.prompt || frame,
    listed,
    cover: imageCover(item.id, source, edit),
    source,
  };
}

function presentVideo(item: VideoTemplate, edit: VideoEdit | undefined): LiveVideo {
  return {
    ...item,
    label: edit?.label || item.label,
    description: edit?.description || item.description,
    action: edit?.action || item.action,
    listed: typeof edit?.listed === "boolean" ? edit.listed : true,
    cover: videoCover(item.id, edit),
  };
}

export function liveImage(id: string): LiveImage | null {
  const store = readStore();
  const uploaded = customImage(id);
  if (uploaded) return presentImage(uploaded, "upload", store.images[id]);
  const library = imageTemplate(id);
  if (!library) return null;
  return presentImage(library, "library", store.images[id]);
}

export function liveVideo(id: string): LiveVideo | null {
  const library = videoTemplate(id);
  if (!library) return null;
  return presentVideo(library, readStore().videos[id]);
}

export function adminImageFields(item: ImageTemplate, source: "library" | "upload"): Pick<LiveImage, "label" | "group" | "frame" | "prompt" | "listed" | "cover" | "aspectRatio"> {
  return presentImage(item, source, readStore().images[item.id]);
}

export function adminVideoFields(item: VideoTemplate): Pick<LiveVideo, "label" | "description" | "action" | "listed" | "cover"> {
  return presentVideo(item, readStore().videos[item.id]);
}

export function publicGallery(): { groups: { id: string; label: string }[]; images: LiveImage[]; videos: LiveVideo[] } {
  const store = readStore();
  const images: LiveImage[] = [];
  const seen = new Set<string>();
  const pushImage = (item: ImageTemplate, source: "library" | "upload") => {
    if (seen.has(item.id)) return;
    const view = presentImage(item, source, store.images[item.id]);
    if (!view.listed) return;
    seen.add(item.id);
    images.push(view);
  };
  for (const item of customImages()) pushImage(item, "upload");
  for (const item of STUDIO_IMAGE_TEMPLATES) pushImage(item, "library");
  for (const item of IMAGE_TEMPLATES) pushImage(item, "library");
  const videos = VIDEO_TEMPLATES.map(item => presentVideo(item, store.videos[item.id])).filter(item => item.listed);
  const groups = IMAGE_GROUPS.filter(group => images.some(item => item.group === group.id)).map(item => ({ id: item.id, label: item.label }));
  return { groups, images, videos };
}

function writeCover(kind: "image" | "video", id: string, bytes: Buffer): { ext: CoverExt; aspectRatio: string } {
  if (bytes.length < 32 || bytes.length > 8_000_000) throw new Error("封面请用 8MB 以内的 PNG、JPG 或 WebP。");
  const ext = sniff(bytes);
  if (!ext) throw new Error("封面请用 PNG、JPG 或 WebP。");
  const size = imagePixels(bytes);
  if (!size) throw new Error("这张封面无法读取。");
  mkdirSync(path.join(COVERS, kind), { recursive: true });
  writeFileSync(coverPath(kind, id, ext), bytes);
  for (const other of ["png", "jpg", "webp"] as const) {
    if (other === ext) continue;
    try { rmSync(coverPath(kind, id, other), { force: true }); } catch { /* 没有旧封面。 */ }
  }
  return { ext, aspectRatio: aspectFor(size.width, size.height) };
}

export function saveLiveTemplate(input: {
  id: string;
  kind: "image" | "video";
  label: string;
  group: string;
  content: string;
  prompt: string;
  listed: boolean;
  bytes: Buffer | null;
}) {
  if (!ID_RE.test(input.id)) throw new Error("没有这个模板。");
  const label = clean(input.label, 40);
  const content = clean(input.content, 500);
  const prompt = clean(input.prompt, 500);
  if (!label) throw new Error("先写模板名称。");
  if (!content) throw new Error("先写模板内容。");
  const rejected = noteError(`${label}\n${content}\n${prompt}`);
  if (rejected) throw new Error(rejected);
  const store = readStore();
  if (input.kind === "image") {
    const uploaded = customImage(input.id);
    const library = uploaded ? null : imageTemplate(input.id);
    if (!uploaded && !library) throw new Error("没有这个画面模板。");
    const group = IMAGE_GROUPS.some(item => item.id === input.group) ? input.group : "";
    if (!group) throw new Error("先选一个分类。");
    if (uploaded) updateCustomImage({ id: input.id, label, group, frame: content, bytes: input.bytes });
    const previous = store.images[input.id] ?? {};
    const base = (uploaded ?? library) as ImageTemplate | CustomImageTemplate;
    const edit: ImageEdit = {};
    if (!uploaded && label !== base.label) edit.label = label;
    if (!uploaded && group !== base.group) edit.group = group;
    if (!uploaded && content !== base.frame) edit.frame = content;
    if (prompt && prompt !== content) edit.prompt = prompt;
    edit.listed = input.listed;
    if (input.bytes && !uploaded) {
      const cover = writeCover("image", input.id, input.bytes);
      edit.coverExt = cover.ext;
      edit.aspectRatio = cover.aspectRatio;
    } else if (previous.coverExt) {
      edit.coverExt = previous.coverExt;
      if (previous.aspectRatio) edit.aspectRatio = previous.aspectRatio;
    }
    const defaultListed = Boolean(uploaded) || studioImageListed(input.id);
    const unchanged = !edit.label && !edit.group && !edit.frame && !edit.prompt && !edit.coverExt && edit.listed === defaultListed;
    if (unchanged) delete store.images[input.id];
    else store.images[input.id] = edit;
    writeStore(store);
    return;
  }
  const library = videoTemplate(input.id);
  if (!library) throw new Error("没有这个动作模板。");
  if (!prompt) throw new Error("先写这个动作的 Prompt。");
  const edit: VideoEdit = {};
  if (label !== library.label) edit.label = label;
  if (content !== library.description) edit.description = content;
  if (prompt !== library.action) edit.action = prompt;
  edit.listed = input.listed;
  if (input.bytes) edit.coverExt = writeCover("video", input.id, input.bytes).ext;
  else if (store.videos[input.id]?.coverExt) edit.coverExt = store.videos[input.id]?.coverExt;
  const unchanged = !edit.label && !edit.description && !edit.action && !edit.coverExt && edit.listed === true;
  if (unchanged) delete store.videos[input.id];
  else store.videos[input.id] = edit;
  writeStore(store);
}
