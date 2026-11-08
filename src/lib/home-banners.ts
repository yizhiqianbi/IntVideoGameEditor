export const HOME_BANNER_AUDIENCES = ["male", "female", "general"] as const;
export type HomeBannerAudience = (typeof HOME_BANNER_AUDIENCES)[number];

export type HomeBanner = {
  id: string;
  audience: HomeBannerAudience;
  position: number;
  title: string;
  body: string;
  href: string | null;
};

/** Live banners for one audience. An unset audience stays on the general
 * shelf. A requested audience with no banners falls back to the male shelf. */
export function selectHomeBanners<T extends { audience: HomeBannerAudience; position: number; id: string }>(
  banners: readonly T[],
  audience: HomeBannerAudience | null,
): T[] {
  const ordered = (items: readonly T[]) => [...items].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  const matching = (kind: HomeBannerAudience) => ordered(banners.filter((banner) => banner.audience === kind));
  if (audience === null || audience === "general") return matching("general");
  const own = matching(audience);
  return own.length > 0 ? own : matching("male");
}
