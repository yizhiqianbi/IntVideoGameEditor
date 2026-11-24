import { findChannelModule, type FieldKind } from "@/lib/channel-catalog";
import { moduleRequest } from "@/lib/channel-form";
import { publishAsset, channelBody, channelFailure } from "@/lib/channel";
import { noteError } from "@/lib/catalog";
import { AiapiError, runAiapiRequest, sniffAiapiBytes } from "@/lib/aiapi-channel";
import { channelCredentials } from "@/lib/channel-env";
import { jsonError, sameOrigin } from "@/lib/http";
import { listVoices } from "@/lib/voices";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Packed = { type?: unknown; data?: unknown };

const LIMIT: Record<Exclude<FieldKind, "text" | "prompt">, number> = {
  image: 4_500_000,
  images: 4_500_000,
  video: 8_000_000,
  audio: 8_000_000,
  file: 1_000_000,
};

function packedList(value: unknown): Packed[] {
  if (Array.isArray(value)) return value.filter((item): item is Packed => !!item && typeof item === "object");
  if (value && typeof value === "object") return [value as Packed];
  return [];
}

function decode(packed: Packed, kind: Exclude<FieldKind, "text" | "prompt">): { bytes: Buffer; type: string } {
  const data = typeof packed.data === "string" ? packed.data.replace(/\s/g, "") : "";
  const limit = LIMIT[kind];
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length < 8 || data.length > Math.ceil(limit * 4 / 3) + 8 || data.length % 4 !== 0) {
    throw new AiapiError("上传的文件无法读取。", 400);
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.length < (kind === "file" ? 1 : 8) || bytes.length > limit) throw new AiapiError("上传的文件太大。", 413);
  if (kind === "file") {
    if (bytes.includes(0)) throw new AiapiError("文本文件需要是 UTF-8。", 400);
    const text = bytes.toString("utf8");
    const rejected = noteError(text);
    if (rejected) throw new AiapiError(rejected, 400);
    return { bytes, type: "text/plain; charset=utf-8" };
  }
  const sniffKind = kind === "images" ? "image" : kind;
  const type = sniffAiapiBytes(bytes, sniffKind);
  if (!type || type === "text/plain; charset=utf-8") throw new AiapiError("这个文件格式不能用。", 400);
  if (kind === "video" && type !== "video/mp4") throw new AiapiError("视频需要是 MP4。", 400);
  return { bytes, type };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("当前来源不能使用渠道。", 403);
  let body: { id?: unknown; values?: unknown; files?: unknown };
  try { body = await request.json(); } catch { return jsonError("请求格式无效。", 400); }
  const module = findChannelModule(typeof body.id === "string" ? body.id : "");
  if (!module) return jsonError("没有这个渠道能力。", 400);
  const incoming = body.values && typeof body.values === "object" ? body.values as Record<string, unknown> : {};
  const files = body.files && typeof body.files === "object" ? body.files as Record<string, unknown> : {};
  const values: Record<string, string> = {};
  try {
    for (const field of module.fields) {
      const raw = incoming[field.key];
      if (typeof raw === "string") values[field.key] = raw;
      if (field.kind === "text" || field.kind === "prompt") continue;
      const uploads = packedList(files[field.key]);
      if (!uploads.length) continue;
      if (field.kind === "images") {
        if (uploads.length > 9) throw new AiapiError("参考图最多 9 张。", 400);
        const urls: string[] = [];
        for (const upload of uploads) {
          const file = decode(upload, "images");
          urls.push(await publishAsset(file.bytes, file.type));
        }
        values[field.key] = JSON.stringify(urls);
        continue;
      }
      const file = decode(uploads[0], field.kind);
      values[field.key] = await publishAsset(file.bytes, file.type);
    }
    if (module.id === "generate-audio" || module.id === "generate-ttsv2") {
      const voices = await listVoices();
      const chosen = (values.spk_id ?? "").trim();
      if (!chosen && module.id === "generate-audio") values.spk_id = voices[0] ?? "中文女";
      else if (!voices.includes(chosen)) throw new AiapiError("请从音色列表里选一个。", 400);
    }
    const taskId = `channel-${crypto.randomUUID()}`;
    const job = moduleRequest(module, values, taskId);
    const rendered = await runAiapiRequest(channelCredentials(), job);
    return channelBody(rendered.bytes, rendered.contentType);
  } catch (error) {
    return channelFailure(error);
  }
}
