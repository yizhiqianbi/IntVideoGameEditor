import {
  PUBLIC_CONTENT,
  type PublicContentEntry,
  type PublicContentType,
} from "@/lib/public-catalog";

export function getTopRankedEntriesByType(
  type: PublicContentType,
  limit = 8,
): PublicContentEntry[] {
  return PUBLIC_CONTENT.filter((entry) => entry.type === type)
    .sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0))
    .slice(0, limit);
}
