"use client";

import { useMemo, useState } from "react";
import type { PublicContentEntry } from "@/lib/public-catalog";
import { PlayTile } from "./play-tile";
import styles from "./play-portal.module.css";

type PlayPortalProps = {
  entries: PublicContentEntry[];
  hotSlugs: string[];
};

type CategoryId =
  | "all"
  | "reaction"
  | "puzzle"
  | "memory"
  | "merge"
  | "rhythm"
  | "story";

type Category = {
  id: CategoryId;
  label: string;
  matches: (entry: PublicContentEntry) => boolean;
};

type SortKey = "hot" | "new";

const KEYWORDS: Record<Exclude<CategoryId, "all">, string[]> = {
  reaction: ["反应", "点击", "快节奏", "躲避", "街机", "时机", "判定", "节奏"],
  puzzle: ["逻辑", "推理", "路径", "策略", "机关", "益智"],
  memory: ["记忆", "翻牌", "序列", "问答", "判断"],
  merge: ["合成", "堆叠", "三消", "匹配", "连线", "分类", "消除", "轻益智"],
  rhythm: ["节奏", "时机", "判定"],
  story: ["章节抉择", "商战档案", "人生模拟", "剧情互动", "分支"],
};

function matchCategory(entry: PublicContentEntry, id: CategoryId) {
  if (id === "all") return true;
  const keys = KEYWORDS[id];
  const tags = entry.tags.join(" ");
  return keys.some((k) => tags.includes(k));
}

function resolveLabel(entry: PublicContentEntry): string {
  const order: Exclude<CategoryId, "all">[] = [
    "story",
    "reaction",
    "puzzle",
    "memory",
    "merge",
    "rhythm",
  ];
  for (const id of order) {
    if (matchCategory(entry, id)) {
      return LABEL_MAP[id];
    }
  }
  return "小游戏";
}

const LABEL_MAP: Record<Exclude<CategoryId, "all">, string> = {
  reaction: "反应",
  puzzle: "益智",
  memory: "记忆",
  merge: "消除",
  rhythm: "节奏",
  story: "剧情",
};

export function PlayPortal({ entries, hotSlugs }: PlayPortalProps) {
  const [activeCat, setActiveCat] = useState<CategoryId>("all");
  const [sort, setSort] = useState<SortKey>("hot");

  const categories = useMemo<Category[]>(() => {
    return [
      { id: "all", label: "全部", matches: () => true },
      { id: "reaction", label: "反应", matches: (e) => matchCategory(e, "reaction") },
      { id: "puzzle", label: "益智", matches: (e) => matchCategory(e, "puzzle") },
      { id: "memory", label: "记忆", matches: (e) => matchCategory(e, "memory") },
      { id: "merge", label: "消除", matches: (e) => matchCategory(e, "merge") },
      { id: "rhythm", label: "节奏", matches: (e) => matchCategory(e, "rhythm") },
      { id: "story", label: "剧情", matches: (e) => matchCategory(e, "story") },
    ];
  }, []);

  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryId, number> = {
      all: entries.length,
      reaction: 0,
      puzzle: 0,
      memory: 0,
      merge: 0,
      rhythm: 0,
      story: 0,
    };
    for (const entry of entries) {
      for (const cat of categories) {
        if (cat.id !== "all" && cat.matches(entry)) counts[cat.id]++;
      }
    }
    return counts;
  }, [entries, categories]);

  const filtered = useMemo(() => {
    const base = entries.filter((entry) => {
      const cat = categories.find((c) => c.id === activeCat);
      return cat ? cat.matches(entry) : true;
    });
    if (sort === "new") {
      return [...base].sort(
        (a, b) => new Date(b.updatedAt).valueOf() - new Date(a.updatedAt).valueOf(),
      );
    }
    return [...base].sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));
  }, [entries, categories, activeCat, sort]);

  const hotSet = useMemo(() => new Set(hotSlugs), [hotSlugs]);

  return (
    <section className={styles.section}>
      <div className={styles.shell}>
        <div className={styles.chipBar} role="tablist" aria-label="游戏分类">
          {categories.map((cat) => {
            const active = cat.id === activeCat;
            const count = categoryCounts[cat.id];
            return (
              <button
                key={cat.id}
                type="button"
                className={[styles.chip, active && styles.chipActive]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setActiveCat(cat.id)}
                role="tab"
                aria-selected={active}
              >
                {cat.label}
                <span className={styles.chipCount}>{count}</span>
              </button>
            );
          })}
        </div>

        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <h2 className={styles.sectionTitle}>
              <span className={styles.sectionTitleCn}>
                {categories.find((c) => c.id === activeCat)?.label ?? "全部"}
              </span>
              <span className={styles.sectionTitleEn}>All games</span>
            </h2>
            <span className={styles.count}>
              {filtered.length.toString().padStart(2, "0")} 款
            </span>
          </div>

          <div className={styles.sortGroup} role="radiogroup" aria-label="排序">
            <button
              type="button"
              className={[styles.sortBtn, sort === "hot" && styles.sortActive]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setSort("hot")}
              role="radio"
              aria-checked={sort === "hot"}
            >
              🔥 热门
            </button>
            <button
              type="button"
              className={[styles.sortBtn, sort === "new" && styles.sortActive]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setSort("new")}
              role="radio"
              aria-checked={sort === "new"}
            >
              🆕 新上
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className={styles.empty}>这个分类暂时还没有小游戏</div>
        ) : (
          <div className={styles.grid}>
            {filtered.map((entry) => (
              <PlayTile
                key={entry.id}
                entry={entry}
                categoryLabel={resolveLabel(entry)}
                hot={hotSet.has(entry.slug)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
