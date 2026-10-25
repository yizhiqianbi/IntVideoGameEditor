import Link from "next/link";
import { TopNav } from "@/components/top-nav";
import styles from "./page.module.css";

export default function GamesStudioPage() {
  return (
    <main className={styles.page}>
      <TopNav />
      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.copy}>
            <h1 className={styles.title}>
              <span className={styles.titleEn}>Game Studio</span>
              <span className={styles.titleCn}>游戏创作间</span>
            </h1>
            <p className={styles.lede}>
              点开就玩的小游戏不只是作品，更是一种编辑交互的美学。
              在这里，你可以从零开始设计任何一款快乐机器。
            </p>
          </div>
          <div className={styles.ctaRow}>
            <Link href="/studio/games/agent" className={styles.ctaButton}>
              ✨ AI 一句话生成
            </Link>
            <Link href="/studio/games/create" className={styles.ctaButtonGhost}>
              从模板开始 →
            </Link>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>
              <span className={styles.sectionTitleCn}>我的游戏</span>
              <span className={styles.sectionTitleEn}>My Games</span>
            </h2>
            <span className={styles.count}>0 款</span>
          </div>
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>🎮</span>
            <p className={styles.emptyText}>还没有创作任何游戏</p>
            <p className={styles.emptyHint}>点击"开始创作"来设计你的第一款游戏</p>
          </div>
        </section>
      </div>
    </main>
  );
}
