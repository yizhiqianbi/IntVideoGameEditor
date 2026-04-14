"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../shared.module.css";
import type { MiniGameRenderProps } from "../types";

type HarborPair = {
  id: string;
  leftLabel: string;
  rightLabel: string;
  leftHint: string;
  rightHint: string;
  accent: string;
};

type HarborItem = {
  id: string;
  pairId: string;
  label: string;
  hint: string;
  accent: string;
};

const HARBOR_PAIRS: HarborPair[] = [
  {
    id: "hai-yan",
    leftLabel: "海燕号",
    rightLabel: "冷链鲜货",
    leftHint: "快速靠港的补给船",
    rightHint: "优先进入冷藏通道",
    accent: "#67e8f9",
  },
  {
    id: "chao-sheng",
    leftLabel: "潮生号",
    rightLabel: "客运接驳",
    leftHint: "沿海短程客轮",
    rightHint: "衔接旅客上下船",
    accent: "#fbbf24",
  },
  {
    id: "xing-fan",
    leftLabel: "星帆号",
    rightLabel: "集装箱",
    leftHint: "标准干货运输船",
    rightHint: "进入箱区堆场",
    accent: "#93c5fd",
  },
  {
    id: "lan-shan",
    leftLabel: "岚山号",
    rightLabel: "散货矿石",
    leftHint: "重载散货船",
    rightHint: "对应大宗散货码头",
    accent: "#86efac",
  },
  {
    id: "yin-jiao",
    leftLabel: "银礁号",
    rightLabel: "维修补给",
    leftHint: "待检修的工程船",
    rightHint: "靠泊维修与补给区",
    accent: "#f9a8d4",
  },
  {
    id: "qian-wan",
    leftLabel: "浅湾号",
    rightLabel: "危险品专线",
    leftHint: "需隔离靠泊的特种船",
    rightHint: "接入专用安全通道",
    accent: "#fdba74",
  },
];

function shuffle<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function buildBoard() {
  const shuffledPairs = shuffle(HARBOR_PAIRS);

  return {
    leftItems: shuffle(
      shuffledPairs.map<HarborItem>((pair) => ({
        id: `${pair.id}-left`,
        pairId: pair.id,
        label: pair.leftLabel,
        hint: pair.leftHint,
        accent: pair.accent,
      })),
    ),
    rightItems: shuffle(
      shuffledPairs.map<HarborItem>((pair) => ({
        id: `${pair.id}-right`,
        pairId: pair.id,
        label: pair.rightLabel,
        hint: pair.rightHint,
        accent: pair.accent,
      })),
    ),
  };
}

export function HarborMatchGame({ onFinish }: MiniGameRenderProps) {
  const [board] = useState(() => buildBoard());
  const [selectedLeftPairId, setSelectedLeftPairId] = useState<string | null>(null);
  const [matchedPairIds, setMatchedPairIds] = useState<string[]>([]);
  const [errors, setErrors] = useState(0);
  const [message, setMessage] = useState("先点左侧港口项，再点右侧对应项完成连线。");
  const [finished, setFinished] = useState(false);
  const onFinishRef = useRef(onFinish);
  const finishGuardRef = useRef(false);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  const matchedSet = useMemo(() => new Set(matchedPairIds), [matchedPairIds]);
  const totalPairs = HARBOR_PAIRS.length;
  const completedCount = matchedPairIds.length;

  const finishGame = useCallback((finalErrors: number) => {
    if (finishGuardRef.current) {
      return;
    }

    finishGuardRef.current = true;
    setFinished(true);

    const summary = `全部 ${totalPairs} 组港口连线完成，错误 ${finalErrors} 次。`;
    const score = Math.max(0, 100 - finalErrors * 12);

    setMessage(summary);
    onFinishRef.current(score, summary);
  }, [totalPairs]);

  const handleLeftClick = (pairId: string) => {
    if (finished || matchedSet.has(pairId)) {
      return;
    }

    setSelectedLeftPairId(pairId);
    const pair = HARBOR_PAIRS.find((item) => item.id === pairId);
    setMessage(`已选中左侧「${pair?.leftLabel ?? "未知项目"}」，请选择右侧对应项。`);
  };

  const handleRightClick = (pairId: string) => {
    if (finished || matchedSet.has(pairId)) {
      return;
    }

    if (!selectedLeftPairId) {
      setMessage("请先选择左侧项目，再点击右侧项。");
      return;
    }

    const selectedPair = HARBOR_PAIRS.find((item) => item.id === selectedLeftPairId);
    const targetPair = HARBOR_PAIRS.find((item) => item.id === pairId);

    if (selectedLeftPairId === pairId) {
      const nextCompletedCount = matchedSet.has(pairId) ? completedCount : completedCount + 1;

      setMatchedPairIds((current) => (current.includes(pairId) ? current : [...current, pairId]));
      setSelectedLeftPairId(null);
      setMessage(`正确：${selectedPair?.leftLabel ?? "左侧项目"} 已连到 ${targetPair?.rightLabel ?? "右侧项目"}。`);
      if (nextCompletedCount === totalPairs) {
        finishGame(errors);
      }
      return;
    }

    setErrors((current) => current + 1);
    setSelectedLeftPairId(null);
    setMessage(
      `错误：${selectedPair?.leftLabel ?? "左侧项目"} 不对应 ${targetPair?.rightLabel ?? "该项"}，请重新选择。`,
    );
  };

  return (
    <section className={styles.gameRoot} aria-label="港口连线游戏">
      <header className={styles.hud}>
        <div className={styles.stats}>
          <span className={styles.pill}>
            已完成 {completedCount}/{totalPairs}
          </span>
          <span className={styles.pill}>错误 {errors}</span>
          <span className={styles.pill}>{finished ? "已结束" : "连线中"}</span>
        </div>
      </header>

      <main className={styles.board}>
        <div className={styles.panel}>
          <h2 className={styles.headline}>港口连线</h2>
          <p className={styles.subheadline}>
            先点左侧，再点右侧。找对一组就会锁定，配完全部题库后自动结束并回调 `onFinish`。
          </p>
        </div>

        <div className={styles.grid2} role="grid" aria-label="港口匹配面板">
          <div className={styles.panel}>
            <p className={styles.helper}>左侧：港口来船</p>
            <div
              style={{
                display: "grid",
                gap: 10,
                marginTop: 10,
              }}
            >
              {board.leftItems.map((item) => {
                const isSelected = selectedLeftPairId === item.pairId;
                const isMatched = matchedSet.has(item.pairId);

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={styles.button}
                    onClick={() => handleLeftClick(item.pairId)}
                    disabled={finished || isMatched}
                    aria-pressed={isSelected}
                    aria-label={`左侧 ${item.label}`}
                    style={{
                      justifyContent: "flex-start",
                      textAlign: "left",
                      minHeight: 72,
                      padding: "12px 14px",
                      borderColor: isMatched
                        ? item.accent
                        : isSelected
                          ? "rgba(255,255,255,0.38)"
                          : "rgba(255,255,255,0.1)",
                      background: isMatched
                        ? `linear-gradient(180deg, ${item.accent} 0%, rgba(87, 203, 132, 0.9) 100%)`
                        : isSelected
                          ? "rgba(255,255,255,0.12)"
                          : "rgba(255,255,255,0.05)",
                      color: isMatched ? "#06110a" : "#f5f7fb",
                      boxShadow: isSelected && !isMatched ? `0 0 0 2px ${item.accent}55` : "none",
                    }}
                  >
                    <span style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 15, fontWeight: 800 }}>{item.label}</span>
                      <span style={{ fontSize: 12, opacity: 0.82 }}>{item.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.panel}>
            <p className={styles.helper}>右侧：对应货类</p>
            <div
              style={{
                display: "grid",
                gap: 10,
                marginTop: 10,
              }}
            >
              {board.rightItems.map((item) => {
                const isMatched = matchedSet.has(item.pairId);
                const isReady = selectedLeftPairId !== null;

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={styles.button}
                    onClick={() => handleRightClick(item.pairId)}
                    disabled={finished || isMatched}
                    aria-label={`右侧 ${item.label}`}
                    style={{
                      justifyContent: "flex-start",
                      textAlign: "left",
                      minHeight: 72,
                      padding: "12px 14px",
                      borderColor: isMatched
                        ? item.accent
                        : isReady
                          ? "rgba(255,255,255,0.24)"
                          : "rgba(255,255,255,0.1)",
                      background: isMatched
                        ? `linear-gradient(180deg, rgba(87, 203, 132, 0.92) 0%, ${item.accent} 100%)`
                        : isReady
                          ? "rgba(255,255,255,0.08)"
                          : "rgba(255,255,255,0.05)",
                      color: isMatched ? "#06110a" : "#f5f7fb",
                    }}
                  >
                    <span style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 15, fontWeight: 800 }}>{item.label}</span>
                      <span style={{ fontSize: 12, opacity: 0.82 }}>{item.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <footer className={styles.result} aria-live="polite">
          {message}
        </footer>
      </main>
    </section>
  );
}
