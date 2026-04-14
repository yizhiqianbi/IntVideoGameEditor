"use client";

import { useEffect, useState } from "react";
import {
  PUBLIC_CONTENT,
  type PublicContentEntry,
  type PublicContentType,
} from "@/lib/public-catalog";
import { readRecentPlaySlugs } from "@/lib/public-recent-play";
import { ContentCard } from "./content-card";
import styles from "./recent-play-strip.module.css";

type RecentPlayStripProps = {
  title?: string;
  limit?: number;
  type?: PublicContentType;
  compact?: boolean;
};

function resolveEntries(slugs: string[], limit: number, type?: PublicContentType) {
  const catalog = type
    ? PUBLIC_CONTENT.filter((entry) => entry.type === type)
    : PUBLIC_CONTENT;
  const lookup = new Map(catalog.map((entry) => [entry.slug, entry]));
  return slugs
    .map((slug) => lookup.get(slug))
    .filter((entry): entry is PublicContentEntry => Boolean(entry))
    .slice(0, limit);
}

export function RecentPlayStrip({
  title = "最近游玩",
  limit = 8,
  type,
  compact = false,
}: RecentPlayStripProps) {
  const [entries, setEntries] = useState<PublicContentEntry[]>([]);

  useEffect(() => {
    setEntries(resolveEntries(readRecentPlaySlugs(), limit, type));
  }, [limit, type]);

  if (entries.length === 0) {
    return null;
  }

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
      </div>
      <div className={compact ? styles.compactGrid : styles.row}>
        {entries.map((entry) => (
          <ContentCard
            key={entry.id}
            entry={entry}
            href={`/${entry.type}/${entry.slug}`}
            compact={compact}
          />
        ))}
      </div>
    </section>
  );
}
