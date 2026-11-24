export type PublicHomeBanner = {
  id: string;
  position: number;
  title: string;
  body: string;
  href: string | null;
};

function banner(value: unknown): PublicHomeBanner | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !Number.isInteger(row.position) || typeof row.title !== "string" || typeof row.body !== "string") return null;
  if (row.href !== null && typeof row.href !== "string") return null;
  return { id: row.id, position: row.position as number, title: row.title, body: row.body, href: row.href };
}

export async function fetchHomeBanners(): Promise<PublicHomeBanner[]> {
  const response = await fetch("/api/backend/v1/home/banners", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
  const value = await response.json().catch(() => null) as { banners?: unknown } | null;
  if (!response.ok || !value || !Array.isArray(value.banners)) return [];
  return value.banners.flatMap((item) => {
    const parsed = banner(item);
    return parsed ? [parsed] : [];
  }).sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}
