import Link from "next/link";
import { TopNav } from "@/components/top-nav";
import { ContentCard } from "@/components/public/content-card";
import { LeaderboardPanel } from "@/components/public/leaderboard-panel";
import { PublicSearchPanel } from "@/components/public/public-search-panel";
import { FeaturedHero } from "@/components/public/featured-hero";
import { Marquee } from "@/components/public/marquee";
import {
  PUBLIC_CONTENT,
  PUBLIC_SECTIONS,
  getEntriesByType,
} from "@/lib/public-catalog";
import { getTopRankedEntriesByType } from "@/lib/public-leaderboard";
import styles from "./page.module.css";

const TYPE_LABEL_EN: Record<string, string> = {
  play: "Play",
  film: "Film",
  video: "Video",
};

const TYPE_LABEL_CN: Record<string, string> = {
  play: "小游戏",
  film: "互动影游",
  video: "视频",
};

const TYPE_NUMBER: Record<string, string> = {
  play: "I",
  film: "II",
  video: "III",
};

export default function Home() {
  const topPlay = getTopRankedEntriesByType("play", 8);
  const leaderboardEntries = topPlay.slice(0, 6);
  const featured = topPlay[0] ?? PUBLIC_CONTENT[0];
  const hotEntries = topPlay.slice(0, 5);

  const marqueeItems = [
    "NOW STREAMING",
    ...topPlay.slice(0, 6).map((e) => e.title),
    "UPDATED WEEKLY",
    "FUN-X STUDIO",
  ];

  return (
    <main className={styles.page}>
      <TopNav />

      <Marquee items={marqueeItems} tone="dark" />

      <FeaturedHero entry={featured} volumeLabel="VOL. 01 · 2026" />

      {/* Charts + Hot rail section */}
      <section className={styles.chartsSection}>
        <div className={styles.shell}>
          <div className={styles.chartsGrid}>
            <div className={styles.chartsLeft}>
              <LeaderboardPanel
                entries={leaderboardEntries}
                subtitle="BASED ON PLAYS"
              />
            </div>

            <div className={styles.chartsRight}>
              <div className={styles.hotHead}>
                <div>
                  <span className={styles.eyebrow}>
                    <span className={styles.eyebrowDot} aria-hidden>
                      ●
                    </span>
                    HOT RIGHT NOW
                  </span>
                  <h2 className={styles.hotTitle}>
                    <span className={styles.hotTitleMain}>正在热玩</span>
                    <span className={styles.hotTitleAlt}>of the week</span>
                  </h2>
                </div>
                <Link href="/play" className={styles.headLink}>
                  <span>全部 Play</span>
                  <span aria-hidden>→</span>
                </Link>
              </div>

              <div className={styles.hotRail}>
                {hotEntries.map((entry, i) => (
                  <ContentCard
                    key={entry.id}
                    entry={entry}
                    href={`/${entry.type}/${entry.slug}`}
                    index={i}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Search band — paper block for contrast */}
      <section className={`${styles.searchBand} paperBlock`}>
        <div className={styles.shell}>
          <div className={styles.searchGrid}>
            <div className={styles.searchCopy}>
              <span className={styles.searchKicker}>FIND SOMETHING</span>
              <h2 className={styles.searchTitle}>
                <em>Search</em> 站内所有内容
              </h2>
              <p className={styles.searchLede}>
                游戏、互动影游、视频 — 一次搜索，全部找到。
              </p>
            </div>
            <div className={styles.searchPanelHost}>
              <PublicSearchPanel
                entries={PUBLIC_CONTENT}
                placeholder="搜索游戏 / 互动影游 / 视频"
                limit={10}
                hideHeader
              />
            </div>
          </div>
        </div>
      </section>

      <Marquee
        items={["ALL CATEGORIES", "PLAY", "FILM", "VIDEO", "STUDIO"]}
        tone="accent"
      />

      {/* Category sections */}
      {PUBLIC_SECTIONS.map((section) => {
        const entries = getEntriesByType(section.type);
        return (
          <section
            key={section.type}
            className={styles.categorySection}
          >
            <div className={styles.shell}>
              <div className={styles.categoryHead}>
                <div className={styles.categoryHeadLeft}>
                  <span className={styles.categoryNum}>
                    {TYPE_NUMBER[section.type]}
                  </span>
                  <div className={styles.categoryTitles}>
                    <h2 className={styles.categoryTitle}>
                      <span className={styles.categoryTitleEn}>
                        {TYPE_LABEL_EN[section.type]}
                      </span>
                      <span className={styles.categoryTitleCn}>
                        {TYPE_LABEL_CN[section.type]}
                      </span>
                    </h2>
                    <p className={styles.categoryDesc}>{section.description}</p>
                  </div>
                </div>

                <div className={styles.categoryActions}>
                  <span className={styles.categoryCount}>
                    {entries.length.toString().padStart(2, "0")} 部作品
                  </span>
                  <Link href={section.href} className={styles.categoryAll}>
                    <span>{section.ctaLabel}</span>
                    <span className={styles.categoryAllArrow} aria-hidden>
                      →
                    </span>
                  </Link>
                </div>
              </div>

              <div className={styles.categoryGrid}>
                {entries.map((entry, i) => (
                  <ContentCard
                    key={entry.id}
                    entry={entry}
                    href={`/${entry.type}/${entry.slug}`}
                    index={i}
                  />
                ))}
              </div>
            </div>
          </section>
        );
      })}

      {/* Footer band */}
      <footer className={`${styles.footerBand} paperBlock`}>
        <div className={styles.shell}>
          <div className={styles.footerInner}>
            <div className={styles.footerBrand}>
              <span className={styles.footerLogo}>
                <em>F</em>
              </span>
              <div>
                <div className={styles.footerBrandName}>Fun-X Studio</div>
                <div className={styles.footerBrandTag}>
                  Interactive stories, games, and video.
                </div>
              </div>
            </div>
            <div className={styles.footerMeta}>
              <span>© {new Date().getFullYear()} Fun-X Studio</span>
              <span className={styles.footerDot}>·</span>
              <span>VOL. 01 · 2026 EDITION</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
