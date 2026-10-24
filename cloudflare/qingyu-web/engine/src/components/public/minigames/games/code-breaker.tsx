"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "../shared.module.css";
import type { MiniGameRenderProps } from "../types";

type GuessResult = {
  guess: string;
  bulls: number;
  cows: number;
};

const CODE_LENGTH = 4;
const MAX_ATTEMPTS = 8;
const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const KEYBOARD_ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
];

function randomDigit() {
  return DIGITS[Math.floor(Math.random() * DIGITS.length)];
}

function createSecretCode() {
  return Array.from({ length: CODE_LENGTH }, randomDigit);
}

function evaluateGuess(secret: string[], guess: string[]) {
  let bulls = 0;
  const secretCounts = new Map<string, number>();
  const guessCounts = new Map<string, number>();

  for (let index = 0; index < CODE_LENGTH; index += 1) {
    const secretDigit = secret[index];
    const guessDigit = guess[index];

    if (secretDigit === guessDigit) {
      bulls += 1;
      continue;
    }

    secretCounts.set(secretDigit, (secretCounts.get(secretDigit) ?? 0) + 1);
    guessCounts.set(guessDigit, (guessCounts.get(guessDigit) ?? 0) + 1);
  }

  let cows = 0;
  guessCounts.forEach((guessCount, digit) => {
    cows += Math.min(guessCount, secretCounts.get(digit) ?? 0);
  });

  return { bulls, cows };
}

function formatCode(code: string[]) {
  return code.join("");
}

export function CodeBreakerGame({ onFinish }: MiniGameRenderProps) {
  const [secretCode, setSecretCode] = useState<string[]>(() => createSecretCode());
  const [currentGuess, setCurrentGuess] = useState<string[]>([]);
  const [history, setHistory] = useState<GuessResult[]>([]);
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS);
  const [status, setStatus] = useState("输入 4 位数字并提交。位置正确表示数字和位置都对，数字存在表示数字在密码里但位置不对。");
  const [finished, setFinished] = useState(false);
  const [resultTone, setResultTone] = useState<"neutral" | "success" | "error">("neutral");
  const onFinishRef = useRef(onFinish);
  const finishedRef = useRef(false);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  const finishGame = (score: number, summary: string, tone: "success" | "error") => {
    if (finishedRef.current) {
      return;
    }

    finishedRef.current = true;
    setFinished(true);
    setResultTone(tone);
    setStatus(summary);
    onFinishRef.current(score, summary);
  };

  const resetGame = () => {
    finishedRef.current = false;
    setSecretCode(createSecretCode());
    setCurrentGuess([]);
    setHistory([]);
    setAttemptsLeft(MAX_ATTEMPTS);
    setFinished(false);
    setResultTone("neutral");
    setStatus("新密码已生成，继续破译。输入 4 位数字并提交。");
  };

  const handleDigitPress = (digit: string) => {
    if (finished || currentGuess.length >= CODE_LENGTH) {
      return;
    }

    setCurrentGuess((value) => [...value, digit]);
  };

  const handleBackspace = () => {
    if (finished) {
      return;
    }

    setCurrentGuess((value) => value.slice(0, -1));
  };

  const handleClear = () => {
    if (finished) {
      return;
    }

    setCurrentGuess([]);
  };

  const handleSubmit = () => {
    if (finished) {
      return;
    }

    if (currentGuess.length !== CODE_LENGTH) {
      setStatus(`还差 ${CODE_LENGTH - currentGuess.length} 位数字。`);
      setResultTone("neutral");
      return;
    }

    const guessText = formatCode(currentGuess);
    const result = evaluateGuess(secretCode, currentGuess);
    const nextAttemptsLeft = attemptsLeft - 1;
    const isSolved = result.bulls === CODE_LENGTH;
    const guessNumber = MAX_ATTEMPTS - attemptsLeft + 1;

    setHistory((value) => [
      ...value,
      {
        guess: guessText,
        bulls: result.bulls,
        cows: result.cows,
      },
    ]);
    setAttemptsLeft(nextAttemptsLeft);
    setCurrentGuess([]);

    if (isSolved) {
      const score = 100 + nextAttemptsLeft * 25;
      finishGame(score, `破译成功。密码是 ${guessText}，共用 ${guessNumber} 次尝试。`, "success");
      return;
    }

    if (nextAttemptsLeft <= 0) {
      finishGame(0, `8 次机会已用尽，正确密码是 ${formatCode(secretCode)}。`, "error");
      return;
    }

    setResultTone("neutral");
    setStatus(`第 ${guessNumber} 次尝试：位置正确 ${result.bulls} 位，数字存在 ${result.cows} 位。还剩 ${nextAttemptsLeft} 次机会。`);
  };

  const currentGuessSlots = Array.from({ length: CODE_LENGTH }, (_, index) => currentGuess[index] ?? "");
  const attemptsUsed = MAX_ATTEMPTS - attemptsLeft;
  const canSubmit = !finished && currentGuess.length === CODE_LENGTH;

  const slotStyle = (filled: boolean, active: boolean): CSSProperties => ({
    minHeight: 64,
    borderRadius: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 24,
    fontWeight: 800,
    letterSpacing: "0.16em",
    color: filled ? "#081018" : "rgba(255,255,255,0.52)",
    background: filled
      ? active
        ? "linear-gradient(180deg, #d5ffe2 0%, #7ff0bc 100%)"
        : "linear-gradient(180deg, #c9f6ff 0%, #7dd7eb 100%)"
      : "rgba(255, 255, 255, 0.03)",
    border: active ? "1px solid rgba(255,255,255,0.36)" : "1px solid rgba(255,255,255,0.1)",
    boxShadow: active ? "0 0 0 2px rgba(125, 235, 201, 0.2)" : "none",
  });

  const chipStyle = (tone: "neutral" | "success" | "error"): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    minHeight: 28,
    padding: "0 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    color:
      tone === "success"
        ? "#0d2b1a"
        : tone === "error"
          ? "#3a1010"
          : "rgba(255,255,255,0.82)",
    background:
      tone === "success"
        ? "linear-gradient(180deg, #bfffe2 0%, #7bf0b5 100%)"
        : tone === "error"
          ? "linear-gradient(180deg, #ffd3d3 0%, #ff9e9e 100%)"
          : "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
  });

  return (
    <section className={styles.gameRoot}>
      <header className={styles.hud}>
        <div>
          <h2 className={styles.headline}>密码破译</h2>
          <div className={styles.subheadline}>猜出一个 4 位密码。每次提交后都会返回位置正确数和数字存在数，共有 8 次机会。</div>
        </div>
        <div className={styles.stats}>
          <span className={styles.pill}>剩余 {attemptsLeft} 次</span>
          <span className={styles.pill}>已尝试 {attemptsUsed}/8</span>
          <span className={styles.pill}>{finished ? "本局结束" : "破解中"}</span>
        </div>
      </header>

      <div className={styles.board}>
        <div className={styles.panel} style={{ display: "grid", gap: 12 }}>
          <div className={styles.helper}>{status}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
            {currentGuessSlots.map((digit, index) => (
              <div key={`slot-${index}`} style={slotStyle(Boolean(digit), !finished && index === currentGuess.length)}>
                {digit || "•"}
              </div>
            ))}
          </div>
        </div>

        <div className={styles.panel} style={{ display: "grid", gap: 12 }}>
          <div className={styles.grid3}>
            {KEYBOARD_ROWS.flat().map((digit) => (
              <button
                key={digit}
                type="button"
                className={styles.secondaryButton}
                onClick={() => handleDigitPress(digit)}
                disabled={finished || currentGuess.length >= CODE_LENGTH}
                style={{
                  minHeight: 54,
                  fontSize: 18,
                  fontWeight: 800,
                  letterSpacing: "0.06em",
                  background: "rgba(255,255,255,0.05)",
                }}
              >
                {digit}
              </button>
            ))}
          </div>

          <div className={styles.grid4}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleBackspace}
              disabled={finished || currentGuess.length === 0}
            >
              删除
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleClear}
              disabled={finished || currentGuess.length === 0}
            >
              清空
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                minHeight: 54,
                background: canSubmit ? "linear-gradient(180deg, #f4ffb9 0%, #e7ff6d 100%)" : undefined,
                color: "#081018",
              }}
            >
              提交
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={resetGame}
            >
              重开
            </button>
          </div>
        </div>

        <div className={styles.panel} style={{ display: "grid", gap: 12 }}>
          <div className={styles.result} style={chipStyle(resultTone)}>
            {finished ? "结算结果" : "反馈历史"}
          </div>
          {history.length === 0 ? (
            <div className={styles.helper}>提交后这里会显示每一轮的反馈记录。</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {history.map((entry, index) => (
                <div
                  key={`${entry.guess}-${index}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "12px 14px",
                    borderRadius: 16,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.08em" }}>
                      第 {index + 1} 次 · {entry.guess}
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.62)" }}>
                      位置正确 {entry.bulls} 位，数字存在 {entry.cows} 位
                    </div>
                  </div>
                  <span className={styles.pill}>#{index + 1}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
