"use client";

import { useEffect, useState } from "react";
import styles from "./game-result-screen.module.css";

type ResultRank = "S" | "A" | "B" | "C";

type GameResultScreenProps = {
  score: number;
  summary: string;
  onRetry?: () => void;
  onHome?: () => void;
  rank?: ResultRank;
  showConfetti?: boolean;
};

function getRankMedal(rank: ResultRank) {
  const medals: Record<ResultRank, string> = {
    S: "🌟",
    A: "⭐",
    B: "✨",
    C: "💫",
  };
  return medals[rank];
}

function getResultTitle(rank: ResultRank) {
  const titles: Record<ResultRank, string> = {
    S: "PERFECT!",
    A: "EXCELLENT",
    B: "GOOD",
    C: "COMPLETE",
  };
  return titles[rank];
}

function computeRank(score: number): ResultRank {
  if (score >= 900) return "S";
  if (score >= 700) return "A";
  if (score >= 500) return "B";
  return "C";
}

export function GameResultScreen({
  score,
  summary,
  onRetry,
  onHome,
  rank,
  showConfetti = true,
}: GameResultScreenProps) {
  const finalRank = rank ?? computeRank(score);
  const [confetti, setConfetti] = useState<Array<{ id: number; left: number; delay: number }>>([]);

  useEffect(() => {
    if (!showConfetti) return;
    const pieces = Array.from({ length: 30 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.2,
    }));
    setConfetti(pieces);
  }, [showConfetti]);

  return (
    <div className={styles.overlay}>
      {confetti.map((piece) => (
        <div
          key={piece.id}
          className={styles.confetti}
          style={{
            left: `${piece.left}%`,
            top: "-20px",
            animation: `confettiFall ${2 + Math.random() * 1}s ease-in forwards`,
            animationDelay: `${piece.delay}s`,
          }}
        />
      ))}

      <div className={styles.card}>
        <div className={styles.medal}>{getRankMedal(finalRank)}</div>
        <h2 className={styles.title}>{getResultTitle(finalRank)}</h2>
        <p className={styles.subtitle}>{summary}</p>

        <div className={styles.scoreRow}>
          <div className={styles.scoreBox}>
            <span className={styles.scoreLabel}>总分</span>
            <span className={styles.scoreValue}>{score}</span>
          </div>
          <div className={styles.scoreBox}>
            <span className={styles.scoreLabel}>等级</span>
            <span className={styles.scoreValue}>{finalRank}</span>
          </div>
        </div>

        <div className={styles.actions}>
          {onRetry ? (
            <button type="button" className={`${styles.button} ${styles.buttonPrimary}`} onClick={onRetry}>
              ↻ 再来一次
            </button>
          ) : null}
          {onHome ? (
            <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={onHome}>
              ← 返回大厅
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
