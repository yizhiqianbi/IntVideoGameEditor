/** Keep saved cards and source evidence intact while serving our public routes. */
export function xumengImageUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return `/api/qingyu/image?url=${encodeURIComponent(value)}`;
  if (value.startsWith("/dzmm/")) return `/assets/qingyu/${value.slice("/dzmm/".length)}`;
  if (value.startsWith("/api/dzmm/backend/")) return `/api/backend/${value.slice("/api/dzmm/backend/".length)}`;
  return value;
}

export const XUMENG_FALLBACK_COVER = "/assets/qingyu/brand/qingyu-character-placeholder.svg";
