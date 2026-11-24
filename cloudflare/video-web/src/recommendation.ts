export type VideoRecommendationItem = {
  id: string;
  dramaId: string;
  title: string;
  episode: string;
  file: string;
  mediaKey: string;
  posterKey: string;
  category: string;
  badge: string;
  source: string;
};

type SeriesBucket = {
  dramaId: string;
  title: string;
  category: string;
  items: VideoRecommendationItem[];
};

/** A small deterministic hash keeps the shelf fresh without shuffling on every request. */
function hash32(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function episodeNumber(item: VideoRecommendationItem): number {
  const match = /([0-9]{1,4})\s*集?$/.exec(item.episode);
  const parsed = match ? Number(match[1]) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function dayKey(updatedAt: string): string {
  const stamp = Date.parse(updatedAt);
  return Number.isFinite(stamp) ? new Date(stamp).toISOString().slice(0, 10) : "stable";
}

/**
 * Rank series with a daily exploration seed, then interleave episodes round-robin.
 *
 * The old catalog grouped every episode of the newest numeric drama together. This
 * makes the first screen repetitive and hides older series. The new order balances
 * an import-recency proxy (numeric drama id), a stable daily exploration signal,
 * and series depth, while never showing two episodes from the same series until
 * other available series have had a chance to appear.
 */
export function diversifyVideoItems(items: VideoRecommendationItem[], updatedAt: string): VideoRecommendationItem[] {
  if (items.length < 2) return items.slice();
  const buckets = new Map<string, SeriesBucket>();
  for (const item of items) {
    const bucket = buckets.get(item.dramaId) ?? { dramaId: item.dramaId, title: item.title, category: item.category, items: [] };
    bucket.items.push(item);
    buckets.set(item.dramaId, bucket);
  }
  const allIds = [...buckets.keys()].map(id => Number(id.replace(/^hg-/, ""))).filter(Number.isFinite);
  const minId = allIds.length ? Math.min(...allIds) : 0;
  const maxId = allIds.length ? Math.max(...allIds) : 0;
  const span = Math.max(1, maxId - minId);
  const seed = dayKey(updatedAt);
  const ranked = [...buckets.values()].map(bucket => {
    bucket.items.sort((left, right) => episodeNumber(right) - episodeNumber(left) || right.id.localeCompare(left.id));
    const numericId = Number(bucket.dramaId.replace(/^hg-/, ""));
    const recency = Number.isFinite(numericId) ? (numericId - minId) / span : 0.5;
    const exploration = hash32(`${seed}:${bucket.dramaId}:${bucket.category}`) / 0xffffffff;
    const depth = Math.min(bucket.items.length, 8) / 8;
    return { bucket, score: recency * 0.28 + exploration * 0.57 + depth * 0.15 };
  }).sort((left, right) => right.score - left.score || left.bucket.dramaId.localeCompare(right.bucket.dramaId));

  const output: VideoRecommendationItem[] = [];
  for (let round = 0; ; round += 1) {
    let added = false;
    for (const { bucket } of ranked) {
      const item = bucket.items[round];
      if (!item) continue;
      output.push(item);
      added = true;
    }
    if (!added) break;
  }
  return output;
}
