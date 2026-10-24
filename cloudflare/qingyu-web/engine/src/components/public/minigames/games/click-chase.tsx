"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "../shared.module.css";
import type { MiniGameRenderProps } from "../types";

type ArenaSize = {
  width: number;
  height: number;
};

type TargetState = {
  id: number;
  x: number;
  y: number;
  size: number;
  hue: number;
  label: string;
};

const GAME_DURATION_MS = 25_000;
const TARGET_MIN_SIZE = 56;
const TARGET_MAX_SIZE = 132;
const TARGET_LIFETIME_MS = 1_250;
const TARGET_LABELS = ["点", "追", "击", "中"];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function createTarget(arena: ArenaSize, id: number): TargetState {
  const shortestSide = Math.max(0, Math.min(arena.width, arena.height));
  const sizeCap = shortestSide > 0 ? Math.min(TARGET_MAX_SIZE, Math.max(TARGET_MIN_SIZE, shortestSide * 0.3)) : TARGET_MIN_SIZE;
  const size = Math.round(randomBetween(TARGET_MIN_SIZE, sizeCap));
  const half = size / 2;
  const x = Math.round(randomBetween(half, Math.max(half, arena.width - half)));
  const y = Math.round(randomBetween(half, Math.max(half, arena.height - half)));
  const hue = Math.round(randomBetween(170, 345));
  const label = TARGET_LABELS[id % TARGET_LABELS.length];

  return { id, x, y, size, hue, label };
}

export function ClickChaseGame({ onFinish }: MiniGameRenderProps) {
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const targetTimerRef = useRef<number | null>(null);
  const gameTimerRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  const finishNotifiedRef = useRef(false);
  const onFinishRef = useRef(onFinish);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const bestComboRef = useRef(0);
  const targetIdRef = useRef(0);

  const [arenaSize, setArenaSize] = useState<ArenaSize>({ width: 0, height: 0 });
  const [timeLeft, setTimeLeft] = useState(25);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [target, setTarget] = useState<TargetState | null>(null);
  const [isFinished, setIsFinished] = useState(false);
  const arenaWidth = arenaSize.width;
  const arenaHeight = arenaSize.height;

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    const arena = arenaRef.current;
    if (!arena) {
      return;
    }

    const updateArenaSize = () => {
      const rect = arena.getBoundingClientRect();
      const nextSize = {
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      };

      setArenaSize(nextSize);
    };

    updateArenaSize();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => updateArenaSize());
      observer.observe(arena);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateArenaSize);
    return () => window.removeEventListener("resize", updateArenaSize);
  }, []);

  useEffect(() => {
    if (finishedRef.current || arenaWidth <= 0 || arenaHeight <= 0) {
      return;
    }

    const nextTarget = createTarget({ width: arenaWidth, height: arenaHeight }, targetIdRef.current++);
    setTarget(nextTarget);
  }, [arenaHeight, arenaWidth]);

  useEffect(() => {
    if (finishedRef.current) {
      return;
    }

    const deadline = performance.now() + GAME_DURATION_MS;

    const tick = () => {
      const remainingMs = Math.max(0, Math.ceil(deadline - performance.now()));
      const nextSeconds = Math.ceil(remainingMs / 1000);

      setTimeLeft(nextSeconds);

      if (remainingMs <= 0) {
        finishedRef.current = true;
        setIsFinished(true);
        if (targetTimerRef.current !== null) {
          window.clearTimeout(targetTimerRef.current);
          targetTimerRef.current = null;
        }
        if (gameTimerRef.current !== null) {
          window.clearTimeout(gameTimerRef.current);
          gameTimerRef.current = null;
        }
        if (!finishNotifiedRef.current) {
          finishNotifiedRef.current = true;
          onFinishRef.current(
            scoreRef.current,
            `25秒结束，命中 ${scoreRef.current} 次，最佳连击 ${bestComboRef.current}。`,
          );
        }
        return;
      }

      gameTimerRef.current = window.setTimeout(tick, 100);
    };

    tick();

    return () => {
      if (gameTimerRef.current !== null) {
        window.clearTimeout(gameTimerRef.current);
        gameTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const targetId = target?.id;

    if (finishedRef.current || targetId == null) {
      return;
    }

    if (targetTimerRef.current !== null) {
      window.clearTimeout(targetTimerRef.current);
    }

    targetTimerRef.current = window.setTimeout(() => {
      if (finishedRef.current) {
        return;
      }

      comboRef.current = 0;
      setCombo(0);

      if (arenaWidth > 0 && arenaHeight > 0) {
        setTarget(createTarget({ width: arenaWidth, height: arenaHeight }, targetIdRef.current++));
      }
    }, TARGET_LIFETIME_MS);

    return () => {
      if (targetTimerRef.current !== null) {
        window.clearTimeout(targetTimerRef.current);
        targetTimerRef.current = null;
      }
    };
  }, [arenaHeight, arenaWidth, target?.id]);

  const handleHit = () => {
    if (finishedRef.current || target === null) {
      return;
    }

    const nextScore = scoreRef.current + 1;
    const nextCombo = comboRef.current + 1;
    const nextBestCombo = Math.max(bestComboRef.current, nextCombo);

    scoreRef.current = nextScore;
    comboRef.current = nextCombo;
    bestComboRef.current = nextBestCombo;

    setScore(nextScore);
    setCombo(nextCombo);
    setBestCombo(nextBestCombo);

    if (arenaSize.width > 0 && arenaSize.height > 0) {
      setTarget(createTarget(arenaSize, targetIdRef.current++));
    }
  };

  const remainingSeconds = clamp(timeLeft, 0, 25);

  const targetStyle: CSSProperties | undefined = target
    ? {
        left: `${target.x}px`,
        top: `${target.y}px`,
        width: `${target.size}px`,
        height: `${target.size}px`,
        transform: "translate(-50%, -50%)",
        borderRadius: `${Math.round(target.size * 0.3)}px`,
        background: `radial-gradient(circle at 30% 28%, hsla(${target.hue}, 100%, 70%, 0.95), hsla(${target.hue}, 90%, 48%, 0.95))`,
        boxShadow: `0 0 0 10px hsla(${target.hue}, 100%, 60%, 0.14), 0 18px 38px rgba(0, 0, 0, 0.24)`,
        border: "2px solid rgba(255, 255, 255, 0.92)",
        color: "#fff",
        fontSize: `${Math.max(12, Math.round(target.size / 5.4))}px`,
        letterSpacing: "0.08em",
      }
    : undefined;

  return (
    <section className={styles.gameRoot}>
      <header className={styles.hud}>
        <div>
          <h2 className={styles.headline}>点击追踪</h2>
          <div className={styles.subheadline}>25秒内尽量点中更多目标，目标会不断刷新位置和尺寸。</div>
        </div>
        <div className={styles.stats}>
          <span className={styles.pill}>剩余 {remainingSeconds}s</span>
          <span className={styles.pill}>得分 {score}</span>
          <span className={styles.pill}>当前连击 {combo}</span>
          <span className={styles.pill}>最佳连击 {bestCombo}</span>
        </div>
      </header>

      <div
        ref={arenaRef}
        className={styles.board}
        style={{
          position: "relative",
          overflow: "hidden",
          minHeight: "420px",
          background:
            "radial-gradient(circle at top, rgba(255, 255, 255, 0.09), transparent 42%), linear-gradient(180deg, rgba(8, 16, 24, 0.18), rgba(8, 16, 24, 0.06))",
        }}
      >
        {!target ? (
          <div className={styles.panel} style={{ display: "grid", gap: "8px", alignContent: "center", minHeight: "180px" }}>
            <div className={styles.headline}>准备中</div>
            <div className={styles.helper}>正在计算可点击区域，随后目标会随机出现。</div>
          </div>
        ) : (
          <button
            type="button"
            className={styles.button}
            onClick={handleHit}
            disabled={isFinished}
            aria-label="点击目标"
            style={targetStyle}
          >
            {target.label}
          </button>
        )}
      </div>

      <div className={styles.panel} style={{ display: "grid", gap: "6px" }}>
        <div className={styles.result}>
          {isFinished
            ? `本局结束。命中 ${score} 次，最佳连击 ${bestCombo}。`
            : "点击高亮目标得分，目标会在短时间后自动刷新。"}
        </div>
        <div className={styles.helper}>目标大小、位置和停留时间都会随机变化，尽量保持连续命中。</div>
      </div>
    </section>
  );
}
