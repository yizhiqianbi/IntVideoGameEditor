import Link from "next/link";
import styles from "./page.module.css";
import { TopNav } from "@/components/top-nav";
import homepageCatalogModule from "@/lib/homepage-catalog";

const { FEATURED_CASES, PRODUCT_LINES } =
  homepageCatalogModule as typeof import("@/lib/homepage-catalog");

export default function Home() {
  return (
    <main className={styles.page}>
      <TopNav />
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>Fun-X-Studio</span>
            <h1 className={styles.title}>Fun-X-Studio</h1>
            <p className={styles.subtitle}>用 AI 做可玩的故事。</p>
          </div>

          <div className={styles.productGrid}>
            {PRODUCT_LINES.map((line) =>
              line.href ? (
                <Link
                  key={line.slug}
                  href={line.href}
                  className={`${styles.productCard} ${
                    line.accent === "primary" ? styles.productCardPrimary : ""
                  }`}
                >
                  <div className={styles.productMeta}>
                    <span className={styles.productStatus}>Available</span>
                    <span className={styles.productArrow}>→</span>
                  </div>
                  <h2 className={styles.productTitle}>{line.title}</h2>
                  <p className={styles.productSubtitle}>{line.subtitle}</p>
                  <span className={styles.productAction}>立即进入</span>
                </Link>
              ) : (
                <article key={line.slug} className={styles.productCard}>
                  <div className={styles.productMeta}>
                    <span className={styles.productStatus}>Coming Soon</span>
                  </div>
                  <h2 className={styles.productTitle}>{line.title}</h2>
                  <p className={styles.productSubtitle}>{line.subtitle}</p>
                </article>
              ),
            )}
          </div>
        </div>
      </section>

      <section className={styles.featuredSection}>
        <div className={styles.featuredHeader}>
          <span className={styles.eyebrow}>Featured Cases</span>
          <h2 className={styles.featuredTitle}>精选案例</h2>
        </div>
        <div className={styles.featuredGrid}>
          {FEATURED_CASES.map((item) => (
            <article key={item.id} className={styles.featuredCard}>
              <div className={styles.featuredVisual}>
                <div className={styles.featuredGlow} />
              </div>
              <div className={styles.featuredBody}>
                <span className={styles.featuredTag}>{item.category}</span>
                <h3 className={styles.featuredCaseTitle}>{item.title}</h3>
                <p className={styles.featuredStatus}>{item.status}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
