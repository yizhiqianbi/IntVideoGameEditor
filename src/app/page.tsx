import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>PencilStudio</p>
        <h1 className={styles.title}>PencilStudio-VideoGame</h1>
        <p className={styles.description}>
          一个面向互动影视与分支短剧创作的节点式工作台。你可以在这里管理角色、场景、镜头节点、分支过渡，以及 AI 视频生成流程。
        </p>
        <div className={styles.actions}>
          <Link href="/pencil-studio-vid" className={styles.primaryLink}>
            进入 Studio
          </Link>
          <Link href="/editor" className={styles.secondaryLink}>
            兼容入口
          </Link>
        </div>
      </section>

      <section className={styles.grid}>
        <article className={styles.card}>
          <h2 className={styles.cardTitle}>Story Graph</h2>
          <p className={styles.cardText}>
            用自上而下的剧情树管理镜头节点、选择分支和过渡条件。
          </p>
        </article>
        <article className={styles.card}>
          <h2 className={styles.cardTitle}>Assets & Presets</h2>
          <p className={styles.cardText}>
            统一维护角色参考图、场景参考图、生成素材和导出配置。
          </p>
        </article>
        <article className={styles.card}>
          <h2 className={styles.cardTitle}>AI Video Pipeline</h2>
          <p className={styles.cardText}>
            支持豆包、MiniMax、Vidu、Kling 的视频生成接入与任务轮询。
          </p>
        </article>
      </section>
    </main>
  );
}
