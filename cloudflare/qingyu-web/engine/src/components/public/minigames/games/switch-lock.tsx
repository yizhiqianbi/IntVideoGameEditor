"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "../shared.module.css";
import type { MiniGameRenderProps } from "../types";

type SwitchState = 0 | 1;

type Puzzle = {
  solution: SwitchState[];
  initial: SwitchState[];
};

type StageLayout = {
  index: number;
  label: string;
  row: number;
  column: number;
};

const STAGE_COUNT = 6;
const MOVE_LIMIT = 9;

const STAGE_LAYOUT: StageLayout[] = [
  { index: 0, label: "1", row: 1, column: 1 },
  { index: 1, label: "2", row: 1, column: 2 },
  { index: 2, label: "3", row: 1, column: 3 },
  { index: 3, label: "4", row: 2, column: 3 },
  { index: 4, label: "5", row: 2, column: 2 },
  { index: 5, label: "6", row: 2, column: 1 },
];

const PATH_POINTS = [
  { x: 64, y: 180 },
  { x: 230, y: 180 },
  { x: 396, y: 180 },
  { x: 562, y: 180 },
  { x: 562, y: 356 },
  { x: 396, y: 356 },
  { x: 230, y: 356 },
  { x: 900, y: 356 },
];

function randomState(): SwitchState {
  return Math.random() < 0.5 ? 0 : 1;
}

function createPuzzle(): Puzzle {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const solution = Array.from({ length: STAGE_COUNT }, randomState) as SwitchState[];
    const initial = Array.from({ length: STAGE_COUNT }, randomState) as SwitchState[];

    if (!initial.every((value, index) => value === solution[index])) {
      return { solution, initial };
    }
  }

  return {
    solution: [0, 1, 0, 1, 0, 1],
    initial: [1, 0, 1, 0, 1, 0],
  };
}

function countMatchedPrefix(states: SwitchState[], solution: SwitchState[]) {
  let matched = 0;

  for (let index = 0; index < solution.length; index += 1) {
    if (states[index] !== solution[index]) {
      break;
    }
    matched += 1;
  }

  return matched;
}

function isSolved(states: SwitchState[], solution: SwitchState[]) {
  return states.every((value, index) => value === solution[index]);
}

function buildScore(matched: number, movesLeft: number, solved: boolean) {
  return matched * 180 + movesLeft * 90 + (solved ? 600 : 0);
}

function buildSummary(matched: number, movesLeft: number, solved: boolean) {
  if (solved) {
    return `电流贯通，机关锁已打开。用掉 ${MOVE_LIMIT - movesLeft} 步，剩余 ${movesLeft} 步。`;
  }

  return `步数用尽，当前只连通 ${matched}/${STAGE_COUNT} 个机关。`;
}

function SwitchIcon({
  state,
  active,
  matched,
}: {
  state: SwitchState;
  active: boolean;
  matched: boolean;
}) {
  const stroke = matched
    ? "rgba(100, 245, 220, 0.95)"
    : active
      ? "rgba(255, 208, 102, 0.95)"
      : "rgba(180, 195, 225, 0.7)";
  const faintStroke = matched
    ? "rgba(100, 245, 220, 0.18)"
    : "rgba(180, 195, 225, 0.18)";
  const knobY = state === 0 ? 26 : 74;

  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" style={{ width: "100%", height: "100%" }}>
      <rect x="10" y="10" width="80" height="80" rx="18" fill="rgba(255,255,255,0.04)" />
      <line x1="18" y1="50" x2="82" y2="50" stroke="rgba(255,255,255,0.06)" strokeWidth="4" strokeLinecap="round" />
      <line x1="22" y1="50" x2="64" y2={knobY} stroke={faintStroke} strokeWidth="6" strokeLinecap="round" />
      <line x1="64" y1={knobY} x2="82" y2={knobY} stroke={stroke} strokeWidth="8" strokeLinecap="round" />
      <circle cx="22" cy="50" r="7" fill={stroke} />
      <circle cx="64" cy={knobY} r="8" fill={stroke} />
      <circle cx="82" cy={knobY} r="6" fill={matched ? "rgba(100, 245, 220, 0.95)" : stroke} />
    </svg>
  );
}

export function SwitchLockGame({ onFinish }: MiniGameRenderProps) {
  const [puzzle] = useState(createPuzzle);
  const [switches, setSwitches] = useState<SwitchState[]>(() => puzzle.initial);
  const [movesLeft, setMovesLeft] = useState(MOVE_LIMIT);
  const [isFinished, setIsFinished] = useState(false);
  const [statusText, setStatusText] = useState("点击开关切换线路，让电流按顺序穿过 6 个机关。");
  const onFinishRef = useRef(onFinish);
  const finishedRef = useRef(false);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  const finishGame = (nextSwitches: SwitchState[], nextMovesLeft: number) => {
    if (finishedRef.current) {
      return;
    }

    finishedRef.current = true;
    setIsFinished(true);

    const matched = countMatchedPrefix(nextSwitches, puzzle.solution);
    const solved = matched === STAGE_COUNT;
    const summary = buildSummary(matched, nextMovesLeft, solved);
    const score = buildScore(matched, nextMovesLeft, solved);

    setStatusText(summary);
    onFinishRef.current(score, summary);
  };

  const handleToggle = (index: number) => {
    if (finishedRef.current) {
      return;
    }

    const nextSwitches = switches.map((value, currentIndex) =>
      currentIndex === index ? (value === 0 ? 1 : 0) : value,
    ) as SwitchState[];
    const nextMovesLeft = Math.max(0, movesLeft - 1);
    const matched = countMatchedPrefix(nextSwitches, puzzle.solution);
    const solved = isSolved(nextSwitches, puzzle.solution);

    setSwitches(nextSwitches);
    setMovesLeft(nextMovesLeft);
    setStatusText(
      solved
        ? "锁芯全部对齐，电流已经冲到终点。"
        : `电流已连通 ${matched}/${STAGE_COUNT} 个机关。`,
    );

    if (solved || nextMovesLeft === 0) {
      finishGame(nextSwitches, nextMovesLeft);
    }
  };

  const matchedCount = countMatchedPrefix(switches, puzzle.solution);
  const solved = matchedCount === STAGE_COUNT;
  const remainingSegments = STAGE_COUNT - matchedCount;
  const progressLabel = solved
    ? "锁芯已打开"
    : matchedCount > 0
      ? `已贯通 ${matchedCount}/${STAGE_COUNT}`
      : "还未连通";

  const boardStyle: CSSProperties = {
    position: "relative",
    overflow: "hidden",
  };

  const stageBaseStyle: CSSProperties = {
    aspectRatio: "1 / 1",
    minHeight: 112,
    borderRadius: 22,
    border: "1px solid rgba(255,255,255,0.08)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)), radial-gradient(circle at top, rgba(255,255,255,0.14), transparent 60%)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
    color: "#f5f7fb",
    padding: 12,
    position: "relative",
    textAlign: "left",
  };

  return (
    <div className={styles.gameRoot}>
      <div className={styles.hud}>
        <div>
          <h2 className={styles.headline} style={{ marginBottom: 4 }}>
            机关锁
          </h2>
          <div className={styles.subheadline}>
            点击开关切换线路，让电流从左侧起点一路通到右侧锁芯。
          </div>
        </div>
        <div className={styles.stats}>
          <span className={styles.pill}>剩余步数 {movesLeft}</span>
          <span className={styles.pill}>{progressLabel}</span>
        </div>
      </div>

      <div className={styles.board} style={boardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <span className={styles.pill} style={{ background: "rgba(94, 234, 212, 0.12)", borderColor: "rgba(94, 234, 212, 0.22)" }}>
            起点通电
          </span>
          <span className={styles.pill} style={{ background: "rgba(255, 206, 102, 0.12)", borderColor: "rgba(255, 206, 102, 0.22)" }}>
            右侧锁芯
          </span>
        </div>

        <div style={{ position: "relative", flex: 1, minHeight: 300 }}>
          <svg
            viewBox="0 0 960 440"
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              overflow: "visible",
            }}
          >
            <defs>
              <filter id="switch-lock-glow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="7" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <line x1="64" y1="180" x2="900" y2="180" stroke="rgba(255,255,255,0.06)" strokeWidth="6" strokeLinecap="round" />
            {PATH_POINTS.slice(0, -1).map((point, index) => {
              const nextPoint = PATH_POINTS[index + 1];
              const lit = solved ? index < STAGE_COUNT + 1 : index < matchedCount;
              const active = index === matchedCount && !solved;

              return (
                <g key={`${point.x}-${point.y}-${index}`}>
                  <line
                    x1={point.x}
                    y1={point.y}
                    x2={nextPoint.x}
                    y2={nextPoint.y}
                    stroke={lit ? "rgba(94, 234, 212, 0.95)" : "rgba(180, 195, 225, 0.18)"}
                    strokeWidth={lit ? 8 : 6}
                    strokeLinecap="round"
                    filter={lit ? "url(#switch-lock-glow)" : undefined}
                    strokeDasharray={active ? "10 10" : undefined}
                  />
                </g>
              );
            })}

            <circle
              cx={64}
              cy={180}
              r={15}
              fill="rgba(94, 234, 212, 0.95)"
              filter="url(#switch-lock-glow)"
            />
            <circle
              cx={900}
              cy={356}
              r={16}
              fill={solved ? "rgba(94, 234, 212, 0.95)" : "rgba(255, 206, 102, 0.78)"}
              filter="url(#switch-lock-glow)"
            />
            <circle cx={900} cy={356} r={26} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
            <circle cx={900} cy={356} r={40} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
          </svg>

          <div
            style={{
              position: "relative",
              zIndex: 1,
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gridTemplateRows: "repeat(2, minmax(0, 1fr))",
              gap: 14,
              height: "100%",
            }}
          >
            {STAGE_LAYOUT.map((stage) => {
              const state = switches[stage.index];
              const matched = stage.index < matchedCount;
              const active = stage.index === matchedCount && !solved;
              const disabled = isFinished;

              return (
                <button
                  key={stage.index}
                  type="button"
                  className={styles.button}
                  disabled={disabled}
                  onClick={() => handleToggle(stage.index)}
                  aria-pressed={state === 1}
                  aria-label={`开关 ${stage.label}，当前 ${state === 0 ? "上路" : "下路"}`}
                  style={{
                    ...stageBaseStyle,
                    gridColumn: stage.column,
                    gridRow: stage.row,
                    cursor: disabled ? "not-allowed" : "pointer",
                    borderColor: matched
                      ? "rgba(94, 234, 212, 0.4)"
                      : active
                        ? "rgba(255, 206, 102, 0.58)"
                        : "rgba(255,255,255,0.08)",
                    boxShadow: matched
                      ? "0 0 0 1px rgba(94, 234, 212, 0.15), 0 20px 48px rgba(0, 0, 0, 0.22)"
                      : active
                        ? "0 0 0 1px rgba(255, 206, 102, 0.22), 0 0 28px rgba(255, 206, 102, 0.12)"
                        : "0 14px 32px rgba(0, 0, 0, 0.16)",
                    transform: matched ? "translateY(-1px)" : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <span className={styles.pill} style={{ minHeight: 22, padding: "0 8px" }}>
                      {stage.label}
                    </span>
                    <span
                      className={styles.pill}
                      style={{
                        minHeight: 22,
                        padding: "0 8px",
                        color: matched
                          ? "rgba(94, 234, 212, 0.92)"
                          : active
                            ? "rgba(255, 206, 102, 0.92)"
                            : "rgba(255,255,255,0.7)",
                      }}
                    >
                      {state === 0 ? "上路" : "下路"}
                    </span>
                  </div>

                  <div style={{ width: "100%", height: "68%" }}>
                    <SwitchIcon state={state} active={active} matched={matched} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.panel} style={{ marginTop: 14 }}>
          <div className={styles.result} style={{ marginBottom: 6 }}>
            {statusText}
          </div>
          <div className={styles.helper}>
            规则只有一条：点击开关改变线路状态，让高亮电流一路连到终点。当前未连通的段会保持暗色，步数用完也会自动结算。
          </div>
          {isFinished ? (
            <div className={styles.helper} style={{ marginTop: 8, color: "rgba(255,255,255,0.82)" }}>
              结算完成。
            </div>
          ) : null}
          <div className={styles.pill} style={{ marginTop: 10, display: "inline-flex" }}>
            当前连通 {matchedCount}/{STAGE_COUNT}，剩余 {remainingSegments} 段待点亮
          </div>
        </div>
      </div>
    </div>
  );
}
