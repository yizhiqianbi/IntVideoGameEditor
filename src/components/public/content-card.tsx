import Link from "next/link";
import type { PublicContentEntry } from "@/lib/public-catalog";
import styles from "./content-card.module.css";

type ContentCardProps = {
  entry: PublicContentEntry;
  href: string;
  large?: boolean;
  compact?: boolean;
  wide?: boolean;
  index?: number;
  paper?: boolean;
};

const TYPE_LABEL: Record<PublicContentEntry["type"], string> = {
  play: "PLAY",
  film: "FILM",
  video: "VIDEO",
};

export function ContentCard({
  entry,
  href,
  large = false,
  compact = false,
  wide = false,
  index,
  paper = false,
}: ContentCardProps) {
  const classes = [
    styles.card,
    large && styles.cardLarge,
    compact && styles.cardCompact,
    wide && styles.cardWide,
    paper && styles.cardPaper,
  ]
    .filter(Boolean)
    .join(" ");

  const numberLabel =
    typeof index === "number" ? String(index + 1).padStart(2, "0") : null;

  return (
    <Link href={href} className={classes}>
      <div className={styles.visual}>
        <img
          src={entry.thumbnailImageUrl ?? entry.coverImageUrl}
          alt={entry.title}
          className={styles.coverImage}
        />
        <div className={styles.visualScrim} aria-hidden />

        <div className={styles.topRow}>
          <span className={styles.typeTag}>{TYPE_LABEL[entry.type]}</span>
          {numberLabel ? (
            <span className={styles.numberTag}>№{numberLabel}</span>
          ) : null}
        </div>

        {large ? (
          <div className={styles.overlay}>
            <span className={styles.overlayMeta}>{TYPE_LABEL[entry.type]}</span>
            <h2 className={styles.overlayTitle}>{entry.title}</h2>
          </div>
        ) : null}
      </div>

      {!large ? (
        <div className={styles.body}>
          <div className={styles.bodyMain}>
            <h3 className={styles.title}>{entry.title}</h3>
            {entry.subtitle ? (
              <p className={styles.subtitle}>{entry.subtitle}</p>
            ) : null}
          </div>
          <span className={styles.arrow} aria-hidden>
            →
          </span>
        </div>
      ) : null}
    </Link>
  );
}
