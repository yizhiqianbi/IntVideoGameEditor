"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import shared from "../shared.module.css";
import type { MiniGameRenderProps } from "../types";

type SymbolSpec = {
  key: string;
  label: string;
  glyph: string;
  color: string;
  glow: string;
};

type TileState = SymbolSpec & {
  id: string;
  layer: number;
  column: number;
  removed: boolean;
};

type ColumnState = TileState[];

const SLOT_LIMIT = 7;
const BOARD_COLUMNS = 6;
const BOARD_LAYERS = 3;
const TOTAL_TILES = BOARD_COLUMNS * BOARD_LAYERS;

const SYMBOLS: SymbolSpec[] = [
  { key: "star", label: "星", glyph: "✦", color: "#ffdf6e", glow: "rgba(255, 223, 110, 0.35)" },
  { key: "orb", label: "圆", glyph: "●", color: "#8ee3ff", glow: "rgba(142, 227, 255, 0.32)" },
  { key: "leaf", label: "叶", glyph: "☘", color: "#98f5b8", glow: "rgba(152, 245, 184, 0.32)" },
  { key: "gem", label: "钻", glyph: "◆", color: "#ffb86b", glow: "rgba(255, 184, 107, 0.32)" },
  { key: "moon", label: "月", glyph: "☾", color: "#d4b7ff", glow: "rgba(212, 183, 255, 0.32)" },
  { key: "spark", label: "焰", glyph: "✶", color: "#ff9f9f", glow: "rgba(255, 159, 159, 0.32)" },
];

function shuffle<T>(items: T[]) {
  const next = [...items];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

function createTile(symbol: SymbolSpec, id: string, layer: number, column: number): TileState {
  return {
    ...symbol,
    id,
    layer,
    column,
    removed: false,
  };
}

function buildBoard() {
  const starter = SYMBOLS[0];
  const reservedStarterTiles = Array.from({ length: 3 }, (_, index) =>
    createTile(starter, `starter-${index}`, 0, index),
  );

  const fillerTiles = SYMBOLS.slice(1).flatMap((symbol) =>
    Array.from({ length: 3 }, (_, copyIndex) => createTile(symbol, `${symbol.key}-${copyIndex}`, 0, 0)),
  );

  const shuffledFiller = shuffle(fillerTiles);
  const positions: TileState[] = [];

  for (let position = 0; position < TOTAL_TILES; position += 1) {
    const layer = Math.floor(position / BOARD_COLUMNS);
    const column = position % BOARD_COLUMNS;
    const tile =
      position < 3
        ? reservedStarterTiles[position]
        : {
            ...shuffledFiller[position - 3],
            layer,
            column,
            removed: false,
          };

    positions.push({
      ...tile,
      layer,
      column,
      removed: false,
      id: position < 3 ? tile.id : `${tile.key}-${position}-${column}`,
    });
  }

  return Array.from({ length: BOARD_COLUMNS }, (_, column) =>
    positions
      .filter((tile) => tile.column === column)
      .sort((a, b) => a.layer - b.layer),
  );
}

function countSymbols(tiles: TileState[]) {
  return tiles.reduce<Record<string, number>>((accumulator, tile) => {
    accumulator[tile.key] = (accumulator[tile.key] ?? 0) + 1;
    return accumulator;
  }, {});
}

function getVisibleTile(column: ColumnState) {
  return column.find((tile) => !tile.removed) ?? null;
}

function isBoardCleared(columns: ColumnState[]) {
  return columns.every((column) => column.every((tile) => tile.removed));
}

export function TileRushGame({ onFinish }: MiniGameRenderProps) {
  const [columns, setColumns] = useState<ColumnState[]>(() => buildBoard());
  const [hand, setHand] = useState<TileState[]>([]);
  const [clearedGroups, setClearedGroups] = useState(0);
  const [moveCount, setMoveCount] = useState(0);
  const [message, setMessage] = useState("先把顶部 3 张同图块凑齐，手牌只有 7 格，别让它满掉。");
  const [isFinished, setIsFinished] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const finishGuardRef = useRef(false);
  const onFinishRef = useRef(onFinish);
  const handPeakRef = useRef(0);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  const remainingTiles = useMemo(
    () => columns.reduce((total, column) => total + column.filter((tile) => !tile.removed).length, 0),
    [columns],
  );

  const handCounts = useMemo(() => countSymbols(hand), [hand]);
  const hottestHand = useMemo(() => {
    const entries = Object.entries(handCounts);
    if (entries.length === 0) {
      return null;
    }

    return entries.sort((left, right) => right[1] - left[1])[0];
  }, [handCounts]);

  const pressureLabel = useMemo(() => {
    if (hand.length >= SLOT_LIMIT - 1) {
      return "只剩 1 格，差一点就会爆槽。";
    }

    if (hottestHand?.[1] === 2) {
      const symbol = SYMBOLS.find((entry) => entry.key === hottestHand[0]);
      return symbol ? `还差 1 张「${symbol.glyph}」就能自动清掉。` : "还差 1 张就能清掉一组。";
    }

    if (hand.length >= 4) {
      return "手牌开始发紧，优先追同图块。";
    }

    return "先吃掉第一组三连，后面就会开始憋。";
  }, [hand.length, hottestHand]);

  const finishGame = (
    reason: "clear" | "fail",
    finalClearedGroups: number,
    finalMoveCount: number,
    finalPeakHand: number,
  ) => {
    if (finishGuardRef.current) {
      return;
    }

    finishGuardRef.current = true;
    setIsFinished(true);

    const score =
      reason === "clear"
        ? Math.max(120, 900 + finalClearedGroups * 90 - finalMoveCount * 8 - finalPeakHand * 12)
        : Math.max(0, finalClearedGroups * 80 + finalMoveCount * 2 - finalPeakHand * 10);
    const nextSummary =
      reason === "clear"
        ? `全部图块清空，消除 ${finalClearedGroups} 组，选择 ${finalMoveCount} 次，最大手牌 ${finalPeakHand}/${SLOT_LIMIT}。`
        : `槽位满了，差一点就能继续。已消除 ${finalClearedGroups} 组，选择 ${finalMoveCount} 次，最大手牌 ${finalPeakHand}/${SLOT_LIMIT}。`;

    setSummary(nextSummary);
    onFinishRef.current(score, nextSummary);
  };

  const handleTilePick = (columnIndex: number) => {
    if (isFinished) {
      return;
    }

    const column = columns[columnIndex];
    const visibleTile = getVisibleTile(column);
    if (!visibleTile) {
      return;
    }

    const nextColumns = columns.map((currentColumn, currentIndex) => {
      if (currentIndex !== columnIndex) {
        return currentColumn;
      }

      const visibleIndex = currentColumn.findIndex((tile) => !tile.removed);
      return currentColumn.map((tile, tileIndex) =>
        tileIndex === visibleIndex ? { ...tile, removed: true } : tile,
      );
    });

    const nextHand = [...hand, visibleTile];
    handPeakRef.current = Math.max(handPeakRef.current, nextHand.length);
    const nextMoveCount = moveCount + 1;
    setMoveCount(nextMoveCount);

    const counts = countSymbols(nextHand);
    const matchedSymbolKey = Object.keys(counts).find((key) => counts[key] >= 3);

    let resolvedHand = nextHand;
    let nextMessage = `已拿起「${visibleTile.glyph} ${visibleTile.label}」。`;
    let nextClearedGroups = clearedGroups;

    if (matchedSymbolKey) {
      resolvedHand = nextHand.filter((tile) => tile.key !== matchedSymbolKey);
      nextClearedGroups += 1;
      const symbol = SYMBOLS.find((entry) => entry.key === matchedSymbolKey);
      nextMessage = symbol ? `三张「${symbol.glyph}」已消除，继续攒下一组。` : "已自动消除一组三连，继续。";
    }

    if (resolvedHand.length > SLOT_LIMIT) {
      setColumns(nextColumns);
      setHand(resolvedHand);
      setClearedGroups(nextClearedGroups);
      setMessage("槽位已满，马上就差一点。");
      finishGame("fail", nextClearedGroups, nextMoveCount, handPeakRef.current);
      return;
    }

    setColumns(nextColumns);
    setHand(resolvedHand);
    setClearedGroups(nextClearedGroups);
    setMessage(nextMessage);

    if (isBoardCleared(nextColumns) && resolvedHand.length === 0) {
      setMessage("全部图块都清空了。");
      finishGame("clear", nextClearedGroups, nextMoveCount, handPeakRef.current);
    }
  };

  return (
    <section className={shared.gameRoot} aria-label="极速叠层消牌">
      <header className={shared.hud}>
        <div>
          <h2 className={shared.headline}>极速叠层消牌</h2>
          <p className={shared.subheadline}>
            点最上层图块，凑满 3 张同图块就会自动消除。手牌只有 7 格，越往后越容易差一点。
          </p>
        </div>
        <div className={shared.stats}>
          <span className={shared.pill}>手牌 {hand.length}/{SLOT_LIMIT}</span>
          <span className={shared.pill}>已消 {clearedGroups}/6</span>
          <span className={shared.pill}>剩余 {remainingTiles}</span>
          <span className={shared.pill}>{pressureLabel}</span>
        </div>
      </header>

      <main className={shared.board} style={{ background: "radial-gradient(circle at top, rgba(255, 255, 255, 0.09), transparent 38%), rgba(255, 255, 255, 0.02)" }}>
        <section className={shared.panel} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div className={shared.headline}>手牌区</div>
              <div className={shared.helper}>
                先点牌入槽，凑齐同图块 3 张就会消除。越接近 7 格，越容易卡住。
              </div>
            </div>
            <div className={shared.pill}>{pressureLabel}</div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }} aria-label="手牌">
            {hand.length > 0 ? (
              hand.map((tile, index) => (
                <div
                  key={`${tile.id}-${index}`}
                  style={{
                    minWidth: 54,
                    height: 54,
                    borderRadius: 16,
                    display: "grid",
                    placeItems: "center",
                    border: `1px solid ${tile.color}55`,
                    background: `linear-gradient(180deg, ${tile.color}ff, rgba(255, 255, 255, 0.9))`,
                    color: "#081018",
                    boxShadow: `0 0 0 1px ${tile.glow}, 0 10px 20px rgba(0, 0, 0, 0.18)`,
                    fontSize: 22,
                    fontWeight: 800,
                  }}
                  aria-label={`${tile.label} 已入手牌`}
                >
                  {tile.glyph}
                </div>
              ))
            ) : (
              <div className={shared.helper}>手牌为空，先从顶部开始拿。</div>
            )}
            {Array.from({ length: Math.max(0, SLOT_LIMIT - hand.length) }).map((_, index) => (
              <div
                key={`slot-${index}`}
                style={{
                  minWidth: 54,
                  height: 54,
                  borderRadius: 16,
                  border: "1px dashed rgba(255, 255, 255, 0.18)",
                  background: "rgba(255, 255, 255, 0.03)",
                }}
                aria-hidden="true"
              />
            ))}
          </div>
        </section>

        <section className={shared.panel} style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div className={shared.headline}>叠层牌桌</div>
              <div className={shared.helper}>只有最上层可以点，下一层会在它被拿走后露出来。</div>
            </div>
            <div className={shared.pill}>{isFinished ? "本局已结束" : "继续找三连"}</div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(86px, 1fr))",
              gap: 12,
              alignItems: "start",
            }}
            aria-label="可见图块"
          >
            {columns.map((column, columnIndex) => {
              const visibleIndex = column.findIndex((tile) => !tile.removed);
              const visibleTile = visibleIndex >= 0 ? column[visibleIndex] : null;

              return (
                <div
                  key={`column-${columnIndex}`}
                  style={{
                    position: "relative",
                    minHeight: 246,
                    borderRadius: 18,
                    border: "1px solid rgba(255, 255, 255, 0.07)",
                    background:
                      "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))",
                    overflow: "hidden",
                  }}
                >
                  {column.map((tile, tileIndex) => {
                    if (tile.removed) {
                      return null;
                    }

                    const depthOffset = (tileIndex - visibleIndex) * 16;
                    const isTopTile = tileIndex === visibleIndex;

                    return (
                      <button
                        key={tile.id}
                        type="button"
                        className={shared.button}
                        onClick={() => handleTilePick(columnIndex)}
                        disabled={isFinished || !isTopTile}
                        aria-label={isTopTile ? `点选 ${tile.label}` : `${tile.label} 被上层遮住`}
                        style={{
                          position: "absolute",
                          left: 10,
                          right: 10,
                          top: 12 + depthOffset,
                          minHeight: 0,
                          height: 72,
                          padding: 0,
                          display: "grid",
                          placeItems: "center",
                          borderRadius: 18,
                          border: `1px solid ${tile.color}55`,
                          background: isTopTile
                            ? `linear-gradient(180deg, ${tile.color}ff, rgba(255, 255, 255, 0.88))`
                            : "rgba(255, 255, 255, 0.08)",
                          color: isTopTile ? "#081018" : "rgba(245, 247, 251, 0.9)",
                          boxShadow: isTopTile
                            ? `0 0 0 1px ${tile.glow}, 0 18px 28px rgba(0, 0, 0, 0.22)`
                            : "none",
                          transform: isTopTile ? "translateY(0)" : "scale(0.96)",
                          cursor: isTopTile && !isFinished ? "pointer" : "default",
                          transition: "transform 140ms ease, top 140ms ease, background 140ms ease",
                        }}
                      >
                        <span style={{ fontSize: 26, lineHeight: 1, fontWeight: 800 }}>{tile.glyph}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em" }}>{tile.label}</span>
                      </button>
                    );
                  })}

                  {!visibleTile ? (
                    <div
                      style={{
                        position: "absolute",
                        inset: 12,
                        display: "grid",
                        placeItems: "center",
                        borderRadius: 18,
                        border: "1px dashed rgba(255, 255, 255, 0.14)",
                        color: "rgba(255, 255, 255, 0.4)",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      已清空
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <footer className={shared.result} aria-live="polite">
        {summary ?? message}
      </footer>
    </section>
  );
}
