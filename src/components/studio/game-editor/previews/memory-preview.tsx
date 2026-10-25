"use client";

import { useState } from "react";
import styles from "./preview.module.css";
import type { GameConfig } from "../game-editor-workbench";

const ICONS = ["★", "♥", "♦", "♣", "✦", "◆", "●", "■"];

export function MemoryPreview({ config }: { config: GameConfig }) {
  const [flipped, setFlipped] = useState<Set<number>>(new Set());

  function toggle(i: number) {
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div className={styles.stage}>
      <div className={styles.hud}>
        <span className={styles.chapterBadge}>记忆对标</span>
        <div className={styles.progress}>
          <div className={styles.progressFill} style={{ width: "40%" }} />
        </div>
        <span className={styles.count}>{config.duration}s</span>
      </div>
      <h2 className={styles.sceneTitle}>{config.title}</h2>
      <div className={styles.grid}>
        {Array.from({ length: 16 }).map((_, i) => {
          const isFlipped = flipped.has(i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => toggle(i)}
              className={`${styles.card} ${isFlipped ? styles.flipped : ""}`}
              aria-label={`卡片 ${i + 1}`}
            >
              {isFlipped ? ICONS[i % ICONS.length] : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}
