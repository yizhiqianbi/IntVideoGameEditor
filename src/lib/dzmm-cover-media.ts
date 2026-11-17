/** Character covers stay in the existing cover string. Video is recognized from the URL extension. */
export const DZMM_COVER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Matches the site gateway's request-body ceiling so a cover video can finish the upload. */
export const DZMM_COVER_VIDEO_MAX_BYTES = 16 * 1024 * 1024;
export const DZMM_COVER_HEADER_BYTES = 256;

export const DZMM_COVER_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const DZMM_COVER_VIDEO_TYPES = ["video/mp4", "video/webm"] as const;
export const DZMM_COVER_FILE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,.mp4,.webm";
export const DZMM_GALLERY_FILE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export type DzmmCoverImageType = (typeof DZMM_COVER_IMAGE_TYPES)[number];
export type DzmmCoverVideoType = (typeof DZMM_COVER_VIDEO_TYPES)[number];
export type DzmmCoverMediaType = DzmmCoverImageType | DzmmCoverVideoType;
export type DzmmCoverExtension = "png" | "jpg" | "webp" | "gif" | "mp4" | "webm";

const EXTENSION_BY_TYPE: Record<DzmmCoverMediaType, DzmmCoverExtension> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};
const TYPE_BY_EXTENSION: Record<string, DzmmCoverMediaType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
};
const MP4_VIDEO_BRANDS = new Set([
  "isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "mp71",
  "avc1", "dash", "msnv", "av01", "hev1", "hvc1", "m4v ", "mp4v",
  "3gp4", "3gp5", "3gp6", "qt  ", "ndsc", "ndsh", "ndsm", "ndsp",
]);
const MP4_AUDIO_BRANDS = new Set(["m4a ", "m4b ", "m4p "]);

const COVER_TYPE_MESSAGE = "封面仅支持 PNG、JPEG、WebP、GIF 图片，或 MP4、WebM 视频。";
const GALLERY_TYPE_MESSAGE = "画廊只接受 PNG、JPEG、WebP 或 GIF 图片。";
const IMAGE_MISMATCH = "图片内容与文件类型不匹配。";
const VIDEO_MISMATCH = "封面视频内容与文件类型不匹配。";
const EXTENSION_MISMATCH = "文件内容与扩展名不匹配。";
const IMAGE_LIMIT = "封面图片不能超过 5 MB。";
const VIDEO_LIMIT = "封面视频不能超过 16 MB。";

export type DzmmCoverCheck =
  | { ok: true; type: DzmmCoverMediaType; extension: DzmmCoverExtension }
  | { ok: false; status: 400 | 413; message: string };

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let text = "";
  for (let index = start; index < end && index < bytes.length; index += 1) text += String.fromCharCode(bytes[index]);
  return text;
}

function isVideoType(type: string): type is DzmmCoverVideoType {
  return type === "video/mp4" || type === "video/webm";
}

export function normalizeDzmmCoverType(value: string | null | undefined): string {
  const type = (value ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return type === "image/jpg" || type === "image/pjpeg" ? "image/jpeg" : type;
}

export function dzmmCoverExtension(type: string | null | undefined): DzmmCoverExtension | null {
  const normalized = normalizeDzmmCoverType(type);
  return Object.hasOwn(EXTENSION_BY_TYPE, normalized) ? EXTENSION_BY_TYPE[normalized as DzmmCoverMediaType] : null;
}

export function dzmmCoverVideoExtension(value: string | null | undefined): ".mp4" | ".webm" | null {
  if (!value) return null;
  const path = value.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  if (path.endsWith(".mp4")) return ".mp4";
  if (path.endsWith(".webm")) return ".webm";
  return null;
}

export function isDzmmCoverVideoUrl(value: string | null | undefined): boolean {
  return dzmmCoverVideoExtension(value) !== null;
}

function filenameMediaType(filename: string): DzmmCoverMediaType | null | undefined {
  const base = filename.split(/[/\\]/).pop()?.trim() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return undefined;
  return TYPE_BY_EXTENSION[base.slice(dot + 1).toLowerCase()] ?? null;
}

function isMp4(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || ascii(bytes, 4, 8) !== "ftyp") return false;
  const major = ascii(bytes, 8, 12).toLowerCase();
  if (MP4_AUDIO_BRANDS.has(major)) return false;
  if (MP4_VIDEO_BRANDS.has(major)) return true;
  const end = Math.min(bytes.length, 64);
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    if (MP4_VIDEO_BRANDS.has(ascii(bytes, offset, offset + 4).toLowerCase())) return true;
  }
  return false;
}

function isWebm(bytes: Uint8Array): boolean {
  if (bytes.length < 8 || bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) return false;
  return ascii(bytes, 0, Math.min(bytes.length, DZMM_COVER_HEADER_BYTES)).toLowerCase().includes("webm");
}

/** Identify a cover from its file header. A renamed or mislabeled file does not pass. */
export function sniffDzmmCoverMedia(bytes: Uint8Array): DzmmCoverMediaType | null {
  if (bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  const gif = bytes.length >= 6 ? ascii(bytes, 0, 6) : "";
  if (gif === "GIF87a" || gif === "GIF89a") return "image/gif";
  if (isMp4(bytes)) return "video/mp4";
  if (isWebm(bytes)) return "video/webm";
  return null;
}

export function checkDzmmCoverHeader(input: {
  bytes: Uint8Array;
  byteLength: number;
  declaredType?: string;
  filename?: string;
  gallery?: boolean;
}): DzmmCoverCheck {
  if (!input.byteLength) {
    return { ok: false, status: 400, message: input.gallery ? "请选择画廊图片。" : "请选择封面文件。" };
  }
  const sniffed = sniffDzmmCoverMedia(input.bytes);
  const declared = normalizeDzmmCoverType(input.declaredType);
  const named = input.filename === undefined ? undefined : filenameMediaType(input.filename);
  const declaredKnown = Boolean(dzmmCoverExtension(declared));
  if (input.gallery) {
    if (!sniffed || isVideoType(sniffed) || (declaredKnown && declared !== sniffed) || named === null || (named !== undefined && named !== sniffed)) {
      return { ok: false, status: 400, message: GALLERY_TYPE_MESSAGE };
    }
    if (input.byteLength > DZMM_COVER_IMAGE_MAX_BYTES) return { ok: false, status: 413, message: IMAGE_LIMIT };
    return { ok: true, type: sniffed, extension: EXTENSION_BY_TYPE[sniffed] };
  }
  if (!sniffed || (declaredKnown && declared !== sniffed)) {
    const claimedVideo = isVideoType(declared) || (sniffed !== null && isVideoType(sniffed));
    return { ok: false, status: 400, message: claimedVideo ? VIDEO_MISMATCH : declaredKnown ? IMAGE_MISMATCH : COVER_TYPE_MESSAGE };
  }
  if (!declaredKnown && declared && declared !== "application/octet-stream") {
    return { ok: false, status: 400, message: COVER_TYPE_MESSAGE };
  }
  if (named === null || (named !== undefined && named !== sniffed)) return { ok: false, status: 400, message: EXTENSION_MISMATCH };
  const video = isVideoType(sniffed);
  if (input.byteLength > (video ? DZMM_COVER_VIDEO_MAX_BYTES : DZMM_COVER_IMAGE_MAX_BYTES)) {
    return { ok: false, status: 413, message: video ? VIDEO_LIMIT : IMAGE_LIMIT };
  }
  return { ok: true, type: sniffed, extension: EXTENSION_BY_TYPE[sniffed] };
}
