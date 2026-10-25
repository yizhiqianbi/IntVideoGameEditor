import { TopNav } from "@/components/top-nav";
import { PlayHero } from "@/components/public/play/play-hero";
import { PlayPortal } from "@/components/public/play/play-portal";
import { RecentPlayStrip } from "@/components/public/recent-play-strip";
import { getEntriesByType } from "@/lib/public-catalog";
import { getTopRankedEntriesByType } from "@/lib/public-leaderboard";
import styles from "./page.module.css";

export default function PlayPage() {
  const entries = getEntriesByType("play");
  const ranked = getTopRankedEntriesByType("play", 8);
  const hotSlugs = ranked.slice(0, 3).map((e) => e.slug);

  return (
    <main className={styles.page}>
      <TopNav />
      <PlayHero totalCount={entries.length} topPicks={ranked} />
      <div className={styles.recentWrap}>
        <RecentPlayStrip title="继续玩" limit={8} type="play" />
      </div>
      <PlayPortal entries={entries} hotSlugs={hotSlugs} />
    </main>
  );
}
