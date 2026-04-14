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
import { PlayRuntimeStage } from "./play-runtime-stage";
import styles from "./detail-page.module.css";

type DetailPageProps = {
  type: PublicContentType;
  slug: string;
};

function getRuntimeLabel(type: PublicContentType) {
  if (type === "video") return "视频播放区域";
  if (type === "film") return "互动影游运行区";
  return "小游戏运行区";
}

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
        <section className={styles.runtimeShell}>
          <div className={styles.runtimeTopBar}>
            <div className={styles.runtimeMeta}>
              <span className={styles.runtimePill}>{type === "film" ? "互动影游" : type === "play" ? "Play" : "纯视频"}</span>
              {entry.durationLabel ? (
                <span className={styles.runtimePill}>{entry.durationLabel}</span>
              ) : null}
            </div>
            <div className={styles.runtimeActions}>
              <Link href={`/${type}`} className={styles.ghostButton}>
                返回列表
              </Link>
            </div>
          </div>

          <div
            className={`${styles.runtimeStage} ${
              miniGame
                ? styles.runtimeStagePlay
                : styles[`tone${entry.coverTone[0].toUpperCase()}${entry.coverTone.slice(1)}`]
            }`}
          >
            {miniGame ? (
              <PlayRuntimeStage slug={slug} />
            ) : (
              <div className={styles.runtimeCenter}>
                <span className={styles.runtimeTitle}>{entry.title}</span>
                <span className={styles.runtimeLabel}>{getRuntimeLabel(type)}</span>
              </div>
            )}
          </div>
        </section>

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
