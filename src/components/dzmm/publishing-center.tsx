"use client";

/* eslint-disable @next/next/no-img-element -- Author supplied character covers. */
import { useCallback, useEffect, useRef, useState } from "react";
import { getDzmmCharacterCardBlurb } from "@/lib/dzmm-character-presentation";
import type { Character } from "@/lib/dzmm-characters";
import { isDzmmCoverVideoUrl } from "@/lib/dzmm-cover-media";
import { xumengImageUrl } from "@/lib/xumeng-routes";
import type { DzmmCloudUser } from "@/lib/dzmm-cloud";
import {
  fetchDzmmPublishingMine, fetchDzmmSubmissions, reviewDzmmSubmission,
  withdrawDzmmSubmission, unpublishDzmmCharacter, setDzmmDisplayStats,
  type DzmmPublication, type DzmmPublishingSubmission, type DzmmSubmissionStatus, type DzmmPublishingFilter,
} from "@/lib/dzmm-publishing";
import { characterCreateLabel, useCharacterCreateCost } from "@/lib/dzmm-scene-prices";
import type { XumengLocale } from "@/lib/xumeng-i18n";
import { xumengPage } from "@/lib/xumeng-page-copy";
import { xumengStudio, xumengStudioFill } from "@/lib/xumeng-studio-copy";
import { CoverVisual } from "./cover-visual";
import Icon, { type IconName } from "./icons";
import s from "./publishing-center.module.css";

type Props = {
  user: DzmmCloudUser | null; drafts: Character[]; admin?: boolean; embedded?: boolean;
  onCreate: () => void; onEdit: (character: Character) => void;
  onCharacter: (character: Character) => void; onRequireAccount: () => void;
  onCatalogChanged: () => Promise<void>;
  onNovels?: () => void;
  locale?: XumengLocale;
};
const AUTHOR_TABS = ["drafts", "all", "pending", "published", "rejected", "archived"] as const;

function CoverThumb({ src }: { src: string }) {
  const url = xumengImageUrl(src);
  if (isDzmmCoverVideoUrl(url)) return <CoverVisual src={url} alt="" />;
  return <img src={url} alt="" />;
}

function RowAction({ label, name, tone, disabled, onClick }: { label: string; name: IconName; tone?: "gold" | "danger"; disabled?: boolean; onClick: () => void }) {
  const toneClass = tone === "gold" ? s.iconGold : tone === "danger" ? s.iconDanger : "";
  return <button type="button" className={toneClass ? `${s.actionBtn} ${toneClass}` : s.actionBtn} title={label} disabled={disabled} onClick={onClick}><Icon name={name} size={15} /><span>{label}</span></button>;
}
type AuthorTab = "drafts" | DzmmPublishingFilter;
function date(value: number) { return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }

export default function PublishingCenter({ user, drafts, admin = false, embedded = false, locale = "zh-Hans", onCreate, onEdit, onRequireAccount, onCatalogChanged, onNovels }: Props) {
  const c = xumengStudio(locale);
  const statusName = (status: DzmmSubmissionStatus) => ({ pending: c.pbPending, approved: c.pbApproved, rejected: c.pbRejected, withdrawn: c.pbWithdrawn }[status]);
  const authorTabName = (key: AuthorTab) => ({ drafts: c.pbDrafts, all: c.pbAll, pending: c.pbPending, published: c.pbPublished, rejected: c.pbRejected, archived: c.pbArchived }[key]);
  const [publications, setPublications] = useState<DzmmPublication[]>([]);
  const [submissions, setSubmissions] = useState<DzmmPublishingSubmission[]>([]);
  const [submissionSnapshot, setSubmissionSnapshot] = useState<{ accountId: string; scope: string; filter: DzmmSubmissionStatus; query: string } | null>(null);
  const [tab, setTab] = useState<AuthorTab>("drafts");
  const [publicationSnapshot, setPublicationSnapshot] = useState<{ accountId: string; scope: string; filter: DzmmPublishingFilter; total: number } | null>(null);
  const [filter, setFilter] = useState<DzmmSubmissionStatus>("pending");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [review, setReview] = useState<DzmmPublishingSubmission | null>(null);
  const createCost = useCharacterCreateCost();
  const createLabel = characterCreateLabel(createCost, xumengPage(locale).createRole);
  const [reason, setReason] = useState("");
  const [stats, setStats] = useState({ heat: "", likes: "" });
  const [confirm, setConfirm] = useState<{ action: "withdraw" | "unpublish"; publication: Pick<DzmmPublication, "id" | "version" | "latestSubmission"> } | null>(null);
  const generation = useRef(0);
  const scope = `${user?.id ?? "none"}:${user?.isGuest ? "guest" : "registered"}:${admin ? `admin:${filter}:${appliedQuery}` : `author:${tab}`}`;
  const accountId = user?.id ?? "";
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const mounted = useRef(true);
  const dialog = useRef<HTMLElement>(null);
  const workingRef = useRef(false);
  workingRef.current = working;
  const dialogId = confirm ? `confirm:${confirm.publication.id}` : review?.id;
  useEffect(() => {
    if (!dialogId) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const current = dialog.current;
    current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !workingRef.current) { event.preventDefault(); setConfirm(null); setReview(null); }
      if (event.key !== "Tab") return;
      const items = current?.querySelectorAll<HTMLElement>("button:not(:disabled),textarea:not(:disabled),input:not(:disabled)");
      if (!items?.length) { event.preventDefault(); current?.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [dialogId]);
  const registered = Boolean(user && !user.isGuest);
  const permitted = registered && (!admin || user?.role === "super");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!admin) return;
    const next = query.trim();
    if (next === appliedQuery) return;
    const handle = window.setTimeout(() => {
      generation.current += 1; setReview(null); setError(""); setLoading(true); setAppliedQuery(next);
    }, next ? 300 : 0);
    return () => window.clearTimeout(handle);
  }, [admin, appliedQuery, query]);
  const load = useCallback(async (append = false, start = 0) => {
    if (!permitted) return;
    if (!admin && tab === "drafts") { generation.current++; setLoading(false); setError(""); return; }
    const current = ++generation.current;
    const requestScope = scope;
    const valid = () => mounted.current && current === generation.current && activeScope.current === requestScope;
    setLoading(true); setError("");
    try {
      if (admin) {
        const page = await fetchDzmmSubmissions({ status: filter, offset: start, ...(appliedQuery ? { q: appliedQuery } : {}) });
        if (!valid()) return;
        setSubmissions((previous) => append ? [...previous, ...page.submissions.filter((item) => !previous.some((old) => old.id === item.id))] : page.submissions);
        setSubmissionSnapshot({ accountId, scope: requestScope, filter, query: appliedQuery });
        setOffset(page.offset + page.submissions.length); setHasMore(page.hasMore);
      } else {
        const authorFilter = tab as DzmmPublishingFilter;
        const page = await fetchDzmmPublishingMine(start, authorFilter);
        if (!valid()) return;
        setPublications((previous) => append ? [...previous, ...page.publications.filter((item) => !previous.some((old) => old.id === item.id))] : page.publications);
        setPublicationSnapshot({ accountId, scope: requestScope, filter: authorFilter, total: page.total });
        setOffset(page.offset + page.publications.length); setHasMore(page.hasMore);
      }
    } catch (failure) { if (valid()) setError(failure instanceof Error ? failure.message : c.pbLoadFailed); }
    finally { if (valid()) setLoading(false); }
  }, [accountId, admin, appliedQuery, filter, permitted, scope, tab]);
  useEffect(() => { void load(); }, [load]);
  function readStats() {
    const heat = Number(stats.heat || 0), likes = Number(stats.likes || 0);
    if (![heat, likes].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000)) throw new Error(c.pbStatsRule);
    return { displayHeat: heat, displayLikes: likes };
  }
  function openReview(submission: DzmmPublishingSubmission) {
    setReview(submission); setReason(""); setError("");
    setStats({ heat: submission.displayHeat ? String(submission.displayHeat) : "", likes: submission.displayLikes ? String(submission.displayLikes) : "" });
  }
  async function saveStats() {
    if (!review || working) return;
    setWorking(true); setError("");
    try {
      await setDzmmDisplayStats(review.publicationId, readStats(), user?.id);
      if (!mounted.current) return;
      setNotice(c.pbStatsSaved); setReview(null);
      await load(); await onCatalogChanged();
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : c.pbSaveFailed); }
    finally { if (mounted.current) setWorking(false); }
  }
  async function moderate(decision: "approved" | "rejected") {
    if (!review || working) return;
    if (decision === "rejected" && !reason.trim()) { setError(c.pbNeedReason); return; }
    setWorking(true); setError("");
    try {
      await reviewDzmmSubmission(review.id, review.publicationVersion, decision, reason.trim(), user?.id, decision === "approved" ? readStats() : undefined);
      if (!mounted.current) return;
      setReview(null); setReason(""); setNotice(decision === "approved" ? c.pbApprovedNotice : c.pbRejectedNotice);
      await load(); await onCatalogChanged();
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : c.pbReviewFailed); }
    finally { if (mounted.current) setWorking(false); }
  }
  async function confirmAction() {
    if (!confirm || working) return;
    setWorking(true); setError("");
    try {
      const item = confirm.publication;
      if (confirm.action === "withdraw") await withdrawDzmmSubmission(item.latestSubmission.id, item.version, user?.id);
      else await unpublishDzmmCharacter(item.id, item.version, user?.id);
      if (!mounted.current) return;
      setConfirm(null); if (admin) setReview(null); setNotice(confirm.action === "withdraw" ? c.pbWithdrawnNotice : c.pbUnpublished);
      await load(); await onCatalogChanged();
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : c.pbFailed); }
    finally { if (mounted.current) setWorking(false); }
  }
  const snapshotCurrent = publicationSnapshot?.scope === scope;
  const retainedSnapshot = !admin && !loading && Boolean(error) && publicationSnapshot?.accountId === user?.id;
  const listed = snapshotCurrent || retainedSnapshot ? publications : [];
  const adminSnapshotCurrent = submissionSnapshot?.scope === scope;
  const retainedAdminSnapshot = admin && !loading && Boolean(error) && submissionSnapshot?.accountId === user?.id;
  const adminListed = adminSnapshotCurrent || retainedAdminSnapshot ? submissions : [];
  const Container = embedded ? "section" : "main";
  return <Container className={s.page} style={embedded ? { padding: 0 } : undefined} aria-label={c.pbManage}>
    <header className={s.heading}><div><p>{admin ? c.pbSuper : c.pbMine}</p>{embedded ? <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>{admin ? c.pbReviewTitle : c.pbWorks}</h2> : <h1>{admin ? c.pbReviewTitle : c.pbCenter}</h1>}<span>{admin ? c.pbReviewLead : c.pbAuthorLead}</span></div><div className={s.tools}>{!admin && onNovels && <button className={s.outline} onClick={onNovels}><Icon name="book" size={16} />{c.pbNovels}</button>}{permitted && (admin || tab !== "drafts") && <button className={s.outline} disabled={loading || working} onClick={() => void load()}><Icon name="refresh" size={16} />{c.pbRefresh}</button>}{!admin && <span className={s.createSlot}><button type="button" className={s.iconButton} aria-label={createLabel} title={createLabel} onClick={onCreate}><Icon name="plus" size={16} /></button>{createCost ? <small title={createLabel}>{createCost} 金币</small> : null}</span>}</div></header>
    {admin ? <div className={s.filters}><label>{c.pbReviewState}<select value={filter} disabled={working} onChange={(event) => { generation.current++; setReview(null); setError(""); setLoading(true); setFilter(event.target.value as DzmmSubmissionStatus); }}>{(["pending", "approved", "rejected", "withdrawn"] as const).map(key => <option key={key} value={key}>{statusName(key)}</option>)}</select></label><label className={s.search}><input type="search" aria-label={c.pbReviewSearch} placeholder={c.pbReviewSearch} maxLength={120} autoComplete="off" spellCheck={false} value={query} disabled={working} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); const next = query.trim(); if (next === appliedQuery) return; generation.current++; setReview(null); setError(""); setLoading(true); setAppliedQuery(next); }} /></label></div> : <nav className={s.tabs} aria-label={c.pbAuthorState}>{AUTHOR_TABS.map((key) => <button key={key} role="tab" aria-selected={tab === key} disabled={working} onClick={() => { if (tab === key) return; generation.current++; setTab(key); setError(""); setLoading(permitted && key !== "drafts"); setNotice(""); setConfirm(null); }}>{authorTabName(key)}{key === "drafts" && <span>{drafts.length}</span>}</button>)}</nav>}
    {error && <p className={s.error} role="alert">{error}<button onClick={() => void load()} disabled={loading}>{c.pbRefreshRecords}</button></p>}{notice && <p className={s.notice} role="status">{notice}</p>}
    {!permitted && (admin || tab !== "drafts") && <section className={s.empty}><Icon name="user" size={34} /><h2>{admin ? c.pbNeedSuper : c.pbLoginProgress}</h2><p>{c.pbDraftsStay}</p><button className={s.primary} onClick={onRequireAccount}>{c.pbLogin}</button></section>}
    {!admin && tab === "drafts" && (drafts.length ? <div className={s.list}>{drafts.map((character) => <article className={s.row} key={character.id}><CoverThumb src={character.cover} /><div className={s.content}><h2>{character.name}</h2><p>{getDzmmCharacterCardBlurb(character) || c.pbNoIntro}</p><small>{xumengStudioFill(c.pbDraftMeta, { book: character.authoringDraft?.characterBook.entries.length ?? character.characterBook?.entries.length ?? 0, draft: character.authoringDraft ? c.pbNeedsWork : "", openings: character.openingMessages?.length ?? (character.firstMessage ? 1 : 0) })}</small></div><RowAction label={c.pbContinue} name="edit" onClick={() => onEdit(character)} /></article>)}</div> : <section className={s.empty}><Icon name="edit" size={36} /><h2>{c.pbFirstRole}</h2><p>{c.pbFirstRoleBody}</p><button className={s.primary} onClick={onCreate}>{createLabel}</button></section>)}
    {!admin && tab !== "drafts" && permitted && snapshotCurrent && <p className={s.meta}>{xumengStudioFill(c.pbCount, { count: publicationSnapshot?.total ?? 0 })}{tab === "archived" ? ` · ${c.pbOldLive}` : ""}</p>}
    {!admin && tab !== "drafts" && permitted && retainedSnapshot && !snapshotCurrent && <p className={s.notice} role="status">{xumengStudioFill(c.pbStale, { name: authorTabName((publicationSnapshot?.filter ?? "all") as AuthorTab) })}</p>}
    {!admin && tab !== "drafts" && permitted && (listed.length ? <div className={s.list}>{listed.map((publication) => {
      const submission = publication.latestSubmission, character = submission.character;
      const editable = drafts.find((draft) => draft.id === publication.privateCharacterId) ?? character;
      return <article className={s.row} key={publication.id}><CoverThumb src={submission.previewCoverUrl} /><div className={s.content}><h2>{character.name}<span className={s.badge} data-status={submission.status}>{statusName(submission.status)}</span>{publication.isListed && submission.status !== "approved" && <span className={s.badge}>{c.pbPreviousLive}</span>}{!publication.isListed && publication.approvedRevision !== null && <span className={s.badge}>{c.pbRemoved}</span>}</h2><p>{getDzmmCharacterCardBlurb(character)}</p><small>{xumengStudioFill(c.pbRevision, { n: submission.revision, time: date(submission.createdAt) })}</small>{submission.reason && <p className={s.reason}>{xumengStudioFill(c.pbReviewNote, { reason: submission.reason })}</p>}</div><div className={s.actions}><RowAction tone="gold" label={c.pbEditAgain} name="edit" disabled={working || !snapshotCurrent} onClick={() => onEdit(editable)} />{submission.status === "pending" && <RowAction label={c.pbWithdraw} name="undo" disabled={working || !snapshotCurrent} onClick={() => setConfirm({ action: "withdraw", publication })} />}{publication.isListed && <RowAction tone="danger" label={c.pbUnpublish} name="eyeOff" disabled={working || !snapshotCurrent} onClick={() => setConfirm({ action: "unpublish", publication })} />}</div></article>;
    })}</div> : <section className={s.empty}><Icon name="book" size={34} /><h2>{loading ? c.pbLoading : error ? c.pbFilterFailed : c.pbNone}</h2><p>{error ? c.pbKeepDrafts : c.pbSubmitHint}</p></section>)}
    {admin && permitted && retainedAdminSnapshot && !adminSnapshotCurrent && <p className={s.notice} role="status">{xumengStudioFill(c.pbReviewStale, { name: submissionSnapshot!.query ? `${statusName(submissionSnapshot!.filter)} · ${submissionSnapshot!.query}` : statusName(submissionSnapshot!.filter) })}</p>}
    {admin && permitted && (adminListed.length ? <div className={s.list}>{adminListed.map((submission) => <article className={s.row} key={submission.id}><CoverThumb src={submission.previewCoverUrl} /><div className={s.content}><h2>{submission.character.name}<span className={s.badge} data-status={submission.status}>{statusName(submission.status)}</span></h2><p>{getDzmmCharacterCardBlurb(submission.character)}</p><small>{submission.author.nickname} · {xumengStudioFill(c.pbRevision, { n: submission.revision, time: date(submission.createdAt) })}</small>{submission.reason && <p className={s.reason}>{xumengStudioFill(c.pbReviewNote, { reason: submission.reason })}</p>}</div><div className={s.actions}><button className={s.outline} disabled={working || !adminSnapshotCurrent} onClick={() => openReview(submission)}>{c.pbOpenFull}</button>{submission.isListed && <button className={s.danger} disabled={working || !adminSnapshotCurrent} onClick={() => setConfirm({ action: "unpublish", publication: { id: submission.publicationId, version: submission.publicationVersion, latestSubmission: submission } })}>{c.pbUnpublish}</button>}</div></article>)}</div> : <section className={s.empty}><Icon name="check" size={36} /><h2>{loading ? c.pbLoading : error ? c.pbReviewFilterFailed : appliedQuery ? c.pbReviewSearchEmpty : c.pbNoReview}</h2></section>)}
    {hasMore && permitted && ((admin && adminSnapshotCurrent) || (!admin && tab !== "drafts" && snapshotCurrent)) && <button className={s.more} disabled={loading || working} onClick={() => void load(true, offset)}>{loading ? c.pbLoading : c.pbLoadMore}</button>}
    {review && <div className={s.overlay}><section ref={dialog} tabIndex={-1} className={s.dialog} role="dialog" aria-modal="true" aria-label={c.pbReviewRole}><header><h2>{review.character.name}</h2><button className={s.text} disabled={working} onClick={() => setReview(null)} aria-label={c.pbCloseReview}><Icon name="close" /></button></header><div className={s.reviewBody}><p className={s.meta}>{xumengStudioFill(c.pbAuthorMeta, { name: review.author.nickname, n: review.revision, time: statusName(review.status) })}</p><div className={s.gallery}><img src={review.previewCoverUrl} alt={c.pbCover} />{review.previewGalleryUrls?.map((url, index) => <img key={`${index}:${url}`} src={url} alt={xumengStudioFill(c.pbGallery, { n: index + 1 })} />)}</div>{([[c.pbIntro, review.character.introduction], [c.pbAuthorNotes, review.character.creatorNotes], [c.pbDescription, review.character.description], [c.pbPersonality, review.character.personality], [c.pbScene, review.character.scenario], [c.pbSystem, review.character.systemPrompt], [c.pbPost, review.character.postHistoryInstructions], [c.pbExamples, review.character.messageExamples]] as const).map(([label, content]) => content ? <section className={s.field} key={label}><h3>{label}</h3><p>{content}</p></section> : null)}<section className={s.field}><h3>{c.pbOpening}</h3>{(review.character.openingMessages ?? (review.character.firstMessage ? [{ role: "assistant", content: review.character.firstMessage }] : [])).map((message, index) => <p key={index}><strong>{message.role === "assistant" ? "AI" : c.pbUser}：</strong>{message.content}</p>)}{review.character.alternateGreetings?.map((content, index) => <p key={`alt:${index}`}><strong>{xumengStudioFill(c.pbAlt, { n: index + 1 })}：</strong>{content}</p>)}</section><section className={s.field}><h3>{xumengStudioFill(c.pbBook, { count: review.character.characterBook?.entries.length ?? 0 })}</h3>{review.character.characterBook?.entries.map((entry, index) => <div key={index}><strong>{entry.name || xumengStudioFill(c.pbEntry, { n: index + 1 })} · {entry.constant ? c.pbConstant : entry.keys.join("、")}{entry.enabled === false ? ` · ${c.pbOff}` : ""}</strong><p>{entry.content}</p></div>)}</section>{(review.status === "pending" || (review.status === "approved" && review.isListed)) && <div className={s.statsFields}><label>{c.pbHeat}<input type="number" min={0} max={100000000} step={1} inputMode="numeric" value={stats.heat} disabled={working} placeholder={c.pbHeatPh} onChange={(event) => setStats(value => ({ ...value, heat: event.target.value }))} /></label><label>{c.pbInitialLikes}<input type="number" min={0} max={100000000} step={1} inputMode="numeric" value={stats.likes} disabled={working} placeholder={c.pbLikesPh} onChange={(event) => setStats(value => ({ ...value, likes: event.target.value }))} /></label>{review.status === "approved" && <button className={s.outline} disabled={working} onClick={() => void saveStats()}>{working ? c.pbSaving : c.pbSaveHeat}</button>}</div>}{review.status === "pending" && <label className={s.reviewReason}>{c.pbOpinion}<textarea maxLength={1000} rows={3} value={reason} disabled={working} onChange={(event) => setReason(event.target.value)} placeholder={c.pbOpinionPh} /></label>}{error && <p className={s.error} role="alert">{error}</p>}</div>{review.status === "pending" && <footer><button className={s.outline} disabled={working} onClick={() => void moderate("rejected")}>{c.pbSendBack}</button><button className={s.primary} disabled={working} onClick={() => void moderate("approved")}>{working ? c.pbWorking : c.pbApprove}</button></footer>}</section></div>}
    {confirm && <div className={s.overlay}><section ref={dialog} tabIndex={-1} className={s.confirm} role="dialog" aria-modal="true" aria-label={confirm.action === "withdraw" ? c.pbWithdraw : c.pbUnpublishAria}><h2>{confirm.action === "withdraw" ? c.pbWithdrawQ : c.pbUnpublishQ}</h2><p>{confirm.action === "withdraw" ? c.pbWithdrawBody : c.pbUnpublishBody}</p>{error && <p className={s.error} role="alert">{error}</p>}<footer><button className={s.outline} disabled={working} onClick={() => setConfirm(null)}>{c.pbCancel}</button><button className={s.primary} disabled={working} onClick={() => void confirmAction()}>{working ? c.pbWorking : c.pbConfirm}</button></footer></section></div>}
  </Container>;
}
