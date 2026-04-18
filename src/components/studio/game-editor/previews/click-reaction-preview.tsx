"use client";

import { useState } from "react";
import styles from "./preview.module.css";
import type { GameConfig } from "../game-editor-workbench";

export function ClickReactionPreview({ config }: { config: GameConfig }) {
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);

  return (
    <div className={styles.stage}>
      <div className={styles.hud}>
        <span className={styles.chapterBadge}>点击反应</span>
        <div className={styles.progress}>
          <div className={styles.progressFill} style={{ width: "60%" }} />
        </div>
        <span className={styles.count}>{config.duration}s</span>
      </div>
      <h2 className={styles.sceneTitle}>{config.title}</h2>
      <div className={styles.arena}>
        <button
          type="button"
          className={styles.target}
          onClick={() => {
            setScore((s) => s + 10 + combo);
            setCombo((c) => c + 1);
          }}
          aria-label="点击目标"
        >
          ⚡
        </button>
      </div>
      <div className={styles.stats}>
        <div className={styles.statCell}>
          <div className={styles.statLabel}>分数</div>
          <div className={styles.statValue}>{score}</div>
        </div>
        <div className={styles.statCell}>
          <div className={styles.statLabel}>连击</div>
          <div className={styles.statValue}>{combo}×</div>
        </div>
        <div className={styles.statCell}>
          <div className={styles.statLabel}>目标</div>
          <div className={styles.statValue}>{config.targetScore}</div>
        </div>
      </div>
    </div>
  );
}
