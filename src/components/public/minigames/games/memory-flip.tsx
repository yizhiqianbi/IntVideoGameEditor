"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import shared from "../shared.module.css";
import type { MiniGameRenderProps } from "../types";

type CardSymbol = {
  id: string;
  label: string;
  pairKey: string;
};

type CardState = CardSymbol & {
  isFlipped: boolean;
  isMatched: boolean;
};

const SYMBOLS = ["▲", "●", "■", "★", "✦", "☘", "☀", "♥"] as const;

function shuffle<T>(items: T[]) {
  const next = items.slice();

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remaining = safeSeconds % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function buildDeck() {
  const cards = SYMBOLS.flatMap((symbol, index) => {
    const pairKey = `${index}`;
    return [
      { id: `${pairKey}-a`, label: symbol, pairKey },
      { id: `${pairKey}-b`, label: symbol, pairKey },
    ];
  });

  return shuffle(cards).map<CardState>((card) => ({
    ...card,
    isFlipped: false,
    isMatched: false,
  }));
}

export function MemoryFlipGame({ onFinish }: MiniGameRenderProps) {
  const [cards, setCards] = useState<CardState[]>(() => buildDeck());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [matchedCount, setMatchedCount] = useState(0);
  const [moves, setMoves] = useState(0);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [resultSummary, setResultSummary] = useState<string | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const onFinishRef = useRef(onFinish);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    if (!hasStarted || isFinished) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setSecondsElapsed((value) => value + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [hasStarted, isFinished]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const matchedPairs = matchedCount;
  const totalPairs = SYMBOLS.length;
  const timeLabel = useMemo(() => formatTime(secondsElapsed), [secondsElapsed]);

  const finishGame = (finalMoves: number, finalSeconds: number) => {
    setIsFinished(true);
    setIsLocked(true);

    const score = Math.max(100, 1000 - finalMoves * 20 - finalSeconds * 2);
    const summary = `已完成 8 对，步数 ${finalMoves}，用时 ${formatTime(finalSeconds)}。`;
    setResultSummary(summary);
    onFinishRef.current(score, summary);
  };

  const resetGame = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    setIsLocked(false);
    setCards(buildDeck());
    setSelectedIds([]);
    setMatchedCount(0);
    setMoves(0);
    setSecondsElapsed(0);
    setHasStarted(false);
    setIsFinished(false);
    setResultSummary(null);
  };

  const handleCardClick = (cardId: string) => {
    if (isFinished || isLocked) {
      return;
    }

    const currentCard = cards.find((card) => card.id === cardId);
    if (!currentCard || currentCard.isMatched || currentCard.isFlipped) {
      return;
    }

    if (!hasStarted) {
      setHasStarted(true);
    }

    const nextSelectedIds = [...selectedIds, cardId];

    setCards((prevCards) =>
      prevCards.map((card) =>
        card.id === cardId ? { ...card, isFlipped: true } : card,
      ),
    );

    setSelectedIds(nextSelectedIds);

    if (nextSelectedIds.length !== 2) {
      return;
    }

    const nextMoves = moves + 1;
    const nextMatchedCount = matchedCount;

    setIsLocked(true);
    setMoves(nextMoves);

    const [firstId, secondId] = nextSelectedIds;
    const firstCard = cards.find((card) => card.id === firstId);
    const secondCard = cards.find((card) => card.id === secondId);

    if (firstCard?.pairKey && firstCard.pairKey === secondCard?.pairKey) {
      const updatedMatchedCount = nextMatchedCount + 1;
      setCards((prevCards) =>
        prevCards.map((card) =>
          card.id === firstId || card.id === secondId
            ? { ...card, isMatched: true }
            : card,
        ),
      );
      setMatchedCount(updatedMatchedCount);
      setSelectedIds([]);
      setIsLocked(false);
      if (updatedMatchedCount === totalPairs) {
        finishGame(nextMoves, secondsElapsed);
      }
      return;
    }

    timeoutRef.current = window.setTimeout(() => {
      setCards((prevCards) =>
        prevCards.map((card) =>
          card.id === firstId || card.id === secondId
            ? { ...card, isFlipped: false }
            : card,
        ),
      );
      setSelectedIds([]);
      setIsLocked(false);
      timeoutRef.current = null;
    }, 850);
  };

  return (
    <section className={shared.gameRoot} aria-label="记忆翻牌游戏">
      <header className={shared.hud}>
        <div className={shared.stats}>
          <span className={shared.pill}>步数 {moves}</span>
          <span className={shared.pill}>已配对 {matchedPairs}/8</span>
          <span className={shared.pill}>时间 {timeLabel}</span>
        </div>
        <button
          type="button"
          className={shared.secondaryButton}
          onClick={resetGame}
        >
          重新开始
        </button>
      </header>

      <main className={shared.board}>
        <div className={shared.panel}>
          <h2 className={shared.headline}>记忆翻牌</h2>
          <p className={shared.subheadline}>
            翻开两张牌，找到相同图案。尽量用更少步数和更短时间完成全部配对。
          </p>
        </div>

        <div className={shared.grid4} role="grid" aria-label="牌面网格">
          {cards.map((card) => {
            const isVisible = card.isFlipped || card.isMatched;

            return (
              <button
                key={card.id}
                type="button"
                className={shared.button}
                onClick={() => handleCardClick(card.id)}
                disabled={card.isMatched || isLocked}
                aria-pressed={isVisible}
                aria-label={isVisible ? `已翻开 ${card.label}` : "背面牌"}
                style={{
                  aspectRatio: "1 / 1",
                  minHeight: 0,
                  fontSize: "clamp(20px, 3vw, 32px)",
                  lineHeight: 1,
                  display: "grid",
                  placeItems: "center",
                  background: card.isMatched
                    ? "linear-gradient(180deg, rgba(87, 203, 132, 0.95), rgba(44, 145, 96, 0.95))"
                    : isVisible
                      ? "rgba(255, 255, 255, 0.12)"
                      : "rgba(255, 255, 255, 0.05)",
                  color: card.isMatched ? "#06110a" : "#f5f7fb",
                  borderColor: card.isMatched
                    ? "rgba(87, 203, 132, 0.55)"
                    : "rgba(255, 255, 255, 0.12)",
                  opacity: card.isMatched ? 0.94 : 1,
                }}
              >
                {isVisible ? card.label : "？"}
              </button>
            );
          })}
        </div>
      </main>

      <footer className={shared.result} aria-live="polite">
        {isFinished
          ? resultSummary
          : "翻开两张牌进行配对。完成全部 8 对后会自动结算。"}
      </footer>
    </section>
  );
}
