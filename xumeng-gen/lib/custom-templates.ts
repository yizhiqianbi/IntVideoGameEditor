import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { IMAGE_GROUPS, imageTemplate, noteError, type ImageTemplate } from "./catalog";
import { webpPixels } from "./channel";

export type CustomImageTemplate = ImageTemplate & { ext: "png" | "jpg" | "webp" };

type Store = { images: CustomImageTemplate[] };

const ROOT = path.join(process.cwd(), "data");
const FILE = path.join(ROOT, "custom-templates.json");
const MEDIA = path.join(ROOT, "template-media");
const ID_RE = /^custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function readStore(): Store {
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as Store;
    return { images: Array.isArray(parsed.images) ? parsed.images : [] };
  } catch {
    return { images: [] };
  }
}

function writeStore(store: Store) {
  mkdirSync(ROOT, { recursive: true });
  const next = path.join(ROOT, "custom-templates.json.tmp");
  writeFileSync(next, `${JSON.stringify(store, null, 2)}\n`);
  renameSync(next, FILE);
}

function knownExt(value: string): value is CustomImageTemplate["ext"] {
  return value === "png" || value === "jpg" || value === "webp";
}

export function mediaPath(item: Pick<CustomImageTemplate, "id" | "ext">): string {
  if (!ID_RE.test(item.id) || !knownExt(item.ext)) throw new Error("模板记录无效。");
  const root = path.resolve(MEDIA);
  const full = path.resolve(root, `${item.id}.${item.ext}`);
  if (!full.startsWith(`${root}${path.sep}`)) throw new Error("模板记录无效。");
  return full;
}

function usable(item: CustomImageTemplate): item is CustomImageTemplate {
  if (!item || typeof item.id !== "string" || !knownExt(item.ext)) return false;
  if (typeof item.label !== "string" || typeof item.frame !== "string" || typeof item.group !== "string") return false;
  try {
    return existsSync(mediaPath(item));
  } catch {
    return false;
  }
}

export function customImages(): CustomImageTemplate[] {
  return readStore().images.filter(usable);
}

export function customImage(id: string): CustomImageTemplate | null {
  return customImages().find(item => item.id === id) ?? null;
}

export function customImageBytes(item: CustomImageTemplate): { bytes: Buffer; type: string } | null {
  try {
    const bytes = readFileSync(mediaPath(item));
    const type = item.ext === "jpg" ? "image/jpeg" : `image/${item.ext}`;
    return { bytes, type };
  } catch {
    return null;
  }
}

export function imagePixels(bytes: Uint8Array): { width: number; height: number } | null {
  const webp = webpPixels(bytes);
  if (webp) return webp;
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const size = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (size < 2) return null;
    offset += 2 + size;
  }
  return null;
}

function aspectFor(width: number, height: number): string {
  const ratio = width / height;
  const choices: [string, number][] = [["9:16", 9 / 16], ["3:4", 3 / 4], ["1:1", 1], ["4:3", 4 / 3], ["16:9", 16 / 9]];
  return choices.reduce((best, item) => Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best)[0];
}

function sniff(bytes: Buffer): CustomImageTemplate["ext"] | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export function saveCustomImage(input: { label: string; group: string; frame: string; bytes: Buffer }): CustomImageTemplate {
  const label = input.label.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  const frame = input.frame.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  const group = IMAGE_GROUPS.some(item => item.id === input.group) ? input.group : "";
  if (!label) throw new Error("先写模板名称。");
  if (!group) throw new Error("先选一个分类。");
  if (!frame) throw new Error("先写这张模板在画什么。");
  const rejected = noteError(`${label}\n${frame}`);
  if (rejected) throw new Error(rejected);
  if (input.bytes.length < 32 || input.bytes.length > 8_000_000) throw new Error("模板图请用 8MB 以内的 PNG、JPG 或 WebP。");
  const ext = sniff(input.bytes);
  if (!ext) throw new Error("模板图请用 PNG、JPG 或 WebP。");
  const size = imagePixels(input.bytes);
  if (!size) throw new Error("这张模板图无法读取。");
  const item: CustomImageTemplate = {
    id: `custom-${crypto.randomUUID()}`,
    label,
    englishLabel: label,
    group,
    aspectRatio: aspectFor(size.width, size.height),
    frame,
    ext,
  };
  if (imageTemplate(item.id) || customImage(item.id)) throw new Error("这个模板没有存上。");
  mkdirSync(MEDIA, { recursive: true });
  writeFileSync(mediaPath(item), input.bytes);
  const store = readStore();
  store.images.unshift(item);
  writeStore(store);
  return item;
}

export function updateCustomImage(input: { id: string; label: string; group: string; frame: string; bytes: Buffer | null }): CustomImageTemplate {
  const current = customImage(input.id);
  if (!current) throw new Error("没有这个上传的模板。");
  const label = input.label.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  const frame = input.frame.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  const group = IMAGE_GROUPS.some(item => item.id === input.group) ? input.group : "";
  if (!label) throw new Error("先写模板名称。");
  if (!group) throw new Error("先选一个分类。");
  if (!frame) throw new Error("先写这张模板在画什么。");
  const rejected = noteError(`${label}\n${frame}`);
  if (rejected) throw new Error(rejected);
  let ext = current.ext;
  let aspectRatio = current.aspectRatio;
  if (input.bytes) {
    if (input.bytes.length < 32 || input.bytes.length > 8_000_000) throw new Error("模板图请用 8MB 以内的 PNG、JPG 或 WebP。");
    const sniffed = sniff(input.bytes);
    if (!sniffed) throw new Error("模板图请用 PNG、JPG 或 WebP。");
    const size = imagePixels(input.bytes);
    if (!size) throw new Error("这张模板图无法读取。");
    ext = sniffed;
    aspectRatio = aspectFor(size.width, size.height);
  }
  const next: CustomImageTemplate = { ...current, label, group, frame, ext, aspectRatio };
  if (input.bytes) {
    mkdirSync(MEDIA, { recursive: true });
    writeFileSync(mediaPath(next), input.bytes);
    if (current.ext !== ext) {
      try { rmSync(mediaPath(current), { force: true }); } catch { /* 旧封面已经换成新文件。 */ }
    }
  }
  const store = readStore();
  store.images = store.images.map(item => item.id === current.id ? next : item);
  writeStore(store);
  return next;
}

export function deleteCustomImage(id: string): boolean {
  if (!ID_RE.test(id)) return false;
  const store = readStore();
  const item = store.images.find(entry => entry.id === id);
  if (!item || !knownExt(item.ext)) return false;
  store.images = store.images.filter(entry => entry.id !== id);
  writeStore(store);
  try { rmSync(mediaPath(item), { force: true }); } catch { return true; }
  return true;
}
