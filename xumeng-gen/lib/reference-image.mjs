import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_BYTES = 12_000_000;

export const IMAGE_TOO_BIG = "图片太大。";
export const IMAGE_UNREADABLE = "这张图片读不了。";

function decodePayload(value) {
  if (typeof value !== "string") return null;
  const raw = (value.includes(",") ? value.slice(value.indexOf(",") + 1) : value).replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length < 32 || raw.length % 4 !== 0) return null;
  if (raw.length > 16_000_000) return { tooBig: true };
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length < 32) return null;
  if (bytes.length > MAX_BYTES) return { tooBig: true };
  return { bytes };
}

function sniff(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "";
}

function sourceName(bytes) {
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "source.gif";
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "source.bmp";
  if (bytes.toString("ascii", 0, 2) === "II" || bytes.toString("ascii", 0, 2) === "MM") return "source.tif";
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") {
    const brand = bytes.toString("ascii", 8, 12).toLowerCase();
    if (brand.startsWith("hei") || brand === "mif1") return "source.heic";
    if (brand.startsWith("avi")) return "source.avif";
  }
  return "source.img";
}

async function convertToJpeg(bytes) {
  const dir = await mkdtemp(path.join(tmpdir(), "xumeng-image-"));
  const input = path.join(dir, sourceName(bytes));
  const output = path.join(dir, "out.jpg");
  try {
    await writeFile(input, bytes);
    await execFileAsync("sips", ["-s", "format", "jpeg", input, "--out", output], { timeout: 20_000 });
    const jpeg = await readFile(output);
    if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) return null;
    return jpeg;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function videoFramePlan(width, height) {
  const sourceWidth = Math.round(Number(width));
  const sourceHeight = Math.round(Number(height));
  if (sourceWidth < 1 || sourceHeight < 1) return null;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  if (cropWidth / cropHeight > 2.5) cropWidth = Math.max(1, Math.round(cropHeight * 2.5));
  else if (cropWidth / cropHeight < 0.4) cropHeight = Math.max(1, Math.round(cropWidth / 0.4));
  let scale = 1;
  const shortSide = Math.min(cropWidth, cropHeight);
  const longSide = Math.max(cropWidth, cropHeight);
  if (shortSide < 300) scale = 300 / shortSide;
  if (longSide * scale > 6000) scale = 6000 / longSide;
  return {
    cropWidth,
    cropHeight,
    width: Math.max(1, Math.round(cropWidth * scale)),
    height: Math.max(1, Math.round(cropHeight * scale)),
  };
}

export async function fitVideoFrame(bytes) {
  const dir = await mkdtemp(path.join(tmpdir(), "xumeng-frame-"));
  const input = path.join(dir, sourceName(bytes));
  const output = path.join(dir, "frame.jpg");
  try {
    await writeFile(input, bytes);
    const { stdout } = await execFileAsync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", input], { timeout: 20_000 });
    const width = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1]);
    const height = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1]);
    const plan = videoFramePlan(width, height);
    if (!plan) return null;
    if (plan.cropWidth === width && plan.cropHeight === height && plan.width === width && plan.height === height) return null;
    const args = [];
    if (plan.cropWidth !== width || plan.cropHeight !== height) args.push("--cropToHeightWidth", String(plan.cropHeight), String(plan.cropWidth));
    if (plan.width !== plan.cropWidth || plan.height !== plan.cropHeight) args.push("--resampleHeightWidth", String(plan.height), String(plan.width));
    args.push("-s", "format", "jpeg", input, "--out", output);
    await execFileAsync("sips", args, { timeout: 20_000 });
    const jpeg = await readFile(output);
    if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) return null;
    if (jpeg.length > MAX_BYTES) return null;
    return { bytes: jpeg, type: "image/jpeg" };
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function prepareWandImage(bytes, type) {
  if (type === "image/png" || type === "image/jpeg") return { bytes, type };
  const jpeg = await convertToJpeg(bytes);
  if (!jpeg || jpeg.length > MAX_BYTES) return null;
  return { bytes: jpeg, type: "image/jpeg" };
}

export async function normalizeImage(value) {
  const decoded = decodePayload(value);
  if (!decoded) return { ok: false, error: "请先上传一张图片。" };
  if (decoded.tooBig) return { ok: false, error: IMAGE_TOO_BIG };
  const type = sniff(decoded.bytes);
  if (type) {
    return {
      ok: true,
      bytes: decoded.bytes,
      type,
      dataUrl: `data:${type};base64,${decoded.bytes.toString("base64")}`,
    };
  }
  const jpeg = await convertToJpeg(decoded.bytes);
  if (!jpeg) return { ok: false, error: IMAGE_UNREADABLE };
  if (jpeg.length > MAX_BYTES) return { ok: false, error: IMAGE_TOO_BIG };
  return {
    ok: true,
    bytes: jpeg,
    type: "image/jpeg",
    dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
  };
}
