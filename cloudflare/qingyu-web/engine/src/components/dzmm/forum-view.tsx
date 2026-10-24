"use client";

/* eslint-disable @next/next/no-img-element -- Shared component runs in the Vite frontend and uses local cover assets. */

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { Character } from "../../lib/dzmm-characters";
import { appendDzmmForumPage, nextDzmmForumOffset, retainAcknowledgedForumPost, captureAcknowledgedForumRevisions, retainAcknowledgedForumPosts } from "../../lib/dzmm-forum-pagination";
import { xumengImageUrl } from "../../lib/xumeng-routes";
import {
  DZMM_FORUM_CATEGORIES, DzmmForumEditConflictError, dzmmForumDemoSourceLabel, fetchDzmmForumPosts, fetchDzmmForumPost, saveDzmmForumPost,
  deleteDzmmForumPost, replyDzmmForumPost, deleteDzmmForumReply, voteDzmmForumPost,
  reportDzmmForumPost, fetchDzmmForumReports, reviewDzmmForumReport,
  type DzmmForumPost, type DzmmForumReply, type DzmmForumDetail, type DzmmForumDraft,
  type DzmmForumCategory, type DzmmForumReport, type DzmmForumAuthor,
} from "../../lib/dzmm-forum";
import { useDzmmForumDrafts } from "./use-forum-drafts";
import { acknowledgeDzmmForumEditor, acknowledgeDzmmForumReply, dzmmForumEditorDraftKey, rebaseDzmmForumEditor, prepareDzmmForumCreate, submittedDzmmForumCreate, adoptDzmmForumCreatedPost, type DzmmForumEditorDraft } from "../../lib/dzmm-forum-drafts";
import Icon from "./icons";
import { CommunityGuidelinesLink } from "./community-guidelines";
import styles from "./forum-view.module.css";

type Props = {
  userId?: string; isGuest: boolean; isSuper?: boolean; nickname: string; postId?: string;
  onPostChange: (id: string | null) => void; onRequireAccount: () => void;
  characters: Character[]; onCharacter: (character: Character) => void; initialQuery?: string;
};
type Editor = { id?: string; title: string; body: string; category: DzmmForumCategory; tagsText: string };
type PageRequest = { epoch: number; postId?: string; offset: number; cursor?: string; postRevision: number; listRevisions: ReadonlyMap<string, number> };
type ListPosition = { key: string; postId: string; top: number };
const categoryName = (id: string) => DZMM_FORUM_CATEGORIES.find((item) => item.id === id)?.name ?? "最新";
const date = (value: number) => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const message = (error: unknown) => error instanceof Error ? error.message : "操作失败，请稍后重试。";

export default function ForumView({ userId, isGuest, isSuper = false, nickname, postId, onPostChange, onRequireAccount, characters, onCharacter, initialQuery = "" }: Props) {
  const root = useRef<HTMLElement | null>(null);
  const { drafts, setDrafts, warning: draftWarning, exportDrafts, canLeave } = useDzmmForumDrafts(userId ?? null, root);
  const [view, setView] = useState<"topics" | "works">("topics");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState(initialQuery);
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [tag, setTag] = useState("");
  const [posts, setPosts] = useState<DzmmForumPost[]>([]);
  const [popularTags, setPopularTags] = useState<{ tag: string; count: number }[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [detail, setDetail] = useState<DzmmForumDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [editorKey, setEditorKey] = useState<string | null>(null);
  const editorKeyRef = useRef(editorKey);
  editorKeyRef.current = editorKey;
  const [comparison, setComparison] = useState<{ key: string; post: DzmmForumPost } | null>(null);
  const [createdPost, setCreatedPost] = useState<{ requestId: string; post: DzmmForumPost } | null>(null);
  const storedEditor = editorKey ? drafts.editors[editorKey] : undefined;
  const editor: (Editor & DzmmForumEditorDraft) | null = storedEditor ? { ...storedEditor, ...(editorKey?.startsWith("edit:") ? { id: editorKey.slice(5) } : {}) } : null;
  const editorNeedsReview = Boolean(editor?.id && (editor.baseUpdatedAt === undefined || comparison?.key === editorKey));
  const replyDrafts = drafts.replies;
  const updateEditor = (patch: Partial<Editor>) => { if (!editorKey) return; setDrafts(previous => { const current = previous.editors[editorKey]; return current ? { ...previous, editors: { ...previous.editors, [editorKey]: { ...current, ...patch, revision: crypto.randomUUID() } } } : previous; }); };
  const reply = postId ? replyDrafts[postId]?.text ?? "" : "";
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{ type: "post" | "reply" | "draft"; id: string } | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [showReports, setShowReports] = useState(false);
  const [reports, setReports] = useState<DzmmForumReport[]>([]);
  const [reportsTotal, setReportsTotal] = useState(0);
  const [reportsMore, setReportsMore] = useState(false);
  const listKey = JSON.stringify([userId ?? null, isSuper, category, query, tag, revision]);
  const loadedListKey = useRef<string | null>(null);
  const nextListOffset = useRef(0);
  const nextReplyOffset = useRef(0);
  const nextListCursor = useRef<string | null | undefined>(undefined);
  const nextReplyCursor = useRef<string | null | undefined>(undefined);
  const acknowledgedPosts = useRef(new Map<string, { revision: number; post: DzmmForumPost }>());
  const listPosition = useRef<ListPosition | null>(null);
  const restoredListEpoch = useRef(-1);
  const pendingPage = useRef<PageRequest | null>(null);
  const failedPage = useRef<PageRequest | null>(null);
  const epoch = useRef(0);
  const account = useRef(userId);
  const accountRevision = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { const revision = accountRevision; mounted.current = true; return () => { mounted.current = false; revision.current++; }; }, []);
  const activePost = useRef(postId);
  useEffect(() => { activePost.current = postId; setNotice(""); }, [postId]);

  useLayoutEffect(() => {
    account.current = userId;
    accountRevision.current++;
    acknowledgedPosts.current.clear();
    setEditorKey(null); setComparison(null); setCreatedPost(null); setConfirmation(null); setReporting(null); setShowReports(false); setReports([]); setReportsTotal(0); setReportsMore(false); setNotice(""); setBusy(false);
  }, [userId, isSuper, isGuest]);
  useEffect(() => { setQuery(initialQuery); setQueryInput(initialQuery); }, [initialQuery]);
  useEffect(() => {
    const requestEpoch = ++epoch.current;
    let active = true;
    pendingPage.current = null; failedPage.current = null;
    setLoading(true); setError(""); setLoadingMore(false);
    setDetail(null);
    nextReplyOffset.current = 0;
    nextReplyCursor.current = undefined;
    // Detail navigation does not replace the successfully loaded list. A new
    // filter/account/revision invalidates it even while a detail is displayed.
    if (loadedListKey.current !== listKey) {
      loadedListKey.current = null; listPosition.current = null;
      nextListOffset.current = 0;
      nextListCursor.current = undefined;
      setPosts([]); setTotal(0); setHasMore(false); setPopularTags([]);
    }
    if (!userId || view === "works") { setLoading(false); return; }
    if (!postId && loadedListKey.current === listKey) { setLoading(false); return; }
    const postRevision = postId ? acknowledgedPosts.current.get(postId)?.revision ?? 0 : 0;
    const listRevisions = captureAcknowledgedForumRevisions(acknowledgedPosts.current);
    const request = postId ? fetchDzmmForumPost(postId, 0, "") : fetchDzmmForumPosts({ category, q: query, tag, cursor: "" });
    void request.then((result) => {
      if (!active || epoch.current !== requestEpoch) return;
      if ("post" in result) {
        nextReplyOffset.current = nextDzmmForumOffset(result.offset, result.replies);
        nextReplyCursor.current = result.nextCursor;
        setDetail({ ...result, post: retainAcknowledgedForumPost(result.post, acknowledgedPosts.current.get(result.post.id), postRevision), replies: appendDzmmForumPage([], result.replies) });
      } else {
        loadedListKey.current = listKey; nextListOffset.current = nextDzmmForumOffset(result.offset, result.posts);
        nextListCursor.current = result.nextCursor;
        setPosts(() => appendDzmmForumPage([], retainAcknowledgedForumPosts(result.posts, acknowledgedPosts.current, listRevisions)));
        setTotal(result.total); setHasMore(result.hasMore); setPopularTags(result.popularTags);
      }
    }).catch((failure) => { if (active && epoch.current === requestEpoch) setError(message(failure)); })
      .finally(() => { if (active && epoch.current === requestEpoch) setLoading(false); });
    return () => { active = false; };
  }, [category, query, tag, postId, revision, userId, isSuper, view, listKey]);

  useEffect(() => {
    const position = listPosition.current, requestEpoch = epoch.current;
    if (loading || postId || view !== "topics" || showReports || !position || position.key !== listKey
      || loadedListKey.current !== listKey || restoredListEpoch.current === requestEpoch) return;
    const frame = requestAnimationFrame(() => {
      if (!mounted.current || epoch.current !== requestEpoch || listPosition.current !== position) return;
      const title = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("button[data-forum-post-id]") ?? [])
        .find(button => button.dataset.forumPostId === position.postId);
      if (!title) return;
      const distance = title.getBoundingClientRect().top - position.top;
      let scrollParent = title.parentElement;
      while (scrollParent && scrollParent !== document.body) {
        if (/auto|scroll|overlay/.test(getComputedStyle(scrollParent).overflowY) && scrollParent.scrollHeight > scrollParent.clientHeight) {
          scrollParent.scrollTop += distance; break;
        }
        scrollParent = scrollParent.parentElement;
      }
      if (!scrollParent || scrollParent === document.body) window.scrollBy({ top: distance, behavior: "instant" });
      restoredListEpoch.current = requestEpoch;
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, postId, view, showReports, listKey]);

  const openPost = (id: string, title: HTMLButtonElement) => {
    listPosition.current = { key: listKey, postId: id, top: title.getBoundingClientRect().top };
    onPostChange(id);
  };

  const refresh = () => setRevision((value) => value + 1);
  const registered = () => { if (!userId || isGuest) { onRequireAccount(); return false; } return true; };
  const openEditor = (post?: DzmmForumPost) => {
    if (busy || !registered()) return;
    failedPage.current = null;
    setError(""); setNotice("");
    const key = dzmmForumEditorDraftKey(post?.id);
    const cached = drafts.editors[key];
    setCreatedPost(null);
    setComparison(post && cached && cached.baseUpdatedAt !== post.updatedAt ? { key, post } : null);
    setDrafts(previous => previous.editors[key] ? previous : { ...previous, editors: { ...previous.editors, [key]: {
      title: post?.title ?? "", body: post?.body ?? "", category: post?.category ?? (category || "characters") as DzmmForumCategory,
      tagsText: post?.tags.join("，") ?? "", revision: crypto.randomUUID(), ...(post ? { baseUpdatedAt: post.updatedAt } : {}) } } });
    setEditorKey(key);
  };
  const run = async (operation: () => Promise<void>, isCurrent: () => boolean = () => true) => {
    if (busy) return;
    const owner = userId;
    const session = accountRevision.current;
    failedPage.current = null;
    setBusy(true); setError(""); setNotice("");
    try { await operation(); }
    catch (failure) { if (account.current === owner && accountRevision.current === session && isCurrent()) setError(message(failure)); }
    finally { if (account.current === owner && accountRevision.current === session) setBusy(false); }
  };
  const submitPost = (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || !editor || !registered()) return;
    if (editorNeedsReview) { setError("当前草稿已保留，请先对照最新主题，再继续编辑保存。"); return; }
    if (!editor.id && createdPost && createdPost.requestId === editor.createIntent?.requestId) return;
    const prepared = editor.id ? editor : prepareDzmmForumCreate(editor);
    const submitted = editor.id ? editor : submittedDzmmForumCreate(prepared);
    const draft: DzmmForumDraft = { title: submitted.title.trim(), body: submitted.body.trim(), category: submitted.category,
      tags: [...new Set(submitted.tagsText.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean))],
      ...(editor.id ? { baseUpdatedAt: editor.baseUpdatedAt } : { requestId: prepared.createIntent!.requestId, accountId: userId }) };
    if (!draft.title || !draft.body) { setError("请填写标题和正文。"); return; }
    if (draft.tags.length > 10 || draft.tags.some((value) => value.length > 40)) { setError("最多添加 10 个标签，每个标签不超过 40 个字符。"); return; }
    const owner = userId, session = accountRevision.current, key = editorKey!;
    if (!editor.id) {
      let retained = false;
      const persisted = setDrafts(previous => {
        const current = previous.editors[key];
        if (!current || current.revision !== editor.revision || current.createIntent?.requestId !== editor.createIntent?.requestId) return previous;
        retained = true;
        return { ...previous, editors: { ...previous.editors, [key]: prepared } };
      }, true);
      if (!persisted || !retained) { setError("本次发布请求未能安全保存，尚未发送。请先导出草稿，恢复缓存后再试。"); return; }
    }
    void run(async () => {
      let saved: DzmmForumPost;
      try { saved = await saveDzmmForumPost(draft, editor.id); }
      catch (failure) {
        if (mounted.current && account.current === owner && accountRevision.current === session && editorKeyRef.current === key
          && failure instanceof DzmmForumEditConflictError && failure.current) setComparison({ key, post: failure.current });
        throw failure;
      }
      if (!mounted.current || account.current !== owner || accountRevision.current !== session) return;
      let cleared = false, stillPending = false;
      setDrafts(previous => {
        const result = acknowledgeDzmmForumEditor(previous, key, submitted); cleared = result.cleared;
        stillPending = previous.editors[key]?.createIntent?.requestId === prepared.createIntent?.requestId;
        return result.drafts;
      });
      if (editorKeyRef.current !== key) return;
      if (!cleared) {
        if (!editor.id && stillPending) setCreatedPost({ requestId: prepared.createIntent!.requestId, post: saved });
        return;
      }
      setEditorKey(null); setComparison(null); setCreatedPost(null); setView("topics"); onPostChange(saved.id); refresh(); setNotice(editor.id ? "主题已保存。" : "主题已发布。");
    }, () => editorKeyRef.current === key);
  };
  const adoptCreatedPost = () => {
    if (busy || editorKey !== "new" || !createdPost || createdPost.requestId !== editor?.createIntent?.requestId || account.current !== userId) return;
    let adopted = false;
    const persisted = setDrafts(previous => {
      const next = adoptDzmmForumCreatedPost(previous, createdPost.requestId, createdPost.post.id, createdPost.post.updatedAt);
      adopted = next !== previous; return next;
    }, true);
    if (!persisted || !adopted) { setError("当前文字已保留。目标主题已有编辑草稿，或缓存无法保存，请先导出备份后处理。"); return; }
    setEditorKey(dzmmForumEditorDraftKey(createdPost.post.id)); setComparison(null); setCreatedPost(null); setError("");
  };
  const compareLatest = () => {
    if (!editor?.id || !editorKey || !registered()) return;
    const owner = userId, session = accountRevision.current, key = editorKey, id = editor.id;
    void run(async () => {
      const latest = await fetchDzmmForumPost(id, 0, "");
      if (mounted.current && account.current === owner && accountRevision.current === session && editorKeyRef.current === key) setComparison({ key, post: latest.post });
    }, () => editorKeyRef.current === key);
  };
  const acceptComparison = () => {
    if (busy || !editor?.id || !editorKey || comparison?.key !== editorKey || comparison.post.id !== editor.id || account.current !== userId) return;
    setDrafts(previous => rebaseDzmmForumEditor(previous, editorKey, comparison.post.updatedAt));
    setComparison(null); setError("");
  };
  const vote = (post: DzmmForumPost, value: -1 | 1) => {
    if (!registered()) return;
    const owner = userId;
    const session = accountRevision.current;
    void run(async () => {
      const updated = await voteDzmmForumPost(post.id, post.myVote === value ? 0 : value);
      if (!mounted.current || account.current !== owner || accountRevision.current !== session) return;
      acknowledgedPosts.current.set(updated.id, { revision: (acknowledgedPosts.current.get(updated.id)?.revision ?? 0) + 1, post: updated });
      setPosts((items) => items.map((item) => item.id === updated.id ? updated : item));
      setDetail((value) => value?.post.id === updated.id ? { ...value, post: updated } : value);
    });
  };
  const loadMore = async (retry = false) => {
    if (pendingPage.current || loadingMore || loading || (postId && !detail)) return;
    const currentEpoch = epoch.current;
    const previousFailure = failedPage.current;
    const retryPage = retry && previousFailure?.epoch === currentEpoch && previousFailure.postId === postId ? previousFailure : null;
    const page: PageRequest = { epoch: currentEpoch, postId, offset: retryPage
      ? retryPage.offset : postId && detail ? nextReplyOffset.current : nextListOffset.current,
      cursor: retryPage ? retryPage.cursor : (postId ? nextReplyCursor.current : nextListCursor.current) ?? undefined,
      postRevision: postId ? acknowledgedPosts.current.get(postId)?.revision ?? 0 : 0,
      listRevisions: captureAcknowledgedForumRevisions(acknowledgedPosts.current) };
    pendingPage.current = page; failedPage.current = null;
    setLoadingMore(true); setError("");
    const isCurrent = () => mounted.current && epoch.current === currentEpoch && pendingPage.current === page;
    try {
      if (postId && detail) {
        const result = await fetchDzmmForumPost(postId, page.offset, page.cursor);
        if (isCurrent()) {
          nextReplyOffset.current = nextDzmmForumOffset(result.offset, result.replies);
          nextReplyCursor.current = result.nextCursor;
          setDetail((prior) => prior && prior.post.id === page.postId ? { ...result, post: retainAcknowledgedForumPost(result.post, acknowledgedPosts.current.get(result.post.id), page.postRevision), replies: appendDzmmForumPage(prior.replies, result.replies) } : prior);
        }
      } else {
        const result = await fetchDzmmForumPosts({ category, q: query, tag, ...(page.cursor === undefined ? { offset: page.offset } : { cursor: page.cursor }) });
        if (isCurrent()) {
          nextListOffset.current = nextDzmmForumOffset(result.offset, result.posts);
          nextListCursor.current = result.nextCursor;
          setPosts((prior) => appendDzmmForumPage(prior, retainAcknowledgedForumPosts(result.posts, acknowledgedPosts.current, page.listRevisions)));
          setHasMore(result.hasMore); setTotal(result.total);
        }
      }
    } catch (failure) { if (isCurrent()) { failedPage.current = page; setError(message(failure)); } }
    finally { if (isCurrent()) { pendingPage.current = null; setLoadingMore(false); } }
  };
  const retryRead = () => {
    if (failedPage.current?.epoch === epoch.current) void loadMore(true);
    else { setError(""); refresh(); }
  };
  const submitReply = (event: FormEvent) => {
    event.preventDefault();
    if (!postId || !registered()) return;
    const owner = userId;
    const session = accountRevision.current;
    const target = postId;
    const submitted = replyDrafts[target];
    if (!submitted?.text.trim()) return;
    void run(async () => {
      await replyDzmmForumPost(target, submitted.text.trim());
      if (account.current !== owner || accountRevision.current !== session) return;
      // A reply completes against its submitted revision, never the next draft or another post.
      setDrafts(previous => acknowledgeDzmmForumReply(previous, target, submitted));
      if (activePost.current === target) { refresh(); setNotice("回复已发布。"); }
    }, () => activePost.current === target);
  };
  const remove = () => {
    if (!confirmation) return;
    if (confirmation.type === "draft") { setDrafts(previous => { const editors = { ...previous.editors }; delete editors[confirmation.id]; return { ...previous, editors }; }); setEditorKey(null); setConfirmation(null); return; }
    if (!registered()) return;
    const owner = userId;
    void run(async () => {
      if (confirmation.type === "post") await deleteDzmmForumPost(confirmation.id);
      else await deleteDzmmForumReply(confirmation.id);
      if (account.current !== owner) return;
      if (confirmation.type === "post") onPostChange(null);
      setConfirmation(null); refresh(); setNotice("已删除。");
    });
  };
  const copyLink = () => { void run(async () => { await navigator.clipboard.writeText(window.location.href); setNotice("主题链接已复制。"); }); };
  const submitReport = (event: FormEvent) => {
    event.preventDefault();
    if (!reporting || !registered()) return;
    const owner = userId;
    void run(async () => { await reportDzmmForumPost(reporting, reason.trim()); if (account.current === owner) { setReporting(null); setReason(""); setNotice("举报已提交，等待管理员处理。"); } });
  };
  const loadReports = (append = false) => {
    if (!isSuper) return;
    const owner = userId;
    setShowReports(true);
    void run(async () => {
      const result = await fetchDzmmForumReports(append ? reports.length : 0);
      if (account.current === owner) { setReports((previous) => append ? [...previous, ...result.reports] : result.reports); setReportsTotal(result.total); setReportsMore(result.hasMore); }
    });
  };
  const reviewReport = (report: DzmmForumReport, status: "resolved" | "dismissed") => {
    const owner = userId;
    void run(async () => {
      await reviewDzmmForumReport(report.id, status);
      const result = await fetchDzmmForumReports();
      if (account.current === owner) { setReports(result.reports); setReportsTotal(result.total); setReportsMore(result.hasMore); setNotice(status === "resolved" ? "举报已标记为已处理。" : "举报已驳回。"); }
    });
  };
  const selectCategory = (value: string) => { setCategory(value); setTag(""); setView("topics"); setShowReports(false); onPostChange(null); };
  const selectTag = (value: string) => { setTag(value); setView("topics"); setShowReports(false); onPostChange(null); };
  const search = (event: FormEvent) => { event.preventDefault(); setQuery(queryInput.trim()); setShowReports(false); onPostChange(null); };
  const filteredCharacters = characters.filter((character) => !query || `${character.name} ${character.author} ${character.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const authorName = (author: DzmmForumAuthor) => author.id === userId ? nickname : author.nickname;
  const demoBadge = (author: DzmmForumAuthor) => author.isDemo === true ? <span className={styles.demoBadge}>演示角色</span> : null;
  const demoSource = (author: DzmmForumAuthor) => {
    if (author.isDemo !== true) return null;
    const label = dzmmForumDemoSourceLabel(author);
    return <p className={styles.demoSource}>{label && `${label} · `}虚构演示署名</p>;
  };
  const authorLine = (post: DzmmForumPost) => <div className={styles.metadata}><span className={styles.avatar}>{Array.from(authorName(post.author))[0] ?? ""}</span><strong>{authorName(post.author)}</strong>{demoBadge(post.author)}<span>·</span><span>{categoryName(post.category)}</span><span>·</span><time dateTime={new Date(post.createdAt).toISOString()}>{date(post.createdAt)}</time></div>;
  const votes = (post: DzmmForumPost) => <div className={styles.voteRow}><button type="button" className={post.myVote === 1 ? styles.voted : ""} aria-label={`赞 ${post.title}`} aria-pressed={post.myVote === 1} disabled={busy} onClick={() => vote(post, 1)}>↑ <span>{post.upvotes}</span></button><button type="button" className={post.myVote === -1 ? styles.voted : ""} aria-label={`踩 ${post.title}`} aria-pressed={post.myVote === -1} disabled={busy} onClick={() => vote(post, -1)}>↓ <span>{post.downvotes}</span></button><span><Icon name="chat" size={15} /> {post.replyCount} 回复</span></div>;
  const canManage = (authorId: string) => !isGuest && (authorId === userId || isSuper);
  const createRecoveryUi = editor?.createIntent && !editor.id && <section className={styles.comparison} aria-label="主题发布恢复">
    {createdPost?.requestId === editor.createIntent.requestId ? <>
      <p>上次提交已发布。你之后修改的文字仍在上方，尚未覆盖主题，也没有另发一条。</p>
      <section aria-label="已发布主题内容"><h3>{createdPost.post.title}</h3><p>{createdPost.post.body}</p></section>
      <button type="button" disabled={busy} onClick={adoptCreatedPost}>将当前草稿转为该主题的修改</button>
    </> : <p>上次发布结果尚未确认。核对时会使用原提交内容；之后修改的文字会保留。请勿重新建立相同主题。</p>}
  </section>;
  const editorComparisonUi = editor?.id && <section className={styles.comparison} aria-label="主题版本对照">
    {editor.baseUpdatedAt === undefined ? <p>这个旧草稿没有记录来源版本。原文已保留，请先对照最新主题再保存。</p>
      : comparison?.key === editorKey && <p>主题已有新修订，尚未被当前草稿覆盖。请对照下面的最新内容，合并需要保留的文字和标签。</p>}
    <button type="button" disabled={busy} onClick={compareLatest}>查看最新主题</button>
    {comparison?.key === editorKey && <>
      <section aria-label="最新主题内容"><h3>{comparison.post.title}</h3><span>{categoryName(comparison.post.category)} · {comparison.post.tags.map(value => `#${value}`).join(" ")}</span><p>{comparison.post.body}</p></section>
      <p>上方的当前草稿仍可编辑。确认已对照后继续编辑，再点击“保存修改”；这一步不会自动提交。</p>
      <button type="button" disabled={busy} onClick={acceptComparison}>已对照，继续编辑当前草稿</button>
    </>}
  </section>;

  return <section ref={root} className={styles.layout} aria-label="论坛广场">
    <aside className={styles.navigation}>
      <h2>浏览</h2>
      <div className={styles.browseTabs} role="tablist" aria-label="浏览类型">
        <button type="button" role="tab" aria-selected={view === "topics"} className={view === "topics" ? styles.selected : ""} onClick={() => { setView("topics"); setShowReports(false); }}><Icon name="chat" size={16} />主题</button>
        <button type="button" role="tab" aria-selected={view === "works"} className={view === "works" ? styles.selected : ""} onClick={() => { setView("works"); setShowReports(false); onPostChange(null); }}><Icon name="grid" size={16} />作品</button>
      </div>
      <h2>主题分类</h2>
      <nav aria-label="主题分类"><button type="button" className={!category && view === "topics" ? styles.selected : ""} onClick={() => selectCategory("")}><Icon name="compass" size={16} />最新</button>{DZMM_FORUM_CATEGORIES.map((item) => <button type="button" key={item.id} className={category === item.id && view === "topics" ? styles.selected : ""} onClick={() => selectCategory(item.id)}>{item.name}</button>)}</nav>
      {isSuper && <button type="button" className={styles.adminButton} onClick={() => loadReports()}><Icon name="sliders" size={15} />举报管理</button>}
    </aside>

    <div className={styles.main}>
      <header className={styles.header}><div><h1>{showReports ? "举报管理" : postId && view === "topics" ? "主题详情" : view === "works" ? "作品" : "论坛广场"}</h1><p>{showReports ? `${reportsTotal} 条待处理举报` : view === "works" ? "已收录角色，点开查看介绍" : "分享创作，交流日常，找到同好"}</p></div>{view === "topics" && !showReports && <button type="button" className={styles.primary} onClick={() => openEditor()}><Icon name="plus" size={16} />发主题</button>}</header>
      <p className={styles.guidelines}>交流与发布请遵守 <CommunityGuidelinesLink /></p>
      {!postId && !showReports && <form className={styles.search} onSubmit={search}><Icon name="search" size={18} /><input value={queryInput} maxLength={120} aria-label={view === "works" ? "搜索作品" : "搜索主题"} placeholder={view === "works" ? "搜索角色或作者…" : "搜索主题…"} onChange={(event) => setQueryInput(event.target.value)} /><button type="submit">搜索</button></form>}
      {draftWarning && <div className={styles.error} role="alert">{draftWarning}<button type="button" onClick={exportDrafts}>导出论坛草稿</button></div>}
      {error && <div className={styles.error} role="alert">{error}<button type="button" disabled={busy || loading || loadingMore} onClick={retryRead}>重试</button></div>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {postId && view === "topics" && !showReports && <button type="button" className={styles.back} onClick={() => onPostChange(null)}><Icon name="back" size={16} />返回广场</button>}
      {showReports && isSuper ? <div className={styles.reports}>{busy && !reports.length ? <div className={styles.empty}>正在加载举报…</div> : !reports.length ? !error && <div className={styles.empty}>暂无待处理举报。</div> : reports.map((report) => <article className={styles.reportCard} key={report.id}><button type="button" className={styles.titleButton} onClick={() => { setShowReports(false); setView("topics"); onPostChange(report.postId); }}>{report.title}</button><p className={styles.metadata}>{authorName(report.reporter)} · {date(report.createdAt)}</p><p className={styles.body}>{report.reason}</p><div className={styles.ownerActions}><button type="button" disabled={busy} onClick={() => reviewReport(report, "resolved")}>标记已处理</button><button type="button" disabled={busy} onClick={() => reviewReport(report, "dismissed")}>驳回举报</button></div></article>)}{reportsMore && <button type="button" className={styles.loadMore} disabled={busy} onClick={() => loadReports(true)}>加载更多举报</button>}</div>
        : view === "works" ? <div className={styles.works}>{filteredCharacters.length ? filteredCharacters.map((character) => <button type="button" key={character.id} className={styles.workCard} onClick={() => { if (canLeave()) onCharacter(character); }}><img src={xumengImageUrl(character.cover)} alt={character.name} loading="lazy" /><strong>{character.name}</strong><span>{character.author}</span></button>) : <div className={styles.empty}>没有找到匹配的作品。</div>}</div>
        : loading ? <div className={styles.empty} role="status">正在加载主题…</div>
        : postId ? detail ? <>
          <article className={styles.detail}>
            <div className={styles.category}>{categoryName(detail.post.category)}</div><h2>{detail.post.title}</h2>{authorLine(detail.post)}{demoSource(detail.post.author)}
            <div className={styles.detailActions}><button type="button" onClick={copyLink} disabled={busy}><Icon name="copy" size={15} />复制链接</button><button type="button" onClick={() => { if (registered()) { setReporting(detail.post.id); setReason(""); } }}>举报</button>{canManage(detail.post.author.id) && <><button type="button" onClick={() => openEditor(detail.post)}>编辑</button><button type="button" onClick={() => setConfirmation({ type: "post", id: detail.post.id })}>删除</button></>}</div>
            <p className={styles.body}>{detail.post.body}</p><div className={styles.tags}>{detail.post.tags.map((item) => <button type="button" key={item} onClick={() => selectTag(item)}>#{item}</button>)}</div>{detail.post.updatedAt > detail.post.createdAt && <p className={styles.edited}>编辑于 {date(detail.post.updatedAt)}</p>}{votes(detail.post)}
          </article>
          <section className={styles.replies} aria-label="主题回复"><h2>回复 <span>{detail.total}</span></h2>
            {!userId || isGuest ? <div className={styles.guestNotice}><p>游客账号无法评论，请使用邮箱注册正式账号。</p><button type="button" className={styles.primary} onClick={onRequireAccount}>注册账号</button></div> : <form className={styles.replyForm} onSubmit={submitReply}><label htmlFor="forum-reply">以 {nickname} 的身份回复</label><textarea id="forum-reply" value={reply} onChange={(event) => { const text = event.target.value; setDrafts(previous => ({ ...previous, replies: { ...previous.replies, [postId]: { text, revision: crypto.randomUUID() } } })); }} required maxLength={4000} rows={4} placeholder="发表你的看法…" /><button className={styles.primary} type="submit" disabled={busy || !reply.trim()}>{busy ? "正在发布…" : "发布回复"}</button></form>}
            {!detail.replies.length ? <div className={styles.empty}><strong>暂无评论</strong><span>快来发表你的看法吧</span></div> : detail.replies.map((item: DzmmForumReply) => <article key={item.id} className={styles.replyCard}><div className={styles.metadata}><span className={styles.avatar}>{Array.from(authorName(item.author))[0] ?? ""}</span><strong>{authorName(item.author)}</strong>{demoBadge(item.author)}<time dateTime={new Date(item.createdAt).toISOString()}>{date(item.createdAt)}</time>{canManage(item.author.id) && <button type="button" onClick={() => setConfirmation({ type: "reply", id: item.id })}>删除</button>}</div>{demoSource(item.author)}<p className={styles.body}>{item.body}</p></article>)}
            {detail.hasMore && <button type="button" className={styles.loadMore} disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "正在加载…" : "加载更多回复"}</button>}
          </section>
        </> : !error && <div className={styles.empty}>主题不存在或已删除。</div>
        : <>
          <div className={styles.listHeading}><span>{tag ? `#${tag}` : categoryName(category)} {total > 0 && `· ${total} 个主题`}</span>{(query || tag) && <button type="button" onClick={() => { setTag(""); setQuery(""); setQueryInput(""); }}>清除筛选</button>}</div>
          {!posts.length && !error ? <div className={styles.empty}><Icon name="chat" size={36} /><strong>{query || tag ? "没有找到匹配的主题" : "暂无主题"}</strong><span>{query || tag ? "换个关键词试试" : "来分享你的第一篇创作或想法吧"}</span>{!query && !tag && <button type="button" className={styles.primary} onClick={() => openEditor()}>发主题</button>}</div> : posts.map((post) => <article key={post.id} className={styles.postCard}>{authorLine(post)}<button type="button" className={styles.titleButton} data-forum-post-id={post.id} onClick={(event) => openPost(post.id, event.currentTarget)}>{post.title}</button><p className={styles.excerpt}>{post.body}</p>{demoSource(post.author)}<div className={styles.tags}>{post.tags.map((item) => <button type="button" key={item} onClick={() => selectTag(item)}>#{item}</button>)}</div>{votes(post)}</article>)}
          {hasMore && <button type="button" className={styles.loadMore} disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "正在加载…" : "加载更多主题"}</button>}
        </>}
    </div>

    <aside className={styles.about}><section><h2>关于广场</h2><p>这里是角色创作者和玩家的交流空间。分享灵感、讨论角色，也聊聊生活中的新鲜事。</p><p>发布内容前，请尊重他人，保护自己与他人的隐私。</p></section><section><h2>热门标签</h2>{popularTags.length ? <div className={styles.popularTags}>{popularTags.map((item) => <button type="button" key={item.tag} onClick={() => selectTag(item.tag)}>#{item.tag}<span>{item.count}</span></button>)}</div> : <p>主题发布后，热门标签会显示在这里。</p>}</section></aside>

    {editor && <div className={styles.modalBackdrop}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="forum-editor-title"><header><h2 id="forum-editor-title">{editor.id ? "编辑主题" : "发主题"}</h2><button type="button" disabled={busy} aria-label="关闭主题编辑器" onClick={() => setEditorKey(null)}><Icon name="close" /></button></header><form onSubmit={submitPost}><label>主题分类<select value={editor.category} onChange={(event) => updateEditor({ category: event.target.value as DzmmForumCategory })}>{DZMM_FORUM_CATEGORIES.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>标题<input autoFocus required maxLength={120} value={editor.title} placeholder="为你的主题起一个标题" onChange={(event) => updateEditor({ title: event.target.value })} /></label><label>正文<textarea required maxLength={12000} rows={10} value={editor.body} placeholder="想分享些什么？" onChange={(event) => updateEditor({ body: event.target.value })} /></label><label>标签<input value={editor.tagsText} maxLength={409} placeholder="用逗号分隔，最多 10 个标签" onChange={(event) => updateEditor({ tagsText: event.target.value })} /></label><p className={styles.guidelines}>主题发布后会公开展示，请先阅读 <CommunityGuidelinesLink />。</p>{editorComparisonUi}{createRecoveryUi}{error && <p className={styles.error} role="alert">{error}</p>}{draftWarning && <p className={styles.error} role="alert">{draftWarning}</p>}<footer><span>{editor.body.length} / 12000</span><button type="button" onClick={exportDrafts}>导出论坛草稿</button><button type="button" disabled={busy} onClick={() => setConfirmation({ type: "draft", id: editorKey! })}>放弃当前草稿</button><button type={editor.createIntent ? "button" : "submit"} onClick={editor.createIntent ? () => submitPost() : undefined} className={styles.primary} disabled={busy || editorNeedsReview || Boolean(createdPost && createdPost.requestId === editor.createIntent?.requestId) || (!editor.createIntent && (!editor.title.trim() || !editor.body.trim()))}>{busy ? "正在保存…" : editor.id ? "保存修改" : editor.createIntent ? "核对并完成上次发布" : "发布主题"}</button></footer></form></section></div>}
    {confirmation && <div className={styles.modalBackdrop}><section className={`${styles.modal} ${styles.smallModal}`} role="dialog" aria-modal="true" aria-labelledby="forum-delete-title"><header><h2 id="forum-delete-title">删除{confirmation.type === "draft" ? "草稿" : confirmation.type === "post" ? "主题" : "回复"}</h2></header><p>{confirmation.type === "draft" ? drafts.editors[confirmation.id]?.createIntent ? "上次发布可能已经保存，放弃草稿不会删除已发布主题。建议先核对上次发布或导出备份。仍要放弃当前草稿吗？" : "确定放弃当前草稿？请先导出需要保留的内容。" : confirmation.type === "post" ? "删除后，主题、回复和投票都会移除。确定删除吗？" : "这条回复将被永久删除。确定删除吗？"}</p>{error && <p className={styles.error} role="alert">{error}</p>}<footer><button type="button" disabled={busy} onClick={() => setConfirmation(null)}>取消</button><button type="button" className={styles.danger} disabled={busy} onClick={remove}>{busy ? "正在删除…" : "确认删除"}</button></footer></section></div>}
    {reporting && <div className={styles.modalBackdrop}><section className={`${styles.modal} ${styles.smallModal}`} role="dialog" aria-modal="true" aria-labelledby="forum-report-title"><header><h2 id="forum-report-title">举报主题</h2><button type="button" aria-label="关闭举报" disabled={busy} onClick={() => setReporting(null)}><Icon name="close" /></button></header><form onSubmit={submitReport}><label>举报说明<textarea autoFocus required rows={5} maxLength={1000} value={reason} placeholder="请说明需要管理员处理的问题" onChange={(event) => setReason(event.target.value)} /></label>{error && <p className={styles.error} role="alert">{error}</p>}<footer><span>{reason.length} / 1000</span><button type="submit" className={styles.primary} disabled={busy || !reason.trim()}>{busy ? "正在提交…" : "提交举报"}</button></footer></form></section></div>}
  </section>;
}
