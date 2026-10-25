"use client";

import { useMemo, useState } from "react";
import type { PublicContentEntry, PublicContentType } from "@/lib/public-catalog";
import { ContentCard } from "./content-card";
import styles from "./public-search-panel.module.css";

type PublicSearchPanelProps = {
  entries: PublicContentEntry[];
  title?: string;
  placeholder?: string;
  limit?: number;
  typeLabel?: string;
  hideHeader?: boolean;
};

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function matchesEntry(entry: PublicContentEntry, query: string) {
  const fields = [
    entry.title,
    entry.subtitle,
    entry.summary,
    entry.type,
    ...entry.tags,
  ];

  return fields.some((field) => normalize(field).includes(query));
}

function resolveHref(entry: PublicContentEntry) {
  return `/${entry.type}/${entry.slug}`;
}

function resolveTypeLabel(type: PublicContentType) {
  if (type === "play") {
    return "Play";
  }

  if (type === "film") {
    return "互动影游";
  }

  return "视频";
}

export function PublicSearchPanel({
  entries,
  title = "搜索",
  placeholder = "搜索内容",
  limit = 8,
  typeLabel,
  hideHeader = false,
}: PublicSearchPanelProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalize(query);

  const results = useMemo(() => {
    if (!normalizedQuery) {
      return [];
    }

    return entries.filter((entry) => matchesEntry(entry, normalizedQuery)).slice(0, limit);
  }, [entries, limit, normalizedQuery]);

  const hasQuery = normalizedQuery.length > 0;

  return (
    <section className={styles.panel}>
      {hideHeader ? null : (
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          {typeLabel ? <span className={styles.scope}>{typeLabel}</span> : null}
        </div>
      )}

      <div className={styles.searchBar}>
        <span className={styles.searchIcon} aria-hidden="true">
          ⌕
        </span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={styles.input}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        {hasQuery ? (
          <button
            type="button"
            className={styles.clearButton}
            onClick={() => setQuery("")}
          >
            清空
          </button>
        ) : null}
      </div>

      {hasQuery ? (
        results.length > 0 ? (
          <div className={styles.results}>
            {results.map((entry) => (
              <div key={entry.id} className={styles.resultItem}>
                <ContentCard
                  entry={entry}
                  href={resolveHref(entry)}
                  compact
                />
                <span className={styles.resultMeta}>{resolveTypeLabel(entry.type)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>没有找到匹配内容</div>
        )
      ) : null}
    </section>
  );
}
