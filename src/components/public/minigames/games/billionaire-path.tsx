"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import shared from "../shared.module.css";
import type { MiniGameRenderProps } from "../types";

type Stats = {
  curiosity: number;
  grit: number;
  leverage: number;
  truth: number;
};

type Choice = {
  label: string;
  consequence: string;
  stats: Partial<Stats>;
  clue?: string;
};

type Chapter = {
  age: string;
  title: string;
  scene: string;
  prompt: string;
  choices: [Choice, Choice];
};

type Ending = {
  title: string;
  descriptor: string;
  reveal: string;
};

const INITIAL_STATS: Stats = {
  curiosity: 0,
  grit: 0,
  leverage: 0,
  truth: 0,
};

const CHAPTERS: Chapter[] = [
  {
    age: "5 岁",
    title: "童年起点",
    scene: "你先学会的不是赢，而是适应环境变化。",
    prompt: "家里又搬家了。你是先去观察新环境，还是先把自己缩回安全角落？",
    choices: [
      {
        label: "先去观察和提问",
        consequence: "你更早学会了看局势，也更敢在陌生地方找机会。",
        stats: { curiosity: 2, grit: 1 },
      },
      {
        label: "先躲回熟悉规则里",
        consequence: "你学会了谨慎，但会慢半拍才敢出手。",
        stats: { grit: 1, truth: 1 },
      },
    ],
  },
  {
    age: "16 岁",
    title: "异国打工",
    scene: "到了异乡，先有饭吃，再谈野心。",
    prompt: "白天上学、晚上打工，只能保一头。你选更稳的收入，还是更难的技能积累？",
    choices: [
      {
        label: "多打一份工，先把现金流稳住",
        consequence: "你学会了承压，也知道资源要从最底层一点点堆起来。",
        stats: { grit: 2, leverage: 1 },
      },
      {
        label: "少赚一点，换技能和视野",
        consequence: "你手头更紧，但开始摸到真正改变命运的杠杆。",
        stats: { curiosity: 2, leverage: 1 },
      },
    ],
  },
  {
    age: "22 岁",
    title: "第一次职业选择",
    scene: "稳定工作很诱人，但你知道自己不只想做执行者。",
    prompt: "一边是大厂正轨，一边是波动更大的高风险赛道。你会怎么走？",
    choices: [
      {
        label: "先进体系里练能力",
        consequence: "你建立了纪律和方法，但不会立刻暴富。",
        stats: { grit: 1, truth: 2 },
      },
      {
        label: "直接去高波动行业闯",
        consequence: "你更早站上了风险前沿，也更快学会用杠杆。",
        stats: { leverage: 2, curiosity: 1 },
      },
    ],
  },
  {
    age: "28 岁",
    title: "产品还是交易",
    scene: "你发现，真正的机会不在打工，而在搭建规则。",
    prompt: "你会自己写工具，还是去做撮合两端需求的人？",
    choices: [
      {
        label: "写工具，把效率做出来",
        consequence: "你掌握了底层能力，也更知道系统从哪会裂开。",
        stats: { truth: 2, curiosity: 1 },
        clue: "你留下一份很早的内部系统备忘，证明你比别人更早看到漏洞。",
      },
      {
        label: "做撮合，把流量先聚起来",
        consequence: "你快速积累了人脉和资源，但规则会越来越靠近你。",
        stats: { leverage: 2, grit: 1 },
      },
    ],
  },
  {
    age: "34 岁",
    title: "命运副本前夜",
    scene: "真正的副本不是创业，而是决定你站在哪一边。",
    prompt: "你有机会把平台做大，但每一步都有人盯着你。是继续收缩，还是放手扩张？",
    choices: [
      {
        label: "慢一点，先把风控和透明度补齐",
        consequence: "你跑得没那么快，但账总算能对上。",
        stats: { truth: 2, grit: 1 },
        clue: "一份延迟发布的风控报告，后来成了关键线索。",
      },
      {
        label: "先抢市场，风险留给以后",
        consequence: "你站上了舞台中心，也把自己暴露在更大的风暴前。",
        stats: { leverage: 2, curiosity: 1 },
      },
    ],
  },
  {
    age: "40 岁",
    title: "对决开始",
    scene: "你的对手不只是一个人，而是一整套叙事机器。",
    prompt: "面对强势对手和喧哗舆论，你先做公关、做反击，还是先查资金流？",
    choices: [
      {
        label: "先用公关对冲舆论",
        consequence: "你短期稳住了场面，但很多问题还藏在水下。",
        stats: { leverage: 1, grit: 1 },
      },
      {
        label: "直接追资金流和对手档案",
        consequence: "你会更晚发声，但离真相更近。",
        stats: { truth: 2, curiosity: 1 },
        clue: "你追到一条匿名付款链，金额大得不像普通危机公关。",
      },
    ],
  },
  {
    age: "终局",
    title: "2019 档案",
    scene: "通关不是赢，而是把碎片拼成一句足够刺耳的话。",
    prompt: "最后一击，你会公布不完整档案，还是继续留一手，等更硬的证据？",
    choices: [
      {
        label: "直接公开碎片档案",
        consequence: "你把问题扔回台面，代价是争议会一起爆炸。",
        stats: { truth: 2, leverage: 1 },
      },
      {
        label: "继续扣着，只放出暗线",
        consequence: "你保住了回旋余地，但很多人永远只会听到一半故事。",
        stats: { grit: 1, truth: 1 },
      },
    ],
  },
];

function applyChoice(previous: Stats, delta: Partial<Stats>) {
  return {
    curiosity: previous.curiosity + (delta.curiosity ?? 0),
    grit: previous.grit + (delta.grit ?? 0),
    leverage: previous.leverage + (delta.leverage ?? 0),
    truth: previous.truth + (delta.truth ?? 0),
  };
}

function buildEnding(stats: Stats, clues: string[]): Ending {
  if (stats.truth >= 7 && clues.length >= 3) {
    return {
      title: "档案解锁者",
      descriptor: "你不是最会抢镜的人，但你会把一页页线索拼成杀伤力。",
      reveal:
        "在这局改编式人生模拟里，你最终追回了一份 2019 商战档案：有人愿意为操纵叙事砸下 4300 万美元。它是游戏里的终局线索，不是庭审结论，但足够把局面彻底翻过来。",
    };
  }

  if (stats.leverage >= 7) {
    return {
      title: "扩张派掌局者",
      descriptor: "你总能比别人更早看见机会，也更愿意用风险换速度。",
      reveal:
        "你通关后拿到的不是完整真相，而是一句更刺耳的注脚：真正决定输赢的，不只是产品，而是谁更懂得操盘市场情绪。",
    };
  }

  if (stats.grit >= 7) {
    return {
      title: "异乡硬闯者",
      descriptor: "你一路靠韧性顶过所有低谷，最后把命运副本熬成了自己的主线。",
      reveal:
        "你解锁的终局档案说明，很多传奇不是从巅峰开始的，而是从一次次打工、一次次搬家、一次次忍耐开始的。",
    };
  }

  return {
    title: "审慎操盘手",
    descriptor: "你更习惯留后手，也更清楚什么时候该把牌捏在自己手里。",
    reveal:
      "你拿到的是一份残缺的尾声：2019 那条假新闻线背后确实藏着高额操盘预算，但你决定把最后一张牌留给下一局。",
  };
}

function buildSummary(score: number, ending: Ending, clues: string[]) {
  return `你通关了《首富人生模拟器》，结局是「${ending.title}」，得分 ${score}，解锁 ${clues.length} 条档案线索。`;
}

function computeScore(stats: Stats, clueCount: number) {
  return (
    stats.curiosity * 12 +
    stats.grit * 12 +
    stats.leverage * 15 +
    stats.truth * 18 +
    clueCount * 25
  );
}

export function BillionairePathGame({ onFinish }: MiniGameRenderProps) {
  const [chapterIndex, setChapterIndex] = useState(0);
  const [stats, setStats] = useState<Stats>(INITIAL_STATS);
  const [clues, setClues] = useState<string[]>([]);
  const [lastChoice, setLastChoice] = useState<string>("从 5 岁开始，先决定你怎么面对世界。");
  const [ending, setEnding] = useState<Ending | null>(null);
  const finishGuardRef = useRef(false);
  const onFinishRef = useRef(onFinish);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  const currentChapter = CHAPTERS[chapterIndex] ?? null;

  const score = useMemo(() => computeScore(stats, clues.length), [clues.length, stats]);

  const handleChoice = (choice: Choice) => {
    if (!currentChapter || ending) {
      return;
    }

    const nextStats = applyChoice(stats, choice.stats);
    const nextClues = choice.clue && !clues.includes(choice.clue) ? [...clues, choice.clue] : clues;

    setStats(nextStats);
    setClues(nextClues);
    setLastChoice(choice.consequence);

    if (chapterIndex === CHAPTERS.length - 1) {
      const nextEnding = buildEnding(nextStats, nextClues);
      const finalScore = computeScore(nextStats, nextClues.length);
      setEnding(nextEnding);

      if (!finishGuardRef.current) {
        finishGuardRef.current = true;
        onFinishRef.current(finalScore, buildSummary(finalScore, nextEnding, nextClues));
      }

      return;
    }

    setChapterIndex((value) => value + 1);
  };

  const handleRestart = () => {
    finishGuardRef.current = false;
    setChapterIndex(0);
    setStats(INITIAL_STATS);
    setClues([]);
    setLastChoice("从 5 岁开始，先决定你怎么面对世界。");
    setEnding(null);
  };

  return (
    <section className={shared.gameRoot} aria-label="首富人生模拟器">
      <header className={shared.hud}>
        <div>
          <h2 className={shared.headline}>首富人生模拟器</h2>
          <p className={shared.subheadline}>
            从 5 岁到 40 岁，每一个抉择改写你拿到的命运档案。
          </p>
        </div>
        <div className={shared.stats}>
          <span className={shared.pillAccent}>
            CHAPTER {Math.min(chapterIndex + 1, CHAPTERS.length)} / {CHAPTERS.length}
          </span>
          <span className={shared.pill}>📁 {clues.length} 线索</span>
          <span className={shared.pill}>⭐ {score} 分</span>
        </div>
      </header>

      <div className={shared.board}>
        {ending ? (
          <>
            <div className={shared.panel}>
              <span className={shared.sceneBadge}>★ ENDING · 结局</span>
              <h3 className={shared.sceneTitle}>
                <em>{ending.title}</em>
              </h3>
              <p className={shared.sceneText}>{ending.descriptor}</p>
            </div>

            <div className={shared.grid2}>
              <div className={shared.panel}>
                <span className={shared.statLabel}>终局揭示</span>
                <p className={shared.helper} style={{ marginTop: 8 }}>
                  {ending.reveal}
                </p>
              </div>
              <div className={shared.panel}>
                <span className={shared.statLabel}>你拼出的档案 · {clues.length}</span>
                <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  {clues.length > 0 ? (
                    clues.map((clue, i) => (
                      <div
                        key={clue}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "auto 1fr",
                          gap: 12,
                          alignItems: "baseline",
                          borderRadius: 12,
                          padding: "10px 14px",
                          border: "1px solid rgba(255,122,61,0.2)",
                          background: "rgba(255,61,0,0.05)",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--font-serif), serif",
                            fontStyle: "italic",
                            fontSize: 22,
                            color: "var(--color-accent)",
                            lineHeight: 1,
                          }}
                        >
                          №{String(i + 1).padStart(2, "0")}
                        </span>
                        <span className={shared.helper}>{clue}</span>
                      </div>
                    ))
                  ) : (
                    <span className={shared.helper}>这条人生线没能凑够档案碎片。</span>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : currentChapter ? (
          <>
            <div className={shared.panel}>
              <span className={shared.sceneBadge}>● {currentChapter.age}</span>
              <h3 className={shared.sceneTitle}>{currentChapter.title}</h3>
              <p className={shared.sceneText}>{currentChapter.scene}</p>
            </div>

            <div className={shared.grid2}>
              <div className={shared.panel}>
                <span className={shared.statLabel}>本关抉择</span>
                <p
                  style={{
                    margin: "10px 0 0",
                    fontSize: 18,
                    lineHeight: 1.5,
                    letterSpacing: "-0.015em",
                    fontWeight: 600,
                    color: "#fff",
                  }}
                >
                  {currentChapter.prompt}
                </p>
              </div>
              <div className={shared.panel}>
                <span className={shared.statLabel}>当前成长</span>
                <div
                  className={shared.grid4}
                  style={{ marginTop: 10, gap: 10 }}
                >
                  <div style={{ display: "grid", gap: 4 }}>
                    <span className={shared.statLabel}>好奇</span>
                    <span className={shared.statValue}>{stats.curiosity}</span>
                  </div>
                  <div style={{ display: "grid", gap: 4 }}>
                    <span className={shared.statLabel}>韧性</span>
                    <span className={shared.statValue}>{stats.grit}</span>
                  </div>
                  <div style={{ display: "grid", gap: 4 }}>
                    <span className={shared.statLabel}>杠杆</span>
                    <span className={shared.statValue}>{stats.leverage}</span>
                  </div>
                  <div style={{ display: "grid", gap: 4 }}>
                    <span className={shared.statLabel}>追真</span>
                    <span className={shared.statValue}>{stats.truth}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className={shared.grid2}>
              {currentChapter.choices.map((choice, i) => (
                <button
                  key={choice.label}
                  type="button"
                  className={shared.secondaryButton}
                  onClick={() => handleChoice(choice)}
                >
                  <span className={shared.statLabel}>
                    选项 {String.fromCharCode(65 + i)}
                  </span>
                  <span className={shared.choiceLabel}>{choice.label}</span>
                  <span className={shared.choiceHint}>{choice.consequence}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <footer
        className={shared.panel}
        style={{ display: "grid", gap: 12, padding: "16px 20px" }}
      >
        <div className={shared.grid2} style={{ gap: 18 }}>
          <div>
            <span className={shared.statLabel}>上一层反馈</span>
            <p className={shared.helper} style={{ margin: "6px 0 0" }}>
              {lastChoice}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}>
            <button type="button" className={shared.button} onClick={handleRestart}>
              {ending ? "↻ 重新走一遍" : "↻ 重开人生"}
            </button>
          </div>
        </div>
      </footer>
    </section>
  );
}
