/** Shared with the public review boundary so every rendered media alias is inspected. */
type MediaKind = "image" | "audio" | "emoji";
export type MessageMedia = { kind: MediaKind; url?: string; alt?: string; label?: string; text?: string; mimeType?: string; durationMs?: number; qingyuSpeechReview?: unknown };
type Message = { media?: unknown[]; attachments?: unknown[]; segments?: unknown[] };

function safeMediaUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 8_000_000 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  if (/^data:/i.test(value)) return /^data:(?:image|audio)\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(value) ? value : null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value, "https://xumeng.local");
    if (url.username || url.password || url.protocol === "javascript:" || url.protocol === "data:" || url.protocol === "blob:") return null;
    if (url.protocol === "https:") return url.toString();
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url.toString();
    if (url.protocol === "https:" || (url.protocol === "http:" && value.startsWith("/"))) return url.toString();
  } catch { /* Invalid URLs are omitted from the transcript. */ }
  return null;
}

function mediaKind(value: unknown): MediaKind | null {
  const kind = typeof value === "string" ? value.toLowerCase() : "";
  if (["image", "photo", "picture", "img"].includes(kind)) return "image";
  if (["audio", "voice", "sound", "voice_message"].includes(kind)) return "audio";
  if (["emoji", "sticker", "emoticon"].includes(kind)) return "emoji";
  return null;
}

function mediaValue(value: unknown): MessageMedia | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const kind = mediaKind(item.kind ?? item.type ?? item.mediaType ?? item.mimeType?.toString().split("/")[0]);
  if (!kind) return null;
  const data = item.data && typeof item.data === "object" ? item.data as Record<string, unknown> : null;
  const base64 = item.base64 ?? data?.base64;
  const mimeType = item.mimeType ?? data?.mimeType;
  const encoded = typeof base64 === "string" && typeof mimeType === "string" ? `data:${mimeType};base64,${base64}` : null;
  const url = safeMediaUrl(item.url ?? item.src ?? item.uri ?? data?.url ?? data?.src ?? encoded ?? (typeof item.data === "string" ? item.data : null));
  const text = typeof item.text === "string" ? item.text : typeof item.emoji === "string" ? item.emoji : typeof data?.text === "string" ? data.text : undefined;
  if (!url && kind !== "emoji" && !text) return null;
  return {
    kind, ...(url ? { url } : {}),
    ...(item.qingyuSpeechReview ? { qingyuSpeechReview: item.qingyuSpeechReview } : {}),
    ...(typeof item.alt === "string" ? { alt: item.alt.slice(0, 240) } : {}),
    ...(typeof item.label === "string" ? { label: item.label.slice(0, 120) } : {}),
    ...(text ? { text: text.slice(0, 240) } : {}),
    ...(typeof mimeType === "string" ? { mimeType: mimeType.slice(0, 80) } : {}),
    ...(typeof item.durationMs === "number" && Number.isFinite(item.durationMs) ? { durationMs: item.durationMs } : {}),
  };
}

/** Accept the gateway's compact media array and native rich segments. Keeping
 * this adapter at the UI boundary lets the runtime evolve without changing
 * the transcript component. */
export function normalizeMedia(message: Message): MessageMedia[] {
  const values: unknown[] = [...(Array.isArray(message.media) ? message.media : []), ...(Array.isArray(message.attachments) ? message.attachments : [])];
  for (const segment of Array.isArray(message.segments) ? message.segments : []) {
    if (segment && typeof segment === "object") {
      const item = segment as Record<string, unknown>;
      if (mediaKind(item.type) || mediaKind(item.kind) || mediaKind(item.mediaType)) values.push(segment);
    }
  }
  const seen = new Set<string>();
  return values.flatMap(value => {
    const item = mediaValue(value);
    if (!item) return [];
    const key = `${item.kind}:${item.url || item.text || ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [item];
  });
}

