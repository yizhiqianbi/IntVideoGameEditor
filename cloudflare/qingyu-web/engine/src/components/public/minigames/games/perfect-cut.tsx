"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "../shared.module.css";
import type { MiniGameRenderProps } from "../types";

type Phase = "playing" | "reveal" | "finished";

type RoundConfig = {
  targetStart: number;
  targetEnd: number;
  speed: number;
  phase: number;
  minX: number;
  maxX: number;
};

type RoundResult = {
  round: number;
  score: number;
  judgment: string;
  error: number;
  linePosition: number;
  targetStart: number;
  targetEnd: number;
};

const TOTAL_ROUNDS = 8;
const REVEAL_MS = 720;
const TRACK_MIN_X = 8;
const TRACK_MAX_X = 92;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function createRoundConfig(): RoundConfig {
  const width = randomBetween(14, 24);
  const center = randomBetween(22, 78);
  const targetStart = clamp(center - width / 2, TRACK_MIN_X + 2, TRACK_MAX_X - width - 2);
  const targetEnd = targetStart + width;

  return {
    targetStart,
    targetEnd,
    speed: randomBetween(1.3, 2.2),
    phase: randomBetween(0, Math.PI * 2),
    minX: TRACK_MIN_X,
    maxX: TRACK_MAX_X,
  };
}

function computeLinePosition(nowMs: number, config: RoundConfig) {
  const elapsedSeconds = nowMs / 1000;
  const wave = Math.sin(elapsedSeconds * config.speed + config.phase);
  const normalized = (wave + 1) / 2;
  return config.minX + normalized * (config.maxX - config.minX);
}

function judgeRound(linePosition: number, config: RoundConfig) {
  const center = (config.targetStart + config.targetEnd) / 2;
  const halfWidth = Math.max(0.0001, (config.targetEnd - config.targetStart) / 2);
  const offset = linePosition - center;
  const normalizedError = Math.abs(offset) / halfWidth;
  const score = Math.round(clamp(100 - normalizedError * 100, 0, 100));

  let judgment = "偏离目标";
  if (Math.abs(offset) <= halfWidth * 0.12) {
    judgment = "完美切割";
  } else if (linePosition < config.targetStart) {
    judgment = "切早了";
  } else if (linePosition > config.targetEnd) {
    judgment = "切晚了";
  } else if (offset < 0) {
    judgment = "略偏早";
  } else {
    judgment = "略偏晚";
  }

  return {
    score,
    judgment,
    error: Math.round(normalizedError * 1000) / 10,
  };
}

export function PerfectCutGame({ onFinish }: MiniGameRenderProps) {
  const [phase, setPhase] = useState<Phase>("playing");
  const [roundIndex, setRoundIndex] = useState(1);
  const [totalScore, setTotalScore] = useState(0);
  const [roundScore, setRoundScore] = useState(0);
  const [lastJudgment, setLastJudgment] = useState("等待第一刀");
  const [linePosition, setLinePosition] = useState(50);
  const [roundConfig, setRoundConfig] = useState<RoundConfig>(() => createRoundConfig());
  const [history, setHistory] = useState<RoundResult[]>([]);

  const onFinishRef = useRef(onFinish);
  const handleCutRef = useRef<() => void>(() => {});
  const resetGameRef = useRef<() => void>(() => {});
  const phaseRef = useRef<Phase>("playing");
  const roundIndexRef = useRef(1);
  const totalScoreRef = useRef(0);
  const historyRef = useRef<RoundResult[]>([]);
  const linePositionRef = useRef(50);
  const roundConfigRef = useRef(roundConfig);
  const rafRef = useRef<number | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const finishNotifiedRef = useRef(false);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    roundIndexRef.current = roundIndex;
  }, [roundIndex]);

  useEffect(() => {
    totalScoreRef.current = totalScore;
  }, [totalScore]);

  useEffect(() => {
    roundConfigRef.current = roundConfig;
  }, [roundConfig]);

  useEffect(() => {
    linePositionRef.current = linePosition;
  }, [linePosition]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      if (revealTimerRef.current !== null) {
        window.clearTimeout(revealTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (phase !== "playing") {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return undefined;
    }

    const basePosition = computeLinePosition(performance.now(), roundConfigRef.current);
    linePositionRef.current = basePosition;
    setLinePosition(basePosition);

    const tick = (now: number) => {
      if (phaseRef.current !== "playing") {
        return;
      }

      const nextPosition = computeLinePosition(now, roundConfigRef.current);
      linePositionRef.current = nextPosition;
      setLinePosition(nextPosition);
      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [phase, roundConfig]);

  const startRound = useCallback((nextRoundIndex: number) => {
    const nextConfig = createRoundConfig();
    setRoundIndex(nextRoundIndex);
    setRoundConfig(nextConfig);
    setRoundScore(0);
    setLastJudgment("准备切割");
    setPhase("playing");
  }, []);

  const finishGame = useCallback((finalScore: number, summary: string) => {
    if (finishNotifiedRef.current) {
      return;
    }

    finishNotifiedRef.current = true;
    setPhase("finished");
    setLastJudgment("本局结束");
    onFinishRef.current(finalScore, summary);
  }, []);

  const handleCut = useCallback(() => {
    if (phaseRef.current !== "playing") {
      return;
    }

    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }

    const config = roundConfigRef.current;
    const currentLine = linePositionRef.current;
    const result = judgeRound(currentLine, config);
    const round = roundIndexRef.current;
    const nextScore = totalScoreRef.current + result.score;

    setPhase("reveal");
    setRoundScore(result.score);
    setTotalScore(nextScore);
    setLastJudgment(
      `${result.judgment} · 误差 ${formatPercent(result.error)} · 本轮 +${result.score}`,
    );
    setHistory((current) => [
      ...current,
      {
        round,
        score: result.score,
        judgment: result.judgment,
        error: result.error,
        linePosition: currentLine,
        targetStart: config.targetStart,
        targetEnd: config.targetEnd,
      },
    ]);

    const roundResult: RoundResult = {
      round,
      score: result.score,
      judgment: result.judgment,
      error: result.error,
      linePosition: currentLine,
      targetStart: config.targetStart,
      targetEnd: config.targetEnd,
    };

    revealTimerRef.current = window.setTimeout(() => {
      revealTimerRef.current = null;
      if (round >= TOTAL_ROUNDS) {
        const bestScore = Math.max(...historyRef.current.map((item) => item.score), roundResult.score);
        finishGame(
          nextScore,
          `8轮结束，总得分 ${nextScore}，最佳一刀 ${bestScore}，最后一轮 ${roundResult.judgment}。`,
        );
        return;
      }

      startRound(round + 1);
    }, REVEAL_MS);
  }, [finishGame, startRound]);

  useEffect(() => {
    handleCutRef.current = handleCut;
  }, [handleCut]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        handleCutRef.current();
      }

      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        resetGameRef.current();
      }
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const resetGame = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }

    finishNotifiedRef.current = false;
    totalScoreRef.current = 0;
    roundIndexRef.current = 1;
    phaseRef.current = "playing";

    const nextConfig = createRoundConfig();
    setPhase("playing");
    setRoundIndex(1);
    setTotalScore(0);
    setRoundScore(0);
    setLastJudgment("等待第一刀");
    setHistory([]);
    setRoundConfig(nextConfig);
  }, []);

  useEffect(() => {
    resetGameRef.current = resetGame;
  }, [resetGame]);

  const targetWidth = roundConfig.targetEnd - roundConfig.targetStart;
  const targetCenter = (roundConfig.targetStart + roundConfig.targetEnd) / 2;
  const cutAccuracy = clamp(100 - Math.abs(linePosition - targetCenter) / Math.max(0.0001, targetWidth / 2) * 100, 0, 100);
  const nextLabel = phase === "finished" ? "已结束" : phase === "reveal" ? "判定中" : "可切割";

  const boardStyle: CSSProperties = {
    position: "relative",
    overflow: "hidden",
    minHeight: "420px",
    padding: "18px",
    background:
      "radial-gradient(circle at top, rgba(109, 227, 255, 0.16), transparent 34%), linear-gradient(180deg, rgba(8, 14, 24, 0.98), rgba(6, 10, 18, 0.99))",
  };

  const arenaStyle: CSSProperties = {
    position: "relative",
    minHeight: "242px",
    borderRadius: "20px",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    background:
      "linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.015))",
    overflow: "hidden",
  };

  const trackStyle: CSSProperties = {
    position: "absolute",
    left: "8%",
    right: "8%",
    top: "50%",
    height: "34px",
    transform: "translateY(-50%)",
    borderRadius: "999px",
    background:
      "linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.06))",
    boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.08)",
  };

  const targetStyle: CSSProperties = {
    position: "absolute",
    left: `${roundConfig.targetStart}%`,
    width: `${targetWidth}%`,
    top: "50%",
    height: "54px",
    transform: "translateY(-50%)",
    borderRadius: "999px",
    background:
      "linear-gradient(180deg, rgba(91, 218, 154, 0.95), rgba(48, 147, 92, 0.95))",
    boxShadow: "0 12px 28px rgba(48, 147, 92, 0.26), 0 0 0 8px rgba(91, 218, 154, 0.1)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
  };

  const cutterStyle: CSSProperties = {
    position: "absolute",
    left: `${linePosition}%`,
    top: "50%",
    transform: "translate(-50%, -50%)",
    display: "grid",
    justifyItems: "center",
    gap: "6px",
    pointerEvents: "none",
  };

  const bladeStyle: CSSProperties = {
    width: "5px",
    height: "116px",
    borderRadius: "999px",
    background:
      phase === "reveal"
        ? "linear-gradient(180deg, rgba(255, 233, 179, 1), rgba(255, 188, 72, 1))"
        : "linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(139, 224, 255, 0.85))",
    boxShadow:
      phase === "reveal"
        ? "0 0 0 10px rgba(255, 214, 96, 0.12), 0 12px 26px rgba(255, 188, 72, 0.24)"
        : "0 0 0 8px rgba(123, 222, 255, 0.09), 0 10px 24px rgba(0, 0, 0, 0.22)",
  };

  const handleStyle: CSSProperties = {
    width: "38px",
    height: "18px",
    borderRadius: "999px",
    background:
      phase === "reveal"
        ? "linear-gradient(180deg, rgba(255, 210, 122, 0.95), rgba(255, 154, 48, 0.85))"
        : "linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(175, 232, 255, 0.75))",
    border: "1px solid rgba(255, 255, 255, 0.24)",
  };

  const markerStyle = (left: number): CSSProperties => ({
    position: "absolute",
    left: `${left}%`,
    top: "calc(50% + 42px)",
    transform: "translateX(-50%)",
    color: "rgba(255, 255, 255, 0.54)",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.04em",
  });

  return (
    <section className={styles.gameRoot}>
      <header className={styles.hud}>
        <div>
          <h2 className={styles.headline}>完美切割</h2>
          <div className={styles.subheadline}>
            看准来回摆动的切线，在最佳时机点击切下目标区域。共 8 轮，误差越小得分越高。
          </div>
        </div>
        <div className={styles.stats}>
          <span className={styles.pill}>第 {Math.min(roundIndex, TOTAL_ROUNDS)}/8 轮</span>
          <span className={styles.pill}>总得分 {totalScore}</span>
          <span className={styles.pill}>本轮 {roundScore}</span>
          <span className={styles.pill}>{nextLabel}</span>
        </div>
      </header>

      <main className={styles.board} style={boardStyle}>
        <div className={styles.panel} style={{ display: "grid", gap: 8 }}>
          <div className={styles.result}>
            {lastJudgment} · 当前对准度 {Math.round(cutAccuracy)}%
          </div>
          <div className={styles.helper}>
            点击板面或按 <kbd>Space</kbd> / <kbd>Enter</kbd> 进行切割。目标区会随机变化，8 轮后自动结算。
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          aria-label="完美切割游戏区域"
          onClick={handleCut}
          onKeyDown={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              handleCut();
            }
          }}
          className={styles.panel}
          style={{
            ...arenaStyle,
            cursor: phase === "playing" ? "pointer" : "default",
            display: "block",
            outline: "none",
            userSelect: "none",
          }}
        >
          <div style={trackStyle} />
          <div style={targetStyle} />
          <div style={cutterStyle}>
            <div style={handleStyle} />
            <div style={bladeStyle} />
          </div>
          <div style={markerStyle(roundConfig.targetStart)}>起</div>
          <div style={markerStyle((roundConfig.targetStart + roundConfig.targetEnd) / 2)}>准</div>
          <div style={markerStyle(roundConfig.targetEnd)}>终</div>
          <div
            style={{
              position: "absolute",
              left: "8%",
              right: "8%",
              top: "50%",
              height: "1px",
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "10%",
              right: "10%",
              bottom: "20px",
              display: "flex",
              justifyContent: "space-between",
              color: "rgba(255, 255, 255, 0.4)",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            <span>左移</span>
            <span>目标切口</span>
            <span>右移</span>
          </div>
        </div>

        <div className={styles.panel} style={{ display: "grid", gap: 12 }}>
          <div className={styles.headline}>轮次判定</div>
          <div className={styles.grid4}>
            {history.slice(-4).map((item) => (
              <div
                key={item.round}
                style={{
                  borderRadius: 14,
                  padding: "12px",
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.58)", fontWeight: 700 }}>
                    第 {item.round} 轮
                  </span>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.82)", fontWeight: 800 }}>
                    +{item.score}
                  </span>
                </div>
                <div style={{ marginTop: 8, fontSize: 14, fontWeight: 800 }}>{item.judgment}</div>
                <div style={{ marginTop: 6 }} className={styles.helper}>
                  误差 {formatPercent(item.error)} · 线位 {formatPercent(item.linePosition)}
                </div>
              </div>
            ))}
            {history.length === 0 ? (
              <div className={styles.helper}>第一刀尚未落下。切在目标中心可拿到最高分。</div>
            ) : null}
          </div>
        </div>

        <footer className={styles.result} aria-live="polite">
          {phase === "finished"
            ? `本局结束，总得分 ${totalScore}。`
            : `每轮只点一次。当前目标区宽度 ${formatPercent(targetWidth)}，最高可得 100 分。`}
        </footer>
      </main>
    </section>
  );
}
