"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "../shared.module.css";
import type { MiniGameRenderProps } from "../types";

type GamePhase = "playing" | "resolving" | "finished";
type Direction = -1 | 1;

type GateRound = {
  gateStart: number;
  gateWidth: number;
  direction: Direction;
  travelMs: number;
};

type GameState = {
  roundIndex: number;
  score: number;
  combo: number;
  bestCombo: number;
  pointer: number;
  phase: GamePhase;
  feedback: string;
  hitFlash: boolean;
  gateStart: number;
  gateWidth: number;
  direction: Direction;
  travelMs: number;
  successCount: number;
  missCount: number;
};

const TOTAL_ROUNDS = 12;
const ROUND_PLAY_MS = 2200;
const RESULT_MS = 650;
const GATE_MIN_WIDTH = 12;
const GATE_MAX_WIDTH = 22;
const GATE_MIN_START = 14;
const GATE_MAX_START = 66;
const POINTER_WIDTH = 3;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function createRound(roundIndex: number): GateRound {
  const travelMs = ROUND_PLAY_MS - Math.min(500, roundIndex * 30);
  const gateWidth = Math.round(randomBetween(GATE_MIN_WIDTH, GATE_MAX_WIDTH));
  const gateStartLimit = Math.max(GATE_MIN_START, GATE_MAX_START - gateWidth);
  const gateStart = Math.round(randomBetween(GATE_MIN_START, gateStartLimit));

  return {
    gateStart,
    gateWidth,
    direction: roundIndex % 2 === 0 ? 1 : -1,
    travelMs,
  };
}

function createInitialState(): GameState {
  const firstRound = createRound(0);

  return {
    roundIndex: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    pointer: firstRound.direction === 1 ? 10 : 90,
    phase: "playing",
    feedback: "在节拍抵达高亮区时点击“通过”。",
    hitFlash: false,
    gateStart: firstRound.gateStart,
    gateWidth: firstRound.gateWidth,
    direction: firstRound.direction,
    travelMs: firstRound.travelMs,
    successCount: 0,
    missCount: 0,
  };
}

function isPointerInsideGate(pointer: number, gateStart: number, gateWidth: number) {
  return pointer >= gateStart && pointer <= gateStart + gateWidth;
}

export function RhythmGateGame({ onFinish }: MiniGameRenderProps) {
  const [state, setState] = useState(createInitialState);
  const stateRef = useRef(state);
  const onFinishRef = useRef(onFinish);
  const rafRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const roundStartRef = useRef<number>(0);
  const finishedRef = useRef(false);
  const resolvedRef = useRef(false);
  const finishGameRef = useRef<(nextState: GameState) => void>(() => undefined);
  const startNextRoundRef = useRef<(currentState: GameState) => void>(() => undefined);
  const resolveRoundRef = useRef<(didHit: boolean) => void>(() => undefined);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const clearTimers = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (roundStartRef.current === 0) {
      roundStartRef.current = performance.now();
    }

    finishGameRef.current = (nextState: GameState) => {
      if (finishedRef.current) {
        return;
      }

      finishedRef.current = true;
      clearTimers();
      const finishedState: GameState = { ...nextState, phase: "finished", hitFlash: false };
      setState(finishedState);
      stateRef.current = finishedState;
      onFinishRef.current(
        nextState.score,
        `12 回合完成，命中 ${nextState.successCount} 次，失误 ${nextState.missCount} 次，最高连击 ${nextState.bestCombo}，得分 ${nextState.score}。`,
      );
    };

    startNextRoundRef.current = (currentState: GameState) => {
      const nextRoundIndex = currentState.roundIndex + 1;
      if (nextRoundIndex >= TOTAL_ROUNDS) {
        finishGameRef.current(currentState);
        return;
      }

      const nextRound = createRound(nextRoundIndex);
      resolvedRef.current = false;
      roundStartRef.current = performance.now();

      const nextState: GameState = {
        ...currentState,
        roundIndex: nextRoundIndex,
        phase: "playing",
        feedback: "新的节拍已开始，盯住高亮区。",
        hitFlash: false,
        pointer: nextRound.direction === 1 ? 10 : 90,
        gateStart: nextRound.gateStart,
        gateWidth: nextRound.gateWidth,
        direction: nextRound.direction,
        travelMs: nextRound.travelMs,
      };

      setState(nextState);
      stateRef.current = nextState;
    };

    resolveRoundRef.current = (didHit: boolean) => {
      if (resolvedRef.current || finishedRef.current) {
        return;
      }

      resolvedRef.current = true;

      const currentState = stateRef.current;
      const combo = didHit ? currentState.combo + 1 : Math.max(0, currentState.combo - 1);
      const bestCombo = Math.max(currentState.bestCombo, combo);
      const score = didHit
        ? currentState.score + 100 + currentState.combo * 30
        : currentState.score;
      const successCount = didHit ? currentState.successCount + 1 : currentState.successCount;
      const missCount = didHit ? currentState.missCount : currentState.missCount + 1;

      const nextState: GameState = {
        ...currentState,
        score,
        combo,
        bestCombo,
        successCount,
        missCount,
        phase: "resolving",
        feedback: didHit
          ? `命中！连击升到 ${combo}。`
          : "失误，连击下降。继续盯住节拍。",
        hitFlash: didHit,
      };

      setState(nextState);
      stateRef.current = nextState;

      if (nextState.roundIndex + 1 >= TOTAL_ROUNDS) {
        settleTimerRef.current = window.setTimeout(() => finishGameRef.current(nextState), RESULT_MS);
        return;
      }

      settleTimerRef.current = window.setTimeout(() => startNextRoundRef.current(nextState), RESULT_MS);
    };
  });

  useEffect(() => {
    const step = (now: number) => {
      if (finishedRef.current) {
        return;
      }

      const currentState = stateRef.current;

      if (currentState.phase === "playing") {
        const elapsed = now - roundStartRef.current;
        const progress = clamp(elapsed / currentState.travelMs, 0, 1);
        const cycle = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
        const pointer = currentState.direction === 1 ? 10 + cycle * 80 : 90 - cycle * 80;

        if (elapsed >= currentState.travelMs) {
          const settledState: GameState = { ...currentState, pointer: clamp(pointer, 0, 100) };
          stateRef.current = settledState;
          setState(settledState);
          resolveRoundRef.current(false);
        } else {
          const nextState: GameState = { ...currentState, pointer: clamp(pointer, 0, 100) };
          stateRef.current = nextState;
          setState(nextState);
        }
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      clearTimers();
    };
  }, []);

  const handlePass = () => {
    const currentState = stateRef.current;
    if (currentState.phase !== "playing" || finishedRef.current) {
      return;
    }

    const didHit = isPointerInsideGate(currentState.pointer, currentState.gateStart, currentState.gateWidth);
    resolveRoundRef.current(didHit);
  };

  const remainingRounds = Math.max(0, TOTAL_ROUNDS - state.roundIndex);
  const gateEnd = state.gateStart + state.gateWidth;
  const pointerStyle: CSSProperties = {
    left: `${state.pointer}%`,
    width: `${POINTER_WIDTH}px`,
    transform: "translateX(-50%)",
  };

  const gateStyle: CSSProperties = {
    left: `${state.gateStart}%`,
    width: `${state.gateWidth}%`,
  };

  const isActive = state.phase === "playing";

  return (
    <section className={styles.gameRoot}>
      <header className={styles.hud}>
        <div>
          <h2 className={styles.headline}>节奏闸门</h2>
          <div className={styles.subheadline}>看准往返节拍，在高亮区点击“通过”来连锁加分。</div>
        </div>
        <div className={styles.stats}>
          <span className={styles.pill}>得分 {state.score}</span>
          <span className={styles.pill}>连击 {state.combo}</span>
          <span className={styles.pill}>剩余回合 {remainingRounds}</span>
        </div>
      </header>

      <div
        className={styles.board}
        style={{
          position: "relative",
          overflow: "hidden",
          minHeight: "420px",
          background:
            "radial-gradient(circle at 50% 0%, rgba(112, 213, 255, 0.18), transparent 32%), linear-gradient(180deg, rgba(8, 12, 22, 0.98), rgba(6, 9, 16, 0.98))",
        }}
      >
        <div
          className={styles.panel}
          style={{
            display: "grid",
            gap: "8px",
            alignContent: "center",
          }}
        >
          <div className={styles.helper}>{state.feedback}</div>
          <div className={styles.result}>
            第 {Math.min(state.roundIndex + 1, TOTAL_ROUNDS)} / {TOTAL_ROUNDS} 回合
            {" · "}
            高亮区 {Math.round(state.gateStart)}% - {Math.round(gateEnd)}%
          </div>
        </div>

        <div
          style={{
            position: "relative",
            marginTop: "14px",
            flex: 1,
            minHeight: "220px",
            borderRadius: "22px",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            background:
              "linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02))",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: "50% 0 auto 0",
              height: "2px",
              transform: "translateY(-50%)",
              background:
                "linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.22), transparent)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "16px",
              bottom: "16px",
              width: "1px",
              transform: "translateX(-50%)",
              background: "linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.12), transparent)",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: "0 8px",
              display: "grid",
              alignItems: "center",
            }}
          >
            <div
              style={{
                position: "relative",
                height: "120px",
                borderRadius: "18px",
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.04))",
                border: "1px solid rgba(255, 255, 255, 0.07)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: "92%",
                  height: "22px",
                  transform: "translate(-50%, -50%)",
                  borderRadius: "999px",
                  background:
                    "linear-gradient(90deg, rgba(255,255,255,0.03), rgba(255,255,255,0.07), rgba(255,255,255,0.03))",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)",
                }}
              />

              <div
                style={{
                  ...gateStyle,
                  position: "absolute",
                  top: "50%",
                  height: "46px",
                  transform: "translateY(-50%)",
                  borderRadius: "999px",
                  background:
                    "linear-gradient(90deg, rgba(106, 228, 163, 0.18), rgba(106, 228, 163, 0.42), rgba(106, 228, 163, 0.18))",
                  boxShadow: "0 0 0 1px rgba(106, 228, 163, 0.25), 0 0 34px rgba(106, 228, 163, 0.18)",
                }}
              />

              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: "100%",
                  height: "58px",
                  transform: "translate(-50%, -50%)",
                  pointerEvents: "none",
                }}
              >
                {Array.from({ length: 11 }).map((_, index) => (
                  <span
                    key={index}
                    style={{
                      position: "absolute",
                      left: `${index * 10}%`,
                      top: "50%",
                      width: "1px",
                      height: index % 5 === 0 ? "22px" : "12px",
                      transform: "translate(-50%, -50%)",
                      background: "rgba(255,255,255,0.16)",
                    }}
                  />
                ))}
              </div>

              <div
                style={{
                  ...pointerStyle,
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  margin: "auto 0",
                  height: "100%",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: "18px",
                    height: "18px",
                    transform: "translate(-50%, -50%)",
                    borderRadius: "999px",
                    background: state.hitFlash
                      ? "radial-gradient(circle at 30% 30%, rgba(255,255,255,1), rgba(116, 255, 189, 0.95))"
                      : "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.98), rgba(132, 214, 255, 0.95))",
                    boxShadow: state.hitFlash
                      ? "0 0 0 10px rgba(106, 228, 163, 0.12), 0 0 24px rgba(106, 228, 163, 0.38)"
                      : "0 0 0 10px rgba(132, 214, 255, 0.10), 0 0 24px rgba(132, 214, 255, 0.32)",
                    border: "1px solid rgba(255,255,255,0.75)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    inset: "12px auto 12px 50%",
                    width: "1px",
                    transform: "translateX(-50%)",
                    background:
                      "linear-gradient(180deg, transparent, rgba(255,255,255,0.75), transparent)",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className={styles.panel} style={{ display: "grid", gap: "12px" }}>
          <div className={styles.stats} style={{ justifyContent: "space-between" }}>
            <span className={styles.pill}>命中 {state.successCount}</span>
            <span className={styles.pill}>失误 {state.missCount}</span>
            <span className={styles.pill}>最佳连击 {state.bestCombo}</span>
          </div>

          <button
            type="button"
            className={styles.button}
            onClick={handlePass}
            disabled={!isActive}
            style={{
              minHeight: "52px",
              fontSize: "15px",
              letterSpacing: "0.08em",
              background: isActive
                ? "linear-gradient(180deg, #f5f7fb, #dfe8ff)"
                : "rgba(255,255,255,0.22)",
            }}
          >
            通过
          </button>

          <div className={styles.helper}>
            提示：高亮区会固定在轨道上，节拍针不断往返。点对了会加分并续连击，点早或点晚会掉连击。
          </div>
        </div>
      </div>
    </section>
  );
}
