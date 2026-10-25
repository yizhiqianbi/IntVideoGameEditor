import Link from "next/link";
import type { PublicContentEntry } from "@/lib/public-catalog";
import styles from "./leaderboard-panel.module.css";

type LeaderboardPanelProps = {
  title?: string;
  subtitle?: string;
  entries: PublicContentEntry[];
};

export function LeaderboardPanel({
  title = "Top Charts",
  subtitle = "本周榜单",
  entries,
}: LeaderboardPanelProps) {
  if (entries.length === 0) return null;

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <span className={styles.kicker}>
            <span className={styles.kickerDot} aria-hidden>
              ◆
            </span>
            CHARTS · 本周榜单
          </span>
          <h2 className={styles.title}>
            <span className={styles.titleEn}>Top</span>
            <span className={styles.titleCn}>热榜</span>
          </h2>
        </div>
        <div className={styles.headerMeta}>
          <span>{subtitle}</span>
          <span className={styles.headerDash} aria-hidden>
            /
          </span>
          <span className={styles.headerCount}>
            {entries.length.toString().padStart(2, "0")} 项
          </span>
        </div>
      </header>

      <ol className={styles.list}>
        {entries.map((entry, index) => {
          const rank = index + 1;
          const isTop = rank <= 3;
          return (
            <li key={entry.id} className={styles.listItem}>
              <Link
                href={`/${entry.type}/${entry.slug}`}
                className={`${styles.item} ${isTop ? styles.itemTop : ""}`}
              >
                <span
                  className={`${styles.rank} ${isTop ? styles.rankTop : ""}`}
                  aria-label={`第 ${rank} 名`}
                >
                  {String(rank).padStart(2, "0")}
                </span>

                <div className={styles.copy}>
                  <span className={styles.itemType}>
                    {entry.type.toUpperCase()} · {entry.updatedAt}
                  </span>
                  <span className={styles.itemTitle}>{entry.title}</span>
                </div>

                <span className={styles.trend} aria-hidden>
                  ↑
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
