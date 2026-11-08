import type { ImagesBinding, R2Bucket } from "@cloudflare/workers-types";
import { publishedCardObjectKey, XUMENG_CARD_COVER_QUALITY, XUMENG_CARD_COVER_WIDTH } from "../../../src/lib/xumeng-cover-rendition";

export const CARD_COVER_CACHE = "public, max-age=3600";
const MAX_CARD_BYTES = 700_000;

export type CardMediaIdentity = { publicationId: string; revision: string };

function matches(meta: Record<string, string> | undefined, expected: CardMediaIdentity): boolean {
  return meta?.publicationId === expected.publicationId && meta?.revision === expected.revision;
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

function cardHeaders(extra?: Headers): Headers {
  const headers = extra ?? new Headers();
  headers.set("Content-Type", "image/webp");
  headers.set("Cache-Control", CARD_COVER_CACHE);
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

export async function readCardDerivative(media: R2Bucket, originalKey: string, expected: CardMediaIdentity): Promise<Response | null> {
  const stored = await media.get(publishedCardObjectKey(originalKey));
  if (!stored || !matches(stored.customMetadata, expected)) {
    await stored?.body?.cancel();
    return null;
  }
  const headers = cardHeaders(new Headers());
  stored.writeHttpMetadata(headers);
  headers.set("Content-Type", "image/webp");
  headers.set("Cache-Control", CARD_COVER_CACHE);
  headers.set("etag", stored.httpEtag);
  return new Response(stored.body, { headers });
}

/** Write the shelf WebP next to the original. A failure leaves the original in place. */
export async function washCardDerivative(
  media: R2Bucket,
  images: ImagesBinding | undefined,
  originalKey: string,
  expected: CardMediaIdentity,
): Promise<Response | null> {
  if (!images) return null;
  const source = await media.get(originalKey);
  if (!source?.body || !matches(source.customMetadata, expected)) {
    await source?.body?.cancel();
    return null;
  }
  let bytes: Uint8Array;
  try {
    const result = await images.input(source.body).transform({
      width: XUMENG_CARD_COVER_WIDTH,
      fit: "scale-down",
    }).output({ format: "image/webp", quality: XUMENG_CARD_COVER_QUALITY, anim: false });
    bytes = new Uint8Array(await new Response(result.image()).arrayBuffer());
  } catch {
    return null;
  }
  if (!isWebp(bytes) || bytes.byteLength > MAX_CARD_BYTES) return null;
  await media.put(publishedCardObjectKey(originalKey), bytes, {
    httpMetadata: { contentType: "image/webp" },
    customMetadata: { publicationId: expected.publicationId, revision: expected.revision },
  });
  const headers = cardHeaders();
  headers.set("Content-Length", String(bytes.byteLength));
  return new Response(bytes, { headers });
}
