"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import styles from "../shared.module.css";
import type { MiniGameRenderProps } from "../types";

type ResourceKind = "wood" | "stone" | "food";

type ResourceTheme = {
  label: string;
  icon: string;
  fills: [string, string, string, string];
  edge: string;
};

type Tile = {
  id: string;
  kind: ResourceKind;
  level: number;
};

type BoardCell = Tile | null;

const TARGET_LEVEL = 4;
const TURN_LIMIT = 8;

const RESOURCE_THEMES: Record<ResourceKind, ResourceTheme> = {
  wood: {
    label: "木材",
    icon: "木",
    fills: ["#8c5a3c", "#9b6a49", "#b37a4f", "#d38a52"],
    edge: "#f4cf9c",
  },
  stone: {
    label: "石料",
    icon: "石",
    fills: ["#5f7184", "#6b7f95", "#7d93ac", "#98b3cc"],
    edge: "#d7e8ff",
  },
  food: {
    label: "口粮",
    icon: "粮",
    fills: ["#9a4f4f", "#b66357", "#cc7560", "#f08f6b"],
    edge: "#ffe0c2",
  },
};

const STARTING_BLUEPRINTS: Array<Pick<Tile, "kind" | "level">> = [
  { kind: "wood", level: 1 },
  { kind: "wood", level: 1 },
  { kind: "wood", level: 2 },
  { kind: "wood", level: 2 },
  { kind: "wood", level: 3 },
  { kind: "wood", level: 3 },
  { kind: "stone", level: 1 },
  { kind: "stone", level: 2 },
  { kind: "food", level: 1 },
];

function shuffle<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function makeTile(kind: ResourceKind, level: number, index: number): Tile {
  return {
    id: `${kind}-${level}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    level,
  };
}

function buildBoard(): BoardCell[] {
  return shuffle(STARTING_BLUEPRINTS).map((blueprint, index) =>
    makeTile(blueprint.kind, blueprint.level, index),
  );
}

function getHighestLevel(board: BoardCell[]) {
  return board.reduce((highest, cell) => Math.max(highest, cell?.level ?? 0), 0);
}

function getTileTitle(tile: Tile) {
  const theme = RESOURCE_THEMES[tile.kind];
  return `${theme.label} Lv.${tile.level}`;
}

function getTileHint(tile: Tile) {
  const nextLevel = Math.min(TARGET_LEVEL, tile.level + 1);
  return `${RESOURCE_THEMES[tile.kind].label} 继续合成到 Lv.${nextLevel}`;
}

function getTileStyle(tile: Tile): CSSProperties {
  const theme = RESOURCE_THEMES[tile.kind];
  const fillIndex = Math.min(theme.fills.length - 1, tile.level - 1);
  const fill = theme.fills[fillIndex];

  return {
    borderColor: `${theme.edge}55`,
    background: `linear-gradient(180deg, ${fill} 0%, rgba(255, 255, 255, 0.06) 100%)`,
    color: "#f5f7fb",
    boxShadow: `inset 0 0 0 1px ${theme.edge}25`,
  };
}

export function MergeCampGame({ onFinish }: MiniGameRenderProps) {
  const [board, setBoard] = useState<BoardCell[]>(() => buildBoard());
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [turnsLeft, setTurnsLeft] = useState(TURN_LIMIT);
  const [message, setMessage] = useState(
    "把同类同级资源拖到一起合成，先把营火升到 4 级。",
  );
  const [finished, setFinished] = useState(false);
  const onFinishRef = useRef(onFinish);
  const finishGuardRef = useRef(false);
  const turnsLeftRef = useRef(TURN_LIMIT);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    turnsLeftRef.current = turnsLeft;
  }, [turnsLeft]);

  const highestLevel = useMemo(() => getHighestLevel(board), [board]);
  const progress = useMemo(() => {
    if (TARGET_LEVEL <= 1) {
      return 100;
    }

    return Math.min(100, ((highestLevel - 1) / (TARGET_LEVEL - 1)) * 100);
  }, [highestLevel]);

  const finishGame = useCallback(
    (reason: "completed" | "timeout", nextBoard: BoardCell[], nextTurns: number) => {
      if (finishGuardRef.current) {
        return;
      }

      finishGuardRef.current = true;
      setFinished(true);
      setBoard(nextBoard);
      setTurnsLeft(nextTurns);
      setSelectedTileId(null);

      const finalLevel = getHighestLevel(nextBoard);
      const score =
        reason === "completed"
          ? Math.max(0, 150 + nextTurns * 14 + finalLevel * 18)
          : Math.max(0, finalLevel * 22 + (TURN_LIMIT - nextTurns) * 6);
      const summary =
        reason === "completed"
          ? `营火升到 ${TARGET_LEVEL} 级，剩余 ${nextTurns} 回合。`
          : `回合用尽，营火停在 ${finalLevel} 级。`;

      setMessage(summary);
      onFinishRef.current(score, summary);
    },
    [],
  );

  const commitMerge = useCallback(
    (sourceId: string, targetId: string) => {
      if (finished) {
        return;
      }

      const sourceIndex = board.findIndex((cell) => cell?.id === sourceId);
      const targetIndex = board.findIndex((cell) => cell?.id === targetId);

      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return;
      }

      const sourceTile = board[sourceIndex];
      const targetTile = board[targetIndex];

      if (!sourceTile || !targetTile) {
        setMessage("只能把同类同级资源拖到一起。");
        return;
      }

      if (sourceTile.kind !== targetTile.kind || sourceTile.level !== targetTile.level) {
        setMessage(`${RESOURCE_THEMES[sourceTile.kind].label} 只能和同类同级资源合成。`);
        return;
      }

      const upgradedTile: Tile = {
        ...targetTile,
        level: targetTile.level + 1,
      };
      const nextBoard = board.map((cell, index) => {
        if (index === sourceIndex) {
          return null;
        }

        if (index === targetIndex) {
          return upgradedTile;
        }

        return cell;
      });
      const nextTurns = Math.max(0, turnsLeftRef.current - 1);

      setBoard(nextBoard);
      setSelectedTileId(null);
      setTurnsLeft(nextTurns);
      turnsLeftRef.current = nextTurns;

      const nextHighestLevel = getHighestLevel(nextBoard);

      if (nextHighestLevel >= TARGET_LEVEL) {
        finishGame("completed", nextBoard, nextTurns);
        return;
      }

      if (nextTurns <= 0) {
        finishGame("timeout", nextBoard, nextTurns);
        return;
      }

      const theme = RESOURCE_THEMES[upgradedTile.kind];
      setMessage(
        `${theme.label} 合成到 Lv.${upgradedTile.level}，再冲一把把营火抬到 ${TARGET_LEVEL} 级。`,
      );
    },
    [board, finishGame, finished],
  );

  const handleTileClick = (tile: Tile) => {
    if (finished) {
      return;
    }

    if (selectedTileId === tile.id) {
      setSelectedTileId(null);
      setMessage("已取消选中。");
      return;
    }

    if (!selectedTileId) {
      setSelectedTileId(tile.id);
      setMessage(`已选中 ${getTileTitle(tile)}，再点同类同级资源即可合成。`);
      return;
    }

    commitMerge(selectedTileId, tile.id);
  };

  const selectedTile = useMemo(
    () => board.find((cell) => cell?.id === selectedTileId) ?? null,
    [board, selectedTileId],
  );

  const remainingTiles = board.filter(Boolean).length;

  return (
    <section className={styles.gameRoot} aria-label="营地合成小游戏">
      <header className={styles.hud}>
        <div className={styles.stats}>
          <span className={styles.pill}>
            回合 {turnsLeft}/{TURN_LIMIT}
          </span>
          <span className={styles.pill}>
            目标 Lv.{TARGET_LEVEL}
          </span>
          <span className={styles.pill}>
            最高 Lv.{highestLevel}
          </span>
          <span className={styles.pill}>
            剩余 {remainingTiles}
          </span>
        </div>
        <span className={styles.result}>{message}</span>
      </header>

      <main className={styles.board}>
        <div className={styles.panel}>
          <div className={styles.hud} style={{ alignItems: "flex-start" }}>
            <div>
              <p className={styles.headline}>营地合成</p>
              <p className={styles.subheadline}>
                3x3 小棋盘里拖动或点击同类同级资源合成。把营火冲到
                {` ${TARGET_LEVEL} `}
                级前，回合会一直倒计时。
              </p>
            </div>
            <div className={styles.stats}>
              <span className={styles.pill}>
                {selectedTile ? `已选 ${getTileTitle(selectedTile)}` : "未选中资源"}
              </span>
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              height: 12,
              borderRadius: 999,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
            aria-hidden="true"
          >
            <div
              style={{
                width: `${progress}%`,
                height: "100%",
                borderRadius: 999,
                background:
                  "linear-gradient(90deg, rgba(255, 214, 138, 0.96), rgba(255, 142, 102, 0.96))",
                transition: "width 180ms ease",
              }}
            />
          </div>
          <div className={styles.hud} style={{ marginTop: 10 }}>
            <span className={styles.result}>
              营火进度 {Math.max(1, highestLevel)}/{TARGET_LEVEL}
            </span>
            <span className={styles.result}>
              {finished ? "通关/结算中" : `每次合成消耗 1 回合，余 ${turnsLeft} 回合`}
            </span>
          </div>
        </div>

        <div className={styles.grid2}>
          <div className={styles.panel}>
            <p className={styles.helper}>3x3 营地棋盘</p>
            <div
              role="grid"
              aria-label="营地合成棋盘"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 10,
                marginTop: 10,
              }}
            >
              {board.map((cell, index) => {
                const isSelected = cell ? selectedTileId === cell.id : false;
                const activeSelection = selectedTile;
                let isMergeTarget = false;
                if (cell && activeSelection && activeSelection.id !== cell.id) {
                  isMergeTarget =
                    activeSelection.kind === cell.kind &&
                    activeSelection.level === cell.level;
                }

                if (!cell) {
                  return (
                    <div
                      key={`empty-${index}`}
                      aria-hidden="true"
                      style={{
                        minHeight: 96,
                        borderRadius: 18,
                        border: "1px dashed rgba(255,255,255,0.12)",
                        background: "rgba(255,255,255,0.03)",
                      }}
                    />
                  );
                }

                const theme = RESOURCE_THEMES[cell.kind];

                return (
                  <button
                    key={cell.id}
                    type="button"
                    className={styles.secondaryButton}
                    draggable={!finished}
                    disabled={finished}
                    aria-pressed={isSelected}
                    aria-label={getTileTitle(cell)}
                    onClick={() => handleTileClick(cell)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", cell.id);
                      setSelectedTileId(cell.id);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceId = event.dataTransfer.getData("text/plain");
                      if (sourceId) {
                        commitMerge(sourceId, cell.id);
                      }
                    }}
                    style={{
                      minHeight: 96,
                      padding: 12,
                      textAlign: "left",
                      borderColor: isSelected
                        ? theme.edge
                        : isMergeTarget
                          ? `${theme.edge}aa`
                          : "rgba(255,255,255,0.1)",
                      transform: isSelected ? "translateY(-1px)" : "none",
                      boxShadow: isSelected
                        ? `0 0 0 2px ${theme.edge}55, inset 0 0 0 1px ${theme.edge}28`
                        : isMergeTarget
                          ? `0 0 0 1px ${theme.edge}55`
                          : "none",
                      opacity: finished ? 0.88 : 1,
                      ...getTileStyle(cell),
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <span
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 14,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#0a1118",
                          background: "rgba(255,255,255,0.92)",
                          fontSize: 18,
                          fontWeight: 900,
                        }}
                      >
                        {theme.icon}
                      </span>
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.74)" }}>
                        Lv.{cell.level}
                      </span>
                    </div>
                    <div style={{ marginTop: 12, fontWeight: 800, fontSize: 15 }}>
                      {theme.label}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, color: "rgba(255,255,255,0.72)" }}>
                      {getTileHint(cell)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.panel}>
            <p className={styles.helper}>短局目标</p>
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              <div
                style={{
                  borderRadius: 16,
                  padding: 14,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.72)" }}>当前任务</div>
                <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800 }}>
                  在 {TURN_LIMIT} 回合内升到 Lv.{TARGET_LEVEL}
                </div>
              </div>
              <div
                style={{
                  borderRadius: 16,
                  padding: 14,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.72)" }}>合成规则</div>
                <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.7, color: "rgba(255,255,255,0.86)" }}>
                  同类同级资源才能合成。可以直接拖动，也可以先点选一块资源，再点另一块。
                </div>
              </div>
              <div
                style={{
                  borderRadius: 16,
                  padding: 14,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.72)" }}>节奏感</div>
                <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.7, color: "rgba(255,255,255,0.86)" }}>
                  每次成功合成都会推进营火进度条，剩余回合越少，奖励也会越紧。
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </section>
  );
}
