"use client";

import { useEffect, useMemo, useState } from "react";
import type { XumengLocale } from "@/lib/xumeng-i18n";
import {
  deleteCharacterComment,
  loadCharacterComments,
  postCharacterComment,
  postCharacterCommentReply,
  sortXumengComments,
  toggleCharacterCommentLike,
  validateCommentBody,
  XUMENG_COMMENT_MAX_LENGTH,
  XUMENG_COMMENT_TAGS,
  type XumengComment,
  type XumengCommentSort,
  type XumengCommentTagId,
} from "@/lib/xumeng-comments";
import Icon from "./icons";
import s from "./character-comments.module.css";

type CopyPack = {
  title: string;
  hot: string;
  latest: string;
  placeholder: string;
  replyPlaceholder: string;
  submit: string;
  reply: string;
  cancelReply: string;
  replyingTo: string;
  delete: string;
  empty: string;
  emptyHint: string;
  creator: string;
  mine: string;
  justNow: string;
  minsAgo: (n: number) => string;
  hoursAgo: (n: number) => string;
  daysAgo: (n: number) => string;
  tooLong: string;
  emptyError: string;
  close: string;
};

function getCopy(locale: XumengLocale): CopyPack {
  if (locale === "en") {
    return {
      title: "Player comments",
      hot: "Top",
      latest: "Newest",
      placeholder: "Share your thoughts, favorite opening, or roleplay tips…",
      replyPlaceholder: "Write a reply…",
      submit: "Post",
      reply: "Reply",
      cancelReply: "Cancel",
      replyingTo: "Replying to",
      delete: "Delete",
      empty: "No comments yet",
      emptyHint: "Be the first player to share an impression.",
      creator: "Creator",
      mine: "You",
      justNow: "Just now",
      minsAgo: (n) => `${n}m ago`,
      hoursAgo: (n) => `${n}h ago`,
      daysAgo: (n) => `${n}d ago`,
      tooLong: `Up to ${XUMENG_COMMENT_MAX_LENGTH} characters.`,
      emptyError: "Write something before posting.",
      close: "Close comments",
    };
  }
  return {
    title: "玩家评论区",
    hot: "最热",
    latest: "最新",
    placeholder: "分享你的游玩感受、推荐玩法或剧情彩蛋…",
    replyPlaceholder: "写下你的回复…",
    submit: "发布评论",
    reply: "回复",
    cancelReply: "取消",
    replyingTo: "回复",
    delete: "删除",
    empty: "还没有评论",
    emptyHint: "来做第一位分享体验的玩家吧。",
    creator: "作者",
    mine: "我",
    justNow: "刚刚",
    minsAgo: (n) => `${n} 分钟前`,
    hoursAgo: (n) => `${n} 小时前`,
    daysAgo: (n) => `${n} 天前`,
    tooLong: `最多输入 ${XUMENG_COMMENT_MAX_LENGTH} 字。`,
    emptyError: "先写点内容再发布吧。",
    close: "关闭评论区",
  };
}

function tagLabel(id: XumengCommentTagId, locale: XumengLocale): string {
  const item = XUMENG_COMMENT_TAGS.find((t) => t.id === id);
  if (!item) return id;
  if (locale === "en") return item.en;
  if (locale === "zh-Hant") return item.zhHant;
  if (locale === "ja") return item.ja;
  if (locale === "ko") return item.ko;
  return item.zhHans;
}

function formatRelative(ts: number, copy: CopyPack): string {
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return copy.justNow;
  if (mins < 60) return copy.minsAgo(mins);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return copy.hoursAgo(hours);
  return copy.daysAgo(Math.floor(hours / 24));
}

export interface CharacterCommentsProps {
  characterId: string;
  characterName: string;
  viewerId: string;
  viewerName: string;
  isCreator?: boolean;
  locale?: XumengLocale;
  variant?: "inline" | "drawer";
  onClose?: () => void;
  onCountChange?: (count: number) => void;
}

export default function CharacterComments({
  characterId,
  characterName,
  viewerId,
  viewerName,
  isCreator = false,
  locale = "zh-Hans",
  variant = "inline",
  onClose,
  onCountChange,
}: CharacterCommentsProps) {
  const copy = useMemo(() => getCopy(locale), [locale]);
  const [comments, setComments] = useState<XumengComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<XumengCommentSort>("hot");
  const [draft, setDraft] = useState("");
  const [selectedTags, setSelectedTags] = useState<XumengCommentTagId[]>([]);
  const [replyTarget, setReplyTarget] = useState<{ id: string; authorName: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void loadCharacterComments(characterId, characterName).then((list) => {
      if (!alive) return;
      setComments(list);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [characterId, characterName]);

  const totalCount = useMemo(
    () => comments.reduce((acc, item) => acc + 1 + item.replies.length, 0),
    [comments],
  );

  useEffect(() => {
    onCountChange?.(totalCount);
  }, [totalCount, onCountChange]);

  const sorted = useMemo(() => sortXumengComments(comments, sort), [comments, sort]);

  function toggleTag(id: XumengCommentTagId) {
    setSelectedTags((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : prev.length >= 2 ? [...prev.slice(1), id] : [...prev, id],
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const check = validateCommentBody(draft);
    if (!check.ok) {
      setError(check.reason === "too_long" ? copy.tooLong : copy.emptyError);
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      if (replyTarget) {
        const next = await postCharacterCommentReply(
          characterId,
          replyTarget.id,
          { authorId: viewerId, authorName: viewerName || "玩家", isCreator, body: check.text },
          comments,
        );
        setComments(next);
        setReplyTarget(null);
      } else {
        const next = await postCharacterComment(
          characterId,
          { authorId: viewerId, authorName: viewerName || "玩家", isCreator, body: check.text, tags: selectedTags },
          comments,
        );
        setComments(next);
        setSort("latest");
        setSelectedTags([]);
      }
      setDraft("");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLike(commentId: string) {
    const next = await toggleCharacterCommentLike(characterId, commentId, viewerId, comments);
    setComments(next);
  }

  async function handleDelete(commentId: string) {
    const next = await deleteCharacterComment(characterId, commentId, viewerId, comments);
    setComments(next);
  }

  const content = (
    <section
      className={`${s.root} ${variant === "drawer" ? s.drawerPanel : s.inlinePanel}`}
      aria-label={copy.title}
    >
      <header className={s.header}>
        <div className={s.titleGroup}>
          <Icon name="chat" size={17} />
          <h2>{copy.title}</h2>
          <span className={s.countBadge}>{totalCount}</span>
        </div>
        <div className={s.headerRight}>
          <div className={s.sortTabs} role="tablist" aria-label={copy.title}>
            <button
              type="button"
              role="tab"
              aria-selected={sort === "hot"}
              className={sort === "hot" ? s.sortActive : ""}
              onClick={() => setSort("hot")}
            >
              {copy.hot}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sort === "latest"}
              className={sort === "latest" ? s.sortActive : ""}
              onClick={() => setSort("latest")}
            >
              {copy.latest}
            </button>
          </div>
          {variant === "drawer" && onClose && (
            <button type="button" className={s.closeBtn} aria-label={copy.close} onClick={onClose}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </header>

      <form className={s.composer} onSubmit={(e) => void handleSubmit(e)}>
        {replyTarget ? (
          <div className={s.replyBanner}>
            <span>
              {copy.replyingTo} <strong>@{replyTarget.authorName}</strong>
            </span>
            <button type="button" onClick={() => setReplyTarget(null)}>
              {copy.cancelReply}
            </button>
          </div>
        ) : (
          <div className={s.tagRow} aria-label="印象标签">
            {XUMENG_COMMENT_TAGS.map((tag) => {
              const active = selectedTags.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={active}
                  className={`${s.tagChip} ${active ? s.tagChipActive : ""}`}
                  onClick={() => toggleTag(tag.id)}
                >
                  #{tagLabel(tag.id, locale)}
                </button>
              );
            })}
          </div>
        )}
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError("");
          }}
          placeholder={replyTarget ? copy.replyPlaceholder : copy.placeholder}
          maxLength={XUMENG_COMMENT_MAX_LENGTH}
          rows={2}
          aria-label={replyTarget ? copy.replyPlaceholder : copy.placeholder}
        />
        <div className={s.composerFooter}>
          <span className={s.charCount}>
            {draft.trim().length}/{XUMENG_COMMENT_MAX_LENGTH}
          </span>
          {error && <span className={s.errorText} role="alert">{error}</span>}
          <button type="submit" className={s.submitBtn} disabled={submitting || !draft.trim()}>
            <Icon name="send" size={13} />
            {copy.submit}
          </button>
        </div>
      </form>

      <div className={s.list}>
        {loading ? (
          <div className={s.emptyState}>…</div>
        ) : sorted.length === 0 ? (
          <div className={s.emptyState}>
            <strong>{copy.empty}</strong>
            <p>{copy.emptyHint}</p>
          </div>
        ) : (
          sorted.map((item) => {
            const liked = item.likedBy.includes(viewerId);
            const isMine = item.authorId === viewerId;
            return (
              <article key={item.id} className={s.commentCard}>
                <div className={s.avatar} aria-hidden="true">
                  {(item.authorName || "玩").slice(0, 1).toUpperCase()}
                </div>
                <div className={s.cardBody}>
                  <div className={s.cardMeta}>
                    <strong>{item.authorName}</strong>
                    {item.isCreator && <span className={s.roleBadge}>{copy.creator}</span>}
                    {isMine && <span className={s.mineBadge}>{copy.mine}</span>}
                    <time>{formatRelative(item.createdAt, copy)}</time>
                  </div>
                  {item.tags && item.tags.length > 0 && (
                    <div className={s.itemTags}>
                      {item.tags.map((t) => (
                        <span key={t}>#{tagLabel(t, locale)}</span>
                      ))}
                    </div>
                  )}
                  <p className={s.bodyText}>{item.body}</p>
                  <div className={s.actions}>
                    <button
                      type="button"
                      className={`${s.actionBtn} ${liked ? s.liked : ""}`}
                      aria-pressed={liked}
                      onClick={() => void handleLike(item.id)}
                    >
                      <Icon name="heart" size={13} />
                      <span>{item.likes}</span>
                    </button>
                    <button
                      type="button"
                      className={s.actionBtn}
                      onClick={() => setReplyTarget({ id: item.id, authorName: item.authorName })}
                    >
                      <Icon name="chat" size={13} />
                      <span>{copy.reply}</span>
                    </button>
                    {isMine && (
                      <button
                        type="button"
                        className={`${s.actionBtn} ${s.deleteBtn}`}
                        onClick={() => void handleDelete(item.id)}
                      >
                        <Icon name="trash" size={12} />
                        <span>{copy.delete}</span>
                      </button>
                    )}
                  </div>

                  {item.replies.length > 0 && (
                    <div className={s.replies}>
                      {item.replies.map((rep) => {
                        const repMine = rep.authorId === viewerId;
                        return (
                          <div key={rep.id} className={s.replyItem}>
                            <div className={s.replyMeta}>
                              <strong>{rep.authorName}</strong>
                              {rep.isCreator && <span className={s.roleBadge}>{copy.creator}</span>}
                              {repMine && <span className={s.mineBadge}>{copy.mine}</span>}
                              <time>{formatRelative(rep.createdAt, copy)}</time>
                              {repMine && (
                                <button
                                  type="button"
                                  className={s.replyDelete}
                                  onClick={() => void handleDelete(rep.id)}
                                >
                                  {copy.delete}
                                </button>
                              )}
                            </div>
                            <p>{rep.body}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );

  if (variant === "drawer") {
    return (
      <div className={s.drawerBackdrop} role="presentation" onClick={onClose}>
        <div className={s.drawerHost} role="dialog" aria-modal="true" aria-label={copy.title} onClick={(e) => e.stopPropagation()}>
          {content}
        </div>
      </div>
    );
  }
  return content;
}
