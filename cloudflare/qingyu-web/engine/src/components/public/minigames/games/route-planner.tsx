"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "../shared.module.css";
import type { MiniGameRenderProps } from "../types";

type Point = {
  x: number;
  y: number;
};

type CellKind = "start" | "route" | "supply" | "goal" | "obstacle";

type Cell = {
  kind: CellKind;
  x: number;
  y: number;
  supplyIndex: number | null;
};

type GameStatus = "running" | "won" | "lost";

type GameConfig = {
  size: number;
  start: Point;
  goal: Point;
  route: Point[];
  routeKeys: Set<string>;
  supplyCells: Point[];
  supplyKeys: Set<string>;
  grid: Cell[][];
  stepLimit: number;
};

type GameState = {
  position: Point;
  stepsLeft: number;
  collected: number[];
  status: GameStatus;
  message: string;
  trail: string[];
};

const GRID_SIZE = 7;
const MIN_SUPPLIES = 1;
const MAX_SUPPLIES = 2;

function keyOf(point: Point) {
  return `${point.x},${point.y}`;
}

function samePoint(a: Point, b: Point) {
  return a.x === b.x && a.y === b.y;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function inBounds(point: Point, size: number) {
  return point.x >= 0 && point.y >= 0 && point.x < size && point.y < size;
}

function orthogonalNeighbors(point: Point) {
  return [
    { x: point.x + 1, y: point.y },
    { x: point.x - 1, y: point.y },
    { x: point.x, y: point.y + 1 },
    { x: point.x, y: point.y - 1 },
  ];
}

function buildRoute(size: number) {
  const start = { x: 0, y: 0 };
  const goal = { x: size - 1, y: size - 1 };
  const route = [start];
  const routeKeys = new Set<string>([keyOf(start)]);

  let current = { ...start };
  while (!samePoint(current, goal)) {
    const canMoveRight = current.x < goal.x;
    const canMoveDown = current.y < goal.y;
    let next: Point | null = null;

    if (canMoveRight && canMoveDown) {
      const remainingRight = goal.x - current.x;
      const remainingDown = goal.y - current.y;
      const bias = remainingRight / (remainingRight + remainingDown);
      const wobble = (Math.random() - 0.5) * 0.18;
      next = Math.random() < clamp(bias + wobble, 0.28, 0.72) ? { x: current.x + 1, y: current.y } : { x: current.x, y: current.y + 1 };
    } else if (canMoveRight) {
      next = { x: current.x + 1, y: current.y };
    } else if (canMoveDown) {
      next = { x: current.x, y: current.y + 1 };
    }

    if (!next) {
      break;
    }

    route.push(next);
    routeKeys.add(keyOf(next));
    current = next;
  }

  return { start, goal, route, routeKeys };
}

function createGameConfig(): GameConfig {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const { start, goal, route, routeKeys } = buildRoute(GRID_SIZE);
    const supplyCount = Math.random() < 0.5 ? MIN_SUPPLIES : MAX_SUPPLIES;
    const supplyCells: Point[] = [];
    const supplyKeys = new Set<string>();
    const reserved = new Set<string>([keyOf(start), keyOf(goal), ...routeKeys]);
    const candidateIndices = shuffle(route.map((_, index) => index).filter((index) => index >= 2 && index <= route.length - 3));

    for (const index of candidateIndices) {
      if (supplyCells.length >= supplyCount) {
        break;
      }

      const source = route[index];
      const choices = shuffle(orthogonalNeighbors(source));

      for (const choice of choices) {
        const nextKey = keyOf(choice);
        if (!inBounds(choice, GRID_SIZE) || reserved.has(nextKey)) {
          continue;
        }

        supplyCells.push(choice);
        supplyKeys.add(nextKey);
        reserved.add(nextKey);
        break;
      }
    }

    if (supplyCells.length < supplyCount) {
      continue;
    }

    const grid: Cell[][] = Array.from({ length: GRID_SIZE }, (_, y) =>
      Array.from({ length: GRID_SIZE }, (_, x) => {
        const point = { x, y };
        const pointKey = keyOf(point);
        let kind: CellKind = "obstacle";
        let supplyIndex: number | null = null;

        if (samePoint(point, start)) {
          kind = "start";
        } else if (samePoint(point, goal)) {
          kind = "goal";
        } else if (supplyKeys.has(pointKey)) {
          kind = "supply";
          supplyIndex = supplyCells.findIndex((supply) => samePoint(supply, point));
        } else if (routeKeys.has(pointKey)) {
          kind = "route";
        }

        return { kind, x, y, supplyIndex };
      }),
    );

    const stepLimit = route.length - 1 + supplyCount * 2 + 2;

    return {
      size: GRID_SIZE,
      start,
      goal,
      route,
      routeKeys,
      supplyCells,
      supplyKeys,
      grid,
      stepLimit,
    };
  }

  throw new Error("Failed to generate route planner board.");
}

function createInitialState(config: GameConfig): GameState {
  return {
    position: config.start,
    stepsLeft: config.stepLimit,
    collected: [],
    status: "running",
    message: "先收集补给，再沿路线抵达终点。",
    trail: [keyOf(config.start)],
  };
}

function countCollectedOnRoute(state: GameState) {
  return state.collected.length;
}

function computeScore(status: GameStatus, state: GameState, config: GameConfig) {
  const collected = countCollectedOnRoute(state);

  if (status === "won") {
    return 800 + state.stepsLeft * 120 + collected * 350;
  }

  const progress = config.route.findIndex((point) => samePoint(point, state.position));
  const progressScore = progress >= 0 ? progress * 18 : 0;
  return collected * 220 + progressScore;
}

function buildSummary(status: GameStatus, state: GameState, config: GameConfig) {
  const collected = countCollectedOnRoute(state);
  const missing = config.supplyCells.length - collected;
  const distanceToGoal = Math.abs(config.goal.x - state.position.x) + Math.abs(config.goal.y - state.position.y);

  if (status === "won") {
    return `成功抵达终点，收集了 ${collected}/${config.supplyCells.length} 个补给，剩余 ${state.stepsLeft} 步。`;
  }

  if (samePoint(state.position, config.goal) && missing > 0) {
    return `已经到达终点，但还缺少 ${missing} 个补给。`;
  }

  return `步数耗尽，已收集 ${collected}/${config.supplyCells.length} 个补给，离终点还差 ${distanceToGoal} 格。`;
}

export function RoutePlannerGame({ onFinish }: MiniGameRenderProps) {
  const [config] = useState(createGameConfig);
  const [state, setState] = useState(() => createInitialState(config));
  const onFinishRef = useRef(onFinish);
  const finishedRef = useRef(false);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  const finishGame = (status: GameStatus, nextState: GameState) => {
    if (finishedRef.current) {
      return;
    }

    finishedRef.current = true;
    const score = computeScore(status, nextState, config);
    const summary = buildSummary(status, nextState, config);

    setState({
      ...nextState,
      status,
      message: summary,
    });

    onFinishRef.current(score, summary);
  };

  const moveTo = (target: Point) => {
    if (finishedRef.current || state.status !== "running") {
      return;
    }

    if (Math.abs(target.x - state.position.x) + Math.abs(target.y - state.position.y) !== 1) {
      setState((current) => ({
        ...current,
        message: "只能点击与当前位置上下左右相邻的格子。",
      }));
      return;
    }

    const targetKey = keyOf(target);
    const cell = config.grid[target.y]?.[target.x];

    if (!cell || cell.kind === "obstacle") {
      setState((current) => ({
        ...current,
        message: "那里是障碍，换一条相邻路线。",
      }));
      return;
    }

    const nextCollected = [...state.collected];
    if (cell.kind === "supply" && cell.supplyIndex !== null && !nextCollected.includes(cell.supplyIndex)) {
      nextCollected.push(cell.supplyIndex);
    }

    const nextState: GameState = {
      position: target,
      stepsLeft: state.stepsLeft - 1,
      collected: nextCollected,
      status: "running",
      message: "",
      trail: [...state.trail, targetKey],
    };

    const collectedCount = nextCollected.length;
    const allSuppliesCollected = collectedCount === config.supplyCells.length;
    const reachedGoal = samePoint(target, config.goal);

    if (reachedGoal && allSuppliesCollected) {
      finishGame("won", {
        ...nextState,
        message: `成功抵达终点，收集了 ${collectedCount}/${config.supplyCells.length} 个补给。`,
      });
      return;
    }

    if (reachedGoal && !allSuppliesCollected) {
      finishGame("lost", {
        ...nextState,
        message: `到达终点时还缺少 ${config.supplyCells.length - collectedCount} 个补给。`,
      });
      return;
    }

    if (nextState.stepsLeft <= 0) {
      finishGame("lost", {
        ...nextState,
        message: "步数已经用完，未能完成路线。",
      });
      return;
    }

    setState({
      ...nextState,
      message: cell.kind === "supply"
        ? `拿到补给 ${collectedCount}/${config.supplyCells.length}，继续寻找终点。`
        : `已前进到 (${target.x + 1}, ${target.y + 1})，剩余 ${nextState.stepsLeft} 步。`,
    });
  };

  const renderCell = (cell: Cell) => {
    const cellKey = keyOf(cell);
    const isCurrent = samePoint(cell, state.position);
    const isTrail = state.trail.includes(cellKey);
    const collectedSupply = cell.kind === "supply" && cell.supplyIndex !== null && state.collected.includes(cell.supplyIndex);
    const canMoveHere =
      state.status === "running" &&
      Math.abs(cell.x - state.position.x) + Math.abs(cell.y - state.position.y) === 1 &&
      cell.kind !== "obstacle";

    const background =
      cell.kind === "start"
        ? "linear-gradient(135deg, rgba(94, 234, 212, 0.95), rgba(34, 197, 94, 0.9))"
        : cell.kind === "goal"
          ? "linear-gradient(135deg, rgba(248, 180, 0, 0.96), rgba(249, 115, 22, 0.9))"
          : cell.kind === "supply"
            ? collectedSupply
              ? "linear-gradient(135deg, rgba(34, 197, 94, 0.9), rgba(16, 185, 129, 0.8))"
              : "linear-gradient(135deg, rgba(59, 130, 246, 0.92), rgba(37, 99, 235, 0.88))"
            : cell.kind === "route"
              ? isTrail
                ? "linear-gradient(135deg, rgba(148, 163, 184, 0.34), rgba(100, 116, 139, 0.3))"
                : "linear-gradient(135deg, rgba(15, 23, 42, 0.72), rgba(30, 41, 59, 0.58))"
              : "rgba(255, 255, 255, 0.035)";

    const borderColor =
      cell.kind === "obstacle"
        ? "rgba(255, 255, 255, 0.03)"
        : isCurrent
          ? "rgba(255, 255, 255, 0.96)"
          : canMoveHere
            ? "rgba(255, 255, 255, 0.4)"
            : "rgba(255, 255, 255, 0.16)";

    const text =
      cell.kind === "start"
        ? "起"
        : cell.kind === "goal"
          ? "终"
          : cell.kind === "supply"
            ? collectedSupply
              ? "已取"
              : "补"
            : cell.kind === "route"
              ? isTrail
                ? "路"
                : ""
              : "障";

    const cellStyle: CSSProperties = {
      aspectRatio: "1",
      borderRadius: "14px",
      border: `1px solid ${borderColor}`,
      background,
      color:
        cell.kind === "obstacle"
          ? "rgba(255, 255, 255, 0.22)"
          : "rgba(255, 255, 255, 0.96)",
      cursor: canMoveHere ? "pointer" : "default",
      display: "grid",
      placeItems: "center",
      fontSize: "clamp(12px, 2.2vw, 18px)",
      fontWeight: 800,
      letterSpacing: "0.04em",
      boxShadow: isCurrent
        ? "0 0 0 3px rgba(255, 255, 255, 0.12), 0 16px 30px rgba(0, 0, 0, 0.24)"
        : isTrail && cell.kind !== "obstacle"
          ? "inset 0 0 0 1px rgba(255, 255, 255, 0.08)"
          : "none",
      transform: isCurrent ? "scale(1.02)" : "none",
      transition: "transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease, background 140ms ease",
    };

    return (
      <button
        key={cellKey}
        type="button"
        onClick={() => moveTo({ x: cell.x, y: cell.y })}
        disabled={!canMoveHere}
        aria-label={`${cell.kind === "start" ? "起点" : cell.kind === "goal" ? "终点" : cell.kind === "supply" ? "补给" : cell.kind === "route" ? "路线格" : "障碍"}，第 ${cell.y + 1} 行第 ${cell.x + 1} 列`}
        style={cellStyle}
      >
        {text}
      </button>
    );
  };

  const collectedCount = state.collected.length;
  const supplyCount = config.supplyCells.length;
  const remainingSteps = clamp(state.stepsLeft, 0, config.stepLimit);
  const remainingToGoal = Math.abs(config.goal.x - state.position.x) + Math.abs(config.goal.y - state.position.y);

  return (
    <section className={styles.gameRoot}>
      <header className={styles.hud}>
        <div>
          <h2 className={styles.headline}>路线规划</h2>
          <div className={styles.subheadline}>点击相邻格子沿路线前进，先拾取补给，再到终点完成通关。</div>
        </div>
        <div className={styles.stats}>
          <span className={styles.pill}>剩余 {remainingSteps} 步</span>
          <span className={styles.pill}>补给 {collectedCount}/{supplyCount}</span>
          <span className={styles.pill}>距离终点 {remainingToGoal} 格</span>
        </div>
      </header>

      <div
        className={styles.board}
        style={{
          overflow: "hidden",
          background:
            "radial-gradient(circle at top, rgba(255, 255, 255, 0.09), transparent 38%), linear-gradient(180deg, rgba(8, 16, 24, 0.18), rgba(8, 16, 24, 0.06))",
        }}
      >
        <div
          className={styles.panel}
          style={{
            display: "grid",
            gap: "12px",
            padding: "16px",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${config.size}, minmax(0, 1fr))`,
              gap: "8px",
              width: "min(100%, 560px)",
              margin: "0 auto",
            }}
          >
            {config.grid.map((row) => row.map(renderCell))}
          </div>
        </div>

        <div className={styles.panel} style={{ display: "grid", gap: "8px" }}>
          <div className={styles.result}>{state.message}</div>
          <div className={styles.helper}>
            规则很简单：只能点上下左右相邻的格子。终点只有在补给全部收集后才会算通关。
          </div>
        </div>
      </div>
    </section>
  );
}
