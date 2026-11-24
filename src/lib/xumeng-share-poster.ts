const COVER_FILE = /^\/covers\/huangguo\/[0-9]{4,8}\.(?:png|jpe?g|webp)$/;

export const XUMENG_SHARE_COVER_MAX_BYTES = 8_000_000;

/** Only the public short-drama stills can be pulled through the same-origin poster proxy. */
export function xumengVideoCoverUpstream(src: string | null, version: string | null): string | null {
  if (!src || !COVER_FILE.test(src)) return null;
  if (src.includes("..") || src.includes("\\") || src.includes("%") || src.includes("\0")) return null;
  if (version !== null && version !== "" && !/^[0-9]{1,4}$/.test(version)) return null;
  return `https://video.xumengchat.top${src}${version ? `?v=${version}` : ""}`;
}

/** Browser-safe path for a video.xumengchat.top cover. Anything else stays unset. */
export function xumengVideoCoverProxyPath(source: string): string | null {
  let url: URL;
  try { url = new URL(source); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== "video.xumengchat.top" || url.port || url.username || url.password || url.hash) return null;
  if ([...url.searchParams.keys()].some((key) => key !== "v")) return null;
  const version = url.searchParams.get("v");
  if (!xumengVideoCoverUpstream(url.pathname, version)) return null;
  const params = new URLSearchParams();
  params.set("src", url.pathname);
  if (version) params.set("v", version);
  return `/api/xumeng-share/cover?${params.toString()}`;
}

/** Same-origin address the canvas may fetch without tainting the poster. */
export function sharePosterImageUrl(source: string, pageOrigin = ""): string {
  const trimmed = source.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("blob:") || trimmed.startsWith("/")) return trimmed;
  if (trimmed.startsWith("data:image/")) return trimmed;
  const proxy = xumengVideoCoverProxyPath(trimmed);
  if (proxy) return proxy;
  try {
    const url = new URL(trimmed);
    if (pageOrigin && url.origin === pageOrigin) return trimmed;
  } catch { /* Not a URL we can draw. */ }
  return "";
}

export function xumengShareCoverImageType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (bytes.length > XUMENG_SHARE_COVER_MAX_BYTES) return null;
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/** One line for the poster. Longer introductions keep their opening and an ellipsis. */
export function shareHookLine(value: string, max = 56): string {
  const line = value.replace(/\s+/gu, " ").trim();
  if (!line) return "在叙梦，把想象变成作品。";
  const chars = Array.from(line);
  if (chars.length <= max) return line;
  return `${chars.slice(0, Math.max(1, max - 1)).join("")}…`;
}

export function sharePosterFileName(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "").trim().slice(0, 24) || "分享";
  return `叙梦-${clean}.png`;
}
