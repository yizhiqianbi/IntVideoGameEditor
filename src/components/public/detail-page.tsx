import Link from "next/link";
import { notFound } from "next/navigation";
import { TopNav } from "@/components/top-nav";
import {
  getEntriesByType,
  getPublicEntryBySlug,
  type PublicContentType,
} from "@/lib/public-catalog";
import { ContentCard } from "./content-card";
import { getMiniGameBySlug } from "./minigames/registry";
import { RuntimeStageShell } from "./runtime-stage-shell";
import styles from "./detail-page.module.css";

type DetailPageProps = {
  type: PublicContentType;
  slug: string;
};

export function DetailPage({ type, slug }: DetailPageProps) {
  const entry = getPublicEntryBySlug(type, slug);

  if (!entry) {
    notFound();
  }

  const relatedEntries = getEntriesByType(type)
    .filter((item) => item.slug !== slug)
    .slice(0, 3);
  const miniGame = type === "play" ? getMiniGameBySlug(slug) : null;

  return (
    <main className={styles.page}>
      <TopNav />
      <div className={styles.shell}>
        <div className={styles.runtimeActions}>
          <Link href={`/${type}`} className={styles.ghostButton}>
            返回列表
          </Link>
        </div>

        <RuntimeStageShell
          entry={entry}
          type={type}
          slug={slug}
          isMiniGame={Boolean(miniGame)}
        />

        <section className={styles.relatedSection}>
          <div className={styles.relatedHeader}>
            <h2 className={styles.relatedTitle}>继续浏览</h2>
          </div>
          <div className={styles.relatedGrid}>
            {relatedEntries.map((relatedEntry) => (
              <ContentCard
                key={relatedEntry.id}
                entry={relatedEntry}
                href={`/${relatedEntry.type}/${relatedEntry.slug}`}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
