/** Hand-set display baselines for the public shelf. Account likes add on top. */
export const XUMENG_HOMEPAGE_STATS: Readonly<Record<string, { heat: string; likes: string }>> = {};

export function xumengHomepageStat(id: string): { heat: string; likes: string } | undefined {
  return XUMENG_HOMEPAGE_STATS[id];
}

function statValue(text: string): number {
  const match = text.trim().match(/^(\d+(?:\.\d+)?)(万|k)?$/i);
  if (!match) return 0;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return 0;
  return base * (match[2]?.toLowerCase() === "k" ? 1000 : match[2] === "万" ? 10000 : 1);
}

/** Keep the hand-set shelf number unless a later source is actually higher. */
export function xumengShelfStat(id: string, field: "heat" | "likes", remote: string | undefined, local: string): string {
  const seed = XUMENG_HOMEPAGE_STATS[id]?.[field];
  const chosen = remote ?? local;
  if (!seed) return chosen;
  return statValue(chosen) > statValue(seed) ? chosen : seed;
}
