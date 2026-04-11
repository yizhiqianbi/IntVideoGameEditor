import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <div className={styles.center}>
        <h1 className={styles.title}>Pencil Studio</h1>
        <p className={styles.subtitle}>Create interactive experiences with AI</p>

        <div className={styles.cards}>
          <Link href="/projects" className={styles.card}>
            <div className={styles.icon}>🎮</div>
            <h2 className={styles.cardTitle}>互动影游戏</h2>
            <p className={styles.cardDesc}>进入项目库，管理你的角色、场景、剧情树和互动导出</p>
            <span className={styles.arrow}>→</span>
          </Link>

          <Link href="/projects" className={styles.card}>
            <div className={styles.icon}>🎬</div>
            <h2 className={styles.cardTitle}>视频</h2>
            <p className={styles.cardDesc}>从项目出发，生成视频、管理素材，并导出可玩的互动交付</p>
            <span className={styles.arrow}>→</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
