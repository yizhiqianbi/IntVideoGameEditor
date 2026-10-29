"use client";

/* eslint-disable @next/next/no-img-element -- Local companion portraits are static UI assets. */
import { Fragment, useEffect, useRef, useState } from "react";
import { companionClockLabel, companionClockVisible } from "./companion-clock";
import { publishQwenTranscript } from "./companion-inbox";
import { useGirlfriendPhotos } from "./companion-photos";
import { STUDIO_STILL_CREDITS } from "../../../lib/xumeng-studio-still-billing";
import styles from "./companion.module.css";

type Row = { id: number; role: "user" | "assistant"; text: string; createdAt: string; model: string };

export default function QwenCompanion({ onBack, onCall, avatar = "/assets/xumeng/content-covers/sumai.jpg" }: { onBack?: () => void; onCall?: () => void; avatar?: string }) {
  const [messages, setMessages] = useState<Row[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [mediaTrayOpen, setMediaTrayOpen] = useState(false);
  const photos = useGirlfriendPhotos("xumeng-qwen-photos");
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/xumeng/companion-qwen", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "暂时连不上苏麦。");
        setMessages(body.messages || []);
        setError("");
      })
      .catch(failure => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "暂时连不上苏麦。");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending, photos.photos.length]);

  useEffect(() => {
    if (loading) return;
    publishQwenTranscript(messages.map(item => ({ id: String(item.id), role: item.role, text: item.text, createdAt: item.createdAt })));
  }, [loading, messages, photos.photos]);

  async function submit() {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError("");
    setDraft("");
    try {
      const response = await fetch("/api/xumeng/companion-qwen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "发送没有送到。");
      setMessages(body.messages || []);
    } catch (failure) {
      setDraft(content);
      setError(failure instanceof Error ? failure.message : "发送没有送到。");
    } finally {
      setSending(false);
      composer.current?.focus();
    }
  }

  return <section className={styles.chat} aria-label="与苏麦聊天">
    <header className={styles.chatHeader}>
      {onBack && <button className={styles.mobileBack} aria-label="返回聊天列表" onClick={onBack}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m14 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>}
      <div className={styles.identity}><h1>苏麦</h1><p className={styles.presence}><i aria-hidden="true" />在线</p></div>
    </header>
    <div className={styles.timeline} role="log" aria-label="聊天消息" ref={scroller}>
      {loading ? <div className={styles.empty}><span className={styles.emptyAvatar} aria-hidden="true"><img src={avatar} alt="" /></span><h2>正在找苏麦</h2><p>稍等一下。</p></div>
        : <>
          <figure className={styles.coverCard}><img src={avatar} alt="" /></figure>
          {messages.length || photos.photos.length ? [
            ...messages.map(item => ({ kind: "message" as const, id: String(item.id), at: Date.parse(item.createdAt) || 0, item })),
            ...photos.photos.map(photo => ({ kind: "photo" as const, id: photo.id, at: Date.parse(photo.createdAt) || 0, photo })),
          ].sort((left, right) => left.at - right.at || left.id.localeCompare(right.id)).map((entry, index, shown) => {
            const previous = shown[index - 1];
            const previousAt = previous ? (previous.kind === "photo" ? previous.photo.createdAt : previous.item.createdAt) : undefined;
            const createdAt = entry.kind === "photo" ? entry.photo.createdAt : entry.item.createdAt;
            const stamp = companionClockVisible(createdAt, previousAt) ? companionClockLabel(createdAt) : "";
            if (entry.kind === "photo") {
              return <Fragment key={entry.id}>
                {stamp && <p className={styles.stamp}><time dateTime={createdAt}>{stamp}</time></p>}
                <article className={`${styles.message} ${styles.hers}`} aria-label="苏麦发来的照片">
                  <span className={styles.smallAvatar} aria-hidden="true"><img src={avatar} alt="" /></span>
                  <div><figure className={styles.picture}><img src={entry.photo.url} alt="苏麦发来的照片" /></figure></div>
                </article>
              </Fragment>;
            }
            const item = entry.item;
            return <Fragment key={item.id}>
              {stamp && <p className={styles.stamp}><time dateTime={createdAt}>{stamp}</time></p>}
              <article className={`${styles.message} ${item.role === "user" ? styles.mine : styles.hers}`} aria-label={item.role === "user" ? "你的消息" : "苏麦的回复"}>
                {item.role === "assistant" && <span className={styles.smallAvatar} aria-hidden="true"><img src={avatar} alt="" /></span>}
                <div><p>{item.text}</p></div>
              </article>
            </Fragment>;
          }) : <div className={styles.empty}><h2>和苏麦说句话</h2><p>想说什么，直接说就行。</p></div>}
        </>}
      {sending && <p className={styles.thinking}>她正在回…</p>}
    </div>
    {error && <p className={styles.error} role="alert">{error}<button onClick={() => setError("")}>关闭</button></p>}
    {!loading && <div className={styles.dock}>
      <button type="button" aria-pressed={mediaTrayOpen} onClick={() => setMediaTrayOpen(value => !value)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.4" /><path d="m4 16 4.2-3.4a1 1 0 0 1 1.3.05L13 15.5l1.6-1.3a1 1 0 0 1 1.3.02L20.5 17" /></svg>
        相册
      </button>
      <button type="button" disabled={!onCall} onClick={onCall}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 10.5v3M7.5 8v8M11 5.5v13M14.5 8v8M18 10.5v3" strokeLinecap="round" /></svg>
        听听
      </button>
      <button type="button" onClick={() => scroller.current?.scrollTo({ top: 0, behavior: "smooth" })}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="8" r="3" /><path d="M5.5 19.5c1.2-3 3.5-4.5 6.5-4.5s5.3 1.5 6.5 4.5" strokeLinecap="round" /></svg>
        个人
      </button>
    </div>}
    {mediaTrayOpen && <div className={styles.mediaTray} role="status">
      <div className={styles.mediaTrayHead}><strong>相册</strong><span>按她刚才的话出一张，用封面当参考。一张 {STUDIO_STILL_CREDITS} Credit。</span></div>
      {photos.photos.length > 0 && <div className={styles.stillGrid}>{photos.photos.map(photo => <img key={photo.id} src={photo.url} alt="苏麦发来的照片" />)}</div>}
      {photos.note && <p>{photos.note}</p>}
      <div className={styles.mediaTrayActions}>
        <button type="button" disabled={photos.busy || loading} onClick={() => void photos.shoot(avatar, [...messages].reverse().find(item => item.role === "assistant")?.text || "")}>{photos.busy ? "正在出图…" : "让她发一张"}</button>
        <button type="button" onClick={() => setMediaTrayOpen(false)}>收起</button>
      </div>
    </div>}
    <form className={styles.composer} onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className={styles.composerBox}>
        <textarea ref={composer} aria-label="消息" placeholder="想说什么，就发给她…" maxLength={4000} rows={1} value={draft} disabled={loading || sending}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} />
        <button className={styles.send} type="submit" disabled={loading || sending || !draft.trim()}>发送</button>
      </div>
    </form>
  </section>;
}
