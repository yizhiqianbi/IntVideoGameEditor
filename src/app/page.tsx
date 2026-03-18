import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <div className={styles.center}>
        <h1 className={styles.title}>Pencil Studio</h1>
        <p className={styles.subtitle}>Create interactive experiences with AI</p>

        <div className={styles.cards}>
          <Link href="/pencil-studio-vid" className={styles.card}>
            <div className={styles.icon}>🎮</div>
            <h2 className={styles.cardTitle}>Build Game</h2>
            <p className={styles.cardDesc}>Design branching storylines, characters, and scenes on an intuitive canvas</p>
            <span className={styles.arrow}>→</span>
          </Link>

          <Link href="/pencil-studio-vid" className={styles.card}>
            <div className={styles.icon}>🎬</div>
            <h2 className={styles.cardTitle}>Build Interactive Video Game</h2>
            <p className={styles.cardDesc}>Generate AI videos and export playable interactive experiences</p>
            <span className={styles.arrow}>→</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
