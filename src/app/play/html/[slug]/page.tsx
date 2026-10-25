"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { HtmlSandbox } from "@/components/studio/game-editor/html-sandbox";
import {
  getHtmlGameDraftBySlug,
  type HtmlGameDraft,
} from "@/lib/html-games/drafts";
import styles from "./page.module.css";

export default function PlayHtmlGamePage() {
  const params = useParams<{ slug: string }>();
  const rawSlug = params?.slug ?? "";
  const slug = (() => {
    try {
      return decodeURIComponent(rawSlug);
    } catch {
      return rawSlug;
    }
  })();

  const [draft, setDraft] = useState<HtmlGameDraft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [score, setScore] = useState<number | null>(null);

  useEffect(() => {
    if (!slug) return;
    setDraft(getHtmlGameDraftBySlug(slug));
    setLoaded(true);
  }, [slug]);

  if (!loaded) {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>载入中…</p>
      </main>
    );
  }

  if (!draft) {
    return (
      <main className={styles.page}>
        <div className={styles.notFound}>
          <h1>找不到这个游戏</h1>
          <p>草稿与发布版本仅保存在本地浏览器 — 换浏览器或换设备都会失效。</p>
          <Link href="/studio" className={styles.link}>
            ← 返回创作中心
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <Link href="/studio" className={styles.back}>
          ← 创作中心
        </Link>
        <div className={styles.titleWrap}>
          <h1 className={styles.title}>{draft.artifact.meta.title}</h1>
          {draft.artifact.meta.description ? (
            <p className={styles.desc}>{draft.artifact.meta.description}</p>
          ) : null}
        </div>
        <div className={styles.rightSlot}>
          {score != null ? (
            <span className={styles.scoreBadge}>上一局 {score} 分</span>
          ) : null}
        </div>
      </header>

      <div className={styles.stage}>
        <HtmlSandbox
          html={draft.artifact.html}
          onFinish={(p) => {
            if (typeof p.score === "number") setScore(p.score);
          }}
        />
      </div>
    </main>
  );
}
