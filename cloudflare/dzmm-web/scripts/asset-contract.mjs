// Representative media plus every fixed brand/catalog resource. The local
// contract test also checks every file produced by copyVerifiedAssets.
export const CRITICAL_STATIC_ASSETS = Object.freeze([
  "live/rtc.js",
  "brand/xumeng-mark.svg",
  "brand/xumeng-character-placeholder.svg",
  "brand/xumeng-icon-192.png",
  "brand/xumeng-icon-512.png",
  "brand/xumeng-favicon.ico",
  "brand/sources.json",
  "manifest.webmanifest",
  "public-character-samples.json",
  "public-character-introductions.json",
  "public-character-media.json",
  "public-category-covers.json",
  "covers/1323657.webp",
  "gallery/3691277-1.webp",
  "categories/truelove.webp",
  "generation-templates/manifest.json",
  "generation-templates/character.svg",
  "generation-templates/scene.svg",
  "generation-templates/cover.svg",
  "generation-templates/product.svg",
  "generation-templates/short-film.svg",
  "action-templates/manifest.json",
  "action-templates/action-high-five.mp4", "action-templates/action-high-five.png",
  "action-templates/action-handshake.mp4", "action-templates/action-handshake.png",
  "action-templates/action-hug.mp4", "action-templates/action-hug.png",
  "action-templates/action-object-exchange.mp4", "action-templates/action-object-exchange.png",
  "action-templates/action-side-by-side-walk.mp4", "action-templates/action-side-by-side-walk.png",
  "action-templates/action-paired-dance.mp4", "action-templates/action-paired-dance.png",
]);

const MIME_TYPES = {
  js: ["text/javascript", "application/javascript"],
  svg: ["image/svg+xml"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  mp4: ["video/mp4"],
  webp: ["image/webp"],
  ico: ["image/x-icon", "image/vnd.microsoft.icon"],
  json: ["application/json"],
  txt: ["text/plain"],
  webmanifest: ["application/manifest+json"],
};

export function assetMimeTypes(relativePath) {
  const extension = relativePath.slice(relativePath.lastIndexOf(".") + 1);
  const types = MIME_TYPES[extension];
  if (!types) throw new Error(`静态资源缺少类型检查：${relativePath}`);
  return types;
}

export function matchesAssetMime(relativePath, contentType) {
  const base = (contentType || "").split(";", 1)[0].trim().toLowerCase();
  return assetMimeTypes(relativePath).includes(base);
}
