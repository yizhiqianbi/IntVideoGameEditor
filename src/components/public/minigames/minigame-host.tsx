"use client";

import { useMemo, useState } from "react";
import styles from "./minigame-host.module.css";
import type { MiniGameDefinition } from "./types";

type MiniGameHostProps = {
  game: MiniGameDefinition;
};

export function MiniGameHost({ game }: MiniGameHostProps) {
  const [instanceKey, setInstanceKey] = useState(0);
  const [result, setResult] = useState<{ score: number; summary: string } | null>(null);

  const GameComponent = useMemo(() => game.component, [game.component]);

  return (
    <section className={styles.host}>
      <div className={styles.toolbar}>
        <div className={styles.meta}>
          <span className={styles.title}>{game.title}</span>
          <span className={styles.subtitle}>{game.subtitle}</span>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => {
              setResult(null);
              setInstanceKey((value) => value + 1);
            }}
          >
            重新开始
          </button>
        </div>
      </div>

      <div className={styles.stage}>
        <GameComponent
          key={instanceKey}
          onFinish={(score, summary) => setResult({ score, summary })}
        />
      </div>

      <div className={styles.footer}>
        <span className={styles.score}>
          {result ? `分数 ${result.score}` : "正在游戏中"}
        </span>
        <span className={styles.result}>
          {result ? result.summary : game.instructions}
        </span>
      </div>
    </section>
  );
}
