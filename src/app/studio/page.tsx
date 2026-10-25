"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TopNav } from "@/components/top-nav";
import {
  deleteHtmlGameDraft,
  listHtmlGameDrafts,
  type HtmlGameDraft,
} from "@/lib/html-games/drafts";
import { listProjects, type ProjectSummary } from "@/lib/projects";
import { setStoredActiveProjectId } from "@/lib/project-session";
import styles from "./page.module.css";

function formatTime(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function StudioHubPage() {
  const router = useRouter();
  const [films, setFilms] = useState<ProjectSummary[]>([]);
  const [games, setGames] = useState<HtmlGameDraft[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [f, g] = await Promise.all([
          listProjects(),
          Promise.resolve(listHtmlGameDrafts()),
        ]);
        setFilms(f);
        setGames(g);
      } finally {
        setLoaded(true);
      }
    }
    void load();
  }, []);

  function openFilm(id: string) {
    setStoredActiveProjectId(id);
    router.push(`/pencil-studio-vid?project=${id}`);
  }

  function removeGame(id: string) {
    if (!confirm("删除这个游戏草稿？此操作不可撤销。")) return;
    deleteHtmlGameDraft(id);
    setGames(listHtmlGameDrafts());
  }

  const hasAnyWork = films.length + games.length > 0;

  return (
    <main className={styles.page}>
      <TopNav />
      <div className={styles.shell}>
        <section className={styles.hero}>
          <span className={styles.eyebrow}>
            <span className={styles.pulse} /> Studio · 创作中心
          </span>
          <h1 className={styles.title}>
            <span className={styles.titleEn}>Create</span>
            <span className={styles.titleCn}>一个入口，两种创作</span>
          </h1>
          <p className={styles.lede}>
            做一部分支叙事的<strong>互动影游</strong>，或用一句话让 AI 造一个<strong>点开就玩的 H5 小游戏</strong>。
            你的所有作品都保存在这里。
          </p>
        </section>

        <section className={styles.ctaRow}>
          <Link href="/studio/games/agent" className={styles.ctaCard}>
            <span className={styles.ctaIcon}>✨</span>
            <div className={styles.ctaBody}>
              <span className={styles.ctaKicker}>Prompt → HTML</span>
              <h2 className={styles.ctaTitle}>AI 一句话做游戏</h2>
              <p className={styles.ctaDesc}>
                描述你的玩法，AI 直接生成一个可玩、可改、可发布的 H5 小游戏。
              </p>
              <span className={styles.ctaArrow}>开始 →</span>
            </div>
          </Link>

          <Link href="/projects?new=1" className={styles.ctaCard}>
            <span className={styles.ctaIcon}>🎬</span>
            <div className={styles.ctaBody}>
              <span className={styles.ctaKicker}>Branching Narrative</span>
              <h2 className={styles.ctaTitle}>做一部互动影游</h2>
              <p className={styles.ctaDesc}>
                节点编辑、角色设定、分支叙事 — 把你的故事做成一部可以玩的影片。
              </p>
              <span className={styles.ctaArrow}>开始 →</span>
            </div>
          </Link>
        </section>

        {!loaded ? (
          <div className={styles.placeholder}>⏳ 载入中…</div>
        ) : !hasAnyWork ? (
          <div className={styles.placeholder}>
            <span className={styles.placeholderIcon}>🎨</span>
            <p>还没有作品 — 从上面的两个入口开始你的第一个创作。</p>
          </div>
        ) : (
          <>
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>
                  <span className={styles.sectionTitleCn}>我的游戏</span>
                  <span className={styles.sectionTitleEn}>H5 Games</span>
                </h2>
                <span className={styles.count}>{games.length} 款</span>
              </div>
              {games.length === 0 ? (
                <div className={styles.empty}>
                  <span className={styles.emptyIcon}>🎮</span>
                  <p>还没有 H5 游戏</p>
                  <Link href="/studio/games/agent" className={styles.emptyLink}>
                    ✨ 用 AI 生成第一个 →
                  </Link>
                </div>
              ) : (
                <div className={styles.grid}>
                  {games.map((g) => (
                    <article key={g.id} className={styles.card}>
                      <div className={styles.cardKind}>H5 · HTML</div>
                      <h3 className={styles.cardTitle}>{g.artifact.meta.title}</h3>
                      <p className={styles.cardDesc}>
                        {g.artifact.meta.description || g.prompt}
                      </p>
                      <div className={styles.cardFooter}>
                        <span className={styles.cardMeta}>
                          {g.published ? "已发布" : "草稿"} · {formatTime(g.updatedAt)}
                        </span>
                        <div className={styles.cardActions}>
                          {g.published ? (
                            <Link
                              href={`/play/html/${g.slug}`}
                              className={styles.cardBtnGhost}
                              target="_blank"
                            >
                              打开
                            </Link>
                          ) : null}
                          <Link
                            href={`/studio/games/draft/${g.id}`}
                            className={styles.cardBtn}
                          >
                            编辑
                          </Link>
                          <button
                            type="button"
                            className={styles.cardBtnDanger}
                            onClick={() => removeGame(g.id)}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>
                  <span className={styles.sectionTitleCn}>我的影游项目</span>
                  <span className={styles.sectionTitleEn}>Film Projects</span>
                </h2>
                <span className={styles.count}>{films.length} 个</span>
              </div>
              {films.length === 0 ? (
                <div className={styles.empty}>
                  <span className={styles.emptyIcon}>🎬</span>
                  <p>还没有影游项目</p>
                  <Link href="/projects?new=1" className={styles.emptyLink}>
                    🎬 创建第一个 →
                  </Link>
                </div>
              ) : (
                <div className={styles.grid}>
                  {films.map((p) => (
                    <article key={p.id} className={styles.card}>
                      <div className={styles.cardKind}>Film · 分支叙事</div>
                      <h3 className={styles.cardTitle}>{p.name}</h3>
                      <p className={styles.cardDesc}>
                        {p.description || "分支叙事互动影游。"}
                      </p>
                      <div className={styles.chipRow}>
                        <span className={styles.chip}>{p.stats.nodeCount} 节点</span>
                        <span className={styles.chip}>{p.stats.sceneCount} 场景</span>
                        <span className={styles.chip}>{p.stats.characterCount} 角色</span>
                      </div>
                      <div className={styles.cardFooter}>
                        <span className={styles.cardMeta}>
                          {formatTime(p.lastOpenedAt)}
                        </span>
                        <div className={styles.cardActions}>
                          <button
                            type="button"
                            className={styles.cardBtn}
                            onClick={() => openFilm(p.id)}
                          >
                            继续
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              <Link href="/projects" className={styles.allLink}>
                查看全部影游项目 →
              </Link>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
