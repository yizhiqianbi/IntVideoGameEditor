import Link from "next/link";
import type { PublicContentEntry } from "@/lib/public-catalog";
import styles from "./play-tile.module.css";

type PlayTileProps = {
  entry: PublicContentEntry;
  categoryLabel?: string;
  hot?: boolean;
};

const TONE_CLASS: Record<PublicContentEntry["coverTone"], string> = {
  slate: styles.toneSlate,
  violet: styles.toneViolet,
  cyan: styles.toneCyan,
  amber: styles.toneAmber,
};

export function PlayTile({ entry, categoryLabel, hot }: PlayTileProps) {
  const href = `/play/${entry.slug}`;
  const classes = [styles.tile, TONE_CLASS[entry.coverTone]].filter(Boolean).join(" ");

  return (
    <Link href={href} className={classes}>
      <div className={styles.visual}>
        <img
          src={entry.thumbnailImageUrl ?? entry.coverImageUrl}
          alt={entry.title}
          className={styles.image}
          loading="lazy"
        />
        {categoryLabel ? <span className={styles.catTag}>{categoryLabel}</span> : null}
        {entry.durationLabel ? (
          <span className={styles.timeTag}>⏱ {entry.durationLabel}</span>
        ) : null}
        {hot ? <span className={styles.hot}>● HOT</span> : null}
        <div className={styles.hoverScrim} aria-hidden>
          <span className={styles.playBtn} aria-hidden />
        </div>
      </div>
      <div className={styles.body}>
        <h3 className={styles.title}>{entry.title}</h3>
        {entry.subtitle ? <p className={styles.subtitle}>{entry.subtitle}</p> : null}
      </div>
    </Link>
  );
}
