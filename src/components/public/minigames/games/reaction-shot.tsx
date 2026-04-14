"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "../shared.module.css";
import type { MiniGameRenderProps } from "../types";

type ShotRoundResult = {
  outcome: "hit" | "foul" | "miss";
  reactionMs: number | null;
  scoreDelta: number;
};

const TOTAL_ROUNDS = 8;
const MIN_WAIT_MS = 900;
const MAX_WAIT_MS = 2_800;
const SHOOT_WINDOW_MS = 1_700;
const ROUND_GAP_MS = 720;
const READY_HALO_COLORS = ["rgba(255, 197, 87, 0.45)", "rgba(85, 231, 196, 0.38)", "rgba(112, 167, 255, 0.42)"];

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function formatMs(value: number | null) {
  return value === null ? "-" : `${Math.round(value)}ms`;
}

function getRoundLabel(roundIndex: number) {
  return `${roundIndex + 1}/${TOTAL_ROUNDS}`;
}

function scoreShot(reactionMs: number, streak: number) {
  const base = Math.max(120, Math.round(1_250 - reactionMs * 0.82));
  return base + streak * 45;
}

export function ReactionShotGame({ onFinish }: MiniGameRenderProps) {
  const [roundIndex, setRoundIndex] = useState(0);
  const [phase, setPhase] = useState<"arming" | "ready" | "settled" | "finished">("arming");
  const [message, setMessage] = useState("稳住枪口，信号亮起后再开火。");
  const [score, setScore] = useState(0);
  const [hits, setHits] = useState(0);
  const [fouls, setFouls] = useState(0);
  const [misses, setMisses] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestReactionMs, setBestReactionMs] = useState<number | null>(null);
  const [lastShot, setLastShot] = useState<ShotRoundResult | null>(null);
  const [averageReactionMs, setAverageReactionMs] = useState<number | null>(null);
  const [readyGlow, setReadyGlow] = useState(READY_HALO_COLORS[0]);

  const onFinishRef = useRef(onFinish);
  const phaseRef = useRef<"arming" | "ready" | "settled" | "finished">("arming");
  const roundIndexRef = useRef(0);
  const beginRoundRef = useRef<(nextRoundIndex: number) => void>(() => {});
  const readyTimeoutRef = useRef<number | null>(null);
  const autoMissTimeoutRef = useRef<number | null>(null);
  const nextRoundTimeoutRef = useRef<number | null>(null);
  const readyStartRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  const totalReactionRef = useRef(0);
  const hitCountRef = useRef(0);
  const scoreRef = useRef(0);
  const bestReactionRef = useRef<number | null>(null);
  const streakRef = useRef(0);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    roundIndexRef.current = roundIndex;
  }, [roundIndex]);

  const clearTimers = useCallback(() => {
    if (readyTimeoutRef.current !== null) {
      window.clearTimeout(readyTimeoutRef.current);
      readyTimeoutRef.current = null;
    }
    if (autoMissTimeoutRef.current !== null) {
      window.clearTimeout(autoMissTimeoutRef.current);
      autoMissTimeoutRef.current = null;
    }
    if (nextRoundTimeoutRef.current !== null) {
      window.clearTimeout(nextRoundTimeoutRef.current);
      nextRoundTimeoutRef.current = null;
    }
  }, []);

  const finishGame = useCallback(
    (summary: string) => {
      if (finishedRef.current) {
        return;
      }

      finishedRef.current = true;
      clearTimers();
      setPhase("finished");
      setMessage(summary);
      onFinishRef.current(scoreRef.current, summary);
    },
    [clearTimers],
  );

  const beginRound = useCallback(
    (nextRoundIndex: number) => {
      clearTimers();
      if (nextRoundIndex >= TOTAL_ROUNDS) {
        const finalAverage = hitCountRef.current > 0 ? totalReactionRef.current / hitCountRef.current : null;
        const summary = `8轮收官，命中 ${hitCountRef.current} 枪，平均反应 ${formatMs(finalAverage)}, 最佳一枪 ${formatMs(bestReactionRef.current)}。`;
        finishGame(summary);
        return;
      }

      setRoundIndex(nextRoundIndex);
      roundIndexRef.current = nextRoundIndex;
      setPhase("arming");
      setMessage(`第 ${getRoundLabel(nextRoundIndex)} 轮，先别碰扳机。`);
      setLastShot(null);
      readyStartRef.current = null;

      const readyDelay = Math.round(randomBetween(MIN_WAIT_MS, MAX_WAIT_MS));
      const nextGlow = READY_HALO_COLORS[nextRoundIndex % READY_HALO_COLORS.length];
      setReadyGlow(nextGlow);

      readyTimeoutRef.current = window.setTimeout(() => {
        if (finishedRef.current) {
          return;
        }

        readyStartRef.current = performance.now();
        setPhase("ready");
        setMessage(`第 ${getRoundLabel(nextRoundIndex)} 轮开火信号已出现，立刻射击。`);

        autoMissTimeoutRef.current = window.setTimeout(() => {
          if (finishedRef.current || phaseRef.current !== "ready") {
            return;
          }

          const nextStreak = 0;
          streakRef.current = nextStreak;
          setStreak(nextStreak);
          setMisses((value) => value + 1);
          setLastShot({
            outcome: "miss",
            reactionMs: null,
            scoreDelta: 0,
          });
          setPhase("settled");
          setMessage(`第 ${getRoundLabel(nextRoundIndex)} 轮超时，算作脱靶。`);
          readyStartRef.current = null;

          nextRoundTimeoutRef.current = window.setTimeout(() => {
            beginRoundRef.current(nextRoundIndex + 1);
          }, ROUND_GAP_MS);
        }, SHOOT_WINDOW_MS);
      }, readyDelay);
    },
    [clearTimers, finishGame],
  );

  useEffect(() => {
    beginRoundRef.current = beginRound;
  }, [beginRound]);

  const resolveShot = useCallback(
    (outcome: "hit" | "foul") => {
      if (finishedRef.current || phaseRef.current === "settled" || phaseRef.current === "finished") {
        return;
      }

      if (outcome === "foul" || phaseRef.current !== "ready" || readyStartRef.current === null) {
        if (phaseRef.current === "arming") {
          const nextStreak = 0;
          streakRef.current = nextStreak;
          setStreak(nextStreak);
          setFouls((value) => value + 1);
          setLastShot({
            outcome: "foul",
            reactionMs: null,
            scoreDelta: 0,
          });
          setPhase("settled");
          setMessage(`第 ${getRoundLabel(roundIndexRef.current)} 轮提前开火，判定犯规。`);
          readyStartRef.current = null;

          clearTimers();
          nextRoundTimeoutRef.current = window.setTimeout(() => {
            beginRoundRef.current(roundIndexRef.current + 1);
          }, ROUND_GAP_MS);
        }
        return;
      }

      clearTimers();

      const reactionMs = Math.max(0, performance.now() - readyStartRef.current);
      const nextStreak = streakRef.current + 1;
      const shotScore = scoreShot(reactionMs, nextStreak - 1);
      const nextScore = scoreRef.current + shotScore;
      const nextHits = hitCountRef.current + 1;
      const nextAverage = (totalReactionRef.current + reactionMs) / nextHits;
      const nextBest = bestReactionRef.current === null ? reactionMs : Math.min(bestReactionRef.current, reactionMs);

      streakRef.current = nextStreak;
      scoreRef.current = nextScore;
      totalReactionRef.current += reactionMs;
      hitCountRef.current = nextHits;
      bestReactionRef.current = nextBest;

      setPhase("settled");
      setScore(nextScore);
      setHits(nextHits);
      setStreak(nextStreak);
      setAverageReactionMs(nextAverage);
      setBestReactionMs(nextBest);
      setLastShot({
        outcome: "hit",
        reactionMs,
        scoreDelta: shotScore,
      });
      setMessage(`正中目标，第 ${getRoundLabel(roundIndexRef.current)} 轮反应 ${Math.round(reactionMs)}ms。`);
      readyStartRef.current = null;

      nextRoundTimeoutRef.current = window.setTimeout(() => {
        beginRoundRef.current(roundIndexRef.current + 1);
      }, ROUND_GAP_MS);
    },
    [clearTimers],
  );

  const handleShoot = useCallback(() => {
    if (finishedRef.current || phaseRef.current === "settled" || phaseRef.current === "finished") {
      return;
    }

    if (phaseRef.current === "arming") {
      resolveShot("foul");
      return;
    }

    resolveShot("hit");
  }, [resolveShot]);

  useEffect(() => {
    beginRound(0);

    return () => {
      finishedRef.current = true;
      clearTimers();
    };
  }, [beginRound, clearTimers]);

  const statusLabel =
    phase === "arming"
      ? "等待信号"
      : phase === "ready"
        ? "立刻开枪"
        : phase === "settled"
          ? "本轮已结算"
          : "对局结束";

  const averageLabel = formatMs(averageReactionMs);
  const bestLabel = formatMs(bestReactionMs);
  const targetStyle: CSSProperties = {
    boxShadow: `0 0 0 12px ${readyGlow}, 0 22px 48px rgba(0, 0, 0, 0.26)`,
    transform: phase === "ready" ? "scale(1.02)" : "scale(1)",
    border: "1px solid rgba(255, 255, 255, 0.16)",
    background:
      phase === "ready"
        ? "radial-gradient(circle at 28% 26%, rgba(255, 240, 189, 0.95), rgba(255, 170, 61, 0.92))"
        : "radial-gradient(circle at 28% 26%, rgba(120, 141, 169, 0.96), rgba(46, 60, 86, 0.94))",
    color: "#07101a",
  };

  return (
    <section className={styles.gameRoot}>
      <header className={styles.hud}>
        <div>
          <h2 className={styles.headline}>反应开枪</h2>
          <div className={styles.subheadline}>等信号亮起再开火，抢跑算犯规。8 轮结束后给出平均反应和最佳一枪。</div>
        </div>
        <div className={styles.stats}>
          <span className={styles.pill}>轮次 {getRoundLabel(roundIndex)}</span>
          <span className={styles.pill}>得分 {score}</span>
          <span className={styles.pill}>命中 {hits}</span>
          <span className={styles.pill}>犯规 {fouls}</span>
          <span className={styles.pill}>脱靶 {misses}</span>
          <span className={styles.pill}>{statusLabel}</span>
        </div>
      </header>

      <div
        className={styles.board}
        style={{
          background:
            "radial-gradient(circle at top, rgba(255, 255, 255, 0.1), transparent 40%), radial-gradient(circle at 30% 20%, rgba(255, 188, 92, 0.12), transparent 26%), linear-gradient(180deg, rgba(13, 19, 28, 0.2), rgba(13, 19, 28, 0.06))",
        }}
      >
        <div className={styles.panel} style={{ display: "grid", gap: 10 }}>
          <div className={styles.helper}>
            抢跑一次就会把当前一轮直接判掉。命中越快，单枪得分越高，连中还有额外加成。
          </div>
          <div className={styles.grid3}>
            <div className={styles.panel} style={{ padding: 14 }}>
              <div className={styles.helper}>平均反应</div>
              <div className={styles.headline} style={{ fontSize: 28 }}>
                {averageLabel}
              </div>
            </div>
            <div className={styles.panel} style={{ padding: 14 }}>
              <div className={styles.helper}>最佳一枪</div>
              <div className={styles.headline} style={{ fontSize: 28 }}>
                {bestLabel}
              </div>
            </div>
            <div className={styles.panel} style={{ padding: 14 }}>
              <div className={styles.helper}>当前连中</div>
              <div className={styles.headline} style={{ fontSize: 28 }}>
                {streak}
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          className={styles.button}
          onClick={handleShoot}
          style={{
            minHeight: 280,
            position: "relative",
            overflow: "hidden",
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            padding: 0,
            cursor: phase === "finished" ? "default" : "pointer",
            background:
              phase === "ready"
                ? "linear-gradient(180deg, rgba(255, 231, 161, 0.18), rgba(255, 255, 255, 0.04))"
                : "linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.03))",
          }}
          aria-label={phase === "ready" ? "开枪" : "等待信号"}
          disabled={phase === "finished"}
        >
          <div
            style={{
              position: "absolute",
              inset: 16,
              borderRadius: 20,
              border: "1px solid rgba(255, 255, 255, 0.08)",
              background:
                "linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0))",
            }}
          />
          <div
            style={{
              position: "relative",
              display: "grid",
              justifyItems: "center",
              gap: 14,
              padding: 24,
            }}
          >
            <div
              style={{
                width: 126,
                height: 126,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                ...targetStyle,
              }}
            >
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: "50%",
                  border: "8px solid rgba(7, 16, 26, 0.92)",
                  boxSizing: "border-box",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: 72,
                    height: 2,
                    background: "rgba(7, 16, 26, 0.88)",
                    transform: "translate(-50%, -50%)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: 2,
                    height: 72,
                    background: "rgba(7, 16, 26, 0.88)",
                    transform: "translate(-50%, -50%)",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div className={styles.headline} style={{ fontSize: 30 }}>
                {phase === "ready" ? "开枪" : phase === "arming" ? "别抢跑" : phase === "finished" ? "对局结束" : "结算中"}
              </div>
              <div className={styles.subheadline}>
                {phase === "ready"
                  ? "信号已亮，按下去。"
                  : phase === "arming"
                    ? "信号还没出现，提前开火会直接犯规。"
                    : phase === "settled"
                      ? message
                      : message}
              </div>
              <div className={styles.helper}>
                {lastShot
                  ? lastShot.outcome === "hit"
                    ? `本轮命中 +${lastShot.scoreDelta} 分，反应 ${formatMs(lastShot.reactionMs)}。`
                    : lastShot.outcome === "foul"
                      ? "本轮已记为犯规。"
                      : "本轮超时未射击。"
                  : "点击大靶标即可开枪。"}
              </div>
            </div>
          </div>
        </button>

        <div className={styles.result}>
          {phase === "finished"
            ? message
            : `第 ${getRoundLabel(roundIndex)} 轮进行中，当前总分 ${score}。`}
        </div>
      </div>
    </section>
  );
}
