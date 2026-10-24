"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../shared.module.css";
import type { MiniGameRenderProps } from "../types";

type TruthQuestion = {
  statement: string;
  answer: boolean;
  explanation: string;
};

type FeedbackState = {
  label: string;
  detail: string;
  tone: "success" | "error";
};

const TIME_LIMIT = 8;
const FEEDBACK_DELAY = 850;

const QUESTIONS: TruthQuestion[] = [
  {
    statement: "金星的自转方向和大多数行星相反。",
    answer: true,
    explanation: "金星是少数逆行自转的行星之一。",
  },
  {
    statement: "香蕉是长在树干上的木本果实。",
    answer: false,
    explanation: "香蕉长在大型草本植物上，不是树。",
  },
  {
    statement: "水在标准大气压下会在 100°C 沸腾。",
    answer: true,
    explanation: "这是常见的物理基准条件。",
  },
  {
    statement: "企鹅会在北极自然栖息。",
    answer: false,
    explanation: "企鹅主要生活在南半球，北极没有自然分布。",
  },
  {
    statement: "地球的昼夜交替来自地球自转。",
    answer: true,
    explanation: "地球自转一圈大约 24 小时。",
  },
  {
    statement: "月球每年都会离地球远一点。",
    answer: true,
    explanation: "月球正在缓慢远离地球，量级是厘米级。",
  },
  {
    statement: "闪电的温度可能高于太阳表面。",
    answer: true,
    explanation: "闪电通道瞬间温度非常高，可超过太阳表面温度。",
  },
  {
    statement: "蜂蜜一旦产生就绝不会变质。",
    answer: false,
    explanation: "蜂蜜保存性很强，但仍可能因污染、吸水等原因变质。",
  },
  {
    statement: "光在真空中的传播速度比声音快得多。",
    answer: true,
    explanation: "光速远高于声速，且声音不能在真空中传播。",
  },
  {
    statement: "海水不能结冰。",
    answer: false,
    explanation: "海水会在更低温度下结冰，只是冰点低于淡水。",
  },
  {
    statement: "人类骨头数量会在一生中保持完全不变。",
    answer: false,
    explanation: "婴儿骨头更多，成长过程中会有骨骼融合。",
  },
  {
    statement: "塑料可以被普通磁铁直接吸起来。",
    answer: false,
    explanation: "大多数塑料不具磁性，无法被磁铁吸引。",
  },
  {
    statement: "蝙蝠属于鸟类。",
    answer: false,
    explanation: "蝙蝠是哺乳动物，不是鸟类。",
  },
  {
    statement: "长颈鹿和人类一样有 7 块颈椎骨。",
    answer: true,
    explanation: "绝大多数哺乳动物的颈椎数都是 7 块，包括长颈鹿。",
  },
];

function shuffleQuestions(items: TruthQuestion[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function TruthJudgeGame({ onFinish }: MiniGameRenderProps) {
  const [deck] = useState(() => shuffleQuestions(QUESTIONS));
  const [questionIndex, setQuestionIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [ended, setEnded] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const pendingAdvanceRef = useRef<number | null>(null);
  const finishedRef = useRef(false);

  const currentQuestion = deck[questionIndex];

  const clearPendingAdvance = useCallback(() => {
    if (pendingAdvanceRef.current !== null) {
      window.clearTimeout(pendingAdvanceRef.current);
      pendingAdvanceRef.current = null;
    }
  }, []);

  const finishGame = useCallback(
    (finalScore: number, finalCorrectCount: number, finalBestStreak: number) => {
      if (finishedRef.current) {
        return;
      }
      finishedRef.current = true;
      clearPendingAdvance();
      setEnded(true);
      onFinish(
        finalScore,
        `答对 ${finalCorrectCount}/${deck.length} 题，最高连对 ${finalBestStreak}，总分 ${finalScore}`,
      );
    },
    [clearPendingAdvance, deck.length, onFinish],
  );

  const goToNextQuestion = useCallback(
    (nextScore: number, nextCorrectCount: number, nextBestStreak: number) => {
      clearPendingAdvance();

      if (questionIndex + 1 >= deck.length) {
        finishGame(nextScore, nextCorrectCount, nextBestStreak);
        return;
      }

      setQuestionIndex((value) => value + 1);
      setTimeLeft(TIME_LIMIT);
      setAnswered(false);
      setFeedback(null);
    },
    [clearPendingAdvance, deck.length, finishGame, questionIndex],
  );

  const resolveQuestion = useCallback(
    (pickedTruth: boolean, timedOut = false) => {
      if (answered || ended || finishedRef.current || !currentQuestion) {
        return;
      }

      clearPendingAdvance();

      const isCorrect = currentQuestion.answer === pickedTruth;
      const nextCorrectCount = correctCount + (isCorrect ? 1 : 0);
      const nextStreak = isCorrect ? streak + 1 : 0;
      const nextBestStreak = Math.max(bestStreak, nextStreak);
      const pointsEarned = isCorrect ? 12 + timeLeft * 2 + streak * 4 : 0;
      const nextScore = score + pointsEarned;

      setAnswered(true);
      setScore(nextScore);
      setCorrectCount(nextCorrectCount);
      setStreak(nextStreak);
      setBestStreak(nextBestStreak);
      setFeedback({
        label: isCorrect
          ? "判断正确"
          : timedOut
            ? "时间到"
            : "判断错误",
        detail: isCorrect
          ? `+${pointsEarned} 分。${currentQuestion.explanation}`
          : `${currentQuestion.answer ? "答案是真" : "答案是假"}。${currentQuestion.explanation}`,
        tone: isCorrect ? "success" : "error",
      });

      pendingAdvanceRef.current = window.setTimeout(() => {
        goToNextQuestion(nextScore, nextCorrectCount, nextBestStreak);
      }, FEEDBACK_DELAY);
    },
    [
      answered,
      bestStreak,
      clearPendingAdvance,
      correctCount,
      currentQuestion,
      ended,
      goToNextQuestion,
      score,
      streak,
      timeLeft,
    ],
  );

  useEffect(() => {
    if (ended || answered) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setTimeLeft((value) => Math.max(0, value - 1));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [answered, ended, questionIndex]);

  useEffect(() => {
    if (ended || answered) {
      return;
    }

    if (timeLeft > 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      resolveQuestion(false, true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [answered, ended, resolveQuestion, timeLeft]);

  useEffect(() => {
    return () => {
      clearPendingAdvance();
    };
  }, [clearPendingAdvance]);

  const progress = ((questionIndex + (answered ? 1 : 0)) / deck.length) * 100;
  const displayQuestionNumber = Math.min(questionIndex + 1, deck.length);

  return (
    <section
      className={styles.gameRoot}
      style={{
        minHeight: "100%",
        padding: 20,
        borderRadius: 28,
        background:
          "radial-gradient(circle at top, rgba(111, 155, 255, 0.18), transparent 36%), linear-gradient(180deg, rgba(9, 12, 18, 0.98), rgba(7, 10, 14, 0.94))",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 24px 60px rgba(0,0,0,0.25)",
      }}
    >
      <div className={styles.hud}>
        <div className={styles.stats}>
          <span className={styles.pill}>题目 {displayQuestionNumber}/{deck.length}</span>
          <span className={styles.pill}>连对 {streak}</span>
          <span className={styles.pill}>得分 {score}</span>
        </div>
        <span className={styles.pill}>剩余 {timeLeft}s</span>
      </div>

      <div className={styles.board} style={{ position: "relative", overflow: "hidden" }}>
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: "auto 18px 18px 18px",
            height: 4,
            borderRadius: 999,
            background: "rgba(255,255,255,0.08)",
          }}
        >
          <div
            style={{
              width: `${Math.max(0, Math.min(100, progress))}%`,
              height: "100%",
              borderRadius: 999,
              background:
                "linear-gradient(90deg, rgba(104, 199, 255, 0.95), rgba(90, 255, 193, 0.95))",
              transition: "width 220ms ease",
            }}
          />
        </div>

        <div className={styles.panel} style={{ paddingBottom: 22 }}>
          <p className={styles.subheadline} style={{ margin: "0 0 8px" }}>
            在 {TIME_LIMIT} 秒内判断下列陈述是真是假
          </p>
          <h2 className={styles.headline} style={{ fontSize: 26, lineHeight: 1.35, marginBottom: 12 }}>
            {currentQuestion?.statement}
          </h2>
          <p className={styles.helper} style={{ margin: 0 }}>
            快速做出选择，正确且越快，得分越高。
          </p>
        </div>

        <div className={styles.grid2}>
          <button
            type="button"
            className={styles.button}
            disabled={answered || ended}
            onClick={() => resolveQuestion(true)}
          >
            真
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={answered || ended}
            onClick={() => resolveQuestion(false)}
          >
            假
          </button>
        </div>

        <div className={styles.panel}>
          <p className={styles.result} style={{ margin: 0 }}>
            {feedback ? feedback.label : "等待你的判断。"}
          </p>
          <p
            className={styles.helper}
            style={{
              margin: "8px 0 0",
              color: feedback?.tone === "success" ? "rgba(157, 255, 201, 0.86)" : "rgba(255, 194, 194, 0.82)",
            }}
          >
            {feedback ? feedback.detail : "每题限时 8 秒，超时会自动判错并继续下一题。"}
          </p>
        </div>

        {ended ? (
          <div className={styles.panel}>
            <p className={styles.headline} style={{ margin: 0 }}>
              本局已结束
            </p>
            <p className={styles.helper} style={{ margin: "8px 0 0" }}>
              你答对了 {correctCount}/{deck.length} 题，最高连对 {bestStreak}，总分 {score}。
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
