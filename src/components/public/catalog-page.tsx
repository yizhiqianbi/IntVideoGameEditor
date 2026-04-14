import Link from "next/link";
import { TopNav } from "@/components/top-nav";
import {
  getEntriesByType,
  getSectionMeta,
  type PublicContentType,
} from "@/lib/public-catalog";
import { getTopRankedEntriesByType } from "@/lib/public-leaderboard";
import { ContentCard } from "./content-card";
import { LeaderboardPanel } from "./leaderboard-panel";
import { PublicSearchPanel } from "./public-search-panel";
import { RecentPlayStrip } from "./recent-play-strip";
import styles from "./catalog-page.module.css";

type CatalogPageProps = {
  type: PublicContentType;
};

export function CatalogPage({ type }: CatalogPageProps) {
  const section = getSectionMeta(type);
  const entries = getEntriesByType(type);
  const rankedEntries = getTopRankedEntriesByType(type, 8);
  const isPlay = type === "play";
  const searchPlaceholder =
    type === "play"
      ? "搜索小游戏"
      : type === "film"
        ? "搜索互动影游"
        : "搜索视频";

  return (
    <main className={styles.page}>
      <TopNav />
      <div className={styles.shell}>
        <section className={styles.portalHeader}>
          <div className={styles.portalCopy}>
            <h1 className={styles.title}>{section.title}</h1>
          </div>
          <Link href="/" className={styles.secondaryButton}>
            首页
          </Link>
        </section>

        <PublicSearchPanel
          entries={entries}
          title={`搜索 ${section.title}`}
          placeholder={searchPlaceholder}
          limit={10}
          typeLabel={section.title}
        />

        <div className={styles.portalGrid}>
          <section className={styles.mainShelf}>
            {entries.map((entry) => (
              <ContentCard
                key={entry.id}
                entry={entry}
                href={`/${entry.type}/${entry.slug}`}
                compact
              />
            ))}
          </section>

          <aside className={styles.sidebar}>
            <LeaderboardPanel title="热榜" entries={rankedEntries} />
            {isPlay ? (
              <RecentPlayStrip title="继续玩" limit={10} type="play" compact />
            ) : null}
          </aside>
        </div>
      </div>
    </main>
  );
}
