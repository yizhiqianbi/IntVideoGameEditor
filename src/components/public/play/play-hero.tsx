import Link from "next/link";
import type { PublicContentEntry } from "@/lib/public-catalog";
import styles from "./play-hero.module.css";

type PlayHeroProps = {
  totalCount: number;
  topPicks: PublicContentEntry[];
};

export function PlayHero({ totalCount, topPicks }: PlayHeroProps) {
  return (
    <section className={styles.hero}>
      <div className={styles.dots} aria-hidden />
      <div className={styles.inner}>
        <div className={styles.copy}>
          <span className={styles.kicker}>
            <span className={styles.kickerDot} aria-hidden />
            ARCADE · 小游戏大厅
          </span>
          <h1 className={styles.titleRow}>
            <span className={styles.titleCn}>小游戏</span>
            <span className={styles.titleEn}>Play</span>
          </h1>
          <p className={styles.lede}>
            点开就玩，关掉就走。全都是 1 分钟内能上手的浏览器小游戏，不用下载、不用登录。
          </p>
          <div className={styles.stats}>
            <span className={styles.stat}>
              <span className={styles.statNum}>{totalCount}</span>
              款小游戏
            </span>
            <span className={styles.stat}>⚡ 即点即玩</span>
            <span className={styles.stat}>🆓 全部免费</span>
            <span className={styles.stat}>📱 手机 / 桌面通玩</span>
          </div>
        </div>

        <aside className={styles.featured}>
          <div className={styles.featuredHead}>
            <span>● 本周热玩</span>
            <span>TOP 4</span>
          </div>
          <ul className={styles.featuredList}>
            {topPicks.slice(0, 4).map((entry, i) => (
              <li key={entry.id}>
                <Link href={`/play/${entry.slug}`} className={styles.featuredItem}>
                  <span className={styles.featuredCover}>
                    <img
                      src={entry.thumbnailImageUrl ?? entry.coverImageUrl}
                      alt=""
                    />
                  </span>
                  <span className={styles.featuredCopy}>
                    <span className={styles.featuredTitle}>{entry.title}</span>
                    <span className={styles.featuredMeta}>
                      {entry.durationLabel ?? "即点即玩"}
                    </span>
                  </span>
                  <span className={styles.featuredRank}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
