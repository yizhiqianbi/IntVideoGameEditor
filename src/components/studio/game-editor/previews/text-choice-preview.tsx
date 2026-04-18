"use client";

import { useState } from "react";
import styles from "./preview.module.css";
import type { GameConfig } from "../game-editor-workbench";

export function TextChoicePreview({ config }: { config: GameConfig }) {
  const [step, setStep] = useState(0);
  const chapter = config.chapters[step] ?? config.chapters[0];

  if (!chapter) {
    return (
      <div className={styles.stage}>
        <p className={styles.prompt}>还没有章节 — 在右侧参数面板里添加一章吧。</p>
      </div>
    );
  }

  const total = config.chapters.length;
  const progress = ((step + 1) / Math.max(1, total)) * 100;

  function next() {
    setStep((s) => (s + 1 < total ? s + 1 : 0));
  }

  return (
    <div className={styles.stage}>
      <div className={styles.hud}>
        <span className={styles.chapterBadge}>
          Chapter {step + 1}/{total}
        </span>
        <div className={styles.progress}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>
        <span className={styles.count}>{config.duration}s</span>
      </div>
      <span className={styles.sceneBadge}>● {chapter.age}</span>
      <h2 className={styles.sceneTitle}>{chapter.title}</h2>
      <p className={styles.prompt}>{chapter.prompt}</p>
      <div className={styles.choices}>
        {chapter.choices.map((choice, i) => (
          <button key={i} className={styles.choiceBtn} onClick={next} type="button">
            <span className={styles.choiceMark}>{i === 0 ? "A" : "B"}</span>
            <span>
              <span className={styles.choiceLabel}>{choice.label}</span>
              <span className={styles.choiceConsequence}>{choice.consequence}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
