import Link from "next/link";
import { TopNav } from "@/components/top-nav";
import { ContentCard } from "@/components/public/content-card";
import { LeaderboardPanel } from "@/components/public/leaderboard-panel";
import { PublicSearchPanel } from "@/components/public/public-search-panel";
import {
  PUBLIC_CONTENT,
  PUBLIC_SECTIONS,
  getEntriesByType,
} from "@/lib/public-catalog";
import { getTopRankedEntriesByType } from "@/lib/public-leaderboard";
import styles from "./page.module.css";

export default function Home() {
  const topPlay = getTopRankedEntriesByType("play", 8);
  const leaderboardEntries = topPlay.slice(0, 6);
  const hotEntries = topPlay.slice(0, 5);

  return (
    <main className={styles.page}>
      <TopNav />
      <div className={styles.shell}>
        <PublicSearchPanel
          entries={PUBLIC_CONTENT}
          title="搜索"
          placeholder="搜索游戏 / 互动影游 / 视频"
          limit={10}
          typeLabel="全站"
        />

        <section className={styles.topStrip}>
          <div className={styles.rankColumn}>
            <LeaderboardPanel title="热榜" entries={leaderboardEntries} />
          </div>
          <div className={styles.hotRail}>
            {hotEntries.map((entry) => (
              <ContentCard
                key={entry.id}
                entry={entry}
                href={`/${entry.type}/${entry.slug}`}
                wide
              />
            ))}
          </div>
        </section>

        <section className={styles.sectionStack}>
          {PUBLIC_SECTIONS.map((section) => {
            const entries = getEntriesByType(section.type);

            return (
              <section key={section.type} className={styles.contentSection}>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>{section.title}</h2>
                  <Link href={section.href} className={styles.sectionLink}>
                    全部
                  </Link>
                </div>
                <div className={styles.shelfRow}>
                  {entries.map((entry) => (
                    <ContentCard
                      key={entry.id}
                      entry={entry}
                      href={`/${entry.type}/${entry.slug}`}
                      compact
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </section>
      </div>
    </main>
  );
}
