import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(scriptsDir, "..");
const repoRoot = resolve(webRoot, "../..");
const script = resolve(scriptsDir, "build-character-share.py");

const result = spawnSync("python3", [script], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);

const markSvg = await readFile(resolve(repoRoot, "public/dzmm/brand/xumeng-mark.svg"), "utf8");
const markPaths = (markSvg.match(/<path[^>]+\/>/g) ?? []).join("\n");

const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#09080f"/>
      <stop offset="55%" stop-color="#171022"/>
      <stop offset="100%" stop-color="#221126"/>
    </linearGradient>
    <radialGradient id="glow1" cx="18%" cy="28%" r="48%">
      <stop offset="0%" stop-color="#ff477e" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="#ff477e" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="84%" cy="76%" r="44%">
      <stop offset="0%" stop-color="#a855f7" stop-opacity="0.24"/>
      <stop offset="100%" stop-color="#a855f7" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow1)"/>
  <rect width="1200" height="630" fill="url(#glow2)"/>
  <rect x="44" y="44" width="1112" height="542" rx="28" fill="#120f1c" fill-opacity="0.62" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1.5"/>
  <rect x="96" y="132" width="164" height="164" rx="38" fill="#fff7fa"/>
  <g transform="translate(114 150) scale(2.0)">${markPaths}</g>
  <text x="304" y="218" fill="#f7f2ec" font-family="WenQuanYi Zen Hei, Noto Sans CJK SC, PingFang SC, sans-serif" font-size="76" font-weight="700" letter-spacing="6">叙梦</text>
  <text x="506" y="214" fill="#ff5b8d" font-family="Liberation Sans, Arial, sans-serif" font-size="38" font-weight="700" letter-spacing="8">XUMENG</text>
  <text x="304" y="280" fill="#e9dff0" font-family="WenQuanYi Zen Hei, Noto Sans CJK SC, PingFang SC, sans-serif" font-size="30" font-weight="500">AI 角色扮演 · 互动故事 · AI 陪伴 · 互动短剧</text>
  <text x="96" y="378" fill="#cfc7d8" font-family="Liberation Sans, Arial, sans-serif" font-size="25">Interactive Stories, Long-Memory AI Companion, Character Cards &amp; Short Dramas</text>
  <g transform="translate(96 426)">
    <rect x="0" y="0" width="214" height="44" rx="22" fill="#ff477e" fill-opacity="0.18" stroke="#ff477e" stroke-opacity="0.5"/>
    <text x="107" y="29" text-anchor="middle" fill="#ffd9e6" font-family="WenQuanYi Zen Hei, sans-serif" font-size="20">角色卡 &amp; 世界书</text>
    <rect x="234" y="0" width="214" height="44" rx="22" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.18"/>
    <text x="341" y="29" text-anchor="middle" fill="#f4efe8" font-family="WenQuanYi Zen Hei, sans-serif" font-size="20">语音与剧情生图</text>
    <rect x="468" y="0" width="246" height="44" rx="22" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.18"/>
    <text x="591" y="29" text-anchor="middle" fill="#f4efe8" font-family="Liberation Sans, sans-serif" font-size="20">Character.AI Alternative</text>
  </g>
  <line x1="96" y1="506" x2="1104" y2="506" stroke="#ffffff" stroke-opacity="0.12"/>
  <text x="96" y="550" fill="#a89fb5" font-family="Liberation Sans, Arial, sans-serif" font-size="22" letter-spacing="3">HTTPS://XUMENGCHAT.TOP</text>
  <text x="1104" y="550" text-anchor="end" fill="#ff84ab" font-family="Liberation Sans, Arial, sans-serif" font-size="21" letter-spacing="2">ZH · 繁 · EN · JP · KO</text>
</svg>`;

const shareDir = resolve(webRoot, "dist/assets/xumeng/share");
await mkdir(shareDir, { recursive: true });
const ogDest = resolve(shareDir, "xumeng-og.jpg");
await sharp(Buffer.from(ogSvg))
  .resize(1200, 630)
  .jpeg({ quality: 86, progressive: true, mozjpeg: true })
  .toFile(ogDest);
const meta = await sharp(ogDest).metadata();
if (meta.width !== 1200 || meta.height !== 630 || meta.format !== "jpeg") {
  throw new Error(`xumeng-og.jpg must be a 1200x630 JPEG, got ${meta.width}x${meta.height} ${meta.format}`);
}
console.log("brand og banner: xumeng-og.jpg (1200x630)");
