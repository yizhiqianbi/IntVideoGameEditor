export const RECENT_PLAY_KEY = "funx-public-recent-play";

export function readRecentPlaySlugs(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(RECENT_PLAY_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function writeRecentPlaySlug(slug: string) {
  if (typeof window === "undefined") {
    return;
  }

  const current = readRecentPlaySlugs().filter((item) => item !== slug);
  const next = [slug, ...current].slice(0, 12);
  window.localStorage.setItem(RECENT_PLAY_KEY, JSON.stringify(next));
}
