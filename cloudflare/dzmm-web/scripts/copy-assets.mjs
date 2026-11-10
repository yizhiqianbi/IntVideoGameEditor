import { cp, copyFile, lstat, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { verifiedUserCardAssets } from "./user-card-assets.mjs";

const defaultFrontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ACTION_TEMPLATE_IDS = [
  "action-high-five", "action-handshake", "action-hug", "action-object-exchange",
  "action-side-by-side-walk", "action-paired-dance",
];

// A fixed, original MP4 contract: one silent H.264 track, 640x400, 96 frames
// at 24 fps and moov before mdat. Parsing box boundaries prevents a forged
// extension or a stray signature in arbitrary bytes from passing the build.
function isActionDemoMp4(bytes) {
  function boxes(start, end) {
    const result = [];
    for (let offset = start; offset < end;) {
      if (end - offset < 8) throw new Error("truncated MP4 box");
      const size = bytes.readUInt32BE(offset);
      if (size < 8 || offset + size > end) throw new Error("invalid MP4 box");
      result.push({ type: bytes.toString("ascii", offset + 4, offset + 8), start: offset, end: offset + size });
      offset += size;
    }
    return result;
  }
  function one(items, type) {
    const matching = items.filter(item => item.type === type);
    if (matching.length !== 1) throw new Error(`expected one MP4 ${type}`);
    return matching[0];
  }
  function children(box) { return boxes(box.start + 8, box.end); }
  try {
    const top = boxes(0, bytes.length), ftyp = one(top, "ftyp"), moov = one(top, "moov"), mdat = one(top, "mdat");
    if (ftyp.start !== 0 || ftyp.end < 24 || bytes.toString("ascii", 8, 12) !== "isom"
      || moov.start > mdat.start || mdat.end - mdat.start <= 8) return false;
    const movie = children(moov), mvhd = one(movie, "mvhd"), tracks = movie.filter(box => box.type === "trak");
    if (mvhd.end - mvhd.start < 28 || bytes[mvhd.start + 8] !== 0
      || bytes.readUInt32BE(mvhd.start + 20) !== 1000 || bytes.readUInt32BE(mvhd.start + 24) !== 4000
      || tracks.length !== 1) return false;
    const track = children(tracks[0]), tkhd = one(track, "tkhd"), media = children(one(track, "mdia"));
    const hdlr = one(media, "hdlr"), mdhd = one(media, "mdhd");
    if (tkhd.end - tkhd.start < 92 || bytes[tkhd.start + 8] !== 0
      || bytes.readUInt32BE(tkhd.end - 8) !== 640 * 65536 || bytes.readUInt32BE(tkhd.end - 4) !== 400 * 65536
      || hdlr.end - hdlr.start < 20 || bytes.toString("ascii", hdlr.start + 16, hdlr.start + 20) !== "vide"
      || mdhd.end - mdhd.start < 28 || bytes[mdhd.start + 8] !== 0) return false;
    const table = children(one(children(one(media, "minf")), "stbl"));
    const stsd = one(table, "stsd"), stts = one(table, "stts");
    if (stsd.end - stsd.start < 16 || bytes.readUInt32BE(stsd.start + 12) !== 1
      || stts.end - stts.start !== 24 || bytes.readUInt32BE(stts.start + 12) !== 1
      || bytes.readUInt32BE(stts.start + 16) !== 96) return false;
    const entries = boxes(stsd.start + 16, stsd.end), avc = one(entries, "avc1");
    if (entries.length !== 1 || avc.end - avc.start < 94
      || bytes.readUInt16BE(avc.start + 32) !== 640 || bytes.readUInt16BE(avc.start + 34) !== 400) return false;
    const avcC = one(boxes(avc.start + 86, avc.end), "avcC");
    const timescale = bytes.readUInt32BE(mdhd.start + 20), duration = bytes.readUInt32BE(mdhd.start + 24);
    const delta = bytes.readUInt32BE(stts.start + 20);
    return avcC.end - avcC.start >= 16 && bytes[avcC.start + 8] === 1
      && timescale > 0 && delta > 0 && timescale / delta === 24 && duration / timescale === 4;
  } catch { return false; }
}

export async function copyVerifiedAssets({
  frontendRoot = defaultFrontendRoot,
  destinationRoot = join(frontendRoot, "dist/assets/xumeng"),
} = {}) {
  const sourceRoot = resolve(frontendRoot, "../../public/dzmm");
  const runtimeIntroductionsPath = resolve(frontendRoot, "../../src/lib/dzmm-public-introductions.json");

  const samples = JSON.parse(await readFile(join(sourceRoot, "public-character-samples.json"), "utf8"));
  const publicIntroductionBytes = await readFile(join(sourceRoot, "public-character-introductions.json"));
  const runtimeIntroductionBytes = await readFile(runtimeIntroductionsPath);
  if (!publicIntroductionBytes.equals(runtimeIntroductionBytes)) {
    throw new Error("公开介绍下载目录与运行目录必须逐字节一致。");
  }
  const introductions = JSON.parse(publicIntroductionBytes.toString("utf8"));
  if (!Array.isArray(samples.characters) || samples.characters.length !== 10) {
    throw new Error("公开角色样本必须是已核对的 10 条目录。");
  }
  if (!Array.isArray(introductions.characters) || introductions.characters.length < 1
    || introductions.characters.length > 500) {
    throw new Error("公开介绍目录必须包含 1–500 条已核对记录。");
  }

  function validText(value, maxLength) {
    return typeof value === "string" && Boolean(value.trim())
      && value.length <= maxLength && !value.includes("\0");
  }

  function validSourceUrl(character) {
    if (!validText(character.sourceUrl, 2048)) return false;
    try {
      const url = new URL(character.sourceUrl);
      return url.origin === "https://www.lumivale.xyz"
        && !url.username && !url.password && !url.hash
        && url.pathname === `/character/${character.id}`;
    } catch {
      return false;
    }
  }

  for (const [index, character] of introductions.characters.entries()) {
    const isRecord = character !== null && typeof character === "object" && !Array.isArray(character);
    if (!isRecord
      || typeof character.id !== "string" || !/^\d{1,120}$/.test(character.id)
      || !validText(character.name, 120) || !validText(character.author, 120)
      || !validText(character.description, 12000)
      || character.personality !== "" || character.scenario !== "" || character.firstMessage !== ""
      || !Array.isArray(character.tags) || character.tags.length > 20
      || character.tags.some((tag) => !validText(tag, 40))
      || !validText(character.createdAt, 100) || !Number.isFinite(Date.parse(character.createdAt))
      || character.sourceKind !== "public-summary" || character.promptOrigin !== "public-verbatim"
      || !validSourceUrl(character)
      || typeof character.publicIntroductionSha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(character.publicIntroductionSha256)
      || createHash("sha256").update(character.description, "utf8").digest("hex") !== character.publicIntroductionSha256) {
      throw new Error(`公开介绍第 ${index + 1} 条的字段、来源或原文校验值无效。`);
    }
  }
  const characters = [...samples.characters, ...introductions.characters];
  if (new Set(characters.map((character) => character.id)).size !== characters.length) {
    throw new Error("公开角色 ID 不可重复。");
  }

  const mediaBytes = await readFile(join(sourceRoot, "public-character-media.json"));
  if (!mediaBytes.equals(await readFile(resolve(frontendRoot, "../../src/lib/dzmm-character-media.json")))) {
    throw new Error("公开多图与开场的下载目录和运行目录必须一致。");
  }
  const media = JSON.parse(mediaBytes.toString("utf8"));
  const galleries = [];
  for (const [id, item] of Object.entries(media.characters ?? {})) {
    if (!introductions.characters.some(character => character.id === id)
      || item.sourceUrl !== `https://www.lumivale.xyz/character/${id}`
      || !Array.isArray(item.gallery) || item.gallery.length > 20) throw new Error("多图角色来源无效。");
    if (item.opening && (item.opening.origin !== "public-rendered" || !validText(item.opening.text, 12000)
      || createHash("sha256").update(item.opening.text, "utf8").digest("hex") !== item.opening.sha256)) {
      throw new Error("公开渲染开场的原文校验无效。");
    }
    for (const image of item.gallery) {
      if (!new RegExp(`^/dzmm/gallery/${id}-[1-9][0-9]*\\.webp$`).test(image.path)) throw new Error("多图路径无效。");
      const path = image.path.slice("/dzmm/".length);
      if (createHash("sha256").update(await readFile(join(sourceRoot, path))).digest("hex") !== image.sha256) throw new Error("多图文件校验无效。");
      galleries.push(path);
    }
  }

  const categoryBytes = await readFile(join(sourceRoot, "public-category-covers.json"));
  if (!categoryBytes.equals(await readFile(resolve(frontendRoot, "../../src/lib/dzmm-category-covers.json")))) throw new Error("分类封面运行目录与下载目录必须一致。");
  const categoryCovers = [];
  for (const [slug, item] of Object.entries(JSON.parse(categoryBytes.toString("utf8")))) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || item.path !== `/dzmm/categories/${slug}.webp`) throw new Error("分类图片路径无效。");
    const path = item.path.slice("/dzmm/".length);
    if (createHash("sha256").update(await readFile(join(sourceRoot, path))).digest("hex") !== item.sha256) throw new Error("分类图片文件校验无效。");
    categoryCovers.push(path);
  }

  const covers = characters.map((character) => {
    if (typeof character.cover !== "string" || !/^\/dzmm\/covers\/\d+\.(webp|png)$/.test(character.cover)) {
      throw new Error("公开样本包含不在允许范围内的封面路径。");
    }
    return character.cover.slice("/dzmm/".length);
  });

  const manifest = JSON.parse(await readFile(join(sourceRoot, "manifest.webmanifest"), "utf8"));
  if (manifest.id !== "/" || manifest.start_url !== "/" || manifest.scope !== "/"
    || manifest.display !== "standalone" || manifest.prefer_related_applications !== false
    || !validText(manifest.name, 120) || !Array.isArray(manifest.icons) || manifest.icons.length !== 2) {
    throw new Error("安装清单必须指向本站页面和已核对的 PNG 图标。");
  }
  for (const size of [192, 512]) {
    const path = `brand/xumeng-icon-${size}.png`;
    const icon = manifest.icons.find(item => item.src === `/assets/xumeng/${path}`);
    const bytes = await readFile(join(sourceRoot, path));
    if (!icon || icon.type !== "image/png" || icon.sizes !== `${size}x${size}` || icon.purpose !== "any"
      || bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      || bytes.subarray(12, 16).toString("ascii") !== "IHDR"
      || bytes.readUInt32BE(16) !== size || bytes.readUInt32BE(20) !== size) {
      throw new Error(`安装图标格式或尺寸无效：${path}`);
    }
  }

  const templateIds = ["character", "scene", "cover", "product", "short-film"];
  const templateManifest = JSON.parse(await readFile(join(sourceRoot, "generation-templates/manifest.json"), "utf8"));
  if (templateManifest.schemaVersion !== 1 || templateManifest.provenance?.kind !== "original-svg-illustration"
    || templateManifest.provenance.modelOutput !== false || templateManifest.provenance.thirdPartyAssets !== false
    || templateManifest.canvas?.width !== 800 || templateManifest.canvas.height !== 520
    || templateManifest.canvas.viewBox !== "0 0 800 520" || !Array.isArray(templateManifest.assets)
    || templateManifest.assets.length !== templateIds.length) throw new Error("模板原创示意资源清单无效。");
  const templateCovers = [];
  for (const id of templateIds) {
    const item = templateManifest.assets.find(asset => asset.id === id);
    const path = `generation-templates/${id}.svg`;
    if (!item || item.path !== `/dzmm/${path}` || item.provenance !== "original-svg-illustration") throw new Error("模板示意资源路径无效。");
    const bytes = await readFile(join(sourceRoot, path)), svg = bytes.toString("utf8");
    if (createHash("sha256").update(bytes).digest("hex") !== item.sha256
      || !/^\s*<svg\b/.test(svg) || !/viewBox="0 0 800 520"/.test(svg)
      || /<(?:script|foreignObject|image|text)\b|\bon[a-z]+\s*=|(?:href|src)\s*=\s*["'](?!#)|<!DOCTYPE|<!ENTITY/i.test(svg)) {
      throw new Error(`模板示意图片校验失败：${path}`);
    }
    templateCovers.push(path);
  }

  const actionManifestPath = join(sourceRoot, "action-templates/manifest.json");
  const actionManifest = JSON.parse(await readFile(actionManifestPath, "utf8"));
  const actionSource = join(frontendRoot, "scripts/build-action-demos.py");
  const actionSourceMetadata = await lstat(actionSource);
  if (actionManifest.schemaVersion !== 1 || actionManifest.provenance?.kind !== "original-procedural-animation"
    || actionManifest.provenance.modelOutput !== false || actionManifest.provenance.thirdPartyAssets !== false
    || actionManifest.source?.path !== "cloudflare/dzmm-web/scripts/build-action-demos.py"
    || !actionSourceMetadata.isFile() || actionSourceMetadata.isSymbolicLink()
    || createHash("sha256").update(await readFile(actionSource)).digest("hex") !== actionManifest.source.sha256
    || actionManifest.canvas?.width !== 640 || actionManifest.canvas.height !== 400
    || !Array.isArray(actionManifest.assets) || actionManifest.assets.length !== ACTION_TEMPLATE_IDS.length
    || new Set(actionManifest.assets.map(item => item?.id)).size !== ACTION_TEMPLATE_IDS.length) {
    throw new Error("动作模板原创示意资源清单或绘制源码校验无效。");
  }
  const actionFiles = [];
  for (const id of ACTION_TEMPLATE_IDS) {
    const item = actionManifest.assets.find(asset => asset?.id === id);
    if (!item || item.provenance !== "original-procedural-animation") throw new Error("动作示意资源 ID 无效。");
    for (const type of ["video", "poster"]) {
      const info = item[type], path = `action-templates/${id}.${type === "video" ? "mp4" : "png"}`;
      if (!info || info.path !== `/dzmm/${path}` || info.width !== 640 || info.height !== 400
        || !Number.isSafeInteger(info.bytes) || info.bytes < 24 || info.bytes > (type === "video" ? 2 * 1024 * 1024 : 1024 * 1024)
        || typeof info.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(info.sha256)) throw new Error("动作示意资源路径或规格无效。");
      const metadata = await lstat(join(sourceRoot, path));
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`动作示意资源必须是普通文件：${path}`);
      const bytes = await readFile(join(sourceRoot, path));
      const validVideo = type === "video" && info.mimeType === "video/mp4" && info.codec === "h264"
        && info.pixelFormat === "yuv420p" && info.fps === 24 && info.durationSeconds === 4 && info.audio === false
        && isActionDemoMp4(bytes);
      const validPoster = type === "poster" && info.mimeType === "image/png"
        && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
        && bytes.subarray(12, 16).toString("ascii") === "IHDR"
        && bytes.readUInt32BE(16) === 640 && bytes.readUInt32BE(20) === 400;
      if (bytes.length !== info.bytes || createHash("sha256").update(bytes).digest("hex") !== info.sha256
        || !(validVideo || validPoster)) throw new Error(`动作示意资源格式或字节校验失败：${path}`);
      actionFiles.push(path);
    }
  }

  const h3Manifest = JSON.parse(await readFile(join(sourceRoot, "h3-actions/manifest.json"), "utf8"));
  if (h3Manifest.schemaVersion !== 1 || h3Manifest.provenance?.kind !== "third-party-minimax-h3-demo"
    || h3Manifest.provenance.repo !== "EllaPriest45/MinimaxH3_Actions"
    || h3Manifest.provenance.thirdPartyAssets !== true || h3Manifest.provenance.weightsBundled !== false
    || h3Manifest.provenance.modelOutput !== false || !Array.isArray(h3Manifest.assets)
    || h3Manifest.assets.length < 16) throw new Error("H3 动作预览清单无效。");
  const h3Files = ["h3-actions/manifest.json"];
  const h3Ids = new Set();
  for (const item of h3Manifest.assets) {
    if (!item || typeof item.id !== "string" || !/^h3(?:-[a-z0-9]+)+$/.test(item.id) || h3Ids.has(item.id)) {
      throw new Error("H3 动作预览 ID 无效。");
    }
    h3Ids.add(item.id);
    for (const type of ["video", "poster"]) {
      const extension = type === "video" ? "mp4" : "webp";
      const info = item[type];
      const path = `h3-actions/${item.id}.${extension}`;
      const mimeType = type === "video" ? "video/mp4" : "image/webp";
      if (!info || info.path !== `/dzmm/${path}` || info.mimeType !== mimeType
        || !Number.isSafeInteger(info.bytes) || info.bytes < 24
        || info.bytes > (type === "video" ? 1_500_000 : 400_000)
        || typeof info.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(info.sha256)) {
        throw new Error(`H3 动作预览规格无效：${path}`);
      }
      const metadata = await lstat(join(sourceRoot, path));
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`H3 动作预览必须是普通文件：${path}`);
      const bytes = await readFile(join(sourceRoot, path));
      const magicOk = type === "video"
        ? bytes.subarray(4, 8).toString("ascii") === "ftyp"
        : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
      if (bytes.length !== info.bytes || createHash("sha256").update(bytes).digest("hex") !== info.sha256 || !magicOk) {
        throw new Error(`H3 动作预览校验失败：${path}`);
      }
      h3Files.push(path);
    }
  }

  const kreaManifest = JSON.parse(await readFile(join(sourceRoot, "krea2-actions/manifest.json"), "utf8"));
  if (kreaManifest.schemaVersion !== 1 || kreaManifest.provenance?.kind !== "third-party-krea2-preview"
    || kreaManifest.provenance.repo !== "EllaPriest45/Krea2_actions"
    || kreaManifest.provenance.thirdPartyAssets !== true || kreaManifest.provenance.weightsBundled !== false
    || kreaManifest.provenance.modelOutput !== false || !Array.isArray(kreaManifest.assets)
    || kreaManifest.assets.length < 100) throw new Error("Krea2 画面模板清单无效。");
  const kreaFiles = ["krea2-actions/manifest.json"];
  const kreaIds = new Set();
  for (const item of kreaManifest.assets) {
    if (!item || typeof item.id !== "string" || !/^krea2(?:-[a-z0-9]+)+$/.test(item.id) || kreaIds.has(item.id)) {
      throw new Error("Krea2 画面模板 ID 无效。");
    }
    kreaIds.add(item.id);
    const info = item.poster;
    const path = `krea2-actions/${item.id}.webp`;
    if (!info || info.path !== `/dzmm/${path}` || info.mimeType !== "image/webp"
      || !Number.isSafeInteger(info.bytes) || info.bytes < 800 || info.bytes > 200_000
      || !Number.isSafeInteger(info.width) || info.width < 32
      || !Number.isSafeInteger(info.height) || info.height < 32
      || typeof info.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(info.sha256)) {
      throw new Error(`Krea2 画面模板规格无效：${path}`);
    }
    const metadata = await lstat(join(sourceRoot, path));
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Krea2 画面模板必须是普通文件：${path}`);
    const bytes = await readFile(join(sourceRoot, path));
    const magicOk = bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (bytes.length !== info.bytes || createHash("sha256").update(bytes).digest("hex") !== info.sha256 || !magicOk) {
      throw new Error(`Krea2 画面模板校验失败：${path}`);
    }
    kreaFiles.push(path);
  }

  const files = new Set([
    "live/rtc.js",
    "i18n/cards-en.json",
    "i18n/cards-zh-Hant.json",
    "i18n/cards-ja.json",
    "i18n/cards-ko.json",
    "brand/xumeng-mark.svg",
    "brand/xumeng-character-placeholder.svg",
    "brand/xumeng-icon-192.png",
    "brand/xumeng-icon-512.png",
    "brand/xumeng-favicon.ico",
    "brand/sources.json",
    "manifest.webmanifest",
    "content-covers/yume.jpg",
    "content-covers/tangtang.jpg",
    "content-covers/wanning.jpg",
    "content-covers/sumai.jpg",
    "public-character-samples.json",
    "public-character-introductions.json",
    "public-character-media.json",
    "public-category-covers.json",
    "generation-templates/manifest.json",
    "action-templates/manifest.json",
    ...actionFiles,
    ...h3Files,
    ...kreaFiles,
    ...templateCovers,
    ...categoryCovers,
    ...galleries,
    ...covers,
  ]);

  // Original, author-exported cards are published byte-for-byte. The manifest
  // is an explicit file allowlist, never a recursive copy of the import folder.
  const cardManifest = JSON.parse(await readFile(join(sourceRoot, "exported-cards/manifest.json"), "utf8"));
  const expectedCards = new Set(["peiyu", "tangtuantuan", "wangushi", "shenyan", "huoyushen", "jiwenqing", "naifuer", "songzhixia", "jiangchiye", "sunianzhi", "xuanjing", "nie-xiaoqian", "caleb", "edmund-harrower", "frankie-doyle", "redline-salvage", "rosalind", "the-lighthouse"].flatMap(slug =>
    [`foreverse-${slug}.v2.json`, `foreverse-${slug}-cover.png`]).concat("LICENSE-CONTENT.txt"));
  if (cardManifest.version !== 1 || cardManifest.license !== "CC BY 4.0" || !Array.isArray(cardManifest.files)
    || cardManifest.files.length !== expectedCards.size) throw new Error("完整角色原件清单无效。");
  for (const file of cardManifest.files) {
    if (!expectedCards.delete(file.path)) throw new Error("完整角色原件路径无效或重复。");
    const relative = `exported-cards/${file.path}`;
    const info = await lstat(join(sourceRoot, relative));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("完整角色原件必须是普通文件。");
    const bytes = await readFile(join(sourceRoot, relative));
    if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256)
      throw new Error(`完整角色原件字节校验失败：${file.path}`);
    if (file.path.endsWith(".v2.json")) {
      const card = JSON.parse(bytes.toString("utf8"));
      if (card.spec !== "chara_card_v2" || !card.data?.description || !card.data?.first_mes
        || !card.data?.character_book?.entries?.length) throw new Error("角色原件缺少设定、开场或世界书。");
    }
    files.add(relative);
    if (file.path.endsWith("-cover.png")) {
      const cardRelative = `exported-cards/${file.path.replace(/\.png$/, "-card.jpg")}`;
      const card = await readFile(join(sourceRoot, cardRelative));
      const jpeg = card.length >= 8_000 && card.length <= 180_000 && card[0] === 0xff && card[1] === 0xd8 && card[2] === 0xff && card.at(-2) === 0xff && card.at(-1) === 0xd9;
      if (!jpeg) throw new Error(`角色封面预览必须是完整 JPEG：${cardRelative}`);
      files.add(cardRelative);
    }
  }
  files.add("exported-cards/manifest.json");
  for (const path of await verifiedUserCardAssets(sourceRoot)) {
    files.add(path);
    if (!path.endsWith(".png")) continue;
    const cardRelative = path.replace(/\.png$/, "-card.jpg");
    const card = await readFile(join(sourceRoot, cardRelative));
    const jpeg = card.length >= 8_000 && card.length <= 180_000 && card[0] === 0xff && card[1] === 0xd8 && card[2] === 0xff && card.at(-2) === 0xff && card.at(-1) === 0xd9;
    if (!jpeg) throw new Error(`用户角色封面预览必须是完整 JPEG：${cardRelative}`);
    files.add(cardRelative);
  }

  for (const relativeFile of files) {
    if (relativeFile.startsWith("content-covers/")) {
      const cover = await readFile(join(sourceRoot, relativeFile));
      if (cover.length < 20_000 || cover.length > 2_000_000 || cover[0] !== 0xff || cover[1] !== 0xd8 || cover[2] !== 0xff || cover.at(-2) !== 0xff || cover.at(-1) !== 0xd9) {
        throw new Error(`内容封面必须是完整 JPEG：${relativeFile}`);
      }
    }
    const source = join(sourceRoot, relativeFile);
    const metadata = await lstat(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`静态资源必须是普通文件：${relativeFile}`);
    }
    const destination = join(destinationRoot, relativeFile);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  return files.size;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = await copyVerifiedAssets();
  const jumpSource = resolve(defaultFrontendRoot, "jump");
  await cp(jumpSource, resolve(defaultFrontendRoot, "dist/jump"), { recursive: true });
  // Public domain-ownership proof, never a merchant API key. The challenge is
  // issued in Waffo Business Details and must be refreshed there if it expires.
  const verificationSource = resolve(defaultFrontendRoot, "verification/waffo-verify.txt");
  const verification = (await readFile(verificationSource, "utf8")).trim();
  if (!/^[a-f0-9]{28,64}$/.test(verification)) throw new Error("Waffo 域名验证文件格式无效。");
  await mkdir(resolve(defaultFrontendRoot, "dist/.well-known"), { recursive: true });
  await copyFile(verificationSource, resolve(defaultFrontendRoot, "dist/.well-known/waffo-verify.txt"));
  console.log(`Copied ${count} verified XUMENG assets.`);
}
