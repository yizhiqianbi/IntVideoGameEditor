/** Homepage cards cycle the cover plus gallery, and stop before a long gallery loads on every shelf. */
export const XUMENG_COVER_FRAME_LIMIT = 12;

export function xumengCoverFrames(
  cover: string | null | undefined,
  gallery: readonly string[] | null | undefined,
  limit = XUMENG_COVER_FRAME_LIMIT,
): string[] {
  const frames: string[] = [];
  const push = (value: string | null | undefined) => {
    const path = typeof value === "string" ? value.trim() : "";
    if (!path || frames.includes(path) || frames.length >= limit) return;
    frames.push(path);
  };
  push(cover);
  for (const item of gallery ?? []) push(item);
  return frames;
}
