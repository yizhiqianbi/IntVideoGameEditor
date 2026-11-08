import { createHash } from "node:crypto";

/** A D1 row or bound string cannot exceed 2 MB. Leave room for the JSON wrapper. */
export const DZMM_CHARACTER_ROW_INLINE_BYTES = 1_500_000;
export const DZMM_CHARACTER_PAYLOAD_PART_BYTES = 1_200_000;

const encoder = new TextEncoder();

export function payloadDigest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function splitUtf8(text: string, maxBytes: number): string[] {
  if (maxBytes < 4) throw new Error("角色扩展设定无法分段保存。");
  if (encoder.encode(text).byteLength <= maxBytes) return text ? [text] : [];
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let low = start + 1;
    let high = text.length;
    let end = start;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (encoder.encode(text.slice(start, mid)).byteLength <= maxBytes) { end = mid; low = mid + 1; }
      else high = mid - 1;
    }
    const last = text.charCodeAt(end - 1);
    const next = text.charCodeAt(end);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
    if (end <= start) throw new Error("角色扩展设定无法分段保存。");
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

export function payloadMarker(digest: string): string {
  return JSON.stringify({ __xumengPayload: digest });
}

export function readPayloadDigest(stored: string): string | undefined {
  try {
    const parsed = JSON.parse(stored) as { __xumengPayload?: unknown };
    return typeof parsed.__xumengPayload === "string" && /^[a-f0-9]{64}$/.test(parsed.__xumengPayload)
      ? parsed.__xumengPayload : undefined;
  } catch { return undefined; }
}

export function resolveCharacterContext(stored: string, parts: readonly (string | undefined)[] | undefined): string {
  const digest = readPayloadDigest(stored);
  if (!digest) return stored;
  if (!parts?.length || parts.some(part => typeof part !== "string")) throw new Error("角色扩展设定不完整。");
  const joined = parts.join("");
  if (payloadDigest(joined) !== digest) throw new Error("角色扩展设定不完整。");
  return joined;
}

/** Keep an ordinary card in one row. Move only the extension JSON out when the row would exceed D1. */
export function externalizeCharacterRow(row: Record<string, unknown>, options: {
  inlineBytes?: number; partBytes?: number;
} = {}): { row: Record<string, unknown>; parts: string[] } {
  const inlineBytes = options.inlineBytes ?? DZMM_CHARACTER_ROW_INLINE_BYTES;
  const partBytes = options.partBytes ?? DZMM_CHARACTER_PAYLOAD_PART_BYTES;
  if (encoder.encode(JSON.stringify(row)).byteLength <= inlineBytes) return { row, parts: [] };
  const context = row.context_json;
  if (typeof context !== "string") throw new Error("角色扩展设定无法保存。");
  const next = { ...row, context_json: payloadMarker(payloadDigest(context)) };
  if (encoder.encode(JSON.stringify(next)).byteLength > inlineBytes) throw new Error("这张角色超出云端单条记录上限。");
  return { row: next, parts: splitUtf8(context, partBytes) };
}
