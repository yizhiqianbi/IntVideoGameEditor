import Link from "next/link";
import type { PublicContentEntry } from "@/lib/public-catalog";
import styles from "./featured-hero.module.css";

type FeaturedHeroProps = {
  entry: PublicContentEntry;
  volumeLabel?: string;
};

const TYPE_LABEL: Record<PublicContentEntry["type"], string> = {
  play: "PLAY · 小游戏",
  film: "FILM · 互动影游",
  video: "VIDEO · 视频",
};

export function FeaturedHero({
  entry,
  volumeLabel = "VOL. 01",
}: FeaturedHeroProps) {
  const titleParts = splitChineseTitle(entry.title);

  return (
    <section className={styles.hero}>
      <div className={styles.artLayer}>
        <img
          src={entry.coverImageUrl}
          alt=""
          className={styles.art}
          aria-hidden
        />
        <div className={styles.artTint} aria-hidden />
        <div className={styles.artScrim} aria-hidden />
      </div>

      <div className={styles.inner}>
        <div className={styles.topBar}>
          <div className={styles.issueTag}>
            <span className={styles.issueStar} aria-hidden>
              ✦
            </span>
            <span>FEATURED EDITION</span>
            <span className={styles.issueVol}>{volumeLabel}</span>
          </div>
          <div className={styles.dateStamp}>
            <span className={styles.dateDot} aria-hidden>
              ●
            </span>
            {entry.updatedAt} · NOW STREAMING
          </div>
        </div>

        <div className={styles.body}>
          <div className={styles.eyebrow}>{TYPE_LABEL[entry.type]}</div>

          <h1 className={styles.title}>
            {titleParts.map((part, i) => (
              <span
                key={i}
                className={`${styles.titleLine} ${i === 1 ? styles.titleLineAlt : ""}`}
              >
                {part}
              </span>
            ))}
          </h1>

          <p className={styles.subtitle}>{entry.subtitle}</p>

          <div className={styles.tagRow}>
            {entry.tags.slice(0, 3).map((tag) => (
              <span key={tag} className={styles.tag}>
                {tag}
              </span>
            ))}
          </div>

          <div className={styles.ctaRow}>
            <Link
              href={`/${entry.type}/${entry.slug}`}
              className={styles.primaryCta}
            >
              <span className={styles.playIcon} aria-hidden>
                ▶
              </span>
              <span>{entry.primaryActionLabel}</span>
            </Link>
            <Link
              href={`/${entry.type}/${entry.slug}`}
              className={styles.secondaryCta}
            >
              <span>查看详情</span>
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>

        <div className={styles.metaRail}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>TYPE</span>
            <span className={styles.metaValue}>{entry.type.toUpperCase()}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>DURATION</span>
            <span className={styles.metaValue}>
              {entry.durationLabel ?? "—"}
            </span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>RANK</span>
            <span className={styles.metaValue}>
              #{String(entry.rankScore ?? 0).padStart(2, "0")}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function splitChineseTitle(title: string): string[] {
  const len = title.length;
  if (len <= 4) return [title];
  const mid = Math.ceil(len / 2);
  return [title.slice(0, mid), title.slice(mid)];
}
