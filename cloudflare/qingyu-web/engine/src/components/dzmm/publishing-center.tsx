"use client";

/* eslint-disable @next/next/no-img-element -- Author supplied character covers. */
import { useCallback, useEffect, useRef, useState } from "react";
import { getDzmmCharacterPreviewText } from "@/lib/dzmm-character-presentation";
import type { Character } from "@/lib/dzmm-characters";
import { xumengImageUrl } from "@/lib/xumeng-routes";
import type { DzmmCloudUser } from "@/lib/dzmm-cloud";
import {
  fetchDzmmPublishingMine, fetchDzmmSubmissions, reviewDzmmSubmission,
  withdrawDzmmSubmission, unpublishDzmmCharacter,
  type DzmmPublication, type DzmmPublishingSubmission, type DzmmSubmissionStatus, type DzmmPublishingFilter,
} from "@/lib/dzmm-publishing";
import Icon from "./icons";
import { CommunityGuidelinesLink } from "./community-guidelines";
import s from "./publishing-center.module.css";

type Props = {
  user: DzmmCloudUser | null; drafts: Character[]; admin?: boolean; embedded?: boolean;
  onCreate: () => void; onEdit: (character: Character) => void;
  onCharacter: (character: Character) => void; onRequireAccount: () => void;
  onCatalogChanged: () => Promise<void>;
  onNovels?: () => void;
};
const STATUS: Record<DzmmSubmissionStatus, string> = { pending: "待审核", approved: "已批准", rejected: "已退回", withdrawn: "已撤回" };
const AUTHOR_TABS = [["drafts", "私人草稿"], ["all", "所有投稿"], ["pending", "待审核"], ["published", "已发布"], ["rejected", "已退回"], ["archived", "已撤回 / 下架"]] as const;
type AuthorTab = "drafts" | DzmmPublishingFilter;
function date(value: number) { return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }

export default function PublishingCenter({ user, drafts, admin = false, embedded = false, onCreate, onEdit, onRequireAccount, onCatalogChanged, onNovels }: Props) {
  const [publications, setPublications] = useState<DzmmPublication[]>([]);
  const [submissions, setSubmissions] = useState<DzmmPublishingSubmission[]>([]);
  const [submissionSnapshot, setSubmissionSnapshot] = useState<{ accountId: string; scope: string; filter: DzmmSubmissionStatus } | null>(null);
  const [tab, setTab] = useState<AuthorTab>("drafts");
  const [publicationSnapshot, setPublicationSnapshot] = useState<{ accountId: string; scope: string; filter: DzmmPublishingFilter; total: number } | null>(null);
  const [filter, setFilter] = useState<DzmmSubmissionStatus>("pending");
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [review, setReview] = useState<DzmmPublishingSubmission | null>(null);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState<{ action: "withdraw" | "unpublish"; publication: Pick<DzmmPublication, "id" | "version" | "latestSubmission"> } | null>(null);
  const generation = useRef(0);
  const scope = `${user?.id ?? "none"}:${user?.isGuest ? "guest" : "registered"}:${admin ? `admin:${filter}` : `author:${tab}`}`;
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
  const load = useCallback(async (append = false, start = 0) => {
    if (!permitted) return;
    if (!admin && tab === "drafts") { generation.current++; setLoading(false); setError(""); return; }
    const current = ++generation.current;
    const requestScope = scope;
    const valid = () => mounted.current && current === generation.current && activeScope.current === requestScope;
    setLoading(true); setError("");
    try {
      if (admin) {
        const page = await fetchDzmmSubmissions({ status: filter, offset: start });
        if (!valid()) return;
        setSubmissions((previous) => append ? [...previous, ...page.submissions.filter((item) => !previous.some((old) => old.id === item.id))] : page.submissions);
        setSubmissionSnapshot({ accountId, scope: requestScope, filter });
        setOffset(page.offset + page.submissions.length); setHasMore(page.hasMore);
      } else {
        const authorFilter = tab as DzmmPublishingFilter;
        const page = await fetchDzmmPublishingMine(start, authorFilter);
        if (!valid()) return;
        setPublications((previous) => append ? [...previous, ...page.publications.filter((item) => !previous.some((old) => old.id === item.id))] : page.publications);
        setPublicationSnapshot({ accountId, scope: requestScope, filter: authorFilter, total: page.total });
        setOffset(page.offset + page.publications.length); setHasMore(page.hasMore);
      }
    } catch (failure) { if (valid()) setError(failure instanceof Error ? failure.message : "发布记录加载失败。"); }
    finally { if (valid()) setLoading(false); }
  }, [accountId, admin, filter, permitted, scope, tab]);
  useEffect(() => { void load(); }, [load]);
  async function moderate(decision: "approved" | "rejected") {
    if (!review || working) return;
    if (decision === "rejected" && !reason.trim()) { setError("退回时请填写原因，方便作者修改。"); return; }
    setWorking(true); setError("");
    try {
      await reviewDzmmSubmission(review.id, review.publicationVersion, decision, reason.trim(), user?.id);
      if (!mounted.current) return;
      setReview(null); setReason(""); setNotice(decision === "approved" ? "已批准，角色现在可在广场发现。" : "已退回，作者可以修改后重新提交。");
      await load(); await onCatalogChanged();
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "审核失败。"); }
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
      setConfirm(null); if (admin) setReview(null); setNotice(confirm.action === "withdraw" ? "已撤回本次提交，私人草稿已保留。" : "角色已下架，私人草稿已保留。");
      await load(); await onCatalogChanged();
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "操作失败。"); }
    finally { if (mounted.current) setWorking(false); }
  }
  const snapshotCurrent = publicationSnapshot?.scope === scope;
  const retainedSnapshot = !admin && !loading && Boolean(error) && publicationSnapshot?.accountId === user?.id;
  const listed = snapshotCurrent || retainedSnapshot ? publications : [];
  const adminSnapshotCurrent = submissionSnapshot?.scope === scope;
  const retainedAdminSnapshot = admin && !loading && Boolean(error) && submissionSnapshot?.accountId === user?.id;
  const adminListed = adminSnapshotCurrent || retainedAdminSnapshot ? submissions : [];
  const Container = embedded ? "section" : "main";
  return <Container className={s.page} style={embedded ? { padding: 0 } : undefined} aria-label="角色作品管理">
    <header className={s.heading}><div><p>{admin ? "SUPER · 角色发布" : "我的创作"}</p>{embedded ? <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>{admin ? "角色审核" : "角色作品"}</h2> : <h1>{admin ? "角色审核" : "创作者中心"}</h1>}<span>{admin ? "检查角色设定与开场，批准后进入角色广场。" : "草稿仅自己可见，提交审核后可以公开发布。"}</span></div><div className={s.tools}><CommunityGuidelinesLink />{!admin && onNovels && <button className={s.outline} onClick={onNovels}><Icon name="book" size={16} />小说与故事</button>}{permitted && (admin || tab !== "drafts") && <button className={s.outline} disabled={loading || working} onClick={() => void load()}><Icon name="refresh" size={16} />刷新状态</button>}{!admin && <button className={s.primary} onClick={onCreate}><Icon name="plus" size={18} />创建角色</button>}</div></header>
    {admin ? <div className={s.filters}><label>审核状态<select value={filter} disabled={working} onChange={(event) => { generation.current++; setReview(null); setError(""); setLoading(true); setFilter(event.target.value as DzmmSubmissionStatus); }}>{Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div> : <nav className={s.tabs} aria-label="创作状态">{AUTHOR_TABS.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} disabled={working} onClick={() => { if (tab === key) return; generation.current++; setTab(key); setError(""); setLoading(permitted && key !== "drafts"); setNotice(""); setConfirm(null); }}>{label}{key === "drafts" && <span>{drafts.length}</span>}</button>)}</nav>}
    {error && <p className={s.error} role="alert">{error}<button onClick={() => void load()} disabled={loading}>刷新记录</button></p>}{notice && <p className={s.notice} role="status">{notice}</p>}
    {!permitted && (admin || tab !== "drafts") && <section className={s.empty}><Icon name="user" size={34} /><h2>{admin ? "需要 Super 管理员权限" : "登录后查看发布进度"}</h2><p>私人草稿可以继续保存和试聊。</p><button className={s.primary} onClick={onRequireAccount}>注册 / 登录</button></section>}
    {!admin && tab === "drafts" && (drafts.length ? <div className={s.list}>{drafts.map((character) => <article className={s.row} key={character.id}><img src={xumengImageUrl(character.cover)} alt="" /><div className={s.content}><h2>{character.name}</h2><p>{getDzmmCharacterPreviewText(character) || "还没有填写介绍"}</p><small>私人草稿 · {character.authoringDraft?.characterBook.entries.length ?? character.characterBook?.entries.length ?? 0} 条世界书{character.authoringDraft ? "（待完善）" : ""} · {character.openingMessages?.length ?? (character.firstMessage ? 1 : 0)} 条初始消息</small></div><button className={s.outline} onClick={() => onEdit(character)}><Icon name="edit" size={15} />继续创作</button></article>)}</div> : <section className={s.empty}><Icon name="edit" size={36} /><h2>写下你的第一个角色</h2><p>设置人物、开场和世界书，随时保存为私人草稿。</p><button className={s.primary} onClick={onCreate}>创建角色</button></section>)}
    {!admin && tab !== "drafts" && permitted && snapshotCurrent && <p className={s.meta}>共 {publicationSnapshot?.total} 条{tab === "archived" ? " · 已撤回的更新可能仍有旧版在线" : ""}</p>}
    {!admin && tab !== "drafts" && permitted && retainedSnapshot && !snapshotCurrent && <p className={s.notice} role="status">当前筛选未加载成功，下面保留上次“{AUTHOR_TABS.find(([key]) => key === publicationSnapshot?.filter)?.[1]}”的记录。请刷新当前筛选后再操作。</p>}
    {!admin && tab !== "drafts" && permitted && (listed.length ? <div className={s.list}>{listed.map((publication) => {
      const submission = publication.latestSubmission, character = submission.character;
      const editable = drafts.find((draft) => draft.id === publication.privateCharacterId) ?? character;
      return <article className={s.row} key={publication.id}><img src={xumengImageUrl(submission.previewCoverUrl)} alt="" /><div className={s.content}><h2>{character.name}<span className={s.badge} data-status={submission.status}>{STATUS[submission.status]}</span>{publication.isListed && submission.status !== "approved" && <span className={s.badge}>上一版本已上线</span>}{!publication.isListed && publication.approvedRevision !== null && <span className={s.badge}>已下架</span>}</h2><p>{getDzmmCharacterPreviewText(character)}</p><small>第 {submission.revision} 版 · {date(submission.createdAt)}</small>{submission.reason && <p className={s.reason}>审核意见：{submission.reason}</p>}</div><div className={s.actions}><button className={s.outline} disabled={working || !snapshotCurrent} onClick={() => onEdit(editable)}>编辑 / 重提</button>{submission.status === "pending" && <button className={s.text} disabled={working || !snapshotCurrent} onClick={() => setConfirm({ action: "withdraw", publication })}>撤回提交</button>}{publication.isListed && <button className={s.danger} disabled={working || !snapshotCurrent} onClick={() => setConfirm({ action: "unpublish", publication })}>下架</button>}</div></article>;
    })}</div> : <section className={s.empty}><Icon name="book" size={34} /><h2>{loading ? "正在加载…" : error ? "当前筛选未加载成功" : "当前没有这类记录"}</h2><p>{error ? "草稿和已读取的记录会保留，请刷新后重试。" : "保存草稿后，在“预览发布”步骤提交。"}</p></section>)}
    {admin && permitted && retainedAdminSnapshot && !adminSnapshotCurrent && <p className={s.notice} role="status">当前审核筛选未加载成功，下面保留上次“{STATUS[submissionSnapshot!.filter]}”的记录。请刷新当前筛选后再操作。</p>}
    {admin && permitted && (adminListed.length ? <div className={s.list}>{adminListed.map((submission) => <article className={s.row} key={submission.id}><img src={xumengImageUrl(submission.previewCoverUrl)} alt="" /><div className={s.content}><h2>{submission.character.name}<span className={s.badge} data-status={submission.status}>{STATUS[submission.status]}</span></h2><p>{getDzmmCharacterPreviewText(submission.character)}</p><small>{submission.author.nickname} · 第 {submission.revision} 版 · {date(submission.createdAt)}</small>{submission.reason && <p className={s.reason}>审核意见：{submission.reason}</p>}</div><div className={s.actions}><button className={s.outline} disabled={working || !adminSnapshotCurrent} onClick={() => { setReview(submission); setReason(""); setError(""); }}>查看完整设定</button>{submission.isListed && <button className={s.danger} disabled={working || !adminSnapshotCurrent} onClick={() => setConfirm({ action: "unpublish", publication: { id: submission.publicationId, version: submission.publicationVersion, latestSubmission: submission } })}>下架</button>}</div></article>)}</div> : <section className={s.empty}><Icon name="check" size={36} /><h2>{loading ? "正在加载…" : error ? "当前审核筛选未加载成功" : "没有这类审核记录"}</h2></section>)}
    {hasMore && permitted && ((admin && adminSnapshotCurrent) || (!admin && tab !== "drafts" && snapshotCurrent)) && <button className={s.more} disabled={loading || working} onClick={() => void load(true, offset)}>{loading ? "正在加载…" : "加载更多记录"}</button>}
    {review && <div className={s.overlay}><section ref={dialog} tabIndex={-1} className={s.dialog} role="dialog" aria-modal="true" aria-label="审核角色"><header><h2>{review.character.name}</h2><button className={s.text} disabled={working} onClick={() => setReview(null)} aria-label="关闭审核"><Icon name="close" /></button></header><div className={s.reviewBody}><p className={s.meta}>{review.author.nickname} · 第 {review.revision} 版 · {STATUS[review.status]}</p><div className={s.gallery}><img src={review.previewCoverUrl} alt="角色封面" />{review.previewGalleryUrls?.map((url, index) => <img key={`${index}:${url}`} src={url} alt={`图库 ${index + 1}`} />)}</div>{([["角色卡介绍", review.character.introduction], ["作者备注", review.character.creatorNotes], ["详细描述", review.character.description], ["性格", review.character.personality], ["场景", review.character.scenario], ["系统指令", review.character.systemPrompt], ["历史后指令", review.character.postHistoryInstructions], ["对话示例", review.character.messageExamples]] as const).map(([label, content]) => content ? <section className={s.field} key={label}><h3>{label}</h3><p>{content}</p></section> : null)}<section className={s.field}><h3>开场对话</h3>{(review.character.openingMessages ?? (review.character.firstMessage ? [{ role: "assistant", content: review.character.firstMessage }] : [])).map((message, index) => <p key={index}><strong>{message.role === "assistant" ? "AI" : "用户"}：</strong>{message.content}</p>)}{review.character.alternateGreetings?.map((content, index) => <p key={`alt:${index}`}><strong>备选 {index + 1}：</strong>{content}</p>)}</section><section className={s.field}><h3>世界书 · {review.character.characterBook?.entries.length ?? 0} 条</h3>{review.character.characterBook?.entries.map((entry, index) => <div key={index}><strong>{entry.name || `条目 ${index + 1}`} · {entry.constant ? "常驻" : entry.keys.join("、")}{entry.enabled === false ? " · 已关闭" : ""}</strong><p>{entry.content}</p></div>)}</section>{review.status === "pending" && <label className={s.reviewReason}>审核意见<textarea maxLength={1000} rows={3} value={reason} disabled={working} onChange={(event) => setReason(event.target.value)} placeholder="退回时说明需要修改的内容" /></label>}{error && <p className={s.error} role="alert">{error}</p>}</div>{review.status === "pending" && <footer><button className={s.outline} disabled={working} onClick={() => void moderate("rejected")}>退回修改</button><button className={s.primary} disabled={working} onClick={() => void moderate("approved")}>{working ? "正在处理…" : "批准发布"}</button></footer>}</section></div>}
    {confirm && <div className={s.overlay}><section ref={dialog} tabIndex={-1} className={s.confirm} role="dialog" aria-modal="true" aria-label={confirm.action === "withdraw" ? "撤回提交" : "下架角色"}><h2>{confirm.action === "withdraw" ? "撤回本次提交？" : "下架这个角色？"}</h2><p>{confirm.action === "withdraw" ? "待审核版本将被撤回，已经上线的旧版本和私人草稿会保留。" : "角色将退出广场，待审核版本也会撤回。私人草稿会保留。"}</p>{error && <p className={s.error} role="alert">{error}</p>}<footer><button className={s.outline} disabled={working} onClick={() => setConfirm(null)}>取消</button><button className={s.primary} disabled={working} onClick={() => void confirmAction()}>{working ? "正在处理…" : "确认"}</button></footer></section></div>}
  </Container>;
}
