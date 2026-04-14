"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../shared.module.css";
import type { MiniGameRenderProps } from "../types";

type Obstacle = {
  id: number;
  lane: number;
  y: number;
};

type GameStatus = "running" | "finished";

const LANE_COUNT = 3;
const BOARD_HEIGHT = 420;
const PLAYER_LANE_CENTERS = [16.6667, 50, 83.3333];
const PLAYER_Y = 84;
const PLAYER_SIZE = { width: 52, height: 72 };
const OBSTACLE_SIZE = { width: 40, height: 56 };
const SURVIVE_MS = 30_000;
const SPAWN_START_MS = 900;
const SPAWN_END_MS = 430;
const SPEED_START = 24;
const SPEED_END = 42;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatTime(ms: number) {
  return `${Math.max(0, Math.ceil(ms / 1000))} 秒`;
}

function createInitialState() {
  return {
    lane: 1,
    obstacles: [] as Obstacle[],
    elapsedMs: 0,
    dodged: 0,
    score: 0,
    status: "running" as GameStatus,
  };
}

export function LaneDodgeGame({ onFinish }: MiniGameRenderProps) {
  const [state, setState] = useState(createInitialState);
  const stateRef = useRef(state);
  const onFinishRef = useRef(onFinish);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const spawnAccumulatorRef = useRef(0);
  const obstacleIdRef = useRef(1);
  const finishedRef = useRef(false);
  const laneRef = useRef(state.lane);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    stateRef.current = state;
    laneRef.current = state.lane;
  }, [state]);

  const moveLane = (delta: number) => {
    setState((current) => {
      if (current.status !== "running") {
        return current;
      }

      const nextLane = clamp(current.lane + delta, 0, LANE_COUNT - 1);
      laneRef.current = nextLane;
      return { ...current, lane: nextLane };
    });
  };

  useEffect(() => {
    const finishGame = (score: number, summary: string) => {
      if (finishedRef.current) {
        return;
      }

      finishedRef.current = true;
      setState((current) => ({
        ...current,
        status: "finished",
        score,
      }));
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      onFinishRef.current(score, summary);
    };

    const step = (now: number) => {
      if (finishedRef.current) {
        return;
      }

      const previous = lastFrameRef.current ?? now;
      const dt = Math.min(48, now - previous);
      lastFrameRef.current = now;

      const nextState = { ...stateRef.current };
      nextState.elapsedMs = Math.min(SURVIVE_MS, nextState.elapsedMs + dt);

      const elapsedRatio = nextState.elapsedMs / SURVIVE_MS;
      const spawnInterval = SPAWN_START_MS + (SPAWN_END_MS - SPAWN_START_MS) * elapsedRatio;
      const speed = SPEED_START + (SPEED_END - SPEED_START) * elapsedRatio;

      spawnAccumulatorRef.current += dt;
      while (spawnAccumulatorRef.current >= spawnInterval) {
        spawnAccumulatorRef.current -= spawnInterval;
        nextState.obstacles = [
          ...nextState.obstacles,
          {
            id: obstacleIdRef.current++,
            lane: Math.floor(Math.random() * LANE_COUNT),
            y: -12,
          },
        ];
      }

      const updatedObstacles: Obstacle[] = [];
      let dodged = nextState.dodged;
      let hit = false;

      for (const obstacle of nextState.obstacles) {
        const nextY = obstacle.y + (speed * dt) / 1000;
        const isInDangerZone = nextY >= 73 && nextY <= 90;
        if (obstacle.lane === laneRef.current && isInDangerZone) {
          hit = true;
          break;
        }

        if (nextY > 112) {
          dodged += 1;
          continue;
        }

        updatedObstacles.push({ ...obstacle, y: nextY });
      }

      if (hit) {
        const score = Math.floor(nextState.elapsedMs / 100) + dodged * 80;
        finishGame(score, `撞上障碍，最终得分 ${score}，躲过 ${dodged} 个障碍。`);
        return;
      }

      nextState.obstacles = updatedObstacles;
      nextState.dodged = dodged;
      nextState.score = Math.floor(nextState.elapsedMs / 100) + dodged * 80;

      if (nextState.elapsedMs >= SURVIVE_MS) {
        const score = nextState.score;
        setState({
          ...nextState,
          status: "finished",
          score,
        });
        finishedRef.current = true;
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
        }
        onFinishRef.current(score, `成功撑满 30 秒，最终得分 ${score}，躲过 ${dodged} 个障碍。`);
        return;
      }

      stateRef.current = nextState;
      setState(nextState);
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
        event.preventDefault();
        moveLane(-1);
      }

      if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
        event.preventDefault();
        moveLane(1);
      }
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const boardStyle = {
    position: "relative",
    overflow: "hidden",
    padding: 0,
    display: "block",
    minHeight: `${BOARD_HEIGHT}px`,
    background:
      "radial-gradient(circle at top, rgba(89, 196, 255, 0.16), transparent 30%), linear-gradient(180deg, rgba(13, 20, 34, 0.98), rgba(7, 11, 18, 0.98))",
  } as const;

  const trackStyle = {
    position: "absolute",
    inset: 0,
    display: "block",
  } as const;

  const laneLineStyle = (index: number) =>
    ({
      position: "absolute",
      top: 0,
      bottom: 0,
      left: `${((index + 1) / LANE_COUNT) * 100}%`,
      width: 1,
      background: "linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.14), transparent)",
      transform: "translateX(-0.5px)",
    }) as const;

  const playerStyle = {
    position: "absolute",
    left: `${PLAYER_LANE_CENTERS[state.lane]}%`,
    bottom: `${PLAYER_Y}%`,
    width: `${PLAYER_SIZE.width}px`,
    height: `${PLAYER_SIZE.height}px`,
    transform: "translateX(-50%)",
    borderRadius: "18px",
    background:
      "linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(154, 233, 255, 0.72))",
    boxShadow: "0 18px 36px rgba(0, 0, 0, 0.32)",
    border: "1px solid rgba(255, 255, 255, 0.45)",
    display: "grid",
    placeItems: "center",
  } as const;

  const obstacleStyle = (obstacle: Obstacle) =>
    ({
      position: "absolute",
      left: `${PLAYER_LANE_CENTERS[obstacle.lane]}%`,
      top: `${obstacle.y}%`,
      width: `${OBSTACLE_SIZE.width}px`,
      height: `${OBSTACLE_SIZE.height}px`,
      transform: "translate(-50%, -50%)",
      borderRadius: "16px",
      background:
        "linear-gradient(180deg, rgba(255, 155, 92, 0.95), rgba(255, 77, 77, 0.88))",
      boxShadow: "0 14px 30px rgba(255, 93, 93, 0.26)",
      border: "1px solid rgba(255, 255, 255, 0.18)",
    }) as const;

  const overlayStyle = {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    background: "linear-gradient(180deg, rgba(5, 8, 14, 0.18), rgba(5, 8, 14, 0.66))",
    textAlign: "center",
    padding: 24,
  } as const;

  const laneLabelStyle = (index: number) =>
    ({
      position: "absolute",
      top: 12,
      left: `${PLAYER_LANE_CENTERS[index]}%`,
      transform: "translateX(-50%)",
      color: "rgba(255, 255, 255, 0.45)",
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    }) as const;

  return (
    <section className={styles.gameRoot}>
      <div className={styles.hud}>
        <div className={styles.stats}>
          <span className={styles.pill}>时间 {formatTime(SURVIVE_MS - state.elapsedMs)}</span>
          <span className={styles.pill}>得分 {state.score}</span>
          <span className={styles.pill}>躲过 {state.dodged}</span>
        </div>
        <span className={styles.pill}>
          {state.status === "running" ? "躲避快线进行中" : "本局结束"}
        </span>
      </div>

      <div className={styles.board} style={boardStyle}>
        <div style={trackStyle}>
          {Array.from({ length: LANE_COUNT - 1 }, (_, index) => (
            <div key={index} style={laneLineStyle(index)} />
          ))}

          {PLAYER_LANE_CENTERS.map((_, index) => (
            <div key={index} style={laneLabelStyle(index)}>
              车道 {index + 1}
            </div>
          ))}

          {state.obstacles.map((obstacle) => (
            <div key={obstacle.id} style={obstacleStyle(obstacle)} aria-hidden="true" />
          ))}

          <div style={playerStyle} aria-label="玩家车辆">
            <div
              style={{
                width: 22,
                height: 34,
                borderRadius: 10,
                background:
                  "linear-gradient(180deg, rgba(8, 18, 28, 0.95), rgba(40, 72, 92, 0.95))",
              }}
            />
          </div>

          {state.status === "finished" ? (
            <div style={overlayStyle}>
              <div>
                <p className={styles.headline}>已结束</p>
                <p className={styles.result} style={{ marginTop: 10 }}>
                  {state.elapsedMs >= SURVIVE_MS
                    ? "你撑满了 30 秒，成功通关。"
                    : "你撞上了障碍，游戏结束。"}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className={styles.panel}>
        <p className={styles.headline}>躲避快线</p>
        <p className={styles.subheadline}>在 3 条纵向车道里左右切换，避开下落障碍，坚持 30 秒或尽量拿高分。</p>
        <div className={styles.grid2} style={{ marginTop: 14 }}>
          <button
            type="button"
            className={styles.secondaryButton}
            onPointerDown={(event) => {
              event.preventDefault();
              moveLane(-1);
            }}
            disabled={state.status !== "running"}
          >
            向左
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onPointerDown={(event) => {
              event.preventDefault();
              moveLane(1);
            }}
            disabled={state.status !== "running"}
          >
            向右
          </button>
        </div>
        <p className={styles.helper} style={{ marginTop: 12 }}>
          也可以使用键盘方向键。障碍越往后越快，碰撞后会立即结算分数并调用结束回调。
        </p>
      </div>
    </section>
  );
}
