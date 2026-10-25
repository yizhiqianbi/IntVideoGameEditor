import Link from "next/link";
import { TopNav } from "@/components/top-nav";
import styles from "./page.module.css";

const GAME_TEMPLATES = [
  {
    id: "text-choice",
    name: "文字选择",
    desc: "人生模拟、剧情分支类游戏",
    icon: "📖",
  },
  {
    id: "click-reaction",
    name: "点击反应",
    desc: "反应速度、连击类游戏",
    icon: "⚡",
  },
  {
    id: "memory",
    name: "记忆对标",
    desc: "记忆、翻牌、配对类游戏",
    icon: "🧠",
  },
  {
    id: "physics",
    name: "物理模拟",
    desc: "堆叠、消除、重力类游戏",
    icon: "💫",
  },
  {
    id: "puzzle",
    name: "谜题益智",
    desc: "路径、逻辑、推理类游戏",
    icon: "🎲",
  },
  {
    id: "rhythm",
    name: "节奏时序",
    desc: "节奏、时机、判定类游戏",
    icon: "🎵",
  },
];

export default function CreateGamePage() {
  return (
    <main className={styles.page}>
      <TopNav />
      <div className={styles.shell}>
        <div className={styles.header}>
          <Link href="/studio/games" className={styles.backButton}>
            ← 返回
          </Link>
          <div>
            <h1 className={styles.title}>选择游戏类型</h1>
            <p className={styles.subtitle}>每种类型都预置了最小可行的游戏骨架，你可以直接编辑内容和参数。</p>
          </div>
        </div>

        <div className={styles.templateGrid}>
          {GAME_TEMPLATES.map((template) => (
            <Link
              key={template.id}
              href={`/studio/games/create/${template.id}`}
              className={styles.templateCard}
            >
              <span className={styles.templateIcon}>{template.icon}</span>
              <h3 className={styles.templateName}>{template.name}</h3>
              <p className={styles.templateDesc}>{template.desc}</p>
              <span className={styles.templateArrow} aria-hidden>
                →
              </span>
            </Link>
          ))}
        </div>

        <section className={styles.guide}>
          <h2 className={styles.guideTitle}>编辑流程</h2>
          <ol className={styles.guideList}>
            <li>
              <span className={styles.stepNum}>1</span>
              <div className={styles.stepText}>
                <strong>选择模板</strong> — 从 6 种游戏类型选择，快速生成框架代码
              </div>
            </li>
            <li>
              <span className={styles.stepNum}>2</span>
              <div className={styles.stepText}>
                <strong>编辑参数</strong> — 设置名称、描述、时长、关卡等游戏参数
              </div>
            </li>
            <li>
              <span className={styles.stepNum}>3</span>
              <div className={styles.stepText}>
                <strong>配置内容</strong> — 编辑关卡、对话、题目等具体游戏内容
              </div>
            </li>
            <li>
              <span className={styles.stepNum}>4</span>
              <div className={styles.stepText}>
                <strong>实时预览</strong> — 右侧始终显示游戏运行效果，边编边看
              </div>
            </li>
            <li>
              <span className={styles.stepNum}>5</span>
              <div className={styles.stepText}>
                <strong>发布上线</strong> — 确认无误后一键发布到游戏大厅
              </div>
            </li>
          </ol>
        </section>
      </div>
    </main>
  );
}
