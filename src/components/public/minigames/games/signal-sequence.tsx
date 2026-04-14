"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../shared.module.css";
import type { MiniGameRenderProps } from "../types";

type SignalKey = "amber" | "cyan" | "violet" | "lime";

type SignalSpec = {
  key: SignalKey;
  label: string;
  color: string;
  glow: string;
};

const SIGNALS: SignalSpec[] = [
  {
    key: "amber",
    label: "琥珀",
    color: "linear-gradient(180deg, #ffd36b 0%, #f1a73b 100%)",
    glow: "rgba(241, 167, 59, 0.45)",
  },
  {
    key: "cyan",
    label: "青蓝",
    color: "linear-gradient(180deg, #6fe8ff 0%, #2ab7d7 100%)",
    glow: "rgba(42, 183, 215, 0.42)",
  },
  {
    key: "violet",
    label: "紫光",
    color: "linear-gradient(180deg, #c18bff 0%, #8b5cf6 100%)",
    glow: "rgba(139, 92, 246, 0.42)",
  },
  {
    key: "lime",
    label: "荧绿",
    color: "linear-gradient(180deg, #98f59e 0%, #37c76b 100%)",
    glow: "rgba(55, 199, 107, 0.42)",
  },
];

const FLASH_MS = 420;
const GAP_MS = 180;
const START_DELAY_MS = 420;
const BETWEEN_ROUNDS_MS = 720;
const FEEDBACK_MS = 180;

function pickRandomSignal() {
  return SIGNALS[Math.floor(Math.random() * SIGNALS.length)].key;
}

function getSignalSpec(key: SignalKey) {
  return SIGNALS.find((signal) => signal.key === key) ?? SIGNALS[0];
}

export function SignalSequenceGame({ onFinish }: MiniGameRenderProps) {
  const [sequence, setSequence] = useState<SignalKey[]>(() => [pickRandomSignal()]);
  const [phase, setPhase] = useState<"showing" | "input" | "between" | "failed">("showing");
  const [activeSignal, setActiveSignal] = useState<SignalKey | null>(null);
  const [inputIndex, setInputIndex] = useState(0);
  const [clearedRounds, setClearedRounds] = useState(0);
  const [message, setMessage] = useState("观察系统闪烁的第一轮信号。");
  const timersRef = useRef<number[]>([]);
  const finishedRef = useRef(false);

  const clearTimers = () => {
    timersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    timersRef.current = [];
  };

  const currentRound = clearedRounds + 1;

  useEffect(() => {
    if (phase !== "showing") {
      return undefined;
    }

    clearTimers();

    let cancelled = false;

    const playStep = (index: number) => {
      if (cancelled) {
        return;
      }

      if (index >= sequence.length) {
        const readyTimer = window.setTimeout(() => {
          if (cancelled) {
            return;
          }

          setActiveSignal(null);
          setPhase("input");
          setMessage("轮到你了，按顺序复现刚才的 4 色序列。");
        }, GAP_MS);

        timersRef.current.push(readyTimer);
        return;
      }

      const signal = sequence[index];
      setActiveSignal(signal);

      const clearTimer = window.setTimeout(() => {
        if (cancelled) {
          return;
        }

        setActiveSignal(null);
        const nextTimer = window.setTimeout(() => playStep(index + 1), GAP_MS);
        timersRef.current.push(nextTimer);
      }, FLASH_MS);

      timersRef.current.push(clearTimer);
    };

    const startTimer = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      setActiveSignal(null);
      setInputIndex(0);
      setMessage(`第 ${currentRound} 轮序列正在闪烁。`);
      playStep(0);
    }, START_DELAY_MS);
    timersRef.current.push(startTimer);

    return () => {
      cancelled = true;
      clearTimers();
    };
  }, [currentRound, phase, sequence]);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, []);

  const endGame = (summary: string) => {
    if (finishedRef.current) {
      return;
    }

    finishedRef.current = true;
    clearTimers();
    setPhase("failed");
    setActiveSignal(null);
    setMessage(summary);
    onFinish(clearedRounds, summary);
  };

  const advanceRound = () => {
    setPhase("between");
    setMessage(`正确，已完成第 ${currentRound} 轮，准备下一轮。`);
    clearTimers();

    const nextTimer = window.setTimeout(() => {
      setClearedRounds((value) => value + 1);
      setSequence((value) => [...value, pickRandomSignal()]);
      setPhase("showing");
    }, BETWEEN_ROUNDS_MS);

    timersRef.current.push(nextTimer);
  };

  const handleSignalPress = (signal: SignalKey) => {
    if (phase !== "input" || finishedRef.current) {
      return;
    }

    const expected = sequence[inputIndex];
    if (signal !== expected) {
      const expectedLabel = getSignalSpec(expected).label;
      endGame(`失败了。第 ${currentRound} 轮应当按下「${expectedLabel}」，你点到了别的信号。`);
      return;
    }

    const nextIndex = inputIndex + 1;
    setInputIndex(nextIndex);
    setActiveSignal(signal);

    const feedbackTimer = window.setTimeout(() => {
      setActiveSignal((current) => (current === signal ? null : current));
    }, FEEDBACK_MS);
    timersRef.current.push(feedbackTimer);

    if (nextIndex === sequence.length) {
      advanceRound();
    }
  };

  const statusLabel =
    phase === "showing"
      ? "系统播放中"
      : phase === "input"
        ? "等待输入"
        : phase === "between"
          ? "进入下一轮"
          : "游戏结束";

  return (
    <div className={styles.gameRoot}>
      <div className={styles.hud}>
        <div className={styles.stats}>
          <span className={styles.pill}>当前轮数 {currentRound}</span>
          <span className={styles.pill}>最佳轮数 {clearedRounds}</span>
          <span className={styles.pill}>{statusLabel}</span>
        </div>
      </div>

      <div className={styles.board}>
        <div className={styles.panel}>
          <p className={styles.headline}>信号序列</p>
          <p className={styles.subheadline}>
            系统会每轮闪烁一串 4 色信号。按顺序复现，序列会在每轮结束后自动加长 1 个信号。
          </p>
        </div>

        <div className={styles.panel}>
          <div className={styles.helper}>{message}</div>
          <div className={styles.grid4}>
            {SIGNALS.map((signal) => {
              const isActive = activeSignal === signal.key;

              return (
                <button
                  key={signal.key}
                  type="button"
                  className={styles.button}
                  onClick={() => handleSignalPress(signal.key)}
                  disabled={phase !== "input"}
                  aria-label={signal.label}
                  style={{
                    minHeight: 88,
                    border: isActive ? "1px solid rgba(255,255,255,0.35)" : "1px solid rgba(255,255,255,0.1)",
                    background: signal.color,
                    color: "#081018",
                    boxShadow: isActive ? `0 0 0 2px ${signal.glow}, 0 16px 28px rgba(0, 0, 0, 0.24)` : "none",
                    transform: isActive ? "translateY(-2px) scale(1.01)" : "none",
                    transition: "transform 140ms ease, box-shadow 140ms ease, filter 140ms ease",
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "space-between",
                    textAlign: "left",
                  }}
                >
                  <span>{signal.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.82 }}>#{signal.key}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.result}>
          目标是在每一轮开始时记住更长的信号链，然后在输入阶段一口气复现。失败会立即结束本局并回调 `onFinish`。
        </div>
      </div>
    </div>
  );
}
