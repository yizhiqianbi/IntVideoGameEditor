import Link from "next/link";
import type { PublicContentEntry } from "@/lib/public-catalog";
import styles from "./content-card.module.css";

type ContentCardProps = {
  entry: PublicContentEntry;
  href: string;
  large?: boolean;
  compact?: boolean;
  wide?: boolean;
};

export function ContentCard({
  entry,
  href,
  large = false,
  compact = false,
  wide = false,
}: ContentCardProps) {
  return (
    <Link
      href={href}
      className={`${styles.card} ${large ? styles.cardLarge : ""} ${compact ? styles.cardCompact : ""} ${wide ? styles.cardWide : ""}`}
    >
      <div className={styles.visual}>
        <img
          src={entry.thumbnailImageUrl ?? entry.coverImageUrl}
          alt={entry.title}
          className={styles.coverImage}
        />
        {large ? (
          <div className={styles.visualOverlay}>
            <span className={styles.visualMeta}>{entry.type}</span>
            <h2 className={styles.visualTitle}>{entry.title}</h2>
          </div>
        ) : null}
      </div>

      <div className={styles.body}>
        <h3 className={styles.title}>{entry.title}</h3>
      </div>
    </Link>
  );
}
