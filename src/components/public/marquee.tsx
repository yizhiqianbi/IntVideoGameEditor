import styles from "./marquee.module.css";

type MarqueeProps = {
  items: string[];
  tone?: "dark" | "paper" | "accent";
};

export function Marquee({ items, tone = "dark" }: MarqueeProps) {
  const doubled = [...items, ...items, ...items, ...items];

  return (
    <div className={`${styles.root} ${styles[`tone-${tone}`]}`}>
      <div className={styles.track}>
        {doubled.map((item, i) => (
          <span key={i} className={styles.item}>
            <span className={styles.dot} aria-hidden>
              ◆
            </span>
            <span>{item}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
