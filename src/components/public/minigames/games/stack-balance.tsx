"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "../shared.module.css";
import type { MiniGameRenderProps } from "../types";

type BoardSize = {
  width: number;
  height: number;
};

type GamePhase = "playing" | "settling" | "finished";

type MotionBlock = {
  id: number;
  centerX: number;
  top: number;
  width: number;
  speedX: number;
  speedY: number;
  direction: -1 | 1;
  lockedCenterX: number | null;
  hue: number;
};

type PlacedBlock = {
  id: number;
  centerX: number;
  top: number;
  width: number;
  offset: number;
  quality: number;
  hue: number;
};

type GameState = {
  score: number;
  placedCount: number;
  perfectCount: number;
  bestOffset: number;
  phase: GamePhase;
  feedback: string;
  stack: PlacedBlock[];
  motion: MotionBlock | null;
};

const TOTAL_LAYERS = 10;
const BOARD_MIN_HEIGHT = 420;
const BASE_BOTTOM = 16;
const BLOCK_HEIGHT_MIN = 28;
const BLOCK_HEIGHT_MAX = 40;
const BLOCK_GAP_MIN = 5;
const BLOCK_GAP_MAX = 8;
const BASE_WIDTH_RATIO = 0.78;
const BASE_WIDTH_MIN = 180;
const START_BLOCK_RATIO = 0.66;
const START_BLOCK_MIN = 92;
const MIN_OVERLAP_RATIO = 0.24;
const LATE_FAIL_EPSILON = 2;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function formatPixels(value: number) {
  return `${Math.max(0, Math.round(value))} px`;
}

function getMetrics(boardHeight: number) {
  const blockHeight = clamp(boardHeight * 0.078, BLOCK_HEIGHT_MIN, BLOCK_HEIGHT_MAX);
  const gap = clamp(boardHeight * 0.014, BLOCK_GAP_MIN, BLOCK_GAP_MAX);
  const topLandingBase = boardHeight - BASE_BOTTOM - blockHeight;

  return {
    blockHeight,
    gap,
    topLandingBase,
  };
}

function getBaseWidth(boardWidth: number) {
  const maxWidth = Math.max(BASE_WIDTH_MIN, boardWidth * 0.9);
  const minWidth = Math.min(BASE_WIDTH_MIN, maxWidth);
  return clamp(boardWidth * BASE_WIDTH_RATIO, minWidth, maxWidth);
}

function getInitialBlockWidth(boardWidth: number, baseWidth: number) {
  const width = boardWidth * START_BLOCK_RATIO;
  const maxWidth = Math.max(START_BLOCK_MIN, Math.min(baseWidth, boardWidth * 0.82));
  const minWidth = Math.min(START_BLOCK_MIN, maxWidth);
  return clamp(width, minWidth, maxWidth);
}

function getLandingTop(boardHeight: number, placedCount: number) {
  const metrics = getMetrics(boardHeight);
  return metrics.topLandingBase - (placedCount + 1) * (metrics.blockHeight + metrics.gap);
}

function getBlockTop(boardHeight: number, index: number) {
  return getLandingTop(boardHeight, index);
}

function createMotion(
  boardSize: BoardSize,
  placedCount: number,
  currentWidth: number,
  direction: -1 | 1,
): MotionBlock {
  const metrics = getMetrics(boardSize.height);
  const maxWidth = Math.max(START_BLOCK_MIN, boardSize.width * 0.86);
  const minWidth = Math.min(START_BLOCK_MIN * 0.75, maxWidth);
  const width = clamp(currentWidth, minWidth, maxWidth);
  const minCenter = Math.max(width / 2 + 18, boardSize.width * 0.22);
  const maxCenter = Math.min(boardSize.width - width / 2 - 18, boardSize.width * 0.78);
  const centerX = direction > 0 ? minCenter : maxCenter;
  const speedX = 110 + placedCount * 10 + randomBetween(-8, 10);
  const speedY = 140 + placedCount * 10 + randomBetween(-6, 10);
  const hue = 185 + ((placedCount * 21) % 120);

  return {
    id: placedCount + 1,
    centerX,
    top: -metrics.blockHeight - 14,
    width,
    speedX,
    speedY,
    direction,
    lockedCenterX: null,
    hue,
  };
}

function createInitialState(): GameState {
  return {
    score: 0,
    placedCount: 0,
    perfectCount: 0,
    bestOffset: Number.POSITIVE_INFINITY,
    phase: "playing",
    feedback: "点击“落块”，在方块滑到塔心时放手，偏移越小得分越高。",
    stack: [],
    motion: null,
  };
}

export function StackBalanceGame({ onFinish }: MiniGameRenderProps) {
  const [state, setState] = useState(createInitialState);
  const [boardSize, setBoardSize] = useState<BoardSize>({ width: 0, height: 0 });
  const boardRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef(state);
  const boardSizeRef = useRef(boardSize);
  const onFinishRef = useRef(onFinish);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    boardSizeRef.current = boardSize;
  }, [boardSize]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) {
      return;
    }

    const updateSize = () => {
      const rect = board.getBoundingClientRect();
      const nextSize = {
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      };

      setBoardSize(nextSize);
    };

    updateSize();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => updateSize());
      observer.observe(board);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  useEffect(() => {
    if (boardSize.width <= 0 || boardSize.height <= 0) {
      return;
    }

    setState((current) => {
      if (current.motion || current.phase !== "playing" || finishedRef.current) {
        return current;
      }

      const baseWidth = getBaseWidth(boardSize.width);
      const motion = createMotion(boardSize, current.placedCount, getInitialBlockWidth(boardSize.width, baseWidth), 1);
      const nextState = { ...current, motion };
      stateRef.current = nextState;
      return nextState;
    });
  }, [boardSize]);

  const finishGame = (score: number, summary: string) => {
    if (finishedRef.current) {
      return;
    }

    finishedRef.current = true;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    setState((current) => {
      const nextState: GameState = { ...current, phase: "finished", score };
      stateRef.current = nextState;
      return nextState;
    });

    onFinishRef.current(score, summary);
  };

  const spawnNextMotion = (currentState: GameState, nextWidth: number) => {
    const nextDirection: -1 | 1 = currentState.placedCount % 2 === 0 ? 1 : -1;
    const motion = createMotion(boardSizeRef.current, currentState.placedCount, nextWidth, nextDirection);
    const nextState: GameState = {
      ...currentState,
      phase: "playing",
      motion,
      feedback:
        nextDirection > 0
          ? "下一块会从左侧滑来，盯住塔心。"
          : "下一块会从右侧滑来，继续稳住节奏。",
    };

    stateRef.current = nextState;
    setState(nextState);
  };

  const resolveLanding = () => {
    const currentState = stateRef.current;
    const motion = currentState.motion;
    const board = boardSizeRef.current;

    if (currentState.phase !== "settling" || motion === null || finishedRef.current) {
      return;
    }

    const metrics = getMetrics(board.height);
    const support =
      currentState.stack[currentState.stack.length - 1] ?? {
        id: 0,
        centerX: board.width / 2,
        top: metrics.topLandingBase,
        width: getBaseWidth(board.width),
        offset: 0,
        quality: 1,
        hue: 214,
      };

    const center = motion.lockedCenterX ?? motion.centerX;
    const left = center - motion.width / 2;
    const right = center + motion.width / 2;
    const supportLeft = support.centerX - support.width / 2;
    const supportRight = support.centerX + support.width / 2;
    const overlapLeft = Math.max(left, supportLeft);
    const overlapRight = Math.min(right, supportRight);
    const overlapWidth = overlapRight - overlapLeft;
    const offset = Math.abs(center - support.centerX);
    const offsetLimit = (support.width + motion.width) / 2;
    const quality = clamp(1 - offset / offsetLimit, 0, 1);

    if (overlapWidth <= motion.width * MIN_OVERLAP_RATIO || quality <= 0) {
      const score = currentState.score;
      finishGame(
        score,
        `倒塔了，当前停在 ${currentState.placedCount} 层，最终得分 ${score}。`,
      );
      return;
    }

    const nextScore = currentState.score + Math.round(40 + quality * 160);
    const nextPerfectCount = quality >= 0.92 ? currentState.perfectCount + 1 : currentState.perfectCount;
    const nextBestOffset = Math.min(currentState.bestOffset, offset);
    const nextWidth = clamp(overlapWidth, START_BLOCK_MIN * 0.75, board.width * 0.88);
    const placedBlock: PlacedBlock = {
      id: motion.id,
      centerX: overlapLeft + overlapWidth / 2,
      top: getBlockTop(board.height, currentState.placedCount),
      width: nextWidth,
      offset,
      quality,
      hue: motion.hue,
    };

    const nextPlacedCount = currentState.placedCount + 1;
    const nextStack = [...currentState.stack, placedBlock];

    const nextState: GameState = {
      score: nextScore,
      placedCount: nextPlacedCount,
      perfectCount: nextPerfectCount,
      bestOffset: nextBestOffset,
      phase: "playing",
      feedback:
        quality >= 0.92
          ? `完美落位，偏移 ${formatPixels(offset)}。`
          : `稳住了，偏移 ${formatPixels(offset)}，继续堆高。`,
      stack: nextStack,
      motion: null,
    };

    stateRef.current = nextState;
    setState(nextState);

    if (nextPlacedCount >= TOTAL_LAYERS) {
      finishGame(
        nextScore,
        `10 层全部完成，完美落位 ${nextPerfectCount} 次，最高得分 ${nextScore}。`,
      );
      return;
    }

    spawnNextMotion(nextState, nextWidth);
  };

  const attemptDrop = () => {
    const currentState = stateRef.current;
    const motion = currentState.motion;
    if (currentState.phase !== "playing" || motion === null || finishedRef.current) {
      return;
    }

    const nextState: GameState = {
      ...currentState,
      phase: "settling",
      motion: {
        ...motion,
        lockedCenterX: motion.centerX,
        speedX: 0,
        speedY: motion.speedY * 1.2,
      },
      feedback: "锁定方块，正在落到塔顶。",
    };

    stateRef.current = nextState;
    setState(nextState);
  };

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const step = (now: number) => {
      if (finishedRef.current) {
        return;
      }

      const currentState = stateRef.current;
      const motion = currentState.motion;
      const board = boardSizeRef.current;

      if (motion && board.width > 0 && board.height > 0 && currentState.phase !== "finished") {
        const previous = lastFrameRef.current ?? now;
        const dt = Math.min(48, now - previous);
        lastFrameRef.current = now;
        const landingTop = getLandingTop(board.height, currentState.placedCount);
        const movingWidth = motion.width;

        let nextMotion = motion;
        let nextState: GameState = currentState;

        if (currentState.phase === "playing") {
          let nextCenter = motion.centerX + motion.direction * motion.speedX * (dt / 1000);
          const nextTop = motion.top + motion.speedY * (dt / 1000);
          const minCenter = Math.max(movingWidth / 2 + 18, board.width * 0.22);
          const maxCenter = Math.min(board.width - movingWidth / 2 - 18, board.width * 0.78);
          let nextDirection = motion.direction;

          if (nextCenter <= minCenter) {
            nextCenter = minCenter;
            nextDirection = 1;
          } else if (nextCenter >= maxCenter) {
            nextCenter = maxCenter;
            nextDirection = -1;
          }

          nextMotion = {
            ...motion,
            centerX: nextCenter,
            top: nextTop,
            direction: nextDirection,
          };

          if (nextTop >= landingTop - LATE_FAIL_EPSILON) {
            finishGame(
              currentState.score,
              `方块错过了塔顶，最终停在 ${currentState.placedCount} 层，得分 ${currentState.score}。`,
            );
            return;
          }

          nextState = {
            ...currentState,
            motion: nextMotion,
          };
        } else if (currentState.phase === "settling") {
          const lockedCenterX = motion.lockedCenterX ?? motion.centerX;
          const nextTop = motion.top + motion.speedY * (dt / 1000);

          nextMotion = {
            ...motion,
            centerX: lockedCenterX,
            top: nextTop,
          };

          nextState = {
            ...currentState,
            motion: nextMotion,
          };

          if (nextTop >= landingTop) {
            stateRef.current = nextState;
            setState(nextState);
            resolveLanding();
            return;
          }
        }

        stateRef.current = nextState;
        setState(nextState);
      } else {
        lastFrameRef.current = now;
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        attemptDrop();
      }
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  const metrics = getMetrics(Math.max(boardSize.height, BOARD_MIN_HEIGHT));
  const baseWidth = boardSize.width > 0 ? getBaseWidth(boardSize.width) : 320;
  const remainingLayers = Math.max(0, TOTAL_LAYERS - state.placedCount);
  const isFinished = state.phase === "finished";
  const currentMotion = state.motion;

  const overlayMessage =
    state.phase === "finished"
      ? state.placedCount >= TOTAL_LAYERS
        ? "塔已经稳住了。"
        : "本局结束。"
      : state.feedback;

  const towerTop = boardSize.height > 0 ? getLandingTop(boardSize.height, Math.max(0, state.stack.length)) : 260;

  const blockStyle = (centerX: number, top: number, width: number, hue: number, alpha = 1) =>
    ({
      position: "absolute",
      left: `${centerX}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${metrics.blockHeight}px`,
      transform: "translateX(-50%)",
      borderRadius: "14px",
      background: `linear-gradient(180deg, hsla(${hue}, 90%, 72%, ${alpha}), hsla(${hue + 12}, 88%, 52%, ${alpha}))`,
      boxShadow: "0 16px 30px rgba(0, 0, 0, 0.24)",
      border: "1px solid rgba(255, 255, 255, 0.22)",
    }) as CSSProperties;

  const motionStyle = currentMotion
    ? blockStyle(
        currentMotion.lockedCenterX ?? currentMotion.centerX,
        currentMotion.top,
        currentMotion.width,
        currentMotion.hue,
        state.phase === "finished" ? 0.72 : 1,
      )
    : null;

  const boardStyle: CSSProperties = {
    position: "relative",
    minHeight: `${BOARD_MIN_HEIGHT}px`,
    overflow: "hidden",
    padding: 0,
    display: "block",
    background:
      "radial-gradient(circle at 50% 12%, rgba(99, 219, 255, 0.18), transparent 28%), linear-gradient(180deg, rgba(9, 14, 24, 0.98), rgba(6, 10, 16, 0.98))",
  };

  return (
    <section className={styles.gameRoot}>
      <header className={styles.hud}>
        <div>
          <h2 className={styles.headline}>高塔平衡</h2>
          <div className={styles.subheadline}>按时机落块，偏移越小越稳，叠满 10 层就通关。</div>
        </div>
        <div className={styles.stats}>
          <span className={styles.pill}>得分 {state.score}</span>
          <span className={styles.pill}>剩余层数 {remainingLayers}</span>
          <span className={styles.pill}>
            {state.phase === "finished" ? "本局结束" : state.phase === "settling" ? "落块中" : "等待落块"}
          </span>
        </div>
      </header>

      <div className={styles.board} style={boardStyle}>
        <div
          ref={boardRef}
          style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "50%",
              top: `${towerTop - 14}px`,
              width: `${Math.max(140, baseWidth * 0.84)}px`,
              height: "3px",
              transform: "translateX(-50%)",
              borderRadius: "999px",
              background: "linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.18), transparent)",
            }}
          />

          {state.stack.map((block, index) => (
            <div
              key={block.id}
              style={{
                ...blockStyle(block.centerX, block.top, block.width, block.hue, 1),
                opacity: isFinished && index < state.stack.length ? 0.96 : 1,
              }}
              aria-hidden="true"
            />
          ))}

          {motionStyle ? (
            <div style={motionStyle} aria-hidden="true">
              <div
                style={{
                  position: "absolute",
                  inset: "8px 14px auto 14px",
                  height: "8px",
                  borderRadius: "999px",
                  background: "rgba(255, 255, 255, 0.22)",
                  filter: "blur(1px)",
                }}
              />
            </div>
          ) : null}

          {state.phase === "finished" ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                background: "linear-gradient(180deg, rgba(5, 8, 14, 0.14), rgba(5, 8, 14, 0.62))",
                textAlign: "center",
                padding: 24,
              }}
            >
              <div>
                <p className={styles.headline}>已结束</p>
                <p className={styles.result} style={{ marginTop: 10 }}>
                  {overlayMessage}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.grid2}>
          <button
            type="button"
            className={styles.button}
            onPointerDown={(event) => {
              event.preventDefault();
              attemptDrop();
            }}
            disabled={state.phase === "finished"}
          >
            落块
          </button>
          <div className={styles.helper} style={{ display: "grid", alignContent: "center" }}>
            也可以按空格或回车。支撑断掉、方块越界，都会立刻结算并调用 `onFinish`。
          </div>
        </div>
        <div style={{ marginTop: 12 }} className={styles.result}>
          {state.feedback}
          {Number.isFinite(state.bestOffset) ? ` · 最佳偏移 ${formatPixels(state.bestOffset)}` : ""}
        </div>
      </div>
    </section>
  );
}
