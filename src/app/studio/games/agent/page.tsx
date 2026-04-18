"use client";

import Link from "next/link";
import { useState } from "react";
import { TopNav } from "@/components/top-nav";
import styles from "./page.module.css";

const STARTERS = [
  {
    icon: "💰",
    title: "人生模拟·富豪路",
    desc: "从童年到顶峰，每个选择决定命运",
    prompt: "做一款人生模拟游戏，从 5 岁到 60 岁，每个年龄段有两个抉择，最终生成一份命运画像。",
    type: "text-choice",
  },
  {
    icon: "⚡",
    title: "60 秒反应挑战",
    desc: "连击、目标、爆发式爽感",
    prompt: "做一个 60 秒内节奏紧凑的点击反应小游戏，要有连击奖励和越来越快的难度曲线。",
    type: "click-reaction",
  },
  {
    icon: "🧠",
    title: "4×4 记忆翻牌",
    desc: "8 对图案，考验瞬时记忆",
    prompt: "做一个 4×4 翻牌记忆游戏，8 对图案，限时 90 秒，可以按完成速度评 S/A/B/C 级。",
    type: "memory",
  },
  {
    icon: "🎵",
    title: "节奏判定条",
    desc: "鼓点落在时机内得分",
    prompt: "做一个节奏判定小游戏，滚动条到达中心点时点击，按 Perfect/Good/Miss 计分。",
    type: "rhythm",
  },
  {
    icon: "🎲",
    title: "密室解谜",
    desc: "三步逻辑推理出钥匙",
    prompt: "做一个极简密室解谜，玩家根据三条线索推理出密码，错两次就失败。",
    type: "puzzle",
  },
  {
    icon: "💫",
    title: "物理堆叠",
    desc: "重心、摇晃、倒塌瞬间",
    prompt: "做一个类似叠罗汉的物理堆叠游戏，用时机判定每一块是否对齐，最高分是塔高。",
    type: "physics",
  },
];

export default function GameAgentPage() {
  const [prompt, setPrompt] = useState("");

  function useStarter(starter: (typeof STARTERS)[number]) {
    setPrompt(starter.prompt);
  }

  return (
    <main className={styles.page}>
      <TopNav />
      <div className={styles.shell}>
        <Link href="/studio/games" className={styles.back}>
          ← 返回 Game Studio
        </Link>

        <section className={styles.hero}>
          <span className={styles.eyebrow}>
            <span className={styles.pulse} /> AI Agent · Beta
          </span>
          <h1 className={styles.title}>
            <span className={styles.titleEn}>Prompt</span>
            <span className={styles.titleCn}>一句话做游戏</span>
          </h1>
          <p className={styles.lede}>
            描述你想做的小游戏 — 玩法、节奏、情绪。AI 会给你一个可玩的雏形，
            你可以直接接着在编辑器里微调每一章、每个参数。
          </p>
        </section>

        <div className={styles.promptCard}>
          <div className={styles.promptBox}>
            <textarea
              className={styles.promptTextarea}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                "例如：做一个 30 秒的节奏小游戏，玩家要跟着鼓点点击 4 个方块，连击达到 10 次后进入狂欢模式。"
              }
            />
            <div className={styles.promptActions}>
              <span className={styles.promptHint}>
                💡 越具体，雏形越贴近你的想法
              </span>
              <button
                type="button"
                className={styles.generateBtn}
                disabled={!prompt.trim()}
              >
                ✨ 生成游戏雏形
              </button>
            </div>
          </div>
        </div>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span className={styles.sectionTitleCn}>不知道从哪开始？</span>
            <span className={styles.sectionTitleEn}>Starter ideas</span>
          </h2>
          <div className={styles.starters}>
            {STARTERS.map((s) => (
              <button
                key={s.title}
                type="button"
                className={styles.starter}
                onClick={() => useStarter(s)}
              >
                <span className={styles.starterIcon}>{s.icon}</span>
                <span className={styles.starterBody}>
                  <span className={styles.starterTitle}>{s.title}</span>
                  <span className={styles.starterDesc}>{s.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span className={styles.sectionTitleCn}>Agent 如何工作</span>
            <span className={styles.sectionTitleEn}>How it works</span>
          </h2>
          <div className={styles.flow}>
            <div className={styles.flowStep}>
              <span className={styles.flowNum}>1</span>
              <h3 className={styles.flowTitle}>描述你的想法</h3>
              <p className={styles.flowDesc}>
                玩法目标、情绪节奏、目标玩家 —
                一段自然语言就够。
              </p>
            </div>
            <div className={styles.flowStep}>
              <span className={styles.flowNum}>2</span>
              <h3 className={styles.flowTitle}>AI 生成雏形</h3>
              <p className={styles.flowDesc}>
                匹配最合适的模板，自动生成章节、关卡、分支与文案。
              </p>
            </div>
            <div className={styles.flowStep}>
              <span className={styles.flowNum}>3</span>
              <h3 className={styles.flowTitle}>编辑器接手微调</h3>
              <p className={styles.flowDesc}>
                进入 3 栏编辑器，边改参数边看效果，一键发布。
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
