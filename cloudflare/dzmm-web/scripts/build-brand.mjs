import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const brand = resolve(root, "public/dzmm/brand");
const output = resolve(root, "output/xumeng");
await mkdir(output, { recursive: true });
const mark = await readFile(resolve(brand, "xumeng-mark.svg"), "utf8");
const paths = mark.match(/<path[^>]+\/>/g).join("\n");
const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#FFF7FA"/><g transform="translate(8 8) scale(.75)">${paths}</g></svg>`;
await writeFile(resolve(brand, "xumeng-app-icon.svg"), `${appIcon}\n`);
for (const size of [192, 512]) {
  await sharp(Buffer.from(appIcon)).resize(size, size).png().toFile(resolve(brand, `xumeng-icon-${size}.png`));
}
// ICO containers with embedded PNGs are supported by modern desktop browsers.
const icoSizes = [16, 32, 48];
const icoImages = await Promise.all(icoSizes.map(size => sharp(Buffer.from(appIcon)).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + icoSizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
icoImages.forEach((bytes, index) => {
  const entry = 6 + index * 16;
  header[entry] = icoSizes[index]; header[entry + 1] = icoSizes[index];
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(bytes.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += bytes.length;
});
await writeFile(resolve(brand, "xumeng-favicon.ico"), Buffer.concat([header, ...icoImages]));

const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="660" viewBox="0 0 1200 660">
<rect width="1200" height="660" rx="28" fill="#FFF7FA"/>
<g transform="translate(118 146) scale(4.6)">${paths}</g>
<text x="480" y="285" fill="#272233" font-family="PingFang SC, Heiti SC, sans-serif" font-size="116" font-weight="600" letter-spacing="12">叙梦</text>
<text x="490" y="355" fill="#FF477E" font-family="Arial, sans-serif" font-size="28" font-weight="600" letter-spacing="10">XUMENG</text>
<text x="490" y="425" fill="#78717E" font-family="PingFang SC, Heiti SC, sans-serif" font-size="27" letter-spacing="2">与角色相遇，让故事继续。</text>
<line x1="122" y1="519" x2="1078" y2="519" stroke="#EEDFE6"/>
<text x="122" y="573" fill="#78717E" font-family="Arial, sans-serif" font-size="20" letter-spacing="2">XUMENGCHAT.TOP</text>
<g transform="translate(981 542) scale(.7)">${paths}</g></svg>`;
await sharp(Buffer.from(preview)).png().toFile(resolve(output, "xumeng-logo-preview.png"));
await writeFile(resolve(output, "xumeng-logo-preview.svg"), preview);
const files = ["xumeng-mark.svg", "xumeng-icon-192.png", "xumeng-icon-512.png", "xumeng-favicon.ico"];
const assets = [];
for (const file of files) {
  const bytes = await readFile(resolve(brand, file));
  assets.push({ file: `/assets/xumeng/brand/${file}`, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), origin: "original-vector-design" });
}
await writeFile(resolve(brand, "sources.json"), `${JSON.stringify({ brand: "叙梦", englishName: "XUMENG", createdAt: "2026-10-03", design: "原创月牙对话气泡与星点；手绘 SVG，不使用 DZMM 图形。", assets }, null, 2)}\n`);
console.log(`Generated ${files.length} original Xumeng brand assets and a preview.`);
