const REMOTE_COVER_HOST = "static.aiaigirl.com";
export const MAX_MIRROR_BYTES = 18_000_000;

export function remoteMirrorUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (url.hostname !== REMOTE_COVER_HOST) return null;
  return url.href;
}

export function sniffStoredImage(bytes: Uint8Array): { type: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/avif"; extension: ".jpg" | ".png" | ".webp" | ".gif" | ".avif" } | null {
  if (bytes.byteLength < 12 || bytes.byteLength > MAX_MIRROR_BYTES) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: "image/jpeg", extension: ".jpg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { type: "image/png", extension: ".png" };
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return { type: "image/gif", extension: ".gif" };
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { type: "image/webp", extension: ".webp" };
  }
  const brand = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7], bytes[8], bytes[9], bytes[10], bytes[11]);
  if (brand === "ftypavif" || brand === "ftypavis") return { type: "image/avif", extension: ".avif" };
  return null;
}

/** Remote cover and gallery URLs that are not already copied into published media. */
export function pendingRemoteSlots(snapshot: { cover?: unknown; gallery?: unknown }, media: Readonly<Record<string, string>>): { slot: string; url: string }[] {
  const slots: { slot: string; url: string }[] = [];
  const cover = remoteMirrorUrl(snapshot.cover);
  if (cover && !media.cover) slots.push({ slot: "cover", url: cover });
  if (!Array.isArray(snapshot.gallery)) return slots;
  for (let index = 0; index < Math.min(snapshot.gallery.length, 12); index += 1) {
    const url = remoteMirrorUrl(snapshot.gallery[index]);
    const slot = `gallery-${index}`;
    if (url && !media[slot]) slots.push({ slot, url });
  }
  return slots;
}
