import Link from "next/link";
import type { PublicContentEntry } from "@/lib/public-catalog";
import styles from "./leaderboard-panel.module.css";

type LeaderboardPanelProps = {
  title?: string;
  entries: PublicContentEntry[];
};

export function LeaderboardPanel({
  title = "排行榜",
  entries,
}: LeaderboardPanelProps) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
      </div>
      <div className={styles.list}>
        {entries.map((entry, index) => (
          <Link
            key={entry.id}
            href={`/${entry.type}/${entry.slug}`}
            className={styles.item}
          >
            <span className={styles.rank}>{String(index + 1).padStart(2, "0")}</span>
            <div className={styles.copy}>
              <span className={styles.itemTitle}>{entry.title}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
