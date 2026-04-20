"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TopNav } from "@/components/top-nav";
import { HtmlSandbox } from "@/components/studio/game-editor/html-sandbox";
import {
  deleteHtmlGameDraft,
  getHtmlGameDraft,
  publishHtmlGameDraft,
  saveHtmlGameDraft,
  type HtmlGameDraft,
} from "@/lib/html-games/drafts";
import type { HtmlGameArtifact } from "@/lib/play-agent/types";
import styles from "./page.module.css";

type Phase = "idle" | "running" | "error";

export default function HtmlGameDraftPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const draftId = params?.id ?? "";

  const [draft, setDraft] = useState<HtmlGameDraft | null>(null);
  const [prompt, setPrompt] = useState("");
  const [refinePrompt, setRefinePrompt] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!draftId) return;
    const d = getHtmlGameDraft(draftId);
    if (d) {
      setDraft(d);
      setPrompt(d.prompt);
    }
    setLoaded(true);
  }, [draftId]);

  async function regenerate(useRefine: boolean) {
    if (!draft) return;
    const basePrompt = prompt.trim();
    const refine = refinePrompt.trim();
    const finalPrompt = useRefine && refine
      ? `${basePrompt}\n\n追加要求：${refine}`
      : basePrompt;
    if (!finalPrompt) return;

    setPhase("running");
    setErrorMsg("");

    try {
      const res = await fetch("/api/html-game/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: finalPrompt }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      const artifact = data.artifact as HtmlGameArtifact;
      const updated = saveHtmlGameDraft({
        id: draft.id,
        prompt: finalPrompt,
        artifact,
      });
      setDraft(updated);
      setPrompt(updated.prompt);
      setRefinePrompt("");
      setPhase("idle");
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
      setPhase("error");
    }
  }

  function publish() {
    if (!draft) return;
    const published = publishHtmlGameDraft(draft.id);
    if (published) setDraft(published);
  }

  function remove() {
    if (!draft) return;
    if (!confirm("删除这个草稿？此操作不可撤销。")) return;
    deleteHtmlGameDraft(draft.id);
    router.push("/studio");
  }

  if (!loaded) {
    return (
      <main className={styles.page}>
        <TopNav />
        <div className={styles.shell}>
          <p className={styles.loading}>载入中…</p>
        </div>
      </main>
    );
  }

  if (!draft) {
    return (
      <main className={styles.page}>
        <TopNav />
        <div className={styles.shell}>
          <div className={styles.notFound}>
            <h1>找不到草稿</h1>
            <p>这个链接可能来自别的浏览器 — 草稿仅保存在本地。</p>
            <Link href="/studio" className={styles.primaryBtn}>
              ← 返回创作中心
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <TopNav />
      <div className={styles.shell}>
        <Link href="/studio" className={styles.back}>
          ← 返回创作中心
        </Link>

        <header className={styles.head}>
          <div>
            <h1 className={styles.title}>{draft.artifact.meta.title}</h1>
            <p className={styles.meta}>
              {draft.published ? "已发布" : "草稿"} ·
              更新于 {new Date(draft.updatedAt).toLocaleString()}
            </p>
          </div>
          <div className={styles.headActions}>
            {draft.published ? (
              <Link
                href={`/play/html/${draft.slug}`}
                className={styles.ghostBtn}
                target="_blank"
              >
                打开发布版 ↗
              </Link>
            ) : null}
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={publish}
              disabled={draft.published}
            >
              {draft.published ? "✓ 已发布" : "发布到游戏大厅"}
            </button>
          </div>
        </header>

        <div className={styles.layout}>
          <section className={styles.editorCol}>
            <label className={styles.label}>当前 Prompt</label>
            <textarea
              className={styles.textarea}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
            />
            <button
              type="button"
              className={styles.regenBtn}
              onClick={() => regenerate(false)}
              disabled={phase === "running" || !prompt.trim()}
            >
              {phase === "running" ? "⏳ 重新生成中…" : "⟳ 用上面的 Prompt 重新生成"}
            </button>

            <div className={styles.divider} />

            <label className={styles.label}>追加一条修改意见</label>
            <textarea
              className={styles.textarea}
              value={refinePrompt}
              onChange={(e) => setRefinePrompt(e.target.value)}
              rows={3}
              placeholder="例：节奏再快一些，得分超过 50 后换背景色"
            />
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => regenerate(true)}
              disabled={phase === "running" || !refinePrompt.trim()}
            >
              {phase === "running" ? "⏳ 让 AI 修改中…" : "✨ 让 AI 按意见修改"}
            </button>

            {phase === "error" && (
              <div className={styles.errorBox}>
                <strong>失败：</strong> {errorMsg}
              </div>
            )}

            <div className={styles.divider} />

            <button type="button" className={styles.dangerBtn} onClick={remove}>
              删除草稿
            </button>
          </section>

          <section className={styles.previewCol}>
            <HtmlSandbox html={draft.artifact.html} />
          </section>
        </div>
      </div>
    </main>
  );
}
